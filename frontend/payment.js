(function (global) {
    const COPY_SUCCESS = 'Payment link copied.';
    const COPY_FAILURE = 'Could not copy the link. Copy it from the address bar.';

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

    function initPaymentPage({
        documentObject = global.document,
        navigatorObject = global.navigator,
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

        qr?.addEventListener('error', () => {
            qr.hidden = true;
            if (unavailable) unavailable.hidden = false;
        }, { once: true });
    }

    global.PortfolioPayment = Object.freeze({ sharePaymentLink, initPaymentPage });
    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => initPaymentPage(), { once: true });
        } else {
            initPaymentPage();
        }
    }
})(window);
