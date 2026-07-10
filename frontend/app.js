(function initLoader() {
    var loader = document.getElementById('page-loader');
    var bar    = document.getElementById('loader-bar');
    if (!loader || !bar) return;
    var pct = 0, done = false;
    function setBar(p) { pct = Math.min(p, 100); bar.style.width = pct + '%'; }
    function finish() {
        if (done) return; done = true;
        setBar(100);
        // wait for bar to visually complete (transition 300ms) then fade out
        setTimeout(function() { loader.classList.add('loader-done'); }, 400);
    }
    // fast: 0→70% in ~600ms
    var steps = 0;
    var fast = setInterval(function() {
        setBar((++steps) * (70 / 21));
        if (pct >= 70) clearInterval(fast);
    }, 28);
    // slow crawl while waiting for window.load
    var slow = setInterval(function() {
        if (pct < 92) setBar(pct + 0.4);
    }, 100);
    window.addEventListener('load', function() { clearInterval(slow); finish(); }, { once: true });
    setTimeout(function() { clearInterval(slow); finish(); }, 6000);
    if (document.readyState === 'complete') { clearInterval(fast); clearInterval(slow); finish(); }
})();

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0,0);



// Smooth scroll without changing URL hash
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'smooth' });
        }
    });
});

// Navbar Scroll
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
    if (window.scrollY > 50) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
});

// Mobile Nav
const navToggle = document.getElementById('nav-toggle');
const navLinks  = document.getElementById('nav-links');
navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    const icon = navToggle.querySelector('i');
    icon.classList.toggle('fa-bars');
    icon.classList.toggle('fa-xmark');
});
navLinks.querySelectorAll('.nav-close').forEach(a => {
    a.addEventListener('click', () => {
        navLinks.classList.remove('active');
        const icon = navToggle.querySelector('i');
        icon.classList.remove('fa-xmark');
        icon.classList.add('fa-bars');
    });
});

// Reveal
const revealElements = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('active');
            observer.unobserve(entry.target);
        }
    });
}, { rootMargin: "0px 0px -50px 0px", threshold: 0.15 });
revealElements.forEach(el => revealObserver.observe(el));

// API
const API_BASE = ['localhost', '127.0.0.1'].includes(location.hostname)
    ? `${location.protocol}//${location.hostname}:3001`
    : 'https://api.arraffi.com';
const TURNSTILE_SITE_KEY = ['localhost', '127.0.0.1'].includes(location.hostname)
    ? '1x00000000000000000000AA'
    : '0x4AAAAAADMAtXOh4MijdApa';
document.querySelectorAll('.cf-turnstile').forEach(el => { el.dataset.sitekey = TURNSTILE_SITE_KEY; });
const turnstileScript = document.createElement('script');
turnstileScript.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
turnstileScript.async = true;
turnstileScript.defer = true;
document.head.appendChild(turnstileScript);

function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safeUrl(url) {
    try {
        const u = new URL(url ?? '');
        return (u.protocol === 'http:' || u.protocol === 'https:') ? escHtml(url) : '#';
    } catch { return '#'; }
}
function installImageTimeouts(root = document, timeoutMs = 2600) {
    root.querySelectorAll('img[src]:not([data-timeout-bound])').forEach(img => {
        img.dataset.timeoutBound = '1';
        const fail = () => {
            if (img.complete && img.naturalWidth > 0) return;
            img.classList.add('img-timeout');
            img.closest('.proj-img')?.classList.add('image-timeout');
            img.closest('.hero-visual')?.classList.add('image-timeout');
            img.closest('.exp-logo-frame')?.classList.add('image-timeout');
            img.removeAttribute('src');
        };
        const timer = setTimeout(fail, timeoutMs);
        img.addEventListener('load', () => clearTimeout(timer), { once: true });
        img.addEventListener('error', fail, { once: true });
    });
}
installImageTimeouts(document);

const fallbackProjects = [
    {
        title: 'SimpleCDN',
        description: 'A fast, lightweight content delivery network built from scratch. Designed to serve static assets with minimal overhead.',
        url: 'https://cdn.discordapp.my.id',
        image_url: 'https://cdn.discordapp.my.id/cdn/7541df.webp',
        full_width: 0,
        category: 'Edge delivery',
        chips: ['CDN', 'Static files', 'Caching']
    },
    {
        title: 'BerAPI',
        description: 'A centralized hub of ready-to-use API endpoints designed for rapid prototyping, AI integration, and download utilities.',
        url: 'https://berapi.my.id/',
        image_url: 'https://cdn.discordapp.my.id/cdn/secure/1f75f1.webp',
        full_width: 0,
        category: 'API platform',
        chips: ['Node.js', 'API', 'Tools']
    },
    {
        title: 'Automated Bot Systems',
        description: 'Custom automated WhatsApp bots to handle community engagement, moderate chats, and process repetitive tasks.',
        url: null,
        image_url: 'https://cdn.discordapp.my.id/cdn/e3dece.webp',
        full_width: 0,
        category: 'Automation',
        chips: ['Bots', 'Moderation', 'Support']
    }
];

const fallbackExperience = [
    {
        company: 'Arqonara Hosting',
        role: 'Manager & Staff',
        date_range: 'Aug 2025 — Present',
        description: 'Managing core backend infrastructure, ensuring game server stability under heavy load, and resolving network issues.',
        logo_url: 'https://cdn.discordapp.my.id/cdn/df7b8d.webp',
        url: 'https://arqonara.com'
    },
    {
        company: 'HeppyCloud',
        role: 'Customer Service',
        date_range: 'Mar 2025 — Present',
        description: 'Helping customers troubleshoot hosting issues, manage service requests, and keep support responses clear.',
        logo_url: 'https://cdn.discordapp.my.id/cdn/028eba.webp',
        url: 'https://heppycloud.id'
    }
];

function renderProjects(projects) {
    const projGrid = document.getElementById('dynamic-projects');
    if (!projGrid || !projects.length) return;
    projGrid.innerHTML = projects.map(p => {
        const category = p.category || (p.full_width ? 'Cloud infrastructure' : 'Digital service');
        const chips = p.chips || ['Backend', 'Panel', 'Hosting'];
        const content = `
            <div class="proj-img">
                <img loading="lazy" src="${safeUrl(p.image_url)}" alt="${escHtml(p.title)}">
            </div>
            <div class="proj-content">
                <div class="proj-topline"><span class="proj-icon"><i class="fa-solid fa-server"></i></span><span>${escHtml(category)}</span></div>
                <h3 class="proj-title">${escHtml(p.title)}</h3>
                <p class="proj-desc">${escHtml(p.description)}</p>
                <div class="proj-tags">${chips.map(chip => `<span>${escHtml(chip)}</span>`).join('')}</div>
                <span class="proj-link-hint">${p.url ? 'Open project ↗' : 'Private build'}</span>
            </div>`;
        const classes = `project-card ${p.full_width ? 'full-width' : ''} ${p.url ? 'is-clickable' : ''}`;
        return p.url ? `<a href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer" class="${classes}" aria-label="Open ${escHtml(p.title)} project">${content}</a>`
                     : `<div class="${classes}">${content}</div>`;
    }).join('');
    installImageTimeouts(projGrid);
}

function renderExperience(experiences) {
    const expTimeline = document.getElementById('dynamic-experience');
    if (!expTimeline || !experiences.length) return;
    expTimeline.innerHTML = experiences.map(e => {
        const tag = e.url ? 'a' : 'div';
        const href = e.url ? ` href="${safeUrl(e.url)}" target="_blank" rel="noopener noreferrer"` : '';
        const classes = `exp-card ${e.url ? 'exp-clickable' : ''}`;
        return `
        <${tag}${href} class="${classes}">
            <span class="exp-logo-frame"><img loading="lazy" src="${safeUrl(e.logo_url)}" alt="${escHtml(e.company)}" class="exp-logo"></span>
            <div class="exp-info">
                <h3 class="exp-title">${escHtml(e.company)}</h3>
                <div class="exp-role">${escHtml(e.role)}</div>
                <div class="exp-date">${escHtml(e.date_range)}</div>
                <p class="exp-desc">${escHtml(e.description)}</p>
            </div>
        </${tag}>
    `}).join('');
    installImageTimeouts(expTimeline);
}

async function loadCMSData() {
    const fetchJSON = async url => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error(res.status);
            return await res.json();
        } finally {
            clearTimeout(timeout);
        }
    };
    renderProjects(fallbackProjects);
    renderExperience(fallbackExperience);
    const [projResult, expResult] = await Promise.allSettled([
        fetchJSON(`${API_BASE}/api/projects`),
        fetchJSON(`${API_BASE}/api/experience`),
    ]);

    renderProjects(projResult.status === 'fulfilled' && projResult.value.length ? projResult.value : fallbackProjects);

    if (expResult.status === 'fulfilled') {
        const experiences = expResult.value;
        if (experiences.length > 0) renderExperience(experiences);
    }
}
loadCMSData();

let commentUser = null;
const authForm = document.getElementById('comment-auth-form');
const authSubmit = document.getElementById('comment-auth-submit');
const loginCard = document.getElementById('comment-login-card');
const userCard = document.getElementById('comment-user-card');
const anonFields = document.getElementById('anon-fields');
const commentForm = document.getElementById('comment-form');
const commentSubmit = document.getElementById('comment-submit');
const commentStatus = document.getElementById('comment-status');
const commentList = document.getElementById('comment-list');
const refreshComments = document.getElementById('refresh-comments');
const authDetails = document.getElementById('comment-auth');

const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
const setStatus = (text, type = '') => {
    if (!commentStatus) return;
    commentStatus.textContent = text;
    commentStatus.className = `form-status ${type}`.trim();
};
const readFileAsDataUrl = file => new Promise((resolve, reject) => {
    if (!file) return resolve('');
    if (file.size > 2 * 1024 * 1024) return reject(new Error('Profile image must be 2MB or smaller.'));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read profile image.'));
    reader.readAsDataURL(file);
});

const MAX_AVATAR_PX = 256;
const MAX_AVATAR_BYTES = 200 * 1024;

function resizeAndCompressAvatar(file) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve('');
        if (file.size > 2 * 1024 * 1024) return reject(new Error('Profile image must be 2MB or smaller.'));
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const scale = Math.min(1, MAX_AVATAR_PX / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            let quality = 0.85;
            let dataUrl = canvas.toDataURL('image/jpeg', quality);
            while (dataUrl.length * 0.75 > MAX_AVATAR_BYTES && quality > 0.3) {
                quality -= 0.1;
                dataUrl = canvas.toDataURL('image/jpeg', quality);
            }
            resolve(dataUrl);
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not read profile image.')); };
        img.src = objectUrl;
    });
}

function renderCommentUser() {
    if (!loginCard || !userCard || !anonFields) return;
    if (!commentUser) {
        if (authDetails) authDetails.open = false;
        loginCard.classList.remove('hidden');
        userCard.classList.add('hidden');
        anonFields.classList.remove('hidden');
        return;
    }
    if (authDetails) authDetails.open = true;
    loginCard.classList.add('hidden');
    userCard.classList.remove('hidden');
    anonFields.classList.add('hidden');
    userCard.innerHTML = `
        <div class="avatar small-avatar">${commentUser.avatar_url ? `<img src="${safeUrl(commentUser.avatar_url)}" alt="${escHtml(commentUser.name)}">` : escHtml(initials(commentUser.name))}</div>
        <div><strong>${escHtml(commentUser.name)}</strong><span>${escHtml(commentUser.email)}</span></div>
        <button type="button" id="comment-logout" class="btn-ghost">Logout</button>`;
    installImageTimeouts(userCard);
    document.getElementById('comment-logout')?.addEventListener('click', async () => {
        await fetch(`${API_BASE}/api/comment/logout`, { method: 'POST', credentials: 'include' });
        commentUser = null;
        renderCommentUser();
    });
}

async function loadCommentMe() {
    try {
        const res = await fetch(`${API_BASE}/api/comment/me`, { credentials: 'include' });
        const json = await res.json();
        commentUser = json.user || null;
        renderCommentUser();
    } catch { renderCommentUser(); }
}

async function loadComments() {
    if (!commentList) return;
    commentList.innerHTML = '<div class="empty-note">Loading comments...</div>';
    try {
        const res = await fetch(`${API_BASE}/api/comments`);
        const comments = await res.json();
        if (!Array.isArray(comments) || !comments.length) {
            commentList.innerHTML = '<div class="empty-note">No comments yet. First one gets bragging rights.</div>';
            return;
        }
        commentList.innerHTML = comments.map(comment => `
            <article class="comment-card">
                <div class="avatar">${comment.avatar_url ? `<img src="${safeUrl(comment.avatar_url)}" alt="${escHtml(comment.author_name)}">` : escHtml(initials(comment.author_name))}</div>
                <div>
                    <div class="comment-meta"><strong>${escHtml(comment.author_name)}</strong><time>${escHtml(new Date(comment.created_at).toLocaleDateString())}</time></div>
                    <p>${escHtml(comment.body)}</p>
                </div>
            </article>`).join('');
        installImageTimeouts(commentList);
    } catch {
        const local = ['localhost', '127.0.0.1'].includes(location.hostname);
        commentList.innerHTML = `<div class="empty-note error">${local ? 'Start backend on port 3001 to load comments.' : 'Could not load comments.'}</div>`;
    }
}

document.querySelectorAll('[data-auth-mode]').forEach(tab => {
    tab.addEventListener('click', () => {
        const mode = tab.dataset.authMode;
        document.querySelectorAll('[data-auth-mode]').forEach(item => item.classList.toggle('active', item === tab));
        authForm.querySelector('[name="mode"]').value = mode;
        authSubmit.textContent = mode === 'register' ? 'Create account' : 'Login';
        authForm.querySelectorAll('.register-only').forEach(el => el.classList.toggle('hidden', mode !== 'register'));
        document.getElementById('comment-auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    });
});

authForm?.addEventListener('submit', async event => {
    event.preventDefault();
    authSubmit.disabled = true;
    const original = authSubmit.textContent;
    authSubmit.textContent = 'Working...';
    let mode = 'login';
    try {
        const fd = new FormData(authForm);
        mode = fd.get('mode');
        const avatarFile = document.getElementById('comment-avatar')?.files?.[0];
        const body = { email: fd.get('email'), password: fd.get('password') };
        if (mode === 'register') {
            body.name = fd.get('name');
            body.avatar_data = await resizeAndCompressAvatar(avatarFile);
            body.turnstile = document.querySelector('[name="cf-turnstile-response"]')?.value || '';
        }
        const res = await fetch(`${API_BASE}/api/comment/${mode}`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Account request failed.');
        commentUser = json.user;
        authForm.reset();
        renderCommentUser();
        setStatus(mode === 'register' ? 'Account ready. Your comments can post instantly.' : 'Logged in.');
    } catch (err) {
        setStatus(err.message || 'Account request failed.', 'error');
    } finally {
        if (window.turnstile && mode === 'register') window.turnstile.reset();
        authSubmit.disabled = false;
        authSubmit.textContent = original;
    }
});

commentForm?.addEventListener('submit', async event => {
    event.preventDefault();
    commentSubmit.disabled = true;
    commentSubmit.textContent = 'Posting...';
    setStatus('Checking Turnstile...');
    try {
        const fd = new FormData(commentForm);
        const res = await fetch(`${API_BASE}/api/comments`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                body: fd.get('body'),
                anonymous_name: fd.get('anonymous_name'),
                anonymous_email: fd.get('anonymous_email'),
                website_url: fd.get('website_url'),
                turnstile: fd.get('cf-turnstile-response'),
            })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Could not post comment.');
        commentForm.reset();
        if (window.turnstile) turnstile.reset();
        setStatus(json.message || 'Comment posted.', json.status === 'pending' ? '' : 'success');
        await loadComments();
    } catch (err) {
        setStatus(err.message || 'Could not post comment.', 'error');
    } finally {
        commentSubmit.disabled = false;
        commentSubmit.textContent = 'Post Comment';
    }
});

refreshComments?.addEventListener('click', loadComments);
loadCommentMe();
loadComments();
