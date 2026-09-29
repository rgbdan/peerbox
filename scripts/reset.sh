#!/usr/bin/env bash
# Deletes local identity/config so the next run starts first-run setup.
# Respects PEERBOX_CONFIG_DIR.
set -euo pipefail

CONFIG_DIR="${PEERBOX_CONFIG_DIR:-$HOME/.config/peerbox}"

force=false
for arg in "$@"; do
  case "$arg" in
    -y|--yes) force=true ;;
  esac
done

if [ ! -e "$CONFIG_DIR" ]; then
  echo "Nothing to clean: $CONFIG_DIR does not exist."
  exit 0
fi

if [ "$force" != true ]; then
  read -r -p "Delete $CONFIG_DIR (identity, recovery phrase, sync state)? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

rm -rf "$CONFIG_DIR"
echo "Removed $CONFIG_DIR — next run starts first-run setup."
