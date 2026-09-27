#!/usr/bin/env bash
set -euo pipefail
# Legacy entry point for the non-Docker Systemd installer.
exec bash "$(dirname -- "${BASH_SOURCE[0]}")/install.sh" "$@"
