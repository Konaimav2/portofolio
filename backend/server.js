require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const app = express();

// ── Trust proxy for correct IP behind Nginx ────────────────────────────────
app.set('trust proxy', 1);

// ── CORS: locked to production domain only ────────────────────────────────
const allowedOrigins = [
    'https://arraffi.com',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
];
app.use(cors({
    origin: (origin, callback) => {
        // Allow no-Origin requests (curl/monitoring). Browser security still enforced
        // by admin-specific origin middleware below.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));

app.use(express.json({ limit: '20kb' }));   // Prevent large payload DoS

// ── Serve static frontend files (for local dev only) ──────────────────────
// NOTE: On VPS, Nginx serves the frontend directly. This is kept for local use.
// The frontend dir does NOT contain sensitive files (backend/.env is separate).
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Remove fingerprinting headers ─────────────────────────────────────────
app.disable('x-powered-by');

// ── Database Pool ──────────────────────────────────────────────────────────
const pool = mysql.createPool(process.env.DATABASE_URL);

// ── SMTP Transporter ──────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: process.env.SMTP_PORT === '465',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    // tls.rejectUnauthorized should be true in production.
    // Set to false ONLY if your SMTP server uses a self-signed cert.
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
});

// ── Timing-safe password comparison (prevents timing attacks + length oracle) ─
function timingSafeEqual(a, b) {
    // Pad both inputs to a fixed 256-byte buffer to prevent length oracle:
    // Without this, an attacker could determine the password length by
    // measuring response time differences for the early-return branch.
    const MAX = 256;
    const bufA = Buffer.alloc(MAX);
    const bufB = Buffer.alloc(MAX);
    Buffer.from(String(a)).copy(bufA);
    Buffer.from(String(b)).copy(bufB);
    // crypto.timingSafeEqual runs in constant time regardless of content.
    // The extra length check prevents prefix matches on truncated passwords.
    return crypto.timingSafeEqual(bufA, bufB) && String(a).length === String(b).length;
}

// ── Session token store (in-memory, TTL 8 hours) ───────────────────────────
// Tokens are 32 random bytes (hex), invalidated on logout or after TTL.
// This avoids sending the raw password on every request after login.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const activeSessions = new Map(); // token → expiry timestamp

function createSessionToken() {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
}

function validateSessionToken(token) {
    if (!token || typeof token !== 'string') return false;
    const expiry = activeSessions.get(token);
    if (!expiry) return false;
    if (Date.now() > expiry) {
        activeSessions.delete(token);
        return false;
    }
    return true;
}

function revokeSessionToken(token) {
    activeSessions.delete(token);
}

// Periodic cleanup to prevent unbounded memory growth from expired tokens.
setInterval(() => {
    const now = Date.now();
    for (const [token, expiry] of activeSessions.entries()) {
        if (now > expiry) activeSessions.delete(token);
    }
}, 60 * 60 * 1000).unref(); // every 1h

const ADMIN_SESSION_COOKIE = 'admin_session';
function extractAdminSessionToken(req) {
    const raw = req.headers.cookie || '';
    const cookie = raw
        .split(';')
        .map(v => v.trim())
        .find(v => v.startsWith(`${ADMIN_SESSION_COOKIE}=`));
    if (!cookie) return '';
    return decodeURIComponent(cookie.slice(ADMIN_SESSION_COOKIE.length + 1));
}

// ── Validate numeric :id param ────────────────────────────────────────────
function parseId(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== raw) return null;
    return n;
}

// ── Validate URL (allow only http/https, block javascript: data: etc.) ────
function isValidUrl(str) {
    if (!str || str.trim() === '') return true; // optional — null is fine
    try {
        const u = new URL(str.trim());
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
}

// ── Sanitize string for email header use (prevent header injection) ────────
function sanitizeHeader(str) {
    return String(str ?? '').replace(/[\r\n"\\]/g, '');
}

// ── Rate limiter: contact form ────────────────────────────────────────────
const contactLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { ok: false, error: 'Too many requests. Please wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── Cloudflare Turnstile verification ─────────────────────────────────────
// Used on the admin login form. Requires TURNSTILE_SECRET in backend/.env
async function verifyTurnstile(token, remoteip) {
    if (!token || typeof token !== 'string' || !process.env.TURNSTILE_SECRET) return false;
    try {
        const params = new URLSearchParams({
            secret: process.env.TURNSTILE_SECRET,
            response: token,
            remoteip: String(remoteip || ''),
        });
        const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        const data = await r.json();
        return data.success === true;
    } catch {
        return false;
    }
}

// ── Rate limiter: admin login endpoint ─────────────────────────────────────
const loginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts. Please wait 10 minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── Admin auth middleware (validates HttpOnly cookie session) ─────────────
const authMiddleware = (req, res, next) => {
    const token = extractAdminSessionToken(req);
    if (!validateSessionToken(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

/* ── PUBLIC ENDPOINTS ───────────────────────────────────────────────────── */

app.get('/api/projects', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, title, title_id, description, description_id, url, image_url, full_width FROM projects ORDER BY id ASC');
        res.json(rows);
    } catch {
        res.status(500).json({ error: 'Failed to load projects.' });
    }
});

app.get('/api/experience', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, company, role, role_id, date_range, description, description_id, logo_url, url FROM experience ORDER BY id ASC');
        res.json(rows);
    } catch {
        res.status(500).json({ error: 'Failed to load experience.' });
    }
});

app.post('/api/contact', contactLimiter, async (req, res) => {
    try {
        const { name, email, subject, message, website_url, turnstile } = req.body;

        // Spam protection: honeypot field
        if (website_url) return res.json({ ok: true, message: 'Message sent!' });

        // Verify Turnstile
        const tsOk = await verifyTurnstile(turnstile, req.ip);
        if (!tsOk) {
            return res.status(403).json({ ok: false, error: 'Bot verification failed. Please try again.' });
        }

        // Server-side input validation
        if (!name?.trim() || !email?.trim() || !message?.trim()) {
            return res.status(422).json({ ok: false, error: 'Name, email, and message are required.' });
        }
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(email)) {
            return res.status(422).json({ ok: false, error: 'Please enter a valid email address.' });
        }
        if (message.length > 2000) {
            return res.status(422).json({ ok: false, error: 'Message is too long (max 2000 characters).' });
        }
        if (name.length > 100 || (subject && subject.length > 200)) {
            return res.status(422).json({ ok: false, error: 'Input fields are too long.' });
        }

        // Insert to DB
        await pool.query(
            'INSERT INTO messages (name, email, subject, message) VALUES (?, ?, ?, ?)',
            [name.trim(), email.trim(), subject?.trim() ?? '', message.trim()]
        );

        // Send Email — sanitize name to prevent header injection
        const safeName = sanitizeHeader(name.trim());
        await transporter.sendMail({
            from: `"Arraffi Portfolio" <${process.env.SMTP_FROM}>`,
            to: 'kona@konaima.my.id',
            replyTo: `"${safeName}" <${sanitizeHeader(email.trim())}>`,
            subject: `[Portfolio] ${sanitizeHeader(subject?.trim() || 'New message from ' + name.trim())}`,
            text: `Name: ${name.trim()}\nEmail: ${email.trim()}\nSubject: ${subject?.trim() || '(none)'}\n\n${message.trim()}`
        });

        res.json({ ok: true, message: 'Message sent successfully!' });
    } catch {
        res.status(500).json({ ok: false, error: 'Internal Server Error' });
    }
});


/* ── ADMIN ENDPOINTS ───────────────────────────────────────────────────── */

// Admin APIs must originate from approved browser origins in production.
app.use('/api/admin', (req, res, next) => {
    if (process.env.NODE_ENV !== 'production') return next();
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.includes(origin)) {
        return res.status(403).json({ error: 'Forbidden origin' });
    }
    next();
});

app.post('/api/admin/login', loginLimiter, async (req, res) => {
    const { password, turnstile } = req.body ?? {};
    // Verify Turnstile challenge first — stops bots before touching the password
    const tsOk = await verifyTurnstile(turnstile, req.ip);
    if (!tsOk) {
        return res.status(403).json({ error: 'Turnstile verification failed. Please try again.' });
    }
    if (typeof password === 'string' && timingSafeEqual(password, process.env.ADMIN_PASSWORD)) {
        const token = createSessionToken();
        res.cookie(ADMIN_SESSION_COOKIE, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: SESSION_TTL_MS,
            path: '/api/admin',
        });
        return res.json({ ok: true });
    }
    return res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/admin/logout', authMiddleware, (req, res) => {
    revokeSessionToken(extractAdminSessionToken(req));
    res.clearCookie(ADMIN_SESSION_COOKIE, {
        path: '/api/admin',
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
    });
    res.json({ ok: true });
});

// ── Projects CRUD ──────────────────────────────────────────────────────────

app.get('/api/admin/projects', authMiddleware, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, title, title_id, description, description_id, url, image_url, full_width FROM projects ORDER BY id ASC'
        );
        res.json(rows);
    } catch {
        res.status(500).json({ error: 'Failed to fetch projects.' });
    }
});

app.post('/api/admin/projects', authMiddleware, async (req, res) => {
    try {
        const { title, title_id, description, description_id, url, image_url, full_width } = req.body ?? {};
        if (!title?.trim() || !description?.trim()) {
            return res.status(422).json({ error: 'Title and description are required.' });
        }
        if (title.length > 255 || (title_id && title_id.length > 255)) {
            return res.status(422).json({ error: 'Title is too long (max 255 characters).' });
        }
        if (description.length > 2000 || (description_id && description_id.length > 2000)) {
            return res.status(422).json({ error: 'Description is too long (max 2000 characters).' });
        }
        if (!isValidUrl(url)) return res.status(422).json({ error: 'Project URL must start with http:// or https://' });
        if (!isValidUrl(image_url)) return res.status(422).json({ error: 'Image URL must start with http:// or https://' });
        await pool.query(
            'INSERT INTO projects (title, title_id, description, description_id, url, image_url, full_width) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [title.trim(), title_id?.trim() || null, description.trim(), description_id?.trim() || null, url?.trim() || null, image_url?.trim() || null, full_width ? 1 : 0]
        );
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Failed to create project.' });
    }
});

app.put('/api/admin/projects/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid project ID.' });
        const { title, title_id, description, description_id, url, image_url, full_width } = req.body ?? {};
        if (!title?.trim() || !description?.trim()) {
            return res.status(422).json({ error: 'Title and description are required.' });
        }
        if (title.length > 255 || (title_id && title_id.length > 255)) {
            return res.status(422).json({ error: 'Title is too long (max 255 characters).' });
        }
        if (description.length > 2000 || (description_id && description_id.length > 2000)) {
            return res.status(422).json({ error: 'Description is too long (max 2000 characters).' });
        }
        if (!isValidUrl(url)) return res.status(422).json({ error: 'Project URL must start with http:// or https://' });
        if (!isValidUrl(image_url)) return res.status(422).json({ error: 'Image URL must start with http:// or https://' });
        await pool.query(
            'UPDATE projects SET title=?, title_id=?, description=?, description_id=?, url=?, image_url=?, full_width=? WHERE id=?',
            [title.trim(), title_id?.trim() || null, description.trim(), description_id?.trim() || null, url?.trim() || null, image_url?.trim() || null, full_width ? 1 : 0, id]
        );
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Failed to update project.' });
    }
});

app.delete('/api/admin/projects/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid project ID.' });
        await pool.query('DELETE FROM projects WHERE id=?', [id]);
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Failed to delete project.' });
    }
});

// ── Experience CRUD ───────────────────────────────────────────────────────

app.get('/api/admin/experience', authMiddleware, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, company, role, role_id, date_range, description, description_id, logo_url, url FROM experience ORDER BY id ASC'
        );
        res.json(rows);
    } catch {
        res.status(500).json({ error: 'Failed to fetch experience.' });
    }
});

app.post('/api/admin/experience', authMiddleware, async (req, res) => {
    try {
        const { company, role, role_id, date_range, description, description_id, logo_url, url } = req.body ?? {};
        if (!company?.trim() || !role?.trim() || !date_range?.trim() || !description?.trim()) {
            return res.status(422).json({ error: 'Company, role, date range, and description are required.' });
        }
        if (role.length > 255 || (role_id && role_id.length > 255) || company.length > 255) {
            return res.status(422).json({ error: 'Text field is too long (max 255 characters).' });
        }
        if (description.length > 2000 || (description_id && description_id.length > 2000)) {
            return res.status(422).json({ error: 'Description is too long (max 2000 characters).' });
        }
        if (!isValidUrl(url)) return res.status(422).json({ error: 'Company URL must start with http:// or https://' });
        if (!isValidUrl(logo_url)) return res.status(422).json({ error: 'Logo URL must start with http:// or https://' });
        await pool.query(
            'INSERT INTO experience (company, role, role_id, date_range, description, description_id, logo_url, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [company.trim(), role.trim(), role_id?.trim() || null, date_range.trim(), description.trim(), description_id?.trim() || null, logo_url?.trim() || null, url?.trim() || null]
        );
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Failed to create experience entry.' });
    }
});

app.put('/api/admin/experience/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid experience ID.' });
        const { company, role, role_id, date_range, description, description_id, logo_url, url } = req.body ?? {};
        if (!company?.trim() || !role?.trim() || !date_range?.trim() || !description?.trim()) {
            return res.status(422).json({ error: 'Company, role, date range, and description are required.' });
        }
        if (role.length > 255 || (role_id && role_id.length > 255) || company.length > 255) {
            return res.status(422).json({ error: 'Text field is too long (max 255 characters).' });
        }
        if (description.length > 2000 || (description_id && description_id.length > 2000)) {
            return res.status(422).json({ error: 'Description is too long (max 2000 characters).' });
        }
        if (!isValidUrl(url)) return res.status(422).json({ error: 'Company URL must start with http:// or https://' });
        if (!isValidUrl(logo_url)) return res.status(422).json({ error: 'Logo URL must start with http:// or https://' });
        await pool.query(
            'UPDATE experience SET company=?, role=?, role_id=?, date_range=?, description=?, description_id=?, logo_url=?, url=? WHERE id=?',
            [company.trim(), role.trim(), role_id?.trim() || null, date_range.trim(), description.trim(), description_id?.trim() || null, logo_url?.trim() || null, url?.trim() || null, id]
        );
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Failed to update experience entry.' });
    }
});

app.delete('/api/admin/experience/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid experience ID.' });
        await pool.query('DELETE FROM experience WHERE id=?', [id]);
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Failed to delete experience entry.' });
    }
});

// ── Messages ──────────────────────────────────────────────────────────────

app.get('/api/admin/messages', authMiddleware, async (req, res) => {
    try {
        // Explicit columns — avoids leaking future sensitive fields added to the table
        const [rows] = await pool.query(
            'SELECT id, name, email, subject, message, created_at FROM messages ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch {
        res.status(500).json({ error: 'Failed to fetch messages.' });
    }
});

// ── 404 fallback ──────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: 'Not found.' });
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err, req, res, _next) => {
    console.error('[Unhandled Error]', err?.message);
    res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = parseInt(process.env.PORT, 10) || 3001;
app.listen(PORT, () => {
    console.log(`Express API running on http://localhost:${PORT}`);
});
