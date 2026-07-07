const PUBLIC_ORIGINS = Object.freeze([
    'https://arraffi.com',
    'https://www.arraffi.com',
]);

const DEV_ORIGINS = Object.freeze([
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5501',
    'http://127.0.0.1:5501',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
]);

const SAFE_REGISTER_ERRORS = new Set([
    'Avatar must be a JPG, PNG, or WebP image.',
    'Avatar must be 2MB or smaller.',
    'Avatar file is not valid.',
    'Avatar file is not a valid image.',
]);

function allowedOriginsForEnv(nodeEnv) {
    return nodeEnv === 'production' ? [...PUBLIC_ORIGINS] : [...PUBLIC_ORIGINS, ...DEV_ORIGINS];
}

function adminOriginsForEnv(nodeEnv) {
    return nodeEnv === 'production' ? [...PUBLIC_ORIGINS] : [...PUBLIC_ORIGINS, ...DEV_ORIGINS];
}

function isAllowedAdminOrigin(origin, nodeEnv) {
    return Boolean(origin && adminOriginsForEnv(nodeEnv).includes(origin));
}

function clientSafeRegisterError(err) {
    const message = String(err?.message || '');
    return SAFE_REGISTER_ERRORS.has(message) ? message : 'Could not create account.';
}

function shouldRequireRegisterTurnstile(nodeEnv, isLocal) {
    return !(nodeEnv !== 'production' && isLocal);
}

module.exports = {
    PUBLIC_ORIGINS,
    DEV_ORIGINS,
    allowedOriginsForEnv,
    adminOriginsForEnv,
    isAllowedAdminOrigin,
    clientSafeRegisterError,
    shouldRequireRegisterTurnstile,
};
