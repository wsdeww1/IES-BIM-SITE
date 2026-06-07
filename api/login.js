/* POST /api/login  { email, password } → sets httpOnly session cookie. */
const bcrypt = require('bcryptjs');
const {
  send, readJson, signSession, setSessionCookie, clientIp,
  isRateLimited, recordFailedLogin, clearFailedLogins, env,
} = require('./_lib/util');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const adminEmail = env('ADMIN_EMAIL').toLowerCase();
  const hash = env('ADMIN_PASSWORD_HASH');
  const secret = env('JWT_SECRET');
  if (!adminEmail || !hash || !secret) {
    return send(res, 500, { error: 'Admin login is not configured on the server.' });
  }

  const ip = clientIp(req);
  if (await isRateLimited(ip)) {
    return send(res, 429, { error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  // Always run bcrypt (even on email mismatch) to avoid timing/user enumeration.
  const emailOk = email === adminEmail;
  let passOk = false;
  try { passOk = await bcrypt.compare(password, hash); } catch (e) { passOk = false; }

  if (!emailOk || !passOk) {
    await recordFailedLogin(ip);
    return send(res, 401, { error: 'Invalid credentials' }); // never reveal which part
  }

  await clearFailedLogins(ip);
  setSessionCookie(res, signSession(adminEmail));
  return send(res, 200, { ok: true, email: adminEmail });
};
