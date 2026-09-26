#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

printf 'NEXUS Watchdog installieren\n\n'
printf 'Welchen Server hast du?\n'
printf '  1) Linux-vServer/VPS oder Rootserver mit sudo-Rechten\n'
printf '  2) Verwaltetes Bot-/Gameserver-Hosting ohne sudo-Rechte\n'
printf '  3) Ich weiß es nicht\n\n'
read -r -p 'Auswahl [1-3]: ' choice

case "$choice" in
  1)
    if ! command -v sudo >/dev/null 2>&1 && (( EUID != 0 )); then
      printf '\nFür diesen Weg brauchst du sudo-Rechte. Prüfe deinen Tarif beim Hoster.\n' >&2
      exit 1
    fi
    exec bash ./quickstart.sh
    ;;
  2)
    printf '\nDieser Tarif kann den Docker-Installer nicht verwenden.\n'
    printf 'Für den Web-Assistenten braucht der Hoster Node.js 22+, einen dauerhaft laufenden Prozess,\n'
    printf 'dauerhaften privaten Speicher und einen von außen erreichbaren HTTPS-Endpunkt.\n'
    printf 'Prüfe diese vier Punkte im Hosting-Panel oder beim Support.\n'
    printf 'Erst danach kann ein passender Installationsweg für genau diesen Tarif eingerichtet werden.\n'
    printf 'Hinweise: https://github.com/Vardokr/Nexus-Webportalbot/blob/main/INSTALLATION.md\n'
    ;;
  3)
    printf '\nKannst du dich per SSH anmelden und mit sudo Software installieren?\n'
    printf 'Ja: VPS/Rootserver (Option 1). Nein: vermutlich verwaltetes Hosting (Option 2).\n'
    printf 'Suche im Hosting-Panel nach dem genauen Produktnamen.\n'
    ;;
  *)
    printf 'Ungültige Auswahl. Bitte 1, 2 oder 3 eingeben.\n' >&2
    exit 2
    ;;
esac
