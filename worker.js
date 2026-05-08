/**
 * Cloudflare Worker entry point
 * - POST /api/contact → handles contact form (sends email via SMTP2GO)
 * - Everything else   → served as static assets
 */

import { handleContact } from './functions/api/contact.js';

const ALLOWED_ORIGINS = [
    'https://arraffi.my.id',
    'http://localhost',
    'http://127.0.0.1',
];

function corsHeaders(origin) {
    const allowed = ALLOWED_ORIGINS.some(o => origin?.startsWith(o))
        ? origin
        : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // ── Handle contact API ─────────────────────────────────────────────
        if (url.pathname === '/api/contact') {
            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    status: 204,
                    headers: corsHeaders(request.headers.get('Origin')),
                });
            }
            if (request.method === 'POST') {
                return handleContact(request, env);
            }
            return new Response('Method Not Allowed', { status: 405 });
        }

        // ── Fall through to static assets ──────────────────────────────────
        return env.ASSETS.fetch(request);
    },
};
