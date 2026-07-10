const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const { saveAvatarDataUrl, deleteAvatarUrl, buildR2Config } = require('./avatar-storage');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const {
    allowedOriginsForEnv,
    isAllowedAdminOrigin,
    clientSafeRegisterError,
    shouldRequireRegisterTurnstile,
} = require('./security-helpers');

const _r2Config = buildR2Config();
const _r2Client = _r2Config ? new S3Client({
    region: 'auto',
    endpoint: _r2Config.endpoint,
    credentials: _r2Config.credentials,
    forcePathStyle: true,
}) : null;

async function mirrorToR2(imageUrl, folder = 'image') {
    if (!_r2Config || !_r2Client || !imageUrl) return null;
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(imageUrl, { signal: controller.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 12 || buf.length > 10 * 1024 * 1024) return null;
        const ct = res.headers.get('content-type') || '';
        const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
        const mime = Object.keys(extMap).find(m => ct.includes(m)) || 'image/jpeg';
        const ext = extMap[mime];
        const key = `${folder}/${crypto.randomBytes(12).toString('hex')}.${ext}`;
        await _r2Client.send(new PutObjectCommand({
            Bucket: _r2Config.bucket,
            Key: key,
            Body: buf,
            ContentType: mime,
            CacheControl: 'public, max-age=31536000, immutable',
        }));
        return `${_r2Config.publicBaseUrl}/${key}`;
    } catch {
        return null;
    }
}

const app = express();

app.set('trust proxy', 1);

const allowedOrigins = allowedOriginsForEnv(process.env.NODE_ENV);
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true,
}));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
});

app.use(express.json({ limit: '3mb' }));

app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads/avatars', express.static(path.join(__dirname, 'uploads/avatars'), {
    immutable: true,
    maxAge: '30d',
    setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));

app.disable('x-powered-by');

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL missing. Add it to backend/.env or copy backend/.env.example to backend/.env.');
}
const pool = mysql.createPool(process.env.DATABASE_URL);
const ADMIN_DB_TIMEOUT_MS = 10000;

function adminQuery(sql, values = []) {
    return pool.query({ sql, values, timeout: ADMIN_DB_TIMEOUT_MS });
}

async function ensureOrderColumn(table) {
    try {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN sort_order INT NOT NULL DEFAULT 0`);
    } catch (err) {
        if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
    }
    await pool.query(`UPDATE ${table} SET sort_order = id WHERE sort_order = 0`);
}

async function ensureContentSchema() {
    await ensureOrderColumn('projects');
    await ensureOrderColumn('experience');
}

ensureContentSchema().catch(err => console.error('Content schema setup failed:', err?.message));

function timingSafeEqual(a, b) {
    const MAX = 256;
    const bufA = Buffer.alloc(MAX);
    const bufB = Buffer.alloc(MAX);
    Buffer.from(String(a)).copy(bufA);
    Buffer.from(String(b)).copy(bufB);
    return crypto.timingSafeEqual(bufA, bufB) && String(a).length === String(b).length;
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const activeSessions = new Map();
const commentSessions = new Map();

function createSessionToken() {
    const token = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, { expiry: Date.now() + SESSION_TTL_MS, csrf });
    return { token, csrf };
}

function getAdminSession(token) {
    if (!token || typeof token !== 'string') return false;
    const session = activeSessions.get(token);
    if (!session) return false;
    const expiry = typeof session === 'number' ? session : session.expiry;
    if (Date.now() > expiry) {
        activeSessions.delete(token);
        return false;
    }
    return typeof session === 'number' ? { expiry, csrf: '' } : session;
}

function validateSessionToken(token) {
    return Boolean(getAdminSession(token));
}

function revokeSessionToken(token) {
    activeSessions.delete(token);
}

function createCommentSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    commentSessions.set(token, { userId, expiry: Date.now() + SESSION_TTL_MS });
    return token;
}

function getCommentSession(token) {
    const session = commentSessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiry) {
        commentSessions.delete(token);
        return null;
    }
    return session;
}

function revokeCommentSession(token) {
    commentSessions.delete(token);
}

setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions.entries()) {
        const expiry = typeof session === 'number' ? session : session.expiry;
        if (now > expiry) activeSessions.delete(token);
    }
    for (const [token, session] of commentSessions.entries()) {
        if (now > session.expiry) commentSessions.delete(token);
    }
}, 60 * 60 * 1000).unref();

const ADMIN_SESSION_COOKIE = 'admin_session';
const COMMENT_SESSION_COOKIE = 'comment_session';

function extractCookie(req, name) {
    const raw = req.headers.cookie || '';
    const cookie = raw
        .split(';')
        .map(v => v.trim())
        .find(v => v.startsWith(`${name}=`));
    if (!cookie) return '';
    try {
        return decodeURIComponent(cookie.slice(name.length + 1));
    } catch {
        return '';
    }
}

function extractAdminSessionToken(req) {
    return extractCookie(req, ADMIN_SESSION_COOKIE);
}

function extractCommentSessionToken(req) {
    return extractCookie(req, COMMENT_SESSION_COOKIE);
}

function parseId(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== raw) return null;
    return n;
}

function isValidUrl(str) {
    if (!str || str.trim() === '') return true;
    try {
        const u = new URL(str.trim());
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
}

function sanitizeHeader(str) {
    return String(str ?? '').replace(/[\r\n"\\]/g, '');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function publicUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        avatar_url: row.avatar_url || '',
    };
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await new Promise((resolve, reject) => {
        crypto.scrypt(String(password), salt, 64, (err, key) => err ? reject(err) : resolve(key));
    });
    return `scrypt:${salt}:${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
    const [scheme, salt, hash] = String(stored || '').split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const derived = await new Promise((resolve, reject) => {
        crypto.scrypt(String(password), salt, 64, (err, key) => err ? reject(err) : resolve(key));
    });
    const expected = Buffer.from(hash, 'hex');
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function moderateComment(text) {
    const body = String(text || '').trim();
    if (body.length < 2) return 'Write a comment first.';
    if (body.length > 1200) return 'Keep comments under 1200 characters.';
    const lower = body.toLowerCase();
    const blocked = [
        /\b(casino|gambling|slot\s*online|sportsbook|betting|jackpot|togel|gacor)\b/i,
        /\b(porn|xxx|onlyfans|sex\s*chat|escort|nsfw|nude)\b/i,
        /\b(buy\s+now|free\s+money|cheap\s+followers|seo\s+backlinks|crypto\s+airdrop)\b/i,
    ];
    if (blocked.some(pattern => pattern.test(lower))) return 'Comment looks like spam or advertising.';
    const links = lower.match(/https?:\/\//g) || [];
    if (links.length > 1) return 'Too many links for a comment.';
    if (/(.)\1{12,}/.test(body)) return 'Comment has too much repeated text.';
    return '';
}

async function ensureCommentSchema() {
    await pool.query(`CREATE TABLE IF NOT EXISTS app_meta (
        meta_key VARCHAR(120) PRIMARY KEY,
        meta_value VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS comment_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        avatar_url VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL,
        author_name VARCHAR(120) NOT NULL,
        author_email VARCHAR(255) NULL,
        avatar_url VARCHAR(500) NULL,
        body TEXT NOT NULL,
        status ENUM('approved','pending') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_comments_status_created (status, created_at),
        CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES comment_users(id) ON DELETE SET NULL
    )`);
    for (const ddl of [
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS image_url_fallback VARCHAR(1000) NULL",
        "ALTER TABLE experience ADD COLUMN IF NOT EXISTS logo_url_fallback VARCHAR(1000) NULL",
    ]) {
        try { await pool.query(ddl); } catch {}
    }
    const [meta] = await pool.query('SELECT meta_value FROM app_meta WHERE meta_key=? LIMIT 1', ['messages_flushed_for_comments']);
    if (!meta.length) {
        try { await pool.query('DELETE FROM messages'); } catch {}
        await pool.query('INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)', ['messages_flushed_for_comments', '1']);
    }
}

ensureCommentSchema().catch(err => console.error('Comment schema setup failed:', err?.message));

const commentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    message: { ok: false, error: 'Too many requests. Please wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

function isLocalRequest(req) {
    if (process.env.NODE_ENV === 'production') return false;
    const originHost = (() => {
        try { return new URL(req.get('origin') || '').hostname; } catch { return ''; }
    })();
    const host = req.hostname || '';
    return ['localhost', '127.0.0.1', '::1'].includes(host) || ['localhost', '127.0.0.1', '::1'].includes(originHost);
}

async function verifyTurnstile(token, req) {
    const secret = isLocalRequest(req) ? TURNSTILE_TEST_SECRET : process.env.TURNSTILE_SECRET;
    if (!token || typeof token !== 'string' || !secret) return false;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const params = new URLSearchParams({
            secret,
            response: token,
            remoteip: String(req.ip || ''),
        });
        try {
            const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
                signal: controller.signal,
            });
            const data = await r.json();
            return data.success === true;
        } finally {
            clearTimeout(timeout);
        }
    } catch {
        return false;
    }
}

const loginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts. Please wait 10 minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const authMiddleware = (req, res, next) => {
    const token = extractAdminSessionToken(req);
    const session = getAdminSession(token);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.adminSession = session;
    next();
};

const adminCsrfMiddleware = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const supplied = req.get('x-csrf-token') || '';
    const expected = req.adminSession?.csrf || '';
    if (!expected || !timingSafeEqual(supplied, expected)) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next();
};


app.get('/api/projects', async (req, res) => {
    try {
        const [rows] = await pool.query({
            sql: 'SELECT id, title, title_id, description, description_id, url, image_url, image_url_fallback, full_width FROM projects ORDER BY sort_order ASC, id ASC',
            timeout: 7000,
        });
        res.json(rows);
    } catch (err) {
        console.error('Projects load failed:', err?.message);
        res.status(500).json({ error: 'Failed to load projects.' });
    }
});

app.get('/api/experience', async (req, res) => {
    try {
        const [rows] = await pool.query({
            sql: 'SELECT id, company, role, role_id, date_range, description, description_id, logo_url, logo_url_fallback, url FROM experience ORDER BY sort_order ASC, id ASC',
            timeout: 7000,
        });
        res.json(rows);
    } catch (err) {
        console.error('Experience load failed:', err?.message);
        res.status(500).json({ error: 'Failed to load experience.' });
    }
});

async function currentCommentUser(req) {
    const session = getCommentSession(extractCommentSessionToken(req));
    if (!session) return null;
    const [rows] = await pool.query('SELECT id, name, email, avatar_url FROM comment_users WHERE id=? LIMIT 1', [session.userId]);
    return rows[0] || null;
}

app.get('/api/comment/me', async (req, res) => {
    try {
        res.json({ user: publicUser(await currentCommentUser(req)) });
    } catch {
        res.status(500).json({ error: 'Failed to load account.' });
    }
});

app.post('/api/comment/register', commentLimiter, async (req, res) => {
    let avatarUrl = '';
    try {
        const { name, email, password, avatar_data, turnstile } = req.body ?? {};
        if (!name?.trim() || !email?.trim() || !password) {
            return res.status(422).json({ error: 'Name, email, and password are required.' });
        }
        if (shouldRequireRegisterTurnstile(process.env.NODE_ENV, isLocalRequest(req))) {
            const tsOk = await verifyTurnstile(turnstile, req);
            if (!tsOk) return res.status(403).json({ error: 'Turnstile verification failed. Please try again.' });
        }
        if (name.trim().length > 120) return res.status(422).json({ error: 'Name is too long.' });
        if (!isValidEmail(email)) return res.status(422).json({ error: 'Use a valid email address.' });
        if (String(password).length < 8 || String(password).length > 160) {
            return res.status(422).json({ error: 'Password must be 8 to 160 characters.' });
        }
        avatarUrl = await saveAvatarDataUrl(avatar_data);
        const passwordHash = await hashPassword(password);
        const [result] = await pool.query(
            'INSERT INTO comment_users (name, email, password_hash, avatar_url) VALUES (?, ?, ?, ?)',
            [name.trim(), email.trim().toLowerCase(), passwordHash, avatarUrl || null]
        );
        const token = createCommentSession(result.insertId);
        res.cookie(COMMENT_SESSION_COOKIE, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: SESSION_TTL_MS,
            path: '/api',
        });
        res.json({ ok: true, user: { id: result.insertId, name: name.trim(), email: email.trim().toLowerCase(), avatar_url: avatarUrl } });
    } catch (err) {
        if (avatarUrl) {
            try { await deleteAvatarUrl(avatarUrl); } catch (cleanupErr) { console.error('Avatar cleanup failed:', cleanupErr?.message); }
        }
        if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That email already has an account.' });
        res.status(422).json({ error: clientSafeRegisterError(err) });
    }
});

app.post('/api/comment/login', commentLimiter, async (req, res) => {
    try {
        const { email, password } = req.body ?? {};
        if (!isValidEmail(email) || !password) return res.status(401).json({ error: 'Invalid email or password.' });
        const [rows] = await pool.query('SELECT id, name, email, password_hash, avatar_url FROM comment_users WHERE email=? LIMIT 1', [email.trim().toLowerCase()]);
        const user = rows[0];
        if (!user || !(await verifyPassword(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }
        const token = createCommentSession(user.id);
        res.cookie(COMMENT_SESSION_COOKIE, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: SESSION_TTL_MS,
            path: '/api',
        });
        res.json({ ok: true, user: publicUser(user) });
    } catch {
        res.status(500).json({ error: 'Login failed.' });
    }
});

app.post('/api/comment/logout', async (req, res) => {
    revokeCommentSession(extractCommentSessionToken(req));
    res.clearCookie(COMMENT_SESSION_COOKIE, {
        path: '/api',
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
    });
    res.json({ ok: true });
});

app.get('/api/comments', async (_req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, author_name, avatar_url, body, created_at
             FROM comments WHERE status='approved' ORDER BY created_at DESC LIMIT 60`
        );
        res.json(rows);
    } catch {
        res.status(500).json({ error: 'Failed to load comments.' });
    }
});

app.post('/api/comments', commentLimiter, async (req, res) => {
    try {
        const { body, anonymous_name, anonymous_email, website_url, turnstile } = req.body ?? {};
        if (website_url) return res.json({ ok: true, status: 'pending', message: 'Comment received.' });
        const tsOk = await verifyTurnstile(turnstile, req);
        if (!tsOk) return res.status(403).json({ ok: false, error: 'Turnstile check failed. Please try again.' });
        const moderationError = moderateComment(body);
        if (moderationError) return res.status(422).json({ ok: false, error: moderationError });

        const user = await currentCommentUser(req);
        const name = user?.name || String(anonymous_name || 'Anonymous').trim();
        const email = user?.email || String(anonymous_email || '').trim().toLowerCase();
        if (!name || name.length > 120) return res.status(422).json({ ok: false, error: 'Name is required and must be short.' });
        if (email && !isValidEmail(email)) return res.status(422).json({ ok: false, error: 'Use a valid email address or leave it blank.' });

        const status = user ? 'approved' : 'pending';
        await pool.query(
            'INSERT INTO comments (user_id, author_name, author_email, avatar_url, body, status) VALUES (?, ?, ?, ?, ?, ?)',
            [user?.id || null, name, email || null, user?.avatar_url || null, String(body).trim(), status]
        );
        res.json({
            ok: true,
            status,
            message: status === 'approved' ? 'Comment posted.' : 'Comment received. Anonymous posts wait for review.',
        });
    } catch {
        res.status(500).json({ ok: false, error: 'Could not post comment.' });
    }
});



app.use('/api/admin', (req, res, next) => {
    if (process.env.NODE_ENV !== 'production') return next();
    const origin = req.headers.origin;
    if (!isAllowedAdminOrigin(origin, process.env.NODE_ENV)) {
        return res.status(403).json({ error: 'Forbidden origin' });
    }
    next();
});

app.post('/api/admin/login', loginLimiter, async (req, res) => {
    const { password, turnstile } = req.body ?? {};
    const tsOk = await verifyTurnstile(turnstile, req);
    if (!tsOk) {
        return res.status(403).json({ error: 'Turnstile verification failed. Please try again.' });
    }
    if (typeof password === 'string' && timingSafeEqual(password, process.env.ADMIN_PASSWORD)) {
        const { token, csrf } = createSessionToken();
        res.cookie(ADMIN_SESSION_COOKIE, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
            maxAge: SESSION_TTL_MS,
            path: '/api/admin',
        });
        return res.json({ ok: true, csrfToken: csrf });
    }
    return res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/admin/logout', authMiddleware, adminCsrfMiddleware, (req, res) => {
    revokeSessionToken(extractAdminSessionToken(req));
    res.clearCookie(ADMIN_SESSION_COOKIE, {
        path: '/api/admin',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        secure: process.env.NODE_ENV === 'production',
    });
    res.json({ ok: true });
});

// Auto-login check
app.get('/api/admin/check', authMiddleware, (req, res) => {
    res.json({ ok: true, csrfToken: req.adminSession.csrf });
});


app.get('/api/admin/projects', authMiddleware, async (req, res) => {
    try {
        const [rows] = await adminQuery('SELECT id, title, title_id, description, description_id, url, image_url, image_url_fallback, full_width, sort_order FROM projects ORDER BY sort_order ASC, id ASC');
        res.json(rows);
    } catch (err) {
        console.error('Admin projects fetch failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch projects.' });
    }
});

app.post('/api/admin/projects', authMiddleware, adminCsrfMiddleware, async (req, res) => {
    try {
        const { title, title_id, description, description_id, url, image_url, full_width } = req.body ?? {};
        if (!title?.trim() || !title_id?.trim() || !description?.trim() || !description_id?.trim()) {
            return res.status(422).json({ error: 'English and Indonesian title/description are required.' });
        }
        if (title.length > 255 || (title_id && title_id.length > 255)) {
            return res.status(422).json({ error: 'Title is too long (max 255 characters).' });
        }
        if (description.length > 2000 || (description_id && description_id.length > 2000)) {
            return res.status(422).json({ error: 'Description is too long (max 2000 characters).' });
        }
        if (!isValidUrl(url)) return res.status(422).json({ error: 'Project URL must start with http:// or https://' });
        if (!isValidUrl(image_url)) return res.status(422).json({ error: 'Image URL must start with http:// or https://' });
        const [projIns] = await adminQuery(
            'INSERT INTO projects (title, title_id, description, description_id, url, image_url, full_width, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT next_order FROM (SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM projects) AS p))',
            [title.trim(), title_id.trim(), description.trim(), description_id.trim(), url?.trim() || null, image_url?.trim() || null, full_width ? 1 : 0]
        );
        const fallbackImgC = await mirrorToR2(image_url?.trim(), 'image');
        if (fallbackImgC) await adminQuery('UPDATE projects SET image_url_fallback=? WHERE id=?', [fallbackImgC, projIns.insertId]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Admin project create failed:', err.message);
        res.status(500).json({ error: 'Failed to create project.' });
    }
});

app.put('/api/admin/projects/:id', authMiddleware, adminCsrfMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid project ID.' });
        const { title, title_id, description, description_id, url, image_url, full_width } = req.body ?? {};
        if (!title?.trim() || !title_id?.trim() || !description?.trim() || !description_id?.trim()) {
            return res.status(422).json({ error: 'English and Indonesian title/description are required.' });
        }
        if (title.length > 255 || (title_id && title_id.length > 255)) {
            return res.status(422).json({ error: 'Title is too long (max 255 characters).' });
        }
        if (description.length > 2000 || (description_id && description_id.length > 2000)) {
            return res.status(422).json({ error: 'Description is too long (max 2000 characters).' });
        }
        if (!isValidUrl(url)) return res.status(422).json({ error: 'Project URL must start with http:// or https://' });
        if (!isValidUrl(image_url)) return res.status(422).json({ error: 'Image URL must start with http:// or https://' });
        await adminQuery(
            'UPDATE projects SET title=?, title_id=?, description=?, description_id=?, url=?, image_url=?, full_width=? WHERE id=?',
            [title.trim(), title_id.trim(), description.trim(), description_id.trim(), url?.trim() || null, image_url?.trim() || null, full_width ? 1 : 0, id]
        );
        const fallbackImg = await mirrorToR2(image_url?.trim(), 'image');
        if (fallbackImg) await adminQuery('UPDATE projects SET image_url_fallback=? WHERE id=?', [fallbackImg, id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Admin project update failed:', err.message);
        res.status(500).json({ error: 'Failed to update project.' });
    }
});

app.delete('/api/admin/projects/:id', authMiddleware, adminCsrfMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid project ID.' });
        await adminQuery('DELETE FROM projects WHERE id=?', [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Admin project delete failed:', err.message);
        res.status(500).json({ error: 'Failed to delete project.' });
    }
});

app.patch('/api/admin/projects/:id/move', authMiddleware, adminCsrfMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        const direction = req.body?.direction === 'down' ? 'down' : 'up';
        if (!id) return res.status(400).json({ error: 'Invalid project ID.' });

        const [currentRows] = await adminQuery('SELECT id, sort_order FROM projects WHERE id=? LIMIT 1', [id]);
        if (!currentRows.length) return res.status(404).json({ error: 'Project not found.' });
        const current = currentRows[0];
        const comparison = direction === 'up' ? '<' : '>';
        const orderDirection = direction === 'up' ? 'DESC' : 'ASC';
        const [neighborRows] = await adminQuery(
            `SELECT id, sort_order FROM projects WHERE sort_order ${comparison} ? ORDER BY sort_order ${orderDirection}, id ${orderDirection} LIMIT 1`,
            [current.sort_order]
        );
        if (!neighborRows.length) return res.json({ ok: true, moved: false });

        const neighbor = neighborRows[0];
        await adminQuery('UPDATE projects SET sort_order=? WHERE id=?', [neighbor.sort_order, current.id]);
        await adminQuery('UPDATE projects SET sort_order=? WHERE id=?', [current.sort_order, neighbor.id]);
        res.json({ ok: true, moved: true });
    } catch (err) {
        console.error('Admin project move failed:', err.message);
        res.status(500).json({ error: 'Failed to move project.' });
    }
});


app.get('/api/admin/experience', authMiddleware, async (req, res) => {
    try {
        const [rows] = await adminQuery('SELECT id, company, role, role_id, date_range, description, description_id, logo_url, logo_url_fallback, url, sort_order FROM experience ORDER BY sort_order ASC, id ASC');
        res.json(rows);
    } catch (err) {
        console.error('Admin experience fetch failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch experience.' });
    }
});

app.post('/api/admin/experience', authMiddleware, adminCsrfMiddleware, async (req, res) => {
    try {
        const { company, role, role_id, date_range, description, description_id, logo_url, url } = req.body ?? {};
        if (!company?.trim() || !role?.trim() || !role_id?.trim() || !date_range?.trim() || !description?.trim() || !description_id?.trim()) {
            return res.status(422).json({ error: 'Company, date range, and English/Indonesian role/description are required.' });
        }
        if (role.length > 255 || (role_id && role_id.length > 255) || company.length > 255) {
            return res.status(422).json({ error: 'Text field is too long (max 255 characters).' });
        }
        if (description.length > 2000 || (description_id && description_id.length > 2000)) {
            return res.status(422).json({ error: 'Description is too long (max 2000 characters).' });
        }
        if (!isValidUrl(url)) return res.status(422).json({ error: 'Company URL must start with http:// or https://' });
        if (!isValidUrl(logo_url)) return res.status(422).json({ error: 'Logo URL must start with http:// or https://' });
        const [expIns] = await adminQuery(
            'INSERT INTO experience (company, role, role_id, date_range, description, description_id, logo_url, url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT next_order FROM (SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM experience) AS e))',
            [company.trim(), role.trim(), role_id.trim(), date_range.trim(), description.trim(), description_id.trim(), logo_url?.trim() || null, url?.trim() || null]
        );
        const fallbackLogoC = await mirrorToR2(logo_url?.trim(), 'image');
        if (fallbackLogoC) await adminQuery('UPDATE experience SET logo_url_fallback=? WHERE id=?', [fallbackLogoC, expIns.insertId]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Admin experience create failed:', err.message);
        res.status(500).json({ error: 'Failed to create experience entry.' });
    }
});

app.put('/api/admin/experience/:id', authMiddleware, adminCsrfMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid experience ID.' });
        const { company, role, role_id, date_range, description, description_id, logo_url, url } = req.body ?? {};
        if (!company?.trim() || !role?.trim() || !role_id?.trim() || !date_range?.trim() || !description?.trim() || !description_id?.trim()) {
            return res.status(422).json({ error: 'Company, date range, and English/Indonesian role/description are required.' });
        }
        if (role.length > 255 || (role_id && role_id.length > 255) || company.length > 255) {
            return res.status(422).json({ error: 'Text field is too long (max 255 characters).' });
        }
        if (description.length > 2000 || (description_id && description_id.length > 2000)) {
            return res.status(422).json({ error: 'Description is too long (max 2000 characters).' });
        }
        if (!isValidUrl(url)) return res.status(422).json({ error: 'Company URL must start with http:// or https://' });
        if (!isValidUrl(logo_url)) return res.status(422).json({ error: 'Logo URL must start with http:// or https://' });
        await adminQuery(
            'UPDATE experience SET company=?, role=?, role_id=?, date_range=?, description=?, description_id=?, logo_url=?, url=? WHERE id=?',
            [company.trim(), role.trim(), role_id.trim(), date_range.trim(), description.trim(), description_id.trim(), logo_url?.trim() || null, url?.trim() || null, id]
        );
        const fallbackLogo = await mirrorToR2(logo_url?.trim(), 'image');
        if (fallbackLogo) await adminQuery('UPDATE experience SET logo_url_fallback=? WHERE id=?', [fallbackLogo, id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Admin experience update failed:', err.message);
        res.status(500).json({ error: 'Failed to update experience entry.' });
    }
});

app.delete('/api/admin/experience/:id', authMiddleware, adminCsrfMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid experience ID.' });
        await adminQuery('DELETE FROM experience WHERE id=?', [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Admin experience delete failed:', err.message);
        res.status(500).json({ error: 'Failed to delete experience entry.' });
    }
});

app.patch('/api/admin/experience/:id/move', authMiddleware, adminCsrfMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        const direction = req.body?.direction === 'down' ? 'down' : 'up';
        if (!id) return res.status(400).json({ error: 'Invalid experience ID.' });

        const [currentRows] = await adminQuery('SELECT id, sort_order FROM experience WHERE id=? LIMIT 1', [id]);
        if (!currentRows.length) return res.status(404).json({ error: 'Experience not found.' });
        const current = currentRows[0];
        const comparison = direction === 'up' ? '<' : '>';
        const orderDirection = direction === 'up' ? 'DESC' : 'ASC';
        const [neighborRows] = await adminQuery(
            `SELECT id, sort_order FROM experience WHERE sort_order ${comparison} ? ORDER BY sort_order ${orderDirection}, id ${orderDirection} LIMIT 1`,
            [current.sort_order]
        );
        if (!neighborRows.length) return res.json({ ok: true, moved: false });

        const neighbor = neighborRows[0];
        await adminQuery('UPDATE experience SET sort_order=? WHERE id=?', [neighbor.sort_order, current.id]);
        await adminQuery('UPDATE experience SET sort_order=? WHERE id=?', [current.sort_order, neighbor.id]);
        res.json({ ok: true, moved: true });
    } catch (err) {
        console.error('Admin experience move failed:', err.message);
        res.status(500).json({ error: 'Failed to move experience.' });
    }
});


app.get('/api/admin/comments', authMiddleware, async (_req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, user_id, author_name, author_email, avatar_url, body, status, created_at
             FROM comments ORDER BY created_at DESC LIMIT 200`
        );
        res.json(rows);
    } catch {
        res.status(500).json({ error: 'Failed to fetch comments.' });
    }
});

app.delete('/api/admin/comments/:id', authMiddleware, adminCsrfMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid comment ID.' });
        await pool.query('DELETE FROM comments WHERE id=?', [id]);
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Failed to delete comment.' });
    }
});

app.patch('/api/admin/comments/:id/approve', authMiddleware, adminCsrfMiddleware, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid comment ID.' });
        const [result] = await pool.query('UPDATE comments SET status=? WHERE id=?', ['approved', id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Comment not found.' });
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: 'Failed to approve comment.' });
    }
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not found.' });
});

app.use((err, req, res, _next) => {
    console.error('[Unhandled Error]', err?.message);
    res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = parseInt(process.env.PORT, 10) || 3001;
app.listen(PORT, () => {
    console.log(`Express API running on http://localhost:${PORT}`);
});
