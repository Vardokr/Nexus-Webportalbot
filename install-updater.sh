#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
source ./installer-lib.sh
umask 077
elevate=()
if (( EUID != 0 )); then elevate=(sudo); fi
command -v systemctl >/dev/null || fail 'Dashboard-Updates benötigen systemd.'
if ! command -v python3 >/dev/null; then
  "${elevate[@]}" apt-get update
  "${elevate[@]}" apt-get install -y --no-remove python3
fi
select_docker
load_compose
# Render resolved configuration into a root-owned snapshot. The service never
# executes scripts from the checkout or accepts compose/image arguments via HTTP.
temporary="$(mktemp)"
trap 'rm -f -- "$temporary"' EXIT
compose -f compose.updater.yaml config --format json > "$temporary"
python3 - "$temporary" <<'PY'
import json, sys
config = json.load(open(sys.argv[1]))
assert config['services']['watchdog']['image'] == 'ghcr.io/vardokr/nexus-webportalbot:latest', 'Dashboard updater requires the official image'
PY
"${elevate[@]}" install -d -m 0700 /opt/nexus-updater
"${elevate[@]}" install -d -m 0755 /run/nexus-updater
"${elevate[@]}" install -m 0600 "$temporary" /opt/nexus-updater/compose.json
"${elevate[@]}" install -m 0600 updater.py /opt/nexus-updater/updater.py
"${elevate[@]}" install -m 0644 nexus-updater.service /etc/systemd/system/nexus-updater.service
"${elevate[@]}" systemctl daemon-reload
"${elevate[@]}" systemctl enable nexus-updater
"${elevate[@]}" systemctl restart nexus-updater
"${elevate[@]}" systemctl is-active --quiet nexus-updater
touch .dashboard-updater
