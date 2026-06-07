/*
 * GET  /api/content → public: returns the live site content (KV, or seed).
 * PUT  /api/content → admin only: validates and saves the content.
 */
const { send, readJson, requireAuth, getContent, setContent } = require('./_lib/util');
const { recordEdit } = require('./_lib/stats');

const DISCIPLINES = ['Architecture', 'Structural', 'MEP', 'BIM'];

/*
 * Section content is an open-ended map of key → text. The admin panel exposes
 * ~120 fields today (hero, services, BIM cards, about, team, contact, SEO …)
 * and that list grows over time, so instead of a brittle hard-coded whitelist
 * we accept ANY key that looks like a safe identifier and clamp its value.
 * This keeps defense-in-depth (key-name validation blocks prototype-pollution
 * and junk; values are length-clamped; the public site renders them with
 * textContent, so they can't inject HTML) without the backend needing an edit
 * every time the admin adds a field.
 */
const SECTION_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/; // letter-led identifier, ≤60 chars
const MAX_SECTION_KEYS = 600;   // generous cap; current panel uses ~120
const MAX_SECTION_LEN = 8000;   // per-field character clamp (covers long paragraphs)

function s(v, max) {
  return String(v == null ? '' : v).slice(0, max || 2000);
}
function slugify(str) {
  return s(str, 80).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

/* Whitelist + clamp every field the admin can submit (defense in depth). */
function sanitize(input) {
  const out = { projects: [], sections: {} };
  const seen = {};

  (Array.isArray(input.projects) ? input.projects : []).forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const discipline = DISCIPLINES.indexOf(p.discipline) > -1 ? p.discipline : 'Architecture';
    let id = slugify(p.id || p.title || 'project-' + i);
    while (seen[id]) id += '-' + i;          // guarantee unique ids
    seen[id] = true;
    out.projects.push({
      id,
      title: s(p.title, 160),
      badge: s(p.badge, 40) || discipline,
      discipline,
      desc: s(p.desc, 400),
      fullDesc: s(p.fullDesc, 4000),
      client: s(p.client, 160),
      location: s(p.location, 160),
      area: s(p.area, 80),
      status: s(p.status, 40),
      scope: (Array.isArray(p.scope) ? p.scope : [])
        .map((x) => s(x, 300)).filter(Boolean).slice(0, 30),
      images: (Array.isArray(p.images) ? p.images : [])
        .map((u) => s(u, 600)).filter(Boolean).slice(0, 12),
      order: Number.isFinite(p.order) ? p.order : i,
    });
  });

  // Normalise order to the submitted sequence (drag-and-drop result).
  out.projects.forEach((p, i) => { p.order = i; });

  const sec = (input.sections && typeof input.sections === 'object') ? input.sections : {};
  let kept = 0;
  Object.keys(sec).forEach((k) => {
    if (kept >= MAX_SECTION_KEYS) return;
    if (!SECTION_KEY_RE.test(k)) return;            // reject unsafe / junk keys
    out.sections[k] = s(sec[k], MAX_SECTION_LEN);   // clamp value length
    kept += 1;
  });

  return out;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, await getContent());
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    const body = await readJson(req);
    const clean = sanitize(body);
    if (!clean.projects.length && !Object.values(clean.sections).some(Boolean)) {
      return send(res, 400, { error: 'Nothing to save.' });
    }
    const saved = await setContent(clean);
    try { await recordEdit(); } catch (e) { /* analytics is best-effort */ }
    return send(res, 200, { ok: true, updatedAt: saved.updatedAt });
  }

  return send(res, 405, { error: 'Method not allowed' });
};
