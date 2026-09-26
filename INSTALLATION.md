# NEXUS Watchdog installieren

Für einen neuen Linux-Server: Ein Befehl lädt das öffentliche Repository, installiert bei Bedarf Docker und startet das öffentliche Image. Die Einrichtung erfolgt anschließend im Browser.

## Voraussetzungen

- Ubuntu 22.04/24.04/26.04 oder Debian 12/13 auf **x86-64 (amd64)**
- SSH-Zugang und `sudo`-Rechte auf dem Server
- Firebase-Servicekonto als JSON-Datei, URL der Firebase Realtime Database und Wargaming-Anwendungsschlüssel

Auf anderen Linux-Distributionen Docker Engine und Docker Compose ab 2.30 selbst installieren. Das Startskript installiert Docker nur auf den genannten Systemen. Eine bestehende Docker-Installation wird nicht ersetzt; Paketkonflikte werden gemeldet, aber nicht automatisch entfernt.

## 1. Herunterladen und starten

Auf dem Server in Bash:

```bash
git clone https://github.com/Vardokr/Nexus-Webportalbot.git nexus-watchdog && bash nexus-watchdog/quickstart.sh
```

`git` muss auf dem Server vorhanden sein. Das Skript installiert bei Bedarf Docker aus dem [offiziellen Docker-APT-Repository](https://docs.docker.com/engine/install/ubuntu/), lädt `ghcr.io/vardokr/nexus-webportalbot:latest` und startet den Container. Für die Docker-Installation kann `sudo` nach deinem Server-Passwort fragen. GitHub-Anmeldung oder Token sind für die öffentlichen Downloads nicht erforderlich.

Am Ende zeigt das Skript den **Einrichtungscode** aus den Container-Logs. Er gilt 30 Minuten. Der Dienst ist nur auf `127.0.0.1:3000` des Servers erreichbar; Port 3000 muss nicht öffentlich geöffnet werden.

## 2. Einrichtung im Browser

Auf deinem eigenen Rechner einen SSH-Tunnel starten und geöffnet lassen:

```bash
ssh -L 3000:127.0.0.1:3000 DEIN_SERVER_BENUTZER@SERVER_IP
```

Im Browser [http://localhost:3000](http://localhost:3000) öffnen. Im Assistenten eingeben:

1. Einrichtungscode aus dem Server-Terminal
2. Firebase-Servicekonto-JSON-Datei und Realtime-Database-URL
3. Workspace-Schlüssel und Wargaming-Anwendungsschlüssel
4. Optional Discord-Webhook
5. Admin-Benutzername und Passwort mit mindestens 12 Zeichen

Die öffentliche HTTPS-Adresse im Assistenten leer lassen, solange du den SSH-Tunnel nutzt. Die Verbindungstests lesen Daten und senden keine Discord-Nachricht. Nach Abschluss das Dashboard öffnen und mit dem neuen Admin-Konto anmelden.

Falls der Code abläuft, auf dem Server im Projektordner:

```bash
docker compose -f compose.registry.yaml restart watchdog
docker compose -f compose.registry.yaml logs --tail=30 watchdog
```

Wenn der Serverbenutzer keinen direkten Docker-Zugriff hat, dieselben Befehle mit `sudo docker compose` ausführen. Der Schnellstart erkennt das selbst.

## Updates und Logs

Im Projektordner auf dem Server:

```bash
git pull
docker compose -f compose.registry.yaml pull
docker compose -f compose.registry.yaml up -d
docker compose -f compose.registry.yaml logs -f watchdog
```

Oder nach `git pull` erneut `bash quickstart.sh` ausführen. Die Einrichtung liegt im Docker-Volume `watchdog-config`, die Abgangshistorie in Firebase. `docker compose down` erhält das Volume; **`docker compose down -v` löscht die gespeicherte Einrichtung**. Für Updates denselben Projektordner verwenden.

Wenn bereits der ältere Systemd-Bot denselben Firebase-Pfad verwendet, ihn vor dem Docker-Start stoppen:

```bash
sudo systemctl disable --now nexus-bot
```

Weitere technische Hinweise stehen in der [README](README.md).
