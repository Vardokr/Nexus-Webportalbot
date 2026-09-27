#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

source ./installer-lib.sh
umask 077
address=''
case "${1:-}" in
  '') ;;
  --address) [[ $# == 2 ]] || fail 'Aufruf: bash start.sh --address IP_ODER_HOSTNAME'; address="${2,,}"; valid_address "$address" || fail 'Bitte eine öffentliche IPv4 oder einen Hostnamen ohne https:// eingeben.' ;;
  *) fail 'Aufruf: bash start.sh [--address IP_ODER_HOSTNAME]' ;;
esac
[[ $(uname -s) == Linux ]] || fail 'Bitte in der Konsole eines Linux-VPS ausführen.'
[[ $(uname -m) == x86_64 ]] || fail 'Das bereitgestellte Bot-Image benötigt derzeit einen x86-64/amd64-Server.'
elevate=()
if (( EUID != 0 )); then
  command -v sudo >/dev/null 2>&1 || fail 'Administrationsrechte fehlen. Benötigt wird ein VPS/Rootserver; verwaltetes Bot-Hosting braucht einen eigenen Installationsweg.'
  elevate=(sudo)
fi
if ! command -v curl >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 || fail 'Bitte curl installieren.'
  "${elevate[@]}" apt-get update
  "${elevate[@]}" apt-get install -y --no-remove curl ca-certificates
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
if ! docker info >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
  "${elevate[@]}" systemctl start docker || true
fi
select_docker
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nexus-bot; then
  printf 'Der alte nexus-bot-Dienst läuft noch. Bitte vor dem Docker-Start stoppen: sudo systemctl disable --now nexus-bot\n' >&2
  exit 1
fi
if [[ -z $address && -f .site-host ]]; then IFS= read -r address < .site-host || true; fi
if [[ -z $address ]]; then
  printf 'Ermittle die öffentliche Serveradresse …\n'
  address="$(detect_address)" || fail 'Adresse nicht automatisch ermittelbar. Starte erneut mit: bash start.sh --address DEINE_OEFFENTLICHE_IP'
fi
valid_address "$address" || fail 'Ungültige gespeicherte Adresse. Starte erneut mit: bash start.sh --address DEINE_ADRESSE'
if ! public_ipv4 "$address"; then
  getent ahosts "$address" >/dev/null 2>&1 || fail 'Dieser Hostname ist noch nicht erreichbar. DNS-Eintrag beim Domain-Anbieter prüfen.'
fi
temporary="$(mktemp .site-host.XXXXXX)"
printf '%s\n' "$address" > "$temporary"
mv -- "$temporary" .site-host
load_compose
compose config --quiet || fail 'Docker Compose 2.30 oder neuer wird benötigt. Konfiguration konnte nicht geladen werden.'

if [[ -z $(compose ps --status running -q caddy) ]] && command -v ss >/dev/null 2>&1; then
  [[ -z $(ss -H -ltn '( sport = :80 or sport = :443 )') ]] || fail 'Port 80 oder 443 ist bereits belegt. Ein vorhandener Webserver muss zuerst für NEXUS angepasst werden.'
fi
printf 'Lade NEXUS und richte HTTPS für %s ein …\n' "$SITE_HOST"
compose pull || fail 'Download fehlgeschlagen. Internetzugang und freien Speicher prüfen; danach bash start.sh erneut ausführen.'
compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || fail 'HTTPS-Konfiguration ungültig. Diagnose: bash manage.sh logs'
compose up -d --wait --wait-timeout 90 || fail 'Ein Dienst startet nicht korrekt. Diagnose: bash manage.sh logs'

printf 'Prüfe HTTPS und Zertifikat (bis zu drei Minuten) …\n'
deadline=$((SECONDS + 180))
ready=false
while (( SECONDS < deadline )); do
  response="$(curl --noproxy '*' --resolve "$SITE_HOST:443:127.0.0.1" -fsS --connect-timeout 2 --max-time 5 "https://$SITE_HOST/healthz" 2>/dev/null)" || response=''
  if [[ $response == '{"service":"nexus-watchdog"}' ]]; then ready=true; break; fi
  sleep 3
done
if [[ $ready != true ]]; then
  fail 'HTTPS ist noch nicht bereit. Im Hosting-Panel TCP-Ports 80 und 443 für eingehende Verbindungen freigeben. Bei eigener Domain muss DNS auf diesen Server zeigen. Details: bash manage.sh logs — danach bash start.sh erneut ausführen.'
fi
if setup_pending; then
  # Restart only an unfinished setup to issue a fresh code after certificate work.
  compose restart watchdog
  compose up -d --wait --wait-timeout 90 watchdog
  show_setup_code
fi
printf '\nNEXUS läuft; HTTPS und Zertifikat wurden auf dem Server geprüft.\n'
printf 'Jetzt im Browser öffnen: https://%s\n' "$SITE_HOST"
printf 'Falls der Browser nicht verbindet: TCP-Port 443 im Hosting-Panel freigeben.\n'
printf 'Hilfe: bash manage.sh status | logs | setup-code\n'
