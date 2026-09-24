'use strict';
const crypto = require('node:crypto');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const password = input.replace(/[\r\n]+$/, '');
  if (password.length < 12) { console.error('Mindestens 12 Zeichen erforderlich.'); process.exitCode = 1; return; }
  const salt = crypto.randomBytes(16).toString('hex');
  console.log(`scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`);
});
