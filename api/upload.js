/*
 * POST /api/upload  (admin only)
 * Body: raw image bytes. Header "x-filename": original file name.
 * Stores the image in Vercel Blob under /projects and returns its public URL.
 */
const fs = require('fs');
const path = require('path');
const { send, requireAuth } = require('./_lib/util');

// Use Vercel Blob in production; fall back to a local folder when its token
// is absent (local test mode). Lazily required so local mode needs no package.
function blobEnabled() { return !!process.env.BLOB_READ_WRITE_TOKEN; }
function getPut() { try { return require('@vercel/blob').put; } catch (e) { return null; } }

// Vercel parses JSON bodies automatically; for binary uploads we read the
// raw stream ourselves, so disable the built-in body parser.
const config = { api: { bodyParser: false } };

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB
const ALLOWED = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif',
};

function slugifyName(name, ext) {
  const base = String(name || 'image').replace(/\.[^.]+$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  return base + '.' + ext;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  const ext = ALLOWED[type];
  if (!ext) return send(res, 415, { error: 'Unsupported image type. Use JPG, PNG, WEBP, GIF, SVG or AVIF.' });

  // Vercel may pre-buffer the body (Buffer) for some content types; otherwise
  // read the raw request stream ourselves.
  let buf;
  if (Buffer.isBuffer(req.body)) {
    buf = req.body;
  } else {
    const chunks = [];
    let size = 0;
    try {
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BYTES) return send(res, 413, { error: 'Image too large (max 6 MB).' });
        chunks.push(c);
      }
    } catch (e) {
      return send(res, 400, { error: 'Upload failed while reading the file.' });
    }
    buf = Buffer.concat(chunks);
  }
  if (!buf || !buf.length) return send(res, 400, { error: 'No file received.' });
  if (buf.length > MAX_BYTES) return send(res, 413, { error: 'Image too large (max 6 MB).' });

  const filename = slugifyName(req.headers['x-filename'], ext);

  if (blobEnabled()) {
    const put = getPut();
    if (!put) return send(res, 500, { error: 'Image storage package is missing. Run "npm install".' });
    try {
      const blob = await put('projects/' + filename, buf, {
        access: 'public',
        contentType: type,
        addRandomSuffix: true, // avoids collisions, keeps names safe
      });
      return send(res, 200, { ok: true, url: blob.url });
    } catch (e) {
      return send(res, 500, { error: 'Could not store the image. Is Vercel Blob configured?' });
    }
  }

  // Local test mode: write under /assets/uploads (git-ignored) and serve it.
  try {
    const dir = path.join(process.cwd(), 'assets', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const unique = Date.now().toString(36) + '-' + filename;
    fs.writeFileSync(path.join(dir, unique), buf);
    return send(res, 200, { ok: true, url: '/assets/uploads/' + unique });
  } catch (e) {
    return send(res, 500, { error: 'Could not store the image locally.' });
  }
};

module.exports.config = config;
