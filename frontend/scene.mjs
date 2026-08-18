const THEMES = new Set(['light', 'dark']);

export function resolveTheme(storedTheme, prefersDark) {
    if (THEMES.has(storedTheme)) return storedTheme;
    return prefersDark ? 'dark' : 'light';
}

const SCENE_SCRAMBLE_SYMBOLS = '!<>-_\\/[]{}—=+*^?#01';

export const SCENE_NAMES = Object.freeze(['ARRAFFI', 'KONAIMA']);
export const SCENE_NAME_INTERVAL_MS = 4000;
export const SCENE_SCRAMBLE_DURATION_MS = 480;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function sceneScrollDistance({ heroTop, stickyTop, depthRange }) {
    const safeRange = Number.isFinite(depthRange) ? Math.max(0, depthRange) : 0;
    const distance = Number.isFinite(heroTop) && Number.isFinite(stickyTop)
        ? stickyTop - heroTop
        : 0;
    return clamp(distance, 0, safeRange);
}

export function sceneLayerOffsets(distance, reduced) {
    const safeDistance = reduced || !Number.isFinite(distance) ? 0 : Math.max(0, distance);
    return {
        word: safeDistance * 0.4,
        label: safeDistance * 0.4,
        character: safeDistance === 0 ? 0 : safeDistance * -0.3,
    };
}

export function sceneMotionAllowed({ visible, hidden, reduced }) {
    return visible && !hidden && !reduced;
}

export function sceneNamesAreCompatible(names) {
    if (!Array.isArray(names) || names.length < 2 || names.some(name => typeof name !== 'string' || !name)) {
        return false;
    }
    return new Set(names.map(name => [...name].length)).size === 1;
}

export function sceneScrambleFrame(target, progress, random = Math.random) {
    const characters = [...String(target)];
    const safeProgress = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
    if (safeProgress === 1) return characters.join('');
    const revealed = Math.floor(characters.length * safeProgress);
    return characters.map((character, index) => {
        if (index < revealed) return character;
        const randomValue = Number(random());
        const sample = Number.isFinite(randomValue) ? clamp(randomValue, 0, 0.999999) : 0;
        return SCENE_SCRAMBLE_SYMBOLS[Math.floor(sample * SCENE_SCRAMBLE_SYMBOLS.length)];
    }).join('');
}

export function revealTransition(entry, wasVisible) {
    if (entry.isIntersecting) return wasVisible ? 'keep' : 'reveal';
    if (!wasVisible || !entry.rootBounds || !entry.boundingClientRect) return 'keep';
    const fullyOutside = entry.boundingClientRect.bottom < entry.rootBounds.top
        || entry.boundingClientRect.top > entry.rootBounds.bottom;
    return fullyOutside ? 'reset' : 'keep';
}

export function marqueeSetDistance(width, gap) {
    return width + (Number.isFinite(gap) ? Math.max(0, gap) : 0);
}

export const STACK_LANES = Object.freeze({
    top: Object.freeze([
        { label: 'Node.js', icon: 'fa-brands fa-node-js' },
        { label: 'Linux', icon: 'fa-brands fa-linux' },
        { label: 'VPS', icon: 'fa-solid fa-server' },
    ]),
    bottom: Object.freeze([
        { label: 'Python', icon: 'fa-brands fa-python' },
        { label: 'JavaScript', icon: 'fa-solid fa-code' },
    ]),
});

export function nextPlaybackRate(current, target, step = 0.12) {
    if (Math.abs(target - current) <= step) return target;
    return current + Math.sign(target - current) * step;
}

const THEME_KEY = 'arraffi-theme';
const MOBILE_QUERY = '(max-width: 768px)';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    const icon = toggle.querySelector('i');
    const apply = theme => {
        document.documentElement.dataset.theme = theme;
        if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    };
    apply(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    toggle.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        apply(next);
        try { localStorage.setItem(THEME_KEY, next); } catch {}
    });
}

function initMenu() {
    const toggle = document.getElementById('nav-toggle');
    const links = document.getElementById('nav-links');
    if (!toggle || !links) return;

    const setMenu = open => {
        const mobile = matchMedia(MOBILE_QUERY).matches;
        if (!mobile) {
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', 'Open menu');
            links.hidden = false;
            links.inert = false;
            document.body.classList.remove('menu-open');
            return;
        }
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        links.hidden = !open;
        links.inert = !open;
        document.body.classList.toggle('menu-open', open);
    };

    toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        setMenu(!open);
    });
    links.querySelectorAll('.nav-close').forEach(link =>
        link.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
            setMenu(false);
            toggle.focus();
        }
    });
    matchMedia(MOBILE_QUERY).addEventListener('change', () => setMenu(false));
    setMenu(false);
}

function initSceneDepth() {
    const scene = document.getElementById('hero-scene');
    const stage = scene?.closest('.hero');
    const word = scene?.querySelector('.hero-word');
    if (!scene || !stage || !word || typeof requestAnimationFrame !== 'function') return;
    if (!sceneNamesAreCompatible(SCENE_NAMES)) return;

    const reducedQuery = matchMedia(REDUCED_QUERY);
    const state = {
        visible: true,
        hidden: document.hidden,
        reduced: reducedQuery.matches,
        resolvedName: SCENE_NAMES[0],
    };
    const scrambleStepMs = 30;
    const scrambleSteps = SCENE_SCRAMBLE_DURATION_MS / scrambleStepMs;
    let paintFrame = 0;
    let nameTimer = 0;
    let scrambleTimer = 0;

    const writeOffsets = offsets => {
        scene.style.setProperty('--scene-word-y', `${offsets.word.toFixed(2)}px`);
        scene.style.setProperty('--scene-label-y', `${offsets.label.toFixed(2)}px`);
        scene.style.setProperty('--scene-character-y', `${offsets.character.toFixed(2)}px`);
    };
    const resetOffsets = () => writeOffsets(sceneLayerOffsets(0, true));

    const paintScroll = () => {
        paintFrame = 0;
        if (!sceneMotionAllowed(state)) {
            resetOffsets();
            return;
        }
        const stageRect = stage.getBoundingClientRect();
        const stickyTop = Number.parseFloat(getComputedStyle(scene).top) || 0;
        const depthRange = Math.max(0, stage.offsetHeight - scene.offsetHeight);
        const distance = sceneScrollDistance({
            heroTop: stageRect.top,
            stickyTop,
            depthRange,
        });
        writeOffsets(sceneLayerOffsets(distance, false));
    };

    const requestPaint = () => {
        if (!paintFrame && sceneMotionAllowed(state)) {
            paintFrame = requestAnimationFrame(paintScroll);
        }
    };

    const clearScramble = () => {
        if (scrambleTimer) clearInterval(scrambleTimer);
        scrambleTimer = 0;
        word.textContent = state.resolvedName;
    };

    const stopNameTimer = () => {
        if (nameTimer) clearInterval(nameTimer);
        nameTimer = 0;
        clearScramble();
    };

    const startMutation = () => {
        if (!sceneMotionAllowed(state) || scrambleTimer) return;
        const currentIndex = SCENE_NAMES.indexOf(state.resolvedName);
        const target = SCENE_NAMES[(currentIndex + 1) % SCENE_NAMES.length];
        let step = 0;
        scrambleTimer = setInterval(() => {
            step += 1;
            const progress = Math.min(1, step / scrambleSteps);
            word.textContent = sceneScrambleFrame(target, progress);
            if (progress < 1) return;
            clearInterval(scrambleTimer);
            scrambleTimer = 0;
            state.resolvedName = target;
            word.textContent = target;
        }, scrambleStepMs);
    };

    const startNameTimer = () => {
        if (!nameTimer) nameTimer = setInterval(startMutation, SCENE_NAME_INTERVAL_MS);
    };

    const syncActivity = () => {
        const active = sceneMotionAllowed(state);
        scene.classList.toggle('scene-motion-active', active);
        if (!active) {
            if (paintFrame) cancelAnimationFrame(paintFrame);
            paintFrame = 0;
            resetOffsets();
            stopNameTimer();
            return;
        }
        requestPaint();
        startNameTimer();
    };

    addEventListener('scroll', requestPaint, { passive: true });
    addEventListener('resize', requestPaint, { passive: true });

    if ('IntersectionObserver' in window) {
        new IntersectionObserver(entries => {
            state.visible = entries[0].isIntersecting;
            syncActivity();
        }, { threshold: 0.05 }).observe(stage);
    } else {
        const updateFallbackVisibility = () => {
            const rect = stage.getBoundingClientRect();
            const visible = rect.bottom > 0 && rect.top < innerHeight;
            if (visible === state.visible) return;
            state.visible = visible;
            syncActivity();
        };
        addEventListener('scroll', updateFallbackVisibility, { passive: true });
        addEventListener('resize', updateFallbackVisibility, { passive: true });
        updateFallbackVisibility();
    }

    document.addEventListener('visibilitychange', () => {
        state.hidden = document.hidden;
        syncActivity();
    });
    reducedQuery.addEventListener('change', event => {
        state.reduced = event.matches;
        state.resolvedName = SCENE_NAMES[0];
        word.textContent = state.resolvedName;
        syncActivity();
    });

    word.textContent = state.resolvedName;
    syncActivity();
}

function initPortraitSwap() {
    const portrait = document.getElementById('about-portrait');
    if (!portrait) return;
    const alt = portrait.querySelector('.portrait-alt');
    const fine = matchMedia('(hover: hover) and (pointer: fine)');
    let locked = false;

    if (alt) alt.addEventListener('error', () => {
        portrait.disabled = true;
        portrait.classList.add('portrait-single');
    }, { once: true });

    const paint = () => {
        portrait.classList.toggle('show-alt', locked || portrait.dataset.preview === 'on');
        portrait.setAttribute('aria-pressed', String(locked));
    };
    const preview = on => {
        if (locked) return;
        portrait.dataset.preview = on ? 'on' : 'off';
        paint();
    };

    const coarse = matchMedia('(hover: none), (pointer: coarse)');

    // Desktop: hover/focus reveals the alternate image; no click toggle needed.
    portrait.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') preview(true); });
    portrait.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') preview(false); });
    portrait.addEventListener('focus', () => { if (fine.matches) preview(true); });
    portrait.addEventListener('blur', () => preview(false));

    // Mobile/touch: tap toggles a locked flip because there is no hover.
    portrait.addEventListener('click', event => {
        if (!coarse.matches) { event.preventDefault(); return; }
        locked = !locked;
        portrait.dataset.preview = 'off';
        paint();
    });
    document.addEventListener('pointerdown', event => {
        if (coarse.matches && locked && !portrait.contains(event.target)) { locked = false; paint(); }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && locked) { locked = false; paint(); }
    });
    paint();
}

function initReveal() {
    if (!('IntersectionObserver' in window)) return;
    const reduced = matchMedia(REDUCED_QUERY);
    const root = document.documentElement;
    const targets = new Set();
    const selector = [
        ':scope > .chapter-label',
        ':scope > h2',
        '.about-copy > h2',
        '.about-copy > p',
        '.about-facts',
        '.about-socials',
        '.about-portrait',
        '.project-feature',
        '.project-archive',
        '.experience-row',
        '.comment-head > h2',
        '.comment-box',
        '.comment-feed',
    ].join(', ');

    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const target = entry.target;
            const transition = revealTransition(entry, target.classList.contains('is-revealed'));
            if (transition === 'reveal') target.classList.add('is-revealed');
            if (transition === 'reset') target.classList.remove('is-revealed');
        }
    }, { threshold: 0, rootMargin: '1px 0px' });

    const register = () => {
        for (const chapter of document.querySelectorAll('.chapter')) {
            [...chapter.querySelectorAll(selector)].forEach((target, index) => {
                if (targets.has(target)) return;
                targets.add(target);
                target.classList.add('reveal-item');
                target.style.setProperty('--reveal-delay', `${Math.min(index * 60, 240)}ms`);
                if (!reduced.matches) observer.observe(target);
            });
        }
    };

    const applyMotionMode = () => {
        root.classList.toggle('reveal-enhanced', !reduced.matches);
        observer.disconnect();
        if (!reduced.matches) targets.forEach(target => observer.observe(target));
    };

    register();
    applyMotionMode();
    new MutationObserver(register).observe(document.querySelector('main') || document.body, {
        childList: true,
        subtree: true,
    });
    reduced.addEventListener('change', applyMotionMode);
}

function laneItem({ label, icon }) {
    const item = document.createElement('span');
    item.className = 'stack-chip';
    item.dataset.stackItem = label;
    item.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
    item.append(document.createTextNode(` ${label}`));
    return item;
}

function initStackLanes() {
    const crossing = document.getElementById('stack-crossing');
    if (!crossing) return;
    const reduced = matchMedia(REDUCED_QUERY);
    const lanes = [];

    let animations = [];
    let rate = 1;
    let target = 1;
    let frame = 0;

    const cancelAnimations = () => {
        animations.forEach(animation => animation.cancel());
        animations = [];
    };

    const fillLane = (element, source) => {
        const track = document.createElement('div');
        track.className = 'stack-lane-track';
        for (const entry of source) track.append(laneItem(entry));
        element.replaceChildren(track);
        const setWidth = track.scrollWidth || 1;
        const styles = getComputedStyle(track);
        const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
        const distance = marqueeSetDistance(setWidth, gap);
        let copies = 1;
        while (track.scrollWidth <= crossing.clientWidth * 2 + distance) {
            for (const entry of source) {
                const item = laneItem(entry);
                item.setAttribute('aria-hidden', 'true');
                track.append(item);
            }
            copies += 1;
        }
        track.dataset.copies = String(copies);
        return { element, track, reverse: element.dataset.direction === 'reverse', distance };
    };

    const buildAnimations = () => {
        animations = lanes.map(lane => {
            const distance = lane.distance;
            const from = lane.reverse ? -distance : 0;
            const to = lane.reverse ? 0 : -distance;
            const animation = lane.track.animate(
                [{ transform: `translate3d(${from}px, 0, 0)` }, { transform: `translate3d(${to}px, 0, 0)` }],
                { duration: Math.max(6000, distance * 32), iterations: Infinity, easing: 'linear' },
            );
            animation.playbackRate = rate || 0.0001;
            if (!rate) animation.pause();
            return animation;
        });
    };

    const ramp = () => {
        frame = 0;
        rate = nextPlaybackRate(rate, target);
        for (const animation of animations) {
            if (rate <= 0) { animation.pause(); continue; }
            if (animation.playState === 'paused') animation.play();
            animation.playbackRate = rate;
        }
        if (rate !== target) frame = requestAnimationFrame(ramp);
    };
    const rampTo = value => {
        target = value;
        if (!frame && rate !== target) frame = requestAnimationFrame(ramp);
    };

    const rebuild = () => {
        cancelAnimations();
        lanes.length = 0;
        for (const element of crossing.querySelectorAll('[data-stack-lane]')) {
            const source = STACK_LANES[element.dataset.stackLane] || [];
            if (source.length) lanes.push(fillLane(element, source));
        }
        crossing.classList.toggle('is-static', reduced.matches);
        if (!reduced.matches && lanes.length) buildAnimations();
    };

    // Hover/focus gently slows the lanes; click never stops them.
    crossing.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') rampTo(0); });
    crossing.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') rampTo(1); });
    crossing.addEventListener('focusin', () => rampTo(0));
    crossing.addEventListener('focusout', () => rampTo(1));

    const applyMotionMode = () => {
        if (reduced.matches) {
            cancelAnimations();
            crossing.classList.add('is-static');
            return;
        }
        crossing.classList.remove('is-static');
        rebuild();
    };

    reduced.addEventListener('change', applyMotionMode);
    let resizeTimer = 0;
    addEventListener('resize', () => {
        if (reduced.matches) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(rebuild, 200);
    }, { passive: true });
    Promise.resolve(document.fonts?.ready).then(rebuild);
}

if (typeof document !== 'undefined') {
    const boot = () => {
        initTheme();
        initMenu();
        initSceneDepth();
        initPortraitSwap();
        initReveal();
        initStackLanes();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
}
