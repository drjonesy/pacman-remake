"""The in-game control reminder.

The pause and sound controls used to be named only on the title screen, so a
player had to have memorised them by the time they were playing. They are now in
the last quarter of the score row, which is the only part of the chrome with
room: the bottom row can be occupied end to end by a full complement of lives
and seven fruit.

That corner is tight, so the widths are pinned here as well as the wording - the
dance-mat labels are nearly twice as long as the keyboard ones, and nothing in a
rendered frame would fail loudly if they started overlapping HIGH SCORE.
"""

import pygame
import pytest

from pacman import constants as C
from pacman.controls import KEYBOARD, PAD, SCHEMES, Controls
from pacman.font import BitmapFont
from pacman.ui.hud import (
    HIGH_SCORE_CENTER, HIGH_SCORE_RIGHT, HINT_RIGHT, Hud,
)

pygame.init()


class RecordingFont:
    """Captures what would be drawn, so wording is testable without a display."""

    def __init__(self):
        self.texts = []

    def draw(self, surface, text, x, y, color, scale=1, align='left'):
        self.texts.append(text)
        return (0, 7)

    def measure(self, text, scale=1):
        return ((len(text) * 6 - 1) * scale, 7 * scale)


class StubRenderer:
    def __init__(self):
        self.surface = pygame.Surface((C.LOGICAL_WIDTH, C.LOGICAL_HEIGHT))

    def draw_image_at(self, *args, **kwargs):
        pass

    def fill_rect_at(self, *args, **kwargs):
        pass


class StubSound:
    master_volume = 1


class StubCoordinator:
    """Only the attributes `Hud.draw` actually reads."""

    def __init__(self, show_fps=False):
        self.points = 1234
        self.high_score = 5678
        self.lives = 3
        self.fruit_display = []
        self.pellet_blink_ms = 0
        self.show_fps = show_fps
        self.sound_manager = StubSound()


@pytest.fixture
def hud_for():
    def build(name=KEYBOARD):
        font = RecordingFont()
        controls = Controls(name=name, path=None)
        return Hud(StubRenderer(), font, controls), font
    return build


def test_pause_and_sound_are_named_during_play(hud_for):
    hud, font = hud_for(KEYBOARD)
    hud.draw(StubCoordinator(), 60.0)

    assert 'ESC PAUSE' in font.texts
    assert 'Q SOUND' in font.texts


def test_the_hint_follows_the_pad_scheme(hud_for):
    hud, font = hud_for(PAD)
    hud.draw(StubCoordinator(), 60.0)

    assert 'SELECT PAUSE' in font.texts
    assert 'SQUARE SOUND' in font.texts
    assert 'ESC PAUSE' not in font.texts


def test_the_fps_counter_wins_the_corner(hud_for):
    """Both occupy the same place; the debug toggle is the deliberate override."""
    hud, font = hud_for(KEYBOARD)
    hud.draw(StubCoordinator(show_fps=True), 60.0)

    assert not any('PAUSE' in text for text in font.texts)


def test_the_score_row_still_draws(hud_for):
    """The hint must be an addition, not a replacement."""
    hud, font = hud_for(KEYBOARD)
    hud.draw(StubCoordinator(), 60.0)

    assert 'HIGH SCORE' in font.texts
    assert '1234' in font.texts          # points
    assert '5678' in font.texts          # high score


def test_the_one_up_blink_is_unaffected(hud_for):
    """1UP is dark for the first half of its cycle - easy to mistake for a
    regression when reading a single frame."""
    hud, font = hud_for(KEYBOARD)

    dark = StubCoordinator()
    dark.pellet_blink_ms = 0
    hud.draw(dark, 60.0)
    assert '1UP' not in font.texts

    hud, font = hud_for(KEYBOARD)
    lit = StubCoordinator()
    lit.pellet_blink_ms = C.ONE_UP_BLINK_PERIOD_MS * 0.75
    hud.draw(lit, 60.0)
    assert '1UP' in font.texts


def test_the_pause_overlay_names_the_resume_control(hud_for):
    hud, font = hud_for(PAD)
    hud.draw_pause_overlay()

    assert 'PAUSED' in font.texts
    assert any('SELECT RESUMES' in text for text in font.texts)


def test_mute_readout_survives_the_hint(hud_for):
    hud, font = hud_for(KEYBOARD)
    coordinator = StubCoordinator()
    coordinator.sound_manager.master_volume = 0
    hud.draw(coordinator, 60.0)

    assert 'MUTE' in font.texts


# -- layout ------------------------------------------------------------------

# Right-hand extent of the score row's own text, which the hint sits beyond.
HIGH_SCORE_LABEL_RIGHT = HIGH_SCORE_CENTER + (len('HIGH SCORE') * 6 - 1) / 2


@pytest.mark.parametrize('name', [KEYBOARD, PAD])
def test_the_hint_clears_the_score_row(name):
    """Nothing in a rendered frame fails loudly when text overlaps."""
    font = BitmapFont()
    scheme = SCHEMES[name]

    pause_left = HINT_RIGHT - font.measure(f'{scheme.pause} PAUSE')[0]
    sound_left = HINT_RIGHT - font.measure(f'{scheme.sound} SOUND')[0]

    assert pause_left > HIGH_SCORE_LABEL_RIGHT, 'collides with HIGH SCORE'
    # Line two carries the score itself, right-aligned at HIGH_SCORE_RIGHT.
    assert sound_left > HIGH_SCORE_RIGHT, 'collides with the high score value'


@pytest.mark.parametrize('name', [KEYBOARD, PAD])
def test_the_hint_stays_on_screen(name):
    font = BitmapFont()
    scheme = SCHEMES[name]

    for text in (f'{scheme.pause} PAUSE', f'{scheme.sound} SOUND'):
        assert HINT_RIGHT - font.measure(text)[0] >= 0
        assert HINT_RIGHT <= C.LOGICAL_WIDTH


@pytest.mark.parametrize('name', [KEYBOARD, PAD])
def test_the_pause_overlay_line_fits(name):
    font = BitmapFont()
    scheme = SCHEMES[name]
    text = f'{scheme.pause} RESUMES   {scheme.sound} SOUND'

    assert font.measure(text)[0] <= C.LOGICAL_WIDTH
