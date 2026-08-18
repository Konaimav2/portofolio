(function () {
    const key = 'arraffi-theme';
    let stored = '';
    try { stored = localStorage.getItem(key) || ''; } catch {}
    const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = stored === 'light' || stored === 'dark'
        ? stored
        : prefersDark ? 'dark' : 'light';
})();
