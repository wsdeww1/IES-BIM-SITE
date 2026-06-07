/*
 * GET /api/stats?days=14  (admin only)
 * Returns aggregated analytics for the dashboard + analytics screens.
 */
const { send, requireAuth } = require('./_lib/util');
const { getStats } = require('./_lib/stats');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  const url = require('url').parse(req.url, true);
  const days = (url.query && url.query.days) || 14;
  try {
    const stats = await getStats(days);
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, stats);
  } catch (e) {
    return send(res, 500, { error: 'Could not load analytics.' });
  }
};
