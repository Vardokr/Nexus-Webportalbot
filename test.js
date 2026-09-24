const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = require('node:fs').readFileSync('nexus-bot.js', 'utf8').replace(/\r\n/g, '\n');
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
test('password verification: scrypt, legacy and malformed hashes', () => {
  const code = source.slice(source.indexOf('function verifyPassword'), source.indexOf('// AUTH MIDDLEWARE'));
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = `scrypt:${salt}:${crypto.scryptSync('password', salt, 64).toString('hex')}`;
  for (const [stored, input, expected] of [[hash, 'password', true], [hash, 'wrong', false], ['invalid', 'x', false], ['scrypt:x:x', 'x', false], [crypto.createHash('sha256').update('old').digest('hex'), 'old', true]]) {
    assert.equal(vm.runInNewContext(code + ';verifyPassword(input)', { crypto, Buffer, DASHBOARD_PASS_HASH: stored, DASHBOARD_PASS: '', input }), expected);
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
