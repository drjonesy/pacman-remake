#!/usr/bin/env python3
"""Walk every panel on a pad and write a shareable report. Run this on the Pi.

Standalone on purpose: it imports nothing from `pacman`, so it can be copied to
a Pi on its own and needs only pygame. It prompts for each of a dance mat's ten
panels in turn, records **every raw event** that panel produced, and writes a
plain-text report you can paste into a bug report or an email.

    python3 tools/pad_report.py

It also writes a ready-to-use `data/pad_mapping.json` from what it recorded, so
a successful run leaves the game playable without a second step. Pass
`--no-mapping` to only produce the report.

What the report is actually for: mats lie in interesting ways. A panel may fire
on both a hat and an axis, may bounce and send the same press three times, may
latch instead of releasing, or may sit at full deflection while untouched and
steer the game on its own. All four are visible in the raw log and none are
visible from a mapping file after the fact.
"""

import argparse
import json
import os
import platform
import sys
import time

import pygame

# The ten panels, in the order they are easiest to reach standing on the mat,
# paired with the game action each one is bound to in the generated mapping.
# `None` means "record it, but leave it unbound".
PANELS = (
    ('UP',       'the UP arrow panel',       'up'),
    ('DOWN',     'the DOWN arrow panel',     'down'),
    ('LEFT',     'the LEFT arrow panel',     'left'),
    ('RIGHT',    'the RIGHT arrow panel',    'right'),
    ('START',    'the START panel',          'select'),
    ('SELECT',   'the SELECT panel',         'pause'),
    ('CROSS',    'the X panel',              'delete'),
    ('CIRCLE',   'the O panel',              'select'),
    ('SQUARE',   'the SQUARE panel',         'mute'),
    ('TRIANGLE', 'the TRIANGLE panel',       'pause'),
)

# Stop recording a panel once it has been quiet this long. Long enough to catch
# a bouncing switch sending the same press twice, short enough not to drag.
QUIET_MS = 700
# Give up on a panel after this and move on, so an unplugged or dead panel
# cannot stall the whole run. There is no keyboard over SSH to skip with.
PANEL_TIMEOUT_MS = 20_000
# An axis has to travel this far from centre to count as pressed.
DEADZONE = 0.5

AXIS_NAMES = {0: 'X', 1: 'Y', 2: 'Z', 3: 'RZ', 4: 'RX', 5: 'RY'}


def now_ms():
    return int(time.monotonic() * 1000)


class Report:
    """Accumulates lines for both the console and the file, so the terminal
    shows exactly what gets shared."""

    def __init__(self):
        self.lines = []

    def __call__(self, text=''):
        print(text)
        self.lines.append(text)

    def quiet(self, text):
        """Into the file only - detail that would bury the prompts on screen."""
        self.lines.append(text)

    def write(self, path):
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write('\n'.join(self.lines))
            handle.write('\n')


# -- setup -------------------------------------------------------------------

def init_display():
    """A real window when there is a display, SDL's dummy driver otherwise.

    Joystick events arrive either way; the window only exists so the prompts
    are readable while standing on the mat, well away from the terminal.
    """
    try:
        pygame.display.init()
        pygame.display.set_mode((520, 180))
        pygame.display.set_caption('pad report')
        return True
    except pygame.error:
        os.environ['SDL_VIDEODRIVER'] = 'dummy'
        pygame.display.quit()
        try:
            pygame.display.init()
            pygame.display.set_mode((1, 1))
        except pygame.error:
            pass
        return False


def banner(windowed, lines):
    if not windowed:
        return
    surface = pygame.display.get_surface()
    if surface is None:
        return
    surface.fill((0, 0, 0))
    font = pygame.font.Font(None, 30)
    for index, line in enumerate(lines[:4]):
        surface.blit(font.render(line, True, (255, 255, 0)), (18, 22 + index * 36))
    pygame.display.flip()


# -- sections ----------------------------------------------------------------

def section_environment(out):
    out('=' * 68)
    out('PAD REPORT')
    out('=' * 68)
    out(f'date          {time.strftime("%Y-%m-%d %H:%M:%S")}')
    out(f'platform      {platform.platform()}')
    out(f'machine       {platform.machine()}')
    out(f'python        {sys.version.split()[0]}')
    out(f'pygame        {pygame.version.ver}')
    out(f'SDL           {".".join(str(n) for n in pygame.version.SDL)}')

    # Pi model, when there is one - the USB stack differs across revisions.
    try:
        with open('/proc/device-tree/model', encoding='utf-8') as handle:
            out(f'model         {handle.read().strip(chr(0))}')
    except OSError:
        pass
    out()


def section_kernel(out):
    """The kernel's own view, which is the ground truth SDL sits on top of."""
    path = '/proc/bus/input/devices'
    if not os.path.exists(path):
        out(f'(no {path} - not Linux, so the kernel section is skipped)')
        out()
        return

    try:
        with open(path, encoding='utf-8') as handle:
            blocks = handle.read().split('\n\n')
    except OSError as error:
        out(f'({path} unreadable: {error})')
        out()
        return

    out('-' * 68)
    out('KERNEL DEVICES  (/proc/bus/input/devices, joystick nodes only)')
    out('-' * 68)
    found = False
    for block in blocks:
        # Only the blocks that produced a js* node matter here; a mat that
        # produced none is the single most useful thing this report can say.
        if 'js' in block and 'Handlers=' in block:
            for line in block.splitlines():
                if line.startswith('H: ') and 'js' not in line:
                    continue
                out(line)
            out()
            found = True
    if not found:
        out('No device with a js* handler. The kernel is not exposing this pad')
        out('as a joystick, so SDL cannot see it either. Check `lsusb`, then')
        out('whether your user is in the `input` group.')
        out()


def section_devices(out, sticks):
    out('-' * 68)
    out('SDL DEVICES')
    out('-' * 68)
    if not sticks:
        out('None. Nothing below this line will have recorded anything.')
        out()
        return

    for stick in sticks:
        out(f'[{stick.get_instance_id()}] {stick.get_name()!r}')
        out(f'     guid    {stick.get_guid()}')
        out(f'     axes    {stick.get_numaxes()}')
        out(f'     hats    {stick.get_numhats()}')
        out(f'     buttons {stick.get_numbuttons()}')
    out()


def section_resting(out, sticks):
    """Samples every axis untouched.

    A PSX-to-USB adapter with no analogue stick attached can park an axis at
    full deflection rather than centre. Bound to a direction, that steers the
    game on its own - and it is invisible unless something looks for it.
    """
    out('-' * 68)
    out('RESTING STATE  (nothing touched - axes should read near 0.00)')
    out('-' * 68)
    if not sticks:
        out('(no devices)')
        out()
        return

    deadline = now_ms() + 700
    while now_ms() < deadline:
        pygame.event.pump()
        pygame.time.wait(20)

    warnings = []
    for stick in sticks:
        for axis in range(stick.get_numaxes()):
            value = stick.get_axis(axis)
            label = AXIS_NAMES.get(axis, f'#{axis}')
            flag = ''
            if abs(value) > DEADZONE:
                flag = '   <-- STUCK: reads as pressed while untouched'
                warnings.append(axis)
            out(f'  axis {axis} ({label:<2}) {value:+.3f}{flag}')
        for hat in range(stick.get_numhats()):
            out(f'  hat  {hat}      {stick.get_hat(hat)}')
    if warnings:
        out()
        out(f'  {len(warnings)} axis/axes rest outside the deadzone. Directions')
        out('  must not be bound to these; the generated mapping leaves them out.')
    out()
    return set(warnings)


# -- the walk ----------------------------------------------------------------

def describe(event):
    """One raw event, in the shortest form that is still unambiguous."""
    if event.type == pygame.JOYBUTTONDOWN:
        return f'BUTTONDOWN  button={event.button}'
    if event.type == pygame.JOYBUTTONUP:
        return f'BUTTONUP    button={event.button}'
    if event.type == pygame.JOYHATMOTION:
        return f'HATMOTION   hat={event.hat} value={tuple(event.value)}'
    if event.type == pygame.JOYAXISMOTION:
        label = AXIS_NAMES.get(event.axis, '')
        return f'AXISMOTION  axis={event.axis}{f" ({label})" if label else ""} value={event.value:+.3f}'
    if event.type == pygame.KEYDOWN:
        return f'KEYDOWN     key={pygame.key.name(event.key)!r}'
    return f'{event.type}'


def press_binding(event, stuck_axes):
    """The binding an event implies, or None if it is not a press.

    Releases, axis returns to centre, and axes already known to be stuck are
    all excluded - they are logged, but they must not end up in the mapping.
    """
    if event.type == pygame.JOYBUTTONDOWN:
        return {'type': 'button', 'button': event.button}
    if event.type == pygame.JOYHATMOTION:
        x, y = event.value
        if x:
            return {'type': 'hat', 'hat': event.hat, 'axis': 'x',
                    'value': 1 if x > 0 else -1}
        if y:
            return {'type': 'hat', 'hat': event.hat, 'axis': 'y',
                    'value': 1 if y > 0 else -1}
        return None
    if event.type == pygame.JOYAXISMOTION:
        if event.axis in stuck_axes or abs(event.value) <= DEADZONE:
            return None
        return {'type': 'axis', 'axis': event.axis,
                'value': 1 if event.value > 0 else -1}
    return None


def binding_key(binding):
    """Hashable identity, so a bouncing panel is not recorded twice."""
    if binding['type'] == 'button':
        return ('button', binding['button'])
    if binding['type'] == 'hat':
        return ('hat', binding['hat'], binding['axis'], binding['value'])
    return ('axis', binding['axis'], binding['value'])


def label_binding(binding):
    if binding['type'] == 'button':
        return f"button {binding['button']}"
    if binding['type'] == 'hat':
        arrow = {('x', -1): 'left', ('x', 1): 'right',
                 ('y', -1): 'down', ('y', 1): 'up'}[(binding['axis'],
                                                     binding['value'])]
        return f"hat {binding['hat']} {arrow}"
    return f"axis {binding['axis']} {'+' if binding['value'] > 0 else '-'}"


def walk_panel(out, name, prompt, stuck_axes, windowed):
    """Records everything one panel sends. Returns (bindings, raw_lines)."""
    out()
    out(f'--- {name} ---')
    print(f'    step on {prompt} ...')
    banner(windowed, [f'Step on: {name}', prompt, '', 'Then step off.'])

    pygame.event.clear()
    start = now_ms()
    last_event_at = None
    raw = []
    bindings = {}

    while True:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                raise KeyboardInterrupt

            if event.type not in (pygame.JOYBUTTONDOWN, pygame.JOYBUTTONUP,
                                  pygame.JOYHATMOTION, pygame.JOYAXISMOTION,
                                  pygame.KEYDOWN):
                continue
            # Axis noise below the deadzone is logged but does not start or
            # extend the capture, or a drifting axis would never let it finish.
            noise = (event.type == pygame.JOYAXISMOTION
                     and abs(event.value) <= DEADZONE)

            offset = now_ms() - start
            raw.append(f'    +{offset:>5}ms  {describe(event)}'
                       + ('   (below deadzone)' if noise else ''))
            if noise:
                continue

            last_event_at = now_ms()
            binding = press_binding(event, stuck_axes)
            if binding is not None:
                key = binding_key(binding)
                if key not in bindings:
                    bindings[key] = binding
                    print(f'      {label_binding(binding)}')

        elapsed = now_ms() - start
        if last_event_at is not None and now_ms() - last_event_at > QUIET_MS:
            break
        if last_event_at is None and elapsed > PANEL_TIMEOUT_MS:
            out('    NOTHING RECEIVED - panel dead, or not present on this pad')
            return {}, raw

        pygame.time.wait(5)

    for line in raw:
        out.quiet(line)

    if bindings:
        out('    ' + ', '.join(label_binding(b) for b in bindings.values()))
    else:
        # Events arrived but none was a press: usually a latching switch that
        # only ever reports a release, which is worth seeing in the raw log.
        out('    events seen, but none read as a press (see raw log)')
    out.quiet(f'    ({len(raw)} raw events)')
    return bindings, raw


# -- output ------------------------------------------------------------------

def build_mapping(results, deadzone):
    """Folds the per-panel captures into a game mapping.

    Several panels share one action on purpose (START and O both select), so
    bindings accumulate per action rather than replacing.
    """
    bindings = {}
    for name, _, action in PANELS:
        if action is None:
            continue
        for binding in results.get(name, {}).values():
            entries = bindings.setdefault(action, [])
            if binding not in entries:
                entries.append(binding)
    return {
        'version': 1,
        'device': None,
        'deadzone': deadzone,
        'bindings': bindings,
    }


def section_summary(out, results):
    out()
    out('-' * 68)
    out('SUMMARY')
    out('-' * 68)
    seen = {}
    for name, _, action in PANELS:
        captured = results.get(name, {})
        label = (', '.join(label_binding(b) for b in captured.values())
                 if captured else '(nothing)')
        out(f'  {name:<9} -> {label:<34} [{action or "unbound"}]')
        for key in captured:
            seen.setdefault(key, []).append(name)

    clashes = {key: names for key, names in seen.items() if len(names) > 1}
    if clashes:
        out()
        out('  CLASHES - one control reported by more than one panel:')
        for key, names in clashes.items():
            out(f'    {key} <- {", ".join(names)}')
        out('  Usually a bouncing switch or a panel still settling. If it is')
        out('  real, those two panels are wired together and cannot be told')
        out('  apart.')
    out()


def parse_args(argv=None):
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--output', metavar='PATH',
                        default=os.path.join(here, 'pad-report.txt'),
                        help='where to write the report (default: pad-report.txt)')
    parser.add_argument('--mapping', metavar='PATH',
                        default=os.path.join(here, 'data', 'pad_mapping.json'),
                        help='where to write the generated mapping')
    parser.add_argument('--no-mapping', action='store_true',
                        help='write the report only, and change nothing else')
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)

    pygame.init()
    windowed = init_display()
    pygame.joystick.init()

    sticks = []
    for index in range(pygame.joystick.get_count()):
        stick = pygame.joystick.Joystick(index)
        stick.init()
        sticks.append(stick)

    out = Report()
    section_environment(out)
    section_kernel(out)
    section_devices(out, sticks)
    stuck_axes = section_resting(out, sticks) or set()

    out('-' * 68)
    out('PANEL WALK')
    out('-' * 68)
    out('Each panel: step on it, then step off. Recording stops once the pad')
    out(f'goes quiet. A panel with nothing on it is skipped after '
        f'{PANEL_TIMEOUT_MS // 1000}s.')
    out.quiet('')
    out.quiet('Raw events per panel follow, timestamped from the prompt.')

    results = {}
    completed = True
    try:
        for name, prompt, _ in PANELS:
            bindings, _raw = walk_panel(out, name, prompt, stuck_axes, windowed)
            results[name] = bindings
    except KeyboardInterrupt:
        completed = False
        out()
        out('*** interrupted - the report below covers only what was reached ***')

    section_summary(out, results)

    if not args.no_mapping and any(results.values()):
        mapping = build_mapping(results, DEADZONE)
        os.makedirs(os.path.dirname(args.mapping) or '.', exist_ok=True)
        tmp = f'{args.mapping}.tmp'
        with open(tmp, 'w', encoding='utf-8') as handle:
            json.dump(mapping, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, args.mapping)
        out(f'mapping written: {args.mapping}')
        out.quiet('')
        out.quiet('-' * 68)
        out.quiet('GENERATED MAPPING')
        out.quiet('-' * 68)
        out.quiet(json.dumps(mapping, indent=2))

    out.write(args.output)
    banner(windowed, ['Done.', 'See the terminal.'])
    print()
    print(f'report written: {args.output}')
    print('Share that file - it has the raw event log the summary is built from.')
    pygame.quit()
    return 0 if completed else 1


if __name__ == '__main__':
    sys.exit(main())
