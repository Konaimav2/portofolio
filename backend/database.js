const mysql = require('mysql2/promise');

function createPool(config, mysqlImpl = mysql) {
  return mysqlImpl.createPool({
    uri: config.database.uri,
    ssl: config.database.ssl,
    connectTimeout: 5000,
    waitForConnections: false,
    connectionLimit: 10,
    queueLimit: 20,
  });
}

async function checkDatabaseReady(pool, timeoutMs = 3000, { requireTls = false } = {}) {
  let rows;
  try {
    [rows] = await pool.query({
      sql: "SHOW SESSION STATUS LIKE 'Ssl_cipher'",
      timeout: timeoutMs,
    });
  } catch (error) {
    if (error.code === 'PROTOCOL_SEQUENCE_TIMEOUT') throw new Error('database readiness timeout');
    throw error;
  }
  if (requireTls && !rows[0]?.Value) throw new Error('database TLS inactive');
  return true;
}

module.exports = { createPool, checkDatabaseReady };
