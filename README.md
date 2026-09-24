# NEXUS Watchdog

World-of-Tanks-Clan-Abgänge verfolgen, eine Watchlist verwalten und Benachrichtigungen an Discord senden – mit einem Web-Dashboard im Nexus-Hub-Stil.

## Funktionen

- Regelmäßige Überprüfung beobachteter Clans über die Wargaming-EU-API
- Abgangshistorie mit Spielernamen, Personal Rating und Profil-Link
- Optionale Discord-Benachrichtigungen und CSV-Export
- Dashboard mit Logs, Scan-Statistiken und manueller Scanner-Steuerung
- Speicherung in Firebase Realtime Database
- Linux-Installer mit Systemd-Dienst und scrypt-Passworthash

## Voraussetzungen

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

Ersetze `DEIN_BENUTZER` und `DEIN_REPOSITORY` durch deine GitHub-Angaben:

```bash
git clone https://github.com/DEIN_BENUTZER/DEIN_REPOSITORY.git nexus-watchdog
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

Die Tests prüfen Passwortverifikation, CSRF-Abwehr, die Zusammenführung paralleler Watchlist-Änderungen und die Syntax des generierten Browser-JavaScripts. Sie benötigen keinen Cloud-Zugang.

Linux-Installation, Live-Firebase, Discord-Zustellung, HTTPS und Browserdarstellung müssen zusätzlich auf dem Zielsystem geprüft werden. Der Installer wurde bisher nicht auf einem Linux-Server ausgeführt.
