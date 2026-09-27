'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

// Only enable one trusted hop when the supplied Compose proxy is the sole
// public entry point. Caddy replaces incoming forwarding headers.
function configureProxy(app) {
  app.set('trust proxy', process.env.DASHBOARD_TRUST_PROXY === '1' ? 1 : 'loopback');
}

function createLimiter(limit, windowMs, capacity = 4096) {
  const records = new Map();
  return key => {
    const now = Date.now();
    let record = records.get(key);
    if (!record || now >= record.until) {
      if (!record && records.size >= capacity) {
        for (const [id, item] of records) if (now >= item.until) records.delete(id);
        // Bound memory without evicting active limits.
        if (records.size >= capacity) return false;
      }
      record = { count: 0, until: now + windowMs };
      records.set(key, record);
    }
    return ++record.count <= limit;
  };
}

async function verifyPassword(input, hash, plain) {
  if (hash.startsWith('scrypt:')) {
    const parts = hash.split(':');
    if (parts.length !== 3 || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
    return crypto.timingSafeEqual(await scrypt(input, parts[1], 64), Buffer.from(parts[2], 'hex'));
  }
  const actual = hash ? crypto.createHash('sha256').update(input).digest('hex') : input;
  const expected = hash ? hash.trim() : plain;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createAuth({ username, hash = '', plain = '', verify = input => verifyPassword(input, hash, plain) }) {
  const allow = createLimiter(20, 60000);
  const cache = new Map();
  const cacheKey = crypto.randomBytes(32);
  let active = 0;
  return async (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const deny = status => {
      res.set('WWW-Authenticate', 'Basic realm="NEXUS Watchdog Control"');
      if (status === 429) res.set('Retry-After', '60');
      return res.status(status).json({ success: false, message: status === 429 ? 'Zu viele Anfragen. Bitte warten.' : 'Authentifizierung erforderlich' });
    };
    if (authorization.length > 2048) return deny(401);
    const fingerprint = crypto.createHmac('sha256', cacheKey).update(authorization).digest('hex');
    if ((cache.get(fingerprint) || 0) > Date.now()) return next();
    if (!allow(req.ip)) return deny(429);
    if (!/^Basic /i.test(authorization)) return deny(401);
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString();
    const colon = decoded.indexOf(':');
    if (colon < 0 || decoded.slice(0, colon) !== username || decoded.length - colon - 1 > 256) return deny(401);
    if (active >= 2) return deny(429);
    active++;
    let accepted = false;
    try { accepted = await verify(decoded.slice(colon + 1)); }
    catch { /* Malformed persisted credentials must not crash the server. */ }
    finally { active--; }
    if (!accepted) return deny(401);
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(fingerprint, Date.now() + 5 * 60000);
    next();
  };
}
module.exports = { configureProxy, createLimiter, createAuth, verifyPassword };
