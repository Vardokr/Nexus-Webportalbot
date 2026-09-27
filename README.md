# NEXUS Watchdog

World-of-Tanks-Clans beobachten, Abgänge verfolgen und optional Discord-Benachrichtigungen erhalten.

## Installation

Für einen Linux-VPS/Rootserver mit Ubuntu 22.04/24.04/26.04 oder Debian 12/13, x86-64 und root/sudo-Zugang. Eine öffentliche IPv4 und freie, eingehend erreichbare TCP-Ports 80/443 werden benötigt.

In die **Serverkonsole** kopieren:

```bash
curl -fsSL https://raw.githubusercontent.com/Vardokr/Nexus-Webportalbot/main/bootstrap-install.sh -o nexus-install.sh && bash nexus-install.sh
```

Der Installer lädt das Projekt, installiert fehlende Voraussetzungen und Docker, erkennt die öffentliche IPv4 und richtet HTTPS ein. Danach erscheinen eine Browseradresse und ein Einrichtungscode. Adresse öffnen und dem Web-Assistenten folgen. Keine eigene Domain und kein SSH-Tunnel erforderlich.

Eine bestehende Installation aktualisieren:

```bash
cd nexus-watchdog
git pull --ff-only && bash start.sh
```

[Schritt-für-Schritt-Anleitung und Hilfe](INSTALLATION.md)

## Betrieb

- `bash manage.sh status`: Zustand der Dienste
- `bash manage.sh logs`: letzte Meldungen
- `bash manage.sh restart`: Dienste neu starten
- `bash manage.sh setup-code`: neuen Code für einen noch offenen Assistenten erzeugen

Die Befehle werden im Projektordner ausgeführt und laden die gespeicherte Adresse selbst. Eine eigene Domain oder andere öffentliche IPv4 kann mit `bash start.sh --address DEINE_ADRESSE` gesetzt werden.

Der Bot läuft ohne Root-Rechte. Port 3000 bleibt an 127.0.0.1 gebunden. Caddy 2.11 nutzt ausdrücklich Let's Encrypt mit dem Profil `shortlived`, auch für öffentliche IP-Adressen; Zertifikate werden automatisch erneuert. Die Einrichtung liegt im Volume `watchdog-config`, Zertifikate in `caddy-data`. Verbindungsdaten sind für den Dienst lesbar; das Admin-Passwort ist als scrypt-Hash gespeichert. Volumes sichern und nicht mit `down -v` löschen.

Öffentliche IP-Zertifikate sind etwa sechs Tage gültig. Für die Erneuerung muss der Server dauerhaft über die benötigten Ports erreichbar bleiben. Der Installer prüft lokal das vertrauenswürdige Zertifikat und die Antwort des Bots. Eine zusätzliche Firewall des Hosters kann den Browserzugriff trotzdem blockieren.

Die automatische IPv4-Ermittlung nutzt zuerst die Netzwerkschnittstelle. Hinter NAT werden nötigenfalls api.ipify.org und checkip.amazonaws.com abgefragt; eine eingehende Weiterleitung bleibt dort erforderlich. IPv6-only-Server und ARM werden in diesem Schnellstart noch nicht unterstützt.

Verwaltete Bot-/Gameserver-Tarife brauchen Node.js, persistenten Speicher und einen HTTPS-Webzugang des Anbieters. Sie sind kein Ersatz für die Administrationsrechte, die der automatische VPS-Installer benötigt.

## Funktionen und Entwicklung

Dashboard im Nexus-Hub-Stil, Watchlist, regelmäßige Wargaming-EU-Abfragen, Abgangshistorie, Discord und CSV-Export. Firebase Realtime Database speichert die Clans. Pro Firebase-Pfad nur eine Bot-Instanz betreiben.

Mit Node.js 22 oder neuer:

```bash
npm ci --ignore-scripts
npm test
```

Die CI prüft zusätzlich Bash-Skripte, die Adresserkennung, Docker-Start, Caddy-Konfiguration für IP und Domain sowie HTTPS zum Assistenten mit einer lokalen Test-CA. Dabei werden keine öffentlichen Zertifikate angefordert und keine echten Firebase-Zugangsdaten benutzt.

`install.sh` bleibt eine alternative Systemd-Installation für erfahrene Nutzer. `.env`, Servicekonto-Dateien und lokale Konfiguration gehören nicht ins Repository.
