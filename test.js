const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = require('node:fs').readFileSync('nexus-bot.js', 'utf8').replace(/\r\n/g, '\n');

test('membership comparison ignores ranks, ordering and ID representation', () => {
  const helpers = vm.runInNewContext(source.slice(source.indexOf('function memberIds('), source.indexOf('async function runScanner()')) + '\n({ memberIds, confirmedLeavers })');
  const oldIds = helpers.memberIds([{ account_id: '12', role: 'private' }, 34]);
  const currentIds = helpers.memberIds([{ account_id: 34 }, { account_id: 12, role: 'commander' }]);
  assert.equal(oldIds.filter(id => !currentIds.includes(id)).length, 0);
  assert.deepEqual(Array.from(helpers.confirmedLeavers([12, 34, 56], {
    12: { clan_id: '100' }, 34: { clan_id: null }, 56: { clan_id: 200 }
  }, 100)), [34, 56]);
  for (const accounts of [{}, { 12: null }, { 12: {} }, { 12: { clan_id: '' } }]) {
    assert.throws(() => helpers.confirmedLeavers([12], accounts, 100));
  }
  assert.throws(() => helpers.memberIds([{}]));
});
test('scanner retries uncertain membership and only records confirmed departures', async () => {
  const clan = { id: 100, tag: 'TEST', members: ['12'], addedAt: 1 };
  let latest = { watchlist: [clan], settings: { apiKey: 'test' } };
  let account = { clan_id: 100, nickname: 'Player' };
  let fail = false;
  const context = vm.createContext({
    isScanning: false, isPaused: false, lastScanTime: null, scanStats: {}, currentScanProgress: {},
    console: { log() {}, warn() {}, error() {} }, delay: async () => {}, REQUEST_DELAY_MS: 0,
    DB_PATH: 'test', MAX_LEAVERS_HISTORY: 100, process: { env: {} },
    db: { ref: () => ({ once: async () => ({ val: () => latest }), transaction: async fn => {
      assert.equal(fn(null), null, 'empty cache must not abort the transaction');
      latest = fn(latest);
      return { committed: true, snapshot: { exists: () => true } };
    } }) },
    fetchWargamingAPI: async url => {
      if (url.includes('/clans/info/')) return { 100: { members: [], members_count: 0 } };
      assert.ok(url.includes('clan_id'));
      if (fail) throw new Error('API offline');
      return { 12: account };
    }
  });
  vm.runInContext(source.slice(source.indexOf('function memberIds('), source.indexOf('// TIMER')), context);
  for (const state of ['same clan', 'missing account', 'API error', 'real departure']) {
    account = state === 'missing account' ? null : { clan_id: state === 'real departure' ? null : 100, nickname: 'Player' };
    fail = state === 'API error';
    await vm.runInContext('runScanner()', context);
    if (state !== 'real departure') {
      assert.equal(latest.leavers?.length || 0, 0);
      assert.equal(Number(latest.watchlist[0].members[0]), 12);
    }
  }
  assert.equal(latest.leavers.length, 1);
  assert.equal(latest.leavers[0].id, 12);
  await vm.runInContext('runScanner()', context);
  assert.equal(latest.leavers.length, 1);
});

test('scan merge preserves concurrent additions/removals and cleared history', async () => {
  const start = source.indexOf('await db.ref(DB_PATH).transaction(latest =>');
  const end = source.indexOf('\n    });', start) + 8;
  const latest = { watchlist: [{ id: 2, addedAt: 1 }, { id: 3, addedAt: 2 }], leavers: [] };
  let result;
  await vm.runInNewContext('(async () => {' + source.slice(start, end) + '})()', {
    db: { ref: () => ({ transaction: async fn => { result = fn(latest); } }) }, DB_PATH: 'test',
    watchlist: [{ id: 1, addedAt: 1 }, { id: 2, addedAt: 1 }],
    updatedWatchlist: [{ id: 1, addedAt: 1 }, { id: 2, addedAt: 1, memberCount: 10 }],
    newLeaversFound: [{ id: 9 }], MAX_LEAVERS_HISTORY: 100, scanStats: {}
  });
  assert.deepEqual(result.watchlist.map(c => c.id), [2, 3]);
  assert.equal(result.watchlist[0].memberCount, 10);
  assert.equal(result.leavers.length, 1);
});
test('password verification: scrypt, legacy and malformed hashes', async () => {
  const { verifyPassword } = require('./security');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = `scrypt:${salt}:${crypto.scryptSync('password', salt, 64).toString('hex')}`;
  for (const [stored, input, expected] of [[hash, 'password', true], [hash, 'wrong', false], ['invalid', 'x', false], ['scrypt:x:x', 'x', false], [crypto.createHash('sha256').update('old').digest('hex'), 'old', true]]) {
    assert.equal(await verifyPassword(input, stored, ''), expected);
  }
});

test('scan never announces success or notifies Discord after an uncommitted save', async () => {
  for (const result of [
    { committed: false, snapshot: { exists: () => true } },
    { committed: true, snapshot: { exists: () => false } }
  ]) {
    const logs = [];
    const errors = [];
    const data = { watchlist: [{ id: 100, tag: 'TEST', members: [12], addedAt: 1 }], settings: { apiKey: 'test', discordWebhook: 'test' } };
    const context = vm.createContext({
      isScanning: false, isPaused: false, lastScanTime: null, scanStats: {}, currentScanProgress: {},
      console: { log: s => logs.push(s), warn() {}, error: (...s) => errors.push(s.join(' ')) },
      delay: async () => {}, REQUEST_DELAY_MS: 0, DB_PATH: 'test', MAX_LEAVERS_HISTORY: 100, process: { env: {} },
      db: { ref: () => ({ once: async () => ({ val: () => data }), transaction: async fn => {
        assert.equal(fn(null), null);
        return result;
      } }) },
      fetchWargamingAPI: async url => url.includes('/clans/info/')
        ? { 100: { members: [], members_count: 0 } } : { 12: { clan_id: null } },
      sendToDiscord: async () => assert.fail('No notification before confirmed persistence')
    });
    vm.runInContext(source.slice(source.indexOf('function memberIds('), source.indexOf('// TIMER')), context);
    await vm.runInContext('runScanner()', context);
    assert.ok(errors.some(s => s.includes('Scan nicht gespeichert')));
    assert.ok(!logs.some(s => s.includes('Scan abgeschlossen')));
    assert.equal(context.isScanning, false);
    assert.deepEqual(data.watchlist[0].members, [12]);
  }
});
test('generated dashboard script compiles', () => {
  let html;
  vm.runInNewContext(source.slice(source.indexOf("app.get('/',"), source.indexOf('// GRACEFUL SHUTDOWN')), { app: { get: (_, fn) => fn({}, { send: value => { html = value; } }) }, csrfToken: 'test', CLAN_ID: 'ODIN', escapeHtml: String });
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
});
test('CSRF rejects missing token and foreign origins', () => {
  const start = source.indexOf("app.use((req, res, next) => {\n  if (!['POST'");
  assert.ok(start >= 0);
  let middleware;
  vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), { app: { use: fn => { middleware = fn; } }, csrfToken: 'token', process: { env: {} } });
  for (const [token, origin, expected] of [[undefined, undefined, 403], ['token', 'https://evil.test', 403], ['token', 'https://hub.test', 200]]) {
    let status;
    const res = { status: code => { status = code; return res; }, json: () => {} };
    middleware({ method: 'POST', protocol: 'https', get: key => ({ origin, host: 'hub.test', 'X-CSRF-Token': token })[key] }, res, () => { status = 200; });
    assert.equal(status, expected);
  }
});
test('CSRF accepts configured HTTPS origin behind a container proxy', () => {
  const start = source.indexOf("app.use((req, res, next) => {\n  if (!['POST'");
  let middleware;
  vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
    app: { use: fn => { middleware = fn; } }, csrfToken: 'token',
    process: { env: { DASHBOARD_ORIGIN: 'https://hub.test' } }
  });
  for (const [origin, expected] of [['https://hub.test', 200], ['http://hub.test', 403], ['https://evil.test', 403]]) {
    let status;
    const res = { status: code => { status = code; return res; }, json: () => {} };
    middleware({ method: 'POST', protocol: 'http', get: key => ({ origin, host: 'hub.test', 'X-CSRF-Token': 'token' })[key] }, res, () => { status = 200; });
    assert.equal(status, expected);
  }
});
