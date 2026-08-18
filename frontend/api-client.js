(function (global) {
    async function fetchJSON(url, options = {}, timeoutMs = 5000, retries = 0) {
        const method = String(options.method || 'GET').toUpperCase();
        const callerSignal = options.signal;
        const startedAt = Date.now();
        let lastError;

        for (let attempt = 0; attempt <= retries; attempt += 1) {
            if (callerSignal?.aborted) throw callerSignal.reason || new DOMException('Aborted', 'AbortError');
            const remaining = timeoutMs - (Date.now() - startedAt);
            if (remaining <= 0) throw lastError;
            const controller = new AbortController();
            const abortFromCaller = () => controller.abort(callerSignal.reason);
            callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
            const attemptsLeft = retries - attempt + 1;
            const timeout = setTimeout(() => controller.abort(), Math.ceil(remaining / attemptsLeft));
            try {
                const response = await fetch(url, { ...options, signal: controller.signal });
                const json = await response.json().catch(() => null);
                if (!response.ok) {
                    const error = new Error(json?.error || `HTTP ${response.status}`);
                    error.status = response.status;
                    throw error;
                }
                return json;
            } catch (error) {
                lastError = error;
                const status = Number(error?.status);
                const retryable = method === 'GET'
                    && !callerSignal?.aborted
                    && attempt < retries
                    && (error?.name === 'AbortError' || !Number.isInteger(status) || status >= 500);
                if (!retryable) throw error;
            } finally {
                clearTimeout(timeout);
                callerSignal?.removeEventListener('abort', abortFromCaller);
            }
        }

        throw lastError;
    }

    global.PortfolioAPI = Object.freeze({ fetchJSON });
})(window);
