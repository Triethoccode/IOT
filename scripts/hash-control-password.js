'use strict';
// Reads stdin so the password does not appear in process arguments/history.
const crypto = require('node:crypto');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const password = input.replace(/\r?\n$/, '');
  if (password.length < 12 || password.length > 256) throw Error('Use a password of 12–256 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  console.log(`${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`);
});
