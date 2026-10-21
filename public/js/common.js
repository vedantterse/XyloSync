// Shared helpers for every XyloSync page.

/* ---------- icons (outline, 1.6px; inlined so nothing loads from a CDN) ---------- */

const PATHS = {
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    note: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/>',
    send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.63l-19 6.5a.5.5 0 0 0-.03.93l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.93"/>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    reply: '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
    moreH: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    blank: '',
    door: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>'
};

export const icon = (name, cls = '') =>
    `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] ?? PATHS.note}</svg>`;

export const mark = () => `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="currentColor"/><path d="M7 9.5h10M7 14.5h10" stroke="var(--mark-ink, #fff)" stroke-width="2" stroke-linecap="round"/><circle cx="17" cy="9.5" r="2.2" fill="var(--signal)"/></svg>`;

/* ---------- formatting ---------- */

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);

export function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** i;
    return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function timeAgo(date) {
    const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 45) return 'just now';
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
    if (abs < 604800) return rtf.format(Math.round(seconds / 86400), 'day');
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const clockTime = (date) => new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    if (seconds < 60) return `${Math.ceil(seconds)}s left`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}m left`;
    return `${(seconds / 3600).toFixed(1)}h left`;
}

/* ---------- file types ---------- */

const KINDS = [
    ['image', 'png jpg jpeg gif webp avif bmp svg heic heif ico tif tiff'],
    ['video', 'mp4 mov webm mkv avi m4v wmv 3gp'],
    ['audio', 'mp3 wav flac ogg oga m4a aac opus'],
    ['pdf', 'pdf'],
    ['doc', 'doc docx odt rtf pages'],
    ['sheet', 'xls xlsx ods numbers csv tsv'],
    ['slides', 'ppt pptx odp key'],
    ['archive', 'zip rar 7z tar gz tgz bz2 xz zst iso dmg'],
    ['code', 'js mjs cjs ts tsx jsx py rb go rs java kt c h cpp hpp cs php swift sh bash ps1 sql css scss html htm vue svelte json xml yml yaml toml ini env'],
    ['text', 'txt md markdown log cfg conf']
];
const BY_EXT = new Map(KINDS.flatMap(([kind, exts]) => exts.split(' ').map((e) => [e, kind])));

export function fileExt(name) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileKind(name, mime = '') {
    const ext = fileExt(name);
    const kind = BY_EXT.get(ext) || (mime.startsWith('text/') ? 'text' : (mime.split('/')[0] || 'file'));
    return { kind, ext };
}

// A file is labelled by its extension, set as type: no coloured icon per category.
export function extLabel(name) {
    const ext = fileExt(name);
    return ext ? ext.slice(0, 5).toUpperCase() : 'FILE';
}

/* ---------- people ---------- */

export function initials(name) {
    const clean = String(name || '?').replace(/[0-9]+$/, '');
    const parts = clean.split(/(?=[A-Z])|[\s_-]+/).filter(Boolean);
    return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

// Each person gets a stable hue; tints stay pale so they read as identity, not data.
export function hueFor(key) {
    let hash = 0;
    for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return (hash % 12) * 30;
}

export const avatar = (name, key = name, cls = '') =>
    `<span class="avatar ${cls}" style="--hue:${hueFor(key)}" title="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`;

/* ---------- network ---------- */

export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const init = { method, credentials: 'same-origin', headers: { ...headers } };
    if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
        res = await fetch(path, init);
    } catch {
        throw new ApiError('Network error. Check your connection.', 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new ApiError(data.message || `Request failed (${res.status})`, res.status);
    return data;
}

// Streams the raw file body (no multipart) so the server can pipe it straight to storage.
export function uploadRaw(url, file, { method = 'POST', onProgress } = {}) {
    const xhr = new XMLHttpRequest();
    const promise = new Promise((resolve, reject) => {
        xhr.open(method, url);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
        xhr.setRequestHeader('X-File-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded, e.total);
        xhr.onload = () => {
            let data = {};
            try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
            if (xhr.status >= 200 && xhr.status < 300) resolve(data);
            else reject(new ApiError(data.message || `Upload failed (${xhr.status})`, xhr.status));
        };
        xhr.onerror = () => reject(new ApiError('Network error during upload.', 0));
        xhr.onabort = () => reject(new ApiError('Upload cancelled.', 499));
        xhr.send(file);
    });
    return { promise, abort: () => xhr.abort() };
}

// crypto.randomUUID only exists in secure contexts; LAN access over plain http needs a fallback.
export function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- DOM helpers ---------- */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Values interpolated here must already be escaped (escapeHtml) or be trusted markup (icon()).
export function html(strings, ...values) {
    const template = document.createElement('template');
    template.innerHTML = String.raw({ raw: strings }, ...values).trim();
    return template.content.firstElementChild;
}

export const hydrateIcons = (root = document) => $$('[data-icon]', root).forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, el.dataset.iconClass || '');
});

export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Clipboard API needs a secure context; fall back for plain-http LAN access.
        const area = Object.assign(document.createElement('textarea'), { value: text });
        area.style.cssText = 'position:fixed;opacity:0';
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }
}

/* ---------- toasts ---------- */
// Top-right stack in the spirit of Sonner: new toasts slide in from the right and sit in
// front; older ones tuck in behind, smaller, and fan out when hovered. Transitions (not
// keyframes) so rapid toasts retarget smoothly; timers pause on hover and in hidden tabs.

const TOAST_GAP = 10;
const TOAST_PEEK = 12;
const TOAST_VISIBLE = 3;
const toastState = { root: null, items: [], expanded: false };

function toastRoot() {
    if (toastState.root) return toastState.root;
    const root = html`<ol class="toasts" aria-live="polite" aria-label="Notifications"></ol>`;
    root.addEventListener('pointerenter', () => { toastState.expanded = true; layoutToasts(); pauseToasts(true); });
    root.addEventListener('pointerleave', () => { toastState.expanded = false; layoutToasts(); pauseToasts(false); });
    document.addEventListener('visibilitychange', () => pauseToasts(document.hidden || toastState.expanded));
    document.body.append(root);
    toastState.root = root;
    return root;
}

function layoutToasts() {
    const { items, expanded, root } = toastState;
    const front = items[0];
    let offset = 0;
    items.forEach((t, i) => {
        const hidden = i >= TOAST_VISIBLE;
        t.el.style.zIndex = String(100 - i);
        t.el.dataset.front = String(i === 0);
        if (expanded) {
            t.el.style.height = `${t.height}px`;
            t.el.style.transform = `translate3d(${t.dragX}px, ${offset}px, 0)`;
            t.el.style.opacity = hidden ? '0' : '1';
            offset += t.height + TOAST_GAP;
        } else {
            // Collapsed: older toasts take the front toast's height and peek out underneath it.
            t.el.style.height = `${front.height}px`;
            t.el.style.transform = `translate3d(${t.dragX}px, ${i * TOAST_PEEK}px, 0) scale(${1 - i * 0.05})`;
            t.el.style.opacity = hidden ? '0' : '1';
        }
        t.el.classList.toggle('behind', !expanded && i > 0);
        t.el.style.pointerEvents = hidden ? 'none' : '';
    });
    // Keeps the hover alive across the gaps between expanded toasts.
    root.style.height = items.length ? `${expanded ? offset : front.height + Math.min(items.length - 1, TOAST_VISIBLE - 1) * TOAST_PEEK}px` : '0px';
}

function pauseToasts(paused) {
    for (const t of toastState.items) {
        if (paused && t.timer) {
            clearTimeout(t.timer);
            t.timer = null;
            t.remaining -= Date.now() - t.startedAt;
        } else if (!paused && !t.timer && t.remaining > 0) {
            t.startedAt = Date.now();
            t.timer = setTimeout(t.dismiss, t.remaining);
        }
    }
}

export function toast(message, type = 'info', { duration = 4000, action } = {}) {
    const root = toastRoot();
    const el = html`
        <li class="toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}" role="status">
            <span class="toast-dot" aria-hidden="true"></span>
            <span class="toast-msg"></span>
        </li>`;
    el.querySelector('.toast-msg').textContent = message;

    const item = { el, height: 0, dragX: 0, timer: null, remaining: duration, startedAt: Date.now() };
    item.dismiss = () => {
        if (item.gone) return;
        item.gone = true;
        clearTimeout(item.timer);
        el.style.transform = `translate3d(calc(100% + 32px), ${el.style.transform.match(/,\s*([-\d.]+px)/)?.[1] || '0px'}, 0)`;
        el.style.opacity = '0';
        toastState.items = toastState.items.filter((t) => t !== item);
        layoutToasts();
        setTimeout(() => el.remove(), 400);
    };
    if (action) {
        const btn = html`<button class="toast-action" type="button"></button>`;
        btn.textContent = action.label;
        btn.addEventListener('click', () => { action.onClick(); item.dismiss(); });
        el.append(btn);
    }
    const close = html`<button class="toast-close" type="button" aria-label="Dismiss">${icon('x', 'sm')}</button>`;
    close.addEventListener('click', item.dismiss);
    el.append(close);

    // Swipe right to dismiss — the same direction the toast came from.
    let startX = null;
    el.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        startX = e.clientX;
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
        if (startX === null) return;
        item.dragX = Math.max(0, e.clientX - startX);
        layoutToasts();
    });
    const endDrag = () => {
        if (startX === null) return;
        startX = null;
        el.classList.remove('dragging');
        if (item.dragX > 70) return item.dismiss();
        item.dragX = 0;
        layoutToasts();
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    // Enter from the right edge, then let the layout transition move it into place.
    el.style.transform = 'translate3d(calc(100% + 32px), 0, 0)';
    el.style.opacity = '0';
    root.prepend(el);
    item.height = el.getBoundingClientRect().height;
    toastState.items.unshift(item);
    while (toastState.items.length > TOAST_VISIBLE + 2) toastState.items.at(-1).dismiss();
    requestAnimationFrame(() => requestAnimationFrame(layoutToasts));

    if (!toastState.expanded && !document.hidden) item.timer = setTimeout(item.dismiss, duration);
    return item.dismiss;
}

/* ---------- menus ---------- */

let openMenuEl = null;
export function closeMenu() {
    if (!openMenuEl) return;
    const el = openMenuEl;
    openMenuEl = null;
    el.classList.add('closing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
}

// items: [{ label, icon, danger, onClick } | 'sep']
export function openMenu(anchor, items, { align = 'end' } = {}) {
    closeMenu();
    const menu = html`<div class="menu" role="menu"></div>`;
    for (const item of items) {
        if (item === 'sep') { menu.append(html`<div class="menu-sep"></div>`); continue; }
        const btn = html`<button class="menu-item ${item.danger ? 'danger' : ''}" role="menuitem" type="button">${item.icon ? icon(item.icon) : ''}<span></span></button>`;
        btn.lastElementChild.textContent = item.label;
        btn.addEventListener('click', () => { closeMenu(); item.onClick(); });
        menu.append(btn);
    }
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const below = r.bottom + 6 + h < innerHeight;
    menu.style.top = `${below ? r.bottom + 6 : r.top - 6 - h}px`;
    const left = align === 'end' ? r.right - w : r.left;
    menu.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`;
    menu.style.setProperty('--origin', `${below ? 'top' : 'bottom'} ${align === 'end' ? 'right' : 'left'}`);
    openMenuEl = menu;
    menu.querySelector('button')?.focus({ preventScroll: true });
    return menu;
}

document.addEventListener('pointerdown', (e) => {
    if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu();
}, true);

/* ---------- modals ---------- */

const openModals = [];

export function openModal(content, { onClose, dismissible = true } = {}) {
    const backdrop = html`<div class="modal-backdrop"></div>`;
    backdrop.append(content);
    document.body.append(backdrop);
    const previousFocus = document.activeElement;

    let closed = false;
    const close = (result) => {
        if (closed) return;
        closed = true;
        openModals.splice(openModals.indexOf(entry), 1);
        backdrop.classList.add('closing');
        setTimeout(() => { backdrop.remove(); previousFocus?.focus?.({ preventScroll: true }); }, 140);
        onClose?.(result);
    };
    const entry = { close, dismissible };
    openModals.push(entry);

    backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop && entry.dismissible) close();
    });
    content.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => close()));
    requestAnimationFrame(() => (content.querySelector('[autofocus]') || content.querySelector('input, textarea, button'))?.focus());
    return entry;
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (openMenuEl) { e.stopImmediatePropagation(); closeMenu(); return; }
    const top = openModals.at(-1);
    if (top?.dismissible) {
        e.stopImmediatePropagation();
        top.close();
    }
}, true);

export const hasOpenModal = () => openModals.length > 0;

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
        const dialog = html`
            <div class="modal" role="alertdialog" aria-modal="true">
                <div class="modal-head"><div class="titles"><h2></h2><p></p></div></div>
                <div class="modal-foot">
                    <button class="btn quiet" data-close>Cancel</button>
                    <button class="btn ${danger ? 'danger-solid' : 'primary'}" data-confirm autofocus></button>
                </div>
            </div>`;
        dialog.querySelector('h2').textContent = title;
        dialog.querySelector('p').textContent = message;
        dialog.querySelector('[data-confirm]').textContent = confirmText;
        let confirmed = false;
        const modal = openModal(dialog, { onClose: () => resolve(confirmed) });
        dialog.querySelector('[data-confirm]').addEventListener('click', () => {
            confirmed = true;
            modal.close();
        });
    });
}

/* ---------- theme ---------- */

export function setupThemeToggle(button) {
    const render = () => {
        const dark = document.documentElement.dataset.theme === 'dark';
        button.innerHTML = icon(dark ? 'sun' : 'moon');
        button.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
        button.title = dark ? 'Light theme' : 'Dark theme';
    };
    button.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('xylosync-theme', next); } catch { /* storage blocked */ }
        render();
    });
    render();
}

/* ---------- identity ---------- */

export const session = { user: null, limits: {}, mailInboxUrl: null };

export async function loadSession() {
    const data = await api('/api/me');
    Object.assign(session, { user: data.user, limits: data.limits, mailInboxUrl: data.mailInboxUrl });
    return session;
}

export function renameDialog({ title = 'Your name', message = 'Shown next to files you upload and messages you send.', value, save, onSaved } = {}) {
    const dialog = html`
        <form class="modal" role="dialog" aria-modal="true">
            <div class="modal-head"><div class="titles"><h2></h2><p></p></div></div>
            <div class="modal-body">
                <input class="input" name="name" maxlength="32" minlength="2" required autocomplete="nickname" autofocus aria-label="Display name">
            </div>
            <div class="modal-foot">
                <button type="button" class="btn quiet" data-close>Cancel</button>
                <button type="submit" class="btn primary">Save</button>
            </div>
        </form>`;
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('p').textContent = message;
    const input = dialog.querySelector('input');
    input.value = value ?? session.user?.name ?? '';
    const modal = openModal(dialog);
    requestAnimationFrame(() => input.select());
    dialog.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            let result;
            if (save) {
                result = await save(input.value);
            } else {
                result = (await api('/api/me', { method: 'PATCH', body: { name: input.value } })).user;
                session.user = result;
            }
            modal.close();
            onSaved?.(result);
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

// Clean up the old XyloSync service worker, which cached stale assets.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
}
