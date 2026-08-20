const assert = require('node:assert/strict');
const test = require('node:test');
const { loadConfig } = require('./config');

test('production config accepts legacy R2 environment aliases', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    ADMIN_PASSWORD: 'secure-admin-password',
    DB_SSL_CA_FILE: '/mysql-ca.pem',
    DATABASE_URL: 'mysql://portfolio_user:password@127.0.0.1:3306/portfolio',
    TURNSTILE_SECRET: 'turnstile-secret',
    TURNSTILE_HOSTNAMES: 'arraffi.com',
    IMAGE_SOURCE_HOSTS: 'banquet.arraffi.com',
    PUBLIC_ORIGINS: 'https://arraffi.com',
    ADMIN_ORIGINS: 'https://arraffi.com',
    BUCKET_URL: 'https://account-id.r2.cloudflarestorage.com/portfolio',
    ACCESS_KEY_ID: 'legacy-access-key',
    SECRET_ACCESS_KEY: 'legacy-secret-key',
    R2_URL: 'https://banquet.arraffi.com',
  }, {
    readFileSync: () => 'mysql-ca-content',
  });

  assert.deepEqual(config.r2, {
    bucket: 'portfolio',
    endpoint: 'https://account-id.r2.cloudflarestorage.com',
    publicBaseUrl: 'https://banquet.arraffi.com',
    credentials: {
      accessKeyId: 'legacy-access-key',
      secretAccessKey: 'legacy-secret-key',
    },
  });
});
