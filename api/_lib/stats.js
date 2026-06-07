/*
 * First-party, privacy-light analytics for the IES site.
 *
 * Runs on Vercel KV (Redis) in production and falls back to a git-ignored
 * local JSON file in dev, so the dashboard shows real numbers in both places.
 * Everything is wrapped in try/catch — analytics must NEVER break the site.
 *
 * Data model (daily buckets, so "today" resets automatically at UTC midnight):
 *   st:pv:<day>     pageviews that day            (counter)
 *   st:pv:all       pageviews all-time            (counter)
 *   st:uv:<day>     unique visitor ids that day   (set → scard = count)
 *   st:edits:<day>  admin publishes that day      (counter)
 *   st:edits:all    admin publishes all-time      (counter)
 *   st:pages:<day>  { page: count }               (hash)
 *   st:src:<day>    { direct|search|social|referral: count }
 *   st:dev:<day>    { desktop|mobile: count }
 *   st:live         visitorId → lastSeen(ms)      (sorted set; live = last 5 min)
 */
const fs = require('fs');
const path = require('path');

const LIVE_WINDOW_MS = 45 * 1000;         // "online now" = active in the last 45s (heartbeat every 15s)
const DAY_TTL_SEC = 120 * 24 * 3600;      // keep daily buckets ~4 months
const LOCAL_FILE = path.join(process.cwd(), 'data', 'stats.local.json');

/* ── KV (lazy, optional) ─────────────────────────────────── */
let _kv;
function getKv() {
  if (_kv !== undefined) return _kv;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) { _kv = null; return _kv; }
  try { _kv = require('@vercel/kv').kv; } catch (e) { _kv = null; }
  return _kv;
}

/* ── date helpers (UTC) ──────────────────────────────────── */
function dayKey(d) { return (d || new Date()).toISOString().slice(0, 10); } // YYYY-MM-DD
function lastDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(now - i * 86400000)));
  return out;
}

/* ── classification (from request data) ─────────────────── */
function classifySource(ref, host) {
  if (!ref) return 'direct';
  let h = '';
  try { h = new URL(ref).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return 'direct'; }
  if (host && h && host.replace(/^www\./, '').toLowerCase() === h) return 'direct';
  if (/(google|bing|duckduckgo|yahoo|yandex|ecosia|baidu)\./.test(h)) return 'search';
  if (/(facebook|fb\.|instagram|twitter|t\.co|x\.com|linkedin|lnkd|youtube|tiktok|whatsapp|telegram|pinterest|reddit)\b/.test(h)) return 'social';
  return 'referral';
}
function classifyDevice(ua) {
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua || '') ? 'mobile' : 'desktop';
}

/* ── local-file store (dev fallback) ─────────────────────── */
function readLocal() {
  try { if (fs.existsSync(LOCAL_FILE)) return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch (e) {}
  return {};
}
function writeLocal(o) {
  try { fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true }); fs.writeFileSync(LOCAL_FILE, JSON.stringify(o)); } catch (e) {}
}
function ensure(o) {
  o.pv = o.pv || {}; o.uv = o.uv || {}; o.edits = o.edits || {};
  o.pages = o.pages || {}; o.src = o.src || {}; o.dev = o.dev || {};
  o.live = o.live || {}; o.pvAll = o.pvAll || 0; o.editsAll = o.editsAll || 0;
  return o;
}

function normId(visitorId) { return String(visitorId || '').slice(0, 64); }

/* ═══════════ HEARTBEAT — refresh "live" presence only ═══════════
   Fired periodically by the public site while a tab is open. It only updates
   the live set, so a visitor sitting on a page does NOT inflate page views. */
async function touchLive(visitorId) {
  const vid = normId(visitorId);
  if (!vid) return;
  const now = Date.now();
  const kv = getKv();
  if (kv) {
    try {
      await kv.zadd('st:live', { score: now, member: vid });
      await kv.zremrangebyscore('st:live', 0, now - LIVE_WINDOW_MS);
    } catch (e) {}
    return;
  }
  const o = ensure(readLocal());
  o.live[vid] = now;
  writeLocal(o);
}

/* ═══════════ LEAVE — drop a visitor from "live" immediately ═══════════
   Fired via sendBeacon when the tab is closed/hidden, so the count falls
   without waiting for the live window to expire. */
async function removeLive(visitorId) {
  const vid = normId(visitorId);
  if (!vid) return;
  const kv = getKv();
  if (kv) {
    try { await kv.zrem('st:live', vid); } catch (e) {}
    return;
  }
  const o = ensure(readLocal());
  delete o.live[vid];
  writeLocal(o);
}

/* ═══════════ RECORD A PAGEVIEW ═══════════ */
async function recordView({ visitorId, page, ref, ua, host }) {
  const day = dayKey();
  const vid = normId(visitorId) || 'anon-' + Math.random().toString(36).slice(2);
  const pg = String(page || '/').slice(0, 80);
  const src = classifySource(ref, host);
  const dev = classifyDevice(ua);
  const now = Date.now();
  const kv = getKv();

  if (kv) {
    try {
      await Promise.all([
        kv.incr('st:pv:' + day).then(() => kv.expire('st:pv:' + day, DAY_TTL_SEC)),
        kv.incr('st:pv:all'),
        kv.sadd('st:uv:' + day, vid).then(() => kv.expire('st:uv:' + day, DAY_TTL_SEC)),
        kv.hincrby('st:pages:' + day, pg, 1).then(() => kv.expire('st:pages:' + day, DAY_TTL_SEC)),
        kv.hincrby('st:src:' + day, src, 1).then(() => kv.expire('st:src:' + day, DAY_TTL_SEC)),
        kv.hincrby('st:dev:' + day, dev, 1).then(() => kv.expire('st:dev:' + day, DAY_TTL_SEC)),
        kv.zadd('st:live', { score: now, member: vid }),
        kv.zremrangebyscore('st:live', 0, now - LIVE_WINDOW_MS),
      ]);
    } catch (e) { /* swallow */ }
    return;
  }

  // local fallback
  const o = ensure(readLocal());
  o.pv[day] = (o.pv[day] || 0) + 1;
  o.pvAll += 1;
  o.uv[day] = o.uv[day] || [];
  if (o.uv[day].indexOf(vid) < 0) o.uv[day].push(vid);
  o.pages[day] = o.pages[day] || {}; o.pages[day][pg] = (o.pages[day][pg] || 0) + 1;
  o.src[day] = o.src[day] || {}; o.src[day][src] = (o.src[day][src] || 0) + 1;
  o.dev[day] = o.dev[day] || {}; o.dev[day][dev] = (o.dev[day][dev] || 0) + 1;
  o.live[vid] = now;
  writeLocal(o);
}

/* ═══════════ RECORD AN ADMIN EDIT / PUBLISH ═══════════ */
async function recordEdit() {
  const day = dayKey();
  const kv = getKv();
  if (kv) {
    try {
      await kv.incr('st:edits:' + day); await kv.expire('st:edits:' + day, DAY_TTL_SEC);
      await kv.incr('st:edits:all');
    } catch (e) {}
    return;
  }
  const o = ensure(readLocal());
  o.edits[day] = (o.edits[day] || 0) + 1; o.editsAll += 1;
  writeLocal(o);
}

/* ═══════════ READ AGGREGATED STATS (admin) ═══════════ */
async function getStats(days) {
  const n = Math.min(Math.max(parseInt(days, 10) || 14, 1), 90);
  const series = lastDays(n);
  const today = dayKey();
  const now = Date.now();
  const kv = getKv();

  if (kv) {
    try {
      const [pvAll, editsAll, editsToday] = await Promise.all([
        kv.get('st:pv:all'), kv.get('st:edits:all'), kv.get('st:edits:' + today),
      ]);
      const pvSeries = await Promise.all(series.map((d) => kv.get('st:pv:' + d)));
      const uvSeries = await Promise.all(series.map((d) => kv.scard('st:uv:' + d)));
      const editSeries = await Promise.all(series.map((d) => kv.get('st:edits:' + d)));
      const pages = (await kv.hgetall('st:pages:' + today)) || {};
      const src = (await kv.hgetall('st:src:' + today)) || {};
      const dev = (await kv.hgetall('st:dev:' + today)) || {};
      await kv.zremrangebyscore('st:live', 0, now - LIVE_WINDOW_MS);
      const live = await kv.zcount('st:live', now - LIVE_WINDOW_MS, now);
      return shape({
        series, pvSeries: pvSeries.map(num), uvSeries: uvSeries.map(num), editSeries: editSeries.map(num),
        pvAll: num(pvAll), editsAll: num(editsAll), editsToday: num(editsToday),
        pages: hashToObj(pages), src: hashToObj(src), dev: hashToObj(dev), live: num(live),
      });
    } catch (e) { return shape({ series, pvSeries: series.map(() => 0), uvSeries: series.map(() => 0), editSeries: series.map(() => 0) }); }
  }

  // local fallback
  const o = ensure(readLocal());
  let live = 0;
  Object.keys(o.live).forEach((vid) => { if (now - o.live[vid] <= LIVE_WINDOW_MS) live += 1; });
  return shape({
    series,
    pvSeries: series.map((d) => o.pv[d] || 0),
    uvSeries: series.map((d) => (o.uv[d] || []).length),
    editSeries: series.map((d) => o.edits[d] || 0),
    pvAll: o.pvAll, editsAll: o.editsAll, editsToday: o.edits[today] || 0,
    pages: o.pages[today] || {}, src: o.src[today] || {}, dev: o.dev[today] || {}, live,
  });
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function hashToObj(h) { const o = {}; Object.keys(h || {}).forEach((k) => { o[k] = num(h[k]); }); return o; }
function shape(s) {
  const today = s.series[s.series.length - 1];
  const pvToday = s.pvSeries[s.pvSeries.length - 1] || 0;
  const uvToday = s.uvSeries[s.uvSeries.length - 1] || 0;
  return {
    today, live: s.live || 0,
    pvToday, uvToday,
    pvAll: s.pvAll || 0,
    editsToday: s.editsToday || 0, editsAll: s.editsAll || 0,
    series: s.series, pvSeries: s.pvSeries, uvSeries: s.uvSeries, editSeries: s.editSeries,
    topPages: toSorted(s.pages), sources: s.src || {}, devices: s.dev || {},
    generatedAt: new Date().toISOString(),
  };
}
function toSorted(obj) {
  return Object.keys(obj || {}).map((k) => ({ name: k, count: obj[k] }))
    .sort((a, b) => b.count - a.count).slice(0, 12);
}

module.exports = { recordView, recordEdit, getStats, touchLive, removeLive, classifySource, classifyDevice };
