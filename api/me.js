/* GET /api/me → { authenticated, email } — lets the admin SPA check the session. */
const { send, getSession } = require('./_lib/util');

module.exports = async (req, res) => {
  const s = getSession(req);
  if (!s || s.role !== 'admin') return send(res, 401, { authenticated: false });
  return send(res, 200, { authenticated: true, email: s.sub });
};
