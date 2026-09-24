'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const KEYS = ['FIREBASE_CREDENTIALS', 'FIREBASE_DATABASE_URL', 'WG_API_KEY', 'DISCORD_WEBHOOK', 'DASHBOARD_USER', 'DASHBOARD_PASS_HASH', 'CLAN_ID', 'SCAN_INTERVAL', 'DASHBOARD_ORIGIN'];

function loadConfig(filename) {
  if (!fs.existsSync(filename)) return null;
  const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!data || !KEYS.every(key => typeof data[key] === 'string')) throw new Error('Invalid configuration');
  return Object.fromEntries(KEYS.map(key => [key, data[key]]));
}

function validate(input) {
  const fail = message => { throw new Error(message); };
  if (!input || typeof input !== 'object') fail('Bitte alle Pflichtfelder ausfüllen.');
  for (const key of ['databaseURL', 'apiKey', 'username', 'password', 'clan']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) fail('Bitte alle Pflichtfelder ausfüllen.');
  }
  const credentials = input.credentials;
  if (!credentials || credentials.type !== 'service_account' || typeof credentials.project_id !== 'string' ||
      typeof credentials.client_email !== 'string' || !credentials.client_email.endsWith('.iam.gserviceaccount.com') ||
      typeof credentials.private_key !== 'string') fail('Bitte eine gültige Firebase-Servicekonto-Datei hochladen.');
  let db;
  try { db = new URL(input.databaseURL); } catch { fail('Ungültige Datenbank-URL.'); }
  if (db.protocol !== 'https:' || db.username || db.password || db.port || db.search || db.hash || db.pathname !== '/' ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(?:firebaseio\.com|firebasedatabase\.app)$/.test(db.hostname)) fail('Eine HTTPS-URL der Firebase Realtime Database ohne Pfad angeben.');
  if (!/^[a-zA-Z0-9]{8,128}$/.test(input.apiKey)) fail('Ungültiger Wargaming-Key.');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(input.clan)) fail('Workspace: nur Buchstaben, Zahlen, _ und - verwenden.');
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(input.username)) fail('Ungültiger Benutzername.');
  if (input.password.length < 12 || input.password.length > 256) fail('Passwort: 12 bis 256 Zeichen.');
  const interval = Number(input.interval);
  if (!Number.isInteger(interval) || interval < 10 || interval > 1440) fail('Scan-Intervall: 10 bis 1440 Minuten.');
  const webhook = input.webhook || '';
  if (typeof webhook !== 'string' || (webhook && !/^https:\/\/discord\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/.test(webhook))) fail('Ungültiger Discord-Webhook.');
  const origin = input.origin || '';
  if (origin) {
    let url;
    try { url = new URL(origin); } catch { fail('Ungültige öffentliche Adresse.'); }
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) fail('Öffentliche Adresse als https://domain ohne abschließenden / angeben.');
  }
  // Only the required credential fields are forwarded to the Admin SDK.
  return { ...input, credentials: { type: 'service_account', project_id: credentials.project_id, client_email: credentials.client_email, private_key: credentials.private_key }, databaseURL: db.origin, interval, webhook, origin };
}

async function checkConnections(config) {
  const admin = require('firebase-admin');
  let app;
  let timer;
  try {
    app = admin.initializeApp({ credential: admin.credential.cert(config.credentials), databaseURL: config.databaseURL }, 'setup-' + crypto.randomUUID());
    await Promise.race([
      app.database().ref(`clans/${config.clan}/clan_watchdog/settings`).once('value'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 15000); })
    ]);
  } catch { throw new Error('Firebase-Verbindung fehlgeschlagen. Servicekonto, Datenbank-URL und Berechtigungen prüfen.'); }
  finally {
    clearTimeout(timer);
    if (app) { app.database().goOffline(); await app.delete(); }
  }
  try {
    const response = await fetch(`https://api.worldoftanks.eu/wot/clans/list/?application_id=${encodeURIComponent(config.apiKey)}&search=ODIN&limit=1`, { signal: AbortSignal.timeout(12000), redirect: 'error' });
    const result = await response.json();
    if (!response.ok || result.status !== 'ok') throw new Error('invalid');
  } catch { throw new Error('Wargaming-Verbindung fehlgeschlagen. Anwendungsschlüssel prüfen.'); }
  if (config.webhook) {
    try {
      const response = await fetch(config.webhook, { signal: AbortSignal.timeout(12000), redirect: 'error' });
      if (!response.ok) throw new Error('invalid');
    } catch { throw new Error('Discord-Webhook nicht erreichbar oder ungültig.'); }
  }
}

async function saveConfig(filename, config) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(config.password, salt, 64)).toString('hex');
  const data = {
    FIREBASE_CREDENTIALS: JSON.stringify(config.credentials), FIREBASE_DATABASE_URL: config.databaseURL,
    WG_API_KEY: config.apiKey, DISCORD_WEBHOOK: config.webhook,
    DASHBOARD_USER: config.username, DASHBOARD_PASS_HASH: `scrypt:${salt}:${hash}`,
    CLAN_ID: config.clan, SCAN_INTERVAL: String(config.interval), DASHBOARD_ORIGIN: config.origin
  };
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
    // Atomic creation without replacing an existing setup, including another process.
    fs.linkSync(temporary, filename);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return data;
}

async function startSetup({ filename, onComplete, check = checkConnections, host = process.env.DASHBOARD_HOST || '127.0.0.1', port = Number(process.env.DASHBOARD_PORT || 3000), token = crypto.randomBytes(24).toString('hex') }) {
  if (fs.existsSync(filename)) throw new Error('Setup already complete');
  const express = require('express');
  const app = express();
  app.disable('x-powered-by');
  let busy = false;
  let completed = false;
  let attempts = 0;
  let windowStart = Date.now();
  const expires = Date.now() + 30 * 60 * 1000;
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    next();
  });
  app.get('/api/status', (_, res) => res.status(401).json({ setup: true }));
  app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'setup.html')));
  app.get('/setup.js', (_, res) => res.sendFile(path.join(__dirname, 'setup-client.js')));
  app.get('/setup.css', (_, res) => res.sendFile(path.join(__dirname, 'setup.css')));
  app.post('/api/setup', (req, res, next) => {
    if (completed || fs.existsSync(filename)) return res.status(409).json({ message: 'Einrichtung bereits abgeschlossen.' });
    if (Date.now() - windowStart > 60000) { attempts = 0; windowStart = Date.now(); }
    if (++attempts > 10) return res.status(429).json({ message: 'Bitte eine Minute warten.' });
    const supplied = Buffer.from(req.get('X-Setup-Token') || '');
    const expected = Buffer.from(token);
    if (Date.now() > expires || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(403).json({ message: 'Einrichtungscode ungültig oder abgelaufen. Für einen neuen Code Container neu starten.' });
    if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ message: 'Fremde Anfragequelle.' });
    if (!req.is('application/json')) return res.status(415).json({ message: 'JSON erforderlich.' });
    next();
  }, express.json({ limit: '32kb' }), async (req, res) => {
    if (busy) return res.status(409).json({ message: 'Die Einrichtung wird bereits geprüft.' });
    busy = true;
    try {
      let config;
      try { config = validate(req.body); } catch (error) { res.status(400).json({ message: error.message }); return; }
      try { await check(config); } catch (error) { res.status(400).json({ message: error.message }); return; }
      const saved = await saveConfig(filename, config);
      completed = true;
      res.json({ success: true });
      server.close(() => onComplete(saved));
      server.closeIdleConnections();
    } catch { res.status(500).json({ message: 'Konfiguration konnte nicht gespeichert werden. Volume und Dateirechte prüfen.' }); }
    finally { busy = false; }
  });
  app.use((error, req, res, next) => res.status(400).json({ message: 'Anfrage ungültig oder zu groß.' }));
  const server = await new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once('error', reject);
  });
  console.log('NEXUS Einrichtung öffnen. Zugriff über SSH-Tunnel oder HTTPS.');
  console.log(`Einrichtungscode (30 Minuten gültig): ${token}`);
  return server;
}
module.exports = { validate, saveConfig, loadConfig, startSetup };
