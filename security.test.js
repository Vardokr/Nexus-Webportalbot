'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAuth, configureProxy } = require('./security');

function request(password, ip = 'client-one') {
  return { ip, get: () => 'Basic ' + Buffer.from('admin:' + password).toString('base64') };
}
async function call(auth, password, ip) {
  let status;
  const res = { set() {}, status(n) { status = n; return this; }, json() {} };
  await auth(request(password, ip), res, () => { status = 200; });
  return status;
}
test('login limit stops password work, isolates clients and caches accepted credentials', async () => {
  let checks = 0;
  const auth = createAuth({ username: 'admin', verify: async p => { checks++; return p === 'correct'; } });
  assert.equal(await call(auth, 'correct'), 200);
  for (let i = 0; i < 100; i++) assert.equal(await call(auth, 'correct'), 200);
  assert.equal(checks, 1);
  for (let i = 0; i < 19; i++) assert.equal(await call(auth, 'wrong'), 401);
  for (let i = 0; i < 20; i++) assert.equal(await call(auth, 'wrong'), 429);
  assert.equal(checks, 20);
  assert.equal(await call(auth, 'wrong', 'client-two'), 401);
  assert.equal(await call(auth, 'correct'), 200);
});
test('at most two expensive password checks run concurrently across clients', async () => {
  const release = [];
  const auth = createAuth({ username: 'admin', verify: () => new Promise(resolve => release.push(resolve)) });
  const first = call(auth, 'one', 'one');
  const second = call(auth, 'two', 'two');
  assert.equal(await call(auth, 'three', 'three'), 429);
  assert.equal(release.length, 2);
  release.forEach(resolve => resolve(false));
  assert.deepEqual(await Promise.all([first, second]), [401, 401]);
});
test('proxy mode uses the closest forwarded address, not the attacker-supplied prefix', async t => {
  const previous = process.env.DASHBOARD_TRUST_PROXY;
  process.env.DASHBOARD_TRUST_PROXY = '1';
  const app = express();
  configureProxy(app);
  if (previous === undefined) delete process.env.DASHBOARD_TRUST_PROXY;
  else process.env.DASHBOARD_TRUST_PROXY = previous;
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}`, { headers: { 'X-Forwarded-For': 'spoofed, 192.0.2.10' } });
  assert.deepEqual(await response.json(), { ip: '192.0.2.10' });
});
