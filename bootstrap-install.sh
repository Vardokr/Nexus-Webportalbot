#!/usr/bin/env bash
set -euo pipefail
umask 077
repo='https://github.com/Vardokr/Nexus-Webportalbot.git'
target="${NEXUS_INSTALL_DIR:-$PWD/nexus-watchdog}"
[[ $(uname -s) == Linux ]] || { printf 'Bitte diesen Befehl in der Konsole deines Linux-VPS ausführen.\n' >&2; exit 1; }
elevate=()
if (( EUID != 0 )); then
  command -v sudo >/dev/null 2>&1 || { printf 'Dieser Tarif bietet keine Administrationsrechte. Benötigt wird ein Linux-VPS/Rootserver.\n' >&2; exit 1; }
  elevate=(sudo)
fi
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 || { printf 'Bitte git und curl installieren und den Befehl erneut ausführen.\n' >&2; exit 1; }
  "${elevate[@]}" apt-get update
  "${elevate[@]}" apt-get install -y --no-remove git curl ca-certificates
fi
if [[ -e $target ]]; then
  [[ -d $target/.git && $(git -C "$target" remote get-url origin) == "$repo" ]] || { printf 'Zielordner enthält bereits andere Dateien: %s\n' "$target" >&2; exit 1; }
  [[ -z $(git -C "$target" status --porcelain) ]] || { printf 'Lokale Änderungen gefunden. Bitte vor dem Update prüfen: %s\n' "$target" >&2; exit 1; }
  git -C "$target" pull --ff-only
else
  git clone "$repo" "$target"
fi
exec bash "$target/start.sh" "$@"
