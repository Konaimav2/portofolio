const assert = require('node:assert/strict');
const test = require('node:test');
const { createLogger } = require('./logger');

test('lifecycle logs retain safe diagnostic fields and omit unknown values', () => {
  const entries = [];
  const logger = createLogger(entry => entries.push(entry), {
    clock: () => new Date('2026-08-20T00:00:00.000Z'),
  });

  logger.info({
    event: 'database_startup_check',
    component: 'database',
    nodeEnv: 'production',
    port: 3001,
    tls: true,
    durationMs: 24.6,
    databaseUrl: 'mysql://user:secret@db.example/portfolio',
    password: 'must-not-log',
  });

  assert.deepEqual(entries, [{
    timestamp: '2026-08-20T00:00:00.000Z',
    level: 'info',
    event: 'database_startup_check',
    component: 'database',
    nodeEnv: 'production',
    port: 3001,
    tls: true,
    durationMs: 25,
  }]);
});

test('error logs reject non-code values', () => {
  const entries = [];
  const logger = createLogger(entry => entries.push(entry), {
    clock: () => new Date('2026-08-20T00:00:00.000Z'),
  });

  logger.error({
    event: 'database_startup_check_failed',
    component: 'database',
    errorCode: 'mysql://portfolio_user:password@database.internal/portfolio',
  });

  assert.deepEqual(entries, [{
    timestamp: '2026-08-20T00:00:00.000Z',
    level: 'error',
    event: 'database_startup_check_failed',
    component: 'database',
  }]);
});
