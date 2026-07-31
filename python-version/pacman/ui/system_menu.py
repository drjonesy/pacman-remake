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

RESET SCORES is the destructive one, so it is gated a second time behind a code
entered on the four shape panels (cross, square, triangle, circle) followed by
START. EXIT GAME just exits; there is nothing to undo.

The code is read as *physical panels* rather than the eight actions the rest of
the game sees, which is the whole reason `gamepad.PANELS` exists. On this mat
the shapes are already aliased to mute/pause/delete/select, so reading actions
instead would toggle mute and pause the game while the code was being entered.

`main.py` only offers this on the menu screen, so it can never interrupt a run.
"""

from .. import constants as C

# Panels, in the order they must be pressed, with the symbol printed on the mat.
CODE = ('cross', 'square', 'triangle', 'circle')
SYMBOLS = {
    'cross': '×', 'square': '□', 'triangle': '△', 'circle': '○',
}

OPTION_RESET = 'reset'
OPTION_EXIT = 'exit'
OPTION_CANCEL = 'cancel'

# CANCEL is not in the original sketch of this menu, but without it the popup is
# a trap: every other row either wipes the board or kills the game.
OPTIONS = (
    (OPTION_RESET, 'RESET SCORES'),
    (OPTION_EXIT, 'EXIT GAME'),
    (OPTION_CANCEL, 'CANCEL'),
)

STAGE_OPTIONS = 'options'
STAGE_CODE = 'code'
STAGE_CONFIRM = 'confirm'
STAGE_DONE = 'done'

# An unattended cabinet should not sit on this screen forever.
IDLE_TIMEOUT_MS = 20000
# How long SCORES CLEARED stays up before the menu closes itself.
DONE_MS = 1600
# How long a wrong panel flashes the code row red.
WRONG_FLASH_MS = 350

PANEL_WIDTH = 132
PANEL_HEIGHT = 18
PANEL_GAP = 4

HEADING_Y = 74
BODY_Y = 100
OPTIONS_Y = 128
HINT_Y = C.LOGICAL_HEIGHT - 40


class SystemMenu:
    """Modal state plus its own input handling, like `ScoreEntry`.

    While this is open `main.py` routes every key and panel here instead of to
    the game, so nothing behind it can be reached by the code being entered.
    """

    def __init__(self, renderer, font, leaderboard):
        self.renderer = renderer
        self.font = font
        self.leaderboard = leaderboard

        self.open = False
        self.stage = STAGE_OPTIONS
        self.index = 0
        self.progress = 0        # how much of the shape code is entered
        self.idle_ms = 0
        self.done_ms = 0
        self.wrong_ms = 0

        self.on_reset = None
        self.on_exit = None

    # -- lifecycle -----------------------------------------------------------

    def open_menu(self, on_reset=None, on_exit=None):
        self.open = True
        self.stage = STAGE_OPTIONS
        self.index = 0
        self.progress = 0
        self.idle_ms = 0
        self.done_ms = 0
        self.wrong_ms = 0
        self.on_reset = on_reset
        self.on_exit = on_exit

    def close(self):
        self.open = False
        self.stage = STAGE_OPTIONS
        self.progress = 0

    @property
    def awaiting_confirm(self):
        """True once the code is complete and only START is left.

        `main.py` reads this to decide what its Enter key stands in for when
        testing on a desktop.
        """
        return self.stage == STAGE_CONFIRM

    def tick(self, frame_ms):
        """Wall-clock bookkeeping. The game is not simulating behind this."""
        if not self.open:
            return

        if self.wrong_ms > 0:
            self.wrong_ms = max(0, self.wrong_ms - frame_ms)

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

        # Both remaining stages are part of the reset gate. SELECT backs out of
        # them rather than choosing anything, so a half-entered code is never a
        # dead end.
        if 'select' in panels:
            self.close()
            return

        if self.stage == STAGE_CONFIRM:
            if 'start' in panels:
                self._commit_reset()
            return

        for panel in CODE:
            if panel in panels:
                if panel == CODE[self.progress]:
                    self.progress += 1
                    if self.progress == len(CODE):
                        self.stage = STAGE_CONFIRM
                else:
                    # Any wrong panel restarts the code. Cheap to redo, and it
                    # means a mistyped sequence cannot half-arm the confirm.
                    self.progress = 0
                    self.wrong_ms = WRONG_FLASH_MS
                return

    def _choose(self):
        option = OPTIONS[self.index][0]
        if option == OPTION_CANCEL:
            self.close()
        elif option == OPTION_EXIT:
            self.close()
            if self.on_exit:
                self.on_exit()
        else:
            self.stage = STAGE_CODE
            self.progress = 0

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
            self.stage = STAGE_DONE
            self.done_ms = 0

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
        else:
            self._draw_code(surface, blink_ms)

    def _draw_options(self, surface):
        center = C.LOGICAL_WIDTH / 2

        self.font.draw(surface, 'SYSTEM MENU', center, HEADING_Y,
                       C.ARCADE_YELLOW, align='center')

        x = (C.LOGICAL_WIDTH - PANEL_WIDTH) / 2
        for row, (_, label) in enumerate(OPTIONS):
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

        self.font.draw(surface, 'UP DOWN MOVE  SELECT PICKS', center, HINT_Y,
                       C.ARCADE_GREY, align='center')

    def _draw_code(self, surface, blink_ms):
        center = C.LOGICAL_WIDTH / 2

        self.font.draw(surface, 'RESET HIGH SCORES', center, HEADING_Y,
                       C.ARCADE_RED, align='center')
        self.font.draw(surface, 'ENTER THE CODE', center, BODY_Y,
                       C.WHITE, align='center')

        self._draw_code_row(surface)

        if self.stage == STAGE_CONFIRM:
            # Blinking, because this is the last press before the board is gone.
            color = (C.ARCADE_YELLOW if (blink_ms % 1000) < 500
                     else C.ARCADE_DARK)
            self.font.draw(surface, 'PRESS START TO CONFIRM', center,
                           OPTIONS_Y + 40, color, align='center')

        self.font.draw(surface, 'SELECT CANCELS', center, HINT_Y,
                       C.ARCADE_GREY, align='center')

    def _draw_code_row(self, surface):
        # Sized to be legible from across a room, which is the only distance a
        # cabinet is ever read from.
        scale = 3
        cell = 36
        total = len(CODE) * cell
        start_x = (C.LOGICAL_WIDTH - total) / 2
        y = OPTIONS_Y

        for index, panel in enumerate(CODE):
            x = start_x + index * cell + cell / 2

            if self.wrong_ms > 0:
                color = C.ARCADE_RED
            elif index < self.progress:
                color = C.ARCADE_YELLOW
            else:
                color = C.ARCADE_GREY

            self.font.draw(surface, SYMBOLS[panel], x, y, color,
                           scale=scale, align='center')

    def _draw_done(self, surface):
        center = C.LOGICAL_WIDTH / 2
        self.font.draw(surface, 'SCORES CLEARED', center, BODY_Y,
                       C.ARCADE_YELLOW, align='center')

