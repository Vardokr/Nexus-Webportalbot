# NEXUS Watchdog: in drei Schritten starten

## 1. Befehl auf dem Server ausführen

Öffne die Konsole deines **Linux-VPS/Rootservers** beim Hoster oder melde dich einmal per SSH an. Kopiere diesen Befehl hinein:

```bash
curl -fsSL https://raw.githubusercontent.com/Vardokr/Nexus-Webportalbot/main/bootstrap-install.sh -o nexus-install.sh && bash nexus-install.sh
```

Der Installer lädt NEXUS in den Ordner `nexus-watchdog`, installiert fehlendes Git und Docker und richtet die sichere Browseradresse ein. Gegebenenfalls fragt sudo nach deinem Server-Passwort. Die öffentliche IP wird automatisch erkannt. Eine eigene Domain, ein DNS-Eintrag oder ein SSH-Tunnel sind für diesen Weg nicht nötig.

Unterstützt: Ubuntu 22.04/24.04/26.04 oder Debian 12/13 auf x86-64, mit root/sudo-Rechten und öffentlicher IPv4. TCP-Ports 80 und 443 müssen frei und von außen erreichbar sein. Bereits vorhandene Docker-Paketkonflikte werden gemeldet, ohne Pakete zu entfernen.

Falls `curl: command not found` erscheint: einmal `sudo apt update && sudo apt install -y curl ca-certificates` ausführen und den Installationsbefehl wiederholen. Bei einer root-Anmeldung kann `sudo` entfallen.

## 2. Browseradresse öffnen

Wenn Bot und HTTPS bereit sind, zeigt die Konsole eine Adresse wie `https://DEINE_SERVER_IP` und einen **Einrichtungscode**. Öffne die angezeigte Adresse auf deinem Rechner. Das Server-Terminal muss danach nicht offen bleiben.

Der Code gilt 30 Minuten. Wenn er abläuft, im Projektordner auf dem Server:

```bash
bash manage.sh setup-code
```

## 3. Assistenten ausfüllen

1. Einrichtungscode aus der Serverkonsole eingeben.
2. Firebase-Servicekonto-JSON auswählen und die Realtime-Database-URL eintragen.
3. Workspace-Schlüssel und Wargaming-Anwendungsschlüssel eingeben.
4. Optional einen Discord-Webhook eintragen.
5. Admin-Benutzername und ein Passwort mit mindestens 12 Zeichen festlegen.

Die öffentliche Adresse wird automatisch vorbelegt. Klicke auf **Verbindungen prüfen & Einrichtung abschließen**. Danach kannst du dich im Dashboard anmelden.

Die Firebase-Datei bekommst du in der [Firebase-Konsole](https://console.firebase.google.com/) unter Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel generieren. Die Datenbank-URL steht unter Realtime Database. Den Wargaming-Schlüssel findest du unter [Meine Anwendungen](https://developers.wargaming.net/applications/). Im Assistenten gibt es diese Hilfen ebenfalls.

## Wenn etwas nicht klappt

| Meldung | Nächster Schritt |
| --- | --- |
| HTTPS noch nicht bereit | Im Hosting-Panel eingehend TCP 80/443 freigeben; `bash manage.sh logs` zeigt die Zertifikatsmeldung. Danach `bash start.sh` erneut ausführen. |
| Browser erreicht die Adresse nicht | Besonders TCP 443 in der Firewall des Hosters prüfen. Bei NAT müssen die Ports zum Server weitergeleitet werden. |
| Port 80/443 bereits belegt | Ein bestehender Webserver benötigt eine passende Proxy-Konfiguration; der Installer stoppt hier. |
| Adresse nicht ermittelbar | `bash start.sh --address DEINE_OEFFENTLICHE_IP` ausführen. |
| Administrationsrechte fehlen | Prüfen, ob der Tarif ein VPS/Rootserver ist. Verwaltete Bot-/Gameserver benötigen eine Lösung des Anbieters. |
| Download fehlgeschlagen | Internetzugang und freien Speicher prüfen, danach erneut starten. |

Bei Zertifikatswarnungen keine Zugangsdaten eingeben. Der Installer verwendet öffentlich vertrauenswürdige Zertifikate und akzeptiert bei seiner Prüfung keine selbst signierten Zertifikate.

## Vorhandene Installation und Updates

### Updates im Dashboard

Nach einmaligem `git pull --ff-only && bash start.sh` im Installationsordner findest du unter **Einstellungen → Bot aktualisieren** die Schaltflächen **Update prüfen** und **Jetzt aktualisieren**. Die Prüfung lädt das aktuelle offizielle Image bereits herunter, startet den Bot aber noch nicht neu. Erst deine Bestätigung aktiviert es. Bei erfolgreichem Update lädt sich das Dashboard neu; schlägt der Start fehl, versucht der Dienst die vorherige Version wiederherzustellen. Gespeicherte Einstellungen und Daten bleiben erhalten. Alte falsche Abgangsmeldungen werden nicht gelöscht.

Der Installer benötigt dafür systemd und installiert bei Bedarf Python 3. Ein root-eigener Dienst `nexus-updater` führt ausschließlich festgelegte Docker-Befehle für den Bot aus. Der Bot erhält **keinen Docker-Socket**, sondern nur einen lokalen Steuer-Socket. Der Dienst besitzt technisch Docker-Administratorrechte; seine Dateien und die Konfigurationskopie unter `/opt/nexus-updater` sind deshalb nur für root zugänglich. Lokale Prozesse mit Gruppe 1000 können ebenfalls die begrenzten Update-Aktionen auslösen. Es wird kein zusätzlicher Netzwerkport geöffnet.

Der Button aktualisiert nur das Bot-Image, nicht Caddy, Betriebssystem, Installer oder Update-Dienst. Änderungen an diesen Komponenten und an der Compose-Konfiguration benötigen weiterhin `git pull --ff-only && bash start.sh`. Der Installer erneuert dabei die geschützte Konfigurationskopie. Gleichzeitige Updates per Konsole und Dashboard vermeiden. Diagnose des Dienstes: `sudo systemctl status nexus-updater`.

Bei einer unterbrochenen Aktualisierung oder fehlgeschlagener Wiederherstellung: `bash manage.sh status` und gegebenenfalls `bash start.sh`. Die Wiederherstellung ist keine Datenbank-Sicherung und kann Datenmigrationen zukünftiger Versionen nicht rückgängig machen.

Eine vorhandene Einrichtung bleibt erhalten. Im bisherigen Projektordner:

```bash
git pull --ff-only && bash start.sh
```

Ein bereits gespeicherter Hostname wird weiterverwendet. Optional eine eigene Domain verwenden:

```bash
bash start.sh --address watchdog.deine-domain.de
```

Nur bei einer eigenen Domain muss deren DNS-Eintrag bereits auf diesen Server zeigen. Der Installer verwaltet keine DNS-Einträge.

Wartung im Projektordner:

```bash
bash manage.sh status
bash manage.sh logs
bash manage.sh restart
```

Einrichtung und Zertifikate bleiben in Docker-Volumes gespeichert. Diese sichern und nicht mit `docker compose down -v` löschen. Änderungen des Scan-Intervalls im Dashboard gelten derzeit bis zum Neustart. Nur eine Bot-Instanz pro Firebase-Pfad betreiben; einen alten Systemd-Dienst vor dem Docker-Start stoppen.

Technische Einzelheiten und Tests: [README](README.md).
