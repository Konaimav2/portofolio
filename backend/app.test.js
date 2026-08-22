const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { createApp } = require('./app');

function testConfig() {
  return {
    production: false,
    nodeEnv: 'test',
    publicOrigins: [],
    adminOrigins: [],
    turnstileSecret: 'test-secret',
    turnstileHostnames: ['localhost'],
    adminPassword: 'test-admin-password',
    telegram: null,
    r2: null,
    database: { ssl: undefined },
  };
}

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('database readiness and Turnstile rejections emit safe diagnostic events', async () => {
  const entries = [];
  const logger = {
    info: entry => entries.push({ level: 'info', ...entry }),
    error: entry => entries.push({ level: 'error', ...entry }),
    request: entry => entries.push({ level: 'request', ...entry }),
  };
  const pool = {
    query: async () => {
      throw new Error('mysql://user:password@database.internal/portfolio');
    },
  };
  const app = createApp({
    config: testConfig(),
    pool,
    logger,
    turnstileVerifier: async () => false,
  });

  await withServer(app, async baseUrl => {
    const ready = await fetch(`${baseUrl}/readyz`);
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong', turnstile: 'token-must-not-log' }),
    });
    assert.equal(ready.status, 503);
    assert.equal(login.status, 403);
  });

  await new Promise(resolve => setImmediate(resolve));
  const errorEntries = entries.filter(entry => entry.level === 'error');
  assert.equal(Number.isSafeInteger(errorEntries[0]?.durationMs), true);
  assert.deepEqual(errorEntries.map(({ durationMs, ...entry }) => entry), [
    {
      level: 'error',
      event: 'database_readiness_failed',
      component: 'database',
      tls: false,
      errorCode: 'DATABASE_UNAVAILABLE',
    },
    {
      level: 'error',
      event: 'turnstile_rejected',
      component: 'turnstile',
      action: 'admin_login',
      errorCode: 'TURNSTILE_INVALID',
    },
  ]);
  assert.equal(JSON.stringify(entries).includes('token-must-not-log'), false);
  assert.equal(JSON.stringify(entries).includes('mysql://user:password'), false);
});

test('admin project timeout records a safe section diagnostic', async () => {
  const entries = [];
  const logger = {
    info: entry => entries.push({ level: 'info', ...entry }),
    error: entry => entries.push({ level: 'error', ...entry }),
    request: entry => entries.push({ level: 'request', ...entry }),
  };
  const timeout = new Error('query deadline reached');
  timeout.code = 'PROTOCOL_SEQUENCE_TIMEOUT';
  const app = createApp({
    config: testConfig(),
    pool: { query: async () => { throw timeout; } },
    logger,
    turnstileVerifier: async () => true,
  });

  await withServer(app, async baseUrl => {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-admin-password', turnstile: 'test-token' }),
    });
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    assert.equal(login.status, 200);
    assert.ok(cookie);

    const projects = await fetch(`${baseUrl}/api/admin/projects`, { headers: { cookie } });
    assert.equal(projects.status, 500);
  });

  const error = entries.find(entry => entry.event === 'admin_content_load_failed');
  assert.deepEqual({
    level: error?.level,
    component: error?.component,
    entity: error?.entity,
    errorCode: error?.errorCode,
    durationMs: Number.isSafeInteger(error?.durationMs),
  }, {
    level: 'error',
    component: 'database',
    entity: 'projects',
    errorCode: 'DATABASE_TIMEOUT',
    durationMs: true,
  });
  assert.equal(JSON.stringify(entries).includes('query deadline reached'), false);
});

test('API responses disable conditional caching', async () => {
  const app = createApp({
    config: testConfig(),
    pool: { query: async () => [[]] },
    logger: { info: () => {}, error: () => {}, request: () => {} },
    turnstileVerifier: async () => true,
  });

  await withServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/projects`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});
