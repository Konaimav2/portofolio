(() => {
    const LOCAL_API = 'http://localhost:3001/api';
    const LOCAL_API_ALT = 'http://127.0.0.1:3001/api';
    const PROD_API = 'https://api.arraffi.com/api';
    const isLocalHost = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
    const params = new URLSearchParams(location.search);
    const requestedApi = params.get('api');
    const allowedApiOverrides = new Set([LOCAL_API, LOCAL_API_ALT, PROD_API]);
    const API = requestedApi && allowedApiOverrides.has(requestedApi)
        ? requestedApi
        : (isLocalHost ? `http://${location.hostname}:3001/api` : PROD_API);
    const TURNSTILE_SITE_KEY = isLocalHost
        ? '1x00000000000000000000AA'
        : '0x4AAAAAADMAtXOh4MijdApa';
    const TURNSTILE_TIMEOUT_MS = 9000;
    const API_TIMEOUT_MS = 12000;

    const state = {
        tab: 'projects',
        loggedIn: false,
        csrf: '',
        saving: false,
        refreshing: false,
        loadError: '',
        lastSyncedAt: null,
        projects: [],
        experience: [],
        comments: [],
    };

    const $ = (selector) => document.querySelector(selector);
    const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
    const safeUrl = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        try {
            const url = new URL(raw, location.origin);
            if (!['http:', 'https:'].includes(url.protocol)) return '';
            return url.href;
        } catch { return ''; }
    };
    const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
    const setBusy = (busy) => { state.saving = busy; render(); };

    let toastTimer = null;
    function showToast(message, type = 'success') {
        const toast = $('#toast');
        toast.className = `save-toast show${type === 'error' ? ' error' : ''}`;
        toast.innerHTML = `<span class="tick">${type === 'error' ? '!' : '✓'}</span><span>${esc(message)}</span>`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), type === 'error' ? 7000 : 5000);
    }
    const toastError = (err) => showToast(err?.message || 'Request failed', 'error');

    async function requestJson(path, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeout || API_TIMEOUT_MS);
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        if (state.csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(options.method || 'GET').toUpperCase())) {
            headers['X-CSRF-Token'] = state.csrf;
        }
        try {
            const response = await fetch(`${API}${path}`, {
                credentials: 'include',
                signal: controller.signal,
                ...options,
                headers,
            });
            const text = await response.text();
            const data = text ? JSON.parse(text) : {};
            if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
            return data;
        } catch (err) {
            if (err.name === 'AbortError') throw new Error('API request timed out. VPS or database is slow.');
            throw err;
        } finally {
            clearTimeout(timeout);
        }
    }

    function renderAdminTurnstile() {
        return window.PortfolioTurnstile.render('admin-turnstile', {
            sitekey: TURNSTILE_SITE_KEY,
            theme: 'dark',
            action: 'admin_login',
        });
    }

    async function waitForTurnstileToken() {
        await renderAdminTurnstile();
        return new Promise((resolve) => {
            const started = Date.now();
            const tick = () => {
                const token = window.PortfolioTurnstile.getToken('admin-turnstile');
                if (token || Date.now() - started > TURNSTILE_TIMEOUT_MS) return resolve(token);
                setTimeout(tick, 120);
            };
            tick();
        });
    }

    async function login(event) {
        event.preventDefault();
        const button = $('#login-button');
        const password = $('#admin-password');
        const error = $('#login-error');
        error.classList.add('hidden');
        button.disabled = true;
        button.textContent = 'Checking...';
        try {
            const turnstile = await waitForTurnstileToken();
            if (!turnstile) throw new Error('Complete Turnstile verification before signing in.');
            const data = await requestJson('/admin/login', {
                method: 'POST',
                body: JSON.stringify({ password: password.value, turnstile }),
                timeout: 15000,
            });
            state.csrf = data.csrfToken || '';
            state.loggedIn = true;
            password.value = '';
            render();
            await fetchAll();
            render();
        } catch (err) {
            const message = err.message || 'Wrong password.';
            error.textContent = message;
            error.classList.remove('hidden');
            if (/turnstile/i.test(message)) {
                window.PortfolioTurnstile.reset('admin-turnstile');
            } else {
                password.value = '';
            }
        } finally {
            button.disabled = false;
            button.textContent = 'Sign In';
        }
    }

    async function logout() {
        try { await requestJson('/admin/logout', { method: 'POST' }); } catch {}
        state.csrf = '';
        state.loggedIn = false;
        render();
    }

    async function fetchAll() {
        const [projects, experience, comments] = await Promise.allSettled([
            requestJson('/admin/projects'),
            requestJson('/admin/experience'),
            requestJson('/admin/comments'),
        ]);
        if (projects.status === 'fulfilled') state.projects = projects.value;
        if (experience.status === 'fulfilled') state.experience = experience.value;
        if (comments.status === 'fulfilled') state.comments = comments.value;
        const failed = [projects, experience, comments].filter((result) => result.status === 'rejected');
        state.loadError = failed.length ? `Could not refresh ${failed.length === 1 ? 'one section' : `${failed.length} sections`}.` : '';
        if (!state.loadError) state.lastSyncedAt = new Date();
        return !state.loadError;
    }

    async function refreshDashboard() {
        if (state.saving || state.refreshing) return;
        state.refreshing = true;
        render();
        try {
            const refreshed = await fetchAll();
            if (refreshed) showToast('Content refreshed');
            else showToast(state.loadError, 'error');
        } finally {
            state.refreshing = false;
            render();
        }
    }

    function field(label, name, value = '', type = 'text') {
        const isText = type === 'textarea';
        return `<div class="field"><label><span>${esc(label)}</span>${isText
            ? `<textarea name="${esc(name)}">${esc(value)}</textarea>`
            : `<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}">`}</label></div>`;
    }

    function mediaPreview(value, label) {
        const source = safeUrl(value);
        return `<div class="media-preview${source ? ' has-media' : ''}" data-media-preview>
            <img src="${esc(source)}" alt="${esc(label)} preview">
            <span>${source ? 'Current media preview' : 'Media preview appears here'}</span>
        </div>`;
    }

    function projectForm(project = {}) {
        return `<div class="editor-layout editor-layout-project">
            <div class="editor-main">
                <section class="editor-section">
                    <h3 class="editor-section-title">Project details</h3>
                    <div class="field-grid">
                        ${field('Title (English)', 'title', project.title)}
                        ${field('Title (Indonesian)', 'title_id', project.title_id)}
                        ${field('Description (English)', 'description', project.description, 'textarea')}
                        ${field('Description (Indonesian)', 'description_id', project.description_id, 'textarea')}
                    </div>
                </section>
            </div>
            <aside class="editor-aside">
                <section class="editor-section">
                    <h3 class="editor-section-title">Media and layout</h3>
                    ${field('Project URL', 'url', project.url, 'url')}
                    ${field('Image URL', 'image_url', project.image_url, 'url')}
                    ${mediaPreview(project.image_url || project.image_url_fallback, project.title || 'Project')}
                    <button class="toggle-row" type="button" role="switch" aria-checked="${project.full_width ? 'true' : 'false'}" data-width-switch>
                        <span><strong>Wide project card</strong><small>Span extra room in selected work.</small></span>
                        <span class="toggle-control" aria-hidden="true"></span>
                    </button>
                    <input name="full_width" type="hidden" value="${project.full_width ? '1' : '0'}">
                </section>
            </aside>
        </div>`;
    }

    function expForm(exp = {}) {
        return `<div class="editor-layout">
            <div class="editor-main">
                <section class="editor-section">
                    <h3 class="editor-section-title">Experience details</h3>
                    <div class="field-grid">
                        ${field('Company', 'company', exp.company)}
                        ${field('Date range', 'date_range', exp.date_range)}
                        ${field('Role (English)', 'role', exp.role)}
                        ${field('Role (Indonesian)', 'role_id', exp.role_id)}
                        ${field('Description (English)', 'description', exp.description, 'textarea')}
                        ${field('Description (Indonesian)', 'description_id', exp.description_id, 'textarea')}
                    </div>
                </section>
            </div>
            <aside class="editor-aside">
                <section class="editor-section">
                    <h3 class="editor-section-title">Link and logo</h3>
                    ${field('Link URL', 'url', exp.url, 'url')}
                    ${field('Logo URL', 'logo_url', exp.logo_url, 'url')}
                    ${mediaPreview(exp.logo_url || exp.logo_url_fallback, exp.company || 'Company')}
                </section>
            </aside>
        </div>`;
    }

    function valuesFrom(form) {
        const data = Object.fromEntries(new FormData(form).entries());
        if (form.elements.full_width) data.full_width = form.elements.full_width.value === '1' ? 1 : 0;
        return data;
    }

    function requireFields(record, fields, message) {
        if (fields.some((key) => !String(record[key] || '').trim())) {
            showToast(message, 'error');
            return false;
        }
        return true;
    }

    function confirmModal(title, text, confirmText = 'Delete') {
        return new Promise((resolve) => {
            const root = $('#modal-root');
            let settled = false;
            root.classList.remove('hidden');
            root.innerHTML = `<div class="modal-card confirm-card">
                <div class="modal-title">${esc(title)}</div>
                <p class="confirm-text">${esc(text)}</p>
                <div class="btn-row modal-actions">
                    <button class="btn" type="button" data-action="cancel">Cancel</button>
                    <button class="btn btn-danger" type="button" data-action="confirm">${esc(confirmText)}</button>
                </div>
            </div>`;
            root.onclick = (event) => {
                if (settled) return;
                const action = event.target?.dataset?.action;
                if (!action && event.target !== root) return;
                settled = true;
                root.querySelectorAll('button').forEach((button) => { button.disabled = true; });
                root.classList.add('hidden');
                root.innerHTML = '';
                root.onclick = null;
                resolve(action === 'confirm');
            };
        });
    }

    function editModal(title, formHtml, onSave) {
        const root = $('#modal-root');
        let submitting = false;
        root.classList.remove('hidden');
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-labelledby', 'editor-title');
        root.innerHTML = `<form class="modal-card edit-form">
            <div class="modal-head">
                <div><h2 id="editor-title" class="modal-title">${esc(title)}</h2><p class="modal-copy">Changes publish after this form saves successfully.</p></div>
                <button class="modal-close icon-button" type="button" data-action="close" aria-label="Close editor"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </div>
            ${formHtml}
            <div class="btn-row modal-actions">
                <button class="btn" type="button" data-action="cancel">Cancel</button>
                <button class="btn btn-primary" type="submit"><i class="fa-solid fa-check" aria-hidden="true"></i>Save changes</button>
            </div>
        </form>`;
        const form = root.querySelector('form');
        const mediaInput = form.elements.image_url || form.elements.logo_url;
        const preview = form.querySelector('[data-media-preview]');
        if (mediaInput && preview) {
            const image = preview.querySelector('img');
            const label = preview.querySelector('span');
            const refreshPreview = () => {
                const source = safeUrl(mediaInput.value);
                image.src = source;
                preview.classList.toggle('has-media', Boolean(source));
                label.textContent = source ? 'Current media preview' : 'Media preview appears here';
            };
            mediaInput.addEventListener('input', refreshPreview);
        }
        const widthSwitch = form.querySelector('[data-width-switch]');
        const fullWidth = form.elements.full_width;
        if (widthSwitch && fullWidth) {
            widthSwitch.addEventListener('click', () => {
                const wide = widthSwitch.getAttribute('aria-checked') !== 'true';
                widthSwitch.setAttribute('aria-checked', String(wide));
                fullWidth.value = wide ? '1' : '0';
            });
        }
        root.onclick = (event) => {
            if (submitting) return;
            const action = event.target.closest?.('[data-action]')?.dataset?.action;
            if (event.target === root || action === 'cancel' || action === 'close') closeModal();
        };
        form.onsubmit = async (event) => {
            event.preventDefault();
            if (submitting) return;
            submitting = true;
            const form = event.currentTarget;
            const buttons = form.querySelectorAll('button');
            const saveButton = form.querySelector('[type="submit"]');
            buttons.forEach((button) => { button.disabled = true; });
            saveButton.textContent = 'Saving…';
            const saved = await onSave(valuesFrom(form));
            if (saved) {
                closeModal();
                return;
            }
            submitting = false;
            buttons.forEach((button) => { button.disabled = false; });
            saveButton.textContent = 'Save';
        };
    }

    function closeModal() {
        const root = $('#modal-root');
        root.classList.add('hidden');
        root.removeAttribute('role');
        root.removeAttribute('aria-modal');
        root.removeAttribute('aria-labelledby');
        root.innerHTML = '';
        root.onclick = null;
    }

    function recordThumb(source, label, icon) {
        const url = safeUrl(source);
        return url
            ? `<img class="record-thumb" src="${esc(url)}" alt="${esc(label)}">`
            : `<div class="record-thumb thumb-empty" aria-hidden="true"><i class="fa-solid ${esc(icon)}"></i></div>`;
    }

    function orderControls(kind, item, index, length) {
        const label = kind === 'projects' ? 'Project' : 'Experience';
        const up = kind === 'projects' ? 'project-up' : 'exp-up';
        const down = kind === 'projects' ? 'project-down' : 'exp-down';
        return `<div class="record-order" aria-label="${label} order controls">
            <span class="order-index">${String(index + 1).padStart(2, '0')}</span>
            <div class="order-actions">
                <button class="order-btn" type="button" data-action="${up}" data-id="${item.id}" aria-label="Move ${label.toLowerCase()} up" title="Move up" ${state.saving || index === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up" aria-hidden="true"></i></button>
                <button class="order-btn" type="button" data-action="${down}" data-id="${item.id}" aria-label="Move ${label.toLowerCase()} down" title="Move down" ${state.saving || index === length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>
            </div>
        </div>`;
    }

    async function saveProject(record, id = null) {
        if (!requireFields(record, ['title', 'title_id', 'description', 'description_id'], 'Project needs English and Indonesian title/description.')) return false;
        setBusy(true);
        try {
            await requestJson(id ? `/admin/projects/${id}` : '/admin/projects', { method: id ? 'PUT' : 'POST', body: JSON.stringify(record) });
            await fetchAll();
            showToast(id ? 'Changes saved' : 'Project added');
            return true;
        } catch (err) { toastError(err); return false; }
        finally { setBusy(false); }
    }

    async function saveExperience(record, id = null) {
        if (!requireFields(record, ['company', 'role', 'role_id', 'date_range', 'description', 'description_id'], 'Experience needs English and Indonesian fields.')) return false;
        setBusy(true);
        try {
            await requestJson(id ? `/admin/experience/${id}` : '/admin/experience', { method: id ? 'PUT' : 'POST', body: JSON.stringify(record) });
            await fetchAll();
            showToast(id ? 'Changes saved' : 'Experience added');
            return true;
        } catch (err) { toastError(err); return false; }
        finally { setBusy(false); }
    }

    async function moveItem(kind, id, direction) {
        setBusy(true);
        try {
            await requestJson(`/admin/${kind}/${id}/move`, { method: 'PATCH', body: JSON.stringify({ direction }) });
            await fetchAll();
            showToast(`${kind === 'projects' ? 'Project' : 'Experience'} order updated`);
        } catch (err) { toastError(err); }
        finally { setBusy(false); }
    }

    async function deleteItem(kind, id) {
        const label = kind === 'projects' ? 'Project' : kind === 'experience' ? 'Experience' : 'Comment';
        if (!await confirmModal(`Delete ${label}?`, `This permanently removes this ${label.toLowerCase()}.`)) return;
        setBusy(true);
        try {
            await requestJson(`/admin/${kind}/${id}`, { method: 'DELETE' });
            await fetchAll();
            showToast(`${label} deleted`);
        } catch (err) { toastError(err); }
        finally { setBusy(false); }
    }

    async function approveComment(id) {
        setBusy(true);
        try {
            await requestJson(`/admin/comments/${id}/approve`, { method: 'PATCH' });
            await fetchAll();
            showToast('Comment approved');
        } catch (err) { toastError(err); }
        finally { setBusy(false); }
    }

    function renderProjects() {
        const projects = state.projects.map((project, index) => {
            const media = project.image_url || project.image_url_fallback;
            return `<article class="record-card">
                ${orderControls('projects', project, index, state.projects.length)}
                <div class="record-main">
                    ${recordThumb(media, project.title, 'fa-image')}
                    <div class="record-copy">
                        <div class="record-kicker"><span>Project ${project.full_width ? '· Wide' : ''}</span>${project.image_url_fallback ? '<span class="source-state">R2 fallback</span>' : ''}</div>
                        <h3 class="record-title">${esc(project.title)}</h3>
                        <p class="record-sub">${esc(project.description)}</p>
                    </div>
                </div>
                <div class="record-actions">
                    <button class="btn btn-edit" type="button" data-action="edit-project" data-id="${project.id}" aria-label="Edit ${esc(project.title)}" title="Edit project"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                    <button class="btn btn-danger btn-edit" type="button" data-action="delete-project" data-id="${project.id}" aria-label="Delete ${esc(project.title)}" title="Delete project"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
                </div>
            </article>`;
        }).join('');
        $('#projects-panel').innerHTML = `<div class="panel-head">
            <div><h2>Selected work</h2><p class="panel-copy">Compact cards shown in portfolio order.</p></div>
            <button class="btn btn-primary add-button" type="button" data-action="add-project" ${state.saving ? 'disabled' : ''}><i class="fa-solid fa-plus" aria-hidden="true"></i>Add project</button>
        </div><div class="record-list">${projects || '<div class="empty">No projects yet. Add first project.</div>'}</div>`;
    }

    function renderExperience() {
        const experience = state.experience.map((exp, index) => {
            const media = exp.logo_url || exp.logo_url_fallback;
            return `<article class="record-card">
                ${orderControls('experience', exp, index, state.experience.length)}
                <div class="record-main">
                    ${recordThumb(media, exp.company, 'fa-building')}
                    <div class="record-copy">
                        <div class="record-kicker"><span>${esc(exp.date_range)}</span>${exp.logo_url_fallback ? '<span class="source-state">R2 fallback</span>' : ''}</div>
                        <h3 class="record-title">${esc(exp.company)}</h3>
                        <p class="record-sub">${esc(exp.role)}</p>
                    </div>
                </div>
                <div class="record-actions">
                    <button class="btn btn-edit" type="button" data-action="edit-exp" data-id="${exp.id}" aria-label="Edit ${esc(exp.company)}" title="Edit experience"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                    <button class="btn btn-danger btn-edit" type="button" data-action="delete-exp" data-id="${exp.id}" aria-label="Delete ${esc(exp.company)}" title="Delete experience"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
                </div>
            </article>`;
        }).join('');
        $('#experience-panel').innerHTML = `<div class="panel-head">
            <div><h2>Career path</h2><p class="panel-copy">Keep order aligned with public timeline.</p></div>
            <button class="btn btn-primary add-button" type="button" data-action="add-exp" ${state.saving ? 'disabled' : ''}><i class="fa-solid fa-plus" aria-hidden="true"></i>Add experience</button>
        </div><div class="record-list">${experience || '<div class="empty">No experience yet. Add first entry.</div>'}</div>`;
    }

    function renderComments() {
        $('#comment-count').textContent = String(state.comments.length);
        $('#comment-count').classList.toggle('hidden', state.comments.length === 0);
        const comments = state.comments.map((comment) => {
            const approved = comment.status === 'approved';
            return `<article class="record-card comment-card">
                <div class="record-main">
                    <div class="record-copy">
                        <div class="record-kicker"><span class="comment-status${approved ? ' approved' : ''}">${approved ? 'Approved' : 'Needs review'}</span><span>${esc(comment.created_at || '')}</span></div>
                        <h3 class="record-title">${esc(comment.author_name || 'Anonymous')}</h3>
                        <p class="record-sub">${esc(comment.author_email || 'anonymous')}\n${esc(comment.body)}</p>
                    </div>
                </div>
                <div class="record-actions">
                    ${approved ? '' : `<button class="btn btn-primary" type="button" data-action="approve-comment" data-id="${comment.id}"><i class="fa-solid fa-check" aria-hidden="true"></i>Approve</button>`}
                    <button class="btn btn-danger btn-edit" type="button" data-action="delete-comment" data-id="${comment.id}" aria-label="Delete comment from ${esc(comment.author_name || 'anonymous')}" title="Delete comment"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
                </div>
            </article>`;
        }).join('');
        $('#comments-panel').innerHTML = `<div class="panel-head">
            <div><h2>Comment moderation</h2><p class="panel-copy">Approve useful replies. Delete spam or unwanted messages.</p></div>
        </div><div class="record-list">${comments || '<div class="empty">No comments waiting for review.</div>'}</div>`;
    }

    function renderDashboardMeta() {
        const labels = { projects: 'Projects', experience: 'Experience', comments: 'Comments' };
        const pending = state.comments.filter((comment) => comment.status !== 'approved').length;
        setText('#workspace-title', labels[state.tab] || 'Portfolio');
        setText('#project-total', String(state.projects.length));
        setText('#experience-total', String(state.experience.length));
        setText('#pending-total', String(pending));
        const status = $('#dashboard-status');
        const refresh = document.querySelector('[data-action="refresh"]');
        if (!status) return;
        status.classList.toggle('is-error', Boolean(state.loadError));
        status.classList.toggle('is-loading', state.refreshing);
        status.textContent = state.refreshing
            ? 'Refreshing content…'
            : state.loadError || (state.lastSyncedAt ? 'Synced' : 'Ready');
        refresh?.classList.toggle('is-spinning', state.refreshing);
        if (refresh) refresh.disabled = state.saving || state.refreshing;
    }

    function render() {
        $('#login-view').classList.toggle('hidden', state.loggedIn);
        $('#admin-view').classList.toggle('hidden', !state.loggedIn);
        document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === state.tab));
        document.querySelectorAll('.panel').forEach((panel) => panel.classList.add('hidden'));
        $(`#${state.tab}-panel`)?.classList.remove('hidden');
        if (!state.loggedIn) return;
        renderDashboardMeta();
        renderProjects();
        renderExperience();
        renderComments();
    }

    document.addEventListener('click', async (event) => {
        const target = event.target.closest('[data-action], [data-tab]');
        if (!target) return;
        const id = Number(target.dataset.id);
        if (target.dataset.tab) {
            state.tab = target.dataset.tab;
            render();
            return;
        }
        const action = target.dataset.action;
        if (state.saving && action) return;
        if (action === 'refresh') return refreshDashboard();
        if (action === 'add-project') return editModal('Add Project', projectForm(), (data) => saveProject(data));
        if (action === 'edit-project') {
            const project = state.projects.find((item) => Number(item.id) === id);
            return editModal(`Editing ${project?.title || 'Project'}`, projectForm(project), (data) => saveProject(data, id));
        }
        if (action === 'delete-project') return deleteItem('projects', id);
        if (action === 'project-up') return moveItem('projects', id, 'up');
        if (action === 'project-down') return moveItem('projects', id, 'down');
        if (action === 'add-exp') return editModal('Add Experience', expForm(), (data) => saveExperience(data));
        if (action === 'edit-exp') {
            const exp = state.experience.find((item) => Number(item.id) === id);
            return editModal(`Editing ${exp?.company || 'Experience'}`, expForm(exp), (data) => saveExperience(data, id));
        }
        if (action === 'delete-exp') return deleteItem('experience', id);
        if (action === 'exp-up') return moveItem('experience', id, 'up');
        if (action === 'exp-down') return moveItem('experience', id, 'down');
        if (action === 'approve-comment') return approveComment(id);
        if (action === 'delete-comment') return deleteItem('comments', id);
    });

    $('#login-form').addEventListener('submit', login);
    $('#logout-button').addEventListener('click', logout);

    (async () => {
        try {
            const res = await requestJson('/admin/check');
            if (res.ok) {
                state.csrf = res.csrfToken || '';
                state.loggedIn = true;
                await fetchAll();
            }
        } catch {}
        render();
        if (!state.loggedIn) renderAdminTurnstile().catch(() => {});
    })();
})();
