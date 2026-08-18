const { loadConfig } = require('./config');
const { createPool } = require('./database');
const { verifySchemaVersion } = require('./migrate');
const { createApp } = require('./app');
const { createLogger } = require('./logger');

function startupFailureMessage(error) {
  if (error?.message === 'schema version mismatch') {
    return 'Server startup failed: schema migration required (run npm run migrate)';
  }
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
  const config = options.config || loadConfig(options.env || process.env);
  if (config.listenHost !== '127.0.0.1') throw new Error('Server listen host must be loopback');
  const pool = options.pool || createPool(config);
  const verifySchema = options.verifySchema || verifySchemaVersion;
  const listenForRequests = options.listen || listen;
  const logger = options.logger || createLogger();
  let server;

  try {
    await verifySchema(pool);
    const app = createApp({ config, pool, logger, ...(options.dependencies || {}) });
    server = await listenForRequests(app, config.port, config.listenHost);
    let closePromise;
    const close = () => {
      if (!closePromise) {
        closePromise = (async () => {
          try {
            await closeHttpServer(server, options.shutdownTimeoutMs || 10000);
          } finally {
            await pool.end();
          }
        })();
      }
      return closePromise;
    };
    return { app, server, pool, close };
  } catch (error) {
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
