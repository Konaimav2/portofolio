const fs = require('node:fs');

const VALID_ENVS = new Set(['development', 'test', 'production']);

function required(env, key) {
  const value = String(env[key] ?? '').trim();
  if (!value || value === 'undefined') throw new Error(`${key} is required`);
  return value;
}

function productionValue(env, key) {
  const value = required(env, key);
  if (/replace|change-me|example\.invalid/i.test(value)) {
    throw new Error(`${key} must not be a placeholder`);
  }
  return value;
}

function csv(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function loadConfig(env = process.env, { readFileSync = fs.readFileSync } = {}) {
  const nodeEnv = String(env.NODE_ENV || '').trim();
  if (!VALID_ENVS.has(nodeEnv)) throw new Error('NODE_ENV must be development, test, or production');

  const production = nodeEnv === 'production';
  const adminPassword = required(env, 'ADMIN_PASSWORD');
  const minimumPasswordBytes = production ? 16 : 8;
  const passwordBytes = Buffer.byteLength(adminPassword);
  if (/replace|change-me/i.test(adminPassword) || passwordBytes < minimumPasswordBytes || passwordBytes > 256) {
    throw new Error(`ADMIN_PASSWORD must be ${minimumPasswordBytes}-256 bytes and not a placeholder`);
  }

  const caPath = production ? required(env, 'DB_SSL_CA_FILE') : String(env.DB_SSL_CA_FILE || '').trim();
  let ca;
  if (caPath) {
    try {
      ca = readFileSync(caPath, 'utf8');
    } catch {
      throw new Error('DB_SSL_CA_FILE must point to readable CA material');
    }
  }

  const r2Keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL', 'BUCKET_URL'];
  const r2Values = Object.fromEntries(r2Keys.map(key => [key, String(env[key] || '').trim()]));
  const r2Complete = r2Keys.every(key => r2Values[key]);
  if (production && !r2Complete) {
    throw new Error(`${r2Keys.filter(key => !r2Values[key]).join(', ')} required in production`);
  }
  if (production) r2Keys.forEach(key => productionValue(env, key));

  const turnstileSecret = production ? productionValue(env, 'TURNSTILE_SECRET') : String(env.TURNSTILE_SECRET || '').trim();
  const turnstileHostnames = csv(production ? productionValue(env, 'TURNSTILE_HOSTNAMES') : env.TURNSTILE_HOSTNAMES || 'localhost,127.0.0.1');
  const imageSourceHosts = csv(production ? productionValue(env, 'IMAGE_SOURCE_HOSTS') : env.IMAGE_SOURCE_HOSTS || '');
  const publicOrigins = csv(production ? productionValue(env, 'PUBLIC_ORIGINS') : env.PUBLIC_ORIGINS || 'http://127.0.0.1:5500,http://127.0.0.1:5501');
  const adminOrigins = csv(production ? productionValue(env, 'ADMIN_ORIGINS') : env.ADMIN_ORIGINS || 'http://127.0.0.1:5500,http://127.0.0.1:5501');

  return Object.freeze({
    nodeEnv,
    production,
    port: Number.parseInt(env.PORT, 10) || 3001,
    listenHost: '127.0.0.1',
    adminPassword,
    turnstileSecret,
    turnstileHostnames,
    imageSourceHosts,
    publicOrigins,
    adminOrigins,
    database: {
      uri: production ? productionValue(env, 'DATABASE_URL') : required(env, 'DATABASE_URL'),
      ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
    },
    r2: r2Complete ? {
      accountId: r2Values.R2_ACCOUNT_ID,
      accessKeyId: r2Values.R2_ACCESS_KEY_ID,
      secretAccessKey: r2Values.R2_SECRET_ACCESS_KEY,
      bucket: r2Values.R2_BUCKET,
      publicBaseUrl: r2Values.R2_PUBLIC_URL.replace(/\/$/, ''),
      bucketUrl: r2Values.BUCKET_URL,
    } : null,
  });
}

module.exports = { loadConfig };
