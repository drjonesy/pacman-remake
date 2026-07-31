# Pac-Man — pygame port

A native Python + pygame port of the React/Vite version in [`../node-version/`](../node-version/),
built to run on a Raspberry Pi 4B+ without Chromium.

The gameplay is a direct port of [`../node-version/src/game/engine.js`](../node-version/src/game/engine.js) —
same ghost AI, same speeds, same timings, same scoring. Every constant is
annotated with the `engine.js` line it came from so the two can be diffed.

## Quick start

```bash
cd python-version
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

.venv/bin/python main.py                    # fullscreen
.venv/bin/python main.py --windowed         # windowed, 3x (desktop testing)
```

The only runtime dependency is `pygame-ce`. There is no Node, npm, pnpm, or
`node_modules` anywhere in the runtime path, and no network access is needed.

### Options

| Flag | Effect |
|---|---|
| `--windowed` | Run in a window instead of fullscreen |
| `--scale N` | Integer upscale for `--windowed` (default 3) |
| `--fps` | Show the FPS counter from the start (also `F1` in game) |
| `--no-sound` | Disable audio entirely |
| `--audio-buffer N` | Mixer buffer size (default 512; raise to 1024 if audio underruns) |
| `--data-file PATH` | Leaderboard JSON location |
| `--pad-mapping PATH` | Gamepad / dance-pad binding table (default `data/pad_mapping.json`) |
| `--reset` | Clear the leaderboard and exit (equivalent to `npm run reset`) |

## Controls

| Input | Action |
|---|---|
| **WASD** / **arrow keys** | Move (and navigate the name-entry keyboard) |
| **Enter** | Start a game / select a key during name entry |
| **Backspace** | Delete a character during name entry |
| **Esc** | Pause during play — **quit** from the menu |
| **Q** | Toggle sound |
| **F1** | Toggle the FPS counter |
| **F10** / **Ctrl-Q** | Quit from anywhere |
| **Ctrl-R** | Open the operator menu from the main menu (see below) |

Turn buffering is preserved: a direction pressed slightly *before* a junction
still registers when you reach it. It is a large part of how the controls feel.

### Dance pad / gamepad / arcade encoder

A USB pad is picked up automatically, including one plugged in *after* launch.
Everything it can do is expressed as **direction + select + delete + pause +
mute**, so a DDR mat, a gamepad and an arcade encoder all use the same code
path.

No single panel press can quit, pause the cabinet permanently, or touch the
leaderboard — the destructive things live behind the operator menu below.

#### The operator menu (SELECT + START)

A cabinet has no keyboard, so clearing the leaderboard or shutting the game down
used to mean SSHing into the Pi. Press **SELECT and START together on the main
menu** and a short list appears:

| Option | Effect |
|---|---|
| **RESET SCORES** | Wipes the leaderboard — gated behind a code, below |
| **EXIT GAME** | Closes the game |
| **CANCEL** | Backs out |

Navigate with the **up/down arrow panels** and choose with **SELECT**. It is only
reachable from the main menu, so it can never interrupt a run, and it closes
itself after 20 seconds of inactivity.

Choosing RESET SCORES asks for a code on the four shape panels, in this order:

> **✕ → ▢ → △ → ○**, then **START** to confirm.

Any wrong panel restarts the code, and SELECT backs out at any point. Nothing is
written until START is pressed on the confirm screen.

Two details worth knowing if you change this:

* The combo and the code are read as **physical panels**, not as the eight
  actions the rest of the game uses. On the measured mat the shapes are already
  aliased to mute/pause/delete/select, so reading actions instead would toggle
  mute and pause the game while the code was being entered. The panel table is
  `panels` in `data/pad_mapping.json`, defaulting to the layout below.
* START is bound to the `select` action, so on the menu it starts a game. To
  stop that happening before the other half of the combo arrives, a press of
  SELECT or START on the menu is held for 250ms before it is dispatched. This
  applies **only on the menu and only to those two panels** — nothing in
  gameplay is delayed, and the circle panel still starts a game instantly.

Without a pad, **Ctrl-R** opens the same menu; inside it the arrow keys
navigate, **X / S / T / C** stand in for the four shapes, **Enter** for
SELECT and START, and **Esc** closes.

#### Calibrating a pad

Pads disagree about which button index is which control, and two mats of the
same model can disagree with each other. So the binding table is data, not code:
it lives in `data/pad_mapping.json` and is written by stepping on each panel.

**On the Pi, with the pad plugged in:**

```bash
.venv/bin/python tools/pad_report.py                 # walk all 11 panels, write a report
.venv/bin/python tools/gamepad_test.py --list        # what SDL can see
.venv/bin/python tools/gamepad_test.py               # live event monitor
.venv/bin/python tools/gamepad_test.py --calibrate   # step on each panel
```

[`tools/pad_report.py`](tools/pad_report.py) is the one to reach for first when
a pad misbehaves. It walks all eleven panels — the ten labelled ones plus the
centre — one at a time, **waiting for ENTER between each** rather than racing
ahead, so there is time to read what a panel recorded; `r` re-records it if the
step did not land. `q` stops early and still writes everything reached;
`--auto` advances unattended.

| At the prompt | |
|---|---|
| `ENTER` | next panel |
| `r` | re-record the panel just done (the old log is kept, marked superseded) |
| `q` | stop here and write the report |

It logs **every raw event** each panel produced with timestamps, and writes
`pad-report.txt` — which is shareable, and shows the things a finished mapping
hides: a panel that bounces and sends one
press three times, a panel that reports on both a hat and an axis, a switch that
latches instead of releasing, and an axis sitting at full deflection while
untouched. It writes a working `data/pad_mapping.json` as it goes, so a clean
run leaves nothing else to do. It imports nothing from `pacman/`, so it can be
copied to a Pi on its own; it needs only pygame.

`gamepad_test.py --calibrate` is the shorter path: it prompts for the eight
controls the game actually uses rather than all ten panels, and writes the same
mapping file without the raw log. For a DDR mat the prompts map to:

| Prompt | Panel | In-game |
|---|---|---|
| up / down / left / right | the four arrows | Move; navigate the name-entry keyboard |
| select | **START** | Start a game; confirm a letter |
| delete | **X** | Delete a letter during name entry |
| pause | **SELECT** | Pause during play |
| mute | **□** | Toggle sound |

It leaves `○`, `△` and the centre unbound — `pad_report.py` is the one that
covers every panel. Press ESC (or wait) at any prompt to skip it. Either way, an action
takes a *list*, so a second button can be added by hand:

```json
{
  "version": 1,
  "device": null,
  "deadzone": 0.5,
  "bindings": {
    "up":     [{ "type": "button", "button": 2 }],
    "select": [{ "type": "button", "button": 9 },
               { "type": "button", "button": 7 }]
  }
}
```

Four binding forms are understood — `button`, `hat`, `axis`, and `key` (for
mats that enumerate as an HID *keyboard* rather than a gamepad). Some mats
report one arrow on **both** a hat and an axis; both tools record both, which is
correct and not a bug.

The file is worth committing once it works — it survives a re-clone onto the Pi.

#### The measured mat

`data/pad_mapping.json` is committed, and the built-in default matches it, so
the cabinet's mat works with no setup. It is a **DragonRise / Microntek
PSX-to-USB board** (USB `0079:0006`, `Name="Microntek USB Joystick"`) wired to a
10-panel mat, and it reports **every panel as a plain button**:

| Button | Panel | Action |
|---|---|---|
| 0 | ← arrow | left |
| 1 | ↓ arrow | down |
| 2 | ↑ arrow | up |
| 3 | → arrow | right |
| 4 | □ | mute |
| 5 | △ | pause |
| 6 | ✕ | delete |
| 7 | ○ | select |
| 8 | SELECT | pause |
| 9 | START | select |

Buttons 10 and 11 exist on the board but nothing on the mat is wired to them.

**The centre of the mat is an eleventh sensor**, and it is deliberately left
unbound. It does not report as a button — stepping on it sends `axis 1 +1.0`,
and stepping off returns the axis to `0`. That is the neutral spot the player
stands on between moves, so it fires every few seconds during normal play;
anything bound to it would pause, mute or turn constantly. `pad_report.py` walks
it last, calls it out in the summary, and refuses to put that control in a
generated mapping even if another panel also reports it.

Three things about this are worth knowing, because none is what a gamepad
would do:

- **The arrows are buttons, not the hat.** The descriptor advertises a hat and
  four axes, but a PSX controller's d-pad and sticks have nothing soldered to
  them on a mat. On a PlayStation dance pad the arrow panels *are* the face
  buttons, and the corner shape panels take the shoulder indices — which is
  exactly the order above.
- **Nothing is bound to an axis.** Between the centre sensor sitting on axis 1
  and this board's habit of parking unused analogue axes at full deflection,
  an axis binding is a liability here — `axis 1 +` is precisely what a naive
  `down` binding would have picked, and it would have driven Pac-Man downward
  every time the player stood still. Hat bindings are kept so an ordinary
  gamepad or arcade encoder still works; axis bindings are not.
  [`tests/test_gamepad.py`](tests/test_gamepad.py) pins this.

A different mat will differ — calibrating replaces all of this. To confirm the
numbering independently of pygame:

```bash
sudo apt install joystick
jstest /dev/input/js0        # step on each panel and watch which index moves
```

#### When the Pi cannot see the pad at all

If `--list` prints *no devices*, the problem is below SDL. In order:

```bash
lsusb                        # is the mat enumerating at all?
ls -l /dev/input/js* /dev/input/event*
groups                       # your user must be in `input`
sudo usermod -aG input $USER # then log out and back in
sudo apt install evtest && sudo evtest    # does the kernel see the panels?
```

`cat /proc/bus/input/devices` is the quickest single check — a working mat shows
`Handlers=event5 js0` (a joystick node) and an `ABS=` line listing its axes.

Three failure modes are worth knowing:

- **`evtest` shows key presses, not joystick axes.** Some mats are HID
  keyboards — `/proc/bus/input/devices` shows no `js*` handler for them. Run
  `--calibrate` on the Pi's own screen (not over SSH — key events need a
  focused window) and it records `key` bindings instead.
- **`lsusb` shows nothing.** These mats draw little power but are fussy about
  cabling. Try the USB 2.0 ports, and a powered hub before suspecting the mat.
- **Pac-Man drifts one direction on its own.** A PSX adapter with no analogue
  stick attached can park an axis at full deflection instead of centre. Delete
  the `axis` entries from the four directions in `pad_mapping.json`. The
  committed mapping has none for exactly this reason; `pad_report.py` flags a
  stuck axis in its RESTING STATE section and leaves it out of what it
  generates.

Over SSH the tool falls back to SDL's dummy video driver, so joystick
calibration works headless; only keyboard-HID detection needs a real screen.

## Display

The game renders to a **fixed 224×296 logical surface** (28 tiles wide by 37
tall at 8px per tile) and lets `pygame.SCALED` stretch that to the display,
letterboxing as needed. That means:

- Assets rasterize 1:1 from the source SVGs — the art is authored at 8px/tile.
- Every sub-tile offset stays on a whole pixel (dots sit at 3/8 of a tile).
- There is no per-frame scaling blit in fullscreen, and no resize logic.

The 37-tile height is the *whole* UI column — score row (3), gap (1), maze (31),
lives/fruit row (2). Budgeting only the maze picks a scale ~18% too large and
clips the score and lives rows, which is a bug the reference had and fixed.

## Assets

`assets/` is generated and committed. The Pi loads PNG and OGG only — it needs
neither `cairosvg` nor `ffmpeg`.

To regenerate after changing the source art (run on a desktop, not the Pi):

```bash
.venv/bin/pip install -r requirements-dev.txt
brew install ffmpeg
.venv/bin/python tools/convert_assets.py
```

This rasterizes 68 sprites from the reference's ~50 SVGs at their exact final
pixel size, transcodes 14 MP3s to Ogg Vorbis, and writes `assets/manifest.json`
(frame counts and dimensions). Total: ~760 KB.

Ogg Vorbis rather than MP3 because SDL_mixer decodes Vorbis with a bundled
stb_vorbis on every build, so it cannot break on the Pi the way MP3 can — and
because Vorbis stores an exact sample count, so the short ambience loops
(`siren_1` is 0.39s and loops continuously) have no encoder padding to click on.
The script prefers `libvorbis` and falls back to ffmpeg's native `vorbis`
encoder, which is what Homebrew's build ships.

The UI font is a built-in 5×7 bitmap font in [`pacman/font.py`](pacman/font.py).
The web version used 'Press Start 2P' from Google Fonts, which is unavailable
offline — and at 8 logical pixels tall no outline font would be legible anyway.

## Architecture

Module boundaries mirror the JS class boundaries, which makes cross-checking
against the reference straightforward.

```
main.py                    entry point, window, input
pacman/
  gamepad.py               pad bindings -> actions (dance mat, gamepad, encoder)
  constants.py             every literal, annotated with engine.js line numbers
  engine.py                the fixed-timestep loop
  coordinator.py           GameCoordinator — the game state machine
  character_util.py        grid math, snap_to_grid, turning, tunnel warp
  characters/pacman.py     Pacman
  characters/ghost.py      Ghost (all four, name-parameterized)
  maze.py                  maze array, tile queries, integrity assertions
  pickup.py                pacdot | powerPellet | fruit
  timers.py                pausable timers driven by simulation time
  sound.py                 SoundManager
  renderer.py              sprite cache + blit layer
  font.py                  5x7 bitmap font
  leaderboard.py           JSON high scores
  ui/{menu,hud,score_entry}.py
tools/convert_assets.py    build-time SVG->PNG, MP3->OGG
tools/gamepad_test.py      pad identification + calibration
tools/pad_report.py        per-panel raw event log (standalone; pygame only)
tests/                     304 tests
```

The browser's `window.dispatchEvent` messaging is replaced by a small internal
bus ([`pacman/events.py`](pacman/events.py)), but the event **names** are kept
verbatim (`eatGhost`, `restoreGhost`, `dotEaten`, …) so grepping finds the same
call sites in both codebases.

### The one thing not to change: the 120Hz simulation rate

The simulation runs at a fixed **120 steps/second**, rendering at **60**. They
are not fused, and **the simulation rate must not be lowered.**

The ghost-house handoff matches positions inside windows only 0.2 tiles wide
(`Ghost.entering_ghost_house` / `entered_ghost_house`). An eaten ghost travels
at `pacman_speed * 2`; at 120Hz it steps ~0.183 tiles and lands inside the
window, but at 60Hz it steps ~0.367 tiles and jumps clean over it — after which
the ghost circles the maze forever and never respawns.

[`tests/test_ghost_house.py`](tests/test_ghost_house.py) pins this down: an
eaten ghost must respawn from all four corners, and there is a deliberate test
asserting that a 60Hz timestep *breaks* it. If that test ever starts passing,
the windows have been widened and the constraint can be revisited — until then,
a passing 60Hz test would mean the respawn tests had stopped proving anything.

Related: every position comparison the reference wrote as `position.x === 13.5`
goes through a tolerance helper (`character_util.approx`), so float drift cannot
break respawn. The tolerance is six orders of magnitude below the distance
covered in one step, so it can never merge two genuinely distinct positions.

## Fidelity notes

Ported faithfully even where it differs from the 1980 arcade game:

- `get_position_in_front_of_pacman` offsets a single axis and does **not**
  reproduce the arcade's "Pinky up-target overflow" bug.
- Cruise Elroy survives a death (a plain `reset()` preserves `default_speed`);
  only a level advance or a new game clears it.
- Blinky chases Pacman even during scatter once Elroy is active, and cannot be
  turned around by a mode change.
- Fractional grid lookups deliberately miss (`maze_array[11][13.5]` is
  `undefined` in JS). That is what carries an eaten ghost down into the house,
  so `get_tile` rejects non-integer indices rather than rounding them.
- Out-of-range lookups must read as "not a wall" — a negative Python index
  would wrap to the far side of the row and seal the tunnel shut.
- Text overlays draw *beneath* the characters, matching the reference's order.

### Deliberate deviations

Two, both marked in the code:

1. **New games start at level-1 ghost speeds.** `Ghost.reset` derives speeds
   from the ghost's own `level`, which the reference only ever assigned in
   `resetBoardForNextLevel` (engine.js:2288) — so starting a new game after
   reaching level 5 left the ghosts on level-5 speeds, making level 1 silently
   harder the further the previous run went. One line in
   `GameCoordinator.reset` fixes it; move it back below `reset(True)` to
   restore the original behaviour.
2. **The pause debounce is wall-clock, not a simulation timer.** The reference
   used a bare `setTimeout` here rather than its pausable `Timer`
   (engine.js:1994). Since pausing freezes the simulation in this port, a
   simulation timer would freeze the debounce too and the game could never be
   un-paused.

Dropped as web-only: React/Vite/CSS, the HTTP leaderboard API, asset preloading
and its loading bar, the on-screen d-pad and all touch handling, and
`determineScale`'s viewport/resize logic. The FPS counter was kept as a debug
toggle.

The pause blur uses a downscale/upscale pass instead of CSS `filter: blur(5px)`.

## High scores

`data/data.json` is read and written directly — no server:

```json
{ "scores": [{ "name": "RYAN", "score": 4200 }] }
```

The format is byte-for-byte compatible with the Node version, so the two can
share one file:

```bash
.venv/bin/python main.py --data-file ../node-version/data/data.json
```

Rules match `../node-version/server/leaderboard.js` exactly: top 3, 12-character
names, ties keep the incumbent ahead of the newcomer, blank names become `AAA`,
and a missing **or corrupt** file is an empty leaderboard rather than an error —
the game must always be playable.

Writes go to a temp file and are then renamed (`os.replace`, atomic on POSIX)
and fsynced first, so a crash mid-write cannot leave a half-written
`data.json`. This matters more on a Pi, where pulling the power is the normal
way to turn the machine off.

## Testing

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests/ -q
```

304 tests, all headless — no display and no audio device required. Coverage is
aimed at what is easy to break and hard to spot: ghost-house respawn at 120Hz
from all four corners, ghost targeting per ghost per mode (including Inky's
mirror math and Clyde's 8-tile flip), the scared-mode distance inversion, the
speed formulas across levels, dot thresholds firing fruit (174/74) and Elroy
(40/20) exactly once, the power-duration and idle-release clamps, timer
pause/resume precedence, maze integrity, the leaderboard's corrupt-file and
atomic-write behaviour, and pad binding resolution (a corrupt mapping file must
degrade to the default, never strand a cabinet whose only input is a mat).

The game loop and rendering are verified by playing, not by unit tests.

## Raspberry Pi deployment

**Not yet validated on hardware** — this was built and tested on macOS. §12
phase 12 of the build instructions is still open. Measured here for reference:

- Peak RSS over 30s of gameplay: **~41 MB** (target was well under 150 MB)
- Exactly 2 simulation steps per rendered frame, i.e. a true 120Hz/60fps split
- Sprite and font caches are bounded and stop growing after a few seconds

On the Pi:

```bash
sudo apt install python3-venv
python3 -m venv .venv
.venv/bin/pip install pygame-ce        # prefer this over apt's python3-pygame,
                                       # which may be an old version
.venv/bin/python main.py --fps
```

Check the FPS counter holds 60 and confirm SDL picked up hardware acceleration.
If audio underruns, raise `--audio-buffer` to 1024 before changing anything
else. If 120Hz simulation will not hold, **do not lower it** — widen the
ghost-house windows into zone tests instead, and update
`tests/test_ghost_house.py` to match.

Kiosk-mode autostart is not included; it was left until after hardware
validation.
