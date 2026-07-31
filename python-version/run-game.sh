#!/usr/bin/env bash
# Launch the game from its virtualenv, no matter where the repo was cloned.
#
# Double-clicked from the desktop there is no terminal to print to, so anything
# that would have gone to the console is teed into run-game.log next to this
# script. If the icon flashes and nothing happens, that log is where to look.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

LOG="$HERE/run-game.log"
exec > >(tee "$LOG") 2>&1

if [[ ! -f .venv/bin/activate ]]; then
    echo "No virtualenv at $HERE/.venv — create one first:"
    echo "    python3 -m venv .venv"
    echo "    .venv/bin/pip install -r requirements.txt"
    exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate

exec python main.py "$@"
