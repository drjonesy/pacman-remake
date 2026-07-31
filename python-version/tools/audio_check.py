#!/usr/bin/env python3
"""Find an SDL audio driver that reaches the TV. Run this on the Pi.

Companion to `gamepad_test.py`: the same problem, for the other half of the
cabinet's hardware.

**Confirm the Pi plays sound at all before running this** - `speaker-test -t wav
-c 2 -l 1`, or any video. If nothing plays either, the game is not involved and
the Pi is pointed at the wrong output (the AV jack rather than HDMI is the usual
culprit, and has been the real cause every time so far). This tool cannot detect
that: a disconnected jack accepts audio perfectly happily.

Past that, "no sound from the game but everything else plays fine" is usually
routing rather than the game - SDL picks its own audio driver, and the one it
picks may not be the one the desktop uses. On a Pi whose system audio goes out
over HDMI through PipeWire, SDL can still choose raw ALSA, and raw ALSA is the
headphone jack. Nothing errors; the sound just goes somewhere else.

So this walks every driver SDL was built with, reports which ones open, lists
the devices each can see, and plays a real clip from the game's own assets
through each so you can hear which one comes out of the TV.

Usage::

    python tools/audio_check.py              # try every driver
    python tools/audio_check.py --driver alsa
    python tools/audio_check.py --buffer 2048   # rule out an underrun first
    python tools/audio_check.py --quiet      # report only, play nothing

Then launch the game with whichever worked::

    ./run-game.sh --audio-driver pulseaudio

To make it permanent, add that flag to the Exec line in
`~/Desktop/pacman.desktop`, or export SDL_AUDIODRIVER in run-game.sh.
"""

import argparse
import json
import os
import sys
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

ASSET_ROOT = os.path.join(REPO_ROOT, 'assets')

# Ordered best-first for a Pi running a desktop: the compatibility layers route
# through whatever the desktop is already using (and therefore to HDMI), while
# raw ALSA/OSS talk to a card directly and are the usual cause of the sound
# arriving at the wrong socket. '' means "whatever SDL picks on its own".
CANDIDATES = ('', 'pipewire', 'pulseaudio', 'pulse', 'alsa', 'sndio', 'dsp')

# Long enough to recognise, short enough to sit through seven times.
CLIP_SECONDS = 1.5


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--driver', default=None, metavar='NAME',
                        help='test only this driver')
    parser.add_argument('--quiet', action='store_true',
                        help='report drivers and devices, play nothing')
    parser.add_argument('--buffer', type=int, default=512, metavar='N',
                        help='mixer buffer size (default: 512, matching the '
                             'game). A Pi that underruns needs 1024 or 2048 - '
                             'try those before concluding it is routing.')
    parser.add_argument('--clip', default=None, metavar='NAME',
                        help='manifest clip to play (default: the game start '
                             'jingle, which is the longest)')
    return parser.parse_args(argv)


def load_manifest():
    path = os.path.join(ASSET_ROOT, 'manifest.json')
    try:
        with open(path, encoding='utf-8') as handle:
            parsed = json.load(handle)
    except (OSError, ValueError) as error:
        print(f'  ! cannot read {path}: {error}')
        return {}
    audio = parsed.get('audio') if isinstance(parsed, dict) else None
    return audio if isinstance(audio, dict) else {}


def pick_clip(manifest, preferred):
    if preferred and preferred in manifest:
        return preferred, manifest[preferred]
    for name in ('game_start', 'extra_life', 'death', 'eat_ghost'):
        if name in manifest:
            return name, manifest[name]
    if manifest:
        return next(iter(manifest.items()))
    return None, None


def try_driver(driver, clip_path, quiet, buffer_size=512):
    """Returns True if the mixer opened. Prints what happened either way."""
    label = driver or '(SDL default)'
    print(f'\n--- {label} ---')

    # SDL reads this once per init, so the module has to be torn down and the
    # variable set before pygame touches audio again.
    if driver:
        os.environ['SDL_AUDIODRIVER'] = driver
    else:
        os.environ.pop('SDL_AUDIODRIVER', None)

    import pygame

    try:
        pygame.mixer.quit()
    except pygame.error:
        pass

    try:
        pygame.mixer.init(frequency=44100, size=-16, channels=2,
                          buffer=buffer_size)
    except pygame.error as error:
        print(f'  unavailable: {error}')
        return False

    try:
        actual = pygame.mixer.get_driver()
    except (AttributeError, pygame.error):
        actual = '?'
    print(f'  opened: driver={actual} mixer={pygame.mixer.get_init()}')

    try:
        from pygame._sdl2 import audio as sdl2_audio
        devices = sdl2_audio.get_audio_device_names(False)
        print(f'  devices: {devices or "(none reported)"}')
    except Exception as error:                    # noqa: BLE001 - diagnostic
        print(f'  devices: unavailable ({type(error).__name__}: {error})')

    if not quiet and clip_path:
        try:
            sound = pygame.mixer.Sound(clip_path)
            sound.set_volume(1.0)
            print(f'  playing {os.path.basename(clip_path)} '
                  f'- listen for it on the TV...')
            sound.play()
            time.sleep(CLIP_SECONDS)
            sound.stop()
        except (pygame.error, FileNotFoundError) as error:
            print(f'  ! could not play: {error}')
            return False

    return True


def main(argv=None):
    args = parse_args(argv)

    os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')   # no window needed

    import pygame
    pygame.init()
    print(f'pygame {pygame.version.ver}, SDL {".".join(map(str, pygame.get_sdl_version()))}')
    print(f'assets: {ASSET_ROOT}')

    manifest = load_manifest()
    name, rel_path = pick_clip(manifest, args.clip)
    clip_path = os.path.join(ASSET_ROOT, rel_path) if rel_path else None

    if clip_path and not os.path.exists(clip_path):
        print(f'  ! missing clip file: {clip_path}')
        clip_path = None
    print(f'clip: {name or "(none available)"}')

    drivers = (args.driver,) if args.driver else CANDIDATES
    print(f'buffer: {args.buffer}')
    working = [d for d in drivers
               if try_driver(d, clip_path, args.quiet, args.buffer)]

    print('\n=== summary ===')
    if not working:
        print('No driver opened. SDL cannot reach any audio device at all -')
        print('check `aplay -l` and that the user is in the `audio` group.')
        return 1

    print('Opened successfully: ' + ', '.join(d or '(SDL default)' for d in working))

    named = [d for d in working if d]
    if named:
        print('\nWhichever one you HEARD is the answer. Launch the game with:')
        for driver in named:
            print(f'    ./run-game.sh --audio-driver {driver}')
    else:
        print('\nOnly SDL\'s own choice works here, so there is nothing to')
        print('override - the game already uses it. If that was silent, the')
        print('problem is downstream of SDL, not in the game.')
    print('\nIf you heard none of them, re-run with a bigger buffer before')
    print('blaming routing - an undersized buffer can starve the stream into')
    print('silence on a Pi:')
    print('    python tools/audio_check.py --buffer 2048')
    print('\nStill nothing? Then the sound is reaching a device that is not the')
    print('TV. Check the desktop mixer output, and `wpctl status` on Bookworm.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
