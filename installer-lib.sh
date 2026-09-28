#!/usr/bin/env bash
# Shared by the installer, maintenance commands and Linux regression tests.
fail() { printf '\n%s\n' "$*" >&2; exit 1; }

public_ipv4() {
  local value="$1" a b c d part
  [[ $value =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS=. read -r a b c d <<< "$value"
  for part in "$a" "$b" "$c" "$d"; do
    [[ $part == 0 || $part != 0* ]] || return 1
    (( 10#$part <= 255 )) || return 1
  done
  (( a > 0 && a < 224 && a != 10 && a != 127 )) || return 1
  (( a != 100 || b < 64 || b > 127 )) || return 1
  (( a != 169 || b != 254 )) || return 1
  (( a != 172 || b < 16 || b > 31 )) || return 1
  (( a != 192 || (b != 168 && !(b == 0 && (c == 0 || c == 2)) && !(b == 88 && c == 99)) )) || return 1
  (( a != 198 || (b != 18 && b != 19 && !(b == 51 && c == 100)) )) || return 1
  (( a != 203 || b != 0 || c != 113 )) || return 1
}

valid_address() {
  local value="$1" label
  if [[ $value =~ ^[0-9.]+$ ]]; then public_ipv4 "$value"; return; fi
  [[ ${#value} -le 253 && $value == *.* && $value != *. && $value != *..* ]] || return 1
  [[ ${value##*.} =~ ^[a-zA-Z][a-zA-Z-]+$ ]] || return 1
  local -a labels
  IFS=. read -r -a labels <<< "$value"
  for label in "${labels[@]}"; do
    [[ ${#label} -le 63 && $label =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]] || return 1
  done
}

detect_address() {
  local candidate endpoint
  candidate="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')" || true
  if public_ipv4 "$candidate"; then printf '%s\n' "$candidate"; return; fi
  # NAT fallback; ACME must still validate incoming traffic to this address.
  for endpoint in https://api.ipify.org https://checkip.amazonaws.com; do
    candidate="$(curl --noproxy '*' -4fsS --connect-timeout 3 --max-time 8 "$endpoint" 2>/dev/null)" || continue
    if public_ipv4 "$candidate"; then printf '%s\n' "$candidate"; return; fi
  done
  return 1
}

load_compose() {
  compose_files=(-f compose.registry.yaml)
  SITE_HOST=''
  if [[ -f .site-host ]]; then
    IFS= read -r SITE_HOST < .site-host || true
    valid_address "$SITE_HOST" || fail 'Die gespeicherte Adresse ist ungültig. Erneut starten mit: bash start.sh --address DEINE_ADRESSE'
    compose_files+=(-f compose.https.yaml)
  fi
  export SITE_HOST
  if [[ -f .dashboard-updater ]]; then compose_files+=(-f compose.updater.yaml); fi
}

select_docker() {
  command -v docker >/dev/null 2>&1 || fail 'Docker fehlt. Bitte zuerst bash start.sh ausführen.'
  docker_cmd=(docker)
  if ! docker info >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then docker_cmd=(sudo docker)
    else fail 'Docker ist nicht erreichbar. Benötigt wird ein VPS mit Administrationsrechten.'; fi
  fi
  "${docker_cmd[@]}" compose version >/dev/null 2>&1 || fail 'Docker Compose fehlt. Docker Compose 2.30 oder neuer wird benötigt.'
}
compose() { "${docker_cmd[@]}" compose "${compose_files[@]}" "$@"; }

setup_pending() {
  compose exec -T watchdog node -e 'fetch("http://127.0.0.1:3000/api/status",{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).then(j=>process.exit(j.setup===true?0:1)).catch(()=>process.exit(2))'
}

show_setup_code() {
  local container started line
  container="$(compose ps -q watchdog)"
  started="$("${docker_cmd[@]}" inspect --format '{{.State.StartedAt}}' "$container")"
  for attempt in {1..15}; do
    line="$(compose logs --no-color --since "$started" watchdog 2>/dev/null | grep -F 'Einrichtungscode (30 Minuten gültig):' | tail -n 1)" || true
    if [[ -n $line ]]; then printf '\n%s\n' "$line"; return; fi
    sleep 1
  done
  fail 'Einrichtungscode noch nicht verfügbar. Diagnose: bash manage.sh logs'
}
