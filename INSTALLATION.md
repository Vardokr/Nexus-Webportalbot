# NEXUS Watchdog installieren

Diese Anleitung richtet sich an Nutzer mit Zugriff auf das private Repository und das private Docker-Image. Die [aktuelle Version wurde erfolgreich gebaut](https://github.com/Vardokr/Nexus-Webportalbot/actions/runs/36045808063). Der Bot wird über einen Assistenten im Browser eingerichtet; eine `.env`-Datei musst du dafür nicht erstellen.

## Kurzfassung

Nach der einmaligen GitHub-Anmeldung mit `repo` und `read:packages` reicht auf dem Linux-Server:

```bash
gh repo clone Vardokr/Nexus-Webportalbot nexus-watchdog && bash nexus-watchdog/quickstart.sh
```

Das Skript meldet Docker mit deiner GitHub-Anmeldung bei der privaten Registry an, lädt das Image, startet den Bot und zeigt den Einrichtungscode. Danach einen SSH-Tunnel öffnen und den Web-Assistenten im Browser ausfüllen. Die nötigen Zugangsdaten und alle Schritte stehen unten.

## Das brauchst du

- Einen Linux-Server mit SSH-Zugang, **Docker Engine** und **Docker Compose ab 2.30**
- Zugriff auf das private GitHub-Repository `Vardokr/Nexus-Webportalbot` **und** das zugehörige Paket in GitHub Packages
- Die JSON-Datei eines Firebase-Servicekontos, die URL deiner Firebase Realtime Database und einen Wargaming-Anwendungsschlüssel
- Für die Installation über die folgenden Befehle: [GitHub CLI (`gh`)](https://cli.github.com/)

Prüfe auf dem Server:

```bash
docker --version
docker compose version
gh --version
```

Die folgenden Docker-Befehle laufen unter demselben Server-Benutzer. Falls Docker bei dir nur mit `sudo` funktioniert, führe **alle** Docker-Befehle einschließlich `docker login` mit `sudo` aus.

## 1. GitHub-Zugriff einrichten

Erstelle in GitHub einen **Personal Access Token (classic)** mit den Berechtigungen `repo` (für das private Repository) und `read:packages` (für das private Image). Gib ihn nur auf deinem Server ein, nicht in einem Chat oder im Repository. Ein Token eines anderen Benutzers ist ebenfalls möglich, wenn dieser Zugriff auf Repository und Paket hat; ersetze dann den Benutzernamen beim Docker-Login.

Auf dem Server in Bash:

```bash
read -r -s -p 'GitHub-Token: ' github_token
printf '\n'
printf '%s' "$github_token" | gh auth login --hostname github.com --with-token
gh auth setup-git
unset github_token
```

Wenn die Anmeldung fehlschlägt, prüfe die Token-Berechtigungen und den Paket-Zugriff. `quickstart.sh` erledigt die Docker-Anmeldung mit dem bei GitHub CLI gespeicherten Token. GitHub CLI und Docker speichern die Anmeldung lokal; sichere den Server-Benutzer entsprechend ab.

## 2. Projekt herunterladen und starten

```bash
gh repo clone Vardokr/Nexus-Webportalbot nexus-watchdog && bash nexus-watchdog/quickstart.sh
```

Das Skript zeigt den **Einrichtungscode** an. Er gilt 30 Minuten. Der Container hört auf dem Server nur unter `127.0.0.1:3000`. Ein Server mit ARM-Prozessor braucht ein eigenes Image; das veröffentlichte Image wird derzeit für Linux/amd64 gebaut. Beim ersten Start keine `.env` mit Beispielwerten anlegen, sonst überspringt der Bot möglicherweise den Web-Assistenten.

## 3. Assistenten im Browser öffnen

Auf deinem **eigenen Rechner** einen SSH-Tunnel starten und geöffnet lassen:

```bash
ssh -L 3000:127.0.0.1:3000 DEIN_SERVER_BENUTZER@SERVER_IP
```

Danach [http://localhost:3000](http://localhost:3000) im Browser öffnen. Der Tunnel schützt die Übertragung der Firebase-Datei und des Passworts. Port 3000 auf dem Server nicht öffentlich freigeben.

Im Assistenten eingeben:

1. Den Einrichtungscode aus den Container-Logs
2. Die Firebase-Servicekonto-JSON-Datei und die Realtime-Database-URL
3. Den Workspace-Schlüssel, zum Beispiel `ODIN`, sowie den Wargaming-Key
4. Optional einen Discord-Webhook
5. Einen Admin-Benutzernamen und ein Passwort mit mindestens 12 Zeichen

Die öffentliche HTTPS-Adresse leer lassen, wenn du per SSH-Tunnel zugreifst. Der Assistent prüft Firebase und Wargaming vor dem Speichern. Nach erfolgreichem Abschluss das Dashboard öffnen und mit dem neuen Admin-Konto anmelden. Bei einem abgelaufenen Code den noch nicht eingerichteten Container neu starten und den neuen Code aus den Logs lesen:

```bash
docker compose -f compose.registry.yaml restart watchdog
docker compose -f compose.registry.yaml logs --tail=30 watchdog
```

## Betrieb und Updates

```bash
# Status und Logs
docker compose -f compose.registry.yaml ps
docker compose -f compose.registry.yaml logs -f watchdog

# Neue Version laden und starten
cd nexus-watchdog && git pull && bash quickstart.sh
```

Die Einrichtung liegt im Docker-Volume `watchdog-config`, die Abgangshistorie in Firebase. `docker compose down` erhält das Volume. **`docker compose down -v` entfernt das Volume und damit die gespeicherte Einrichtung.** Nutze für Updates weiterhin denselben Projektordner.

Falls auf dem Server bereits die ältere Systemd-Version läuft, diese vor dem Containerstart stoppen, damit nicht zwei Bots denselben Firebase-Pfad bearbeiten:

```bash
sudo systemctl disable --now nexus-bot
```

Weitere Details und die Alternative ohne Docker stehen in der [README](README.md).
