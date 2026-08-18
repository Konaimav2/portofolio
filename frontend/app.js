if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const isIndonesian = document.documentElement.lang === 'id';
const copy = isIndonesian ? {
    loadingComments: 'Memuat komentar...',
    emptyComments: 'Belum ada komentar. Jadilah yang pertama.',
    commentsFailed: 'Komentar gagal dimuat.',
    localBackend: 'Jalankan backend di port 3001 untuk memuat komentar.',
    apiFailed: 'Failed to fetch API.',
    openProject: 'Buka proyek',
    privateBuild: 'Build privat',
    working: 'Memproses...',
    posting: 'Mengirim...',
    checking: 'Memeriksa Turnstile...',
    post: 'Kirim',
    login: 'Login',
    createAccount: 'Buat akun',
    logout: 'Logout',
    accountReady: 'Akun siap. Komentar kamu bisa langsung tampil.',
    loggedIn: 'Berhasil login.',
    accountFailed: 'Permintaan akun gagal.',
    commentPosted: 'Komentar terkirim.',
    commentFailed: 'Komentar gagal terkirim.',
    avatarTooBig: 'Gambar profil maksimal 2MB.',
    avatarUnreadable: 'Gambar profil tidak terbaca.',
} : {
    loadingComments: 'Loading comments...',
    emptyComments: 'No comments yet. First one gets bragging rights.',
    commentsFailed: 'Could not load comments.',
    localBackend: 'Start backend on port 3001 to load comments.',
    apiFailed: 'Failed to fetch API.',
    openProject: 'Open project',
    privateBuild: 'Private build',
    working: 'Working...',
    posting: 'Posting...',
    checking: 'Checking Turnstile...',
    post: 'Post',
    login: 'Login',
    createAccount: 'Create account',
    logout: 'Logout',
    accountReady: 'Account ready. Your comments can post instantly.',
    loggedIn: 'Logged in.',
    accountFailed: 'Account request failed.',
    commentPosted: 'Comment posted.',
    commentFailed: 'Could not post comment.',
    avatarTooBig: 'Profile image must be 2MB or smaller.',
    avatarUnreadable: 'Could not read profile image.',
};

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const API_BASE = isLocal ? `${location.protocol}//${location.hostname}:3001` : 'https://api.arraffi.com';
const TURNSTILE_SITE_KEY = isLocal ? '1x00000000000000000000AA' : '0x4AAAAAADMAtXOh4MijdApa';
const { fetchJSON } = window.PortfolioAPI;

function renderCommentTurnstile() {
    return window.PortfolioTurnstile.render('comment-turnstile', {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        action: 'comment_post',
    });
}

function renderRegisterTurnstile() {
    return window.PortfolioTurnstile.render('register-turnstile', {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        action: 'comment_register',
    });
}

// Smooth scroll without changing URL hash
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;
        const target = document.querySelector(targetId);
        if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
    });
});

const navbar = document.getElementById('navbar');
if (navbar) {
    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });
}

function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safeUrl(url) {
    try {
        const u = new URL(url ?? '');
        return (u.protocol === 'http:' || u.protocol === 'https:') ? escHtml(url) : '';
    } catch { return ''; }
}
function installImageTimeouts(root = document, timeoutMs = 4000) {
    root.querySelectorAll('img[src]:not([data-timeout-bound])').forEach(img => {
        img.dataset.timeoutBound = '1';
        const applyFallback = () => {
            const fb = img.dataset.fallback;
            if (fb && img.src !== fb) { img.src = fb; img.removeAttribute('data-fallback'); return true; }
            return false;
        };
        const fail = () => {
            if (img.complete && img.naturalWidth > 0) return;
            if (applyFallback()) return;
            img.classList.add('img-timeout');
            img.closest('.project-media')?.classList.add('image-timeout');
            img.closest('.exp-logo-frame')?.classList.add('image-timeout');
            img.removeAttribute('src');
        };
        let timer = null;
        const start = () => { if (!timer) timer = setTimeout(fail, timeoutMs); };
        img.addEventListener('load', () => clearTimeout(timer), { once: true });
        img.addEventListener('error', fail);
        if (img.complete && img.naturalWidth > 0) return;
        if (img.loading === 'lazy') {
            const io = new IntersectionObserver(entries => {
                if (entries[0].isIntersecting) { io.disconnect(); start(); }
            }, { rootMargin: '200px' });
            io.observe(img);
        } else start();
    });
}
installImageTimeouts(document);

const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';

function projectLocalized(p, field) {
    return isIndonesian ? (p[`${field}_id`] || p[field]) : p[field];
}

function fallbackAttr(url) {
    const safe = url ? safeUrl(url) : '';
    return safe ? ` data-fallback="${safe}"` : '';
}

function categoryIcon(category) {
    const key = String(category || '').toLowerCase();
    if (key.includes('cdn') || key.includes('edge') || key.includes('deliver')) return 'fa-solid fa-bolt';
    if (key.includes('api') || key.includes('platform')) return 'fa-solid fa-plug';
    if (key.includes('auto') || key.includes('bot')) return 'fa-solid fa-robot';
    if (key.includes('cloud') || key.includes('infra')) return 'fa-solid fa-server';
    return 'fa-solid fa-cube';
}

function renderFeaturedProject(p, index) {
    const title = projectLocalized(p, 'title');
    const description = projectLocalized(p, 'description');
    const category = p.category || (p.full_width ? 'Cloud infrastructure' : 'Digital service');
    const chips = (p.chips || ['Backend', 'Panel', 'Hosting']).map(chip => `<span>${escHtml(chip)}</span>`).join('');
    const href = safeUrl(p.url);
    const media = `<div class="project-media"><img loading="lazy" src="${safeUrl(p.image_url)}"${fallbackAttr(p.image_url_fallback)} alt="${escHtml(title)}"></div>`;
    const ext = href ? '<i class="fa-solid fa-arrow-up-right-from-square ext" aria-hidden="true"></i>' : '';
    const info = `
        <div class="project-info">
            <span class="project-cat"><i class="${categoryIcon(category)}" aria-hidden="true"></i>${escHtml(category)}</span>
            <h3>${escHtml(title)}${ext}</h3>
            <p>${escHtml(description)}</p>
            <div class="project-chips">${chips}</div>
        </div>`;
    const classes = `project-feature project-feature-${index + 1}${href ? ' is-clickable' : ''}`;
    return href
        ? `<a class="${classes}" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${escHtml(copy.openProject)}: ${escHtml(title)}">${media}${info}</a>`
        : `<div class="${classes}">${media}${info}</div>`;
}

function renderArchiveProject(p) {
    const title = projectLocalized(p, 'title');
    const category = p.category || 'Project';
    const href = safeUrl(p.url);
    const inner = `<span class="pa-title">${escHtml(title)}</span><span class="pa-cat">${escHtml(category)}</span>${href ? '<i class="fa-solid fa-arrow-up-right-from-square pa-ext" aria-hidden="true"></i>' : `<span class="pa-cat">${escHtml(copy.privateBuild)}</span>`}`;
    return href
        ? `<a class="project-archive-row" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${escHtml(copy.openProject)}: ${escHtml(title)}">${inner}</a>`
        : `<div class="project-archive-row">${inner}</div>`;
}

function renderProjects(projects) {
    const root = document.getElementById('dynamic-projects');
    if (!root || !projects.length) return;
    const featured = projects.slice(0, 3);
    const archive = projects.slice(3);
    root.innerHTML = [
        ...featured.map((p, i) => renderFeaturedProject(p, i)),
        archive.length ? `<div class="project-archive">${archive.map(renderArchiveProject).join('')}</div>` : '',
    ].join('');
    installImageTimeouts(root);
}

function renderExperience(experiences) {
    const root = document.getElementById('dynamic-experience');
    if (!root || !experiences.length) return;
    root.innerHTML = experiences.map((e, index) => {
        const role = isIndonesian ? (e.role_id || e.role) : e.role;
        const description = isIndonesian ? (e.description_id || e.description) : e.description;
        const href = safeUrl(e.url);
        const logo = safeUrl(e.logo_url);
        const logoFrame = logo
            ? `<span class="exp-logo-frame"><img loading="lazy" src="${logo}"${fallbackAttr(e.logo_url_fallback)} alt="${escHtml(e.company)}"><span class="exp-logo-initials" aria-hidden="true">${escHtml(initials(e.company))}</span></span>`
            : `<span class="exp-logo-frame is-empty"><span class="exp-logo-initials" aria-hidden="true">${escHtml(initials(e.company))}</span></span>`;
        const meta = `<div class="exp-meta">${escHtml(e.date_range)}${href ? '<i class="fa-solid fa-arrow-up-right-from-square exp-ext" aria-hidden="true"></i>' : ''}</div>`;
        const inner = `<span class="exp-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>${logoFrame}<div class="exp-heading"><span class="exp-role">${escHtml(role)}</span><span class="exp-org">${escHtml(e.company)}</span></div><div class="exp-desc">${escHtml(description)}</div>${meta}`;
        return href
            ? `<a class="experience-row" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${escHtml(copy.openProject)}: ${escHtml(e.company)}">${inner}</a>`
            : `<div class="experience-row">${inner}</div>`;
    }).join('');
    installImageTimeouts(root);
}

function renderCMSFailure(rootId) {
    const root = document.getElementById(rootId);
    if (root) root.innerHTML = `<p class="api-failure">${escHtml(copy.apiFailed)}</p>`;
}

async function loadCMSData() {
    const [projResult, expResult] = await Promise.allSettled([
        fetchJSON(`${API_BASE}/api/projects`, {}, 6500, 1),
        fetchJSON(`${API_BASE}/api/experience`, {}, 6500, 1),
    ]);
    if (projResult.status === 'fulfilled' && Array.isArray(projResult.value)) {
        renderProjects(projResult.value);
    } else {
        renderCMSFailure('dynamic-projects');
    }
    if (expResult.status === 'fulfilled' && Array.isArray(expResult.value)) {
        renderExperience(expResult.value);
    } else {
        renderCMSFailure('dynamic-experience');
    }
}
loadCMSData();

let commentUser = null;
const authForm = document.getElementById('comment-auth-form');
const authSubmit = document.getElementById('comment-auth-submit');
const userCard = document.getElementById('comment-user-card');
const authDialog = document.getElementById('comment-auth-dialog');
const authOpen = document.getElementById('comment-auth-open');
const authClose = document.getElementById('comment-auth-close');
const authStatus = document.getElementById('comment-auth-status');
const anonFields = document.getElementById('anon-fields');
const commentForm = document.getElementById('comment-form');
const commentSubmit = document.getElementById('comment-submit');
const commentStatus = document.getElementById('comment-status');
const commentList = document.getElementById('comment-list');
const refreshComments = document.getElementById('refresh-comments');

const setStatus = (text, type = '') => {
    if (!commentStatus) return;
    commentStatus.textContent = text;
    commentStatus.className = `form-status ${type}`.trim();
};
const setAuthStatus = (text, type = '') => {
    if (!authStatus) return;
    authStatus.textContent = text;
    authStatus.className = `form-status ${type}`.trim();
};

let authOpener = null;
function setCommentAuthMode(mode) {
    if (!authForm) return;
    document.querySelectorAll('[data-auth-mode]').forEach(item => item.classList.toggle('active', item.dataset.authMode === mode));
    authForm.querySelector('[name="mode"]').value = mode;
    authSubmit.textContent = mode === 'register' ? copy.createAccount : copy.login;
    authForm.querySelectorAll('.register-only').forEach(el => el.classList.toggle('hidden', mode !== 'register'));
    document.getElementById('comment-auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    if (mode === 'register') renderRegisterTurnstile().catch(() => setAuthStatus(copy.accountFailed, 'error'));
    else window.PortfolioTurnstile.remove('register-turnstile');
}
function openCommentAuthDialog(mode = 'login') {
    if (!authDialog) return;
    authOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCommentAuthMode(mode);
    setAuthStatus('');
    if (typeof authDialog.showModal === 'function') authDialog.showModal();
    else authDialog.setAttribute('open', '');
    document.getElementById('comment-auth-email')?.focus();
}
function closeCommentAuthDialog({ restoreFocus = true } = {}) {
    if (!authDialog) return;
    if (authDialog.open && typeof authDialog.close === 'function') authDialog.close();
    else authDialog.removeAttribute('open');
    window.PortfolioTurnstile.remove('register-turnstile');
    if (restoreFocus) authOpener?.focus();
}

const MAX_AVATAR_PX = 256;
const MAX_AVATAR_BYTES = 200 * 1024;

function resizeAndCompressAvatar(file) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve('');
        if (file.size > 2 * 1024 * 1024) return reject(new Error(copy.avatarTooBig));
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
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error(copy.avatarUnreadable)); };
        img.src = objectUrl;
    });
}

function renderCommentUser() {
    if (!userCard || !anonFields) return;
    if (!commentUser) {
        authOpen?.classList.remove('hidden');
        userCard.classList.add('hidden');
        anonFields.classList.remove('hidden');
        return;
    }
    authOpen?.classList.add('hidden');
    userCard.classList.remove('hidden');
    anonFields.classList.add('hidden');
    userCard.innerHTML = `
        <div class="comment-avatar">${commentUser.avatar_url ? `<img src="${safeUrl(commentUser.avatar_url)}" alt="${escHtml(commentUser.name)}">` : escHtml(initials(commentUser.name))}</div>
        <div><strong>${escHtml(commentUser.name)}</strong><span>${escHtml(commentUser.email)}</span></div>
        <button type="button" id="comment-logout" class="btn-ghost">${escHtml(copy.logout)}</button>`;
    installImageTimeouts(userCard);
    document.getElementById('comment-logout')?.addEventListener('click', async () => {
        try { await fetchJSON(`${API_BASE}/api/comment/logout`, { method: 'POST', credentials: 'include' }); } catch {}
        commentUser = null;
        renderCommentUser();
    });
}

async function loadCommentMe() {
    try {
        const json = await fetchJSON(`${API_BASE}/api/comment/me`, { credentials: 'include' });
        commentUser = json.user || null;
    } catch { commentUser = null; }
    renderCommentUser();
}

async function loadComments() {
    if (!commentList) return;
    commentList.innerHTML = `<div class="empty-note">${escHtml(copy.loadingComments)}</div>`;
    try {
        const comments = await fetchJSON(`${API_BASE}/api/comments`);
        if (!Array.isArray(comments) || !comments.length) {
            commentList.innerHTML = `<div class="empty-note">${escHtml(copy.emptyComments)}</div>`;
            return;
        }
        commentList.innerHTML = comments.map(comment => `
            <article class="comment-item">
                <div class="comment-avatar">${comment.avatar_url ? `<img src="${safeUrl(comment.avatar_url)}" alt="${escHtml(comment.author_name)}">` : escHtml(initials(comment.author_name))}</div>
                <div>
                    <div class="comment-meta"><span class="comment-author">${escHtml(comment.author_name)}</span> · <time>${escHtml(new Date(comment.created_at).toLocaleDateString())}</time></div>
                    <p class="comment-text">${escHtml(comment.body)}</p>
                </div>
            </article>`).join('');
        installImageTimeouts(commentList);
    } catch {
        commentList.innerHTML = `<div class="empty-note error">${escHtml(isLocal ? copy.localBackend : copy.commentsFailed)}</div>`;
    }
}

document.querySelectorAll('[data-auth-mode]').forEach(tab => {
    tab.addEventListener('click', () => setCommentAuthMode(tab.dataset.authMode));
});

authOpen?.addEventListener('click', () => openCommentAuthDialog('login'));
authClose?.addEventListener('click', () => closeCommentAuthDialog());
authDialog?.addEventListener('click', event => {
    if (event.target === authDialog) closeCommentAuthDialog();
});
authDialog?.addEventListener('cancel', event => {
    event.preventDefault();
    closeCommentAuthDialog();
});

authForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (authSubmit.disabled) return;
    authSubmit.disabled = true;
    const original = authSubmit.textContent;
    authSubmit.textContent = copy.working;
    setAuthStatus('');
    let mode = 'login';
    try {
        const fd = new FormData(authForm);
        mode = fd.get('mode');
        const avatarFile = document.getElementById('comment-avatar')?.files?.[0];
        const body = { email: fd.get('email'), password: fd.get('password') };
        if (mode === 'register') {
            body.name = fd.get('name');
            body.avatar_data = await resizeAndCompressAvatar(avatarFile);
            await renderRegisterTurnstile();
            body.turnstile = window.PortfolioTurnstile.getToken('register-turnstile');
        }
        const json = await fetchJSON(`${API_BASE}/api/comment/${mode}`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        }, 10000);
        commentUser = json.user;
        authForm.reset();
        setCommentAuthMode('login');
        renderCommentUser();
        closeCommentAuthDialog();
        setStatus(mode === 'register' ? copy.accountReady : copy.loggedIn, 'success');
    } catch (err) {
        setAuthStatus(err.message || copy.accountFailed, 'error');
    } finally {
        if (mode === 'register') window.PortfolioTurnstile.reset('register-turnstile');
        authSubmit.disabled = false;
        authSubmit.textContent = original;
    }
});

commentForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (commentSubmit.disabled) return;
    commentSubmit.disabled = true;
    const original = commentSubmit.textContent;
    commentSubmit.textContent = copy.posting;
    setStatus(copy.checking);
    try {
        await renderCommentTurnstile();
        const fd = new FormData(commentForm);
        const json = await fetchJSON(`${API_BASE}/api/comments`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                body: fd.get('body'),
                anonymous_name: fd.get('anonymous_name'),
                anonymous_email: fd.get('anonymous_email'),
                website_url: fd.get('website_url'),
                turnstile: window.PortfolioTurnstile.getToken('comment-turnstile'),
            })
        }, 10000);
        if (!json.ok) throw new Error(json.error || copy.commentFailed);
        commentForm.reset();
        window.PortfolioTurnstile.reset('comment-turnstile');
        setStatus(json.message || copy.commentPosted, json.status === 'pending' ? '' : 'success');
        await loadComments();
    } catch (err) {
        window.PortfolioTurnstile.reset('comment-turnstile');
        setStatus(err.message || copy.commentFailed, 'error');
    } finally {
        commentSubmit.disabled = false;
        commentSubmit.textContent = original;
    }
});

commentForm?.addEventListener('focusin', () => renderCommentTurnstile().catch(() => {}), { once: true });

refreshComments?.addEventListener('click', loadComments);
loadCommentMe();
loadComments();
