/*
 * Shared helpers for the IES admin API (Vercel Serverless Functions).
 * Files/folders starting with "_" are NOT exposed as routes by Vercel,
 * so this module is private to the other /api functions.
 */
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const seed = require('../../data/seed.json');

const COOKIE_NAME = 'ies_admin';
const SESSION_HOURS = 12;              // absolute session lifetime
const CONTENT_KEY = 'content';         // KV key holding the live site content
const RL_MAX = 8;                      // max failed logins per window
const RL_WINDOW_SEC = 900;             // 15 minutes

// Local fallback (used automatically when Vercel KV is not configured, e.g.
// running on your own machine before provisioning cloud storage).
const LOCAL_CONTENT_FILE = path.join(process.cwd(), 'data', 'content.local.json');
const memRate = new Map();             // in-memory rate limit for local mode

// Lazily load @vercel/kv only when its env vars are present, so local mode
// works even if the package isn't installed.
let _kv;
function getKv() {
  if (_kv !== undefined) return _kv;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) { _kv = null; return _kv; }
  try { _kv = require('@vercel/kv').kv; } catch (e) { _kv = null; }
  return _kv;
}

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

/* ── JSON responses ───────────────────────────────────────── */
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

/* ── Body parsing (handles parsed body or raw stream) ─────── */
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (e) { return {}; }
}

/* ── Cookies / sessions ──────────────────────────────────── */
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token) {
  const maxAge = SESSION_HOURS * 3600;
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

function signSession(email) {
  return jwt.sign({ sub: email, role: 'admin' }, env('JWT_SECRET'),
    { expiresIn: SESSION_HOURS + 'h' });
}

/* Returns the session payload if valid, otherwise null. */
function getSession(req) {
  const secret = env('JWT_SECRET');
  if (!secret) return null;
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  try { return jwt.verify(token, secret); }
  catch (e) { return null; }
}

/* Guard: writes a 401 and returns false when not authenticated. */
function requireAuth(req, res) {
  const s = getSession(req);
  if (!s || s.role !== 'admin') {
    send(res, 401, { error: 'Not authenticated' });
    return null;
  }
  return s;
}

/* ── Login rate limiting (per IP, backed by KV) ──────────── */
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress || 'unknown';
}

async function isRateLimited(ip) {
  const kv = getKv();
  if (kv) {
    try {
      const n = await kv.get('rl:login:' + ip);
      return typeof n === 'number' && n >= RL_MAX;
    } catch (e) { return false; }   // never lock out if KV is unavailable
  }
  const r = memRate.get(ip);
  if (!r) return false;
  if (Date.now() > r.exp) { memRate.delete(ip); return false; }
  return r.count >= RL_MAX;
}

async function recordFailedLogin(ip) {
  const kv = getKv();
  if (kv) {
    try {
      const key = 'rl:login:' + ip;
      const n = await kv.incr(key);
      if (n === 1) await kv.expire(key, RL_WINDOW_SEC);
    } catch (e) { /* best-effort */ }
    return;
  }
  const r = memRate.get(ip);
  if (!r || Date.now() > r.exp) memRate.set(ip, { count: 1, exp: Date.now() + RL_WINDOW_SEC * 1000 });
  else r.count++;
}

async function clearFailedLogins(ip) {
  const kv = getKv();
  if (kv) { try { await kv.del('rl:login:' + ip); } catch (e) { /* best-effort */ } return; }
  memRate.delete(ip);
}

/* ── Content store (KV in production, local file otherwise) ─ */
async function getContent() {
  const kv = getKv();
  if (kv) {
    try {
      const c = await kv.get(CONTENT_KEY);
      if (c && c.projects) return c;
    } catch (e) { /* fall through to seed */ }
    return seed;
  }
  // Local mode: read the git-ignored local file, else the seed.
  try {
    if (fs.existsSync(LOCAL_CONTENT_FILE)) {
      const c = JSON.parse(fs.readFileSync(LOCAL_CONTENT_FILE, 'utf8'));
      if (c && c.projects) return c;
    }
  } catch (e) { /* fall through to seed */ }
  return seed;
}

async function setContent(content) {
  content.updatedAt = new Date().toISOString();
  const kv = getKv();
  if (kv) { await kv.set(CONTENT_KEY, content); return content; }
  // Local mode: persist to a git-ignored file next to the seed.
  fs.mkdirSync(path.dirname(LOCAL_CONTENT_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_CONTENT_FILE, JSON.stringify(content, null, 2));
  return content;
}

/* Which storage backend is active (handy for diagnostics). */
function storageMode() { return getKv() ? 'kv' : 'local-file'; }

module.exports = {
  send, readJson, parseCookies, setSessionCookie, clearSessionCookie,
  signSession, getSession, requireAuth, clientIp,
  isRateLimited, recordFailedLogin, clearFailedLogins,
  getContent, setContent, storageMode, env, seed,
};
