(function () {
    let loader;
    const widgets = new Map();
    const renders = new Map();
    const versions = new Map();

    function load() {
        if (window.turnstile) return Promise.resolve(window.turnstile);
        if (loader) return loader;
        loader = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('TURNSTILE_UNAVAILABLE'));
            script.onerror = () => reject(new Error('TURNSTILE_UNAVAILABLE'));
            document.head.appendChild(script);
        }).catch(error => {
            loader = undefined;
            throw error;
        });
        return loader;
    }

    function render(containerId, options) {
        if (widgets.has(containerId)) return Promise.resolve(widgets.get(containerId));
        if (renders.has(containerId)) return renders.get(containerId);
        if (!document.getElementById(containerId)) throw new Error('TURNSTILE_CONTAINER_MISSING');
        const version = versions.get(containerId) || 0;
        const pending = load().then(api => {
            const widgetId = api.render(`#${containerId}`, { size: 'flexible', ...options });
            if ((versions.get(containerId) || 0) !== version) {
                api.remove(widgetId);
                throw new Error('TURNSTILE_RENDER_CANCELLED');
            }
            widgets.set(containerId, widgetId);
            return widgetId;
        }).finally(() => renders.delete(containerId));
        renders.set(containerId, pending);
        return pending;
    }

    function getToken(containerId) {
        const widgetId = widgets.get(containerId);
        return widgetId === undefined ? '' : window.turnstile?.getResponse(widgetId) || '';
    }

    function reset(containerId) {
        const widgetId = widgets.get(containerId);
        if (widgetId !== undefined) window.turnstile?.reset(widgetId);
    }

    function remove(containerId) {
        versions.set(containerId, (versions.get(containerId) || 0) + 1);
        const widgetId = widgets.get(containerId);
        if (widgetId !== undefined) window.turnstile?.remove(widgetId);
        widgets.delete(containerId);
    }

    window.PortfolioTurnstile = { render, getToken, reset, remove };
}());
