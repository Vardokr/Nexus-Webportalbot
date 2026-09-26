# NEXUS Watchdog installieren

Ein Befehl lädt das öffentliche Repository und fragt zuerst nach deinem Hosting-Typ. Nur auf einem VPS/Rootserver mit sudo-Rechten kann der Docker-Schnellstart automatisch installieren. Die Einrichtung erfolgt anschließend im Browser.

## Welchen Hosting-Typ habe ich?

| Produkt | Docker-Schnellstart | Woran erkenne ich es? |
| --- | --- | --- |
| Linux-vServer/VPS oder Rootserver | Ja | Du kannst dich per SSH anmelden und mit `sudo` Software installieren. |
| Verwalteter Bot-/Gameserver | Nicht pauschal | Der Anbieter stellt Startknopf, Laufzeit und Ports bereit, aber keine frei verwaltbare Linux-Maschine. |

Bei ZAP-Hosting gibt es beide Produktarten. Ein verwalteter Tarif ist nicht automatisch ein VPS, auch wenn beides „gehostete Server“ sind. Wenn du deinen Typ nicht kennst, wähle im Startmenü **3** oder prüfe den Produktnamen im Hosting-Panel.

## Voraussetzungen

- Ubuntu 22.04/24.04/26.04 oder Debian 12/13 auf **x86-64 (amd64)**
- SSH-Zugang und `sudo`-Rechte auf dem Server
- Firebase-Servicekonto als JSON-Datei, URL der Firebase Realtime Database und Wargaming-Anwendungsschlüssel

Auf anderen Linux-Distributionen Docker Engine und Docker Compose ab 2.30 selbst installieren. Das Startskript installiert Docker nur auf den genannten Systemen. Eine bestehende Docker-Installation wird nicht ersetzt; Paketkonflikte werden gemeldet, aber nicht automatisch entfernt.

## 1. Herunterladen und starten

Auf dem Server in Bash:

```bash
git clone https://github.com/Vardokr/Nexus-Webportalbot.git nexus-watchdog && bash nexus-watchdog/start.sh
```

`git` muss auf dem Server vorhanden sein. Wähle **1** für VPS/Rootserver. Gib dann **deinen eigenen öffentlichen Hostnamen** ein, der auf die IP dieses Servers zeigt. Das kann eine eigene Domain/Subdomain oder ein vom Hoster zugewiesener Hostname sein; im Skript ist weder ein Hoster noch eine IP voreingestellt. **Ports 80 und 443 müssen frei und von außen erreichbar sein.** Das Skript installiert bei Bedarf Docker aus dem [offiziellen Docker-APT-Repository](https://docs.docker.com/engine/install/ubuntu/), lädt das Bot-Image sowie Caddy und startet beide Container. Caddy beschafft und erneuert das HTTPS-Zertifikat automatisch. Für die Docker-Installation kann `sudo` nach deinem Server-Passwort fragen. GitHub-Anmeldung oder Token sind für die öffentlichen Downloads nicht erforderlich.

Am Ende zeigt das Skript den **Einrichtungscode** und die Browseradresse `https://DEIN_HOSTNAME`. Der Code gilt 30 Minuten. Der Bot-Dienst bleibt nur auf `127.0.0.1:3000` des Servers erreichbar; nur Caddy nimmt öffentlich HTTPS-Anfragen an. Port 3000 muss nicht öffentlich geöffnet werden. Falls ein anderer Webserver 80/443 belegt, muss dessen Konfiguration zuerst angepasst werden.

## 2. Einrichtung im Browser

Öffne die angezeigte **HTTPS-Adresse** direkt auf deinem Rechner. Ein SSH-Tunnel ist nicht nötig. Im Assistenten eingeben:

1. Einrichtungscode aus dem Server-Terminal
2. Firebase-Servicekonto-JSON-Datei und Realtime-Database-URL
3. Workspace-Schlüssel und Wargaming-Anwendungsschlüssel
4. Optional Discord-Webhook
5. Admin-Benutzername und Passwort mit mindestens 12 Zeichen

Die öffentliche HTTPS-Adresse wird beim Aufruf über HTTPS automatisch vorbelegt. Die Verbindungstests lesen Daten und senden keine Discord-Nachricht. Nach Abschluss das Dashboard öffnen und mit dem neuen Admin-Konto anmelden. Falls dein Hostname noch nicht erreichbar ist, DNS-Eintrag und Portfreigabe beim Hoster prüfen. Bei Zertifikatsfehlern **keine Browserwarnung übergehen und keine Schlüssel eingeben**.

Falls du keinen öffentlichen Hostnamen hast, kannst du die Eingabe leer lassen. Dann bleibt der bisherige SSH-Tunnel als Fallback:

```bash
ssh -L 3000:127.0.0.1:3000 DEIN_SERVER_BENUTZER@SERVER_IP
```

Danach [http://localhost:3000](http://localhost:3000) öffnen. In diesem Fall die öffentliche HTTPS-Adresse im Assistenten leer lassen.

Falls der Code abläuft, auf dem Server im Projektordner:

```bash
docker compose -f compose.registry.yaml -f compose.https.yaml restart watchdog
docker compose -f compose.registry.yaml -f compose.https.yaml logs --tail=30 watchdog
```

Wenn der Serverbenutzer keinen direkten Docker-Zugriff hat, dieselben Befehle mit `sudo docker compose` ausführen. Der Schnellstart erkennt das selbst.

## Updates und Logs

Im Projektordner auf dem Server:

```bash
git pull
bash quickstart.sh
```

Der Hostname liegt lokal in `.site-host` und wird bei Updates wiederverwendet. Die Einrichtung liegt im Docker-Volume `watchdog-config`, die Abgangshistorie in Firebase. `docker compose down` erhält das Volume; **`docker compose down -v` löscht die gespeicherte Einrichtung und das Caddy-Zertifikatsvolume**. Für Updates denselben Projektordner verwenden.

Wenn bereits der ältere Systemd-Bot denselben Firebase-Pfad verwendet, ihn vor dem Docker-Start stoppen:

```bash
sudo systemctl disable --now nexus-bot
```

Weitere technische Hinweise stehen in der [README](README.md).

## Verwaltetes Bot-/Gameserver-Hosting

Wähle im Startmenü **2**. Der Docker-Schnellstart wird dann **nicht** ausgeführt. Für diesen Tarif muss zuerst geklärt sein, ob er Folgendes bietet:

1. Node.js **22 oder neuer** und Installation der npm-Abhängigkeiten
2. Einen dauerhaft laufenden Node-Prozess mit Startbefehl `node bootstrap.js`
3. Dauerhaften, privaten Speicher für die Einrichtung (`CONFIG_DIR`)
4. Einen von außen erreichbaren **HTTPS**-Endpunkt, der zum Dashboard-Port weiterleitet

Ohne diese Voraussetzungen ist der Web-Assistent auf dem Tarif nicht sicher und dauerhaft betreibbar. Bot-Hosting darf nicht einfach mit einem öffentlich geöffneten HTTP-Port für Firebase-Schlüssel und Admin-Passwort eingerichtet werden. Wenn der Anbieter die Voraussetzungen erfüllt, braucht es noch seine konkreten Angaben zu Startbefehl, Speicherpfad und HTTPS/Port-Freigabe. Der VPS-Befehl oben installiert auf solchen Tarifen nichts.
