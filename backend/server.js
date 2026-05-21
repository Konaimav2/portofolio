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
    'https://arraffi.my.id',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
];
app.use(cors({
    origin: (origin, callback) => {
        // Block requests with no Origin header in production (allows curl/Postman only in dev)
        if (!origin) {
            if (process.env.NODE_ENV !== 'production') return callback(null, true);
            return callback(new Error('No Origin header'));
        }
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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

// ── Timing-safe password comparison (prevents timing attacks) ─────────────
function timingSafeEqual(a, b) {
    // Both must be strings; pad to the same length to avoid length oracle
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
        // Always do a dummy comparison to keep constant time, then return false
        crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
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

// ── Admin auth middleware ──────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
    const pass = req.headers.authorization;
    if (!pass || !timingSafeEqual(pass, process.env.ADMIN_PASSWORD)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// ── Rate limiter: login endpoint ──────────────────────────────────────────
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── Rate limiter: contact form ────────────────────────────────────────────
const contactLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { ok: false, error: 'Too many requests. Please wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
});

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
        const { name, email, subject, message, website_url } = req.body;

        // Spam protection: honeypot field
        if (website_url) return res.json({ ok: true, message: 'Message sent!' });

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
            replyTo: `"${safeName}" <${email.trim()}>`,
            subject: `[Portfolio] ${sanitizeHeader(subject?.trim() || 'New message from ' + name.trim())}`,
            text: `Name: ${name.trim()}\nEmail: ${email.trim()}\nSubject: ${subject?.trim() || '(none)'}\n\n${message.trim()}`
        });

        res.json({ ok: true, message: 'Message sent successfully!' });
    } catch {
        res.status(500).json({ ok: false, error: 'Internal Server Error' });
    }
});

/* ── ADMIN ENDPOINTS ────────────────────────────────────────────────────── */

app.post('/api/admin/login', loginLimiter, (req, res) => {
    const { password } = req.body ?? {};
    if (typeof password === 'string' && timingSafeEqual(password, process.env.ADMIN_PASSWORD)) {
        res.json({ ok: true });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// ── Projects CRUD ──────────────────────────────────────────────────────────

app.get('/api/admin/projects', authMiddleware, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, title, title_id, description, description_id, url, image_url, full_width, created_at FROM projects ORDER BY id ASC'
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
            'SELECT id, company, role, role_id, date_range, description, description_id, logo_url, url, created_at FROM experience ORDER BY id ASC'
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
        const [rows] = await pool.query('SELECT * FROM messages ORDER BY created_at DESC');
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
