"""CI: exercise real Docker replacement and rollback in the HTTPS test project."""
import json
from pathlib import Path
import subprocess
import sys
from updater import Updater

root = Path(sys.argv[1])
candidate = sys.argv[2]

def run(args):
    # Use the locally built candidate: no production image or registry mutation.
    if args[1] == 'pull':
        return ''
    if args[1:3] == ['image', 'inspect']:
        args[-1] = candidate
    return Updater.command(args)

updater = Updater(root, run)
old = updater.current()
updater.compose('exec', '-T', 'watchdog', 'node', '-e', "require('fs').writeFileSync('/data/update-test', 'preserved')")
updater.lock.acquire()
updater.work('check')
assert updater.state['available'], updater.state
updater.lock.acquire()
updater.work('install')
assert updater.state['phase'] == 'success', updater.state
assert updater.current() != old
assert updater.compose('exec', '-T', 'watchdog', 'node', '-e', "process.stdout.write(require('fs').readFileSync('/data/update-test'))") == 'preserved'

# A crashing replacement must restore the known-good bot and its data volume.
good = updater.current()
subprocess.run(['docker', 'build', '--build-arg', 'BASE_IMAGE=' + candidate,
                '-f', 'tests/Dockerfile.unhealthy', '-t', 'nexus-updater-ci:broken', '.'], check=True)
updater.candidate = Updater.command(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'nexus-updater-ci:broken'])
updater.lock.acquire()
updater.work('install')
assert updater.state['phase'] == 'rolled_back', updater.state
assert updater.current() == good
assert updater.compose('exec', '-T', 'watchdog', 'node', '-e', "process.stdout.write(require('fs').readFileSync('/data/update-test'))") == 'preserved'
print('Real Docker update and rollback passed; configuration volume retained.')
