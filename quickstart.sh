#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

for program in docker gh; do
  if ! command -v "$program" >/dev/null 2>&1; then
    printf 'Fehlt: %s. Bitte zuerst installieren.\n' "$program" >&2
    exit 1
  fi
done
if ! docker info >/dev/null 2>&1; then
  printf 'Docker ist nicht erreichbar. Docker starten oder dem Server-Benutzer Zugriff geben.\n' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  printf 'Docker Compose fehlt. Version 2.30 oder neuer installieren.\n' >&2
  exit 1
fi
if ! gh auth status -h github.com >/dev/null 2>&1; then
  printf 'Zuerst mit "gh auth login" bei GitHub anmelden. Für das private Image ist read:packages nötig.\n' >&2
  exit 1
fi
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nexus-bot; then
  printf 'Der alte nexus-bot-Dienst läuft noch. Bitte vor dem Docker-Start stoppen: sudo systemctl disable --now nexus-bot\n' >&2
  exit 1
fi
if [[ -f .env ]]; then
  printf 'Eine .env-Datei wurde gefunden. Vollständig konfigurierte Werte überspringen den Web-Assistenten.\n'
fi
if ! docker compose -f compose.registry.yaml config --quiet; then
  printf 'Compose-Konfiguration ungültig. Docker Compose 2.30 oder neuer ist erforderlich.\n' >&2
  exit 1
fi

github_user="$(gh api user --jq .login)"
printf 'Melde Docker bei der privaten GitHub Container Registry an …\n'
gh auth token | docker login ghcr.io -u "$github_user" --password-stdin >/dev/null

printf 'Lade NEXUS Watchdog …\n'
docker compose -f compose.registry.yaml pull
docker compose -f compose.registry.yaml up -d

printf '\nNEXUS Watchdog wurde gestartet.\n'
if docker compose -f compose.registry.yaml exec -T watchdog test -f /data/config.json >/dev/null 2>&1; then
  printf 'Der Bot ist bereits eingerichtet.\n'
else
  printf 'Einrichtungscode:\n'
  found=false
  for attempt in {1..20}; do
    recent_logs="$(docker compose -f compose.registry.yaml logs --no-color --tail=40 watchdog 2>&1)"
    if printf '%s\n' "$recent_logs" | grep -E 'Einrichtungscode \(30 Minuten gültig\):' ; then
      found=true
      break
    fi
    sleep 1
  done
  if [[ $found == false ]]; then
    printf 'Kein Einrichtungscode gefunden. Bitte Logs prüfen:\n'
    printf 'docker compose -f compose.registry.yaml logs --tail=100 watchdog\n'
  fi
fi
printf '\nAuf deinem eigenen Rechner einen SSH-Tunnel öffnen:\n'
printf 'ssh -L 3000:127.0.0.1:3000 DEIN_SERVER_BENUTZER@SERVER_IP\n'
printf 'Dann im Browser http://localhost:3000 öffnen.\n'
