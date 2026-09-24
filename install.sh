#!/usr/bin/env bash
set -euo pipefail
# Ubuntu/Debian with systemd. Existing configuration is preserved.
[[ $EUID -eq 0 ]] || { echo 'Bitte mit sudo bash install.sh ausführen.'; exit 1; }
command -v node >/dev/null || { echo 'Bitte zuerst Node.js 22 oder neuer installieren.'; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { echo 'Node.js >=22 erforderlich.'; exit 1; }
command -v npm >/dev/null
command -v systemctl >/dev/null
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target_dir=/opt/nexus-bot
id nexus >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin nexus
install -d -o root -g nexus -m 0750 "$target_dir"
for filename in nexus-bot.js package.json hash-password.js bootstrap.js setup.js setup.html setup.css setup-client.js; do
  if [[ "$source_dir" != "$target_dir" ]]; then install -o root -g nexus -m 0640 "$source_dir/$filename" "$target_dir/$filename"; fi
done
if [[ ! -f "$target_dir/.env" ]]; then
  install -o root -g nexus -m 0640 "$source_dir/.env.example" "$target_dir/.env"
fi
echo 'Konfiguration bearbeiten: Firebase-JSON, Datenbank-URL und WG_API_KEY eintragen.'
editor_cmd="${EDITOR:-nano}"
"$editor_cmd" "$target_dir/.env"
read -r -s -p 'Neues Dashboard-Passwort (mind. 12 Zeichen, leer = unverändert): ' dashboard_password
printf '\n'
if [[ -n "$dashboard_password" ]]; then
  password_hash="$(printf '%s' "$dashboard_password" | node "$target_dir/hash-password.js")"
  sed -i '/^DASHBOARD_PASS=/d; /^DASHBOARD_PASS_HASH=/d' "$target_dir/.env"
  printf '\nDASHBOARD_PASS_HASH=%s\n' "$password_hash" >> "$target_dir/.env"
  unset dashboard_password password_hash
fi
chown root:nexus "$target_dir/.env"
chmod 0640 "$target_dir/.env"
cd "$target_dir"
npm install --omit=dev --ignore-scripts
node -e 'require("dotenv").config(); const e=process.env; const c=JSON.parse(e.FIREBASE_CREDENTIALS||"{}"); if(!c.private_key||c.project_id==="DEIN_PROJEKT"||!e.FIREBASE_DATABASE_URL||(!e.DASHBOARD_PASS&&!e.DASHBOARD_PASS_HASH)) { console.error("Bitte Firebase und Dashboard-Passwort vollständig konfigurieren."); process.exit(1); }'
node --check nexus-bot.js
install -o root -g root -m 0644 "$source_dir/nexus-bot.service" /etc/systemd/system/nexus-bot.service
systemctl daemon-reload
systemctl enable nexus-bot
systemctl restart nexus-bot
systemctl --no-pager status nexus-bot
echo 'Lokal erreichbar auf 127.0.0.1:3000. HTTPS-Einrichtung siehe README.md.'
