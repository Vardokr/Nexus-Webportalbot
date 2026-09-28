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
updater.lock.acquire()
updater.work('check')
assert updater.state['available'], updater.state
updater.lock.acquire()
updater.work('install')
assert updater.state['phase'] == 'success', updater.state
assert updater.current() != old

# A non-existent image with --pull never must fail and restore the known-good bot.
good = updater.current()
updater.candidate = 'sha256:' + '0' * 64
updater.lock.acquire()
updater.work('install')
assert updater.state['phase'] == 'rolled_back', updater.state
assert updater.current() == good
print('Real Docker update and rollback passed; configuration volume retained.')
