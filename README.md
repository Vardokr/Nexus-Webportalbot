# NEXUS Watchdog

World-of-Tanks-Clan-Abgänge verfolgen, Watchlist verwalten und optional Discord-Benachrichtigungen senden. Das Dashboard orientiert sich am Nexus Hub.

**Für Nutzer:** [Installationsanleitung mit Auswahl des Hosting-Typs](INSTALLATION.md)

Auf unterstütztem Ubuntu oder Debian mit `git` und `sudo`:

```bash
git clone https://github.com/Vardokr/Nexus-Webportalbot.git nexus-watchdog && bash nexus-watchdog/start.sh
```

Die Auswahl erklärt zuerst, welcher Hosting-Typ unterstützt wird. Auf einem VPS/Rootserver installiert der Schnellstart Docker bei Bedarf, startet den Container und zeigt den einmaligen Einrichtungscode. Mit einem beliebigen öffentlichen Hostnamen, der auf den Server zeigt, richtet Caddy HTTPS ein; Firebase und Wargaming werden anschließend direkt im Browser konfiguriert, ohne SSH-Tunnel. Weder Hoster noch Server-IP sind fest voreingestellt. Verwaltetes Bot-/Gameserver-Hosting benötigt einen eigenen, tarifabhängigen Weg. Die Veröffentlichung des Images prüft der [GitHub-Workflow](.github/workflows/docker-publish.yml).

## Funktionen

- Regelmäßige Überprüfung von Clans über die Wargaming-EU-API
- Abgangshistorie mit Namen, Rating und Profil-Link
- Discord-Benachrichtigungen und CSV-Export
- Web-Dashboard mit Logs, Statistiken und Scanner-Steuerung
- Firebase Realtime Database als Datenspeicher
- Web-Einrichtung mit einmaligem Code und Verbindungsprüfung

## Betrieb

Für Docker wird [compose.registry.yaml](compose.registry.yaml) verwendet; bei HTTPS zusätzlich [compose.https.yaml](compose.https.yaml) mit [Caddyfile](Caddyfile). Der Bot-Container läuft ohne Root-Rechte und veröffentlicht Port 3000 nur auf `127.0.0.1` des Hosts. Caddy veröffentlicht 80/443 und speichert Zertifikate in einem eigenen Volume. Die Einrichtung liegt im benannten Volume `watchdog-config` unter `/data/config.json`; das Admin-Passwort wird als scrypt-Hash gespeichert. Die übrigen Zugangsdaten müssen für den laufenden Bot lesbar sein. Volumes und Serverzugang entsprechend schützen.

Eine vollständig konfigurierte `.env` überspringt den Web-Assistenten weiterhin. Als Vorlage dient [.env.example](.env.example). Für einen neuen Web-Setup-Start **keine `.env` mit Platzhaltern** anlegen.

Für HTTPS kann die [Nginx-Vorlage](nexus-bot.nginx.conf) verwendet werden. Im Assistenten dann `DASHBOARD_ORIGIN=https://deine-domain` entsprechend der öffentlichen Adresse setzen. Ohne HTTPS über einen SSH-Tunnel zugreifen.

Updates:

```bash
git pull
bash quickstart.sh
```

Nur eine Bot-Instanz pro Firebase-Pfad betreiben. Discord-Zustellung ist best-effort. Änderungen des Scan-Intervalls im Dashboard gelten bis zum Neustart; der dauerhaft konfigurierte Wert wird beim Web-Setup gespeichert.

## Entwicklung und Tests

Node.js 22 oder neuer:

```bash
npm ci --ignore-scripts
npm test
node --check nexus-bot.js
```

Die Tests prüfen Passwortverifikation, CSRF-Abwehr, die Zusammenführung paralleler Watchlist-Änderungen und den Web-Assistenten mit lokalen HTTP-Anfragen. Cloud-Verbindungen werden im Test ersetzt. Der Docker-Workflow baut das Image und führt dieselben Tests aus.

Alternativ gibt es [install.sh](install.sh) für einen Systemd-Dienst ohne Docker. Diese Variante benötigt systemweites Node.js 22 oder neuer und eine manuell konfigurierte `.env`.

`.env`, Firebase-Servicekonto-Dateien und lokale Konfigurationsdaten gehören nicht ins Repository. Vor dem Veröffentlichen eigener Forks bitte auch die Commit-Historie auf Geheimnisse prüfen.
