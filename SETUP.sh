#!/usr/bin/env bash
set -euo pipefail
exec bash "$(dirname -- "${BASH_SOURCE[0]}")/install.sh" "$@"
# Historische Anleitung (durch exec oben nicht mehr ausgeführt):
# NEXUS Watchdog v3 – Setup Anleitung
# Ubuntu 24.04 vServer

# ============================================
# 1. SYSTEM VORBEREITEN
# ============================================

# Node.js 20 LTS installieren
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Node Version prüfen (muss >= 18 sein)
node --version

# ============================================
# 2. BOT-VERZEICHNIS EINRICHTEN
# ============================================

# Eigenen Benutzer für den Bot erstellen (kein root!)
sudo useradd -r -m -s /bin/bash nexus

# Verzeichnis erstellen
sudo mkdir -p /opt/nexus-bot
sudo chown nexus:nexus /opt/nexus-bot

# Dateien kopieren
sudo cp nexus-bot.js    /opt/nexus-bot/
sudo cp package.json    /opt/nexus-bot/
sudo cp .env.example    /opt/nexus-bot/.env

# .env Datei bearbeiten (WICHTIG!)
sudo nano /opt/nexus-bot/.env

# Abhängigkeiten installieren
cd /opt/nexus-bot
sudo -u nexus npm install --omit=dev

# ============================================
# 3. PASSWORT-HASH GENERIEREN (empfohlen)
# ============================================

# SHA-256 Hash deines Passworts erzeugen:
node -e "const c=require('crypto');console.log(c.createHash('sha256').update('DEIN_PASSWORT').digest('hex'))"

# Den Hash in die .env eintragen:
# DASHBOARD_PASS_HASH=<hash>
# Dann DASHBOARD_PASS aus der .env entfernen!

# ============================================
# 4. SYSTEMD DAEMON EINRICHTEN
# ============================================

sudo cp nexus-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable nexus-bot
sudo systemctl start nexus-bot

# Status prüfen
sudo systemctl status nexus-bot

# Live Logs anschauen
sudo journalctl -u nexus-bot -f

# ============================================
# 5. NGINX + SSL EINRICHTEN (empfohlen)
# ============================================

# Nginx installieren
sudo apt install -y nginx certbot python3-certbot-nginx

# Nginx Konfiguration kopieren
sudo cp nexus-bot.nginx.conf /etc/nginx/sites-available/nexus-bot
sudo ln -s /etc/nginx/sites-available/nexus-bot /etc/nginx/sites-enabled/

# WICHTIG: Domain in der Konfiguration anpassen!
sudo nano /etc/nginx/sites-available/nexus-bot
# "DEINE_DOMAIN_ODER_IP" ersetzen

# Nginx Konfiguration testen
sudo nginx -t

# SSL Zertifikat holen (Domain muss auf deinen Server zeigen!)
sudo certbot --nginx -d deine-domain.de

# Nginx neu laden
sudo systemctl reload nginx

# ============================================
# 6. FIREBASE CREDENTIALS IN .env EINTRAGEN
# ============================================
# Den Inhalt der serviceAccountKey.json als
# EINZEILIGEN JSON-String in FIREBASE_CREDENTIALS eintragen.
# 
# Schnell-Methode (auf dem Server):
cat serviceAccountKey.json | tr -d '\n' | sed 's/"/\\"/g'
# NEIN! Lieber so:
# Öffne die JSON-Datei, kopiere den Inhalt,
# füge ihn in .env ein – wichtig: \n in private_key beibehalten!
#
# Beispiel .env Eintrag:
# FIREBASE_CREDENTIALS={"type":"service_account","project_id":"wot-clan-cms-c94a2",...}

# ============================================
# 7. BOT-BEFEHLE
# ============================================

# Start / Stop / Restart
sudo systemctl start   nexus-bot
sudo systemctl stop    nexus-bot
sudo systemctl restart nexus-bot

# Logs
sudo journalctl -u nexus-bot -f          # Live
sudo journalctl -u nexus-bot --since today  # Heute
sudo journalctl -u nexus-bot -n 100      # Letzte 100 Zeilen

# ============================================
# 8. FIREWALL (optional aber empfohlen)
# ============================================

sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# Port 3000 NICHT freigeben (nginx übernimmt das)!
sudo ufw enable
sudo ufw status
