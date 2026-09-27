#!/usr/bin/env bash
# Installs Display Tuner into your local GNOME Shell extensions folder.
set -euo pipefail

UUID="display-tuner@tesla.local"
SRC="$(cd "$(dirname "$0")" && pwd)/$UUID"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$DEST"
cp -r "$SRC"/. "$DEST"/
glib-compile-schemas "$DEST/schemas"

# `gnome-extensions enable` fails until GNOME Shell has seen the extension
# (after re-login on Wayland), so fall back to adding it to the enabled list.
if ! gnome-extensions enable "$UUID" 2>/dev/null; then
    current="$(gsettings get org.gnome.shell enabled-extensions)"
    if [[ "$current" != *"'$UUID'"* ]]; then
        if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
            new="['$UUID']"
        else
            new="${current%]}, '$UUID']"
        fi
        gsettings set org.gnome.shell enabled-extensions "$new"
    fi
fi

echo "Installed to $DEST"
echo "Log out and back in to load it (required on Wayland)."
