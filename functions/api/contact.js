/**
 * Contact form handler — called by worker.js
 * Sends email via SMTP2GO HTTP API
 *
 * Environment variables (set in Cloudflare Worker dashboard → Settings → Variables):
 *   SMTP2GO_API_KEY  — https://app-us.smtp2go.com/sending/apikeys/
 *   TO_EMAIL         — kona@konaima.my.id
 *   FROM_EMAIL       — portfolio@arraffi.my.id
 */

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

// Simple in-memory rate limiter and replay protection (per worker isolate)
const rateLimitMap = new Map();
const usedTickets = new Set();

export async function handleContact(request, env) {
    const origin = request.headers.get('Origin');
    const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

    // ── Parse body ──────────────────────────────────────────────────────────
    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400, headers });
    }

    const { name, email, phone, subject, message, website_url, ticket, turnstile } = body ?? {};

    // ── Turnstile Verification ───────────────────────────────────────────────
    if (!turnstile) {
        return Response.json({ ok: false, error: 'Anti-spam check failed. Please refresh and try again.' }, { status: 403, headers });
    }
    
    const turnstileSecret = env.TURNSTILE_SECRET;
    if (turnstileSecret) {
        const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${encodeURIComponent(turnstileSecret)}&response=${encodeURIComponent(turnstile)}&remoteip=${encodeURIComponent(request.headers.get('CF-Connecting-IP') || '')}`
        });
        const tsOutcome = await tsRes.json();
        if (!tsOutcome.success) {
            return Response.json({ ok: false, error: 'Bot verification failed. Please try again.' }, { status: 403, headers });
        }
    }

    // ── Ticket Anti-Replay ───────────────────────────────────────────────────
    const now = Date.now();
    if (!ticket || typeof ticket !== 'string' || !ticket.includes('_')) {
        return Response.json({ ok: false, error: 'Invalid submission format.' }, { status: 403, headers });
    }
    const [tsStr, rnd] = ticket.split('_');
    const ts = parseInt(tsStr, 36);
    // Must be within last 5 minutes
    if (isNaN(ts) || now - ts > 5 * 60 * 1000 || ts > now + 60000) {
        return Response.json({ ok: false, error: 'Form session expired. Please refresh the page.' }, { status: 403, headers });
    }
    if (usedTickets.has(ticket)) {
        return Response.json({ ok: false, error: 'Duplicate submission blocked.' }, { status: 403, headers });
    }
    usedTickets.add(ticket);

    // ── Honeypot ─────────────────────────────────────────────────────────────
    if (website_url) {
        // Silently drop bot requests to save API usage
        return Response.json({ ok: true, message: "Message sent! I'll get back to you soon." }, { headers });
    }

    // ── Rate Limiting ────────────────────────────────────────────────────────
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitWindow = 60 * 1000; // 1 minute
    const maxRequests = 2; // max 2 requests per minute per IP

    if (ip !== 'unknown') {
        const userRate = rateLimitMap.get(ip) || { count: 0, first: now };
        if (now - userRate.first > rateLimitWindow) {
            userRate.count = 1;
            userRate.first = now;
        } else {
            userRate.count++;
        }
        rateLimitMap.set(ip, userRate);

        if (userRate.count > maxRequests) {
            return Response.json(
                { ok: false, error: 'Too many requests. Please wait a minute before sending another message.' },
                { status: 429, headers }
            );
        }
    }

    // Cleanup memory occasionally
    if (Math.random() < 0.05) {
        for (const [key, val] of rateLimitMap.entries()) {
            if (now - val.first > rateLimitWindow) rateLimitMap.delete(key);
        }
        for (const t of usedTickets) {
            const tTs = parseInt(t.split('_')[0], 36);
            if (now - tTs > 5 * 60 * 1000) usedTickets.delete(t);
        }
    }

    // ── Validate ─────────────────────────────────────────────────────────────
    if (!name?.trim() || !email?.trim() || !message?.trim()) {
        return Response.json(
            { ok: false, error: 'Name, email and message are all required.' },
            { status: 422, headers }
        );
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
        return Response.json(
            { ok: false, error: 'Please enter a valid email address.' },
            { status: 422, headers }
        );
    }

    if (message.length > 2000) {
        return Response.json(
            { ok: false, error: 'Message is too long (max 2000 characters).' },
            { status: 422, headers }
        );
    }

    // ── Send via SMTP2GO ──────────────────────────────────────────────────────
    const apiKey    = env.SMTP2GO_API_KEY;
    const toEmail   = env.TO_EMAIL    ?? 'kona@konaima.my.id';
    const fromEmail = env.FROM_EMAIL  ?? 'portfolio@arraffi.my.id';

    if (!apiKey) {
        console.error('SMTP2GO_API_KEY is not set.');
        return Response.json(
            { ok: false, error: 'Mail service is not configured. Please reach out directly.' },
            { status: 503, headers }
        );
    }

    const res = await fetch('https://api.smtp2go.com/v3/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key:  apiKey,
            to:       [`${escHtml(name)} <${toEmail}>`],
            sender:   `Arraffi Portfolio <${fromEmail}>`,
            reply_to: `${escHtml(name)} <${email}>`,
            subject:  `[Portfolio] New message from ${name}`,
            html_body: `
                <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
                    <h2 style="color:#ff8c42">New contact from arraffi.my.id</h2>
                    <table style="width:100%;border-collapse:collapse">
                        <tr><td style="padding:8px 0;color:#888;width:80px">Name</td><td style="padding:8px 0"><strong>${escHtml(name)}</strong></td></tr>
                        <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${escHtml(email)}">${escHtml(email)}</a></td></tr>
                        ${phone ? `<tr><td style="padding:8px 0;color:#888">Phone</td><td style="padding:8px 0">${escHtml(phone)}</td></tr>` : ''}
                        ${subject ? `<tr><td style="padding:8px 0;color:#888">Subject</td><td style="padding:8px 0">${escHtml(subject)}</td></tr>` : ''}
                    </table>
                    <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
                    <p style="white-space:pre-wrap;line-height:1.6">${escHtml(message)}</p>
                    <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
                    <p style="color:#aaa;font-size:12px">Sent via arraffi.my.id contact form</p>
                </div>
            `,
        }),
    });

    const result = await res.json();

    if (!res.ok || result?.data?.succeeded !== 1) {
        console.error('SMTP2GO error:', JSON.stringify(result));
        return Response.json(
            { ok: false, error: 'Failed to send message. Please try again later.' },
            { status: 502, headers }
        );
    }

    return Response.json({ ok: true, message: "Message sent! I'll get back to you soon." }, { headers });
}

/** Simple HTML escape to prevent injection in the email body */
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
