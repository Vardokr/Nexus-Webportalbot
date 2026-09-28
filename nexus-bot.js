'use strict';

// ============================================
// NEXUS WATCHDOG BOT v3.0.0
// Sicher, stabil, produktionsreif
// ============================================

const admin    = require('firebase-admin');
const express  = require('express');
const crypto   = require('crypto');
const { configureProxy, createAuth } = require('./security');
require('dotenv').config();

// ============================================
// FETCH KOMPATIBILITÄT
// ============================================
const fetch = globalThis.fetch ?? require('node-fetch');

// ============================================
// KONFIGURATION & VALIDIERUNG
// ============================================
function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`❌ KRITISCH: Umgebungsvariable "${name}" fehlt in der .env Datei!`);
    process.exit(1);
  }
  return val;
}

const CLAN_ID              = process.env.CLAN_ID              || 'ODIN';
let   SCAN_INTERVAL_MIN    = parseInt(process.env.SCAN_INTERVAL) || 120;
const REQUEST_DELAY_MS     = 300;
const DISCORD_EMBED_LIMIT  = 10;
const MAX_LEAVERS_HISTORY  = 100;
const DASHBOARD_PORT       = parseInt(process.env.DASHBOARD_PORT) || 3000;
const DASHBOARD_USER       = process.env.DASHBOARD_USER       || 'admin';
const DASHBOARD_PASS       = process.env.DASHBOARD_PASS       || '';
const DASHBOARD_PASS_HASH  = process.env.DASHBOARD_PASS_HASH  || '';
if (!Number.isInteger(Number(process.env.SCAN_INTERVAL || 120)) || SCAN_INTERVAL_MIN < 10 || SCAN_INTERVAL_MIN > 1440) throw new Error('SCAN_INTERVAL muss 10–1440 sein');
if (/[.#$\[\]\/]/.test(CLAN_ID)) throw new Error('Ungültige CLAN_ID');

// Passwort-Validierung
if (!DASHBOARD_PASS && !DASHBOARD_PASS_HASH) {
  console.error('❌ KRITISCH: Kein Dashboard-Passwort gesetzt! Bitte DASHBOARD_PASS oder DASHBOARD_PASS_HASH in .env setzen.');
  process.exit(1);
}

// ============================================
// FIREBASE INITIALISIERUNG (via .env)
// ============================================
let serviceAccount;
try {
  const raw = requireEnv('FIREBASE_CREDENTIALS');
  serviceAccount = JSON.parse(raw);
} catch (e) {
  console.error('❌ KRITISCH: FIREBASE_CREDENTIALS ist kein gültiges JSON:', e.message);
  process.exit(1);
}

try {
  admin.initializeApp({
    credential:  admin.credential.cert(serviceAccount),
    databaseURL: requireEnv('FIREBASE_DATABASE_URL')
  });
  console.log('✅ Firebase initialisiert');
} catch (error) {
  console.error('❌ KRITISCH: Firebase Initialisierung fehlgeschlagen:', error.message);
  process.exit(1);
}

const db      = admin.database();
const DB_PATH = `clans/${CLAN_ID}/clan_watchdog`;

db.ref('.info/connected').on('value', snap => {
  if (snap.val() === true) console.log('✅ Firebase verbunden');
  else                     console.error('⚠️ Firebase Verbindung verloren!');
});

// ============================================
// LOG-SYSTEM
// ============================================
const logHistory   = [];
const _origLog     = console.log.bind(console);
const _origError   = console.error.bind(console);

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function addLog(type, ...args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  logHistory.unshift({ time: new Date().toLocaleTimeString('de-DE'), type, msg });
  if (logHistory.length > 150) logHistory.pop();
}

console.log   = (...a) => { addLog('info',  ...a); _origLog(...a);   };
console.error = (...a) => { addLog('error', ...a); _origError(...a); };
console.warn  = (...a) => { addLog('warn',  ...a); _origError(...a); };

console.log(`\n🚀 NEXUS-BOT v3.0.0 gestartet`);
console.log(`📂 Firebase Pfad: ${DB_PATH}`);
console.log(`⏱️  Scan-Intervall: ${SCAN_INTERVAL_MIN} Minuten`);

// ============================================
// STATE
// ============================================
let scanTimer           = null;
let isScanning          = false;
let isPaused            = false;
let lastScanTime        = null;
let nextScanTime        = Date.now() + SCAN_INTERVAL_MIN * 60_000;
let currentScanProgress = { current: 0, total: 0 };
let scanStats           = { totalClans: 0, successfulScans: 0, failedScans: 0 };

// ============================================
// HELPER
// ============================================
const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchWargamingAPI(url, description, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 12_000);
    try {
      const res  = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      clearTimeout(timer);
      if (json.status !== 'ok') throw new Error(json.error?.message || 'API Error');
      return json.data;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) {
        console.error(`❌ Fehler bei ${description} (Versuch ${attempt}/${retries}):`, err.message);
        throw err;
      }
      console.warn(`⚠️ Retry ${attempt}/${retries} für ${description}...`);
      await delay(1000 * attempt);
    }
  }
}

async function sendToDiscord(webhookUrl, leavers) {
  if (!webhookUrl || leavers.length === 0) return;
  if (!/^https:\/\/discord\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/.test(webhookUrl)) {
    console.error('Ungültige Discord Webhook URL');
    return;
  }

  const chunks = [];
  for (let i = 0; i < leavers.length; i += DISCORD_EMBED_LIMIT)
    chunks.push(leavers.slice(i, i + DISCORD_EMBED_LIMIT));

  for (let i = 0; i < chunks.length; i++) {
    const embeds = chunks[i].map(p => ({
      title:       `🏃 Abgang: ${p.name}`,
      description: `Hat den Clan **[${p.oldClan}]** verlassen.`,
      color:       15158332,
      fields: [
        { name: 'Personal Rating', value: p.pr ? `${p.pr}` : 'N/A', inline: true },
        { name: 'Profil', value: `[Tomato.gg](https://tomato.gg/stats/EU/${encodeURIComponent(p.name)}=${p.id})`, inline: true }
      ],
      footer:    { text: 'NEXUS Watchdog v3' },
      timestamp: new Date(p.leftAt).toISOString()
    }));

    try {
      const res = await fetch(webhookUrl, {
        signal: AbortSignal.timeout(12000),
        redirect: 'error',
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: 'NEXUS Watchdog', embeds })
      });
      if (!res.ok) throw new Error(`Discord API Error: ${res.status}`);
      console.log(`✅ Discord: ${embeds.length} Embed(s) gesendet`);
      if (i < chunks.length - 1) await delay(1500);
    } catch (e) {
      console.error('❌ Discord Fehler:', e.message);
    }
  }
}

// ============================================
// HAUPT-SCANNER
// ============================================
function memberIds(members) {
  if (!Array.isArray(members)) throw new Error('Ungültige Mitgliederliste');
  return [...new Set(members.map(member => {
    const raw = typeof member === 'object' && member !== null ? member.account_id : member;
    const id = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Ungültige Mitglieds-ID');
    return id;
  }))];
}

function confirmedLeavers(ids, accounts, clanId) {
  return ids.filter(id => {
    const account = accounts?.[id];
    const membership = account?.clan_id;
    if (!account || !(membership === null ||
        ((typeof membership === 'number' || typeof membership === 'string') &&
         String(membership).trim() !== '' && Number.isSafeInteger(Number(membership)) && Number(membership) >= 0))) {
      throw new Error(`Clan-Zugehörigkeit für ${id} nicht bestätigt; nächster Scan versucht es erneut`);
    }
    return Number(membership) !== Number(clanId);
  });
}

async function runScanner() {
  if (isScanning) { console.log('⚠️ Scan läuft bereits.'); return; }
  if (isPaused)   { console.log('⏸️ Scanner pausiert.');   return; }

  isScanning   = true;
  lastScanTime = Date.now();
  console.log(`\n🔍 Scan gestartet: ${new Date().toLocaleString('de-DE')}`);

  try {
    const snapshot = await db.ref(DB_PATH).once('value');
    const data     = snapshot.val();

    if (!data?.watchlist?.length) {
      console.log('⚠️ Watchlist leer.');
      return;
    }

    const apiKey         = data.settings?.apiKey || process.env.WG_API_KEY;
    const discordWebhook = data.settings?.discordWebhook || process.env.DISCORD_WEBHOOK;

    if (!apiKey) { console.error('❌ Kein API Key!'); return; }

    const watchlist       = data.watchlist;
    const newLeaversFound = [];
    const updatedWatchlist = [];

    scanStats           = { totalClans: watchlist.length, successfulScans: 0, failedScans: 0 };
    currentScanProgress = { current: 0, total: watchlist.length };

    console.log(`📊 Scanne ${watchlist.length} Clan(s)...`);

    for (let i = 0; i < watchlist.length; i++) {
      const clan = watchlist[i];
      currentScanProgress.current = i + 1;
      await delay(REQUEST_DELAY_MS);

      try {
        const clanData = await fetchWargamingAPI(
          `https://api.worldoftanks.eu/wot/clans/info/?application_id=${encodeURIComponent(apiKey)}&clan_id=${encodeURIComponent(clan.id)}&fields=members,members_count,tag`,
          `Clan [${clan.tag}]`
        );

        const current = clanData?.[clan.id];
        if (current && Array.isArray(current.members)) {
          const currentIds = memberIds(current.members);
          const oldIds     = memberIds(clan.members || []);
          const candidates = oldIds.filter(id => !currentIds.includes(id));
          let leaverIds = [];
          let statsData;
          if (candidates.length) {
            statsData = await fetchWargamingAPI(
              `https://api.worldoftanks.eu/wot/account/info/?application_id=${encodeURIComponent(apiKey)}&account_id=${encodeURIComponent(candidates.join(','))}&fields=nickname,global_rating,clan_id`,
              `Clan-Zugehörigkeit für [${clan.tag}]`
            );
            leaverIds = confirmedLeavers(candidates, statsData, clan.id);
            // Keep still-affiliated accounts even when the roster temporarily omits them.
            currentIds.push(...candidates.filter(id => !leaverIds.includes(id)));
          }

          if (leaverIds.length > 0) {
            console.log(`🚨 ${leaverIds.length} Abgang/Abgänge bei [${clan.tag}]`);
              for (const id of leaverIds) {
                const p = statsData?.[id];
                newLeaversFound.push({
                  id,
                  name:    p?.nickname    || `Player-${id}`,
                  pr:      p?.global_rating || null,
                  oldClan: clan.tag,
                  leftAt:  Date.now()
                });
              }
          }

          updatedWatchlist.push({
            ...clan,
            memberCount: current.members_count,
            members:     currentIds,
            lastScan:    Date.now()
          });
          scanStats.successfulScans++;
        } else {
          updatedWatchlist.push(clan);
          scanStats.failedScans++;
        }
      } catch (e) {
        console.error(`⚠️ Fehler bei [${clan.tag}]:`, e.message);
        updatedWatchlist.push(clan);
        scanStats.failedScans++;
      }
    }

    await db.ref(DB_PATH).transaction(latest => {
      if (!latest) return;
      latest.watchlist = (latest.watchlist || []).map(clan => {
        const before = watchlist.find(c => c.id === clan.id);
        return before && before.addedAt === clan.addedAt
          ? updatedWatchlist.find(c => c.id === clan.id) || clan : clan;
      });
      if (newLeaversFound.length) latest.leavers = [...newLeaversFound, ...(latest.leavers || [])].slice(0, MAX_LEAVERS_HISTORY);
      latest.updatedAt = Date.now();
      latest.lastScanStats = scanStats;
      return latest;
    });
    if (discordWebhook && newLeaversFound.length) await sendToDiscord(discordWebhook, newLeaversFound);

    const dur = ((Date.now() - lastScanTime) / 1000).toFixed(1);
    console.log(`✅ Scan abgeschlossen in ${dur}s | OK: ${scanStats.successfulScans} | Fehler: ${scanStats.failedScans} | Abgänge: ${newLeaversFound.length}`);

  } catch (err) {
    console.error('❌ Kritischer Scan-Fehler:', err.message);
  } finally {
    isScanning          = false;
    currentScanProgress = { current: 0, total: 0 };
  }
}

// ============================================
// TIMER
// ============================================
function resetTimer() {
  if (scanTimer) clearInterval(scanTimer);
  nextScanTime = Date.now() + SCAN_INTERVAL_MIN * 60_000;
  scanTimer = setInterval(() => {
    if (!isPaused) {
      runScanner();
      nextScanTime = Date.now() + SCAN_INTERVAL_MIN * 60_000;
    }
  }, SCAN_INTERVAL_MIN * 60_000);
  console.log(`⏰ Timer gesetzt: ${SCAN_INTERVAL_MIN} Minuten`);
}

// ============================================
// EXPRESS SERVER
// ============================================
const app = express();
configureProxy(app);
app.disable('x-powered-by');
const csrfToken = crypto.randomBytes(32).toString('hex');

// ============================================
// RATE LIMITER (einfach, ohne externe Library)
// ============================================
const rateLimitStore = new Map();

function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip  = req.ip || req.connection.remoteAddress;
    const key = `${maxRequests}:${ip}`;
    const now = Date.now();
    const rec = rateLimitStore.get(key) || { count: 0, start: now };

    if (now - rec.start > windowMs) {
      rec.count = 1;
      rec.start = now;
    } else {
      rec.count++;
    }

    rateLimitStore.set(key, rec);

    if (rec.count > maxRequests) {
      return res.status(429).json({ success: false, message: 'Zu viele Anfragen. Bitte warten.' });
    }
    next();
  };
}

// Rate Limit Store aufräumen (alle 10 Minuten)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitStore.entries()) {
    if (now - val.start > 60_000) rateLimitStore.delete(key);
  }
}, 600_000);

app.get('/healthz', (_, res) => res.json({ service: 'nexus-watchdog' }));
app.use(createAuth({ username: DASHBOARD_USER, hash: DASHBOARD_PASS_HASH, plain: DASHBOARD_PASS }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-CSRF-Token', csrfToken);
  next();
});
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  const expectedOrigin = process.env.DASHBOARD_ORIGIN || `${req.protocol}://${req.get('host')}`;
  if (req.get('X-CSRF-Token') !== csrfToken || (origin && origin !== expectedOrigin)) return res.status(403).json({ success: false, message: 'Seite neu laden und erneut versuchen' });
  next();
});

// ============================================
// API ENDPOINTS
// ============================================

// Status
// The bot only talks to a fixed local socket; it never receives Docker access.
function updaterRequest(method, path) {
  return new Promise((resolve, reject) => {
    const request = require('node:http').request({
      socketPath: '/run/nexus-updater/control.sock', path, method, timeout: 5000,
      headers: { 'Content-Length': '0' }
    }, response => {
      let body = '';
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 16384) request.destroy(new Error('Response too large'));
      });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, data: JSON.parse(body) }); }
        catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Timeout')));
    request.on('error', reject);
    request.end();
  });
}

for (const [method, route, target] of [
  ['get', '/api/update', '/status'],
  ['post', '/api/update/check', '/check'],
  ['post', '/api/update/install', '/install']
]) {
  app[method](route, rateLimit(30, 60_000), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const result = await updaterRequest(method.toUpperCase(), target);
      res.status(result.status).json(result.data);
    } catch {
      res.status(503).json({ message: 'Update-Dienst nicht erreichbar. Einmalig auf dem Server: git pull --ff-only && bash start.sh' });
    }
  });
}

app.get('/api/status', (req, res) => {
  res.json({
    isScanning, isPaused, lastScanTime, nextScanTime,
    interval: SCAN_INTERVAL_MIN,
    stats:    scanStats,
    progress: currentScanProgress,
    logs:     logHistory,
    uptime:   Math.floor(process.uptime()),
    version:  '3.0.0'
  });
});

// Watchlist abrufen
app.get('/api/watchlist', async (req, res) => {
  try {
    const snap = await db.ref(DB_PATH).once('value');
    res.json({ success: true, watchlist: snap.val()?.watchlist || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Clan hinzufügen (Rate Limit: 5 pro Minute)
app.post('/api/watchlist/add', rateLimit(5, 60_000), async (req, res) => {
  try {
    const clanTag = typeof req.body.clanTag === 'string' ? req.body.clanTag.trim().toUpperCase() : '';
    if (!clanTag || clanTag.length < 2 || clanTag.length > 5) {
      return res.status(400).json({ success: false, message: 'Ungültiger Clan-Tag (2–5 Zeichen)' });
    }

    const snap   = await db.ref(DB_PATH).once('value');
    const data   = snap.val();
    const apiKey = data?.settings?.apiKey || process.env.WG_API_KEY;

    if (!apiKey) return res.status(500).json({ success: false, message: 'Kein API Key konfiguriert' });

    const searchData = await fetchWargamingAPI(
      `https://api.worldoftanks.eu/wot/clans/list/?application_id=${encodeURIComponent(apiKey)}&search=${encodeURIComponent(clanTag)}&limit=5`,
      `Clan-Suche [${clanTag}]`
    );

    if (!searchData?.length) {
      return res.status(404).json({ success: false, message: `Clan [${clanTag}] nicht gefunden` });
    }

    // Exakten Match bevorzugen
    const clan = searchData.find(c => c.tag === clanTag);
    if (!clan) return res.status(404).json({ success: false, message: 'Kein exakter Clan-Tag gefunden' });

    const clanData = await fetchWargamingAPI(
      `https://api.worldoftanks.eu/wot/clans/info/?application_id=${encodeURIComponent(apiKey)}&clan_id=${encodeURIComponent(clan.clan_id)}&fields=members,members_count,tag`,
      `Clan-Info [${clan.tag}]`
    );

    const clanInfo = clanData?.[clan.clan_id];
    if (!clanInfo || !Array.isArray(clanInfo.members)) return res.status(404).json({ success: false, message: 'Clan-Daten nicht verfügbar' });

    const watchlist = data?.watchlist || [];
    if (watchlist.some(c => c.id === clan.clan_id)) {
      return res.status(400).json({ success: false, message: `Clan [${clan.tag}] ist bereits in der Watchlist` });
    }

    const newClan = {
      id:          clan.clan_id,
      tag:         clanInfo.tag,
      memberCount: clanInfo.members_count,
      members:     clanInfo.members.map(m => m.account_id),
      addedAt:     Date.now(),
      lastScan:    Date.now()
    };

    // Atomic update via Firebase transaction
    const result = await db.ref(`${DB_PATH}/watchlist`).transaction(current => {
      const list = current || [];
      if (list.some(c => c.id === newClan.id)) return; // Abbruch wenn bereits vorhanden
      list.push(newClan);
      return list;
    });

    if (!result.committed) return res.status(409).json({ success: false, message: 'Clan bereits vorhanden' });
    console.log(`✅ Clan [${newClan.tag}] zur Watchlist hinzugefügt`);
    res.json({ success: true, message: `Clan [${newClan.tag}] hinzugefügt`, clan: newClan });

  } catch (e) {
    console.error('❌ Fehler beim Hinzufügen:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// Clan entfernen
app.delete('/api/watchlist/remove/:clanId', rateLimit(10, 60_000), async (req, res) => {
  try {
    const clanId = Number(req.params.clanId);
    if (!Number.isSafeInteger(clanId) || clanId <= 0) return res.status(400).json({ success: false, message: 'Ungültige Clan-ID' });

    let removedTag = null;
    await db.ref(`${DB_PATH}/watchlist`).transaction(current => {
      removedTag = null;
      if (!current) return current;
      const clan = current.find(c => c.id === clanId);
      if (!clan) return current;
      removedTag = clan.tag;
      return current.filter(c => c.id !== clanId);
    });

    if (!removedTag) return res.status(404).json({ success: false, message: 'Clan nicht gefunden' });

    console.log(`🗑️ Clan [${removedTag}] entfernt`);
    res.json({ success: true, message: `Clan [${removedTag}] entfernt` });

  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Leavers
app.get('/api/leavers', async (req, res) => {
  try {
    const snap = await db.ref(DB_PATH).once('value');
    res.json({ success: true, leavers: snap.val()?.leavers || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Leavers löschen
app.delete('/api/leavers', async (req, res) => {
  try {
    await db.ref(`${DB_PATH}/leavers`).set([]);
    console.log('🗑️ Leaver-History gelöscht');
    res.json({ success: true, message: 'Leaver-History gelöscht' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Settings abrufen
app.get('/api/settings', async (req, res) => {
  try {
    const snap     = await db.ref(DB_PATH).once('value');
    const settings = snap.val()?.settings || {};
    res.json({
      success: true,
      settings: {
        apiKey:        settings.apiKey || process.env.WG_API_KEY ? 'Konfiguriert' : 'Nicht gesetzt',
        discordWebhook: settings.discordWebhook || process.env.DISCORD_WEBHOOK ? '✅ Konfiguriert' : '❌ Nicht gesetzt',
        scanInterval:  SCAN_INTERVAL_MIN
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Settings speichern (Rate Limit: 5 pro Minute)
app.post('/api/settings', rateLimit(5, 60_000), async (req, res) => {
  try {
    const { apiKey, discordWebhook } = req.body;
    if ((apiKey != null && (typeof apiKey !== 'string' || !/^[a-zA-Z0-9]{0,128}$/.test(apiKey))) || (discordWebhook != null && typeof discordWebhook !== 'string')) return res.status(400).json({ success: false, message: 'Ungültige Einstellungen' });

    // Webhook URL validieren wenn angegeben
    if (discordWebhook && !/^https:\/\/discord\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/.test(discordWebhook)) {
      return res.status(400).json({ success: false, message: 'Ungültige Discord Webhook URL' });
    }

    const snap    = await db.ref(DB_PATH).once('value');
    const current = snap.val()?.settings || {};

    const newSettings = {
      ...current,
      apiKey:         apiKey         || current.apiKey || '',
      discordWebhook: discordWebhook || current.discordWebhook || ''
    };

    await db.ref(`${DB_PATH}/settings`).set(newSettings);
    console.log('⚙️ Settings aktualisiert');
    res.json({ success: true, message: 'Einstellungen gespeichert' });

  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Scanner steuern
app.post('/api/scanner/forcescan', rateLimit(3, 60_000), (req, res) => {
  if (isScanning)  return res.status(400).json({ success: false, message: 'Scan läuft bereits' });
  if (isPaused)    return res.status(400).json({ success: false, message: 'Scanner ist pausiert' });
  runScanner().catch(e => console.error('Force-Scan Fehler:', e.message));
  resetTimer();
  res.json({ success: true, message: 'Scan gestartet' });
});

app.post('/api/scanner/pause', (req, res) => {
  isPaused = true;
  console.log('⏸️ Scanner pausiert');
  res.json({ success: true, message: 'Scanner pausiert' });
});

app.post('/api/scanner/resume', (req, res) => {
  isPaused = false;
  console.log('▶️ Scanner fortgesetzt');
  resetTimer();
  runScanner().catch(e => console.error('Resume-Scan Fehler:', e.message));
  res.json({ success: true, message: 'Scanner fortgesetzt' });
});

app.post('/api/scanner/interval', rateLimit(5, 60_000), (req, res) => {
  const val = Number(req.body.interval);
  if (!Number.isInteger(val) || val < 10 || val > 1440)
    return res.status(400).json({ success: false, message: 'Intervall: 10–1440 Minuten' });
  SCAN_INTERVAL_MIN = val;
  resetTimer();
  console.log(`⏱️ Intervall → ${SCAN_INTERVAL_MIN} Minuten`);
  res.json({ success: true, message: `Intervall auf ${SCAN_INTERVAL_MIN} Min. gesetzt` });
});

// ============================================
// DASHBOARD HTML
// ============================================
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NEXUS Watchdog v3</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#0d121c;--panel:#151c29;--panel2:#1b2638;--line:#263247;--text:#e7eefb;--muted:#8fa2c2;--blue:#4d8df7}
    body{font-family:Inter,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);padding:28px;min-height:100vh}
    .container{max-width:1400px;margin:0 auto}
    h1{text-align:center;margin-bottom:8px;font-size:2rem}
    .subtitle{text-align:center;opacity:.7;margin-bottom:24px;font-size:.9rem}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:24px}
    .card{background:var(--panel);border-radius:10px;padding:20px;border:1px solid var(--line);box-shadow:0 12px 30px rgba(0,0,0,.18)}
    .card h2{margin-bottom:14px;font-size:1.1rem;display:flex;align-items:center;gap:8px}
    .stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .stat{background:var(--panel2);border-radius:8px;padding:14px;text-align:left;border:1px solid var(--line)}
    .stat-val{font-size:1.45rem;font-weight:700;color:var(--text)}
    .stat-lbl{font-size:.72rem;color:var(--muted);margin-top:4px}
    .btn{padding:9px 16px;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:.85rem;transition:.2s}
    .btn-primary{background:var(--blue);color:#fff} .btn-primary:hover{background:#6ca2ff}
    .btn-warn{background:#ff9800;color:#fff}    .btn-warn:hover{background:#e65100}
    .btn-danger{background:#f44336;color:#fff}  .btn-danger:hover{background:#b71c1c}
    .btn-info{background:#2196f3;color:#fff}    .btn-info:hover{background:#1565c0}
    .btn:disabled{opacity:.4;cursor:not-allowed}
    .btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    input,select{width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);background:#0f1622;color:#fff;font-size:.9rem;margin-bottom:8px}
    input::placeholder{color:rgba(255,255,255,.5)}
    .progress-bar{background:rgba(0,0,0,.3);border-radius:20px;overflow:hidden;height:22px;margin:10px 0}
    .progress-fill{height:100%;background:linear-gradient(90deg,#4caf50,#8bc34a);display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:600;transition:width .5s}
    .logs{height:220px;overflow-y:auto;background:rgba(0,0,0,.4);border-radius:8px;padding:10px;font-family:monospace;font-size:.8rem}
    .log-info{color:#81d4fa} .log-error{color:#ef9a9a} .log-warn{color:#fff176}
    .log-entry{margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,.05);padding-bottom:3px}
    .log-time{color:rgba(255,255,255,.4);margin-right:6px}
    table{width:100%;border-collapse:collapse;font-size:.85rem}
    th{background:rgba(0,0,0,.3);padding:10px 8px;text-align:left}
    td{padding:9px 8px;border-bottom:1px solid rgba(255,255,255,.08)}
    tr:hover td{background:rgba(255,255,255,.05)}
    .badge{padding:3px 8px;border-radius:20px;font-size:.75rem;font-weight:700}
    .badge-ok{background:#4caf50} .badge-pause{background:#ff9800} .badge-scan{background:#2196f3}
    .alert{padding:10px 14px;border-radius:8px;margin-top:8px;font-size:.85rem}
    .alert-success{background:rgba(76,175,80,.3);border:1px solid #4caf50}
    .alert-error{background:rgba(244,67,54,.3);border:1px solid #f44336}
    .alert-info{background:rgba(33,150,243,.3);border:1px solid #2196f3}
    .tabs{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap}
    .tab{padding:8px 16px;border-radius:8px;cursor:pointer;background:rgba(255,255,255,.1);font-size:.85rem;transition:.2s}
    .tab.active{background:#182945;font-weight:700;border-bottom:2px solid var(--blue)}
    .tab-content{display:none} .tab-content.active{display:block}
    .version-badge{font-size:.7rem;background:rgba(0,0,0,.3);padding:2px 8px;border-radius:20px;margin-left:8px;vertical-align:middle}
  </style>
  <style>
    body{padding:0;font-size:13px;background:#0e131c}
    .container{max-width:none;margin:0 224px 0 228px;padding:32px}
    h1{text-align:left;font-size:26px;letter-spacing:-.7px;margin-bottom:8px}
    .subtitle{text-align:left;color:#91a0b8;margin-bottom:28px}
    .sidebar{position:fixed;inset:0 auto 0 0;width:228px;border-right:1px solid #242d3c;background:#10151e;padding:26px 16px}
    .brand{font-size:19px;font-weight:800;letter-spacing:3px;margin:0 8px 32px}.brand small{display:block;font-size:9px;letter-spacing:5px;color:#83a8e8;margin-top:5px}
    .workspace{padding:15px;background:#181f2b;border:1px solid #293142;border-radius:10px;color:#8fa4c5}.workspace strong{display:block;color:#e8efff;margin-top:5px}
    .nav-label{font-size:9px;letter-spacing:2px;color:#7189ac;margin:27px 8px 12px}
    .sidebar button{display:block;width:100%;text-align:left;padding:12px;border:0;border-radius:6px;background:transparent;color:#a5b9d7;cursor:pointer}.sidebar button:hover,.sidebar button:focus{background:#1b2941;color:#fff}
    .rail{position:fixed;inset:0 0 0 auto;width:224px;padding:25px 18px;border-left:1px solid #242d3c;background:#10151e;color:#90a5c5}.rail h2{font-size:12px;letter-spacing:1px;color:#dce8fd}.rail p{margin-top:20px;line-height:1.8}.rail small{color:#6f819e}
    .hero{padding:30px;margin-bottom:24px;border:1px solid #2a4266;border-radius:12px;background:linear-gradient(115deg,#1c3459,#142033)}.hero small{letter-spacing:2px;color:#9db8e4}.hero h2{font-size:28px;margin:18px 0 10px}.hero p{color:#a4b6d1;line-height:1.7}
    .card h2{font-size:14px}.tabs{border-bottom:1px solid #273044;padding-bottom:8px}.tab{background:transparent;color:#a7b9d4}.logs{background:#0d131e}.btn{font-size:12px}.badge-ok{background:#195346}.badge-pause{background:#795722}.stat-val{font-size:24px}
    @media(max-width:1150px){.rail{display:none}.container{margin-right:0}}
    @media(max-width:760px){.sidebar{position:static;width:auto;border-bottom:1px solid #273044;padding:16px}.sidebar .workspace,.sidebar .nav-label,.sidebar nav{display:none}.brand{margin:0}.container{margin:0;padding:20px}.grid{grid-template-columns:1fr}.hero{padding:22px}.hero h2{font-size:24px}.card{overflow-x:auto}.tabs{gap:0}.tab{padding:9px}}
  </style>
</head>
<body>
<aside class="sidebar"><div class="brand">NEXUS<small>HUB · WATCHDOG</small></div><div class="workspace">Dein Workspace<strong>${escapeHtml(CLAN_ID)}</strong></div><div class="nav-label">SCOUTING & RECRUITING</div><nav><button onclick="switchTab('logs')">◈ Übersicht & Logs</button><button onclick="switchTab('watchlist')">◎ Watchlist</button><button onclick="switchTab('leavers')">↗ Clan-Abgänge</button><button onclick="switchTab('settings')">⚙ Einstellungen</button></nav></aside>
<aside class="rail"><h2>◉ WATCHDOG</h2><p>Clan-Beobachtung<small><br>Wargaming · EU</small></p><p>Dein nächstes Talent.<br>Dein nächster Schritt.</p><p><small>Verbindungs- und Scanstatus findest du im Kontrollbereich.</small></p></aside>
<div class="container">
  <h1>🛡️ NEXUS Watchdog <span class="version-badge">v3.0.0</span></h1>
  <p class="subtitle">World of Tanks Clan Abgang-Tracker</p>
  <section class="hero"><small>DEIN COMMAND CENTER</small><h2>Das nächste Talent wartet.</h2><p>Behalte deine Watchlist im Blick und entdecke neue Clan-Abgänge.</p></section>

  <!-- Status Cards -->
  <div class="grid">
    <div class="card">
      <h2>📊 Status</h2>
      <div class="stat-grid">
        <div class="stat"><div class="stat-val" id="stat-status">–</div><div class="stat-lbl">Status</div></div>
        <div class="stat"><div class="stat-val" id="stat-uptime">–</div><div class="stat-lbl">Uptime</div></div>
        <div class="stat"><div class="stat-val" id="stat-interval">–</div><div class="stat-lbl">Intervall (Min)</div></div>
        <div class="stat"><div class="stat-val" id="stat-next">–</div><div class="stat-lbl">Nächster Scan</div></div>
      </div>
      <div id="progress-container" style="display:none" class="progress-bar">
        <div id="progress-fill" class="progress-fill" style="width:0%">0%</div>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn btn-primary" onclick="forceScan()" id="btn-scan">▶ Scan starten</button>
        <button class="btn btn-warn"    onclick="pauseScanner()" id="btn-pause">⏸ Pause</button>
        <button class="btn btn-info"    onclick="resumeScanner()" id="btn-resume">▶ Fortsetzen</button>
      </div>
    </div>

    <div class="card">
      <h2>📈 Scan Statistiken</h2>
      <div class="stat-grid">
        <div class="stat"><div class="stat-val" id="stat-total">–</div><div class="stat-lbl">Clans gesamt</div></div>
        <div class="stat"><div class="stat-val" id="stat-ok" style="color:#4caf50">–</div><div class="stat-lbl">Erfolgreich</div></div>
        <div class="stat"><div class="stat-val" id="stat-fail" style="color:#f44336">–</div><div class="stat-lbl">Fehlgeschlagen</div></div>
        <div class="stat"><div class="stat-val" id="stat-last">–</div><div class="stat-lbl">Letzter Scan</div></div>
      </div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <div class="tab active" onclick="switchTab('logs')">📋 Logs</div>
    <div class="tab" onclick="switchTab('watchlist')">👁️ Watchlist</div>
    <div class="tab" onclick="switchTab('leavers')">🏃 Abgänge</div>
    <div class="tab" onclick="switchTab('settings')">⚙️ Einstellungen</div>
  </div>

  <!-- LOGS -->
  <div id="tab-logs" class="tab-content active card">
    <h2>📋 Live Logs</h2>
    <div class="logs" id="logs"></div>
  </div>

  <!-- WATCHLIST -->
  <div id="tab-watchlist" class="tab-content card">
    <h2>👁️ Watchlist (<span id="watchlist-count">0</span> Clans)</h2>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input id="add-clan-input" type="text" placeholder="Clan-Tag eingeben (z.B. ODIN)" maxlength="5"
             onkeydown="if(event.key==='Enter')addClan()" style="margin:0">
      <button class="btn btn-primary" onclick="addClan()" style="white-space:nowrap">+ Hinzufügen</button>
    </div>
    <div id="add-clan-message"></div>
    <table>
      <thead><tr><th>Tag</th><th>Mitglieder</th><th>Hinzugefügt</th><th>Letzter Scan</th><th>Aktion</th></tr></thead>
      <tbody id="watchlist-body"><tr><td colspan="5" style="text-align:center;opacity:.5">Lade...</td></tr></tbody>
    </table>
  </div>

  <!-- LEAVERS -->
  <div id="tab-leavers" class="tab-content card">
    <h2>🏃 Abgänge (<span id="leavers-count">0</span>)</h2>
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <input id="filter-clan" type="text" placeholder="Nach Clan filtern..." oninput="filterLeavers()" style="margin:0;max-width:250px">
      <button class="btn btn-info" onclick="exportLeavers()">📥 CSV Export</button>
      <button class="btn btn-danger" onclick="clearLeavers()">🗑️ History löschen</button>
    </div>
    <table>
      <thead><tr><th>Spieler</th><th>PR</th><th>Clan</th><th>Zeitpunkt</th><th>Profil</th></tr></thead>
      <tbody id="leavers-body"><tr><td colspan="5" style="text-align:center;opacity:.5">Lade...</td></tr></tbody>
    </table>
  </div>

  <!-- SETTINGS -->
  <div id="tab-settings" class="tab-content card">
    <h2>⚙️ Einstellungen</h2>
    <div id="settings-current" style="margin-bottom:14px;opacity:.7;font-size:.85rem"></div>

    <label style="font-size:.85rem;opacity:.8">WG API Key</label>
    <input id="settings-apikey" type="password" placeholder="Neuen API Key eingeben (leer = unverändert)">

    <label style="font-size:.85rem;opacity:.8">Discord Webhook URL</label>
    <input id="settings-webhook" type="text" placeholder="https://discord.com/api/webhooks/...">

    <button class="btn btn-primary" onclick="saveSettings()">💾 Speichern</button>
    <div id="settings-message"></div>

    <hr style="margin:16px 0;border-color:rgba(255,255,255,.2)">

    <label style="font-size:.85rem;opacity:.8">Scan-Intervall (Minuten)</label>
    <input id="settings-interval" type="number" min="10" max="1440" placeholder="z.B. 120">
    <button class="btn btn-warn" onclick="updateInterval()">🔄 Intervall aktualisieren</button>
    <div id="interval-message"></div>
    <hr style="margin:16px 0;border-color:rgba(255,255,255,.2)">
    <h3>Bot aktualisieren</h3>
    <p>Aktualisiert den Bot, ohne deine Einrichtung zu löschen. Während des Neustarts ist das Dashboard kurz nicht erreichbar.</p>
    <button id="update-check" class="btn btn-primary" onclick="runUpdate('check')">Update prüfen</button>
    <button id="update-install" class="btn btn-warn" onclick="runUpdate('install')" disabled>Jetzt aktualisieren</button>
    <button class="btn" onclick="location.reload()">Dashboard neu laden</button>
    <p id="update-message" role="status" aria-live="polite">Noch nicht geprüft.</p>
  </div>
</div>

<script>
  let allLeavers = [];
  let activeTab  = 'logs';
  window.addEventListener('unhandledrejection', event => { event.preventDefault(); if (!updateWaiting) alert(event.reason?.message || 'Anfrage fehlgeschlagen'); });
  const csrfToken = '${csrfToken}';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelectorAll('.tab')[['logs','watchlist','leavers','settings'].indexOf(tab)].classList.add('active');
    activeTab = tab;
    if (tab === 'watchlist') loadWatchlist();
    if (tab === 'leavers')   loadLeavers();
    if (tab === 'settings') { loadSettings(); pollUpdate(); }
  }

  function formatTimeAgo(ts) {
    if (!ts) return 'Nie';
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60)  return 'Gerade eben';
    if (sec < 3600) return Math.floor(sec/60) + ' Min. ago';
    if (sec < 86400) return Math.floor(sec/3600) + ' Std. ago';
    return Math.floor(sec/86400) + ' Tag(e) ago';
  }

  let updateTimer;
  let updateWaiting = false;
  let updateDeadline = 0;
  function displayUpdate(data) {
    const busy = data.phase === 'checking' || data.phase === 'updating';
    document.getElementById('update-message').textContent = data.message;
    document.getElementById('update-check').disabled = busy;
    document.getElementById('update-install').disabled = busy || !data.available;
    updateWaiting = busy;
    if (busy) {
      if (!updateDeadline) updateDeadline = Date.now() + 15 * 60 * 1000;
      updateTimer = setTimeout(pollUpdate, 5000);
    } else {
      updateDeadline = 0;
      if (sessionStorage.getItem('nexus-update') === 'install' && data.phase === 'success') {
        sessionStorage.removeItem('nexus-update');
        location.reload();
      } else if (data.phase === 'error' || data.phase === 'rolled_back') {
        sessionStorage.removeItem('nexus-update');
      }
    }
  }
  async function pollUpdate() {
    clearTimeout(updateTimer);
    try { displayUpdate(await apiCall('/api/update')); }
    catch (error) {
      document.getElementById('update-message').textContent = updateWaiting
        ? 'Verbindung unterbrochen; warte auf den Bot …' : error.message;
      if (updateWaiting && Date.now() < updateDeadline) updateTimer = setTimeout(pollUpdate, 5000);
      else {
        document.getElementById('update-check').disabled = false;
        document.getElementById('update-install').disabled = true;
        if (updateWaiting) document.getElementById('update-message').textContent = 'Zeitlimit erreicht. Serverstatus prüfen und Dashboard neu laden.';
        updateWaiting = false;
      }
    }
  }
  async function runUpdate(action) {
    if (action === 'install' && !confirm('Bot jetzt aktualisieren? Er ist während des Neustarts kurz nicht erreichbar.')) return;
    clearTimeout(updateTimer);
    document.getElementById('update-check').disabled = true;
    document.getElementById('update-install').disabled = true;
    if (action === 'install') sessionStorage.setItem('nexus-update', 'install');
    try { displayUpdate(await apiCall('/api/update/' + action, { method: 'POST' })); }
    catch (error) {
      document.getElementById('update-message').textContent = error.message;
      // The request may have been accepted immediately before the restart.
      updateWaiting = true;
      updateDeadline = Date.now() + 15 * 60 * 1000;
      updateTimer = setTimeout(pollUpdate, 5000);
    }
  }

  function formatUptime(sec) {
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60);
    return h + 'h ' + m + 'm';
  }

  function apiCall(url, opts = {}) {
    return fetch(url, { ...opts, headers: { ...opts.headers, 'X-CSRF-Token': csrfToken } }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Anfrage fehlgeschlagen');
      return data;
    });
  }

  function updateStatus() {
    apiCall('/api/status').then(data => {
      const scanning = data.isScanning;
      const paused   = data.isPaused;

      document.getElementById('stat-status').innerHTML =
        scanning ? '<span class="badge badge-scan">Scannt</span>' :
        paused   ? '<span class="badge badge-pause">Pausiert</span>' :
                   '<span class="badge badge-ok">Bereit</span>';

      document.getElementById('stat-uptime').textContent   = formatUptime(data.uptime);
      document.getElementById('stat-interval').textContent = data.interval;
    document.getElementById('stat-next').textContent = data.isPaused ? 'Pausiert' : Math.max(0, Math.ceil((data.nextScanTime - Date.now()) / 60000)) + ' Min.';
      document.getElementById('stat-total').textContent    = data.stats.totalClans;
      document.getElementById('stat-ok').textContent       = data.stats.successfulScans;
      document.getElementById('stat-fail').textContent     = data.stats.failedScans;
      document.getElementById('stat-last').textContent     = formatTimeAgo(data.lastScanTime);

      const pc = document.getElementById('progress-container');
      if (scanning && data.progress.total > 0) {
        const pct = Math.floor(data.progress.current / data.progress.total * 100);
        pc.style.display = 'block';
        const fill = document.getElementById('progress-fill');
        fill.style.width = pct + '%';
        fill.textContent = data.progress.current + '/' + data.progress.total + ' (' + pct + '%)';
      } else {
        pc.style.display = 'none';
      }

      document.getElementById('btn-scan').disabled   = scanning || paused;
      document.getElementById('btn-pause').disabled  = paused   || scanning;
      document.getElementById('btn-resume').disabled = !paused;

      if (activeTab === 'logs') {
        document.getElementById('logs').innerHTML = data.logs.map(l =>
          '<div class="log-entry log-' + esc(l.type) + '"><span class="log-time">' + esc(l.time) + '</span><span>' + esc(l.msg) + '</span></div>'
        ).join('');
      }
    }).catch(() => {});
  }

  function forceScan() {
    apiCall('/api/scanner/forcescan', { method: 'POST' })
      .then(d => { if (!d.success) alert(d.message); updateStatus(); });
  }

  function pauseScanner() {
    apiCall('/api/scanner/pause', { method: 'POST' }).then(() => updateStatus());
  }

  function resumeScanner() {
    apiCall('/api/scanner/resume', { method: 'POST' }).then(() => updateStatus());
  }

  function loadWatchlist() {
    apiCall('/api/watchlist').then(data => {
      document.getElementById('watchlist-count').textContent = data.watchlist.length;
      const tbody = document.getElementById('watchlist-body');
      if (!data.watchlist.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;opacity:.5">Keine Clans</td></tr>';
        return;
      }
      tbody.innerHTML = data.watchlist.map(c =>
        '<tr><td><strong>[' + esc(c.tag) + ']</strong></td><td>' + esc(c.memberCount) + '</td><td>' +
        formatTimeAgo(c.addedAt) + '</td><td>' + formatTimeAgo(c.lastScan) +
        '</td><td><button class="btn btn-danger" onclick="removeClan(' + Number(c.id) + ')">🗑️</button></td></tr>'
      ).join('');
    });
  }

  function addClan() {
    const input  = document.getElementById('add-clan-input');
    const clanTag = input.value.trim();
    const msgEl  = document.getElementById('add-clan-message');
    if (!clanTag) { msgEl.innerHTML = '<div class="alert alert-error">Bitte Tag eingeben!</div>'; return; }
    msgEl.innerHTML = '<div class="alert alert-info">🔍 Suche...</div>';
    apiCall('/api/watchlist/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clanTag })
    }).then(d => {
      msgEl.textContent = d.message;
      if (d.success) { input.value = ''; loadWatchlist(); }
    });
  }

  function removeClan(id, tag) {
    if (!confirm('Diesen Clan wirklich entfernen?')) return;
    apiCall('/api/watchlist/remove/' + id, { method: 'DELETE' }).then(() => loadWatchlist()).catch(e => alert(e.message));
  }

  function loadLeavers() {
    apiCall('/api/leavers').then(data => {
      allLeavers = data.leavers;
      displayLeavers(allLeavers);
    });
  }

  function displayLeavers(leavers) {
    document.getElementById('leavers-count').textContent = leavers.length;
    const tbody = document.getElementById('leavers-body');
    if (!leavers.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;opacity:.5">Keine Abgänge</td></tr>';
      return;
    }
    tbody.innerHTML = leavers.map(l =>
        '<tr><td><strong>' + esc(l.name) + '</strong></td><td>' + esc(l.pr || 'N/A') +
      '</td><td>[' + esc(l.oldClan) + ']</td><td>' + esc(formatTimeAgo(l.leftAt)) +
      '</td><td><a href="https://tomato.gg/stats/EU/' + esc(encodeURIComponent(l.name)) + '=' + Number(l.id) +
      '" target="_blank" style="color:#4fc3f7">🔗</a></td></tr>'
    ).join('');
  }

  function filterLeavers() {
    const f = document.getElementById('filter-clan').value.toLowerCase();
    displayLeavers(allLeavers.filter(l => l.oldClan.toLowerCase().includes(f)));
  }

  function clearLeavers() {
    if (!confirm('Gesamte Abgangs-History löschen?')) return;
    apiCall('/api/leavers', { method: 'DELETE' }).then(() => loadLeavers()).catch(e => alert(e.message));
  }

  function exportLeavers() {
    let csv = 'Spieler,PR,Clan,Zeitpunkt\\n';
    const cell = value => '"' + (/^[=+@\\t\\r-]/.test(String(value)) ? "'" : '') + String(value).replace(/"/g, '""') + '"';
    allLeavers.forEach(l => {
      csv += [l.name, l.pr ?? 'N/A', '[' + l.oldClan + ']', new Date(l.leftAt).toLocaleString('de-DE')].map(cell).join(',') + '\\n';
    });
    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: 'leavers-' + new Date().toISOString().split('T')[0] + '.csv'
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function loadSettings() {
    apiCall('/api/settings').then(data => {
      const s = data.settings;
      document.getElementById('settings-current').innerHTML =
        'API Key: <strong>' + esc(s.apiKey) + '</strong> &nbsp;|&nbsp; Webhook: <strong>' + esc(s.discordWebhook) + '</strong>';
    });
  }

  function saveSettings() {
    const apiKey  = document.getElementById('settings-apikey').value;
    const webhook = document.getElementById('settings-webhook').value;
    const msgEl   = document.getElementById('settings-message');
    apiCall('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, discordWebhook: webhook })
    }).then(d => {
      msgEl.textContent = d.message;
      if (d.success) { document.getElementById('settings-apikey').value = ''; loadSettings(); }
    });
  }

  function updateInterval() {
    const val   = document.getElementById('settings-interval').value;
    const msgEl = document.getElementById('interval-message');
    apiCall('/api/scanner/interval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval: parseInt(val) })
    }).then(d => {
      msgEl.textContent = d.message;
      if (d.success) updateStatus();
    });
  }

  updateStatus();
  setInterval(updateStatus, 3000);
</script>
</body>
</html>`);
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
async function shutdown(signal) {
  console.log(`\n⚠️ ${signal} empfangen – Bot wird sauber beendet...`);
  isPaused = true;
  if (scanTimer) clearInterval(scanTimer);
  server.close();
  const deadline = Date.now() + 25000;
  while (isScanning && Date.now() < deadline) await delay(100);
  try { await db.goOffline(); } catch {}
  console.log('✅ Sauber beendet');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException', err => {
  console.error('💥 Uncaught Exception:', err.message, err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
});

// ============================================
// SERVER STARTEN
// ============================================
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1'; // Standard: nur lokal (nginx vorschalten!)

const server = app.listen(DASHBOARD_PORT, HOST, () => {
  console.log(`🌐 Dashboard: http://${HOST}:${DASHBOARD_PORT}`);
  console.log(`🔐 Login: ${DASHBOARD_USER}`);
  console.log(`ℹ️  Für HTTPS bitte nginx als Reverse Proxy vorschalten!`);
});

// Start
resetTimer();
runScanner().catch(e => console.error('Initialer Scan Fehler:', e.message));
