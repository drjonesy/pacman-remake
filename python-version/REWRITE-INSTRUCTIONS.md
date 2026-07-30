# Pygame Rewrite — Build Instructions

Instructions for Claude to port the Node/React version of this game to a native
Python + pygame application.

**Read this whole file before writing any code.** Every number in it was extracted
from the existing implementation — do not substitute values from a generic
Pac-Man tutorial or from memory of the arcade original. Where this codebase
deviates from the 1980 arcade game (and it does, in several places), the
codebase wins.

---

## 1. Goal and motivation

The reference implementation lives in `../node-version/`. It is a React + Vite
app wrapping a vanilla-JS engine that renders to a `<canvas>` in the browser.

The target is a **native pygame app** that runs on a **Raspberry Pi 4B+ (4GB)**.

The entire point of this rewrite is to **eliminate Chromium**. That browser is the
actual resource cost on the Pi — 300–600MB resident, plus a GPU/compositor
pipeline the game does not need. Node itself was never the bottleneck; it only
served 1.1MB of static files and three tiny JSON endpoints. If a decision in this
port trades a small amount of fidelity for staying off the browser, take it.

Success criteria, in priority order:

1. Runs at a locked 60 FPS on a Pi 4B+ with no frame pacing artifacts.
2. Total resident memory well under 150MB.
3. Gameplay is faithful to `../node-version/src/game/engine.js` — same ghost AI,
   same speeds, same timings, same scoring.
4. No Node, npm, pnpm, or `node_modules` anywhere in the runtime path.
5. Starts from a cold boot to playable in a few seconds (it may end up as a
   kiosk-mode autostart).

---

## 2. Source material

Read these before starting. Sizes are a guide to where the substance is.

| File | Lines | What to take from it |
|---|---|---|
| `../node-version/src/game/engine.js` | 3,393 | **Everything.** All eight classes. This is the port target. |
| `../node-version/src/game/renderer.js` | 168 | Canvas draw abstraction — informs the pygame blit layer |
| `../node-version/server/leaderboard.js` | 106 | High-score rules; port semantics exactly (§9) |
| `../node-version/src/components/Game.jsx` | ~150 | The DOM/UI chrome the engine expects; becomes pygame-drawn UI |
| `../node-version/src/components/ScoreEntry.jsx` | — | Arcade name-entry modal behavior |
| `../node-version/src/components/Leaderboard.jsx` | — | Top-3 display on the menu |
| `../node-version/src/styles/*.css` | ~3 files | Colors, fonts, layout proportions |

`engine.js` contains eight classes: `Ghost`, `Pacman`, `GameCoordinator`,
`GameEngine`, `Pickup`, `CharacterUtil`, `SoundManager`, `Timer`.

**The comments in `engine.js` are load-bearing.** Several document non-obvious
bugs that were already found and fixed. Read them rather than skimming to the
code. The `maxFps` comment at `engine.js:1163` is the most important one in the
file — see §5.

---

## 3. Critical constraint: the fixed timestep

This is the single highest-risk part of the port. Get it right first.

The JS engine runs a **fixed simulation rate of 120 steps/second**, decoupled
from rendering. `GameEngine` (`engine.js:2516`) draws once per animation frame
and drains `1000/maxFps` millisecond physics steps per frame.

`this.maxFps = 120` is **not** a render rate and **must not be lowered**. The
verbatim reasoning from `engine.js:1156-1163`:

> the ghost-house handoff matches on exact positions and windows only 0.2 tiles
> wide (see `enteringGhostHouse` / `leavingGhostHouse`), and at 60 the eyes of an
> eaten ghost move 0.37 tiles per step and skip straight over them, so they never
> re-enter the house and the ghost never respawns.

Concretely, those windows are:

```
enteringGhostHouse:  mode == 'eyes' and position.y == 11   and 13.4 < position.x < 13.6
leavingGhostHouse:   mode != 'eyes' and position.x == 13.5 and 10.8 < position.y < 11
enteredGhostHouse:   mode == 'eyes' and (see engine.js:566)
```

An eaten ghost travels at `eyeSpeed = pacmanSpeed * 2`. At 120Hz it steps ~0.18
tiles and lands inside the 0.2-tile window. At 60Hz it steps ~0.37 tiles and
jumps clean over it. The ghost then circles forever and never respawns.

**Requirements for the pygame port:**

- Simulate at a fixed **120 Hz**, render at **60 Hz**. Do not fuse them.
- Use an accumulator loop, not `clock.tick(120)`:

```python
SIM_HZ = 120
SIM_DT_MS = 1000.0 / SIM_HZ   # 8.333...
MAX_STEPS_PER_FRAME = 10      # clamp so a stall can't trigger a death spiral

accumulator = 0.0
while running:
    frame_ms = clock.tick(60)
    accumulator += frame_ms
    steps = 0
    while accumulator >= SIM_DT_MS and steps < MAX_STEPS_PER_FRAME:
        update(SIM_DT_MS)
        accumulator -= SIM_DT_MS
        steps += 1
    if steps == MAX_STEPS_PER_FRAME:
        accumulator = 0.0   # drop the backlog rather than compounding it
    render()
```

- Every speed stays in **units per millisecond** (§6) and gets multiplied by
  `SIM_DT_MS`. Do not convert to per-frame or per-second units — the ghost-house
  windows depend on the exact per-step distance.
- **Prefer float tolerance over equality.** The JS code relies on `position.x ==
  13.5` exactly, which works only because `snapToGrid` writes the value. Port
  `snapToGrid` faithfully, but make the comparisons tolerance-based
  (`abs(x - 13.5) < 1e-6`) so float drift cannot break respawn.
- **Write a test for this before building the rest.** Simulate an eaten ghost from
  each of the four corners to the ghost house and assert it respawns. It is the
  bug most likely to silently reappear.

If 120Hz simulation proves too expensive on the Pi (measure — it probably is not,
this is ~30 entities of trivial math), the fix is to widen the ghost-house
windows and make the handoff a zone test rather than a position match. Do **not**
just lower the rate.

---

## 4. Proposed module layout

Mirror the JS class boundaries. It makes cross-checking against the reference
straightforward, which matters more here than a tidier design.

```
python-version/
├── REWRITE-INSTRUCTIONS.md   # this file
├── main.py                   # entry point, arg parsing, window setup
├── requirements.txt          # pygame-ce only
├── pacman/
│   ├── __init__.py
│   ├── constants.py          # every literal from §5–§8, one place
│   ├── maze.py               # maze array, tile queries, dot placement
│   ├── characters/
│   │   ├── pacman.py         # Pacman class
│   │   └── ghost.py          # Ghost class (all four, name-parameterized)
│   ├── pickup.py             # Pickup: pacdot | powerPellet | fruit
│   ├── coordinator.py        # GameCoordinator — game state machine
│   ├── engine.py             # fixed-timestep loop (§3)
│   ├── character_util.py     # grid math, snapToGrid, turning, tunnel wrap
│   ├── sound.py              # SoundManager
│   ├── timers.py             # Timer — pausable, mirrors engine.js:3340
│   ├── renderer.py           # sprite cache + blit layer
│   ├── leaderboard.py        # JSON-file high scores (§9)
│   └── ui/
│       ├── menu.py           # title screen + top-3 leaderboard
│       ├── hud.py            # score, high score, lives, fruit row
│       └── score_entry.py    # arcade name entry
├── assets/                   # converted from ../node-version/public/app/style
│   ├── sprites/
│   └── audio/
└── data/
    └── data.json             # {"scores": []}
```

Keep `constants.py` exhaustive and comment each value with its `engine.js` line
number. Future-you will want to diff against the reference.

---

## 5. Board geometry

- Grid: **28 columns × 31 rows** (`MAZE_COLUMNS`, `MAZE_ROWS` at `engine.js:13-14`).
- Base `tileSize = 4`, multiplied by a runtime `scale`.
- The vertical budget is **not** just the maze. From `engine.js:15-18`:

```
SCORE_ROW_TILES  = 3
SCORE_GAP_TILES  = 1
MAZE_ROWS        = 31
BOTTOM_ROW_TILES = 2
TOTAL_UI_TILES   = 3 + 1 + 31 + 2 = 37
```

There is a fixed comment at `engine.js:1275-1279` warning that measuring only the
maze picks a scale ~18% too large and clips the score and lives rows. Budget all
37 tile-rows.

Copy `mazeArray` verbatim from `engine.js:1204-1235`. Legend:

| Char | Meaning |
|---|---|
| `X` | wall |
| `o` | pac-dot |
| `O` | power pellet (4 total, at rows 3 and 23) |
| ` ` | open, no pickup |

Verified counts: **240 pac-dots + 4 power pellets = 244 pickups**. `remainingDots`
counts **both** types (`engine.js:1713`), so it starts at **244** and the §8
thresholds are all relative to that. Assert this at load time.

Pickup point values (`engine.js:1705-1706`): pac-dot **10**, power pellet **50**.

**Pickup sub-tile offsets** (`engine.js:2694-2700`) — dots are not tile-centered:

```
pacdot:  size = scaledTileSize * 0.25
         x = column * scaledTileSize + (scaledTileSize / 8) * 3
         y = row    * scaledTileSize + (scaledTileSize / 8) * 3
```

The `determineScale` comment at `engine.js:1301` notes scale is rounded down to a
half step so `scaledTileSize` stays an even pixel count — otherwise these
eighth-tile offsets land on fractional pixels. Preserve that.

For pygame: pick an integer scale at startup from the display resolution and keep
it fixed. Do not implement live window resizing; on a Pi this will run fullscreen
at one resolution.

---

## 6. Speeds

All speeds are **per millisecond**. Base (`engine.js:952-956`):

```python
# Pacman moved at 11 tiles per second in the original game.
pacman_velocity_per_ms = (scaled_tile_size * 11) / 1000
```

Ghost speeds derive from Pacman's and scale with level
(`engine.js:93-107`), where `level_adjustment = level / 100`:

| Speed | Formula |
|---|---|
| `slow_speed` | `pacman_speed * (0.75 + level_adjustment)` |
| `medium_speed` | `pacman_speed * (0.875 + level_adjustment)` |
| `fast_speed` | `pacman_speed * (1.0 + level_adjustment)` |
| `scared_speed` | `pacman_speed * 0.5` |
| `transition_speed` | `pacman_speed * 0.4` |
| `eye_speed` | `pacman_speed * 2` |

`default_speed` starts at `slow_speed` and only changes via Blinky's Cruise Elroy
escalation (§8). Ghosts are **2×2 tiles** (`measurement = scaledTileSize * 2`,
`engine.js:751`).

---

## 7. Ghost AI

Port this exactly. It is the part players feel.

### Starting positions and directions

From `engine.js:759-790` and `engine.js:112-124`. Positions are in tile units,
`(left, top)`:

| Ghost | left | top | Default direction |
|---|---|---|---|
| blinky | 13 | 10.5 | left |
| pinky | 13 | 13.5 | down |
| inky | 11 | 13.5 | up |
| clyde | 15 | 13.5 | up |

Every ghost except Blinky starts with `idleMode = 'idle'` (`engine.js:82-84`).
Blinky begins on the board.

### Scatter targets (`engine.js:385-399`)

| Ghost | Target tile |
|---|---|
| blinky | `(27, 0)` — **but** `pacman_grid_position` if Cruise Elroy is active |
| pinky | `(0, 0)` |
| inky | `(27, 30)` |
| clyde | `(0, 30)` |

That Blinky exception is deliberate: in Elroy form he chases even during scatter.

### Chase targets (`engine.js:401-414`)

- **blinky** → Pacman's grid position.
- **pinky** → 4 tiles ahead of Pacman (`determinePinkyTarget`, `engine.js:327`).
- **inky** → Blinky's position mirrored through a pivot 2 tiles ahead of Pacman
  (`engine.js:340-351`):
  ```
  pivot = position_in_front_of_pacman(pacman_pos, 2)
  target = (pivot.x + (pivot.x - blinky.x), pivot.y + (pivot.y - blinky.y))
  ```
- **clyde** → Pacman if Euclidean distance > 8 tiles, else `(0, 30)`
  (`engine.js:360-363`).

**Note on `getPositionInFrontOfPacman` (`engine.js:310-320`):** it offsets a
single axis based on Pacman's facing — `y` for up/down, `x` for left/right,
negative for up/left. It does **not** reproduce the arcade's famous "Pinky
up-target overflow" bug. Do not add that bug back in; match this code.

### Other modes

- `eyes` (eaten, returning home) → target `(13.5, 10)` (`engine.js:376`).
- `scared` → target is Pacman's position, but movement **maximizes** distance
  instead of minimizing it. In `determineBestMove` (`engine.js:426-445`),
  `bestDistance` initializes to `0` for scared and `Infinity` otherwise, and the
  comparison flips. Port both halves — a single sign error here makes scared
  ghosts hunt you.

### Movement rules

- Distance is Euclidean (`calculateDistance`).
- At a junction, evaluate all legal moves and pick the best by the rule above.
- With exactly one legal move, take it (dead ends / corridors).
- Ghosts cannot reverse direction except on a forced mode change
  (`engine.js:694-710`) — and **not** while Cruise Elroy is active.
- Handle the horizontal tunnel wrap at row 14 for all characters.

---

## 8. Game rules, scoring, timings

### Lives and scoring

- Start with **`lives = 2`** (`engine.js:1580`) — i.e. 3 total attempts.
- Extra life at **10,000 points**, once only, plays `extra_life`
  (`engine.js:2038-2041`).
- Ghost combo: `100 * (2 ** ghost_combo)` → 200/400/800/1600 within one pellet
  (`engine.js:2358`). `ghost_combo` resets to 0 on each `powerUp()`.
- Eating a ghost pauses movement for **1000ms** (`engine.js:2367`).

### Fruit (`engine.js:1197-1206`, `engine.js:2186-2192`)

Points by level; level 9+ falls through to 5000:

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Points | 100 | 300 | 500 | 700 | 1000 | 2000 | 3000 | 5000 |

Sprite by point value (`engine.js:2666-2675`): 100 cherry, 300 strawberry,
500 orange, 700 apple, 1000 melon, 2000 galaxian, 3000 bell, 5000 key.

Fruit spawns when `remainingDots` hits **174** or **74**, and lives for
**10,000ms** (`engine.js:2171-2173`, `engine.js:2190`).

### Cruise Elroy (`engine.js:2175-2177`, `engine.js:756-767`)

Blinky speeds up when `remainingDots` hits **40** or **20**. Each `speedUp()`
promotes `default_speed` one rung: `slow → medium → fast`, and sets
`cruise_elroy = True`. Reset on level advance / death via `resetDefaultSpeed()`.

Elroy also changes his sprite — `blinky_*_annoyed.svg` and `blinky_*_angry.svg`
exist for the two tiers. Wire those up.

### Scatter / chase cycle (`engine.js:1899-1910`)

```
scatter: 7000 ms   →   chase: 20000 ms   →   repeat
```

The cycle starts in `scatter` (`engine.js:1848`).

### Ghost idle release (`engine.js:1920`)

```python
delay = max((8 - (level - 1) * 4) * 1000, 0)
```

Level 1 → 8000ms, level 2 → 4000ms, level 3+ → 0.

### Power pellet duration (`engine.js:2350`)

```python
power_duration = max((7 - level) * 1000, 0)
```

Level 7+ → pellets grant points and the combo reset, but no scared window.

After that expires, `flashGhosts(0, 9)` runs: **9 flashes, 250ms apart**
(`engine.js:2306-2322`), toggling `scared_blue` / `scared_white`, then
`endScared()`. Eating a ghost mid-window **pauses** the flash timer — hence §10's
pausable timers.

### Level start / death / advance timings

- Game start countdown: **4500ms** first game, **2000ms** after
  (`engine.js:1827`).
- Death: 750ms freeze → death animation + `death` sound → 2250ms → maze cover →
  500ms → reset and restart (`engine.js:2093-2121`).
- Game over: 2250ms → GAME_OVER text for 4000ms → 2500ms → covers slide → 1000ms
  → menu (`engine.js:2138-2160`).
- Level advance: maze flashes via `MAZE_FLASH_TINT = '#fff'`, alternating
  (`engine.js:2245-2260`).

There is a comment at `engine.js:2071` about guarding against losing multiple
lives from a single death. Keep whatever guard flag that refers to
(`deathInProgress`).

### Siren ambience (`engine.js:2211-2223`)

```
remainingDots > 40  → siren_1
remainingDots > 20  → siren_2
otherwise           → siren_3
```

Refreshed on dot-eaten, on scared-end, and on level start — but only when
`scaredGhosts` and `eyeGhosts` are both empty (`engine.js:2201`).

---

## 9. High scores

Port `../node-version/server/leaderboard.js` to `pacman/leaderboard.py`. **No web
server** — the pygame app reads and writes the file directly. Keep the on-disk
format identical so `data/data.json` is interchangeable between versions:

```json
{ "scores": [{ "name": "RYAN", "score": 4200 }] }
```

Rules to match exactly:

- `MAX_ENTRIES = 3`, `MAX_NAME_LENGTH = 12`.
- Missing **or corrupt** file → empty leaderboard, never an error. The game must
  always be playable.
- Accept either a bare array or `{"scores": [...]}` on read.
- Filter to finite scores `> 0`; sort descending; slice to 3.
- Ties keep the **existing** holder ahead of the newcomer — Python's `sort` is
  stable, matching the JS behavior, so append the newcomer then sort.
- Empty/blank name → `"AAA"`.
- Write atomically: temp file then `os.replace` (atomic on POSIX). The JS version
  does temp-write-then-rename for exactly this reason — a crash mid-write must
  never leave a half-written `data.json`. **This matters more on a Pi**, where
  yanking power is the normal way to turn it off.
- Emit integers (`4200`, not `4200.0`) so the JSON matches.
- Provide a `--reset` flag equivalent to `npm run reset`.

The HUD's HIGH SCORE readout mirrors first place (`engine.js:1264-1272`), and
must refresh after a new name is saved.

Name entry (`ScoreEntry.jsx`): opens on game over when the score beats an entry
or a slot is empty. Arcade-style — cycle letters, confirm. Read that component
for the interaction before designing the pygame version.

---

## 10. Subsystems needing care

### Timers (`engine.js:3340`)

`Timer` is a **pausable** `setTimeout`. Pausing the game pauses every active
timer; eating a ghost pauses the flash, cycle, and fruit timers specifically
(`engine.js:2369-2372`). A plain `pygame.time.set_timer` will not do — implement
a timer manager driven by simulation time (not wall-clock), holding
`(remaining_ms, callback, paused)`. Ticking it from the fixed-step update keeps
timers consistent with physics for free.

`GameCoordinator` keeps an `activeTimers` collection and a `removeTimer` helper.
Port both; several code paths cancel timers by reference.

### Sound

12 MP3s in `../node-version/public/app/style/audio/`. Two categories:

- **One-shots:** `death`, `eat_ghost`, `extra_life`, `fruit`, `game_start`,
  `pause`, `power_up`, `dot_1`, `dot_2`.
- **Looping ambience:** `siren_1`, `siren_2`, `siren_3`, `pause_beat`, `eyes`.
  `setAmbience` swaps the loop; `stopAmbience` halts it.

Dot sounds **alternate** `dot_1` / `dot_2` on each dot (`playDotSound`).

Convert MP3 → **OGG Vorbis** for the port. `pygame.mixer` MP3 support depends on
the SDL build and is a common source of Pi-specific breakage; OGG is reliable.
Use a dedicated `pygame.mixer.Channel` for ambience so one-shots never cut it
off, and pre-init the mixer with a small buffer before `pygame.init()` to avoid
audio latency:

```python
pygame.mixer.pre_init(frequency=44100, size=-16, channels=2, buffer=512)
```

If audio underruns on the Pi, raise the buffer to 1024 before touching anything
else.

### Sprites — the biggest asset problem

The reference uses **~50 SVGs**, and each character SVG is a horizontal
**animation sprite sheet**. pygame cannot load SVG directly.

Frame counts and rates differ per character — do not use one value for all:

| Character | `spriteFrames` | `msBetweenSprites` | Loops | Source |
|---|---|---|---|---|
| Ghosts (all) | 2 | 250 | yes | `engine.js:139-141` |
| Pacman (moving) | 4 | 50 | yes | `engine.js:920-922` |
| Pacman (death) | 12 | 125 | **no** | `engine.js:978-979` |

The death animation is a one-shot 12-frame sheet triggered by
`prepDeathAnimation()`, which also swaps in `pacman_death.svg`. Frame advance
logic is at `engine.js:3123-3129`.

Do a **build-time conversion**, never runtime rasterization:

1. Write `tools/convert_assets.py`, run **on the Mac, not the Pi**.
2. Rasterize each SVG to PNG at the exact final pixel size for the chosen scale
   (`cairosvg`, or `rsvg-convert` via subprocess).
3. Slice each sheet into individual frames and write a small JSON manifest
   (frame count, size, per-direction offsets).
4. Commit the PNGs. The Pi loads PNGs only — no `cairosvg` dependency there.

Then in `renderer.py`, load every PNG once into a dict at startup and call
`.convert_alpha()` on each. Blitting an unconverted surface every frame is one of
the few genuinely slow things you can do in pygame.

Inventory to convert:
- Pacman: 4 directions + death + error + 4 arrow sprites
- Blinky: 4 directions × 3 states (normal, annoyed, angry) = 12
- Pinky / Inky / Clyde: 4 directions each = 12
- Shared ghost: `eyes_{up,down,left,right}`, `scared_blue`, `scared_white`
- Maze: `maze_blue.svg`
- Pickups: `pacdot`, `powerPellet`, 8 fruits
- Text: `ready`, `game_over`, and 12 point-value sprites (100–5000)
- Chrome: `backdrop.png`, `pacman_logo.png`, `extra_life.svg`

The point-value sprites are pre-rendered images, not text. Either convert them or
render equivalents with a bitmap font — but match the sizes and 2000ms display
duration (`engine.js:2055`).

### Rendering strategy

The maze is static. Render it **once** to a `Surface` at startup and blit that
surface each frame — never redraw maze geometry per frame.

Per frame, draw in this order:
1. Cached maze surface
2. Visible pickups (see the `nearbyPickups` optimization below)
3. Fruit
4. Pacman, then ghosts
5. Text overlays (`textOverlays`, READY, point popups)
6. HUD: score, high score, lives, fruit row
7. Maze cover / tint during death and level-advance flashes

`engine.js:1750` computes `maxDistance = pacman.velocityPerMs * 750` and keeps a
`nearbyPickups` list so collision checks only consider pickups Pacman could
plausibly reach. Port that — it is a real win with ~240 pickups on screen.

On the Pi, use hardware-accelerated flips where available and consider
`pygame.SCALED` with `vsync=1`. Measure before adding complexity.

### Input

`engine.js:1173-1186` maps WASD and arrow keys. Also port:
- Pause toggle, sound toggle.
- Enter to start from the menu (`Game.jsx` handles this; the modal swallows
  Enter in the capture phase so it cannot start a game while name entry is open).
- **Drop entirely:** the on-screen d-pad, `PORTRAIT_CONTROLS_FRACTION`, and all
  touch handling. There is no touchscreen and no portrait layout.
- **Add:** Escape or a gamepad button to quit — there is no browser chrome to
  close the window with in fullscreen kiosk mode.

Preserve Pacman's `desiredDirection` buffering (`engine.js:1008-1044`) — a turn
pressed slightly before a junction still registers. It is a large part of how the
controls feel, and it is easy to lose in a port.

---

## 11. What to drop

Do not port these. They exist only because the original was a web app:

- React, Vite, JSX, all CSS.
- `server/` — the Vite plugin and HTTP leaderboard API (§9 replaces it).
- `window.dispatchEvent` / `CustomEvent` messaging (`gameOver`, `eatGhost`,
  `restoreGhost`, `leaderboardUpdated`, `awardPoints`, `dotEaten`). Replace with
  direct method calls or a small internal pub/sub. Keep the **names** as method
  names so the reference stays greppable.
- `document.getElementById` DOM wiring in the `GameCoordinator` constructor
  (`engine.js:1139-1156`).
- Asset preloading and the loading-bar screen — local PNG loads are instant.
- `determineScale`'s viewport/resize logic — pick a scale at startup.
- The FPS counter is worth **keeping** as a debug toggle; it is the fastest way
  to check Pi performance.

---

## 12. Build order

Each phase should end somewhere runnable and verifiable. Do not proceed on a
broken phase.

1. **Skeleton + fixed timestep.** `main.py`, window, the §3 accumulator loop, FPS
   counter. Verify a locked 60 FPS render / 120 Hz sim with a moving test rect.
2. **Asset conversion.** `tools/convert_assets.py` on the Mac. Produce PNGs plus
   manifest. Verify every sprite in §10's inventory exists and loads.
3. **Maze + rendering.** Port `mazeArray`, build the cached maze surface, place
   pickups with the eighth-tile offsets from §5. Assert the dot count.
4. **Pacman.** Movement, `desiredDirection` buffering, `snapToGrid`, tunnel wrap,
   animation, dot eating and scoring. Playable with no ghosts.
5. **Ghosts.** One at a time: Blinky, Pinky, Inky, Clyde. After each, verify its
   targeting against §7 by observation. Then idle release, scatter/chase cycling,
   collisions.
6. **Ghost house.** Eaten → eyes → return → respawn. **Write the §3 regression
   test here.** Verify from all four corners.
7. **Power pellets.** Scared mode, inverted distance rule, combos, the 9-flash
   warning, timer pausing on ghost-eat.
8. **Fruit, Cruise Elroy, extra life, level advance.** All the §8 thresholds.
9. **Audio.** OGG conversion, one-shots, ambience channel, siren switching,
   alternating dot sounds.
10. **UI.** Menu, HUD, READY / GAME OVER, point popups, pause, leaderboard
    display, name entry.
11. **Leaderboard.** §9, with the atomicity and corrupt-file behavior.
12. **Pi validation.** Deploy, measure FPS and RSS, tune. Only now consider
    fullscreen/kiosk autostart.

---

## 13. Testing

The `pytest` suite should cover the logic that is easy to break and hard to spot:

- **Ghost-house respawn** at 120Hz from all four corners (§3). Non-negotiable.
- Ghost targeting: table-driven cases per ghost per mode against §7, including
  Inky's mirror math and Clyde's 8-tile flip.
- Scared-mode distance inversion actually flees.
- Leaderboard: empty, partial, full, tie-keeps-incumbent, over-long name, blank
  name, corrupt JSON, bare-array format, atomic write.
- Speed formulas across several levels (§6).
- Dot-count thresholds fire fruit (174/74) and Elroy (40/20) exactly once each.
- Power duration and idle-release formulas, including the level ranges where they
  clamp to 0.
- Maze integrity: dot count, 4 power pellets, walls enclose the board, the tunnel
  row is passable.

Game loop and rendering do not need unit tests — verify those by playing.

---

## 14. Dependencies

Keep this at exactly one runtime dependency:

```
pygame-ce>=2.4
```

Prefer `pygame-ce` over `pygame` — it is the actively maintained fork with better
ARM/Pi support. On Raspberry Pi OS, `sudo apt install python3-pygame` may pull an
old version; `pip install pygame-ce` in a venv is usually better, but verify SDL
picks up hardware acceleration either way.

Build-time only, on the Mac, never installed on the Pi: `cairosvg` (or
`librsvg`), and `ffmpeg` for MP3 → OGG.

Target the Python 3 that ships with current Raspberry Pi OS — check the actual
version on the device before using recent syntax.

---

## 15. Open questions

Resolve these with the user before or during the phase that needs them; do not
guess:

1. **Display**: fullscreen at the Pi's native resolution, or a fixed window? Affects §5 scale choice.
2. **Kiosk mode**: should this autostart on boot into the game? Changes packaging.
3. **Controls**: keyboard only, or should a USB gamepad / arcade encoder be supported?
4. **Node version**: keep `../node-version/` as-is indefinitely, or retire it once this works? Determines whether `data.json` compatibility (§9) actually matters.
5. **Fidelity vs. performance**: if 120Hz sim will not hold on the Pi, is widening the ghost-house windows acceptable? (It is the right fix; confirm the user agrees before changing gameplay-adjacent behavior.)
