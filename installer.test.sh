#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
source ./installer-lib.sh
for value in 8.8.8.8 93.184.216.34 example.com bot.example.com; do
  valid_address "$value" || fail "Valid address rejected: $value"
done
for value in 127.0.0.1 10.0.0.1 192.168.1.2 100.64.0.1 169.254.1.2 203.0.113.1 256.1.2.3 08.1.2.3 224.1.2.3 'x;echo.bad' https://example.com a..com -bad.example.com example.com/; do
  if valid_address "$value"; then fail "Unsafe address accepted: $value"; fi
done
ip() { printf '1.1.1.1 dev eth0 src 93.184.216.34\n'; }
curl() { fail 'External IP detection unexpectedly used'; }
[[ $(detect_address) == 93.184.216.34 ]]
ip() { printf '1.1.1.1 dev eth0 src 10.0.0.2\n'; }
curl() { printf '8.8.8.8'; }
[[ $(detect_address) == 8.8.8.8 ]]
curl() { printf 'malicious.example/'; }
if detect_address; then fail 'Detection accepted an invalid response'; fi
temp_dir="$(mktemp -d)"
trap 'rm -f -- "$temp_dir/.site-host"; rmdir -- "$temp_dir"' EXIT
cd "$temp_dir"
printf '93.184.216.34\n' > .site-host
load_compose
[[ $SITE_HOST == 93.184.216.34 && ${#compose_files[@]} == 4 ]]
docker_cmd=(printf '%s\n')
[[ $(compose logs) == *'compose.https.yaml'* ]]
printf 'Installer regression checks passed.\n'
