const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
]);

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function buildR2Config(env = process.env) {
    const bucketUrl = parseBucketUrl(env.BUCKET_URL);
    const accountId = String(env.R2_ACCOUNT_ID || '').trim();
    const accessKeyId = String(env.R2_ACCESS_KEY_ID || env.ACCESS_KEY_ID || '').trim();
    const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || env.SECRET_ACCESS_KEY || '').trim();
    const bucket = String(env.R2_BUCKET || bucketUrl.bucket || '').trim();
    const publicBaseUrl = trimTrailingSlash(env.R2_PUBLIC_URL || env.R2_PUBLIC_BASE_URL || env.R2_URL || '');
    const endpoint = bucketUrl.endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;
    return {
        bucket,
        endpoint,
        publicBaseUrl,
        credentials: { accessKeyId, secretAccessKey },
    };
}

function parseBucketUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return { endpoint: '', bucket: '' };
    try {
        const url = new URL(raw);
        const bucket = url.pathname.split('/').filter(Boolean)[0] || '';
        url.pathname = '';
        url.search = '';
        url.hash = '';
        return { endpoint: trimTrailingSlash(url.toString()), bucket };
    } catch {
        return { endpoint: '', bucket: '' };
    }
}

function createR2Client(config) {
    return new S3Client({
        region: 'auto',
        endpoint: config.endpoint,
        credentials: config.credentials,
        forcePathStyle: true,
    });
}

function publicAvatarUrl(publicBaseUrl, key) {
    const encodedKey = String(key).split('/').map(encodeURIComponent).join('/');
    return `${trimTrailingSlash(publicBaseUrl)}/${encodedKey}`;
}

function avatarKeyFromUrl(avatarUrl, config) {
    if (!avatarUrl || !config?.publicBaseUrl) return '';
    const base = `${trimTrailingSlash(config.publicBaseUrl)}/`;
    if (!String(avatarUrl).startsWith(base)) return '';
    return decodeURIComponent(String(avatarUrl).slice(base.length));
}

function isR2AvatarUrl(avatarUrl, config) {
    return Boolean(avatarKeyFromUrl(avatarUrl, config));
}

function detectImageMime(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    return '';
}

function parseAvatarDataUrl(dataUrl) {
    if (!dataUrl) return null;
    const match = String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('Avatar must be a JPG, PNG, or WebP image.');
    const [, mime, payload] = match;
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length > AVATAR_MAX_BYTES) throw new Error('Avatar must be 2MB or smaller.');
    if (buffer.length < 12) throw new Error('Avatar file is not valid.');
    if (detectImageMime(buffer) !== mime) throw new Error('Avatar file is not a valid image.');
    return { mime, buffer, ext: AVATAR_TYPES.get(mime) };
}

async function saveLocalAvatar(parsed, rootDir = __dirname) {
    const dir = path.join(rootDir, 'uploads/avatars');
    await fs.mkdir(dir, { recursive: true });
    const filename = `${crypto.randomBytes(18).toString('hex')}.${parsed.ext}`;
    await fs.writeFile(path.join(dir, filename), parsed.buffer, { flag: 'wx', mode: 0o644 });
    return `/uploads/avatars/${filename}`;
}

async function saveR2Avatar(parsed, config, client = createR2Client(config)) {
    const key = `avatars/${new Date().toISOString().slice(0, 10)}/${crypto.randomBytes(18).toString('hex')}.${parsed.ext}`;
    await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: parsed.buffer,
        ContentType: parsed.mime,
        CacheControl: 'public, max-age=31536000, immutable',
    }));
    return publicAvatarUrl(config.publicBaseUrl, key);
}

async function saveAvatarDataUrl(dataUrl, options = {}) {
    const parsed = parseAvatarDataUrl(dataUrl);
    if (!parsed) return '';
    const config = options.r2Config === undefined ? buildR2Config() : options.r2Config;
    if (config) return saveR2Avatar(parsed, config, options.r2Client);
    return saveLocalAvatar(parsed, options.rootDir || __dirname);
}

async function deleteLocalAvatar(avatarUrl, rootDir = __dirname) {
    if (!avatarUrl || !String(avatarUrl).startsWith('/uploads/avatars/')) return;
    const filename = path.basename(avatarUrl);
    try { await fs.unlink(path.join(rootDir, 'uploads/avatars', filename)); } catch {}
}

async function deleteR2Avatar(avatarUrl, config, client = createR2Client(config)) {
    const key = avatarKeyFromUrl(avatarUrl, config);
    if (!key) return;
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

async function deleteAvatarUrl(avatarUrl, options = {}) {
    const config = options.r2Config === undefined ? buildR2Config() : options.r2Config;
    if (config && isR2AvatarUrl(avatarUrl, config)) {
        await deleteR2Avatar(avatarUrl, config, options.r2Client);
        return;
    }
    await deleteLocalAvatar(avatarUrl, options.rootDir || __dirname);
}

module.exports = {
    AVATAR_MAX_BYTES,
    AVATAR_TYPES,
    buildR2Config,
    parseBucketUrl,
    publicAvatarUrl,
    avatarKeyFromUrl,
    isR2AvatarUrl,
    detectImageMime,
    parseAvatarDataUrl,
    saveAvatarDataUrl,
    deleteAvatarUrl,
};
