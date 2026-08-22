const { loadConfig } = require('./config');
const { createPool, checkDatabaseReady } = require('./database');
const { createApp } = require('./app');
const { createLogger } = require('./logger');

function startupFailureMessage(error) {
  if (error?.code === 'EADDRINUSE') return 'Server startup failed: port already in use';
  const code = String(error?.code || '');
  return /^[A-Z0-9_]{1,64}$/.test(code) ? `Server startup failed (${code})` : 'Server startup failed';
}

function listen(app, port, host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    const onError = error => reject(error);
    server.once('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

function closeHttpServer(server, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, timeoutMs);
    timeout.unref();
    server.close(finish);
  });
}

async function startServer(options = {}) {
  const logger = options.logger || createLogger();
  const now = options.now || Date.now;
  let config;
  try {
    config = options.config || loadConfig(options.env || process.env);
    if (config.listenHost !== '127.0.0.1') throw new Error('Server listen host must be loopback');
  } catch (error) {
    logger.error({ event: 'startup_config_failed', component: 'config', errorCode: 'CONFIG_INVALID' });
    throw error;
  }

  logger.info({
    event: 'startup_config_loaded',
    component: 'config',
    nodeEnv: config.nodeEnv,
    port: config.port,
    tls: Boolean(config.database.ssl),
    r2: Boolean(config.r2),
    turnstile: Boolean(config.turnstileSecret),
    telegram: Boolean(config.telegram),
  });

  let pool;
  try {
    pool = options.pool || createPool(config);
    logger.info({ event: 'database_pool_created', component: 'database', tls: Boolean(config.database.ssl) });
  } catch (error) {
    logger.error({ event: 'database_pool_create_failed', component: 'database', tls: Boolean(config.database.ssl), errorCode: 'DATABASE_POOL_UNAVAILABLE' });
    throw error;
  }

  const listenForRequests = options.listen || listen;
  const createApplication = options.createApp || createApp;
  const databaseCheck = options.databaseCheck || checkDatabaseReady;
  let server;

  try {
    const app = createApplication({ config, pool, logger, ...(options.dependencies || {}) });
    server = await listenForRequests(app, config.port, config.listenHost);
    logger.info({ event: 'http_listening', component: 'server', port: config.port });

    let shuttingDown = false;
    const checkStartedAt = now();
    void Promise.resolve(databaseCheck(pool, options.startupDatabaseTimeoutMs || 5000, { requireTls: config.production }))
      .then(() => {
        if (shuttingDown) return;
        logger.info({
          event: 'database_startup_check_succeeded',
          component: 'database',
          tls: Boolean(config.database.ssl),
          durationMs: now() - checkStartedAt,
        });
      })
      .catch(() => {
        if (shuttingDown) return;
        logger.error({
          event: 'database_startup_check_failed',
          component: 'database',
          tls: Boolean(config.database.ssl),
          durationMs: now() - checkStartedAt,
          errorCode: 'DATABASE_UNAVAILABLE',
        });
      });

    let closePromise;
    const close = () => {
      if (!closePromise) {
        closePromise = (async () => {
          shuttingDown = true;
          logger.info({ event: 'shutdown_started', component: 'server' });
          try {
            await closeHttpServer(server, options.shutdownTimeoutMs || 10000);
          } finally {
            await pool.end();
          }
          logger.info({ event: 'shutdown_complete', component: 'server' });
        })();
      }
      return closePromise;
    };
    return { app, server, pool, close };
  } catch (error) {
    logger.error({
      event: 'server_startup_failed',
      component: 'server',
      errorCode: error?.code === 'EADDRINUSE' ? 'PORT_IN_USE' : 'SERVER_STARTUP_FAILED',
    });
    if (server) await closeHttpServer(server, options.shutdownTimeoutMs || 10000).catch(() => {});
    await pool.end().catch(() => {});
    throw error;
  }
}

if (require.main === module) {
  const path = require('node:path');
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
  startServer().then(({ close }) => {
    const shutdown = async () => {
      try {
        await close();
        process.exit(0);
      } catch {
        process.exit(1);
      }
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }).catch(error => {
    console.error(startupFailureMessage(error));
    process.exit(1);
  });
}

module.exports = { startServer, startupFailureMessage };
