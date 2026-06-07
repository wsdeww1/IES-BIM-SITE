/* POST /api/logout → clears the session cookie. */
const { send, clearSessionCookie } = require('./_lib/util');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  clearSessionCookie(res);
  return send(res, 200, { ok: true });
};
