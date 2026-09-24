# NEXUS Watchdog

World-of-Tanks-Clan-Abgänge verfolgen, eine Watchlist verwalten und Benachrichtigungen an Discord senden – mit einem Web-Dashboard im Nexus-Hub-Stil.

## Funktionen

- Regelmäßige Überprüfung beobachteter Clans über die Wargaming-EU-API
- Abgangshistorie mit Spielernamen, Personal Rating und Profil-Link
- Optionale Discord-Benachrichtigungen und CSV-Export
- Dashboard mit Logs, Scan-Statistiken und manueller Scanner-Steuerung
- Speicherung in Firebase Realtime Database
- Linux-Installer mit Systemd-Dienst und scrypt-Passworthash
- Docker Compose für den Betrieb ohne separate Node.js-Installation

## Privates Docker-Image über GitHub (empfohlen)

### Neu: Einrichtung vollständig im Browser

Eine `.env` ist für eine neue Docker-Installation nicht mehr erforderlich. Nach Registry-Anmeldung die aktuelle `compose.registry.yaml` herunterladen und starten:

```bash
docker compose -f compose.registry.yaml pull
docker compose -f compose.registry.yaml up -d
docker compose -f compose.registry.yaml logs --tail=100 watchdog
```

In den Logs erscheint ein **Einrichtungscode**, gültig für 30 Minuten. Der Code wird nur dort angezeigt, nicht auf der Webseite. Für einen neuen Code den noch nicht eingerichteten Container neu starten.

Auf dem eigenen Rechner einen SSH-Tunnel zum Server öffnen:

```bash
ssh -L 3000:127.0.0.1:3000 DEIN_BENUTZER@SERVER_IP
```

Dann [http://localhost:3000](http://localhost:3000) im Browser öffnen. Alternativ ist Zugriff über einen korrekt eingerichteten HTTPS-Reverse-Proxy möglich. Port 3000 bleibt auf dem Server lokal gebunden.

Der Web-Assistent führt durch:

1. Einrichtungscode aus den Logs eingeben.
2. Firebase-Servicekonto als JSON-Datei hochladen und die Realtime-Database-URL eintragen.
3. Workspace, Scan-Intervall und Wargaming-Key setzen; Discord ist optional.
4. Administrator und Passwort mit mindestens 12 Zeichen anlegen.
5. Verbindungen prüfen und speichern.

Die Verbindungsprüfungen lesen nur Daten; sie senden keine Discord-Nachricht. Nach Abschluss startet der Scanner, der Assistent wird geschlossen und das Dashboard verlangt die neue Administrator-Anmeldung. Es gibt keinen öffentlich erreichbaren Reset-Endpunkt.

Die Konfiguration wird mit Dateimodus `0600` im benannten Volume `watchdog-config` unter `/data/config.json` gespeichert. Das Dashboard-Passwort liegt als scrypt-Hash vor; Firebase-/API-Zugangsdaten müssen für den Betrieb lesbar gespeichert werden. Das Volume vertraulich behandeln und sichern. **`docker compose down -v` löscht die Einrichtung.** Normales `down` und Image-Updates behalten sie bei. Docker verwendet für Volumes standardmäßig einen Projektpräfix; denselben Projektordner/-namen für Updates verwenden.

Bestehende vollständig konfigurierte `.env`-Installationen überspringen den Assistenten. Nichtleere Umgebungsvariablen haben beim Neustart Vorrang vor gespeicherten Werten. Keine Vorlage mit Platzhaltern neben Compose ablegen, wenn der Web-Assistent verwendet werden soll. Für spätere Änderungen die authentifizierten Dashboard-Einstellungen bzw. die geschützte Konfiguration auf dem Server verwenden; ein vollständiger Web-Editor für alle gespeicherten Felder ist noch nicht enthalten.

Die folgenden Anmeldeschritte für die private Registry bleiben erforderlich. Die manuelle `.env`- und Hash-Einrichtung weiter unten ist nur die Alternative zum Web-Assistenten.

Repository: [Vardokr/Nexus-Webportalbot](https://github.com/Vardokr/Nexus-Webportalbot)

Image nach der ersten erfolgreichen Veröffentlichung: `ghcr.io/vardokr/nexus-webportalbot:latest`.

### Einmalig: Veröffentlichung aktivieren

1. Die Projektdateien einschließlich `.github/workflows/docker-publish.yml`, `Dockerfile`, `.dockerignore` und `package-lock.json` in den Standardbranch des privaten Repositorys übernehmen. `.env` und Servicekonto-Dateien nicht hochladen.
2. Unter **Actions → Docker image** den Lauf prüfen. Der Workflow testet und baut das Image. Nur der Standardbranch des privaten Original-Repositorys veröffentlicht; Pull Requests und andere Branches veröffentlichen nichts. Der Standardbranch wird automatisch erkannt.
3. Nach erfolgreichem Lauf unter **Packages → nexus-webportalbot → Package settings** prüfen, dass die Sichtbarkeit **Private** ist und das Repository Zugriff hat. Neue Container-Pakete sind laut [GitHub-Dokumentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) zunächst privat; vorhandene Pakete können eine andere Sichtbarkeit haben. Der Workflow ändert diese Einstellung nicht.

Die Veröffentlichung verwendet den eingebauten `GITHUB_TOKEN` mit `packages: write`; zusätzliche Registry-Zugangsdaten sind für Actions nicht nötig. Falls deine Repository-Richtlinien Actions einschränken, müssen Checkout und Paketveröffentlichung dort zugelassen werden. Das Image wird für **Linux amd64** gebaut; ARM-Server werden durch diesen Workflow noch nicht nativ unterstützt.

### Auf dem Server: anmelden und herunterladen

Docker mit Compose >=2.30 installieren und `compose.registry.yaml` auf dem Server ablegen. Die Konfiguration kann anschließend über den Web-Assistenten erfolgen. Der Quellcode und Node.js sind zum Betrieb des fertigen Images nicht erforderlich.

Zum Lesen des privaten Images einen **Personal Access Token (classic)** mit `read:packages` für einen Benutzer mit Zugriff auf das Paket erstellen. Den Token nicht ins Repository oder in die Bot-`.env` schreiben. GitHub beschreibt die [Registry-Anmeldung hier](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry).

Auf dem Linux-Server in Bash:

```bash
read -r -s -p 'GitHub-Token (read:packages): ' ghcr_token
printf '\n'
printf '%s' "$ghcr_token" | docker login ghcr.io -u Vardokr --password-stdin
unset ghcr_token
docker compose -f compose.registry.yaml pull
```

Bei einem Token eines anderen Benutzers den Login-Namen entsprechend ersetzen. Login und Compose unter demselben Betriebssystembenutzer ausführen. Docker speichert den Login über seinen Credential Store bzw. seine lokale Konfiguration; diese geschützt halten.

Nur bei manueller `.env`-Einrichtung statt Web-Assistent: Vor dem ersten Start einen Passwort-Hash erzeugen und in `.env` als `DASHBOARD_PASS_HASH=...` eintragen:

```bash
read -r -s -p 'Dashboard-Passwort (mindestens 12 Zeichen): ' dashboard_password
printf '\n'
printf '%s' "$dashboard_password" | docker compose -f compose.registry.yaml run --rm -T --no-deps watchdog node hash-password.js
unset dashboard_password
```

Danach starten:

```bash
docker compose -f compose.registry.yaml up -d
docker compose -f compose.registry.yaml ps
docker compose -f compose.registry.yaml logs --tail=100 watchdog
```

Der Zugriff erfolgt wie unten beschrieben über SSH-Tunnel oder HTTPS. Für diese Variante bei **jedem** Compose-Befehl `-f compose.registry.yaml` verwenden. Die Datei ist eigenständig, kein Override für `compose.yaml`.

### Updates und feste Versionen

Nach einer erfolgreichen Veröffentlichung auf GitHub:

```bash
docker compose -f compose.registry.yaml pull
docker compose -f compose.registry.yaml up -d
```

Actions veröffentlicht zusätzlich `sha-VOLLSTÄNDIGE_COMMIT_ID`. Für eine feste Version oder ein Rollback den `image:`-Eintrag in `compose.registry.yaml` von `:latest` auf diesen Tag ändern und erneut pull/up ausführen. Es gibt kein automatisches Deployment auf deinen Server.

Der Workflow und die Registry-Datei sind lokal vorbereitet. Eine Veröffentlichung wurde aus dieser Arbeitsumgebung noch nicht ausgeführt.

## Alternative: Docker-Image selbst bauen

Voraussetzung: Docker Engine mit **Compose >= 2.30**, alternativ Docker Desktop mit Linux-Containern. Installationshinweise: [Docker Engine unter Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Prüfen mit `docker --version` und `docker compose version`. Die Befehle unten setzen Docker-Zugriff voraus; unter Linux gegebenenfalls `sudo` vor Docker-Befehle setzen.

### 1. Repository herunterladen und Konfiguration anlegen

```bash
git clone https://github.com/Vardokr/Nexus-Webportalbot.git nexus-watchdog
cd nexus-watchdog
cp .env.example .env
chmod 600 .env
nano .env
```

Für das private Repository ist eine GitHub-Anmeldung mit Repository-Lesezugriff erforderlich. Eine bereits konfigurierte `.env` beibehalten, nicht mit der Vorlage überschreiben. Firebase-JSON, Datenbank-URL und `WG_API_KEY` eintragen; ohne Discord `DISCORD_WEBHOOK=` setzen. Alle Variablen sind im Abschnitt **Konfiguration ausfüllen** weiter unten erklärt.

Compose liest die Datei im [raw-Format](https://docs.docker.com/reference/compose-file/services/#env_file), damit JSON, `\n` und Dollarzeichen erhalten bleiben. Werte ohne zusätzliche äußere Anführungszeichen und ohne Kommentare am Zeilenende schreiben. Beispiel: `FIREBASE_CREDENTIALS={"type":"service_account",...}` – das vollständige JSON verwenden, nicht die Auslassungspunkte. Die Datei wird nicht ins Image kopiert; die Werte werden zur Laufzeit als Umgebungsvariablen übergeben und sind für Docker-Administratoren einsehbar.

### 2. Image bauen und Passwort setzen

```bash
docker compose build --pull
```

Für einen Passwort-Hash in **Bash auf Linux**:

```bash
read -r -s -p 'Dashboard-Passwort (mindestens 12 Zeichen): ' dashboard_password
printf '\n'
printf '%s' "$dashboard_password" | docker compose run --rm -T --no-deps watchdog node hash-password.js
unset dashboard_password
```

Den ausgegebenen `scrypt:...`-Hash in `.env` als `DASHBOARD_PASS_HASH=...` eintragen. `DASHBOARD_PASS=` leer lassen. Dafür ist kein Node.js auf dem Host notwendig. Der Hash-Befehl startet keinen Scanner.

### 3. Starten und prüfen

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 watchdog
```

Der Container läuft ohne Root-Rechte und startet nach Prozessende automatisch neu, solange er nicht ausdrücklich gestoppt wurde. Der Healthcheck prüft nur die HTTP-Erreichbarkeit, nicht Firebase oder Discord; `unhealthy` allein löst keinen Neustart aus.

Der Dienst ist am Docker-Host nur unter `127.0.0.1:3000` erreichbar. Bei lokalem Docker im Browser `http://localhost:3000` öffnen; bei einem Server den unten beschriebenen SSH-Tunnel verwenden. Intern lauscht der Container auf `0.0.0.0:3000`; Compose überschreibt dafür die Host-/Port-Werte aus `.env`.

### HTTPS und Umstieg von Systemd

Die vorhandene Nginx-Vorlage kann auf dem Docker-Host weiter an `127.0.0.1:3000` weiterleiten. Bei HTTPS zusätzlich die exakte öffentliche Adresse in `.env` setzen, ohne abschließenden Schrägstrich:

```dotenv
DASHBOARD_ORIGIN=https://watchdog.example.com
```

Anschließend `docker compose up -d --force-recreate` ausführen. Bei gesetzter Adresse das Dashboard über diese Adresse benutzen. Container-interne Proxy-Verbindungen werden standardmäßig nicht als vertrauenswürdige Proxys behandelt; dadurch können Benutzer hinter dem Proxy ein IP-Limit teilen.

Falls bereits der Systemd-Bot läuft, dessen Konfiguration zunächst geschützt übernehmen und vor dem Containerstart stoppen:

```bash
sudo systemctl disable --now nexus-bot
```

Nur beim tatsächlichen Umstieg ausführen. Es darf nicht gleichzeitig eine zweite Instanz für denselben Firebase-Pfad laufen. Für Docker `install.sh` nicht zusätzlich ausführen.

### Docker-Betrieb und Updates

```bash
# Live-Logs
docker compose logs -f watchdog

# Stoppen / erneut starten
docker compose stop
docker compose up -d

# Änderungen an .env übernehmen
docker compose up -d --force-recreate

# Nach Bereitstellung einer neuen Quellversion neu bauen und starten
docker compose build --pull
docker compose up -d

# Container und Compose-Netzwerk entfernen
docker compose down
```

Die Historie liegt in Firebase; die Web-Einrichtung liegt im Docker-Volume `watchdog-config`. Volume und gegebenenfalls `.env` geschützt sichern. Normales `down` behält das Volume und Firebase-Daten bei. Das selbst gebaute Image heißt lokal `nexus-watchdog:local`; für das fertige Registry-Image siehe den ersten Abschnitt.

Dockerfile und Compose-Konfiguration sind vorbereitet, aber hier mangels Docker nicht gebaut oder gestartet worden. Den ersten Start auf dem Zielsystem anhand der Logs prüfen.

## Alternative: Installation ohne Docker

Die folgenden Schritte gelten ausschließlich für den Systemd-Installer.

### Voraussetzungen

- Ubuntu oder Debian mit systemd, SSH-Zugang und sudo-Rechten
- Node.js **22 oder neuer**, systemweit unter `/usr/bin/node`, sowie npm
- Firebase Realtime Database und eine Servicekonto-JSON-Datei
- Wargaming-Anwendungsschlüssel
- Optional: Discord-Webhook und eine Domain für HTTPS

Der Installer setzt Node.js voraus. Er installiert weder Node.js noch Nginx automatisch.

## Installation

### 1. Server vorbereiten

```bash
sudo apt update
sudo apt install -y git nano
node --version
npm --version
/usr/bin/node --version
```

Fehlt Node.js oder ist die Version kleiner als 22, installiere zunächst eine passende systemweite Version. Eine ausschließlich im Benutzerprofil installierte Node-Version reicht für den mitgelieferten Dienst nicht aus.

### 2. Projekt herunterladen

Mit Repository-Lesezugriff herunterladen:

```bash
git clone https://github.com/Vardokr/Nexus-Webportalbot.git nexus-watchdog
cd nexus-watchdog
```

Alternativ das Repository als ZIP herunterladen und entpacken oder den Projektordner mit WinSCP auf den Server kopieren. Auch die versteckte Datei `.env.example` muss vorhanden sein.

### 3. Installer starten

```bash
sudo bash install.sh
```

Der Installer:

1. Legt den Dienstbenutzer `nexus` an.
2. Kopiert die Anwendung nach `/opt/nexus-bot`.
3. Öffnet die Konfiguration im Editor.
4. Fragt ein Dashboard-Passwort ab und erzeugt einen scrypt-Hash.
5. Installiert die Abhängigkeiten und startet den Systemd-Dienst.

Eine vorhandene `.env` wird zur Bearbeitung beibehalten. `SETUP.sh` startet ebenfalls diesen Installer.

### 4. Konfiguration ausfüllen

Im Editor die Platzhalter aus [.env.example](.env.example) ersetzen:

| Variable | Beschreibung |
| --- | --- |
| `FIREBASE_CREDENTIALS` | Vollständiges Servicekonto-JSON auf einer Zeile |
| `FIREBASE_DATABASE_URL` | Exakte URL deiner Realtime Database, einschließlich Region |
| `WG_API_KEY` | Wargaming-Anwendungsschlüssel |
| `CLAN_ID` | Workspace-Schlüssel, z. B. `ODIN`; keine numerische WoT-Clan-ID erforderlich |
| `DISCORD_WEBHOOK` | Webhook-URL; ohne Discord leer lassen |
| `DASHBOARD_USER` | Dashboard-Anmeldename, standardmäßig `admin` |
| `SCAN_INTERVAL` | Scan-Intervall von 10 bis 1440 Minuten, standardmäßig `120` |
| `DASHBOARD_PORT` | Lokaler HTTP-Port, standardmäßig `3000` |
| `DASHBOARD_HOST` | Für SSH-Tunnel oder Nginx bei `127.0.0.1` belassen |

`CLAN_ID=ODIN` verwendet den Datenbankpfad `clans/ODIN/clan_watchdog`. Die tatsächlich beobachteten Clans werden später im Dashboard hinzugefügt.

Das Firebase-JSON muss vollständig sein. Die Zeichenfolge `\n` innerhalb von `private_key` erhalten und nicht durch echte Zeilenumbrüche ersetzen. Zugangsdaten niemals ins Repository hochladen.

Für den ersten Start diese Werte beibehalten:

```dotenv
CLAN_ID=ODIN
SCAN_INTERVAL=120
DASHBOARD_PORT=3000
DASHBOARD_HOST=127.0.0.1
DASHBOARD_USER=admin
DASHBOARD_PASS=
```

In nano mit **Strg+O**, **Enter** speichern und mit **Strg+X** schließen.

Anschließend ein Dashboard-Passwort mit mindestens **12 Zeichen** eingeben. Während der Eingabe erscheinen keine Zeichen. Der Installer schreibt `DASHBOARD_PASS_HASH` in die `.env`. Bei einer Erstinstallation das Passwort nicht leer lassen.

### 5. Dienst prüfen

```bash
sudo systemctl status nexus-bot --no-pager
```

Der Status sollte `active (running)` sein. Die letzten Meldungen anzeigen:

```bash
sudo journalctl -u nexus-bot -n 100 --no-pager
```

## Dashboard öffnen

### Sicherer Erstzugriff über SSH

Auf deinem eigenen Rechner, beispielsweise in Windows PowerShell:

```powershell
ssh -L 3000:127.0.0.1:3000 DEIN_BENUTZER@SERVER_IP
```

Die Verbindung geöffnet lassen und im Browser [http://localhost:3000](http://localhost:3000) aufrufen. Mit dem konfigurierten Benutzernamen und Passwort anmelden.

Ist der lokale Port 3000 bereits belegt, stattdessen `-L 3001:127.0.0.1:3000` verwenden und `http://localhost:3001` öffnen. Auf dem Server muss Port 3000 dafür nicht öffentlich freigegeben werden.

Unter **Watchlist** einen Clan-Tag hinzufügen und anschließend einen Scan starten. Abgänge werden anhand der Mitgliedschaft seit der Aufnahme in die Watchlist erkannt; frühere Abgänge werden nicht nachgeladen.

### Optional: Domain und HTTPS

Für öffentlichen Zugriff den Bot hinter Nginx mit einem gültigen TLS-Zertifikat betreiben. Die Vorlage liegt in [nexus-bot.nginx.conf](nexus-bot.nginx.conf).

1. Domain auf den Server zeigen lassen und Ports 80/443 erreichbar machen.
2. Nginx und Certbot installieren.
3. Zuerst ein Zertifikat für die Domain beschaffen. Die TLS-Vorlage erst aktivieren, wenn die darin referenzierten Zertifikatsdateien existieren.
4. Alle Domain- und Zertifikat-Platzhalter in der Vorlage ersetzen.
5. Die Konfiguration als Nginx-Site einbinden. `limit_req_zone` gehört in den `http`-Kontext; der übliche `sites-enabled`-Include liegt dort.
6. Mit `sudo nginx -t` prüfen und anschließend Nginx neu laden.
7. Automatische Zertifikatsverlängerung einrichten und prüfen.

Falls Certbot im Standalone-Modus verwendet wird, benötigt es für Ausstellung und Verlängerung einen freien Port 80. Auf Servern mit bestehenden Websites deren Nginx-/Zertifikatsverwaltung verwenden.

`DASHBOARD_HOST=127.0.0.1` beibehalten. Bei geändertem Dashboard-Port auch `proxy_pass` in der Nginx-Konfiguration anpassen.

## Betrieb und Updates

```bash
# Live-Logs
sudo journalctl -u nexus-bot -f

# Neustarten, stoppen oder starten
sudo systemctl restart nexus-bot
sudo systemctl stop nexus-bot
sudo systemctl start nexus-bot

# Konfiguration bearbeiten; danach neu starten
sudo nano /opt/nexus-bot/.env
sudo systemctl restart nexus-bot
```

Für ein Update die neue Version im Quellordner bereitstellen und dort erneut `sudo bash install.sh` ausführen. Bei unverändertem Passwort die Passwortabfrage leer bestätigen. Der Installer startet den Dienst neu. Eigene Anpassungen und die Konfiguration vor einem Update sichern; Sicherungen der `.env` ebenfalls vertraulich behandeln.

## Sicherheit und bekannte Grenzen

- `.env` und Servicekonto-Dateien nicht veröffentlichen. Die mitgelieferte `.gitignore` schützt übliche Dateinamen, aber nicht beliebig umbenannte Geheimnisdateien.
- Neue Passwörter werden mit scrypt gespeichert. Bestehende SHA-256-Hashes und Klartext-Konfigurationen bleiben kompatibel; ein neuer Hash hat Vorrang vor `DASHBOARD_PASS`.
- `WG_API_KEY` und `DISCORD_WEBHOOK` bevorzugt in `.env` konfigurieren. Bestehende Firebase-Einstellungen haben Vorrang und werden nicht automatisch migriert oder gelöscht.
- Den Firebase-Watchdog-Pfad auf vertrauenswürdige Benutzer beschränken. Das Admin SDK umgeht Datenbankregeln; diese Regeln müssen insbesondere Zugriffe anderer Clients schützen.
- Nur **eine Bot-Instanz pro Datenbankpfad** betreiben.
- Discord-Zustellung ist best-effort. Fehler werden protokolliert; es gibt keine dauerhafte Warteschlange für erneute Zustellung.
- Intervalländerungen im Dashboard gelten bis zum Neustart. Für dauerhafte Änderungen `SCAN_INTERVAL` in `.env` setzen.
- Schreibende API-Anfragen benötigen den `X-CSRF-Token` aus einer authentifizierten GET-Antwort. Das Dashboard übermittelt ihn automatisch.

## Fehlerbehebung

| Problem | Prüfung / Lösung |
| --- | --- |
| Dienst startet nicht | `journalctl` prüfen; Node unter `/usr/bin/node`, Firebase-JSON und Dashboard-Passwort kontrollieren |
| Firebase-JSON ungültig | Vollständiges JSON auf einer Zeile einsetzen; `\n` im privaten Schlüssel erhalten |
| Kein API-Key / keine Scans | `WG_API_KEY`, eventuell vorrangige Firebase-Einstellungen und Watchlist prüfen |
| Dashboard nicht erreichbar | Dienststatus, SSH-Tunnel und lokalen Port prüfen |
| Anmeldung schlägt fehl | Benutzername prüfen; ein vorhandener Passwort-Hash überschreibt das Klartext-Passwort |
| CSRF-Fehler nach Neustart | Dashboard neu laden und Aktion wiederholen |
| Keine Discord-Nachricht | Gültigen Webhook konfigurieren; Logs prüfen; erst neue erkannte Abgänge erzeugen Nachrichten |
| Shell meldet `$'\r'` | Shell-Dateien vor Upload mit Unix-Zeilenenden (LF) speichern |

## Tests

Im Quellordner ausführen, da der Installer die Testdatei nicht nach `/opt/nexus-bot` kopiert:

```bash
npm test
node --check nexus-bot.js
```

Die Tests prüfen Passwortverifikation, CSRF-Abwehr, die Zusammenführung paralleler Watchlist-Änderungen, Browser-JavaScript sowie den Web-Assistenten mit echten lokalen HTTP-Anfragen. Die Cloud-Verbindungsprüfung wird im Test ersetzt; echte Zugangsdaten werden nicht benötigt. Vor dem Test `npm ci --ignore-scripts` ausführen.

Linux-Installation, Live-Firebase, Discord-Zustellung, HTTPS und Browserdarstellung müssen zusätzlich auf dem Zielsystem geprüft werden. Der Installer wurde bisher nicht auf einem Linux-Server ausgeführt.
