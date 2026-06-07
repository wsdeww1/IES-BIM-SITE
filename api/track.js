/*
 * POST /api/track  (public, no auth)
 * Lightweight analytics beacon fired by the public site on each page view and
 * as a periodic heartbeat (to power the "live visitors" count).
 * Body: { visitorId, page, ref }.  Always replies 204 quickly and never throws.
 */
const { recordView, touchLive, removeLive } = require('./_lib/stats');

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = [];
  try { for await (const c of req) chunks.push(c); } catch (e) { return {}; }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return {}; }
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  try {
    const body = await readBody(req);
    const host = req.headers.host || '';
    if (body.leave) {
      // Tab closed/hidden — drop from "live" right away so the count falls.
      await removeLive(body.visitorId);
    } else if (body.beat) {
      // Periodic heartbeat — refresh presence only, never counts as a pageview.
      await touchLive(body.visitorId);
    } else {
      await recordView({
        visitorId: body.visitorId,
        page: body.page,
        ref: body.ref || req.headers.referer || '',
        ua: req.headers['user-agent'] || '',
        host,
        ip: clientIp(req),
      });
    }
  } catch (e) { /* analytics must never break */ }
  res.statusCode = 204;
  res.end();
};
