#!/usr/bin/env node
/*
 * IES local dev server — runs the static site AND the /api serverless
 * functions on your own machine, with NO Vercel CLI and NO cloud accounts.
 *
 *   npm install
 *   npm run hash-password "your-password"   # paste output + ADMIN_EMAIL into .env
 *   npm run dev                             # → http://localhost:3001  (admin: /admin)
 *
 * In this mode content is saved to data/content.local.json and images to
 * assets/uploads/ (both git-ignored). In production on Vercel, the same code
 * automatically uses Vercel KV + Blob instead.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3001;
const API_ROUTES = ['login', 'logout', 'me', 'content', 'upload', 'track', 'stats'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// Tiny .env loader (no dependency) so login works locally.
(function loadEnv() {
  try {
    const p = path.join(ROOT, '.env');
    if (!fs.existsSync(p)) return;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* ignore */ }
})();

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(url.parse(req.url).pathname);

  // ── API routing → invoke the same handlers Vercel uses ──
  if (pathname.indexOf('/api/') === 0) {
    const name = pathname.slice(5).replace(/\/+$/, '');
    if (API_ROUTES.indexOf(name) > -1) {
      try {
        const handler = require(path.join(ROOT, 'api', name + '.js'));
        return Promise.resolve(handler(req, res)).catch((e) => {
          if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e) })); }
        });
      } catch (e) {
        res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'Handler error: ' + e.message }));
      }
    }
    res.statusCode = 404; res.setHeader('Content-Type', 'application/json');
    return res.end('{"error":"Not found"}');
  }

  // ── Static files ──
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin/index.html';

  const file = path.normalize(path.join(ROOT, pathname));
  if (file.indexOf(ROOT) !== 0) { res.statusCode = 403; return res.end('Forbidden'); }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  const configured = process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH && process.env.JWT_SECRET;
  console.log('\n  IES dev server running:');
  console.log('    Public site → http://localhost:' + PORT + '/');
  console.log('    Admin panel → http://localhost:' + PORT + '/admin');
  console.log('    Storage mode: local files (data/content.local.json, assets/uploads/)');
  if (!configured) {
    console.log('\n  ⚠  Admin login is NOT configured yet. Create a .env with ADMIN_EMAIL,');
    console.log('     ADMIN_PASSWORD_HASH and JWT_SECRET (run: npm run hash-password "pass").');
  }
  console.log('');
});
