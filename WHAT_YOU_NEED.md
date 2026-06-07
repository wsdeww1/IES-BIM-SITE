# What You Need to Finish — IES Admin Control Panel

A simple checklist of the "equipment" (accounts, tools, and decisions) required
to take the admin panel from **built** to **fully live**. Tick each box as you go.

> The panel is already built and tested. Everything below is about *your*
> accounts and choices — things I can't set up for you.

---

## 1. 🧰 Tools to install (on your computer)

| # | Tool | Why you need it | How to get it | Done |
|---|------|-----------------|---------------|------|
| 1 | **Node.js 18 or newer** (includes `npm`) | Runs the setup scripts and the local test server | https://nodejs.org → download the **LTS** version | ☐ |
| 2 | **Git** | Push code to your repository | https://git-scm.com (you likely already have it) | ☐ |
| 3 | **Vercel CLI** *(optional)* | Deploy from the terminal | `npm i -g vercel` | ☐ |
| 4 | A modern **web browser** | Use the admin panel | Chrome / Edge / Firefox | ☐ |

> ✅ To check Node is installed, run: `node -v` (should print v18 or higher).

---

## 2. 🌐 Accounts to have

| # | Account | Why you need it | Cost | Done |
|---|---------|-----------------|------|------|
| 1 | **Vercel account** | Hosts the website + the admin backend | Free **Hobby** tier is enough | ☐ |
| 2 | **GitHub account** | Stores the code, auto-deploys to Vercel | Free | ☐ |
| 3 | **Redis store** (Vercel KV / Upstash) | Saves projects & page text | Free tier is enough | ☐ |
| 4 | **Blob store** (Vercel Blob) | Saves uploaded project photos | Free tier is enough | ☐ |

> Stores #3 and #4 are created **inside** the Vercel dashboard
> (Storage → Add) and linked to this project with one click each.

---

## 3. 🔑 Decisions & credentials to prepare (only you can set these)

| # | What to decide | Notes | Done |
|---|----------------|-------|------|
| 1 | **Admin email** | The single login email for the panel | ☐ |
| 2 | **Admin password** | Strong password (8+ characters). Never shared, never in code | ☐ |
| 3 | **Password hash** | Generate it with `npm run hash-password "your-password"` | ☐ |
| 4 | **JWT secret** | A long random string (the same command prints one for you) | ☐ |

These become three environment variables in Vercel:
`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET`.

> ⚠️ Never type the real password into the website, into chat, or into code.
> Only the **hash** is stored.

---

## 4. ✅ Final go-live checklist (the order to do it)

```
☐  1. Install Node.js, then run:  npm install
☐  2. Generate credentials:        npm run hash-password "your-strong-password"
☐  3. (Optional) Test locally:     npm run dev   →  open http://localhost:3001/admin
☐  4. In Vercel → Settings → Environment Variables, add:
        ADMIN_EMAIL, ADMIN_PASSWORD_HASH, JWT_SECRET
☐  5. In Vercel → Storage, create & link:
        • a Redis store (Vercel KV / Upstash)
        • a Blob store
☐  6. Deploy:  push to the main branch  (or run: vercel --prod)
☐  7. Open https://www.ies-bim.com/admin and sign in
☐  8. Add a project, click Save / Publish, confirm it shows on the public site
```

---

## 5. 📄 Where to read more

- **[ADMIN_README.md](ADMIN_README.md)** — full setup, security details, and how
  to use every feature of the panel.
- **[.env.example](.env.example)** — the template for your environment variables.

---

### TL;DR — the bare minimum to bring
1. **Node.js** installed on your computer.
2. A **Vercel account** (free) with a **Redis store** and a **Blob store** added.
3. An **admin email + password** you choose.

That's it. With those three things, you can finish and go live.
