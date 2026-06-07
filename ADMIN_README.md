# IES Admin Control Panel

A private, password-protected control panel for the IES — Integrated Engineering
Systems portfolio site. It lets an administrator manage projects and page text
**without touching code**. The public site (`index.html`) keeps working exactly
as before; the admin area is fully separate under `/admin`.

---

## 1. What you can do

- **Projects** — add, edit and delete projects (title, category/subtitle,
  short + full description, client, location, scale, status, scope bullets,
  and photo uploads). Delete asks for confirmation.
- **Sections / Concepts** — edit the public page text: hero badge & subtitle,
  and the tag/heading/subtitle for *Our Core Services*, *Featured Projects*,
  and *Our Projects*.
- **Reorder** — drag-and-drop project cards into the order shown on the site.
- **Save / Publish** — publishes all changes; the public site reflects them
  immediately. **Discard changes** reloads the last published version.
- **Guided tour** — runs automatically on first login and is re-launchable
  any time from the **Help / Guide** button.

---

## 2. Architecture & chosen auth approach

The public site is a 100% static page on **Vercel**. To meet the security and
persistence requirements, the panel adds **Vercel Serverless Functions** plus
**Vercel KV** (data) and **Vercel Blob** (images):

| Concern | Implementation |
|---|---|
| Login | `POST /api/login` validates `ADMIN_EMAIL` + bcrypt-hashed password **server-side**. |
| Session | Signed **JWT in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie**. 12-hour absolute lifetime + 30-min inactivity auto-logout. |
| Data | `GET /api/content` (public read) / `PUT /api/content` (admin-only write) → **Vercel KV**, seeded from `data/seed.json`. |
| Images | `POST /api/upload` (admin-only) → **Vercel Blob**, filenames slugified + random suffix. |
| Hardening | Per-IP login rate limiting (8 tries / 15 min), generic "Invalid credentials" message, all write input sanitized/clamped server-side, `noindex` on `/admin`, no public link to the panel. |

**Why this approach:** it is the standard production pattern for a static Vercel
site. The password is never in client code, sessions are real signed tokens, and
content persists in managed storage the public site reads from.

**Trade-offs:** it requires enabling Vercel KV and Blob (free Hobby tier is
enough for this volume) and setting three env vars. The public site degrades
gracefully — if the API is ever down, `index.html` falls back to its built-in
default content, so the site never breaks.

---

## 3. One-time setup (what IES must configure)

### a. Install dependencies & generate the password hash
```bash
npm install
npm run hash-password "your-strong-admin-password"
```
This prints an `ADMIN_PASSWORD_HASH=...` and a `JWT_SECRET=...` line.

### b. Set environment variables
Copy `.env.example` → `.env` for local dev, and set the **same** values in
**Vercel → Project → Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `ADMIN_EMAIL` | the admin login email |
| `ADMIN_PASSWORD_HASH` | the bcrypt hash from step (a) |
| `JWT_SECRET` | the random secret from step (a) — keep it stable |

> The real `.env` is git-ignored and must never be committed.

### c. Create the storage (for production)
In the Vercel dashboard → **Storage**:
1. **Add a Redis store** (Vercel KV is now provided by the **Upstash for Redis**
   integration in the Vercel Marketplace) → connect it to this project. It
   injects the same `KV_REST_API_URL` and `KV_REST_API_TOKEN` variables this
   code uses, so no code change is needed.
2. **Create a Blob store** → connect it to this project (injects
   `BLOB_READ_WRITE_TOKEN`).

Vercel injects these three automatically — do **not** set them by hand.

> If neither store is configured, the code falls back to **local-file mode**
> (great for development, not for production — Vercel's filesystem is read-only
> at runtime). For a live site, always connect the Redis + Blob stores.

### d. Deploy
```bash
vercel --prod      # or push to the connected Git branch
```

---

## 4. Try it locally first — no cloud accounts needed

You can run the **entire** panel on your own machine before touching Vercel,
KV or Blob. In this local mode, content saves to `data/content.local.json` and
images to `assets/uploads/` (both git-ignored); the same code automatically
uses KV + Blob once deployed.

```bash
npm install
npm run hash-password "your-local-password"   # paste output + ADMIN_EMAIL into .env
npm run dev                                    # zero-dependency dev server
```
Then open:
- Public site → `http://localhost:3001/`
- Admin panel → `http://localhost:3001/admin`

`npm run dev` serves the static site **and** runs the `/api` functions using
only Node's built-ins (no Vercel CLI required). It auto-loads variables from
`.env`. To reset local content, delete `data/content.local.json`.

> Prefer the real Vercel runtime locally? `vercel dev` also works once you have
> the Vercel CLI and have linked the project.

---

## 5. Using the panel

1. Go to **`https://www.ies-bim.com/admin`** and sign in with the configured
   email + password.
2. **Projects** → *+ Add Project*, fill the fields, upload photos → the editor
   saves into your working copy.
3. **Sections / Concepts** → edit any page text.
4. **Reorder** → drag cards by the `⠿` handle.
5. Click **Save / Publish** — changes go live. Use **Logout** when done.

The amber "Unsaved changes" badge reminds you to publish. **Discard changes**
throws away unsaved edits.

---

## 6. Notes & security reminders

- There is **no public sign-up** and no link to `/admin` from the site.
- To change the admin password, re-run `npm run hash-password` and update
  `ADMIN_PASSWORD_HASH` in Vercel.
- Rotating `JWT_SECRET` immediately logs the admin out everywhere.
- To rename the admin route, rename the `/admin` folder (and update the link in
  this doc); the panel itself needs no other change.
- `data/seed.json` is only the *initial* content used to seed KV / as the
  public fallback. Once you publish from the panel, KV is the source of truth.
