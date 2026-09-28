"""Root-owned, local-only updater. No client-supplied commands, paths or images."""
import http.server
import json
import os
from pathlib import Path
import socketserver
import subprocess
import threading
import time

ROOT = Path('/opt/nexus-updater')
SOCKET = '/run/nexus-updater/control.sock'
IMAGE = 'ghcr.io/vardokr/nexus-webportalbot:latest'


class Updater:
    def __init__(self, root=ROOT, run=None):
        self.root = root
        self.run = run or self.command
        self.lock = threading.Lock()
        self.state = {'phase': 'idle', 'message': 'Bereit.', 'available': False}
        self.candidate = None
        self.checked = 0
        self.project = json.loads((root / 'compose.json').read_text())['name']
        saved = root / 'state.json'
        if saved.exists():
            self.state = json.loads(saved.read_text())
            if self.state['phase'] in ('checking', 'updating'):
                self.state.update(phase='error', available=False,
                                  message='Update-Dienst wurde unterbrochen. Serverstatus prüfen und erneut prüfen.')

    @staticmethod
    def command(args):
        return subprocess.run(args, check=True, capture_output=True, text=True,
                              timeout=600).stdout.strip()

    def set_state(self, **values):
        self.state = {**self.state, **values}
        temp = self.root / 'state.tmp'
        temp.write_text(json.dumps(self.state))
        temp.replace(self.root / 'state.json')

    def compose(self, *args):
        return self.run(['docker', 'compose', '-p', self.project, '-f',
                         str(self.root / 'compose.json'), *args])

    def current(self):
        container = self.compose('ps', '-q', 'watchdog')
        if not container or '\n' in container:
            raise RuntimeError('Expected one running bot')
        return self.run(['docker', 'inspect', '--format', '{{.Image}}', container])

    def deploy(self, image):
        override = self.root / 'image.json'
        override.write_text(json.dumps({'services': {'watchdog': {'image': image}}}))
        self.compose('-f', str(override), 'up', '-d', '--no-deps', '--pull', 'never',
                     '--wait', '--wait-timeout', '90', 'watchdog')

    def start(self, action):
        if action not in ('check', 'install'):
            return 404
        if not self.lock.acquire(blocking=False):
            return 409
        if action == 'install' and (not self.candidate or not self.state['available'] or time.monotonic() - self.checked > 1800):
            self.lock.release()
            return 409
        self.set_state(phase='checking' if action == 'check' else 'updating',
                       message='Version wird heruntergeladen und geprüft.' if action == 'check' else 'Bot wird aktualisiert. Bitte warten.')
        threading.Thread(target=self.work, args=(action,), daemon=True).start()
        return 202

    def work(self, action):
        old = None
        try:
            old = self.current()
            if action == 'check':
                self.run(['docker', 'pull', IMAGE])
                self.candidate = self.run(['docker', 'image', 'inspect', '--format', '{{.Id}}', IMAGE])
                self.checked = time.monotonic()
                available = old != self.candidate
                self.set_state(phase='ready', available=available,
                               message='Update verfügbar.' if available else 'Der Bot ist aktuell.')
            else:
                try:
                    self.deploy(self.candidate)
                except Exception:
                    self.deploy(old)
                    self.set_state(phase='rolled_back', available=False,
                                   message='Update fehlgeschlagen. Vorherige Version wurde wiederhergestellt.')
                else:
                    self.set_state(phase='success', available=False,
                                   message='Update abgeschlossen. Dashboard neu laden.')
        except Exception:
            # Do not expose Docker output: it can contain configuration secrets.
            self.set_state(phase='error', available=False,
                           message='Vorgang fehlgeschlagen. Serverstatus mit bash manage.sh status prüfen; gegebenenfalls bash start.sh ausführen.')
        finally:
            self.lock.release()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status):
        body = json.dumps(self.server.updater.state).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.respond(200 if self.path == '/status' else 404)

    def do_POST(self):
        if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
            self.respond(400)
            return
        self.respond(self.server.updater.start(self.path.removeprefix('/')))


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

if __name__ == '__main__':
    os.umask(0o077)
    if os.path.exists(SOCKET):
        os.unlink(SOCKET)
    with Server(SOCKET, Handler) as server:
        server.updater = Updater()
        os.chown(SOCKET, 0, 1000)
        os.chmod(SOCKET, 0o660)
        server.serve_forever()
