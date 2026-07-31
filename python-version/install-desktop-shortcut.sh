#!/usr/bin/env bash
# Run once on the Pi to put a double-clickable Pacman icon on the desktop.
#
# The .desktop file has to carry absolute paths, so it is generated here rather
# than committed: clone the repo anywhere, run this, and the paths come out
# right.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Pi OS localises the desktop folder ("Escritorio", etc). Ask the system first.
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[[ -d "${DESKTOP_DIR:-}" ]] || DESKTOP_DIR="$HOME/Desktop"
mkdir -p "$DESKTOP_DIR"

TARGET="$DESKTOP_DIR/pacman.desktop"

chmod +x "$HERE/run-game.sh"

cat > "$TARGET" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Pacman
Comment=Pacman remake (pygame)
Exec=$HERE/run-game.sh
Path=$HERE
Icon=$HERE/assets/sprites/pacman_logo.png
Terminal=false
Categories=Game;ArcadeGame;
EOF

chmod +x "$TARGET"

# Wayland/labwc file managers refuse to launch an entry that has not been
# marked trusted; harmless no-op elsewhere.
gio set "$TARGET" metadata::trusted true 2>/dev/null || true

# Also register it in the applications menu under Games.
mkdir -p "$HOME/.local/share/applications"
cp "$TARGET" "$HOME/.local/share/applications/pacman.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo "Installed $TARGET"
echo "Also added to the Games menu."
