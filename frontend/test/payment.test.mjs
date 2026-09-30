import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../payment.js', import.meta.url), 'utf8').catch(() => '');
const CANONICAL_URL = 'https://arraffi.com/payment/';

function loadPayment(navigatorObject = {}) {
    const context = {
        window: {
            navigator: navigatorObject,
            location: { href: CANONICAL_URL },
        },
        navigator: navigatorObject,
        document: undefined,
        Promise,
        Error,
        DOMException,
    };
    context.window.window = context.window;
    vm.runInNewContext(source, context);
    return context.window.PortfolioPayment;
}

test('native share receives only canonical payment data', async () => {
    let payload;
    const payment = loadPayment({ share: async value => { payload = value; } });

    const result = await payment.sharePaymentLink({
        navigatorObject: { share: async value => { payload = value; } },
        url: CANONICAL_URL,
        title: 'Pay Arraffi with QRIS',
        text: 'Open ArraffiPay QRIS for an agreed client payment.',
    });

    assert.equal(payload.url, CANONICAL_URL);
    assert.equal(payload.title, 'Pay Arraffi with QRIS');
    assert.equal(payload.text, 'Open ArraffiPay QRIS for an agreed client payment.');
    assert.equal(result.outcome, 'shared');
    assert.equal(result.message, '');
    assert.equal(payload.url.includes('?'), false);
});

test('native share cancellation is neutral', async () => {
    const payment = loadPayment();
    const cancelled = Object.assign(new Error('cancelled'), { name: 'AbortError' });

    const result = await payment.sharePaymentLink({
        navigatorObject: { share: async () => { throw cancelled; } },
        url: CANONICAL_URL,
        title: 'Pay Arraffi with QRIS',
        text: 'Open ArraffiPay QRIS for an agreed client payment.',
    });

    assert.equal(result.outcome, 'cancelled');
    assert.equal(result.message, '');
});

test('missing native share copies the canonical URL', async () => {
    let copied = '';
    const payment = loadPayment();

    const result = await payment.sharePaymentLink({
        navigatorObject: { clipboard: { writeText: async value => { copied = value; } } },
        url: CANONICAL_URL,
        title: 'Pay Arraffi with QRIS',
        text: 'Open ArraffiPay QRIS for an agreed client payment.',
    });

    assert.equal(copied, CANONICAL_URL);
    assert.equal(result.outcome, 'copied');
    assert.equal(result.message, 'Payment link copied.');
});

test('native share failure falls back to clipboard', async () => {
    let copied = '';
    const payment = loadPayment();

    const result = await payment.sharePaymentLink({
        navigatorObject: {
            share: async () => { throw new Error('share unavailable'); },
            clipboard: { writeText: async value => { copied = value; } },
        },
        url: CANONICAL_URL,
        title: 'Pay Arraffi with QRIS',
        text: 'Open ArraffiPay QRIS for an agreed client payment.',
    });

    assert.equal(copied, CANONICAL_URL);
    assert.equal(result.outcome, 'copied');
    assert.equal(result.message, 'Payment link copied.');
});

test('clipboard failure returns the address-bar fallback', async () => {
    const payment = loadPayment();

    const result = await payment.sharePaymentLink({
        navigatorObject: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
        url: CANONICAL_URL,
        title: 'Pay Arraffi with QRIS',
        text: 'Open ArraffiPay QRIS for an agreed client payment.',
    });

    assert.equal(result.outcome, 'manual');
    assert.equal(result.message, 'Could not copy the link. Copy it from the address bar.');
});
