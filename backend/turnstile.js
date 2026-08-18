const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DEFAULT_TIMEOUT_MS = 6000;
const MAX_AGE_MS = 5 * 60 * 1000;

function providerErrorCode(errorCodes) {
  const codes = new Set(Array.isArray(errorCodes) ? errorCodes : []);
  if (codes.has('timeout-or-duplicate')) return 'TURNSTILE_EXPIRED';
  if (codes.has('internal-error') || codes.has('missing-input-secret') || codes.has('invalid-input-secret')) {
    return 'TURNSTILE_UNAVAILABLE';
  }
  return 'TURNSTILE_INVALID';
}

function createTurnstileVerifier(config, fetchImpl = fetch) {
  const secret = String(config.turnstileSecret || '');
  const hostnames = new Set(config.turnstileHostnames || []);
  const timeoutMs = Math.min(config.turnstileTimeoutMs || DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const now = config.turnstileNow || Date.now;

  async function verifyDetailed({ token, expectedAction, remoteIp = '' }) {
    if (!token || typeof token !== 'string') return { ok: false, code: 'TURNSTILE_REQUIRED' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', String(remoteIp));

    try {
      const response = await fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, code: 'TURNSTILE_UNAVAILABLE' };

      const data = await response.json();
      if (!data || data.success !== true) {
        return { ok: false, code: providerErrorCode(data?.['error-codes']) };
      }
      if (!hostnames.has(data.hostname)) return { ok: false, code: 'TURNSTILE_HOSTNAME_MISMATCH' };
      if (data.action !== expectedAction) return { ok: false, code: 'TURNSTILE_ACTION_MISMATCH' };

      const challengeTime = Date.parse(data.challenge_ts);
      if (!Number.isFinite(challengeTime)) return { ok: false, code: 'TURNSTILE_TIMESTAMP_INVALID' };
      const age = now() - challengeTime;
      if (age < 0) return { ok: false, code: 'TURNSTILE_TIMESTAMP_FUTURE' };
      if (age > MAX_AGE_MS) return { ok: false, code: 'TURNSTILE_EXPIRED' };
      return { ok: true, code: 'TURNSTILE_OK' };
    } catch {
      return { ok: false, code: 'TURNSTILE_UNAVAILABLE' };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function verify(input) {
    return (await verifyDetailed(input)).ok;
  }

  return { verify, verifyDetailed };
}

module.exports = { createTurnstileVerifier };
