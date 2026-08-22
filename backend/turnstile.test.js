const assert = require('node:assert/strict');
const test = require('node:test');
const { createTurnstileVerifier } = require('./turnstile');

test('local Cloudflare test keys accept verifier responses without hostname or action', async () => {
  const verifier = createTurnstileVerifier({
    turnstileSecret: '1x0000000000000000000000000000000AA',
    turnstileHostnames: ['localhost', '127.0.0.1'],
    turnstileTestMode: true,
    turnstileNow: () => Date.parse('2026-08-20T00:00:01.000Z'),
  }, async () => new Response(JSON.stringify({
    success: true,
    hostname: 'example.com',
    challenge_ts: '2026-08-20T00:00:00.000Z',
  }), { status: 200 }));

  const result = await verifier.verifyDetailed({
    token: 'XXXX.DUMMY.TOKEN.XXXX',
    expectedAction: 'admin_login',
  });

  assert.deepEqual(result, { ok: true, code: 'TURNSTILE_OK' });
});
