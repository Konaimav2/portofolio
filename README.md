# Arraffi (Konaima) | Personal Portfolio

Hey, I'm Arraffi — known online as **Konaima** or **konasgor**. I'm a Junior Backend Developer based in Central Java, Indonesia. I work with **Node.js, Python, and C++**, building robust backend systems.

## 🌐 Live
**https://arraffi.com**

## 🛠️ Stack Architecture
This portfolio is a fully dynamic, custom-built application utilizing a modern decoupled stack:

### Frontend (Cloudflare Pages)
* **HTML5/CSS3** — Custom glassmorphism, responsive grid, linear dark theme (Midnight/Ember palette).
* **Vanilla JS** — Dynamic API fetching, smooth navigation, intersection observers. No heavy frontend frameworks.
* **Vue 3 (Admin)** — The secure admin panel (`/admin.html`) is powered by Vue 3 via CDN for seamless reactivity.
* **Security** — Cloudflare Turnstile bot protection, strict Content Security Policy (CSP), and HTTP security headers.

### Backend (VPS)
* **Node.js + Express.js** — Secure REST API handling projects, experience, and contact messages.
* **MySQL** — Relational database storing all CMS content and admin session data.
* **Security** — HttpOnly secure cookie sessions, Turnstile server-side validation, rate limiting (brute-force prevention), and parameterized SQL to prevent injections.
* **Nodemailer** — Automatically forwards contact form submissions to my private email via SMTP.

## ✨ Features
* Sleek, ultra-modern linear UI design optimized for Core Web Vitals.
* Fully dynamic content — all projects and experience entries are pulled from the database.
* Integrated CMS (Admin Control Panel) to add, edit, or delete portfolio entries.
* Inbox system inside the admin panel to read and manage contact messages.
* Bilingual (English & Indonesian `arraffi.com/id/`).

## ☁️ Deployment
* **Frontend:** Pushed directly from GitHub to **Cloudflare Pages**.
* **Backend:** Runs on a dedicated **Ubuntu VPS** via PM2, proxied behind Nginx.

## 📫 Find me
* **Email:** [kona@konaima.my.id](mailto:kona@konaima.my.id)
* **Discord:** [@konasgor](https://discordapp.com/users/406852668028616721)
* **X (Twitter):** [@arraffianakbaik](https://x.com/arraffianakbaik)
* **Instagram:** [@konasgor](https://instagram.com/konasgor)

---
*&copy; 2026 Arraffi (Konaima). All rights reserved.*
