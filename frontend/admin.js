(() => {
    const LOCAL_API = 'http://localhost:3001/api';
    const LOCAL_API_ALT = 'http://127.0.0.1:3001/api';
    const PROD_API = 'https://api.arraffi.com/api';
    const params = new URLSearchParams(location.search);
    const requestedApi = params.get('api');
    const allowedApiOverrides = new Set([LOCAL_API, LOCAL_API_ALT, PROD_API]);
    const API = requestedApi && allowedApiOverrides.has(requestedApi)
        ? requestedApi
        : (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? LOCAL_API : PROD_API);
    const TURNSTILE_SITE_KEY = location.hostname === '127.0.0.1' || location.hostname === 'localhost'
        ? '1x00000000000000000000AA'
        : '0x4AAAAAADMAtXOh4MijdApa';
    const TURNSTILE_TIMEOUT_MS = 9000;
    const API_TIMEOUT_MS = 12000;

    const state = {
        tab: 'projects',
        loggedIn: false,
        csrf: '',
        saving: false,
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
            if (!['http:', 'https:', 'data:'].includes(url.protocol)) return '';
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
            const data = await requestJson('/admin/login', {
                method: 'POST',
                body: JSON.stringify({ password: password.value, turnstile }),
                timeout: 15000,
            });
            state.csrf = data.csrfToken || '';
            state.loggedIn = true;
            password.value = '';
            await fetchAll();
            render();
        } catch (err) {
            error.textContent = err.message || 'Wrong password.';
            error.classList.remove('hidden');
            password.value = '';
            window.PortfolioTurnstile.reset('admin-turnstile');
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
    }

    function field(label, name, value = '', type = 'text') {
        const isText = type === 'textarea';
        return `<div class="field"><label>${esc(label)}</label>${isText
            ? `<textarea name="${esc(name)}">${esc(value)}</textarea>`
            : `<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}">`}</div>`;
    }

    function projectForm(project = {}) {
        return `
            ${field('Title (EN)', 'title', project.title)}
            ${field('Title (ID)', 'title_id', project.title_id)}
            ${field('Description (EN)', 'description', project.description, 'textarea')}
            ${field('Description (ID)', 'description_id', project.description_id, 'textarea')}
            ${field('Project URL', 'url', project.url, 'url')}
            ${field('Image URL', 'image_url', project.image_url, 'url')}
            <label class="check-label"><input name="full_width" type="checkbox" ${project.full_width ? 'checked' : ''}>Wide card</label>`;
    }

    function expForm(exp = {}) {
        return `
            ${field('Company', 'company', exp.company)}
            ${field('Role (EN)', 'role', exp.role)}
            ${field('Role (ID)', 'role_id', exp.role_id)}
            ${field('Date range', 'date_range', exp.date_range)}
            ${field('Description (EN)', 'description', exp.description, 'textarea')}
            ${field('Description (ID)', 'description_id', exp.description_id, 'textarea')}
            ${field('Logo URL', 'logo_url', exp.logo_url, 'url')}
            ${field('Link URL', 'url', exp.url, 'url')}`;
    }

    function valuesFrom(form) {
        const data = Object.fromEntries(new FormData(form).entries());
        if (form.elements.full_width) data.full_width = form.elements.full_width.checked ? 1 : 0;
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
        root.innerHTML = `<form class="modal-card edit-form">
            <div class="modal-title">${esc(title)}</div>
            ${formHtml}
            <div class="btn-row modal-actions">
                <button class="btn" type="button" data-action="cancel">Cancel</button>
                <button class="btn btn-primary" type="submit">Save</button>
            </div>
        </form>`;
        root.onclick = (event) => {
            if (submitting) return;
            if (event.target === root || event.target?.dataset?.action === 'cancel') closeModal();
        };
        root.querySelector('form').onsubmit = async (event) => {
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
        root.innerHTML = '';
        root.onclick = null;
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
        $('#projects-panel').innerHTML = `<div class="add-panel">
            <button class="add-panel-toggle" type="button" data-action="add-project" ${state.saving ? 'disabled' : ''}>+ Add New Project</button>
        </div>${state.projects.map((project, index) => `<article class="item">
            <div class="item-row">
                <div class="order-actions" aria-label="Project order controls">
                    <button class="btn order-btn" data-action="project-up" data-id="${project.id}" ${state.saving || index === 0 ? 'disabled' : ''}>↑</button>
                    <button class="btn order-btn" data-action="project-down" data-id="${project.id}" ${state.saving || index === state.projects.length - 1 ? 'disabled' : ''}>↓</button>
                </div>
                ${safeUrl(project.image_url) ? `<img class="item-thumb" src="${safeUrl(project.image_url)}" alt="${esc(project.title)}">` : '<div class="item-thumb thumb-empty"></div>'}
                <div class="item-info">
                    <div class="item-title">${esc(project.title)}${project.full_width ? '<span class="badge">Wide</span>' : ''}</div>
                    <div class="item-sub">${esc(project.description)}</div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-edit" data-action="edit-project" data-id="${project.id}">✏</button>
                    <button class="btn btn-danger" data-action="delete-project" data-id="${project.id}">🗑</button>
                </div>
            </div>
        </article>`).join('') || '<div class="empty">No projects yet. Add one above.</div>'}`;
    }

    function renderExperience() {
        $('#experience-panel').innerHTML = `<div class="add-panel">
            <button class="add-panel-toggle" type="button" data-action="add-exp" ${state.saving ? 'disabled' : ''}>+ Add Experience</button>
        </div>${state.experience.map((exp, index) => `<article class="item">
            <div class="item-row">
                <div class="order-actions" aria-label="Experience order controls">
                    <button class="btn order-btn" data-action="exp-up" data-id="${exp.id}" ${state.saving || index === 0 ? 'disabled' : ''}>↑</button>
                    <button class="btn order-btn" data-action="exp-down" data-id="${exp.id}" ${state.saving || index === state.experience.length - 1 ? 'disabled' : ''}>↓</button>
                </div>
                ${safeUrl(exp.logo_url) ? `<img class="item-thumb" src="${safeUrl(exp.logo_url)}" alt="${esc(exp.company)}">` : '<div class="item-thumb thumb-empty"></div>'}
                <div class="item-info">
                    <div class="item-title">${esc(exp.company)}</div>
                    <div class="item-sub">${esc(exp.role)} · ${esc(exp.date_range)}</div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-edit" data-action="edit-exp" data-id="${exp.id}">✏</button>
                    <button class="btn btn-danger" data-action="delete-exp" data-id="${exp.id}">🗑</button>
                </div>
            </div>
        </article>`).join('') || '<div class="empty">No experience yet. Add one above.</div>'}`;
    }

    function renderComments() {
        $('#comment-count').textContent = String(state.comments.length);
        $('#comment-count').classList.toggle('hidden', state.comments.length === 0);
        $('#comments-panel').innerHTML = state.comments.map((comment) => `<article class="item comment-item">
            <div class="item-row align-start">
                <div class="item-info">
                    <div class="item-title">${esc(comment.author_name)} <span class="badge">${esc(comment.status)}</span></div>
                    <div class="item-sub">${esc(comment.author_email || 'anonymous')} · ${esc(comment.created_at || '')}</div>
                    <p class="comment-body">${esc(comment.body)}</p>
                </div>
                <div class="item-actions">
                    ${comment.status !== 'approved' ? `<button class="btn btn-primary" data-action="approve-comment" data-id="${comment.id}">Approve</button>` : ''}
                    <button class="btn btn-danger" data-action="delete-comment" data-id="${comment.id}">🗑</button>
                </div>
            </div>
        </article>`).join('') || '<div class="empty">No comments waiting.</div>';
    }

    function render() {
        $('#login-view').classList.toggle('hidden', state.loggedIn);
        $('#admin-view').classList.toggle('hidden', !state.loggedIn);
        document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === state.tab));
        document.querySelectorAll('.panel').forEach((panel) => panel.classList.add('hidden'));
        $(`#${state.tab}-panel`)?.classList.remove('hidden');
        if (!state.loggedIn) return;
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
