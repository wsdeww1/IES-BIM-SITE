#!/usr/bin/env node
/*
 * Generates a bcrypt hash for the admin password, plus a random JWT secret.
 * Usage:
 *   npm install
 *   npm run hash-password "your-strong-password"
 *
 * Copy the printed lines into your .env file (local) AND into the Vercel
 * project environment variables (production). The plain password is never
 * stored anywhere.
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const pw = process.argv[2];
if (!pw) {
  console.error('\n  Usage: npm run hash-password "your-strong-password"\n');
  process.exit(1);
}
if (pw.length < 8) {
  console.error('\n  Please use a password of at least 8 characters.\n');
  process.exit(1);
}

const hash = bcrypt.hashSync(pw, 12);
const secret = crypto.randomBytes(48).toString('hex');

console.log('\n  Add these to your .env and to Vercel → Settings → Environment Variables:\n');
console.log('  ADMIN_PASSWORD_HASH=' + hash);
console.log('  JWT_SECRET=' + secret);
console.log('\n  (Keep JWT_SECRET stable — changing it logs the admin out.)\n');
