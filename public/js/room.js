import {
    $, $$, api, icon, mark, html, toast, avatar, escapeHtml, formatBytes, formatDuration, timeAgo,
    fileKind, extLabel, confirmDialog, openModal, hasOpenModal, openMenu, setupThemeToggle, loadSession,
    session, copyText, uploadRaw, hydrateIcons, renameDialog
} from './common.js';
import { openNoteDialog, openMailDialog, handleMailStatus } from './compose.js';
import { createChat } from './chat.js';

hydrateIcons();
$$('[data-mark]').forEach((el) => { el.outerHTML = mark(); });
setupThemeToggle($('#themeToggle'));

const code = decodeURIComponent(location.pathname.split('/')[2] || '');
const base = `/api/rooms/${encodeURIComponent(code)}`;
const fileUrl = (name, inline = false) => `${base}/files/${encodeURIComponent(name)}${inline ? '?inline=1' : ''}`;
const store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }
};

const state = {
    room: null,
    files: new Map(),
    cards: new Map(),
    fresh: new Set(),
    query: '',
    sort: store.get('xylosync-sort', 'newest'),
    view: store.get('xylosync-view', 'grid'),
    presence: { count: 1, people: [] },
    requests: [],
    members: []
};

let socket = null;
let chat = null;
let leaving = false;
let watchedOnce = false;   // after the first successful watch, a reconnect re-syncs files and chat

function showView(id) {
    for (const v of ['loadingView', 'missingView', 'lobbyView', 'workspace']) $(`#${v}`).hidden = v !== id;
    $('#barRight').hidden = id !== 'workspace';
    $('#roomCode').hidden = !['workspace', 'lobbyView'].includes(id);
}

/* ======================================================================
   Files
   ====================================================================== */

const grid = $('#fileGrid');
const RENDERABLE_IMAGES = /^(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/;
const isImage = (f) => RENDERABLE_IMAGES.test(fileKind(f.name).ext);
const isVideo = (f) => /^(mp4|webm|mov|m4v)$/.test(fileKind(f.name).ext);

const metaLine = (f) => [formatBytes(f.size), f.uploader, timeAgo(f.uploadedAt)].filter(Boolean).join(' · ');

function createCard(file) {
    const owner = state.room.isOwner;
    const card = html`
        <article class="card" tabindex="0">
            <div class="thumb"><span class="ext">${escapeHtml(extLabel(file.name))}</span></div>
            <div class="body">
                <span class="name"></span>
                <span class="meta"></span>
                <span class="col size"></span>
                <span class="col by"></span>
                <span class="col when"></span>
            </div>
            <div class="actions">
                <button type="button" data-act="download" title="Download" aria-label="Download">${icon('download', 'sm')}</button>
                ${owner ? `<button type="button" class="danger" data-act="delete" title="Delete" aria-label="Delete">${icon('trash', 'sm')}</button>` : ''}
            </div>
        </article>`;
    card.querySelector('.name').textContent = file.name;
    card.querySelector('.name').title = file.name;
    card.querySelector('.meta').textContent = metaLine(file);
    card.querySelector('.size').textContent = formatBytes(file.size);
    card.querySelector('.by').textContent = file.uploader || '—';
    card.querySelector('.when').textContent = timeAgo(file.uploadedAt);
    if (state.fresh.has(file.name)) card.prepend(html`<span class="new" title="New"></span>`);

    const thumb = card.querySelector('.thumb');
    if (isImage(file)) {
        const img = new Image();
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        img.onload = () => img.classList.add('ready');
        img.onerror = () => img.remove();
        img.src = fileUrl(file.name, true);
        thumb.append(img);
    } else if (isVideo(file) && state.view === 'grid') {
        const video = Object.assign(document.createElement('video'), { muted: true, preload: 'metadata', playsInline: true });
        video.onloadeddata = () => video.classList.add('ready');
        video.onerror = () => video.remove();
        video.src = `${fileUrl(file.name, true)}#t=0.5`;
        thumb.append(video);
    }

    card.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'download') return downloadFile(file.name);
        if (act === 'delete') return deleteFile(file.name);
        openPreview(file.name);
    });
    card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPreview(file.name); }
        if (e.key === 'Delete' && owner) deleteFile(file.name);
    });
    return card;
}

function visibleFiles() {
    const q = state.query.trim().toLowerCase();
    const files = [...state.files.values()].filter((f) => !q || f.name.toLowerCase().includes(q));
    const by = {
        newest: (a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || a.name.localeCompare(b.name),
        oldest: (a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.name.localeCompare(b.name),
        name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
        largest: (a, b) => b.size - a.size
    }[state.sort];
    return files.sort(by);
}

function render() {
    const files = visibleFiles();
    const total = state.files.size;
    const size = [...state.files.values()].reduce((s, f) => s + f.size, 0);
    renderUsage(total, size);
    $('#emptyState').hidden = total > 0;
    grid.hidden = total === 0;
    const noResults = $('#noResults');
    noResults.hidden = !(total > 0 && files.length === 0);
    noResults.querySelector('span').textContent = state.query;
    $('#downloadAll').href = `${base}/archive`;
    $('#downloadAll').toggleAttribute('aria-disabled', total === 0);
    grid.classList.toggle('list', state.view === 'list');
    grid.replaceChildren(...files.map((f) => state.cards.get(f.name)));
}

function expiryText() {
    if (!state.room.expiresAt) return '';
    const ms = Date.parse(state.room.expiresAt) - Date.now();
    if (ms <= 60_000) return 'deletes in under a minute';
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `deletes in ${h ? `${h} h ` : ''}${m} min`;
}

function renderUsage(total = state.files.size, size = [...state.files.values()].reduce((s, f) => s + f.size, 0)) {
    const usage = $('#usage');
    const owner = state.room.isOwner ? 'you own this room' : `owned by ${state.room.ownerName}`;
    usage.replaceChildren([`${total} ${total === 1 ? 'file' : 'files'}`, formatBytes(size), owner].join(' · '));
    const left = expiryText();
    if (left) {
        const soon = Date.parse(state.room.expiresAt) - Date.now() < 30 * 60_000;
        const span = Object.assign(document.createElement('span'), { className: `expiry${soon ? ' soon' : ''}`, textContent: left });
        span.title = `This room and everything in it is deleted at ${new Date(state.room.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
        usage.append(' · ', span);
    }
}

let warnedExpiry = false;
setInterval(() => {
    if (!state.room?.expiresAt || $('#workspace').hidden) return;
    renderUsage();
    const ms = Date.parse(state.room.expiresAt) - Date.now();
    if (!warnedExpiry && ms < 15 * 60_000 && ms > 0) {
        warnedExpiry = true;
        toast(`This room deletes itself in ${Math.max(1, Math.round(ms / 60_000))} min. Download anything you need.`, 'info', { duration: 8000 });
    }
}, 20_000);

function upsertFile(file, { fresh = false } = {}) {
    const prev = state.files.get(file.name);
    // The upload response and the storage webhook both deliver the same file; render it once.
    if (prev && prev.size === file.size && prev.uploadedAt === file.uploadedAt) return false;
    state.files.set(file.name, file);
    if (fresh) {
        state.fresh.add(file.name);
        setTimeout(() => {
            state.fresh.delete(file.name);
            state.cards.get(file.name)?.querySelector('.new')?.remove();
        }, 60_000);
    }
    const card = createCard(file);
    if (fresh && !prev) card.classList.add('enter');
    state.cards.set(file.name, card);
    render();
    return !prev;
}

function removeFile(name) {
    const card = state.cards.get(name);
    state.files.delete(name);
    state.cards.delete(name);
    if (!card?.isConnected) return render();
    card.classList.add('leaving');
    setTimeout(render, 200);
}

function rebuildCards() {
    for (const f of state.files.values()) state.cards.set(f.name, createCard(f));
    render();
}

setInterval(() => {
    for (const [name, card] of state.cards) {
        const f = state.files.get(name);
        if (!f) continue;
        card.querySelector('.meta').textContent = metaLine(f);
        card.querySelector('.when').textContent = timeAgo(f.uploadedAt);
    }
}, 30_000);

function downloadFile(name) {
    // A plain link lets the browser stream straight to disk.
    const a = Object.assign(document.createElement('a'), { href: fileUrl(name), download: name });
    document.body.append(a);
    a.click();
    a.remove();
}

async function deleteFile(name) {
    const ok = await confirmDialog({ title: `Delete “${name}”?`, message: 'It disappears for everyone in the room.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
        await api(fileUrl(name), { method: 'DELETE' });
        removeFile(name);
    } catch (err) {
        toast(err.message, 'error');
    }
}

/* ---------- toolbar ---------- */

$('#search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
$('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; state.query = ''; render(); e.target.blur(); }
});
$('#sort').value = state.sort;
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; store.set('xylosync-sort', state.sort); render(); });

function setView(view) {
    state.view = view;
    store.set('xylosync-view', view);
    $$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    rebuildCards();
}
$$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));

$('#noteBtn').addEventListener('click', () => openNoteDialog(code, (f) => upsertFile(f, { fresh: true })));
$('#mailBtn').addEventListener('click', () => openMailDialog({ roomCode: code, roomFiles: visibleFiles() }));
const SORTS = { newest: 'Newest first', oldest: 'Oldest first', name: 'By name', largest: 'Largest first' };
$('#moreTools').addEventListener('click', (e) => openMenu(e.currentTarget, [
    { label: 'Write a note', icon: 'pen', onClick: () => openNoteDialog(code, (f) => upsertFile(f, { fresh: true })) },
    { label: 'Email files', icon: 'mail', onClick: () => openMailDialog({ roomCode: code, roomFiles: visibleFiles() }) },
    { label: 'Download all as ZIP', icon: 'archive', onClick: () => { if (state.files.size) location.href = `${base}/archive`; } },
    'sep',
    { label: state.view === 'grid' ? 'Show as list' : 'Show as grid', icon: state.view === 'grid' ? 'list' : 'grid', onClick: () => setView(state.view === 'grid' ? 'list' : 'grid') },
    ...Object.entries(SORTS).map(([key, label]) => ({
        label,
        icon: key === state.sort ? 'check' : 'blank',
        onClick: () => { state.sort = key; $('#sort').value = key; store.set('xylosync-sort', key); render(); }
    }))
]));

/* ======================================================================
   Uploads
   ====================================================================== */

const MAX_PARALLEL = 3;
const queue = [];
let active = 0;
let tray = null;

function ensureTray() {
    if (tray?.el.isConnected) return tray;
    const el = html`
        <section class="tray" aria-live="polite">
            <header>
                <strong></strong><span class="pct"></span>
                <button class="btn quiet icon" data-toggle type="button" aria-label="Collapse">${icon('chevronDown', 'sm')}</button>
                <button class="btn quiet icon" data-close type="button" aria-label="Close">${icon('x', 'sm')}</button>
            </header>
            <div class="items"></div>
        </section>`;
    document.body.append(el);
    tray = { el, items: [] };
    el.querySelector('[data-toggle]').addEventListener('click', () => el.classList.toggle('collapsed'));
    el.querySelector('[data-close]').addEventListener('click', () => {
        tray.items.filter((i) => ['queued', 'uploading'].includes(i.status)).forEach((i) => i.cancel());
        el.remove();
        tray = null;
    });
    return tray;
}

function updateTray() {
    if (!tray) return;
    const pending = tray.items.filter((i) => ['queued', 'uploading'].includes(i.status));
    const failed = tray.items.filter((i) => i.status === 'failed');
    const done = tray.items.filter((i) => i.status === 'done');
    tray.el.querySelector('strong').textContent = pending.length
        ? `Uploading ${pending.length} ${pending.length === 1 ? 'file' : 'files'}`
        : failed.length ? `${failed.length} ${failed.length === 1 ? 'upload' : 'uploads'} failed` : `${done.length} uploaded`;
    const loaded = pending.reduce((s, i) => s + i.loaded, 0);
    const total = pending.reduce((s, i) => s + i.file.size, 0);
    tray.el.querySelector('.pct').textContent = pending.length && total ? `${Math.floor((loaded / total) * 100)}%` : '';
    clearTimeout(tray.hide);
    if (!pending.length && !failed.length) {
        const current = tray;
        tray.hide = setTimeout(() => { if (tray === current) { current.el.remove(); tray = null; } }, 3000);
    }
}

function enqueue(fileList) {
    const files = [...fileList];
    if (!files.length || !state.room) return;
    const t = ensureTray();
    t.el.classList.remove('collapsed');
    for (const file of files) {
        const row = html`
            <div class="up">
                <div class="info">
                    <span class="name"></span>
                    <div class="bar-track"><span></span></div>
                    <div class="detail"><span class="state">Waiting</span><span class="rate"></span></div>
                </div>
                <button class="btn quiet icon" type="button" aria-label="Cancel">${icon('x', 'sm')}</button>
            </div>`;
        row.querySelector('.name').textContent = file.name;
        t.el.querySelector('.items').append(row);
        const item = {
            file, row, status: 'queued', loaded: 0, request: null,
            cancel() {
                if (item.status === 'queued') { queue.splice(queue.indexOf(item), 1); finish(item, 'failed', 'Cancelled'); }
                else if (item.status === 'uploading') item.request?.abort();
            }
        };
        row.querySelector('button').addEventListener('click', () => item.cancel());
        t.items.push(item);
        queue.push(item);
    }
    updateTray();
    pump();
}

function finish(item, status, text) {
    item.status = status;
    item.row.classList.add(status);
    item.row.querySelector('.state').textContent = text;
    item.row.querySelector('.rate').textContent = status === 'done' ? formatBytes(item.file.size) : '';
    item.row.querySelector('.bar-track > span').style.width = '100%';
    item.row.querySelector('button').hidden = true;
    updateTray();
}

function pump() {
    while (active < MAX_PARALLEL && queue.length) {
        const item = queue.shift();
        active++;
        runUpload(item).finally(() => { active--; pump(); });
    }
}

async function runUpload(item) {
    item.status = 'uploading';
    const bar = item.row.querySelector('.bar-track > span');
    const stateText = item.row.querySelector('.state');
    const rate = item.row.querySelector('.rate');
    let lastT = performance.now();
    let lastL = 0;
    let speed = 0;
    item.request = uploadRaw(`${base}/files`, item.file, {
        onProgress(loaded, total) {
            item.loaded = loaded;
            bar.style.width = `${total ? (loaded / total) * 100 : 100}%`;
            const now = performance.now();
            if (now - lastT > 400) {
                const instant = ((loaded - lastL) / (now - lastT)) * 1000;
                speed = speed ? speed * 0.7 + instant * 0.3 : instant;
                lastT = now;
                lastL = loaded;
                rate.textContent = `${formatBytes(speed)}/s · ${formatDuration((total - loaded) / speed)}`;
            }
            stateText.textContent = loaded >= total ? 'Finishing' : `${formatBytes(loaded)} of ${formatBytes(total)}`;
            updateTray();
        }
    });
    try {
        const { file } = await item.request.promise;
        finish(item, 'done', 'Uploaded');
        if (file) upsertFile(file, { fresh: true });
    } catch (err) {
        finish(item, 'failed', err.status === 499 ? 'Cancelled' : err.message);
        if (err.status === 404) roomGone('deleted');
        else if (err.status === 403) roomGone('removed');
        else if (err.status !== 499) toast(`${item.file.name}: ${err.message}`, 'error');
    }
}

const fileInput = $('#fileInput');
const pickFiles = () => fileInput.click();
fileInput.addEventListener('change', () => { enqueue(fileInput.files); fileInput.value = ''; });
$('#uploadBtn').addEventListener('click', pickFiles);
$('#emptyState').addEventListener('click', pickFiles);

const overlay = $('#dropOverlay');
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
const canDrop = () => state.room && !$('#workspace').hidden && !hasOpenModal() && !$('.modal-backdrop');
addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || !canDrop()) return;
    e.preventDefault();
    dragDepth++;
    overlay.classList.add('active');
});
addEventListener('dragover', (e) => { if (hasFiles(e) && canDrop()) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.classList.remove('active'); });
addEventListener('drop', (e) => {
    if (!hasFiles(e) || !canDrop()) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('active');
    // DataTransfer.files lines up with the items whose kind is "file".
    const entries = [...(e.dataTransfer.items || [])].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.());
    if (entries.some((x) => x?.isDirectory)) toast('Folders can’t be uploaded directly — zip them first.');
    enqueue([...e.dataTransfer.files].filter((_, i) => !entries[i]?.isDirectory));
});
document.addEventListener('paste', (e) => {
    if (!canDrop() || document.activeElement?.closest('.chat')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
    enqueue(files.map((f) => (f.name && f.name !== 'image.png')
        ? f
        : new File([f], `Pasted ${stamp}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })));
});

/* ======================================================================
   Preview
   ====================================================================== */

let preview = null;
const TEXT_BYTES = 256 * 1024;

function openPreview(name) {
    const list = visibleFiles();
    let index = list.findIndex((f) => f.name === name);
    if (index < 0) return;
    closePreview();
    const el = html`
        <div class="preview" role="dialog" aria-modal="true">
            <header>
                <div class="title"><strong></strong><span></span></div>
                ${state.room.isOwner ? `<button class="btn icon" data-delete type="button" aria-label="Delete" title="Delete">${icon('trash', 'sm')}</button>` : ''}
                <a class="btn primary" data-download>${icon('download', 'sm')}<span>Download</span></a>
                <button class="btn icon" data-close type="button" aria-label="Close">${icon('x')}</button>
            </header>
            <div class="stage"></div>
        </div>`;
    document.body.append(el);
    preview = { el };
    const stage = el.querySelector('.stage');
    const show = (i) => {
        index = (i + list.length) % list.length;
        const f = list[index];
        el.querySelector('.title strong').textContent = f.name;
        el.querySelector('.title span').textContent = `${metaLine(f)} · ${index + 1} of ${list.length}`;
        const dl = el.querySelector('[data-download]');
        dl.href = fileUrl(f.name);
        dl.setAttribute('download', f.name);
        const { kind } = fileKind(f.name, f.type);
        const src = fileUrl(f.name, true);
        let media;
        if (isImage(f)) media = Object.assign(new Image(), { src, alt: f.name });
        else if (kind === 'video') media = Object.assign(document.createElement('video'), { src, controls: true, autoplay: true, playsInline: true });
        else if (kind === 'audio') media = Object.assign(document.createElement('audio'), { src, controls: true, autoplay: true });
        else if (kind === 'pdf') media = Object.assign(document.createElement('iframe'), { src, title: f.name });
        else if (['text', 'code'].includes(kind) || ['csv', 'tsv'].includes(fileKind(f.name).ext) || f.type.startsWith('text/')) {
            media = document.createElement('pre');
            media.textContent = 'Loading…';
            fetch(src, { headers: { Range: `bytes=0-${TEXT_BYTES - 1}` } })
                .then((r) => (r.ok ? r.text() : Promise.reject()))
                .then((t) => { media.textContent = f.size > TEXT_BYTES ? `${t}\n\n… preview stops here (${formatBytes(f.size)} in total).` : (t || '(empty file)'); })
                .catch(() => { media.textContent = 'Could not load a preview.'; });
        } else {
            media = html`<div class="none"><span class="ext">${escapeHtml(extLabel(f.name))}</span><p>There’s no preview for this kind of file.</p></div>`;
            const b = html`<a class="btn primary">${icon('download', 'sm')}Download ${escapeHtml(formatBytes(f.size))}</a>`;
            b.href = fileUrl(f.name);
            b.setAttribute('download', f.name);
            media.append(b);
        }
        stage.replaceChildren(media);
        if (list.length > 1) {
            const prev = html`<button class="nav prev" type="button" aria-label="Previous">${icon('chevronLeft')}</button>`;
            const next = html`<button class="nav next" type="button" aria-label="Next">${icon('chevronRight')}</button>`;
            prev.addEventListener('click', () => show(index - 1));
            next.addEventListener('click', () => show(index + 1));
            stage.append(prev, next);
        }
    };
    preview.step = (d) => show(index + d);
    el.querySelector('[data-delete]')?.addEventListener('click', () => {
        const name = list[index].name;
        closePreview();
        deleteFile(name);
    });
    el.querySelector('[data-close]').addEventListener('click', closePreview);
    stage.addEventListener('click', (e) => { if (e.target === stage) closePreview(); });
    show(index);
}

function closePreview() {
    preview?.el.remove();
    preview = null;
}

document.addEventListener('keydown', (e) => {
    if (preview) {
        if (e.key === 'Escape') closePreview();
        if (e.key === 'ArrowLeft') preview.step(-1);
        if (e.key === 'ArrowRight') preview.step(1);
        return;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (typing || hasOpenModal() || e.metaKey || e.ctrlKey || e.altKey || $('#workspace').hidden) return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    else if (e.key.toLowerCase() === 'u') { e.preventDefault(); pickFiles(); }
    else if (e.key.toLowerCase() === 'c') { e.preventDefault(); setChatOpen(true); chat?.focus(); }
});

/* ======================================================================
   Chat column
   ====================================================================== */

const workspace = $('#workspace');
const chatKey = `xylosync-chat-${code}`;
const isPhone = () => matchMedia('(max-width: 900px)').matches;

function setChatOpen(open) {
    workspace.classList.toggle('chat-hidden', !open);
    $('#chatToggle').setAttribute('aria-expanded', String(open));
    if (!isPhone()) store.set(chatKey, open ? 'open' : 'hidden');
    chat?.setVisible(open);
}
$('#chatToggle').addEventListener('click', () => setChatOpen(workspace.classList.contains('chat-hidden')));
$('#chat').addEventListener('chat:hide', () => setChatOpen(false));

function onUnreadChange(count, visible) {
    const badge = $('#unreadBadge');
    badge.hidden = visible || !count;
    badge.textContent = count > 99 ? '99+' : count;
    document.title = `${count && (!visible || document.hidden) ? `(${count}) ` : ''}Room ${code} — XyloSync`;
}

/* ======================================================================
   People: presence, waiting list, members
   ====================================================================== */

function renderPresence() {
    const { count, people } = state.presence;
    $('#presenceStack').innerHTML = people.slice(0, 3).map((p) => avatar(p.name, p.id)).join('');
    $('#presenceCount').textContent = count;
    $('#peopleBtn').title = `${count} ${count === 1 ? 'person' : 'people'} here: ${people.map((p) => p.name).join(', ')}`;
    chat?.setSubtitle(count <= 1 ? 'Only you are here' : `${count} people here`);
    const waiting = state.requests.length;
    $('#waitingBadge').hidden = !waiting;
    $('#waitingBadge').textContent = waiting;
}

let popover = null;
function closePopover() {
    if (!popover) return;
    const el = popover;
    popover = null;
    el.classList.add('closing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
}
document.addEventListener('pointerdown', (e) => {
    if (popover && !popover.contains(e.target) && !$('#peopleBtn').contains(e.target)) closePopover();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popover) closePopover(); });

function personRow(name, key, sub) {
    const row = html`<div class="person">${avatar(name, key)}<div class="who"><b></b><span></span></div></div>`;
    row.querySelector('b').textContent = name;
    row.querySelector('.who span').textContent = sub;
    return row;
}

function renderPopover() {
    if (!popover) return;
    const room = state.room;
    popover.replaceChildren();
    if (room.isOwner && room.requiresApproval) {
        const head = html`<div class="pop-head"><span>Waiting to join</span></div>`;
        if (state.requests.length > 1) {
            const all = html`<button class="btn quiet" type="button">Admit all</button>`;
            all.addEventListener('click', () => state.requests.forEach((r) => decide(r, 'admit')));
            head.append(all);
        }
        popover.append(head);
        if (!state.requests.length) popover.append(html`<p class="pop-empty">Nobody is waiting. Share the code and requests show up here.</p>`);
        for (const r of state.requests) {
            const row = personRow(r.name, r.id, `asked ${timeAgo(r.at)}`);
            const deny = html`<button class="btn quiet" type="button">Deny</button>`;
            const admit = html`<button class="btn primary" type="button">Admit</button>`;
            deny.addEventListener('click', () => decide(r, 'deny'));
            admit.addEventListener('click', () => decide(r, 'admit'));
            row.append(deny, admit);
            popover.append(row);
        }
        popover.append(html`<div class="pop-sep"></div>`);
    }

    const online = state.presence.people;
    popover.append(html`<div class="pop-head"><span>Here now · ${online.length}</span></div>`);
    for (const p of online) popover.append(personRow(p.name, p.id, p.id === session.user.publicId ? 'You' : (p.name === room.ownerName ? 'Owner' : 'Online')));

    if (room.requiresApproval) {
        const away = state.members.filter((m) => !online.some((p) => p.id === m.id));
        popover.append(html`<div class="pop-sep"></div>`, html`<div class="pop-head"><span>Admitted · ${state.members.length}</span></div>`);
        if (!state.members.length) popover.append(html`<p class="pop-empty">Nobody has been admitted yet.</p>`);
        for (const m of state.members) {
            const row = personRow(m.name, m.id, away.includes(m) ? `joined ${timeAgo(m.at)}` : 'Online');
            if (room.isOwner) {
                const remove = html`<button class="btn quiet" type="button">Remove</button>`;
                remove.addEventListener('click', async () => {
                    const ok = await confirmDialog({ title: `Remove ${m.name}?`, message: 'They lose access right away and have to ask again to come back.', confirmText: 'Remove', danger: true });
                    if (!ok) return;
                    try { await api(`${base}/members/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); } catch (err) { toast(err.message, 'error'); }
                });
                row.append(remove);
            }
            popover.append(row);
        }
    }
}

$('#peopleBtn').addEventListener('click', async () => {
    if (popover) return closePopover();
    popover = html`<div class="popover" role="dialog" aria-label="People"></div>`;
    document.body.append(popover);
    const r = $('#peopleBtn').getBoundingClientRect();
    popover.style.top = `${r.bottom + 6}px`;
    popover.style.left = `${Math.max(8, Math.min(r.right - 320, innerWidth - 328))}px`;
    renderPopover();
    if (state.room.requiresApproval) {
        try { state.members = (await api(`${base}/members`)).members; renderPopover(); } catch { /* shown on next update */ }
    }
});

async function decide(request, action) {
    try {
        await api(`${base}/requests/${encodeURIComponent(request.id)}/${action}`, { method: 'POST' });
    } catch (err) {
        toast(err.message, 'error');
    }
}

// Owner side of the waiting room: a card for each new request, like a meeting's lobby.
const cardsShown = new Set();
let requestsRoot = null;
function showRequestCards() {
    requestsRoot ||= document.body.appendChild(html`<div class="requests" aria-live="polite"></div>`);
    const ids = new Set(state.requests.map((r) => r.id));
    for (const card of [...requestsRoot.children]) {
        if (!ids.has(card.dataset.id)) { card.classList.add('out'); setTimeout(() => card.remove(), 180); }
    }
    for (const r of state.requests) {
        if (cardsShown.has(r.id)) continue;
        cardsShown.add(r.id);
        const card = html`
            <div class="request" data-id="${escapeHtml(r.id)}">
                ${avatar(r.name, r.id, 'lg')}
                <p><b></b> wants to join<span>Room ${escapeHtml(code)} · private</span></p>
                <div class="row">
                    <button class="btn quiet" type="button" data-a="later">Later</button>
                    <button class="btn" type="button" data-a="deny">Deny</button>
                    <button class="btn primary" type="button" data-a="admit">Admit</button>
                </div>
            </div>`;
        card.querySelector('b').textContent = r.name;
        card.addEventListener('click', (e) => {
            const a = e.target.closest('[data-a]')?.dataset.a;
            if (!a) return;
            if (a === 'later') { card.classList.add('out'); setTimeout(() => card.remove(), 180); return; }
            decide(r, a);
        });
        requestsRoot.append(card);
    }
    for (const id of [...cardsShown]) if (!ids.has(id)) cardsShown.delete(id);
}

/* ======================================================================
   Room-level actions
   ====================================================================== */

$('#roomCode').addEventListener('click', async () => { await copyText(code); toast(`Code ${code} copied`); });

$('#roomMenuBtn').addEventListener('click', (e) => {
    const room = state.room;
    const items = [
        { label: 'Copy invite link', icon: 'link', onClick: async () => { await copyText(`${location.origin}/room/${code}`); toast('Invite link copied'); } },
        { label: 'Copy room code', icon: 'copy', onClick: async () => { await copyText(code); toast(`Code ${code} copied`); } }
    ];
    const roomScoped = room.requiresApproval && !room.isOwner;
    items.push({
        label: 'Change my name', icon: 'pen',
        onClick: () => renameDialog({
            message: roomScoped
                ? 'Your name in this private room. It has to be different from everyone else’s here.'
                : 'Shown on your files and messages, here and in every other room you’ve used.',
            value: myName(),
            save: roomScoped
                ? async (name) => (await api(`${base}/me`, { method: 'PATCH', body: { name } })).name
                : async (name) => { const { user } = await api('/api/me', { method: 'PATCH', body: { name } }); session.user = user; return user.name; },
            onSaved: (name) => { applyRename({ id: session.user.publicId, name, isOwner: room.isOwner }); toast(`You’re now ${name}`); }
        })
    });
    if (isPhone()) {
        const dark = document.documentElement.dataset.theme === 'dark';
        items.push({ label: dark ? 'Light theme' : 'Dark theme', icon: dark ? 'sun' : 'moon', onClick: () => $('#themeToggle').click() });
    }
    if (room.isOwner && room.requiresApproval) {
        items.push({ label: 'People and requests', icon: 'users', onClick: () => $('#peopleBtn').click() });
    }
    items.push('sep');
    if (room.isOwner) {
        items.push({
            label: 'Delete room', icon: 'trash', danger: true,
            onClick: async () => {
                const ok = await confirmDialog({
                    title: `Delete room ${code}?`,
                    message: `All ${state.files.size} ${state.files.size === 1 ? 'file' : 'files'}, the chat and the member list are deleted for good, and everyone inside is sent home.`,
                    confirmText: 'Delete room', danger: true
                });
                if (!ok) return;
                try { leaving = true; await api(base, { method: 'DELETE' }); location.href = '/'; } catch (err) { leaving = false; toast(err.message, 'error'); }
            }
        });
    } else {
        items.push({ label: 'Leave room', icon: 'logout', onClick: () => { location.href = '/'; } });
    }
    openMenu(e.currentTarget, items);
});

function roomGone(reason) {
    if (leaving) return;
    leaving = true;
    socket?.disconnect();
    const removed = reason === 'removed';
    const expired = reason === 'expired';
    const dialog = html`
        <div class="modal" role="alertdialog" aria-modal="true">
            <div class="modal-head"><div class="titles"><h2></h2><p></p></div></div>
            <div class="modal-foot"><a class="btn primary" href="/">Back to XyloSync</a></div>
        </div>`;
    dialog.querySelector('h2').textContent = removed ? 'You were removed from this room' : expired ? 'This room has expired' : 'This room was deleted';
    dialog.querySelector('p').textContent = removed
        ? 'The owner took away your access. To come back you have to ask again, and they have to admit you.'
        : expired
            ? `Rooms delete themselves eight hours after they are made. Room ${code}, its files and its chat are gone.`
            : `The owner deleted room ${code}, with its files and its chat.`;
    openModal(dialog, { dismissible: false });
    setTimeout(() => { location.href = '/'; }, 6000);
}

function setLive(status) {
    const live = $('#liveState');
    live.querySelector('.dot').classList.toggle('idle', status !== 'live');
    live.querySelector('.text').textContent = status === 'live' ? 'Live' : 'Reconnecting';
}

/* ======================================================================
   Socket
   ====================================================================== */

function connect() {
    if (socket || typeof io !== 'function') return socket;
    socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
        setLive('live');
        if (state.room && !$('#workspace').hidden) {
            socket.emit('room:watch', code, (res) => {
                if (!res?.ok) return roomGone(res?.error === 'Room not found.' ? 'deleted' : 'removed');
                if (watchedOnce) resync();
                watchedOnce = true;
            });
        }
    });
    socket.on('disconnect', () => setLive('offline'));
    socket.on('connect_error', () => setLive('offline'));

    socket.on('file:added', (file) => {
        const isNew = upsertFile(file, { fresh: true });
        if (isNew && file.uploader && file.uploader !== myName()) toast(`${file.uploader} added ${file.name}`);
    });
    socket.on('file:removed', ({ name }) => { if (state.files.has(name)) removeFile(name); });
    socket.on('room:deleted', ({ code: c, reason }) => { if (c === code) roomGone(reason === 'expired' ? 'expired' : 'deleted'); });
    socket.on('room:removed', ({ code: c }) => { if (c === code) roomGone('removed'); });
    socket.on('room:presence', (p) => { state.presence = p; renderPresence(); renderPopover(); });
    socket.on('room:members', ({ members }) => { state.members = members; renderPopover(); });
    socket.on('room:renamed', (r) => { if (r.code === code) applyRename(r); });
    socket.on('lobby:requests', ({ code: c, requests }) => {
        if (c !== code) return;
        const before = state.requests.length;
        state.requests = requests;
        renderPresence();
        renderPopover();
        showRequestCards();
        if (requests.length > before && document.hidden) document.title = `(${requests.length} waiting) Room ${code} — XyloSync`;
    });
    socket.on('lobby:admitted', ({ code: c }) => { if (c === code) enterRoom(); });
    socket.on('lobby:denied', ({ code: c }) => { if (c === code) lobbyDenied(); });
    socket.on('chat:message', (m) => chat?.onMessage(m));
    socket.on('chat:updated', (m) => chat?.onUpdated(m));
    socket.on('chat:reactions', (r) => chat?.onReactions(r));
    socket.on('chat:typing', (t) => chat?.onTyping(t));
    socket.on('mail:status', handleMailStatus);
    return socket;
}

const myName = () => state.room?.displayName || session.user?.name;

// A rename reaches the header, the files, the chat and the people list without a reload.
function applyRename({ id, name, isOwner }) {
    if (!state.room) return;
    if (isOwner) state.room.ownerName = name;
    if (id === session.user?.publicId) state.room.displayName = name;
    let filesChanged = false;
    for (const f of state.files.values()) {
        if (f.uploaderId === id && f.uploader !== name) { f.uploader = name; filesChanged = true; }
    }
    if (filesChanged) rebuildCards(); else renderUsage();
    state.presence.people = state.presence.people.map((p) => (p.id === id ? { ...p, name } : p));
    state.members = state.members.map((m) => (m.id === id ? { ...m, name } : m));
    renderPresence();
    renderPopover();
    chat?.onRenamed(id, name);
}

async function resync() {
    try {
        const [{ files }] = await Promise.all([api(`${base}/files`), chat?.load()]);
        const incoming = new Set(files.map((f) => f.name));
        for (const name of [...state.files.keys()]) if (!incoming.has(name)) removeFile(name);
        for (const f of files) upsertFile(f);
        render();
    } catch (err) {
        if (err.status === 403) roomGone('removed');
        if (err.status === 404) roomGone('deleted');
    }
}

/* ======================================================================
   Lobby (private rooms)
   ====================================================================== */

function showLobby(mode, name) {
    showView('lobbyView');
    const room = state.room;
    $('#lobbyTitle').textContent = `Room ${code} is private`;
    $('#lobbyText').textContent = `${room.ownerName} lets people in one at a time. Choose the name they’ll see — it has to be different from everyone already inside.`;
    $('#lobbyForm').hidden = mode === 'pending';
    $('#lobbyWait').hidden = mode !== 'pending';
    $('#lobbyError').hidden = true;
    if (mode === 'pending') {
        $('#lobbyWaitText').textContent = `Asking to join as ${name}…`;
    } else if (mode === 'denied') {
        $('#lobbyError').hidden = false;
        $('#lobbyError').textContent = `${room.ownerName} didn’t let you in this time. You can ask again.`;
    }
    if (mode !== 'pending') requestAnimationFrame(() => $('#lobbyName').focus());
    connect();
}

function lobbyDenied() { showLobby('denied'); }

$('#lobbyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#lobbyName').value.trim();
    const error = $('#lobbyError');
    if (!name) { error.hidden = false; error.textContent = 'Type the name you want to use in this room.'; return; }
    $('#lobbyAsk').disabled = true;
    try {
        const { request } = await api(`${base}/requests`, { method: 'POST', body: { name } });
        showLobby('pending', request.name);
    } catch (err) {
        if (err.status === 409 && /already in this room/.test(err.message)) return enterRoom();
        error.hidden = false;
        error.textContent = err.message;
    } finally {
        $('#lobbyAsk').disabled = false;
    }
});

$('#lobbyCancel').addEventListener('click', async () => {
    try { await api(`${base}/requests/me`, { method: 'DELETE' }); } catch { /* already gone */ }
    showLobby('form');
});

/* ======================================================================
   Boot
   ====================================================================== */

async function enterRoom() {
    try {
        const [{ room }, { files }] = await Promise.all([api(base), api(`${base}/files`)]);
        state.room = room;
        document.title = `Room ${room.code} — XyloSync`;
        $('#roomCode .digits').textContent = room.code;
        $('#dropCode').textContent = room.code;
        $('#privateTag').hidden = !room.requiresApproval;
        state.files.clear();
        for (const f of files) state.files.set(f.name, f);
        rebuildCards();

        chat = createChat($('#chat'), {
            code,
            me: { publicId: session.user.publicId, name: room.displayName || session.user.name },
            isOwner: room.isOwner,
            getSocket: () => socket,
            onUnreadChange
        });
        const savedChat = store.get(chatKey, 'open');
        showView('workspace');
        setChatOpen(!isPhone() && savedChat !== 'hidden');
        state.presence = { count: 1, people: [{ id: session.user.publicId, name: myName() }] };
        renderPresence();
        await chat.load().catch((err) => toast(err.message, 'error'));

        if (room.isOwner && room.requiresApproval) {
            state.requests = (await api(`${base}/requests`)).requests;
            renderPresence();
            showRequestCards();
        }

        if (socket?.connected) {
            socket.emit('room:watch', code, (res) => { if (!res?.ok) roomGone('removed'); else watchedOnce = true; });
        } else {
            connect();
        }
    } catch (err) {
        if (err.status === 403) return boot();
        showMissing(err);
    }
}

function showMissing(err) {
    if (err?.status === 429) $('#missingText').textContent = err.message;
    else if (err && err.status !== 404) $('#missingText').textContent = err.message;
    showView('missingView');
}

async function boot() {
    try {
        await loadSession();
    } catch (err) {
        return showMissing(err);
    }
    if (!/^\d{5}$/.test(code)) return showMissing();
    try {
        const { room } = await api(base);
        state.room = room;
        $('#roomCode .digits').textContent = room.code;
        if (room.access === 'owner' || room.access === 'member') return enterRoom();
        showLobby(room.access === 'pending' ? 'pending' : 'form', room.displayName);
    } catch (err) {
        showMissing(err);
    }
}

boot();
