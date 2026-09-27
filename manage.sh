#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
source ./installer-lib.sh
load_compose
select_docker
case "${1:-status}" in
  status) compose ps ;;
  logs) compose logs --tail=80 ;;
  restart) compose restart; compose up -d --wait --wait-timeout 90 ;;
  setup-code)
    if setup_pending; then
      compose restart watchdog
      compose up -d --wait --wait-timeout 90 watchdog
      show_setup_code
    else
      fail 'Kein offener Assistent erkannt. Der Bot ist bereits eingerichtet oder noch nicht erreichbar. Status: bash manage.sh status'
    fi
    ;;
  *) fail 'Befehle: bash manage.sh status | logs | restart | setup-code' ;;
esac
