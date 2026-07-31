"""The SELECT operator menu (Pi-only; no reference counterpart).

A cabinet has no keyboard, so clearing the leaderboard or shutting the game down
used to mean SSHing in. This is that: the SELECT panel on the main menu opens a
short list - RESET SCORES, EXIT GAME, CANCEL - navigated with the arrow panels
and chosen with SELECT.

SELECT is free to take on the menu because it drives the `pause` action, and
there is nothing to pause there. An earlier version needed SELECT+START
together, which meant holding both panels' actions back for 250ms to see whether
a combo was forming - too tight a window to hit with two feet on a mat, and it
put a delay on starting a game. One panel needs none of that.

RESET SCORES is the destructive one, so it is gated behind a passcode entered on
the four shape panels. EXIT GAME just exits; there is nothing to undo.

The passcode is treated as a secret, which drives two things that would
otherwise look like missing polish:

* **Entry is masked.** The slots fill in but never show which panel was pressed,
  so the code cannot be read over a player's shoulder.
* **Nothing is checked until START.** A wrong panel is accepted silently and the
  whole sequence is compared at the end. Rejecting each panel as it was pressed
  would leak the code one position at a time - with four panels that is ~16
  guesses instead of the 256 sequences a blind search needs.

The code is read as *physical panels* rather than the eight actions the rest of
the game sees, which is the whole reason `gamepad.PANELS` exists. On this mat
the shapes are already aliased to mute/pause/delete/select, so reading actions
instead would toggle mute and pause the game while the code was being entered.

`main.py` only offers this on the menu screen, so it can never interrupt a run.
"""

import json
import os

from .. import constants as C
from ..controls import SCHEME_ORDER, SCHEMES, Controls

# The alphabet the passcode is drawn from: the four shape panels. The arrows are
# deliberately excluded - they are how the menu is navigated, and a code that
# overlapped them would be harder to enter than to guess.
CODE_PANELS = ('cross', 'square', 'triangle', 'circle')

DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'data',
)
PASSCODE_FILE = os.path.join(DATA_DIR, 'passcode.json')

# Used when there is no passcode file. This one is in the repository, so it is
# public knowledge - `data/passcode.json` is gitignored precisely so a real
# secret can be set without committing it. See the README.
DEFAULT_CODE = ('cross', 'square', 'triangle', 'circle')

# A hand-written file should not be able to make the menu unusable, in either
# direction: an empty code would reset the board on a bare START press, and an
# absurdly long one could not be entered before the idle timeout.
MIN_CODE_LENGTH = 3
MAX_CODE_LENGTH = 10


def load_code(path=PASSCODE_FILE):
    """The configured passcode, or `DEFAULT_CODE` if there is not a usable one.

    Same rule as the leaderboard and the pad mapping: a missing or corrupt file
    is a fallback, never an error. A cabinet must always boot.
    """
    if not path or not os.path.exists(path):
        return DEFAULT_CODE

    try:
        with open(path, encoding='utf-8') as handle:
            parsed = json.load(handle)
    except (OSError, ValueError):
        return DEFAULT_CODE

    code = parsed.get('code') if isinstance(parsed, dict) else parsed
    if not isinstance(code, list):
        return DEFAULT_CODE
    if not MIN_CODE_LENGTH <= len(code) <= MAX_CODE_LENGTH:
        return DEFAULT_CODE
    if any(panel not in CODE_PANELS for panel in code):
        return DEFAULT_CODE

    return tuple(code)


OPTION_CONTROLS = 'controls'
OPTION_RESET = 'reset'
OPTION_EXIT = 'exit'
OPTION_CANCEL = 'cancel'

# CANCEL is not in the original sketch of this menu, but without it the popup is
# a trap: every other row either wipes the board or kills the game. CONTROLLER
# leads the list because it is the only harmless one, and the cursor starts on
# whatever is first.
OPTIONS = (
    (OPTION_CONTROLS, 'CONTROLLER'),
    (OPTION_RESET, 'RESET SCORES'),
    (OPTION_EXIT, 'EXIT GAME'),
    (OPTION_CANCEL, 'CANCEL'),
)

STAGE_OPTIONS = 'options'
STAGE_CONTROLS = 'controls'
STAGE_CODE = 'code'
STAGE_CONFIRM = 'confirm'
STAGE_DONE = 'done'

RESULT_CLEARED = 'cleared'
RESULT_INCORRECT = 'incorrect'

# An unattended cabinet should not sit on this screen forever.
IDLE_TIMEOUT_MS = 20000
# How long the closing message stays up before the menu closes itself.
DONE_MS = 1600

PANEL_WIDTH = 132
PANEL_HEIGHT = 18
PANEL_GAP = 4

SLOT_SIZE = 24
SLOT_GAP = 10
SLOT_DOT = 10

HEADING_Y = 74
BODY_Y = 100
OPTIONS_Y = 128
HINT_Y = C.LOGICAL_HEIGHT - 40


class SystemMenu:
    """Modal state plus its own input handling, like `ScoreEntry`.

    While this is open `main.py` routes every key and panel here instead of to
    the game, so nothing behind it can be reached by the code being entered.
    """

    def __init__(self, renderer, font, leaderboard, code=None, controls=None):
        self.renderer = renderer
        self.font = font
        self.leaderboard = leaderboard
        self.controls = controls if controls is not None else Controls()
        # Read once at construction: re-reading per press would put a file stat
        # in the input path for no benefit, and the file is not hot-edited.
        self.code = tuple(code) if code else load_code()

        self.open = False
        self.stage = STAGE_OPTIONS
        self.index = 0
        self.entered = []        # panels pressed so far, unvalidated
        self.result = None
        self.idle_ms = 0
        self.done_ms = 0

        self.on_reset = None
        self.on_exit = None

    # -- lifecycle -----------------------------------------------------------

    def open_menu(self, on_reset=None, on_exit=None):
        self.open = True
        self.stage = STAGE_OPTIONS
        self.index = 0
        self.entered = []
        self.result = None
        self.idle_ms = 0
        self.done_ms = 0
        self.on_reset = on_reset
        self.on_exit = on_exit

    def close(self):
        self.open = False
        self.stage = STAGE_OPTIONS
        self.entered = []

    @property
    def awaiting_confirm(self):
        """True once the code is fully entered and only START is left.

        Says nothing about whether the code is *right* - that is not known until
        START is pressed. `main.py` reads this to decide what its Enter key
        stands in for when testing on a desktop.
        """
        return self.stage == STAGE_CONFIRM

    def tick(self, frame_ms):
        """Wall-clock bookkeeping. The game is not simulating behind this."""
        if not self.open:
            return

        if self.stage == STAGE_DONE:
            self.done_ms += frame_ms
            if self.done_ms >= DONE_MS:
                self.close()
            return

        self.idle_ms += frame_ms
        if self.idle_ms >= IDLE_TIMEOUT_MS:
            self.close()

    # -- input ---------------------------------------------------------------

    def feed(self, panels=(), actions=()):
        """Routes one input event. `panels` is physical, `actions` semantic.

        Navigation comes in as actions because the arrow panels genuinely mean
        up/down; the code comes in as panels because the shapes do not mean what
        they are bound to. See the module docstring.
        """
        if not self.open or self.stage == STAGE_DONE:
            return

        self.idle_ms = 0

        if self.stage == STAGE_OPTIONS:
            if 'up' in actions:
                self.index = (self.index - 1) % len(OPTIONS)
            elif 'down' in actions:
                self.index = (self.index + 1) % len(OPTIONS)
            elif 'select' in panels:
                self._choose()
            return

        if self.stage == STAGE_CONTROLS:
            if 'up' in actions:
                self.index = (self.index - 1) % len(SCHEME_ORDER)
            elif 'down' in actions:
                self.index = (self.index + 1) % len(SCHEME_ORDER)
            elif 'select' in panels:
                self.controls.select(SCHEME_ORDER[self.index])
                # Closes rather than stepping back, so the new labels on the
                # attract screen are the confirmation.
                self.close()
            return

        # Both remaining stages are part of the reset gate. SELECT backs out of
        # them rather than choosing anything, so a half-entered code is never a
        # dead end.
        if 'select' in panels:
            self.close()
            return

        if self.stage == STAGE_CONFIRM:
            if 'start' in panels:
                self._submit_code()
            return

        for panel in CODE_PANELS:
            if panel in panels:
                # Accepted without comment, right or wrong. See the module
                # docstring on why this must not give feedback per press.
                self.entered.append(panel)
                if len(self.entered) == len(self.code):
                    self.stage = STAGE_CONFIRM
                return

    def _choose(self):
        option = OPTIONS[self.index][0]
        if option == OPTION_CANCEL:
            self.close()
        elif option == OPTION_EXIT:
            self.close()
            if self.on_exit:
                self.on_exit()
        elif option == OPTION_CONTROLS:
            self.stage = STAGE_CONTROLS
            # Start on the active scheme, so the list doubles as a readout of
            # which one is in force.
            self.index = SCHEME_ORDER.index(self.controls.name)
        else:
            self.stage = STAGE_CODE
            self.entered = []

    def _submit_code(self):
        if tuple(self.entered) != tuple(self.code):
            self._finish(RESULT_INCORRECT)
            return
        self._commit_reset()

    def _commit_reset(self):
        """Clears the board. A failed write still closes the menu.

        Same rule as `ScoreEntry.close_and_save`: a bad disk must not trap
        anyone in a modal on a machine with no keyboard.
        """
        try:
            self.leaderboard.reset()
        except OSError:
            pass
        finally:
            if self.on_reset:
                self.on_reset()
            self._finish(RESULT_CLEARED)

    def _finish(self, result):
        self.result = result
        self.stage = STAGE_DONE
        self.done_ms = 0
        # Dropped so a wrong code cannot be re-submitted, and so it is not
        # sitting in memory while the closing message is up.
        self.entered = []

    # -- drawing -------------------------------------------------------------

    def draw(self, blink_ms=0):
        surface = self.renderer.surface

        # Heavier than the ScoreEntry scrim (217). That one only ever covers the
        # maze, which is mostly black anyway; this covers the attract screen,
        # and at 217 the leaderboard rows stayed legible behind a dialog about
        # erasing them.
        dim = surface.copy()
        dim.fill((0, 0, 0))
        dim.set_alpha(243)
        surface.blit(dim, (0, 0))

        if self.stage == STAGE_DONE:
            self._draw_done(surface)
        elif self.stage == STAGE_OPTIONS:
            self._draw_options(surface)
        elif self.stage == STAGE_CONTROLS:
            self._draw_controls(surface)
        else:
            self._draw_code(surface, blink_ms)

    def _draw_rows(self, surface, labels):
        """The highlighted list both list stages share."""
        center = C.LOGICAL_WIDTH / 2
        x = (C.LOGICAL_WIDTH - PANEL_WIDTH) / 2

        for row, label in enumerate(labels):
            y = OPTIONS_Y + row * (PANEL_HEIGHT + PANEL_GAP)
            selected = row == self.index

            self.renderer.fill_rect_at(
                x, y, PANEL_WIDTH, PANEL_HEIGHT,
                C.ARCADE_YELLOW if selected else C.ARCADE_DARK,
            )
            self.font.draw(
                surface, label, center, y + (PANEL_HEIGHT - 7) / 2,
                C.ARCADE_DARK if selected else C.WHITE, align='center',
            )

    def _draw_nav_hint(self, surface):
        self.font.draw(
            surface, f'UP DOWN MOVE  {self.controls.scheme.menu_pick} PICKS',
            C.LOGICAL_WIDTH / 2, HINT_Y, C.ARCADE_GREY, align='center',
        )

    def _draw_options(self, surface):
        self.font.draw(surface, 'SYSTEM MENU', C.LOGICAL_WIDTH / 2, HEADING_Y,
                       C.ARCADE_YELLOW, align='center')
        self._draw_rows(surface, [label for _, label in OPTIONS])
        self._draw_nav_hint(surface)

    def _draw_controls(self, surface):
        center = C.LOGICAL_WIDTH / 2

        self.font.draw(surface, 'SELECT CONTROLLER', center, HEADING_Y,
                       C.ARCADE_YELLOW, align='center')
        self.font.draw(surface, 'CHANGES ON-SCREEN LABELS', center, BODY_Y,
                       C.ARCADE_GREY, align='center')

        # A dot marks the scheme in force, so the list reads as a setting rather
        # than as four unrelated buttons.
        self._draw_rows(surface, [
            f'{SCHEMES[name].label} *' if name == self.controls.name
            else SCHEMES[name].label
            for name in SCHEME_ORDER
        ])
        self._draw_nav_hint(surface)

    def _draw_code(self, surface, blink_ms):
        center = C.LOGICAL_WIDTH / 2

        self.font.draw(surface, 'RESET HIGH SCORES', center, HEADING_Y,
                       C.ARCADE_RED, align='center')
        self.font.draw(surface, 'ENTER PASSCODE', center, BODY_Y,
                       C.WHITE, align='center')

        self._draw_slots()

        if self.stage == STAGE_CONFIRM:
            # Blinking, because this is the last press before the board is gone.
            color = (C.ARCADE_YELLOW if (blink_ms % 1000) < 500
                     else C.ARCADE_DARK)
            self.font.draw(
                surface, f'PRESS {self.controls.scheme.confirm} TO CONFIRM',
                center, OPTIONS_Y + 40, color, align='center',
            )

        self.font.draw(surface, f'{self.controls.scheme.cancel} CANCELS',
                       center, HINT_Y, C.ARCADE_GREY, align='center')

    def _draw_slots(self):
        """One masked slot per code position - never which panel was pressed."""
        count = len(self.code)
        total = count * SLOT_SIZE + (count - 1) * SLOT_GAP
        start_x = (C.LOGICAL_WIDTH - total) / 2
        inset = (SLOT_SIZE - SLOT_DOT) / 2

        for index in range(count):
            x = start_x + index * (SLOT_SIZE + SLOT_GAP)
            self.renderer.fill_rect_at(
                x, OPTIONS_Y, SLOT_SIZE, SLOT_SIZE, C.ARCADE_DARK,
            )
            if index < len(self.entered):
                self.renderer.fill_rect_at(
                    x + inset, OPTIONS_Y + inset, SLOT_DOT, SLOT_DOT,
                    C.ARCADE_YELLOW,
                )

    def _draw_done(self, surface):
        center = C.LOGICAL_WIDTH / 2
        if self.result == RESULT_CLEARED:
            self.font.draw(surface, 'SCORES CLEARED', center, BODY_Y,
                           C.ARCADE_YELLOW, align='center')
        else:
            # Says the sequence was wrong, not which part of it was.
            self.font.draw(surface, 'INCORRECT', center, BODY_Y,
                           C.ARCADE_RED, align='center')
