const path = require('node:path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
const { saveAvatarDataUrl, deleteAvatarUrl, buildR2Config, buildAssetKey } = require('./avatar-storage');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const media = require('./content-media');
const { clientSafeRegisterError } = require('./security-helpers');
const { checkDatabaseReady } = require('./database');
const { sendError } = require('./api-errors');
const { createLogger, requestLogger } = require('./logger');
const { createTurnstileVerifier } = require('./turnstile');

function createApp({
  config,
  pool,
  turnstileVerifier,
  avatarStore = {},
  mediaStore = {},
  logger = createLogger(),
}) {
  const app = express();
  const saveAvatar = avatarStore.saveAvatarDataUrl || saveAvatarDataUrl;
  const deleteAvatar = avatarStore.deleteAvatarUrl || deleteAvatarUrl;
  const r2Config = config.r2 ? buildR2Config({
    R2_ACCOUNT_ID: config.r2.accountId,
    R2_ACCESS_KEY_ID: config.r2.accessKeyId,
    R2_SECRET_ACCESS_KEY: config.r2.secretAccessKey,
    R2_BUCKET: config.r2.bucket,
    R2_PUBLIC_URL: config.r2.publicBaseUrl,
  }) : null;
  const r2Client = r2Config ? new S3Client({
    region: 'auto',
    endpoint: r2Config.endpoint,
    credentials: r2Config.credentials,
    forcePathStyle: true,
  }) : null;
  const contentDependencies = {
    pool,
    prepareAsset: mediaStore.prepareAsset || (sourceUrl => media.prepareAsset(sourceUrl, { r2Config, r2Client, imageOptions: { config } })),
    deleteOwnedAsset: mediaStore.deleteOwnedAsset || (objectKey => media.deleteOwnedAsset(objectKey, { r2Config, r2Client })),
  };

  async function mirrorToR2(imageUrl) {
    if (mediaStore.mirrorToR2) return mediaStore.mirrorToR2(imageUrl);
    if (!r2Config || !r2Client || !imageUrl) return null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(imageUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 12 || buffer.length > 10 * 1024 * 1024) return null;
      const contentType = response.headers.get('content-type') || '';
      const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
      const mime = Object.keys(extensions).find(value => contentType.includes(value)) || 'image/jpeg';
      const key = buildAssetKey(extensions[mime]);
      await r2Client.send(new PutObjectCommand({
        Bucket: r2Config.bucket,
        Key: key,
        Body: buffer,
        ContentType: mime,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return `${r2Config.publicBaseUrl}/${key}`;
    } catch {
      return null;
    }
  }

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => cors({
    origin(origin, callback) {
      const origins = req.path.startsWith('/api/admin') ? config.adminOrigins : config.publicOrigins;
      callback(null, !origin || origins.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
    credentials: true,
  })(req, res, next));
  app.use(requestLogger(logger));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    next();
  });
  app.use(express.json({ limit: '3mb' }));
  app.use(express.static(path.join(__dirname, '../frontend')));
  app.use('/uploads/avatars', express.static(path.join(__dirname, 'uploads/avatars'), {
    immutable: true,
    maxAge: '30d',
    setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }));

  app.get('/livez', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', async (_req, res) => {
    try {
      await checkDatabaseReady(pool, 1500, { requireTls: config.production });
      res.json({ ok: true });
    } catch {
      res.locals.errorCode = 'DATABASE_UNAVAILABLE';
      res.status(503).json({ ok: false, error: 'DATABASE_UNAVAILABLE' });
    }
  });

  function timingSafeEqual(a, b) {
      const MAX = 256;
      const bufA = Buffer.alloc(MAX);
      const bufB = Buffer.alloc(MAX);
      Buffer.from(String(a)).copy(bufA);
      Buffer.from(String(b)).copy(bufB);
      return crypto.timingSafeEqual(bufA, bufB) && String(a).length === String(b).length;
  }

  const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
  const ADMIN_DB_TIMEOUT_MS = 10000;
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

  function adminQuery(sql, values = []) {
      return pool.query({ sql, values, timeout: ADMIN_DB_TIMEOUT_MS });
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


  const commentLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 3,
      message: { ok: false, error: 'Too many requests. Please wait a minute.' },
      standardHeaders: true,
      legacyHeaders: false,
  });

  const configuredTurnstileVerifier = turnstileVerifier || createTurnstileVerifier(config);

  async function verifyTurnstile(token, expectedAction, req) {
      if (!token || typeof token !== 'string') return { ok: false, code: 'TURNSTILE_REQUIRED' };
      try {
          if (typeof turnstileVerifier === 'function') {
              const ok = await turnstileVerifier(token, req, expectedAction);
              return { ok: ok === true, code: ok === true ? 'TURNSTILE_OK' : 'TURNSTILE_INVALID' };
          }
          const input = { token, expectedAction, remoteIp: req.ip };
          if (typeof configuredTurnstileVerifier.verifyDetailed === 'function') {
              return configuredTurnstileVerifier.verifyDetailed(input);
          }
          const ok = await configuredTurnstileVerifier.verify(input);
          return { ok: ok === true, code: ok === true ? 'TURNSTILE_OK' : 'TURNSTILE_INVALID' };
      } catch {
          return { ok: false, code: 'TURNSTILE_UNAVAILABLE' };
      }
  }

  function rejectTurnstile(res, result) {
      const code = result.code === 'TURNSTILE_REQUIRED' ? 'TURNSTILE_REQUIRED' : 'TURNSTILE_FAILED';
      return sendError(res, code);
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
          logger.error({ event: 'projects_load_failed', errorCode: 'DATABASE_UNAVAILABLE' });
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
          logger.error({ event: 'experience_load_failed', errorCode: 'DATABASE_UNAVAILABLE' });
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
          const turnstileResult = await verifyTurnstile(turnstile, 'comment_register', req);
          if (!turnstileResult.ok) return rejectTurnstile(res, turnstileResult);
          if (name.trim().length > 120) return res.status(422).json({ error: 'Name is too long.' });
          if (!isValidEmail(email)) return res.status(422).json({ error: 'Use a valid email address.' });
          if (String(password).length < 8 || String(password).length > 160) {
              return res.status(422).json({ error: 'Password must be 8 to 160 characters.' });
          }
          avatarUrl = await saveAvatar(avatar_data, { production: config.production, r2Config, r2Client, localStorage: config.nodeEnv === 'development' && config.avatarStorage === 'local' });
          const passwordHash = await hashPassword(password);
          const [result] = await pool.query(
              'INSERT INTO comment_users (name, email, password_hash, avatar_url) VALUES (?, ?, ?, ?)',
              [name.trim(), email.trim().toLowerCase(), passwordHash, avatarUrl || null]
          );
          const token = createCommentSession(result.insertId);
          res.cookie(COMMENT_SESSION_COOKIE, token, {
              httpOnly: true,
              secure: config.nodeEnv === 'production',
              sameSite: 'strict',
              maxAge: SESSION_TTL_MS,
              path: '/api',
          });
          res.json({ ok: true, user: { id: result.insertId, name: name.trim(), email: email.trim().toLowerCase(), avatar_url: avatarUrl } });
      } catch (err) {
          if (avatarUrl) {
              try { await deleteAvatar(avatarUrl); } catch (cleanupErr) { logger.error({ event: 'avatar_cleanup_failed', errorCode: 'STORAGE_UNAVAILABLE' }); }
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
              secure: config.nodeEnv === 'production',
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
          secure: config.nodeEnv === 'production',
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
          const turnstileResult = await verifyTurnstile(turnstile, 'comment_post', req);
          if (!turnstileResult.ok) return rejectTurnstile(res, turnstileResult);
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
      if (!config.production) return next();
      const origin = req.headers.origin;
      if (!origin || !config.adminOrigins.includes(origin)) {
          return sendError(res, 'ORIGIN_FORBIDDEN');
      }
      next();
  });

  app.post('/api/admin/login', loginLimiter, async (req, res) => {
      const { password, turnstile } = req.body ?? {};
      const turnstileResult = await verifyTurnstile(turnstile, 'admin_login', req);
      if (!turnstileResult.ok) return rejectTurnstile(res, turnstileResult);
      if (typeof password === 'string' && timingSafeEqual(password, config.adminPassword)) {
          const { token, csrf } = createSessionToken();
          res.cookie(ADMIN_SESSION_COOKIE, token, {
              httpOnly: true,
              secure: config.nodeEnv === 'production',
              sameSite: config.nodeEnv === 'production' ? 'none' : 'strict',
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
          sameSite: config.nodeEnv === 'production' ? 'none' : 'strict',
          secure: config.nodeEnv === 'production',
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
          logger.error({ event: 'admin_projects_fetch_failed', errorCode: 'DATABASE_UNAVAILABLE' });
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
          await media.saveProjectMedia({ title: title.trim(), title_id: title_id.trim(), description: description.trim(), description_id: description_id.trim(), url: url?.trim() || null, image_url: image_url?.trim() || null, full_width: full_width ? 1 : 0 }, contentDependencies);
          res.json({ ok: true });
      } catch (err) {
          logger.error({ event: 'admin_project_create_failed', errorCode: 'INTERNAL_ERROR' });
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
          await media.saveProjectMedia({ id, title: title.trim(), title_id: title_id.trim(), description: description.trim(), description_id: description_id.trim(), url: url?.trim() || null, image_url: image_url?.trim() || null, full_width: full_width ? 1 : 0 }, contentDependencies);
          res.json({ ok: true });
      } catch (err) {
          logger.error({ event: 'admin_project_update_failed', errorCode: 'INTERNAL_ERROR' });
          res.status(500).json({ error: 'Failed to update project.' });
      }
  });

  app.delete('/api/admin/projects/:id', authMiddleware, adminCsrfMiddleware, async (req, res) => {
      try {
          const id = parseId(req.params.id);
          if (!id) return res.status(400).json({ error: 'Invalid project ID.' });
          await media.deleteProjectWithMedia(id, contentDependencies);
          res.json({ ok: true });
      } catch (err) {
          logger.error({ event: 'admin_project_delete_failed', errorCode: 'DATABASE_UNAVAILABLE' });
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
          logger.error({ event: 'admin_project_move_failed', errorCode: 'DATABASE_UNAVAILABLE' });
          res.status(500).json({ error: 'Failed to move project.' });
      }
  });


  app.get('/api/admin/experience', authMiddleware, async (req, res) => {
      try {
          const [rows] = await adminQuery('SELECT id, company, role, role_id, date_range, description, description_id, logo_url, logo_url_fallback, url, sort_order FROM experience ORDER BY sort_order ASC, id ASC');
          res.json(rows);
      } catch (err) {
          logger.error({ event: 'admin_experience_fetch_failed', errorCode: 'DATABASE_UNAVAILABLE' });
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
          await media.saveExperienceMedia({ company: company.trim(), role: role.trim(), role_id: role_id.trim(), date_range: date_range.trim(), description: description.trim(), description_id: description_id.trim(), logo_url: logo_url?.trim() || null, url: url?.trim() || null }, contentDependencies);
          res.json({ ok: true });
      } catch (err) {
          logger.error({ event: 'admin_experience_create_failed', errorCode: 'INTERNAL_ERROR' });
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
          await media.saveExperienceMedia({ id, company: company.trim(), role: role.trim(), role_id: role_id.trim(), date_range: date_range.trim(), description: description.trim(), description_id: description_id.trim(), logo_url: logo_url?.trim() || null, url: url?.trim() || null }, contentDependencies);
          res.json({ ok: true });
      } catch (err) {
          logger.error({ event: 'admin_experience_update_failed', errorCode: 'INTERNAL_ERROR' });
          res.status(500).json({ error: 'Failed to update experience entry.' });
      }
  });

  app.delete('/api/admin/experience/:id', authMiddleware, adminCsrfMiddleware, async (req, res) => {
      try {
          const id = parseId(req.params.id);
          if (!id) return res.status(400).json({ error: 'Invalid experience ID.' });
          await media.deleteExperienceWithMedia(id, contentDependencies);
          res.json({ ok: true });
      } catch (err) {
          logger.error({ event: 'admin_experience_delete_failed', errorCode: 'DATABASE_UNAVAILABLE' });
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
          logger.error({ event: 'admin_experience_move_failed', errorCode: 'DATABASE_UNAVAILABLE' });
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
      logger.error({ event: 'unhandled_error', errorCode: 'INTERNAL_ERROR' });
      res.status(500).json({ error: 'Internal Server Error' });
  });


  return app;
}

module.exports = { createApp };
