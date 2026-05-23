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
4. **UX Optimizations**: Added and later removed heavy blocking patterns (preloader/scroll-snapping) to improve accessibility and Core Web Vitals.
5. **CMS Upgrade**: Transitioned from a static contact workflow to a full Express.js backend with MySQL and a Vue.js Admin Control Panel.
6. **Performance Pass**: Improved LCP/CLS and Lighthouse best-practices (async non-critical CSS, image priority/layout sizing, safer console logging behavior).
7. **Security Hardening (Latest)**: Migrated admin auth from raw password headers to **Turnstile + HttpOnly cookie sessions**, restored login brute-force limiting, added admin-origin enforcement, and strengthened session lifecycle handling.
8. **Project Relocation**: Moved from `/mnt/hdd/dl/portofolio` (NTFS, no symlinks) to `/home/rapi/Project/portofolio` (native Linux ext4) for stable git/npm operations.


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
│   ├── _headers            # Cloudflare security headers/CSP
│   ├── sitemap.xml
│   └── robots.txt
│
├── backend/            # VPS — Express.js API
│   ├── server.js           # Main API server (port 3001)
│   ├── init_db.js          # DB table creation + seed data
│   ├── package.json
│   └── .env                # ⚠️ Gitignored — must be created manually on VPS
│
├── .agents/            # AI Agent Skills (local tooling context)
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
- **Admin Authentication**: Cloudflare Turnstile challenge + password verification + HttpOnly session cookie
- **Rate Limiting**: Login limiter (`5 / 10min`) and contact limiter (`3 / min`)
- **Nodemailer**: Sends contact form emails via SMTP
- **CORS + Admin Origin Guard**: Browser access constrained to approved origins

### Database
- **MySQL**: Self-hosted on VPS (`127.0.0.1:3306`), database `portfolio`
- **Tables**: `projects`, `experience`, `messages`
- **Translations**: Dedicated columns (`title_id`, `description_id`, `role_id`) for Indonesian content in same schema.


---

## Backend Environment Variables (`backend/.env`)

> ⚠️ This file is **gitignored**. Create it manually on the VPS.

```env
DATABASE_URL="mysql://portfolio:<password>@127.0.0.1:3306/portfolio"

SMTP_HOST="smail.omori.my.id"
SMTP_PORT="2525"
SMTP_USER="smtp@mail.arraffi.my.id"
SMTP_PASS="<your_smtp_password>"
SMTP_FROM="portfolio@mail.arraffi.my.id"

ADMIN_PASSWORD="<strong_password_here>"
TURNSTILE_SECRET="<cloudflare_turnstile_secret>"

NODE_ENV="production"
PORT=3001
```

---

## Security Measures Applied

| # | Area | Fix |
|---|---|---|
| 1 | Core Web Vitals | Removed blocking preloader behavior, prioritized hero/LCP image, fixed layout sizing to reduce CLS |
| 2 | Contact flow | Server-side validation + honeypot + rate limit (`3/min`) |
| 3 | Admin login bot defense | Added Cloudflare Turnstile verification on login |
| 4 | Admin brute-force | Added login rate limiter (`5 attempts / 10 minutes`) |
| 5 | Admin auth model | Replaced raw password-per-request with HttpOnly cookie session token |
| 6 | Session lifecycle | Added logout invalidation + periodic expired-session cleanup |
| 7 | Query safety | Uses parameterized SQL everywhere (no string-concat queries) |
| 8 | CORS / origin control | CORS scoped to allowed origins + explicit `/api/admin` origin guard in production |
| 9 | Header hardening | HSTS, XFO, XCTO, Referrer-Policy, Permissions-Policy, CSP via Cloudflare `_headers` |
| 10 | Error hygiene | Removed noisy thrown CORS errors from global handler path |
| 11 | Input constraints | Strict field-length and URL validation for CMS CRUD payloads |
| 12 | Repo hygiene | `**/.env`, `.env.backup`, and local agent context ignored from git tracking |


---

## API Endpoints

### Public
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects` | List all projects |
| `GET` | `/api/experience` | List all experience entries |
| `POST` | `/api/contact` | Submit contact form (sends email + saves to DB) |

### Admin (cookie-authenticated session)

**Login flow:**
1. `POST /api/admin/login` with `password` + `turnstile`
2. Backend verifies Turnstile and password
3. Backend sets `admin_session` HttpOnly cookie (`SameSite=Strict`, `Secure` in prod)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/login` | Verify Turnstile + password and issue cookie session |
| `POST` | `/api/admin/logout` | Revoke session and clear cookie |
| `GET/POST/PUT/DELETE` | `/api/admin/projects` and `/api/admin/projects/:id` | Full CRUD for projects |
| `GET/POST/PUT/DELETE` | `/api/admin/experience` and `/api/admin/experience/:id` | Full CRUD for experience |
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
4. Set DNS: `A api.arraffi.my.id → 31.56.192.16` (proxied off for direct TCP)

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
- [x] Security hardening (XSS, validation, headers, CORS)
- [x] Core Web Vitals optimization pass (preloader removal, LCP/CLS fixes)
- [x] Admin login protection with Turnstile + login rate limit
- [x] Migrated admin auth from plaintext header model to HttpOnly cookie session
- [x] Added admin-origin enforcement and session cleanup lifecycle
- [x] SEO meta tags (description, Open Graph, Twitter Card, canonical) on public pages
- [x] `admin.html` blocked from indexing (`X-Robots-Tag`, robots rules)
- [ ] Full CSP strict-mode refactor (remove remaining `unsafe-inline` / `unsafe-eval` where feasible)

