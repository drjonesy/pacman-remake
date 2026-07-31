#!/usr/bin/env python3
"""Entry point: window setup, input, and the render/simulate loop.

Run with no arguments for fullscreen. `--windowed` is for desktop testing.
"""

import argparse
import sys

from pacman import constants as C

# Must be decided before pygame.init(): a small buffer keeps audio latency down.
# If audio underruns on the Pi, raise this to 1024 before touching anything
# else.
AUDIO_BUFFER = 512


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--windowed', action='store_true',
                        help='run in a window instead of fullscreen')
    parser.add_argument('--scale', type=int, default=3, metavar='N',
                        help='integer upscale for --windowed (default: 3)')
    parser.add_argument('--no-sound', action='store_true',
                        help='disable audio entirely')
    parser.add_argument('--fps', action='store_true',
                        help='show the FPS counter from the start')
    parser.add_argument('--data-file', default=None, metavar='PATH',
                        help='leaderboard JSON file. Point this at '
                             '../node-version/data/data.json to share one board '
                             'with the Node version.')
    parser.add_argument('--reset', action='store_true',
                        help='clear the leaderboard and exit '
                             '(equivalent to npm run reset)')
    parser.add_argument('--audio-buffer', type=int, default=AUDIO_BUFFER,
                        metavar='N', help='mixer buffer size (default: 512)')
    parser.add_argument('--pad-mapping', default=None, metavar='PATH',
                        help='gamepad / dance-pad binding table '
                             '(default: data/pad_mapping.json, written by '
                             'tools/gamepad_test.py --calibrate)')
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)

    from pacman.leaderboard import DATA_FILE, Leaderboard
    leaderboard = Leaderboard(args.data_file or DATA_FILE)

    if args.reset:
        leaderboard.reset()
        print(f'leaderboard cleared: {leaderboard.data_file}')
        return 0

    import pygame

    sound_enabled = not args.no_sound
    if sound_enabled:
        try:
            pygame.mixer.pre_init(
                frequency=44100, size=-16, channels=2,
                buffer=args.audio_buffer,
            )
        except pygame.error:
            sound_enabled = False

    pygame.init()
    if sound_enabled and not pygame.mixer.get_init():
        try:
            pygame.mixer.init()
        except pygame.error:
            # No audio device (headless, or a Pi with audio disabled) must not
            # stop the game from running.
            sound_enabled = False

    pygame.display.set_caption('Pac-Man')
    pygame.mouse.set_visible(False)

    logical_size = (C.LOGICAL_WIDTH, C.LOGICAL_HEIGHT)

    if args.windowed:
        scale = max(1, args.scale)
        window = pygame.display.set_mode(
            (logical_size[0] * scale, logical_size[1] * scale),
        )
        logical = pygame.Surface(logical_size).convert()
    else:
        # SCALED lets SDL stretch the fixed logical surface to the display,
        # letterboxing as needed, so no asset ever needs re-rasterizing and
        # there is no extra blit in the hot path. vsync pairs with the 60fps
        # render target.
        try:
            window = pygame.display.set_mode(
                logical_size, pygame.FULLSCREEN | pygame.SCALED, vsync=1,
            )
        except pygame.error:
            window = pygame.display.set_mode(
                logical_size, pygame.FULLSCREEN | pygame.SCALED,
            )
        logical = window

    from pacman.coordinator import STATE_MENU, STATE_PLAYING, GameCoordinator
    from pacman.engine import GameEngine
    from pacman.gamepad import MAPPING_FILE, GamepadManager, load_mapping
    from pacman.font import BitmapFont
    from pacman.renderer import AssetStore, Renderer
    from pacman.sound import SoundManager
    from pacman.ui.hud import Hud
    from pacman.ui.menu import Menu
    from pacman.ui.score_entry import ScoreEntry
    from pacman.ui.system_menu import SystemMenu

    assets = AssetStore().load()
    renderer = Renderer(logical, assets)
    font = BitmapFont()

    sound_manager = SoundManager(enabled=sound_enabled).load()

    coordinator = GameCoordinator(renderer, sound_manager, leaderboard)
    coordinator.show_fps = args.fps

    hud = Hud(renderer, font)
    menu = Menu(renderer, font, leaderboard)
    score_entry = ScoreEntry(renderer, font, leaderboard)
    system_menu = SystemMenu(renderer, font, leaderboard)

    def on_score_saved():
        # The HIGH SCORE readout mirrors first place, so both it and the menu
        # table have to be refreshed after a save (engine.js:1251-1260).
        menu.refresh()
        coordinator.refresh_high_score()

    coordinator.on_game_over = (
        lambda score: score_entry.try_open(score, on_close=on_score_saved)
    )

    # engine.js:1178-1190. The on-screen d-pad and all touch handling are
    # dropped - there is no touchscreen and no portrait layout (§10).
    movement_keys = {
        pygame.K_w: 'up',
        pygame.K_s: 'down',
        pygame.K_a: 'left',
        pygame.K_d: 'right',
        pygame.K_UP: 'up',
        pygame.K_DOWN: 'down',
        pygame.K_LEFT: 'left',
        pygame.K_RIGHT: 'right',
    }

    pads = GamepadManager(
        load_mapping(args.pad_mapping or MAPPING_FILE),
    ).open_all()

    state = {'running': True, 'ui_clock_ms': 0.0}

    def quit_game():
        state['running'] = False

    def start_game():
        menu.refresh()
        coordinator.start_button_click()

    def handle_direction(direction):
        if score_entry.open:
            score_entry.move(direction)
        elif coordinator.state == STATE_PLAYING:
            coordinator.change_direction(direction)

    def handle_select():
        if score_entry.open:
            score_entry.select()
        elif coordinator.state == STATE_MENU:
            start_game()

    def handle_delete():
        if score_entry.open:
            score_entry.backspace()

    def handle_pause():
        if not score_entry.open and coordinator.state == STATE_PLAYING:
            coordinator.handle_pause_key()

    def handle_mute():
        if not score_entry.open:
            sound_manager.toggle_mute()

    def open_system_menu():
        system_menu.open_menu(on_reset=on_score_saved, on_exit=quit_game)

    def system_menu_armed():
        # Menu screen only. Note the state is already STATE_MENU while the
        # name-entry modal is still up after a game over, so that has to be
        # excluded separately.
        return coordinator.state == STATE_MENU and not score_entry.open

    # Everything a pad can do, and the only things it can do. Quit is absent on
    # purpose: a stray panel press must not be able to close the game.
    pad_actions = {
        'up': lambda: handle_direction('up'),
        'down': lambda: handle_direction('down'),
        'left': lambda: handle_direction('left'),
        'right': lambda: handle_direction('right'),
        'select': handle_select,
        'delete': handle_delete,
        'pause': handle_pause,
        'mute': handle_mute,
    }

    def dispatch(actions):
        for action in actions:
            handler = pad_actions.get(action)
            if handler is not None:
                handler()

    def handle_pad_event(event):
        # Always let the manager see the event first: it also does the hotplug
        # bookkeeping, which has nothing to do with what the modal wants.
        actions = pads.handle(event)
        panels = pads.panels(event)

        if system_menu.open:
            system_menu.feed(panels=panels, actions=actions)
        elif system_menu_armed() and 'select' in panels:
            # Free to take: the SELECT panel drives `pause`, and there is
            # nothing to pause on the menu. Everywhere else it still does.
            open_system_menu()
        else:
            dispatch(actions)

    # Desktop stand-ins for the mat, so the operator menu can be exercised with
    # no pad plugged in. Arrows navigate; the shapes sit on their initials.
    system_menu_keys = {
        pygame.K_UP: ((), ('up',)),
        pygame.K_DOWN: ((), ('down',)),
        pygame.K_x: (('cross',), ()),
        pygame.K_s: (('square',), ()),
        pygame.K_t: (('triangle',), ()),
        pygame.K_c: (('circle',), ()),
    }

    def handle_system_menu_key(event):
        # A mat enumerating as a keyboard still gets first refusal here, exactly
        # as it does outside the modal.
        panels = pads.key_panels(event)
        if panels:
            system_menu.feed(panels=panels, actions=pads.key_actions(event))
            return

        if event.key == pygame.K_ESCAPE:
            system_menu.close()
        elif event.key in (pygame.K_RETURN, pygame.K_KP_ENTER):
            # Enter stands in for whichever panel this stage is waiting on:
            # SELECT to pick an option, START to commit the reset.
            system_menu.feed(
                panels=('start' if system_menu.awaiting_confirm else 'select',),
            )
        else:
            panels, actions = system_menu_keys.get(event.key, ((), ()))
            if panels or actions:
                system_menu.feed(panels=panels, actions=actions)

    def handle_keydown(event):
        # Modal, like the name entry: while it is up it consumes every key, so
        # nothing being typed at it can reach the game behind.
        if system_menu.open:
            handle_system_menu_key(event)
            return

        # A mat that enumerates as an HID keyboard gets first refusal, so its
        # panels win over whatever those keys would otherwise mean. Only
        # populated if the mapping file actually contains `key` bindings.
        pad_bound = pads.key_actions(event)
        pad_panels = pads.key_panels(event)
        if pad_bound or pad_panels:
            if system_menu_armed() and 'select' in pad_panels:
                open_system_menu()
                return
            if pad_bound:
                dispatch(pad_bound)
                return

        # While the modal is open it consumes everything, mirroring the
        # capture-phase listener in ScoreEntry.jsx:156.
        if event.key in movement_keys:
            handle_direction(movement_keys[event.key])
        elif event.key in (pygame.K_RETURN, pygame.K_KP_ENTER):
            handle_select()
        elif event.key == pygame.K_BACKSPACE:
            handle_delete()
        elif event.key == pygame.K_ESCAPE:
            # ESC is pause during play, as in the reference (engine.js:1976).
            # On the menu there is nothing to pause and no browser chrome to
            # close the window with, so it quits (§10).
            if coordinator.state == STATE_PLAYING and not score_entry.open:
                coordinator.handle_pause_key()
            elif not score_entry.open:
                quit_game()
        elif event.key == pygame.K_q:
            if event.mod & pygame.KMOD_CTRL:
                quit_game()
            else:
                handle_mute()
        elif event.key == pygame.K_F10:
            quit_game()
        elif event.key == pygame.K_F1:
            coordinator.show_fps = not coordinator.show_fps
        elif event.key == pygame.K_r and event.mod & pygame.KMOD_CTRL:
            # Desktop stand-in for the SELECT panel on the mat.
            if system_menu_armed():
                open_system_menu()

    def update(elapsed_ms):
        coordinator.update(elapsed_ms)

    def render(interp):
        renderer.clear()

        if coordinator.state == STATE_PLAYING:
            coordinator.render(interp)
            hud.draw(coordinator, engine.fps)
            if coordinator.paused_display:
                hud.draw_pause_overlay()
        else:
            menu.draw(state['ui_clock_ms'])
            if coordinator.show_fps:
                hud.draw_fps(engine.fps)

        if score_entry.open:
            score_entry.draw(state['ui_clock_ms'])

        if system_menu.open:
            system_menu.draw(state['ui_clock_ms'])

        if logical is not window:
            pygame.transform.scale(logical, window.get_size(), window)

        pygame.display.flip()

    engine = GameEngine(update, render)
    clock = pygame.time.Clock()

    while state['running']:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                quit_game()
            elif event.type == pygame.KEYDOWN:
                handle_keydown(event)
            elif event.type in GamepadManager.EVENT_TYPES:
                # Includes the hotplug events, so a pad plugged in after launch
                # starts working without a restart.
                handle_pad_event(event)

        frame_ms = clock.tick(C.RENDER_FPS)
        state['ui_clock_ms'] += frame_ms
        coordinator.tick_realtime(frame_ms)

        # Wall-clock, not simulation time: the game is not simulating behind the
        # operator menu, so its idle timeout cannot be driven from the engine.
        if system_menu.open:
            system_menu.tick(frame_ms)

        if coordinator.state == STATE_PLAYING and coordinator.running:
            engine.tick(frame_ms)
        else:
            # Nothing to simulate on the menu or while paused, but the frame
            # still has to be drawn. Timers are driven by simulation time, so
            # they freeze here exactly as the reference's did when it stopped
            # its animation-frame loop (engine.js:2601).
            engine.track_fps(frame_ms)
            render(1.0)

    pygame.quit()
    return 0


if __name__ == '__main__':
    sys.exit(main())
