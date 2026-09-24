'use strict';
require('dotenv').config();
const path = require('node:path');
const { startSetup, loadConfig } = require('./setup');
const filename = path.join(process.env.CONFIG_DIR || path.join(__dirname, 'data'), 'config.json');

async function main() {
  const config = loadConfig(filename);
  if (config) {
    for (const [key, value] of Object.entries(config)) {
      if (!process.env[key]) process.env[key] = value;
    }
  }
  const ready = process.env.FIREBASE_CREDENTIALS && process.env.FIREBASE_DATABASE_URL &&
    (process.env.DASHBOARD_PASS || process.env.DASHBOARD_PASS_HASH);
  if (ready) return require('./nexus-bot');
  await startSetup({ filename, onComplete: saved => {
    Object.assign(process.env, saved);
    require('./nexus-bot');
  } });
}
main().catch(() => { console.error('Start fehlgeschlagen. Konfigurationsdatei und Dateirechte prüfen.'); process.exitCode = 1; });
