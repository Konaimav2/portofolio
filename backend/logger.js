const crypto = require('node:crypto');

const MAX_ROUTE_LENGTH = 200;
const MAX_REQUEST_ID_LENGTH = 128;

function bounded(value, maximum) {
  return String(value ?? '').slice(0, maximum);
}

function createLogger(write = entry => console.log(JSON.stringify(entry)), {
  clock = () => new Date(),
  randomUUID = crypto.randomUUID,
} = {}) {
  return {
    request(value = {}) {
      write({
        timestamp: clock().toISOString(),
        requestId: bounded(value.requestId || randomUUID(), MAX_REQUEST_ID_LENGTH),
        method: bounded(value.method, 16),
        route: bounded(String(value.route || '').split('?')[0], MAX_ROUTE_LENGTH),
        status: Number(value.status) || 0,
        durationMs: Math.max(0, Math.round(Number(value.durationMs) || 0)),
        ...(value.errorCode ? { errorCode: bounded(value.errorCode, 64) } : {}),
      });
    },
    error(value = {}) {
      write({
        timestamp: clock().toISOString(),
        level: 'error',
        event: bounded(value.event || 'application_error', 80),
        ...(value.errorCode ? { errorCode: bounded(value.errorCode, 64) } : {}),
      });
    },
  };
}

function routeTemplate(req) {
  return req.route ? `${req.baseUrl || ''}${req.route.path}` : '<unmatched>';
}

function requestLogger(logger = createLogger(), clock = Date.now, randomUUID = crypto.randomUUID) {
  return (req, res, next) => {
    const requestId = randomUUID();
    const startedAt = clock();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    res.once('finish', () => {
      logger.request({
        requestId,
        method: req.method,
        route: routeTemplate(req),
        status: res.statusCode,
        durationMs: clock() - startedAt,
        errorCode: res.locals.errorCode,
      });
    });
    next();
  };
}

module.exports = { createLogger, requestLogger };
