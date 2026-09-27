#!/usr/bin/env bash
# CI only: isolated local certificates; no public ACME requests or credentials.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
: "${NEXUS_IMAGE:?Set the freshly built test image}"
export SITE_HOST=localhost
test_project="nexus-ci-${GITHUB_RUN_ID:-$$}"
test_dir="$(mktemp -d)"
dc=(docker compose -p "$test_project" -f compose.registry.yaml -f compose.https.yaml -f tests/compose.smoke.yaml)
cleanup() {
  "${dc[@]}" down --volumes >/dev/null 2>&1 || true
  rm -f -- "$test_dir/root.crt" "$test_dir/adapt.json"
  rmdir -- "$test_dir"
}
trap cleanup EXIT
docker pull caddy:2.11.4-alpine
for test_address in 93.184.216.34 example.com; do
  docker run --rm -e SITE_HOST="$test_address" -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.11.4-alpine caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile > "$test_dir/adapt.json"
  python3 - "$test_dir/adapt.json" <<'PY'
import json, sys
config = json.load(open(sys.argv[1]))
issuers = config['apps']['tls']['automation']['policies'][0]['issuers']
assert len(issuers) == 1 and issuers[0]['module'] == 'acme'
assert issuers[0]['profile'] == 'shortlived'
assert issuers[0]['ca'] == 'https://acme-v02.api.letsencrypt.org/directory'
PY
done
"${dc[@]}" config --quiet
"${dc[@]}" up -d --wait --wait-timeout 90
"${dc[@]}" exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$test_dir/root.crt"
for attempt in {1..20}; do
  if response="$(curl --cacert "$test_dir/root.crt" -fsS https://localhost:18443/healthz 2>/dev/null)"; then break; fi
  sleep 1
done
[[ $response == '{"service":"nexus-watchdog"}' ]]
curl --cacert "$test_dir/root.crt" -fsS https://localhost:18443/ | grep -q 'Dein Watchdog'
# A forged X-Forwarded-For must not bypass the setup limiter through Caddy.
for attempt in {1..21}; do
  status="$(curl --cacert "$test_dir/root.crt" -sS -o /dev/null -w '%{http_code}' -X POST -H "X-Forwarded-For: 192.0.2.$attempt" https://localhost:18443/api/setup)"
done
[[ $status == 429 ]]
token="$("${dc[@]}" logs --no-color watchdog | sed -n 's/.*Einrichtungscode (30 Minuten gültig): //p' | tail -1)"
[[ -n $token ]]
status="$(curl --cacert "$test_dir/root.crt" -sS -o /dev/null -w '%{http_code}' -X POST -H "X-Setup-Token: $token" -H 'Content-Type: application/json' -d '{}' https://localhost:18443/api/setup)"
[[ $status == 400 ]]
printf 'HTTPS, setup page and proxy isolation passed.\n'
