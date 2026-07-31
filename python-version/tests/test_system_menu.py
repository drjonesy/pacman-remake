"""The SELECT+START operator menu.

Two things here can strand a cabinet with no keyboard attached, so both are
pinned: the menu must always have a way out (every stage backs out to the game),
and RESET SCORES must be unreachable without the full code in the right order.
The combo watcher gets its own coverage because it deliberately *delays* a
normal press, and a bug there would make the menu unstartable or the game so.
"""

import pygame
import pytest

from pacman.gamepad import DEFAULT_MAPPING, GamepadManager
from pacman.leaderboard import Leaderboard
from pacman.ui.system_menu import (
    CODE, DONE_MS, IDLE_TIMEOUT_MS, OPTIONS, STAGE_CODE, STAGE_CONFIRM,
    STAGE_DONE, STAGE_OPTIONS, ComboWatcher, SystemMenu,
)

pygame.init()


def event(kind, **attrs):
    attrs.setdefault('instance_id', 0)
    return pygame.event.Event(kind, attrs)


class FakeLeaderboard:
    def __init__(self):
        self.reset_calls = 0

    def reset(self):
        self.reset_calls += 1
        return []


@pytest.fixture
def board():
    return FakeLeaderboard()


@pytest.fixture
def menu(board):
    # renderer and font are only touched by draw(), which is not under test.
    return SystemMenu(None, None, board)


def option_index(name):
    return [key for key, _ in OPTIONS].index(name)


def enter_code(menu, panels=CODE):
    for panel in panels:
        menu.feed(panels=(panel,))


# -- panel resolution --------------------------------------------------------

def test_panels_resolve_independently_of_actions():
    """The mat's SELECT panel drives the `pause` action, not `select`.

    That divergence is the entire reason panels exist; if these ever collapse
    into one lookup the combo starts firing on the wrong controls.
    """
    pads = GamepadManager(DEFAULT_MAPPING)

    select_panel = event(pygame.JOYBUTTONDOWN, button=8)
    assert pads.panels(select_panel) == ('select',)
    assert pads.handle(select_panel) == ('pause',)

    start_panel = event(pygame.JOYBUTTONDOWN, button=9)
    assert pads.panels(start_panel) == ('start',)
    assert pads.handle(start_panel) == ('select',)


@pytest.mark.parametrize('button, panel', [
    (4, 'square'), (5, 'triangle'), (6, 'cross'), (7, 'circle'),
])
def test_shape_panels_resolve(button, panel):
    pads = GamepadManager(DEFAULT_MAPPING)
    assert pads.panels(event(pygame.JOYBUTTONDOWN, button=button)) == (panel,)


def test_panels_default_when_mapping_omits_them():
    """A file written by --calibrate has `bindings` and nothing else."""
    pads = GamepadManager({'version': 1, 'bindings': {}})
    assert pads.panels(event(pygame.JOYBUTTONDOWN, button=9)) == ('start',)


def test_panels_refuse_axis_and_hat_bindings():
    """An axis that parks at full deflection would hold a panel down forever."""
    pads = GamepadManager({
        'version': 1,
        'bindings': {},
        'panels': {
            'start': [{'type': 'axis', 'axis': 0, 'value': 1}],
            'cross': [{'type': 'hat', 'hat': 0, 'axis': 'x', 'value': 1}],
            'circle': [{'type': 'button', 'button': 7}],
        },
    })
    assert pads.panels(event(pygame.JOYAXISMOTION, axis=0, value=1.0)) == ()
    assert pads.panels(event(pygame.JOYHATMOTION, hat=0, value=(1, 0))) == ()
    assert pads.panels(event(pygame.JOYBUTTONDOWN, button=7)) == ('circle',)


# -- combo watcher -----------------------------------------------------------

def test_combo_fires_when_both_panels_arrive_in_window():
    fired = []
    combo = ComboWatcher(on_trigger=lambda: fired.append(True))
    dispatched = []

    assert combo.feed(('select',), ('pause',)) is True
    assert combo.feed(('start',), ('select',)) is True

    combo.tick(1000, dispatched.append)
    assert fired == [True]
    # Neither half's normal action may leak through.
    assert dispatched == []


def test_combo_order_does_not_matter():
    fired = []
    combo = ComboWatcher(on_trigger=lambda: fired.append(True))
    combo.feed(('start',), ('select',))
    combo.feed(('select',), ('pause',))
    assert fired == [True]


def test_lone_press_is_dispatched_after_the_window():
    """START on its own still starts a game - just `window_ms` later."""
    combo = ComboWatcher(on_trigger=lambda: pytest.fail('should not fire'))
    dispatched = []

    combo.feed(('start',), ('select',))
    combo.tick(100, dispatched.append)
    assert dispatched == []          # still inside the window

    combo.tick(200, dispatched.append)
    assert dispatched == [('select',)]


def test_second_press_after_the_window_is_not_a_combo():
    fired = []
    combo = ComboWatcher(on_trigger=lambda: fired.append(True))
    dispatched = []

    combo.feed(('select',), ('pause',))
    combo.tick(1000, dispatched.append)
    combo.feed(('start',), ('select',))
    combo.tick(1000, dispatched.append)

    assert fired == []
    assert dispatched == [('pause',), ('select',)]


def test_mashing_one_panel_still_dispatches_once():
    """Stomping START on a mat must not hold the window open forever."""
    combo = ComboWatcher(on_trigger=lambda: pytest.fail('should not fire'))
    dispatched = []

    for _ in range(8):                   # 240ms of mashing, inside one window
        combo.feed(('start',), ('select',))
        combo.tick(30, dispatched.append)
    assert dispatched == []

    # The window still expires on schedule, and the repeats collapse into one
    # start rather than eight.
    combo.tick(100, dispatched.append)
    assert dispatched == [('select',)]


def test_non_combo_panels_are_left_alone():
    """The circle panel is bound to `select` too, and must stay instant."""
    combo = ComboWatcher(on_trigger=lambda: pytest.fail('should not fire'))
    assert combo.feed(('circle',), ('select',)) is False


def test_cancel_drops_a_held_press():
    combo = ComboWatcher(on_trigger=lambda: None)
    dispatched = []
    combo.feed(('start',), ('select',))
    combo.cancel()
    combo.tick(1000, dispatched.append)
    assert dispatched == []


# -- option list -------------------------------------------------------------

def test_opens_on_the_first_option(menu):
    menu.open_menu()
    assert menu.open
    assert menu.stage == STAGE_OPTIONS
    assert menu.index == 0


def test_arrows_navigate_and_wrap(menu):
    menu.open_menu()
    menu.feed(actions=('down',))
    assert menu.index == 1
    menu.feed(actions=('up',))
    assert menu.index == 0
    menu.feed(actions=('up',))
    assert menu.index == len(OPTIONS) - 1


def test_exit_option_calls_the_exit_hook(menu):
    exits = []
    menu.open_menu(on_exit=lambda: exits.append(True))
    menu.index = option_index('exit')
    menu.feed(panels=('select',))

    assert exits == [True]
    assert not menu.open


def test_cancel_option_closes_without_side_effects(menu, board):
    exits = []
    menu.open_menu(on_exit=lambda: exits.append(True))
    menu.index = option_index('cancel')
    menu.feed(panels=('select',))

    assert not menu.open
    assert exits == []
    assert board.reset_calls == 0


def test_start_panel_does_not_pick_an_option(menu):
    """Only SELECT picks. START is the confirm for the reset gate."""
    exits = []
    menu.open_menu(on_exit=lambda: exits.append(True))
    menu.index = option_index('exit')
    menu.feed(panels=('start',))

    assert menu.open
    assert exits == []


# -- reset gate --------------------------------------------------------------

def test_full_code_then_start_clears_the_board(menu, board):
    resets = []
    menu.open_menu(on_reset=lambda: resets.append(True))
    menu.feed(panels=('select',))         # RESET SCORES
    assert menu.stage == STAGE_CODE

    enter_code(menu)
    assert menu.stage == STAGE_CONFIRM
    assert board.reset_calls == 0         # code alone must not clear anything

    menu.feed(panels=('start',))
    assert board.reset_calls == 1
    assert resets == [True]
    assert menu.stage == STAGE_DONE

    menu.tick(DONE_MS)
    assert not menu.open


def test_start_before_the_code_is_complete_does_nothing(menu, board):
    menu.open_menu()
    menu.feed(panels=('select',))
    enter_code(menu, CODE[:3])

    menu.feed(panels=('start',))
    assert board.reset_calls == 0
    assert menu.stage == STAGE_CODE


def test_wrong_panel_restarts_the_code(menu, board):
    menu.open_menu()
    menu.feed(panels=('select',))

    menu.feed(panels=('cross',))
    assert menu.progress == 1
    menu.feed(panels=('triangle',))       # square was expected
    assert menu.progress == 0

    # Finishing the *remaining* panels must not arm the confirm.
    enter_code(menu, CODE[1:])
    assert menu.stage == STAGE_CODE
    assert board.reset_calls == 0


def test_out_of_order_code_never_arms_confirm(menu):
    menu.open_menu()
    menu.feed(panels=('select',))
    enter_code(menu, tuple(reversed(CODE)))
    assert menu.stage == STAGE_CODE


def test_select_backs_out_of_the_code_stage(menu, board):
    """Otherwise a half-entered code is a dead end on a keyboardless cabinet."""
    menu.open_menu()
    menu.feed(panels=('select',))
    menu.feed(panels=('cross',))
    menu.feed(panels=('select',))

    assert not menu.open
    assert board.reset_calls == 0


def test_reopening_forgets_previous_progress(menu):
    menu.open_menu()
    menu.feed(panels=('select',))
    enter_code(menu, CODE[:2])
    menu.close()

    menu.open_menu()
    assert menu.stage == STAGE_OPTIONS
    assert menu.progress == 0


# -- timeout -----------------------------------------------------------------

def test_idle_timeout_closes_an_abandoned_menu(menu):
    menu.open_menu()
    menu.tick(IDLE_TIMEOUT_MS - 1)
    assert menu.open
    menu.tick(2)
    assert not menu.open


def test_input_resets_the_idle_timer(menu):
    menu.open_menu()
    menu.tick(IDLE_TIMEOUT_MS - 1)
    menu.feed(actions=('down',))
    menu.tick(IDLE_TIMEOUT_MS - 1)
    assert menu.open


# -- integration -------------------------------------------------------------

def test_reset_actually_empties_the_file(tmp_path):
    data_file = tmp_path / 'data.json'
    board = Leaderboard(str(data_file))
    board.submit_score('RYAN', 4200)
    assert board.read_scores()

    menu = SystemMenu(None, None, board)
    menu.open_menu()
    menu.feed(panels=('select',))
    enter_code(menu)
    menu.feed(panels=('start',))

    assert board.read_scores() == []


def test_a_failed_write_still_closes_the_menu(menu):
    class Broken:
        def reset(self):
            raise OSError('read-only filesystem')

    menu.leaderboard = Broken()
    menu.open_menu()
    menu.feed(panels=('select',))
    enter_code(menu)
    menu.feed(panels=('start',))

    assert menu.stage == STAGE_DONE
    menu.tick(DONE_MS)
    assert not menu.open
