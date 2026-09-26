#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

compose_files=(-f compose.registry.yaml)
site_host=''
if [[ -f .site-host ]]; then
  IFS= read -r site_host < .site-host || true
  if [[ ! $site_host =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ || $site_host != *.* || $site_host == *..* || $site_host == *.-* || $site_host == *-.* ]]; then
    printf 'Ungültiger Hostname in .site-host. Bitte start.sh erneut ausführen.\n' >&2
    exit 1
  fi
  export SITE_HOST="$site_host"
  compose_files+=(-f compose.https.yaml)
fi

install_docker() {
  if [[ ! -r /etc/os-release ]] || ! command -v apt-get >/dev/null 2>&1; then
    printf 'Automatische Docker-Installation unterstützt nur Ubuntu und Debian.\n' >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) ;;
    *) printf 'Diese Ubuntu-/Debian-Version wird vom Installer nicht unterstützt.\n' >&2; exit 1 ;;
  esac
  if [[ $(dpkg --print-architecture) != amd64 ]]; then
    printf 'Das NEXUS-Image unterstützt derzeit nur Linux/amd64.\n' >&2
    exit 1
  fi
  local package
  for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
    if dpkg-query -W -f='${db:Status-Abbrev}' "$package" 2>/dev/null | grep -q '^ii'; then
      printf 'Konflikt mit installiertem Paket %s. Bitte Docker manuell einrichten; es wird nichts entfernt.\n' "$package" >&2
      exit 1
    fi
  done
  local -a elevate=()
  if (( EUID != 0 )); then
    command -v sudo >/dev/null 2>&1 || { printf 'sudo ist für die Docker-Installation erforderlich.\n' >&2; exit 1; }
    elevate=(sudo)
  fi
  printf 'Installiere Docker Engine und Compose aus dem offiziellen Docker-APT-Repository …\n'
  "${elevate[@]}" apt-get update
  "${elevate[@]}" apt-get install -y --no-remove ca-certificates curl
  "${elevate[@]}" install -m 0755 -d /etc/apt/keyrings
  if [[ ! -e /etc/apt/keyrings/docker.asc ]]; then
    "${elevate[@]}" curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  fi
  "${elevate[@]}" chmod a+r /etc/apt/keyrings/docker.asc
  if [[ ! -e /etc/apt/sources.list.d/docker.sources ]]; then
    local codename="${VERSION_CODENAME:-}"
    if [[ $ID == ubuntu ]]; then codename="${UBUNTU_CODENAME:-$codename}"; fi
    [[ -n $codename ]] || { printf 'Distributions-Codename fehlt.\n' >&2; exit 1; }
    printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: amd64\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$ID" "$codename" | "${elevate[@]}" tee /etc/apt/sources.list.d/docker.sources >/dev/null
  fi
  "${elevate[@]}" apt-get update
  "${elevate[@]}" apt-get install -y --no-remove docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  "${elevate[@]}" systemctl enable --now docker
}

if ! command -v docker >/dev/null 2>&1; then install_docker; fi
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v systemctl >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    sudo systemctl start docker || true
  fi
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    docker_cmd=(sudo docker)
  else
    printf 'Docker ist nicht erreichbar. Den Dienst starten und Docker-Zugriff prüfen.\n' >&2
    exit 1
  fi
fi
if ! "${docker_cmd[@]}" compose version >/dev/null 2>&1; then
  printf 'Docker Compose fehlt. Version 2.30 oder neuer installieren.\n' >&2
  exit 1
fi
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nexus-bot; then
  printf 'Der alte nexus-bot-Dienst läuft noch. Bitte vor dem Docker-Start stoppen: sudo systemctl disable --now nexus-bot\n' >&2
  exit 1
fi
if [[ -f .env ]]; then
  printf 'Eine .env-Datei wurde gefunden. Vollständig konfigurierte Werte überspringen den Web-Assistenten.\n'
fi
if ! "${docker_cmd[@]}" compose "${compose_files[@]}" config --quiet; then
  printf 'Compose-Konfiguration ungültig. Docker Compose 2.30 oder neuer ist erforderlich.\n' >&2
  exit 1
fi

printf 'Lade NEXUS Watchdog …\n'
"${docker_cmd[@]}" compose "${compose_files[@]}" pull
"${docker_cmd[@]}" compose "${compose_files[@]}" up -d

printf '\nNEXUS Watchdog wurde gestartet.\n'
if "${docker_cmd[@]}" compose "${compose_files[@]}" exec -T watchdog test -f /data/config.json >/dev/null 2>&1; then
  printf 'Der Bot ist bereits eingerichtet.\n'
else
  printf 'Einrichtungscode:\n'
  found=false
  for attempt in {1..20}; do
    recent_logs="$("${docker_cmd[@]}" compose "${compose_files[@]}" logs --no-color --tail=40 watchdog 2>&1)"
    if printf '%s\n' "$recent_logs" | grep -E 'Einrichtungscode \(30 Minuten gültig\):' ; then
      found=true
      break
    fi
    sleep 1
  done
  if [[ $found == false ]]; then
    printf 'Kein Einrichtungscode gefunden. Bitte Logs prüfen:\n'
    printf 'bash quickstart.sh (zeigt bei Startproblemen die Docker-Meldung)\n'
  fi
fi
if [[ -n $site_host ]]; then
  printf '\nIm Browser https://%s öffnen.\n' "$site_host"
  printf 'Falls HTTPS noch nicht erreichbar ist: DNS, Ports 80/443 und Caddy-Logs prüfen.\n'
  printf 'Caddy-Logs: docker compose -f compose.registry.yaml -f compose.https.yaml logs caddy\n'
else
  printf '\nAuf deinem eigenen Rechner einen SSH-Tunnel öffnen:\n'
  printf 'ssh -L 3000:127.0.0.1:3000 DEIN_SERVER_BENUTZER@SERVER_IP\n'
  printf 'Dann im Browser http://localhost:3000 öffnen.\n'
fi
