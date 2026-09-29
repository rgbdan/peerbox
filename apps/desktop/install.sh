#!/usr/bin/env sh
set -eu

# peerbox Linux installer: curl -fsSL https://peerbox.example/install.sh | sh
# Installs the latest AppImage for the current user; re-run to update.

REPO="rgbdan/peerbox"
VERSION="${PEERBOX_VERSION:-latest}"
# GitHub: latest is /releases/latest/download/, a tag is /releases/download/<tag>/
if [ "$VERSION" = "latest" ]; then
  BASE_URL="https://github.com/${REPO}/releases/latest/download"
else
  BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
fi
INSTALL_DIR="${PEERBOX_INSTALL_DIR:-$HOME/.local/share/peerbox}"
BIN_DIR="${PEERBOX_BIN_DIR:-$HOME/.local/bin}"

# --- platform detection -----------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux) ;;
  Darwin)
    echo "peerbox: macOS is installed from the .dmg on" >&2
    echo "         https://github.com/${REPO}/releases" >&2
    exit 1 ;;
  *) echo "peerbox: unsupported OS: $os" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64|amd64) arch="x86_64" ;;
  *) echo "peerbox: unsupported arch: $arch (only x86_64 is published today)" >&2; exit 1 ;;
esac

ASSET="peerbox-linux-${arch}.AppImage"
URL="${BASE_URL}/${ASSET}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "peerbox: downloading $URL"
curl -fsSL "$URL" -o "$TMP/$ASSET" || wget -qO "$TMP/$ASSET" "$URL"

echo "peerbox: installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
# Replace via a temp name + mv so an upgrade can't leave a half-written binary
# behind, and so a running instance keeps its open inode.
install -m 755 "$TMP/$ASSET" "$INSTALL_DIR/.peerbox.new"
mv -f "$INSTALL_DIR/.peerbox.new" "$INSTALL_DIR/peerbox"

# launcher symlink
ln -sf "$INSTALL_DIR/peerbox" "$BIN_DIR/peerbox"

# Autostart is left to the app's own "Start on login" setting.

echo "peerbox: installed. Ensure $BIN_DIR is on your PATH, then run: peerbox"
