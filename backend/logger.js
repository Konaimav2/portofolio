const crypto = require('node:crypto');

const MAX_ROUTE_LENGTH = 200;
const MAX_REQUEST_ID_LENGTH = 128;

function bounded(value, maximum) {
  return String(value ?? '').slice(0, maximum);
}

function errorCode(value) {
  const code = String(value || '');
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : '';
}

function lifecycleFields(value = {}) {
  const fields = {};
  if (value.component) fields.component = bounded(value.component, 40);
  if (value.nodeEnv) fields.nodeEnv = bounded(value.nodeEnv, 20);
  if (Number.isSafeInteger(value.port) && value.port > 0 && value.port <= 65535) fields.port = value.port;
  if (typeof value.tls === 'boolean') fields.tls = value.tls;
  if (typeof value.r2 === 'boolean') fields.r2 = value.r2;
  if (typeof value.turnstile === 'boolean') fields.turnstile = value.turnstile;
  if (typeof value.telegram === 'boolean') fields.telegram = value.telegram;
  if (value.action) fields.action = bounded(value.action, 40);
  if (value.entity) fields.entity = bounded(value.entity, 40);
  if (Number.isSafeInteger(value.entityId) && value.entityId > 0) fields.entityId = value.entityId;
  if (value.durationMs !== undefined) fields.durationMs = Math.max(0, Math.round(Number(value.durationMs) || 0));
  return fields;
}

function createLogger(write = entry => console.log(JSON.stringify(entry)), {
  clock = () => new Date(),
  randomUUID = crypto.randomUUID,
} = {}) {
  return {
    info(value = {}) {
      write({
        timestamp: clock().toISOString(),
        level: 'info',
        event: bounded(value.event || 'application_event', 80),
        ...lifecycleFields(value),
      });
    },
    request(value = {}) {
      const requestErrorCode = errorCode(value.errorCode);
      write({
        timestamp: clock().toISOString(),
        requestId: bounded(value.requestId || randomUUID(), MAX_REQUEST_ID_LENGTH),
        method: bounded(value.method, 16),
        route: bounded(String(value.route || '').split('?')[0], MAX_ROUTE_LENGTH),
        status: Number(value.status) || 0,
        durationMs: Math.max(0, Math.round(Number(value.durationMs) || 0)),
        ...(requestErrorCode ? { errorCode: requestErrorCode } : {}),
      });
    },
    error(value = {}) {
      const loggedErrorCode = errorCode(value.errorCode);
      write({
        timestamp: clock().toISOString(),
        level: 'error',
        event: bounded(value.event || 'application_error', 80),
        ...lifecycleFields(value),
        ...(loggedErrorCode ? { errorCode: loggedErrorCode } : {}),
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
