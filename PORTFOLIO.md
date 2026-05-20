# Portfolio Website Project — Full Documentation

## Project Overview

A bespoke, full-stack professional portfolio for **Arraffi** (Junior Backend Developer). It evolved from a static Cloudflare-hosted site into a dynamic, CMS-powered application with a split frontend/backend architecture.

**Live Frontend:** `https://arraffi.my.id`  
**API Backend:** `https://api.arraffi.my.id` (VPS: `31.56.192.16`)  
**Admin Panel:** `https://arraffi.my.id/admin.html`

---

## Evolution & History

1. **Initial State**: Began as a terminal/hacker-themed gimmick layout.
2. **Iteration Phase**: Went through several designs — SaaS-style, Floating Pill, Hybrid Angga/Anjar, and Stacking Cards.
3. **Clean Standard Frontend**: Settled on a professional dark theme with glassmorphism (`backdrop-filter: blur`), hover micro-interactions, and gradient typography.
4. **UX Optimizations**: Added a custom preloader, full-screen `scroll-snap-type` presentation mode, keyboard navigation (Arrow keys / Spacebar), and lazy-loaded assets.
5. **CMS Upgrade (Completed)**: Transitioned from a static Cloudflare Workers contact form to a full Express.js backend connecting to a custom MySQL database, with a Vue.js Admin Control Panel.
6. **Security Hardening**: Full security audit conducted — XSS prevention, rate limiting, input validation, CORS lockdown, security headers, and gitignore fixes applied.
7. **Project Relocation**: Moved from `/mnt/hdd/dl/portofolio` (NTFS, no symlinks) to `/home/rapi/Project/portofolio` (native Linux ext4) for proper git and npm support.

---

## Directory Structure

```text
portofolio/
├── frontend/           # Cloudflare Pages — public site, admin panel, static assets
│   ├── index.html          # EN homepage (dynamic, fetches from API)
│   ├── id/
│   │   └── index.html      # ID homepage (Indonesian translation)
│   ├── admin.html          # Vue.js CMS admin panel
│   ├── style.css           # Global stylesheet
│   ├── _headers            # Cloudflare security headers
│   ├── worker.js           # Cloudflare Worker entrypoint
│   ├── wrangler.toml       # Cloudflare Pages config
│   ├── functions/
│   │   └── api/
│   │       └── contact.js  # Legacy CF Worker contact handler (SMTP2GO)
│   ├── sitemap.xml
│   └── robots.txt
│
├── backend/            # VPS — Express.js API
│   ├── server.js           # Main API server (port 3001)
│   ├── init_db.js          # DB table creation + seed data
│   ├── package.json
│   └── .env                # ⚠️ Gitignored — must be created manually on VPS
│
├── .agent/             # AI Agent Skills (gitignored — never pushed)
│   ├── TEMPLATE.md         # Blank skill template
│   └── deploy_example.md   # Example deploy skill
│
├── test_admin.py       # Playwright UI test for admin panel
├── PORTFOLIO.md        # This file
├── README.md
└── .gitignore
```

---

## Technology Stack

### Frontend (Public Site)
- **HTML5 / CSS3**: Custom hand-coded layout, responsive grid, flexbox
- **Vanilla JavaScript**: IntersectionObserver scroll animations, keyboard navigation, dynamic API fetching
- **Cloudflare Pages**: Hosting, global edge CDN, automatic HTTPS
- **Cloudflare Turnstile**: Bot protection on the contact form

### Frontend (Admin Panel)
- **Vue 3 (CDN)**: Fully reactive CMS dashboard — no build step required
- **Endpoints used**: `/api/admin/projects`, `/api/admin/experience`, `/api/admin/messages`

### Backend (API)
- **Express.js (Node.js)**: REST API on port `3001`
- **express-rate-limit**: Brute-force protection on the login endpoint
- **Nodemailer**: Sends contact form emails via `smail.omori.my.id:587`
- **CORS**: Locked to `arraffi.my.id` and `31.56.192.16` only

### Database
- **MySQL**: Self-hosted at `31.56.192.16:3306`, database `portfolio`
- **Tables**: `projects`, `experience`, `messages`

---

## Backend Environment Variables (`backend/.env`)

> ⚠️ This file is **gitignored**. Create it manually on the VPS.

```env
DATABASE_URL="mysql://portfolio:<password>@31.56.192.16:3306/portfolio"

SMTP_HOST="smail.omori.my.id"
SMTP_PORT="587"
SMTP_USER="smtp@mail.arraffi.my.id"
SMTP_PASS="<your_smtp_password>"
SMTP_FROM="portfolio@mail.arraffi.my.id"

ADMIN_PASSWORD="<strong_password_here>"

PORT=3001
```

---

## Security Measures Applied

| # | Area | Fix |
|---|---|---|
| 1 | Frontend fetch URLs | Replaced all `localhost:3000` with `https://api.arraffi.my.id` |
| 2 | API key leak | Removed real SMTP2GO key from `frontend/.env` |
| 3 | Contact form | Added server-side validation (required fields, email format, 2000 char limit) |
| 4 | Admin login | Rate limited to 10 attempts / 15 minutes via `express-rate-limit` |
| 5 | XSS | Added `escHtml()` to all `innerHTML` renders in both HTML files |
| 6 | HTTP headers | Added `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` to `_headers` |
| 7 | Gitignore typo | Fixed `.agents/` → `.agent/` so the folder is actually ignored |
| 8 | DB schema | Added missing `url` column to `experience` table in `init_db.js` |
| 9 | CORS | Locked to `arraffi.my.id`, `31.56.192.16`, and `localhost` only |
| 10 | Writing quality | Applied Humanizer skill to hero bio (both EN and ID) |

---

## API Endpoints

### Public
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects` | List all projects |
| `GET` | `/api/experience` | List all experience entries |
| `POST` | `/api/contact` | Submit contact form (sends email + saves to DB) |

### Admin (requires `Authorization: <ADMIN_PASSWORD>` header)
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/login` | Verify admin password |
| `GET/POST/PUT/DELETE` | `/api/admin/projects/:id` | Full CRUD for projects |
| `GET/POST/PUT/DELETE` | `/api/admin/experience/:id` | Full CRUD for experience |
| `GET` | `/api/admin/messages` | Read all contact messages |

---

## Deployment Architecture

```
Visitor
  │
  ▼
Cloudflare (arraffi.my.id)         ← frontend/ folder pushed to Cloudflare Pages
  │  Static: HTML, CSS, JS
  │  Edge: Turnstile, _headers security rules
  │
  └─── fetch() API calls ──────► Nginx (31.56.192.16)
                                     │  SSL via Certbot
                                     │  Reverse proxy → localhost:3001
                                     ▼
                                 Express API (backend/server.js)
                                     │
                                     ▼
                                 MySQL Database (portfolio)
```

---

## VPS Setup Guide (Ubuntu)

```bash
# 1. Clone the repo
git clone https://github.com/<your-repo>/portofolio.git ~/portofolio
cd ~/portofolio/backend

# 2. Install dependencies
npm install

# 3. Create the .env file (copy the template from above, use real credentials)
nano .env

# 4. Initialize the database (creates tables + seeds default data)
node init_db.js

# 5. Start with PM2
npm install -g pm2
pm2 start server.js --name portfolio-api
pm2 save
pm2 startup

# 6. Configure Nginx
sudo nano /etc/nginx/sites-available/portfolio-api
```

```nginx
server {
    server_name api.arraffi.my.id;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl; # Certbot will add this
}
```

```bash
# 7. Enable the site and get SSL
sudo ln -s /etc/nginx/sites-available/portfolio-api /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.arraffi.my.id
sudo nginx -t && sudo systemctl reload nginx
```

---

## Cloudflare Pages Setup

1. Connect GitHub repo to Cloudflare Pages
2. Set **Root directory** to `frontend/`
3. No build command needed (pure static)
4. The `worker.js` + `wrangler.toml` handle routing
5. Set DNS: `A api.arraffi.my.id → 31.56.192.16` (proxied off for direct TCP)

---

## Local Development

```bash
# Backend
cd backend
node server.js          # Runs on http://localhost:3001

# Frontend (open directly in browser or use any static server)
# All fetch() calls point to https://api.arraffi.my.id
# For local testing, temporarily change API_BASE in index.html to http://localhost:3001
```

---

## AI Agent Skills (`.agent/` folder)

The `.agent/` directory contains markdown instruction files for AI assistants working on this project. It is **gitignored** and never pushed to GitHub.

- `.agent/TEMPLATE.md` — blank template for writing new skills
- `.agent/deploy_example.md` — example deployment skill

---

## Special Technical Notes

- **NTFS Drive Issue**: The project was originally on `/mnt/hdd/dl/` (NTFS), which blocked Linux symlinks. All npm installs required `--no-bin-links` and git commands failed. Moved to `/home/rapi/Project/portofolio` on the native ext4 filesystem.
- **Port Conflict**: Port `3000` was already occupied by another Node process on the VPS (`/root/api/`). Backend runs on port `3001` instead, configurable via `PORT` env variable.
- **Vue CDN (no build step)**: Admin panel uses Vue 3 via CDN instead of a local install, avoiding symlink and build-tool issues on the NTFS drive during development.

---

## Roadmap

- [x] Clean, professional frontend design with dark theme + glassmorphism
- [x] Indonesian language version (`/id/`)
- [x] Cloudflare Turnstile on contact form
- [x] Express.js backend API
- [x] MySQL database with projects, experience, messages tables
- [x] Vue.js Admin Control Panel (full CRUD)
- [x] Dynamic frontend — fetches all content from API on load
- [x] Security hardening (XSS, rate limit, CORS, headers, input validation)
- [x] Split frontend (Cloudflare) / backend (VPS) deployment architecture
- [x] SEO meta tags (description, Open Graph, Twitter Card, canonical) on all pages
- [x] `admin.html` blocked from search engines (noindex + robots.txt Disallow)
- [x] Full security audit: timing-safe auth, ID validation, try/catch on all routes, no error leakage
- [x] Rate limiting on contact form (3 req/min via express-rate-limit)
- [x] `express.json({ limit: '20kb' })` — large payload DoS protection
- [x] `app.disable('x-powered-by')` — framework fingerprint removed
- [x] `trust proxy` set — rate limiting works correctly behind Nginx
- [x] `**/.env` gitignore fix — all subdirectory .env files protected
- [x] `.agents/` gitignore fix — AI context never pushed to public repo
- [x] `backend/.env.example` template created for VPS setup
- [x] `inject_dynamic.py` neutralized — cannot accidentally corrupt production URLs
- [ ] **Edit `backend/.env` on VPS: change `ADMIN_PASSWORD` + `31.56.192.16` → `127.0.0.1` in `DATABASE_URL`**
- [ ] SCP `backend/` to VPS, run `npm install` then `node init_db.js`
- [ ] Push frontend to Cloudflare Pages via GitHub
