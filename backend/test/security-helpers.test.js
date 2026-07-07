const test = require('node:test');
const assert = require('node:assert/strict');

const {
  adminOriginsForEnv,
  isAllowedAdminOrigin,
  clientSafeRegisterError,
  shouldRequireRegisterTurnstile,
} = require('../security-helpers');

test('production admin origins exclude localhost dev origins', () => {
  const origins = adminOriginsForEnv('production');
  assert.deepEqual(origins, ['https://arraffi.com', 'https://www.arraffi.com']);
});

test('production admin origin rejects localhost even if dev CORS allows it', () => {
  assert.equal(isAllowedAdminOrigin('http://localhost:5500', 'production'), false);
  assert.equal(isAllowedAdminOrigin('https://arraffi.com', 'production'), true);
});

test('development admin origin can use localhost', () => {
  assert.equal(isAllowedAdminOrigin('http://localhost:5500', 'development'), true);
});

test('registration errors expose only known validation messages', () => {
  assert.equal(clientSafeRegisterError(new Error('Avatar must be 2MB or smaller.')), 'Avatar must be 2MB or smaller.');
  assert.equal(clientSafeRegisterError(new Error('S3 request failed for bucket secret-bucket')), 'Could not create account.');
});

test('comment registration requires Turnstile outside local development', () => {
  assert.equal(shouldRequireRegisterTurnstile('production', false), true);
  assert.equal(shouldRequireRegisterTurnstile('development', false), true);
  assert.equal(shouldRequireRegisterTurnstile('development', true), false);
});
