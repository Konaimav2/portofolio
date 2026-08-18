const FIRST_START_SECONDS = 96;
const DEFAULT_VOLUME = 60;
const VOLUME_KEY = 'arraffi-music-volume';

export function formatTimestamp(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export function loopStartForState({ firstPlayback, ended }) {
    if (ended) return 0;
    return firstPlayback ? FIRST_START_SECONDS : null;
}

export function clampVolume(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(100, Math.round(number)));
}

export function progressToSeconds(value, duration) {
    const safeDuration = Number(duration);
    if (!Number.isFinite(safeDuration) || safeDuration <= 0) return 0;
    const progress = Math.max(0, Math.min(1000, Number(value) || 0));
    return (progress / 1000) * safeDuration;
}

export function waitForMediaMetadata(media, timeoutMs = 10000) {
    if (media.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timeout);
            media.removeEventListener('loadedmetadata', loaded);
            media.removeEventListener('error', errored);
        };
        const loaded = () => { cleanup(); resolve(); };
        const errored = () => { cleanup(); reject(new Error('Audio metadata unavailable')); };
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Audio metadata timeout'));
        }, timeoutMs);
        media.addEventListener('loadedmetadata', loaded, { once: true });
        media.addEventListener('error', errored, { once: true });
    });
}

function storedVolume() {
    try { return clampVolume(localStorage.getItem(VOLUME_KEY) ?? DEFAULT_VOLUME); } catch { return DEFAULT_VOLUME; }
}

function initPlayer() {
    const shell = document.getElementById('music-player');
    const expand = document.getElementById('music-expand');
    const panel = document.getElementById('music-panel');
    const audio = document.getElementById('soundtrack-audio');
    const playButton = document.getElementById('music-play');
    const volumeInput = document.getElementById('music-volume');
    const timeOutput = document.getElementById('music-time');
    const progress = document.getElementById('music-progress');
    const minimize = document.getElementById('music-minimize');
    const status = document.getElementById('music-status');
    if (!shell || !expand || !panel || !audio || !playButton || !volumeInput || !timeOutput || !progress) return;

    const labels = {
        play: playButton.dataset.labelPlay || 'Play soundtrack',
        pause: playButton.dataset.labelPause || 'Pause soundtrack',
        loading: status?.dataset.loading || 'Loading soundtrack...',
        unavailable: status?.dataset.unavailable || 'Soundtrack file unavailable.',
    };

    let firstPlayback = true;
    let failed = false;
    let scrubbing = false;
    let loadPromise = null;
    let objectUrl = '';

    const setStatus = text => { if (status) status.textContent = text; };
    const setPlayIcon = playing => {
        playButton.innerHTML = `<i class="fa-solid ${playing ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i>`;
        playButton.setAttribute('aria-label', playing ? labels.pause : labels.play);
    };
    const renderTime = () => {
        const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        timeOutput.textContent = `${formatTimestamp(current)} / ${formatTimestamp(duration)}`;
        if (!scrubbing && duration > 0) {
            progress.value = String(Math.round((current / duration) * 1000));
            progress.disabled = false;
        }
    };
    const fail = () => {
        failed = true;
        audio.pause();
        setPlayIcon(false);
        playButton.disabled = true;
        volumeInput.disabled = true;
        progress.disabled = true;
        shell.classList.add('is-unavailable');
        setStatus(labels.unavailable);
    };
    const ensureAudio = () => {
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            setStatus(labels.loading);
            playButton.disabled = true;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const response = await fetch(audio.dataset.src, { signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                objectUrl = URL.createObjectURL(await response.blob());
                audio.src = objectUrl;
                audio.load();
                await waitForMediaMetadata(audio);
                playButton.disabled = false;
                progress.disabled = false;
                setStatus('');
                renderTime();
            } finally {
                clearTimeout(timeout);
            }
        })();
        return loadPromise;
    };

    const volume = storedVolume();
    volumeInput.value = String(volume);
    audio.volume = volume / 100;
    playButton.disabled = true;

    audio.addEventListener('loadedmetadata', () => {
        progress.disabled = false;
        setStatus('');
        renderTime();
    });
    audio.addEventListener('durationchange', renderTime);
    audio.addEventListener('timeupdate', renderTime);
    audio.addEventListener('play', () => { setPlayIcon(true); setStatus(''); });
    audio.addEventListener('pause', () => { setPlayIcon(false); renderTime(); });
    audio.addEventListener('ended', () => {
        audio.currentTime = loopStartForState({ firstPlayback: false, ended: true });
        audio.play().catch(fail);
    });
    audio.addEventListener('error', fail);

    expand.addEventListener('click', () => {
        const open = expand.getAttribute('aria-expanded') === 'true';
        panel.hidden = open;
        shell.classList.toggle('is-collapsed', open);
        expand.setAttribute('aria-expanded', String(!open));
        if (!open) {
            ensureAudio().catch(fail);
            if (audio.readyState >= 1) renderTime();
        }
    });

    minimize?.addEventListener('click', () => {
        if (expand.getAttribute('aria-expanded') === 'true') expand.click();
    });

    playButton.addEventListener('click', () => {
        if (failed) return;
        if (!audio.paused) {
            audio.pause();
            return;
        }
        const seek = loopStartForState({ firstPlayback, ended: false });
        if (seek !== null) {
            const applyFirstSeek = () => { audio.currentTime = Math.min(seek, audio.duration || seek); };
            if (audio.readyState >= 1) applyFirstSeek();
            else audio.addEventListener('loadedmetadata', applyFirstSeek, { once: true });
            firstPlayback = false;
        }
        audio.volume = clampVolume(volumeInput.value) / 100;
        audio.play().catch(fail);
    });

    volumeInput.addEventListener('input', () => {
        const nextVolume = clampVolume(volumeInput.value);
        audio.volume = nextVolume / 100;
        try { localStorage.setItem(VOLUME_KEY, String(nextVolume)); } catch {}
    });

    progress.addEventListener('pointerdown', () => { scrubbing = true; });
    progress.addEventListener('input', () => {
        scrubbing = true;
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        timeOutput.textContent = `${formatTimestamp(progressToSeconds(progress.value, duration))} / ${formatTimestamp(duration)}`;
    });
    progress.addEventListener('change', () => {
        audio.currentTime = progressToSeconds(progress.value, audio.duration);
        scrubbing = false;
        renderTime();
    });

    if (audio.readyState >= 1) renderTime();
    setPlayIcon(false);

    window.addEventListener('pagehide', event => {
        if (!event.persisted && objectUrl) URL.revokeObjectURL(objectUrl);
    }, { once: true });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPlayer);
    else initPlayer();
}
