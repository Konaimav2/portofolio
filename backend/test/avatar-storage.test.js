const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildR2Config,
  parseBucketUrl,
  publicAvatarUrl,
  isR2AvatarUrl,
  parseAvatarDataUrl,
} = require('../avatar-storage');

test('buildR2Config creates S3-compatible R2 settings from env', () => {
  const config = buildR2Config({
    R2_ACCOUNT_ID: 'abc123',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'portfolio-avatars',
    R2_PUBLIC_URL: 'https://media.example.com/avatars/',
  });

  assert.equal(config.bucket, 'portfolio-avatars');
  assert.equal(config.endpoint, 'https://abc123.r2.cloudflarestorage.com');
  assert.equal(config.publicBaseUrl, 'https://media.example.com/avatars');
  assert.equal(config.credentials.accessKeyId, 'key');
  assert.equal(config.credentials.secretAccessKey, 'secret');
});

test('buildR2Config returns null when R2 env is incomplete', () => {
  assert.equal(buildR2Config({ R2_BUCKET: 'portfolio-avatars' }), null);
});

test('buildR2Config accepts S3 bucket URL and legacy key names', () => {
  const config = buildR2Config({
    BUCKET_URL: 'https://abc123.r2.cloudflarestorage.com/portfolio-avatars',
    ACCESS_KEY_ID: 'key',
    SECRET_ACCESS_KEY: 'secret',
    R2_URL: 'https://media.example.com',
  });

  assert.equal(config.endpoint, 'https://abc123.r2.cloudflarestorage.com');
  assert.equal(config.bucket, 'portfolio-avatars');
  assert.equal(config.credentials.accessKeyId, 'key');
  assert.equal(config.credentials.secretAccessKey, 'secret');
});

test('parseBucketUrl splits endpoint and first path segment bucket', () => {
  assert.deepEqual(
    parseBucketUrl('https://abc123.r2.cloudflarestorage.com/my-bucket/path/ignored'),
    { endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'my-bucket' }
  );
});

test('publicAvatarUrl builds encoded public object URL', () => {
  const url = publicAvatarUrl('https://media.example.com/avatars/', 'avatars/user pic.webp');
  assert.equal(url, 'https://media.example.com/avatars/avatars/user%20pic.webp');
});

test('isR2AvatarUrl only accepts current public base URL', () => {
  const config = buildR2Config({
    R2_ACCOUNT_ID: 'abc123',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'portfolio-avatars',
    R2_PUBLIC_URL: 'https://media.example.com',
  });

  assert.equal(isR2AvatarUrl('https://media.example.com/avatars/a.png', config), true);
  assert.equal(isR2AvatarUrl('https://evil.example.com/avatars/a.png', config), false);
  assert.equal(isR2AvatarUrl('/uploads/avatars/a.png', config), false);
});

test('parseAvatarDataUrl rejects mismatched MIME and magic bytes', () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.throws(
    () => parseAvatarDataUrl(`data:image/jpeg;base64,${pngHeader.toString('base64')}`),
    /valid image/
  );
});

test('parseAvatarDataUrl accepts real PNG header', () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const parsed = parseAvatarDataUrl(`data:image/png;base64,${pngHeader.toString('base64')}`);
  assert.equal(parsed.mime, 'image/png');
  assert.equal(parsed.ext, 'png');
});
