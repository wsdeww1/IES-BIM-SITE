/*
 * GET  /api/content → public: returns the live site content (KV, or seed).
 * PUT  /api/content → admin only: validates and saves the content.
 */
const { send, readJson, requireAuth, getContent, setContent } = require('./_lib/util');

const DISCIPLINES = ['Architecture', 'Structural', 'MEP', 'BIM'];
const SECTION_KEYS = [
  'heroBadge', 'heroSub',
  'coreTag', 'coreH2', 'coreSub',
  'featTag', 'featH2', 'featSub',
  'projTag', 'projH2', 'projSub',
];

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
  SECTION_KEYS.forEach((k) => { out.sections[k] = s(sec[k], 1000); });

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
    return send(res, 200, { ok: true, updatedAt: saved.updatedAt });
  }

  return send(res, 405, { error: 'Method not allowed' });
};
