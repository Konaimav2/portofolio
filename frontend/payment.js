(function (global) {
    const COPY_SUCCESS = 'Payment link copied.';
    const COPY_FAILURE = 'Could not copy the link. Copy it from the address bar.';

    function clampViewerScale(scale, minimum = 1, maximum = 3) {
        const safeMinimum = Number.isFinite(Number(minimum)) ? Number(minimum) : 1;
        const safeMaximum = Number.isFinite(Number(maximum)) ? Math.max(safeMinimum, Number(maximum)) : 3;
        const value = Number(scale);
        if (!Number.isFinite(value)) return safeMinimum;
        return Math.max(safeMinimum, Math.min(safeMaximum, value));
    }

    function stepViewerScale(scale, direction, step = 0.25, minimum = 1, maximum = 3) {
        const safeStep = Number.isFinite(Number(step)) && Number(step) > 0 ? Number(step) : 0.25;
        const delta = Math.sign(Number(direction) || 0) * safeStep;
        return clampViewerScale(clampViewerScale(scale, minimum, maximum) + delta, minimum, maximum);
    }

    function normalizeViewerWheelDelta(deltaY, deltaMode = 0, stageHeight = 0) {
        const value = Number(deltaY);
        if (!Number.isFinite(value)) return 0;
        const mode = Number(deltaMode) || 0;
        const multiplier = mode === 1
            ? 16
            : mode === 2
                ? Math.max(1, Number(stageHeight) || 0)
                : 1;
        return Math.max(-240, Math.min(240, value * multiplier));
    }

    function viewerFitSize(naturalWidth, naturalHeight, stageWidth, stageHeight, inset = 32) {
        const sourceWidth = Math.max(0, Number(naturalWidth) || 0);
        const sourceHeight = Math.max(0, Number(naturalHeight) || 0);
        const safeInset = Math.max(0, Number(inset) || 0);
        const availableWidth = Math.max(0, (Number(stageWidth) || 0) - safeInset);
        const availableHeight = Math.max(0, (Number(stageHeight) || 0) - safeInset);
        if (!sourceWidth || !sourceHeight || !availableWidth || !availableHeight) {
            return { width: 0, height: 0 };
        }
        const ratio = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight, 1);
        return {
            width: sourceWidth * ratio,
            height: sourceHeight * ratio,
        };
    }

    function viewerPanBounds(baseWidth, baseHeight, stageWidth, stageHeight, scale) {
        const safeScale = clampViewerScale(scale);
        const imageWidth = Math.max(0, Number(baseWidth) || 0) * safeScale;
        const imageHeight = Math.max(0, Number(baseHeight) || 0) * safeScale;
        const viewportWidth = Math.max(0, Number(stageWidth) || 0);
        const viewportHeight = Math.max(0, Number(stageHeight) || 0);
        return {
            maxX: Math.max(0, (imageWidth - viewportWidth) / 2),
            maxY: Math.max(0, (imageHeight - viewportHeight) / 2),
        };
    }

    function clampViewerPan({ x, y } = {}, { maxX, maxY } = {}) {
        const horizontal = Math.max(0, Number(maxX) || 0);
        const vertical = Math.max(0, Number(maxY) || 0);
        return {
            x: Math.max(-horizontal, Math.min(horizontal, Number(x) || 0)),
            y: Math.max(-vertical, Math.min(vertical, Number(y) || 0)),
        };
    }

    function shouldCloseViewerStage({ targetIsStage, gestureMoved } = {}) {
        return Boolean(targetIsStage) && !gestureMoved;
    }

    function imageSettlement(image) {
        if (!image?.complete) return 'pending';
        return Number(image.naturalWidth) > 0 ? 'loaded' : 'failed';
    }

    function nextViewerTransform(state = {}, action = {}, geometry = {}) {
        const current = {
            scale: clampViewerScale(state.scale),
            panX: Number(state.panX) || 0,
            panY: Number(state.panY) || 0,
        };
        if (action.type === 'reset') return { scale: 1, panX: 0, panY: 0 };

        let scale = current.scale;
        let panX = current.panX;
        let panY = current.panY;
        if (action.type === 'pan-to') {
            panX = Number(action.x) || 0;
            panY = Number(action.y) || 0;
        } else if (action.type === 'zoom-step' || action.type === 'zoom-to') {
            const nextScale = action.type === 'zoom-step'
                ? stepViewerScale(current.scale, action.direction)
                : clampViewerScale(action.scale);
            const anchorX = Number(action.anchorX) || 0;
            const anchorY = Number(action.anchorY) || 0;
            const contentX = (anchorX - current.panX) / current.scale;
            const contentY = (anchorY - current.panY) / current.scale;
            scale = nextScale;
            panX = anchorX - contentX * scale;
            panY = anchorY - contentY * scale;
        }

        if (scale === 1) return { scale: 1, panX: 0, panY: 0 };
        const bounds = viewerPanBounds(
            geometry.baseWidth,
            geometry.baseHeight,
            geometry.stageWidth,
            geometry.stageHeight,
            scale
        );
        const pan = clampViewerPan({ x: panX, y: panY }, bounds);
        return { scale, panX: pan.x, panY: pan.y };
    }

    async function copyPaymentLink(navigatorObject, url) {
        try {
            if (typeof navigatorObject?.clipboard?.writeText !== 'function') throw new Error('CLIPBOARD_UNAVAILABLE');
            await navigatorObject.clipboard.writeText(url);
            return { outcome: 'copied', message: COPY_SUCCESS };
        } catch {
            return { outcome: 'manual', message: COPY_FAILURE };
        }
    }

    async function sharePaymentLink({ navigatorObject, url, title, text }) {
        if (typeof navigatorObject?.share === 'function') {
            try {
                await navigatorObject.share({ url, title, text });
                return { outcome: 'shared', message: '' };
            } catch (error) {
                if (error?.name === 'AbortError') return { outcome: 'cancelled', message: '' };
            }
        }
        return copyPaymentLink(navigatorObject, url);
    }

    function initPaymentViewer({
        documentObject = global.document,
        windowObject = global,
    } = {}) {
        if (!documentObject) return;
        const dialog = documentObject.getElementById('payment-viewer');
        const stage = documentObject.getElementById('payment-viewer-stage');
        const image = documentObject.getElementById('payment-viewer-image');
        const error = documentObject.getElementById('payment-viewer-error');
        const zoomOut = documentObject.getElementById('payment-viewer-zoom-out');
        const zoomOutput = documentObject.getElementById('payment-viewer-zoom');
        const zoomIn = documentObject.getElementById('payment-viewer-zoom-in');
        const resetButton = documentObject.getElementById('payment-viewer-reset');
        const closeButton = documentObject.getElementById('payment-viewer-close');
        const pageImage = documentObject.getElementById('payment-qr');
        const triggers = [...documentObject.querySelectorAll('[data-payment-viewer-open]')];
        if (!dialog || typeof dialog.showModal !== 'function' || !stage || !image || !zoomOutput || !triggers.length) return;

        let state = { scale: 1, panX: 0, panY: 0 };
        let opener = null;
        let viewerAvailable = true;
        let dragOrigin = null;
        let pinchOrigin = null;
        let gestureStart = null;
        let gestureMoved = false;
        let lastTap = null;
        let baseSize = { width: 0, height: 0 };
        const pointers = new Map();
        const zoomControls = [zoomOut, zoomIn, resetButton].filter(Boolean);

        const geometry = () => ({
            baseWidth: baseSize.width,
            baseHeight: baseSize.height,
            stageWidth: stage.clientWidth,
            stageHeight: stage.clientHeight,
        });
        const render = () => {
            image.style.setProperty('--viewer-scale', String(state.scale));
            image.style.setProperty('--viewer-pan-x', `${state.panX.toFixed(2)}px`);
            image.style.setProperty('--viewer-pan-y', `${state.panY.toFixed(2)}px`);
            zoomOutput.textContent = `${Math.round(state.scale * 100)}%`;
            stage.classList.toggle('is-zoomed', state.scale > 1);
            zoomOut && (zoomOut.disabled = !viewerAvailable || state.scale <= 1);
            zoomIn && (zoomIn.disabled = !viewerAvailable || state.scale >= 3);
            resetButton && (resetButton.disabled = !viewerAvailable || (state.scale === 1 && state.panX === 0 && state.panY === 0));
        };
        const syncBaseSize = () => {
            const size = viewerFitSize(
                image.naturalWidth,
                image.naturalHeight,
                stage.clientWidth,
                stage.clientHeight,
                32
            );
            if (!size.width || !size.height) return false;
            baseSize = size;
            image.style.width = `${size.width}px`;
            image.style.height = `${size.height}px`;
            state = nextViewerTransform(
                state,
                { type: 'pan-to', x: state.panX, y: state.panY },
                geometry()
            );
            render();
            return true;
        };
        const apply = action => {
            state = nextViewerTransform(state, action, geometry());
            render();
        };
        const reset = () => {
            state = nextViewerTransform(state, { type: 'reset' }, geometry());
            pointers.clear();
            dragOrigin = null;
            pinchOrigin = null;
            gestureStart = null;
            gestureMoved = false;
            lastTap = null;
            stage.classList.remove('is-dragging');
            render();
        };
        const close = () => {
            if (dialog.open) dialog.close();
        };
        const stagePoint = event => {
            const rect = stage.getBoundingClientRect();
            return {
                x: event.clientX - (rect.left + rect.width / 2),
                y: event.clientY - (rect.top + rect.height / 2),
            };
        };
        const pointerDistance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
        const pointerMidpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        const beginPinch = () => {
            const [first, second] = [...pointers.values()];
            if (!first || !second) return;
            const midpoint = pointerMidpoint(first, second);
            const rect = stage.getBoundingClientRect();
            const anchorX = midpoint.x - (rect.left + rect.width / 2);
            const anchorY = midpoint.y - (rect.top + rect.height / 2);
            pinchOrigin = {
                distance: Math.max(1, pointerDistance(first, second)),
                scale: state.scale,
                contentX: (anchorX - state.panX) / state.scale,
                contentY: (anchorY - state.panY) / state.scale,
            };
            dragOrigin = null;
        };
        const toggleQuickZoom = (anchorX = 0, anchorY = 0) => {
            apply(state.scale === 1
                ? { type: 'zoom-to', scale: 2, anchorX, anchorY }
                : { type: 'reset' });
        };

        for (const trigger of triggers) {
            trigger.addEventListener('click', event => {
                if (!viewerAvailable) return;
                event.preventDefault();
                opener = trigger;
                image.hidden = false;
                if (error) error.hidden = true;
                reset();
                dialog.showModal();
                documentObject.body.classList.add('payment-viewer-open');
                syncBaseSize();
                windowObject.requestAnimationFrame?.(() => {
                    syncBaseSize();
                    reset();
                    closeButton?.focus();
                });
            });
        }

        zoomOut?.addEventListener('click', () => apply({ type: 'zoom-step', direction: -1 }));
        zoomIn?.addEventListener('click', () => apply({ type: 'zoom-step', direction: 1 }));
        resetButton?.addEventListener('click', reset);
        closeButton?.addEventListener('click', close);
        dialog.addEventListener('close', () => {
            documentObject.body.classList.remove('payment-viewer-open');
            reset();
            const returnTarget = opener;
            opener = null;
            windowObject.requestAnimationFrame?.(() => returnTarget?.focus());
        });
        dialog.addEventListener('click', event => {
            if (event.target === dialog) close();
        });
        stage.addEventListener('click', event => {
            const shouldClose = shouldCloseViewerStage({
                targetIsStage: event.target === stage,
                gestureMoved,
            });
            gestureMoved = false;
            if (shouldClose) close();
        });

        const handleViewerLoad = () => {
            viewerAvailable = true;
            image.hidden = false;
            if (error) error.hidden = true;
            if (!syncBaseSize()) render();
        };
        const handleViewerError = () => {
            viewerAvailable = false;
            image.hidden = true;
            if (error) error.hidden = false;
            zoomControls.forEach(control => { control.disabled = true; });
        };
        const handlePageImageError = () => { viewerAvailable = false; };
        image.addEventListener('load', handleViewerLoad);
        image.addEventListener('error', handleViewerError);
        pageImage?.addEventListener('error', handlePageImageError, { once: true });
        const viewerSettlement = imageSettlement(image);
        if (viewerSettlement === 'loaded') handleViewerLoad();
        if (viewerSettlement === 'failed') handleViewerError();
        if (imageSettlement(pageImage) === 'failed') handlePageImageError();
        image.addEventListener('dragstart', event => event.preventDefault());

        stage.addEventListener('wheel', event => {
            if (!dialog.open || !viewerAvailable) return;
            event.preventDefault();
            const point = stagePoint(event);
            const delta = normalizeViewerWheelDelta(event.deltaY, event.deltaMode, stage.clientHeight);
            const nextScale = clampViewerScale(state.scale * Math.exp(-delta * 0.0015));
            apply({ type: 'zoom-to', scale: nextScale, anchorX: point.x, anchorY: point.y });
        }, { passive: false });
        image.addEventListener('dblclick', event => {
            event.preventDefault();
            const point = stagePoint(event);
            toggleQuickZoom(point.x, point.y);
        });

        stage.addEventListener('pointerdown', event => {
            if (!dialog.open || !viewerAvailable) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            stage.setPointerCapture?.(event.pointerId);
            const clientPoint = { x: event.clientX, y: event.clientY };
            if (pointers.size === 0) {
                gestureStart = clientPoint;
                gestureMoved = false;
            }
            pointers.set(event.pointerId, clientPoint);
            if (pointers.size === 2) {
                beginPinch();
            } else if (state.scale > 1) {
                dragOrigin = { point: stagePoint(event), panX: state.panX, panY: state.panY };
                stage.classList.add('is-dragging');
            }
        });
        stage.addEventListener('pointermove', event => {
            if (!pointers.has(event.pointerId)) return;
            const clientPoint = { x: event.clientX, y: event.clientY };
            pointers.set(event.pointerId, clientPoint);
            if (gestureStart && Math.hypot(clientPoint.x - gestureStart.x, clientPoint.y - gestureStart.y) > 8) gestureMoved = true;
            if (pointers.size >= 2 && pinchOrigin) {
                event.preventDefault();
                const [first, second] = [...pointers.values()];
                const midpoint = pointerMidpoint(first, second);
                const rect = stage.getBoundingClientRect();
                const anchorX = midpoint.x - (rect.left + rect.width / 2);
                const anchorY = midpoint.y - (rect.top + rect.height / 2);
                const scale = clampViewerScale(pinchOrigin.scale * pointerDistance(first, second) / pinchOrigin.distance);
                const panX = anchorX - pinchOrigin.contentX * scale;
                const panY = anchorY - pinchOrigin.contentY * scale;
                state = nextViewerTransform(
                    { scale, panX, panY },
                    { type: 'pan-to', x: panX, y: panY },
                    geometry()
                );
                render();
            } else if (dragOrigin && state.scale > 1) {
                event.preventDefault();
                const point = stagePoint(event);
                apply({
                    type: 'pan-to',
                    x: dragOrigin.panX + point.x - dragOrigin.point.x,
                    y: dragOrigin.panY + point.y - dragOrigin.point.y,
                });
            }
        });
        const endPointer = (event, cancelled = false) => {
            if (!pointers.has(event.pointerId)) return;
            const wasTouchTap = !cancelled && event.pointerType === 'touch' && !gestureMoved && pointers.size === 1;
            const point = { x: event.clientX, y: event.clientY };
            pointers.delete(event.pointerId);
            if (pointers.size < 2) pinchOrigin = null;
            dragOrigin = null;
            stage.classList.remove('is-dragging');
            if (wasTouchTap) {
                const now = Date.now();
                if (lastTap && now - lastTap.time <= 300 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) <= 24) {
                    const anchor = stagePoint(event);
                    toggleQuickZoom(anchor.x, anchor.y);
                    lastTap = null;
                } else {
                    lastTap = { time: now, x: point.x, y: point.y };
                }
            }
            if (!pointers.size) {
                gestureStart = null;
                if (cancelled) gestureMoved = false;
            }
        };
        stage.addEventListener('pointerup', endPointer);
        stage.addEventListener('pointercancel', event => endPointer(event, true));
        windowObject.addEventListener?.('resize', () => {
            if (!syncBaseSize()) render();
        }, { passive: true });

        render();
    }

    function initPaymentPage({
        documentObject = global.document,
        navigatorObject = global.navigator,
        windowObject = global,
    } = {}) {
        if (!documentObject) return;
        const button = documentObject.getElementById('payment-share');
        const status = documentObject.getElementById('payment-share-status');
        const qr = documentObject.getElementById('payment-qr');
        const unavailable = documentObject.getElementById('payment-qr-unavailable');

        if (button) {
            button.textContent = typeof navigatorObject?.share === 'function'
                ? 'Share payment link'
                : 'Copy payment link';
            button.addEventListener('click', async () => {
                button.disabled = true;
                if (status) status.textContent = '';
                try {
                    const result = await sharePaymentLink({
                        navigatorObject,
                        url: 'https://arraffi.com/payment/',
                        title: 'Pay Arraffi with QRIS',
                        text: 'Open ArraffiPay QRIS for an agreed client payment.',
                    });
                    if (status) status.textContent = result.message;
                } finally {
                    button.disabled = false;
                }
            });
        }

        const handleQrError = () => {
            qr.hidden = true;
            if (unavailable) unavailable.hidden = false;
        };
        qr?.addEventListener('error', handleQrError, { once: true });
        if (imageSettlement(qr) === 'failed') handleQrError();
        initPaymentViewer({ documentObject, windowObject });
    }

    global.PortfolioPayment = Object.freeze({
        clampViewerScale,
        stepViewerScale,
        normalizeViewerWheelDelta,
        viewerFitSize,
        viewerPanBounds,
        clampViewerPan,
        shouldCloseViewerStage,
        nextViewerTransform,
        sharePaymentLink,
        initPaymentViewer,
        initPaymentPage,
    });
    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => initPaymentPage(), { once: true });
        } else {
            initPaymentPage();
        }
    }
})(window);
