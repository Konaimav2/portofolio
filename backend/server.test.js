const assert = require('node:assert/strict');
const test = require('node:test');
const { startServer } = require('./server');

test('startup and shutdown emit safe lifecycle events', async () => {
  const entries = [];
  const logger = {
    info: entry => entries.push({ level: 'info', ...entry }),
    error: entry => entries.push({ level: 'error', ...entry }),
  };
  const pool = { end: async () => {} };
  const server = {
    close: callback => callback(),
    closeAllConnections: () => {},
  };
  const config = {
    nodeEnv: 'production',
    production: true,
    port: 3001,
    listenHost: '127.0.0.1',
    database: { ssl: { ca: 'ca material' } },
    r2: { bucket: 'portfolio' },
    turnstileSecret: 'secret',
    telegram: null,
  };

  const instance = await startServer({
    config,
    pool,
    logger,
    createApp: () => ({}),
    listen: async () => server,
    databaseCheck: async () => true,
    now: () => 1000,
  });
  await new Promise(resolve => setImmediate(resolve));
  await instance.close();

  assert.deepEqual(entries, [
    {
      level: 'info',
      event: 'startup_config_loaded',
      component: 'config',
      nodeEnv: 'production',
      port: 3001,
      tls: true,
      r2: true,
      turnstile: true,
      telegram: false,
    },
    { level: 'info', event: 'database_pool_created', component: 'database', tls: true },
    { level: 'info', event: 'http_listening', component: 'server', port: 3001 },
    { level: 'info', event: 'database_startup_check_succeeded', component: 'database', tls: true, durationMs: 0 },
    { level: 'info', event: 'shutdown_started', component: 'server' },
    { level: 'info', event: 'shutdown_complete', component: 'server' },
  ]);
});

test('shutdown suppresses late startup database check events', async () => {
  const entries = [];
  let finishDatabaseCheck;
  const logger = {
    info: entry => entries.push({ level: 'info', ...entry }),
    error: entry => entries.push({ level: 'error', ...entry }),
  };
  const config = {
    nodeEnv: 'development',
    production: false,
    port: 3001,
    listenHost: '127.0.0.1',
    database: { ssl: undefined },
    r2: null,
    turnstileSecret: 'test-secret',
    telegram: null,
  };
  const instance = await startServer({
    config,
    pool: { end: async () => {} },
    logger,
    createApp: () => ({}),
    listen: async () => ({ close: callback => callback(), closeAllConnections: () => {} }),
    databaseCheck: () => new Promise(resolve => { finishDatabaseCheck = resolve; }),
  });

  await instance.close();
  finishDatabaseCheck(true);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(entries.some(entry => entry.event === 'database_startup_check_succeeded'), false);
  assert.equal(entries.some(entry => entry.event === 'database_startup_check_failed'), false);
});
