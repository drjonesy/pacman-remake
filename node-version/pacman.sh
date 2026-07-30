#!/usr/bin/env bash
#
# Launch the Pacman remake from anywhere in a Linux terminal.
#
#   pacman.sh            build (if needed) and serve the production build
#   pacman.sh dev        run the Vite dev server instead
#   pacman.sh build      rebuild dist/ and exit
#   pacman.sh reset      wipe the high-score leaderboard
#   pacman.sh --help     show this message
#
# Install as a shortcut:
#   chmod +x pacman.sh
#   ln -s "$PWD/pacman.sh" ~/.local/bin/pacman-game
#
set -euo pipefail

# Resolve the real project directory even when invoked through a symlink,
# so the script works from any working directory.
SOURCE=${BASH_SOURCE[0]}
while [ -L "$SOURCE" ]; do
  DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
  SOURCE=$(readlink "$SOURCE")
  [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE
done
PROJECT_DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
cd "$PROJECT_DIR"

usage() {
  sed -n '3,13p' "$SOURCE" | sed 's/^# \{0,1\}//'
}

case ${1-} in
  -h | --help | help)
    usage
    exit 0
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "pacman: node is not installed. Install Node.js 18+ and try again." >&2
  exit 1
fi

# Prefer pnpm (the repo ships a pnpm-lock.yaml), fall back to npm.
if command -v pnpm >/dev/null 2>&1; then
  PM=pnpm
elif command -v npm >/dev/null 2>&1; then
  PM=npm
else
  echo "pacman: neither pnpm nor npm found on PATH." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies with $PM"
  "$PM" install
fi

case ${1-preview} in
  dev)
    echo "==> Starting dev server (Ctrl+C to quit)"
    exec "$PM" run dev
    ;;
  build)
    exec "$PM" run build
    ;;
  reset)
    exec "$PM" run reset
    ;;
  preview)
    # Rebuild when dist/ is missing or older than the newest source file.
    newest=$(find src server index.html vite.config.js package.json -type f -newer dist/index.html -print -quit 2>/dev/null || true)
    if [ ! -f dist/index.html ] || [ -n "$newest" ]; then
      echo "==> Building production bundle"
      "$PM" run build
    fi
    echo "==> Serving http://localhost:4173 (Ctrl+C to quit)"
    exec "$PM" run preview -- --open
    ;;
  *)
    echo "pacman: unknown command '$1'" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
