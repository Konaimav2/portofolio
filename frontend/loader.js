(function () {
    const body = document.body;
    const bar = document.getElementById('loader-bar');
    const status = document.getElementById('loader-status');
    if (!body || !bar) return;

    const startedAt = performance.now();
    const minimumMs = 1000;
    const timeoutMs = 6000;
    const images = [...document.querySelectorAll('[data-loader-critical]')];
    let completed = 0;
    let finished = false;

    const update = () => {
        const progress = images.length ? completed / images.length : 1;
        bar.style.setProperty('--loader-progress', Math.round(progress * 100) + '%');
    };

    const settle = () => { completed += 1; update(); };

    const waitForImage = image => image.complete
        ? Promise.resolve()
        : new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
        });

    const reveal = async () => {
        if (finished) return;
        finished = true;
        const remaining = Math.max(0, minimumMs - (performance.now() - startedAt));
        await new Promise(resolve => setTimeout(resolve, remaining));
        bar.style.setProperty('--loader-progress', '100%');
        if (status) status.textContent = 'Ready';
        body.classList.remove('is-loading');
        body.classList.add('is-ready');
    };

    Promise.allSettled(images.map(image => waitForImage(image).finally(settle))).then(reveal);
    setTimeout(reveal, timeoutMs);
})();
