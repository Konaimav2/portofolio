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

function fakeClassList() {
    return {
        add() {},
        remove() {},
        toggle() {},
    };
}

function fakeElement(overrides = {}) {
    const listeners = new Map();
    const element = {
        hidden: false,
        disabled: false,
        complete: false,
        naturalWidth: 0,
        naturalHeight: 0,
        offsetWidth: 0,
        offsetHeight: 0,
        clientWidth: 0,
        clientHeight: 0,
        open: false,
        style: {
            setProperty() {},
        },
        classList: fakeClassList(),
        addEventListener(type, listener) {
            listeners.set(type, listener);
        },
        dispatchEvent(event) {
            if (!event.target) event.target = this;
            listeners.get(event.type)?.(event);
            return true;
        },
        getBoundingClientRect() {
            return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
        },
        setPointerCapture() {},
        showModal() {
            this.open = true;
        },
        close() {
            this.open = false;
            listeners.get('close')?.({ target: this });
        },
        focus() {},
        ...overrides,
    };
    return element;
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

test('viewer scale stays between fit and three-times zoom', () => {
    const payment = loadPayment();
    assert.equal(payment.clampViewerScale(0.5), 1);
    assert.equal(payment.clampViewerScale(1.75), 1.75);
    assert.equal(payment.clampViewerScale(3.5), 3);
    assert.equal(payment.clampViewerScale(Number.NaN), 1);
});

test('viewer toolbar zoom steps by twenty-five percent without overshoot', () => {
    const payment = loadPayment();
    assert.equal(payment.stepViewerScale(1, 1), 1.25);
    assert.equal(payment.stepViewerScale(1.25, -1), 1);
    assert.equal(payment.stepViewerScale(2.9, 1), 3);
    assert.equal(payment.stepViewerScale(1, -1), 1);
});

test('viewer wheel delta normalizes pixel, line, and page modes', () => {
    const payment = loadPayment();
    assert.equal(payment.normalizeViewerWheelDelta(120, 0, 600), 120);
    assert.equal(payment.normalizeViewerWheelDelta(3, 1, 600), 48);
    assert.equal(payment.normalizeViewerWheelDelta(-3, 1, 600), -48);
    assert.equal(payment.normalizeViewerWheelDelta(1, 2, 600), 240);
    assert.equal(payment.normalizeViewerWheelDelta(Number.NaN, 0, 600), 0);
});

test('viewer fit size keeps a portrait image inside a landscape stage', () => {
    const payment = loadPayment();
    const size = payment.viewerFitSize(1136, 1600, 1440, 784, 32);
    assert.ok(Math.abs(size.width - 533.92) < 0.000001);
    assert.equal(size.height, 752);
});

test('viewer fit size never enlarges beyond the natural image dimensions', () => {
    const payment = loadPayment();
    const size = payment.viewerFitSize(300, 200, 1000, 800, 32);
    assert.equal(size.width, 300);
    assert.equal(size.height, 200);
});

test('viewer fit size safely collapses invalid geometry', () => {
    const payment = loadPayment();
    const invalidImage = payment.viewerFitSize(0, 1600, 1440, 784, 32);
    const invalidStage = payment.viewerFitSize(1136, 1600, 0, 784, 32);
    assert.equal(invalidImage.width, 0);
    assert.equal(invalidImage.height, 0);
    assert.equal(invalidStage.width, 0);
    assert.equal(invalidStage.height, 0);
});

test('viewer pan bounds use the scaled portrait image dimensions', () => {
    const payment = loadPayment();
    const bounds = payment.viewerPanBounds(300, 500, 400, 600, 2);
    assert.equal(bounds.maxX, 100);
    assert.equal(bounds.maxY, 200);
});

test('viewer pan clamps independently on both axes', () => {
    const payment = loadPayment();
    const pan = payment.clampViewerPan({ x: 140, y: -250 }, { maxX: 100, maxY: 200 });
    assert.equal(pan.x, 100);
    assert.equal(pan.y, -200);
});

test('viewer reset returns to centered fit state', () => {
    const payment = loadPayment();
    const state = payment.nextViewerTransform(
        { scale: 2, panX: 80, panY: -40 },
        { type: 'reset' },
        {}
    );
    assert.equal(state.scale, 1);
    assert.equal(state.panX, 0);
    assert.equal(state.panY, 0);
});

test('zooming out reclamps pan to the new image bounds', () => {
    const payment = loadPayment();
    const state = payment.nextViewerTransform(
        { scale: 3, panX: 250, panY: 400 },
        { type: 'zoom-to', scale: 2 },
        { baseWidth: 300, baseHeight: 500, stageWidth: 400, stageHeight: 600 }
    );
    assert.equal(state.scale, 2);
    assert.equal(state.panX, 100);
    assert.equal(state.panY, 200);
});

test('viewer quick zoom toggles between fit and two-times zoom', () => {
    const payment = loadPayment();
    const geometry = { baseWidth: 300, baseHeight: 500, stageWidth: 400, stageHeight: 600 };
    const zoomed = payment.nextViewerTransform(
        { scale: 1, panX: 0, panY: 0 },
        { type: 'zoom-to', scale: 2 },
        geometry
    );
    const fitted = payment.nextViewerTransform(zoomed, { type: 'reset' }, geometry);
    assert.equal(zoomed.scale, 2);
    assert.equal(zoomed.panX, 0);
    assert.equal(zoomed.panY, 0);
    assert.equal(fitted.scale, 1);
    assert.equal(fitted.panX, 0);
    assert.equal(fitted.panY, 0);
});

test('viewer stage close requires a stationary background click at any zoom', () => {
    const payment = loadPayment();
    assert.equal(payment.shouldCloseViewerStage({ targetIsStage: true, scale: 1, gestureMoved: false }), true);
    assert.equal(payment.shouldCloseViewerStage({ targetIsStage: true, scale: 1, gestureMoved: true }), false);
    assert.equal(payment.shouldCloseViewerStage({ targetIsStage: true, scale: 2, gestureMoved: false }), true);
    assert.equal(payment.shouldCloseViewerStage({ targetIsStage: false, scale: 1, gestureMoved: false }), false);
});

test('viewer initializes an already-failed full-resolution image into recovery state', () => {
    const payment = loadPayment();
    const dialog = fakeElement();
    const stage = fakeElement({ clientWidth: 400, clientHeight: 600 });
    const image = fakeElement({ complete: true, naturalWidth: 0, naturalHeight: 0 });
    const error = fakeElement({ hidden: true });
    const zoomOut = fakeElement();
    const zoomIn = fakeElement();
    const reset = fakeElement();
    const close = fakeElement();
    const zoom = fakeElement({ textContent: '100%' });
    const pageImage = fakeElement();
    const trigger = fakeElement();
    const nodes = new Map([
        ['payment-viewer', dialog],
        ['payment-viewer-stage', stage],
        ['payment-viewer-image', image],
        ['payment-viewer-error', error],
        ['payment-viewer-zoom-out', zoomOut],
        ['payment-viewer-zoom', zoom],
        ['payment-viewer-zoom-in', zoomIn],
        ['payment-viewer-reset', reset],
        ['payment-viewer-close', close],
        ['payment-qr', pageImage],
    ]);
    const documentObject = {
        body: { classList: fakeClassList() },
        getElementById(id) { return nodes.get(id) || null; },
        querySelectorAll() { return [trigger]; },
    };

    payment.initPaymentViewer({ documentObject, windowObject: { addEventListener() {} } });

    assert.equal(image.hidden, true);
    assert.equal(error.hidden, false);
    assert.equal(zoomIn.disabled, true);
    assert.equal(zoomOut.disabled, true);
    assert.equal(reset.disabled, true);
});

test('payment page initializes an already-failed QR image into recovery state', () => {
    const payment = loadPayment();
    const qr = fakeElement({ complete: true, naturalWidth: 0 });
    const unavailable = fakeElement({ hidden: true });
    const nodes = new Map([
        ['payment-qr', qr],
        ['payment-qr-unavailable', unavailable],
    ]);
    const documentObject = {
        getElementById(id) { return nodes.get(id) || null; },
        querySelectorAll() { return []; },
    };

    payment.initPaymentPage({ documentObject, navigatorObject: {}, windowObject: {} });

    assert.equal(qr.hidden, true);
    assert.equal(unavailable.hidden, false);
});

function createViewerControllerHarness(payment) {
    const dialog = fakeElement();
    const stage = fakeElement({ clientWidth: 400, clientHeight: 600 });
    const image = fakeElement({ complete: true, naturalWidth: 1136, naturalHeight: 1600 });
    const error = fakeElement({ hidden: true });
    const zoomOut = fakeElement();
    const zoomIn = fakeElement();
    const reset = fakeElement();
    const close = fakeElement();
    const zoom = fakeElement({ textContent: '100%' });
    const pageImage = fakeElement({ complete: true, naturalWidth: 1136, naturalHeight: 1600 });
    const trigger = fakeElement();
    const nodes = new Map([
        ['payment-viewer', dialog],
        ['payment-viewer-stage', stage],
        ['payment-viewer-image', image],
        ['payment-viewer-error', error],
        ['payment-viewer-zoom-out', zoomOut],
        ['payment-viewer-zoom', zoom],
        ['payment-viewer-zoom-in', zoomIn],
        ['payment-viewer-reset', reset],
        ['payment-viewer-close', close],
        ['payment-qr', pageImage],
    ]);
    const documentObject = {
        body: { classList: fakeClassList() },
        getElementById(id) { return nodes.get(id) || null; },
        querySelectorAll() { return [trigger]; },
    };
    payment.initPaymentViewer({ documentObject, windowObject: { addEventListener() {} } });
    const pointer = (type, pointerId) => ({
        type,
        pointerId,
        pointerType: 'touch',
        button: 0,
        clientX: 200,
        clientY: 300,
        preventDefault() {},
    });
    const tap = pointerId => {
        stage.dispatchEvent(pointer('pointerdown', pointerId));
        stage.dispatchEvent(pointer('pointerup', pointerId));
    };
    return { close, dialog, stage, tap, trigger, zoom };
}

test('cancelled touch cannot seed a viewer double-tap', () => {
    const payment = loadPayment();
    const { stage, tap, trigger, zoom } = createViewerControllerHarness(payment);
    trigger.dispatchEvent({ type: 'click', preventDefault() {} });
    stage.dispatchEvent({
        type: 'pointerdown',
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        clientX: 200,
        clientY: 300,
        preventDefault() {},
    });
    stage.dispatchEvent({
        type: 'pointercancel',
        pointerId: 1,
        pointerType: 'touch',
        clientX: 200,
        clientY: 300,
    });
    tap(2);
    assert.equal(zoom.textContent, '100%');
});

test('viewer tap state resets across close and reopen', () => {
    const payment = loadPayment();
    const { close, tap, trigger, zoom } = createViewerControllerHarness(payment);
    trigger.dispatchEvent({ type: 'click', preventDefault() {} });
    tap(1);
    close.dispatchEvent({ type: 'click' });
    trigger.dispatchEvent({ type: 'click', preventDefault() {} });
    tap(2);
    assert.equal(zoom.textContent, '100%');
});

test('payment client exposes the progressive viewer initializer', () => {
    const payment = loadPayment();
    assert.equal(typeof payment.initPaymentViewer, 'function');
});
