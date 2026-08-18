const ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  SESSION_EXPIRED: 401,
  ORIGIN_FORBIDDEN: 403,
  CSRF_INVALID: 403,
  TURNSTILE_REQUIRED: 422,
  TURNSTILE_FAILED: 403,
  RATE_LIMITED: 429,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  REQUEST_TIMEOUT: 504,
  DATABASE_UNAVAILABLE: 503,
  STORAGE_UNAVAILABLE: 503,
  MALFORMED_JSON: 400,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
});

function sendError(res, statusOrCode, codeOrDetails, details) {
  const explicitStatus = typeof statusOrCode === 'number';
  const requestedCode = explicitStatus ? codeOrDetails : statusOrCode;
  const code = ERROR_CODES[requestedCode] ? requestedCode : 'INTERNAL_ERROR';
  const status = explicitStatus ? statusOrCode : ERROR_CODES[code];
  const errorDetails = explicitStatus ? details : codeOrDetails;
  res.locals.errorCode = code;
  return res.status(status).json(errorDetails === undefined ? { error: code } : { error: code, details: errorDetails });
}

module.exports = { ERROR_CODES, sendError };
