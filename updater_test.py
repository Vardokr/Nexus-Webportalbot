import json
from pathlib import Path
import tempfile
import unittest
import http.client
import socket
import threading
from updater import Updater, Server, Handler


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'compose.json').write_text(json.dumps({'name': 'test'}))
        self.calls = []
        self.fail_new = False
        self.fail_pull = False
        self.same = False

        def run(args):
            self.calls.append(args)
            if args[1] == 'pull' and self.fail_pull:
                raise RuntimeError('secret must not leak')
            if 'ps' in args:
                return 'container-id'
            if args[1] == 'inspect':
                return 'sha256:old'
            if args[1:3] == ['image', 'inspect']:
                return 'sha256:old' if self.same else 'sha256:new'
            if 'up' in args and self.fail_new:
                image = json.loads((self.root / 'image.json').read_text())['services']['watchdog']['image']
                if image == 'sha256:new':
                    raise RuntimeError('unhealthy')
            return ''
        self.updater = Updater(self.root, run)

    def work(self, action):
        self.updater.lock.acquire()
        self.updater.work(action)

    def test_check_and_install(self):
        self.work('check')
        self.assertTrue(self.updater.state['available'])
        self.work('install')
        self.assertEqual(self.updater.state['phase'], 'success')
        command = next(c for c in self.calls if 'up' in c)
        self.assertIn('--no-deps', command)
        self.assertEqual(command[-1], 'watchdog')

    def test_no_update(self):
        self.same = True
        self.work('check')
        self.assertFalse(self.updater.state['available'])

    def test_rollback(self):
        self.work('check')
        self.fail_new = True
        self.work('install')
        self.assertEqual(self.updater.state['phase'], 'rolled_back')
        self.assertEqual(json.loads((self.root / 'image.json').read_text())['services']['watchdog']['image'], 'sha256:old')

    def test_errors_and_restart(self):
        self.fail_pull = True
        self.work('check')
        self.assertEqual(self.updater.state['phase'], 'error')
        self.assertNotIn('secret', json.dumps(self.updater.state))
        self.updater.set_state(phase='updating')
        self.assertEqual(Updater(self.root).state['phase'], 'error')

    def test_reject_unchecked_expired_parallel_and_unknown(self):
        self.assertEqual(self.updater.start('install'), 409)
        self.assertEqual(self.updater.start('shell'), 404)
        self.updater.lock.acquire()
        self.assertEqual(self.updater.start('check'), 409)
        self.updater.lock.release()
        self.work('check')
        self.updater.checked = -10000
        self.assertEqual(self.updater.start('install'), 409)

    def test_local_protocol_rejects_arbitrary_actions_and_payloads(self):
        path = str(self.root / 'control.sock')
        with Server(path, Handler) as server:
            server.updater = self.updater
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for method, route, body, expected in [('GET', '/status', None, 200),
                    ('POST', '/shell', None, 404), ('POST', '/install', None, 409),
                    ('POST', '/check', 'image=evil', 400)]:
                    connection = http.client.HTTPConnection('localhost')
                    connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    connection.sock.connect(path)
                    connection.request(method, route, body=body)
                    response = connection.getresponse()
                    self.assertEqual(response.status, expected)
                    response.read()
                    connection.close()
            finally:
                server.shutdown()
                thread.join()


if __name__ == '__main__':
    unittest.main()
