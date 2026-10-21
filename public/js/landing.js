import {
    $, $$, api, toast, html, icon, formatBytes, setupThemeToggle, loadSession, mark, extLabel, escapeHtml,
    hydrateIcons, openModal, confirmDialog
} from './common.js';
import { initStory } from './story.js';

hydrateIcons();
$$('[data-mark]').forEach((el) => { el.outerHTML = mark(); });
setupThemeToggle($('#themeToggle'));

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const updateStory = initStory({ reducedMotion });
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/* ======================================================================
   The reel: product fragments step through the frame, then the finale
   ====================================================================== */

const story = $('#story');
const stage = $('.stage');
const frame = $('#frame');
const fill = $('.frame-fill');
const scene = $('#scene');
const reel = $('#reel');
const halves = { first: $('.half.first'), second: $('.half.second') };
const shots = $$('.shot');
const caption = $('#caption');
const nav = $('.nav');
const CAPTIONS = [
    'Files land on every screen in the room the moment they finish uploading. Drop any file on this page to watch it happen.',
    'Phones see it in the same second, in the browser. No app to install and no account to make.',
    'Every room has its own chat. Reply to a message, react to it, edit it — and it all goes when the room does.',
    'Make a room private and nobody gets in until you admit them. Names are checked so nobody can pose as someone already inside.'
];
let current = -1;

function show(step) {
    step = Math.max(0, Math.min(shots.length - 1, step));
    if (step === current) return;
    shots.forEach((shot, i) => {
        shot.classList.toggle('on', i === step);
        shot.classList.toggle('past', i < step);
    });
    caption.classList.add('swap');
    setTimeout(() => {
        caption.textContent = CAPTIONS[step];
        caption.classList.remove('swap');
    }, current === -1 ? 0 : 200);
    current = step;
}

const pinned = () => matchMedia('(min-width: 861px)').matches;
let timer = null;

/* ---------- scrubbed frames: each product fragment plays as you scroll through it ---------- */

const shotParts = shots.map((shot) => ({
    phone: $('.ui-phone', shot),
    note: $('.ui-phone-note', shot),
    rows: $$('.ui-row', shot),
    msgs: $$('.ui-msg', shot),
    react: $('.react', shot),
    typing: $('.ui-typing', shot),
    requests: $$('.ui-request', shot),
    refused: $('.ui-refused', shot),
    joiner: $('.joiner', shot)
}));
const easeOut = (t) => 1 - (1 - t) ** 3;
const setTO = (el, y, o, extra = '') => {
    if (!el) return;
    el.style.transform = `translate3d(0, ${y}px, 0)${extra}`;
    el.style.opacity = String(o);
};

function scrubShot(i, sp) {
    const s = shotParts[i];
    if (i === 1) {
        // The phone tips up into view, then its rows arrive.
        const e = easeOut(clamp01(sp / 0.55));
        s.phone.style.transform = `perspective(1000px) rotateX(${(1 - e) * 26}deg) translate3d(0, ${(1 - e) * 60}px, 0) scale(${0.9 + 0.1 * e})`;
        s.phone.style.opacity = String(0.25 + 0.75 * e);
        s.rows.forEach((row, j) => { const k = easeOut(clamp01(sp * 2.2 - 0.3 - j * 0.22)); setTO(row, (1 - k) * 14, k); });
        const n = easeOut(clamp01((sp - 0.45) / 0.3));
        setTO(s.note, (1 - n) * 20, n);
    } else if (i === 2) {
        // Messages arrive one per stretch of scroll; the reaction pops, then someone types.
        s.msgs.forEach((msg, j) => { const k = easeOut(clamp01(sp * 2.6 - j * 0.6)); setTO(msg, (1 - k) * 18, k); });
        const r = clamp01((sp - 0.5) / 0.14);
        if (s.react) {
            s.react.style.transform = `scale(${0.5 + 0.5 * easeOut(r)})`;
            s.react.style.opacity = String(r);
        }
        setTO(s.typing, 0, clamp01((sp - 0.78) / 0.12));
    } else if (i === 3) {
        // Requests slide in, a look-alike is turned away, then Dev is admitted and joins.
        s.requests.forEach((req, j) => {
            const k = easeOut(clamp01(sp * 2.6 - j * 0.35));
            req.style.transform = `translate3d(${(1 - k) * 44}px, 0, 0)`;
            req.style.opacity = String(k * (j === 0 && sp > 0.72 ? 0.35 : 1));
        });
        const admit = s.requests[0]?.querySelector('.ui-btn.dark');
        if (admit) admit.textContent = sp > 0.72 ? 'Admitted' : 'Admit';
        const f = clamp01((sp - 0.42) / 0.14);
        setTO(s.refused, (1 - f) * 10, f);
        const jn = easeOut(clamp01((sp - 0.74) / 0.16));
        setTO(s.joiner, (1 - jn) * 10, jn);
    }
}

function scrubReel(stepFloat) {
    const step = Math.min(shots.length - 1, Math.floor(stepFloat));
    for (let i = 1; i < shots.length; i++) scrubShot(i, i < step ? 1 : i > step ? 0 : stepFloat - step);
}

// The finale: once the last fragment has been seen, the sentence splits apart and the frame
// grows to fill the screen in the close's colour, so the page flows into its last section.
function finale(t) {
    const p = ease(clamp01(t / 0.5));   // the frame fills the screen in the first half of the finale
    stage.classList.toggle('finale', t > 0);
    halves.first.style.transform = t ? `translateX(${-p * 70}vw)` : '';
    halves.second.style.transform = t ? `translateX(${p * 70}vw)` : '';
    halves.first.style.opacity = halves.second.style.opacity = t ? String(1 - p) : '';
    for (const el of [$('.lede'), caption]) el.style.opacity = t ? String(clamp01(1 - t * 2.5)) : '';
    reel.style.opacity = t ? String(clamp01(1 - t * 3)) : '';
    fill.style.setProperty('--r', `${ease(clamp01(t * 1.7)) * 75}%`);
    renderScene(t);

    if (!t) { frame.style.transform = ''; frame.style.borderRadius = ''; return; }
    // Measure the frame without its transform, then scale it to cover its stage. Measuring
    // against the stage (not the viewport) lets the frame leave with the stage when it unpins.
    frame.style.transform = 'none';
    const r = frame.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    const sx = lerp(1, st.width / r.width, p);
    const sy = lerp(1, st.height / r.height, p);
    const dx = (st.left + st.width / 2 - (r.left + r.width / 2)) * p;
    const dy = (st.top + st.height / 2 - (r.top + r.height / 2)) * p;
    frame.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    frame.style.borderRadius = `${lerp(8, 0, p) / Math.max(sx, sy)}px`;
}

/* ---------- the finale scene ---------- */

// Screens around the file, by centre position (% of the stage), size and depth for parallax.
const DEVICES = [
    { kind: 'laptop', x: 17, y: 30, w: 200, h: 128, depth: 0.9 },
    { kind: 'phone', x: 36, y: 20, w: 62, h: 122, depth: 0.5 },
    { kind: 'phone', x: 63, y: 20, w: 62, h: 122, depth: 0.6 },
    { kind: 'tablet', x: 84, y: 30, w: 122, h: 160, depth: 0.8 },
    { kind: 'tablet', x: 13, y: 72, w: 116, h: 152, depth: 0.7 },
    { kind: 'phone', x: 33, y: 82, w: 60, h: 118, depth: 0.45 },
    { kind: 'phone', x: 66, y: 82, w: 60, h: 118, depth: 0.55 },
    { kind: 'monitor', x: 85, y: 72, w: 214, h: 132, depth: 1 }
];
let sceneBuilt = false;
const sceneParts = {};

function buildScene() {
    sceneBuilt = true;
    scene.innerHTML = `
        <span class="ring"></span><span class="ring"></span>
        <div class="source">
            <div class="doc"><b>PDF</b><span class="n">Q3 report.pdf</span><span class="m">2.4 MB · Maya</span><i></i></div>
            <p class="count"></p>
        </div>`;
    const cx = 50;
    const cy = 48;
    const far = Math.max(...DEVICES.map((d) => Math.hypot(d.x - cx, (d.y - cy) * 0.62)));
    sceneParts.devices = DEVICES.map((d) => {
        const el = document.createElement('div');
        el.className = `device ${d.kind}`;
        el.style.left = `${d.x}%`;
        el.style.top = `${d.y}%`;
        el.innerHTML = `<div class="screen" style="width:${d.w}px;height:${d.h}px"><div class="tile" style="--tw:${Math.round(Math.min(d.w, d.h) * 0.42)}px">PDF<i></i></div></div>`;
        scene.append(el);
        // Nearest screens receive the file first, like a ripple from the middle.
        const at = 0.6 + 0.3 * (Math.hypot(d.x - cx, (d.y - cy) * 0.62) / far);
        return { el, d, at };
    });
    sceneParts.rings = $$('.ring', scene);
    sceneParts.count = $('.count', scene);
}

function renderScene(t) {
    if (!t) { scene.style.opacity = '0'; return; }
    if (!sceneBuilt) buildScene();
    scene.style.opacity = String(clamp01((t - 0.42) / 0.16));
    let got = 0;
    for (const { el, d, at } of sceneParts.devices) {
        const on = t >= at;
        if (on) got++;
        el.classList.toggle('got', on);
        // Parallax: deeper screens travel further and settle as the scene arrives.
        el.style.setProperty('--dy', `${(1 - ease(clamp01((t - 0.4) / 0.6))) * d.depth * 140}px`);
        el.style.setProperty('--ds', String(lerp(0.86, 1, ease(clamp01((t - 0.4) / 0.6)))));
    }
    sceneParts.rings.forEach((ring, i) => {
        const k = clamp01((t - 0.58 - i * 0.12) / 0.32);
        ring.style.setProperty('--k', String(lerp(0.6, 4.2 + i, ease(k))));
        ring.style.setProperty('--o', String(k ? 1 - k : 0));
    });
    sceneParts.count.innerHTML = got === DEVICES.length
        ? 'On every screen in the room'
        : `Delivered to ${got} <span>of ${DEVICES.length} screens…</span>`;
}

const darkZone = $('#darkZone');
const lede = $('.lede');

function syncToScroll() {
    // The nav takes the dark field's colours anywhere over the dark run (and late in the finale).
    const z = darkZone.getBoundingClientRect();
    let inverse = z.top <= 64 && z.bottom > 64;
    if (pinned()) {
        const rect = story.getBoundingClientRect();
        const reelTravel = shots.length * 0.75 * innerHeight;
        const scrolled = -rect.top;
        const reelP = clamp01(scrolled / reelTravel - 0.0001);
        show(Math.floor(reelP * shots.length));
        if (!reducedMotion) {
            scrubReel(reelP * shots.length);
            // Depth: the sentence drifts apart and the frame comes closer while the reel plays.
            halves.first.style.translate = `${-reelP * 2.5}vw 0`;
            halves.second.style.translate = `${reelP * 2.5}vw 0`;
            frame.style.scale = String(1 + reelP * 0.035);
            lede.style.translate = `0 ${-reelP * 28}px`;
            caption.style.translate = `0 ${reelP * 28}px`;
        }
        const t = reducedMotion ? 0 : clamp01((scrolled - reelTravel) / (story.offsetHeight - innerHeight - reelTravel));
        finale(t);
        if (t > 0.45) inverse = true;
    }
    nav.classList.toggle('inverse', inverse);
    updateStory();
}

function setMode() {
    clearInterval(timer);
    stage.classList.toggle('scrub', pinned() && !reducedMotion);
    if (pinned()) {
        syncToScroll();
    } else {
        finale(0);
        for (const el of [halves.first, halves.second, frame, lede, caption]) { el.style.translate = ''; el.style.scale = ''; }
        for (let i = 1; i < shots.length; i++) scrubShot(i, 1);
        updateStory();
        // Stacked layout: the frame steps on its own instead of following the scroll.
        timer = setInterval(() => show((current + 1) % shots.length), 4200);
    }
}

show(0);
setMode();
addEventListener('scroll', () => requestAnimationFrame(syncToScroll), { passive: true });
addEventListener('resize', () => requestAnimationFrame(syncToScroll));
matchMedia('(min-width: 861px)').addEventListener('change', setMode);

/* ======================================================================
   The live thing: drop a file and see it land in the room
   ====================================================================== */

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); dragDepth++; } });
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (pinned()) scrollTo({ top: story.offsetTop, behavior: 'smooth' });
    clearInterval(timer);
    show(0);
    const tile = $('#demoFile');
    tile.className = 'ui-file arriving user';
    tile.innerHTML = `<b>${escapeHtml(extLabel(file.name))}</b><span class="n"></span><span class="m"></span><i class="new"></i>`;
    tile.querySelector('.n').textContent = file.name;
    tile.querySelector('.m').textContent = `${formatBytes(file.size)} · you`;
    toast('That’s how it looks in a room. Nothing was uploaded — create a room to share it for real.', 'info', {
        duration: 6000,
        action: { label: 'Create room', onClick: () => createRoom() }
    });
});

/* ======================================================================
   Joining with a code (hero and close share the same behaviour)
   ====================================================================== */

function setupCodeInput(wrap, form) {
    const digits = $$('input', wrap);
    const value = () => digits.map((d) => d.value).join('');
    let joining = false;

    const setDigits = (text) => {
        const chars = text.replace(/\D/g, '').slice(0, digits.length).split('');
        digits.forEach((d, i) => { d.value = chars[i] || ''; });
        digits[Math.min(chars.length, digits.length - 1)].focus();
        maybeSubmit();
    };
    const maybeSubmit = () => {
        wrap.classList.remove('error');
        if (value().length === digits.length) form.requestSubmit();
    };

    digits.forEach((input, index) => {
        // No maxlength: autofill, IME and some phone keyboards insert the whole code at once.
        input.addEventListener('input', () => {
            const v = input.value.replace(/\D/g, '');
            if (v.length > 1) return setDigits(value().slice(0, index) + v);
            input.value = v;
            if (v && index < digits.length - 1) digits[index + 1].focus();
            maybeSubmit();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && index > 0) {
                digits[index - 1].value = '';
                digits[index - 1].focus();
                e.preventDefault();
            } else if (e.key === 'ArrowLeft' && index > 0) digits[index - 1].focus();
            else if (e.key === 'ArrowRight' && index < digits.length - 1) digits[index + 1].focus();
        });
        input.addEventListener('focus', () => input.select());
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            setDigits((e.clipboardData || window.clipboardData).getData('text'));
        });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = value();
        if (code.length !== digits.length || joining) return;
        joining = true;
        wrap.classList.add('busy');
        try {
            await api(`/api/rooms/${code}`);
            location.href = `/room/${code}`;
        } catch (err) {
            wrap.classList.remove('busy');
            wrap.classList.add('error');
            toast(err.status === 404 ? `There’s no room ${code}. Check the digits.` : err.message, 'error');
            setTimeout(() => setDigits(''), 380);
        } finally {
            joining = false;
        }
    });
    return digits;
}

setupCodeInput($('#codeInput'), $('#joinForm'));
const closeDigits = setupCodeInput($('#closeCode'), $('#closeJoin'));

// The close's empty boxes roll through digits, like a code waiting to be read out.
if (!reducedMotion) {
    let tick = 0;
    setInterval(() => {
        tick++;
        closeDigits.forEach((input, i) => {
            if ((tick + i) % 2 === 0) input.placeholder = String(Math.floor(Math.random() * 10));
        });
    }, 650);
}
closeDigits.forEach((input) => { input.placeholder = String(Math.floor(Math.random() * 10)); });

/* ======================================================================
   Creating rooms, and the "your rooms" dialog
   ====================================================================== */

const privateToggles = [$('#privateRoom'), $('#privateRoomClose')];
privateToggles.forEach((t) => t.addEventListener('change', () => privateToggles.forEach((o) => { o.checked = t.checked; })));
const createButtons = [$('#createRoom'), $('#createRoomClose'), $('#navCreate')];

let rooms = [];
let roomLimit = 3;

function timeLeft(iso) {
    if (!iso) return 'Never expires';
    const ms = Date.parse(iso) - Date.now();
    if (ms <= 60_000) return 'Deletes in under a minute';
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `Deletes in ${h ? `${h} h ` : ''}${m} min`;
}

async function refreshRooms() {
    try {
        const data = await api('/api/rooms');
        rooms = data.rooms;
        roomLimit = data.limit;
    } catch {
        rooms = [];
    }
    const btn = $('#roomsMenu');
    btn.hidden = rooms.length === 0;
    $('#roomsCount').textContent = rooms.length;
}

function openRoomsDialog({ atLimit = false } = {}) {
    const dialog = html`
        <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="roomsTitle">
            <div class="modal-head">
                <div class="titles">
                    <h2 id="roomsTitle"></h2>
                    <p></p>
                </div>
                <button class="btn quiet icon" type="button" data-close aria-label="Close">${icon('x')}</button>
            </div>
            <div class="modal-body">
                <div class="limit-note" hidden></div>
                <div class="rooms-list"></div>
            </div>
            <div class="modal-foot">
                <span class="left"></span>
                <button class="btn quiet" type="button" data-close>Close</button>
                <button class="btn primary" type="button" data-create>Create a room</button>
            </div>
        </div>`;
    const list = dialog.querySelector('.rooms-list');
    const createBtn = dialog.querySelector('[data-create]');
    const modal = openModal(dialog);

    const render = () => {
        const full = rooms.length >= roomLimit;
        dialog.querySelector('h2').textContent = full && atLimit ? `You already have ${rooms.length} rooms` : 'Your rooms';
        dialog.querySelector('.titles p').textContent = `You can own ${roomLimit} at a time. Each room deletes itself, with its files and chat, eight hours after it’s made.`;
        const note = dialog.querySelector('.limit-note');
        note.hidden = !full;
        note.textContent = 'You’re at the limit. Open one of these, or delete one to make space for a new room.';
        createBtn.disabled = full;
        dialog.querySelector('.left').textContent = `${rooms.length} of ${roomLimit} used`;
        list.replaceChildren();
        if (!rooms.length) list.append(html`<p class="hint">You don’t own any rooms right now.</p>`);
        for (const room of rooms) {
            const soon = room.expiresAt && Date.parse(room.expiresAt) - Date.now() < 3_600_000;
            const row = html`
                <div class="room-row">
                    <span class="code-id">${escapeHtml(room.code)}${room.requiresApproval ? icon('lock', 'sm') : ''}</span>
                    <span class="facts"></span>
                    <div class="row-actions">
                        <a class="btn" href="/room/${escapeHtml(room.code)}">Open</a>
                        <button class="btn danger" type="button">Delete</button>
                    </div>
                </div>`;
            const facts = row.querySelector('.facts');
            facts.append(`${room.fileCount} ${room.fileCount === 1 ? 'file' : 'files'} · ${formatBytes(room.totalSize)}${room.requiresApproval ? ' · private' : ''} · `);
            const left = document.createElement('span');
            left.className = soon ? 'soon' : '';
            left.textContent = timeLeft(room.expiresAt);
            facts.append(left);
            row.querySelector('.danger').addEventListener('click', async () => {
                const ok = await confirmDialog({
                    title: `Delete room ${room.code}?`,
                    message: 'Its files, chat and member list are deleted for good, and anyone inside is sent home.',
                    confirmText: 'Delete room',
                    danger: true
                });
                if (!ok) return;
                row.classList.add('removing');
                try {
                    await api(`/api/rooms/${room.code}`, { method: 'DELETE' });
                    await refreshRooms();
                    render();
                    toast(`Room ${room.code} deleted`);
                } catch (err) {
                    row.classList.remove('removing');
                    toast(err.message, 'error');
                }
            });
            list.append(row);
        }
    };

    createBtn.addEventListener('click', () => { modal.close(); createRoom(); });
    render();
}

async function createRoom() {
    createButtons.forEach((b) => { b.disabled = true; });
    try {
        const { room } = await api('/api/rooms', {
            method: 'POST',
            body: { requiresApproval: privateToggles[0].checked }
        });
        location.href = `/room/${room.code}`;
    } catch (err) {
        createButtons.forEach((b) => { b.disabled = false; });
        if (err.status === 409) {
            await refreshRooms();
            openRoomsDialog({ atLimit: true });
        } else {
            toast(err.message, 'error');
        }
    }
}

createButtons.forEach((b) => b.addEventListener('click', createRoom));
$('#roomsMenu').addEventListener('click', async () => { await refreshRooms(); openRoomsDialog(); });
// Every "Create room" button creates a room straight away (or opens your rooms at the limit).
$('#navCreate').addEventListener('click', (e) => { e.preventDefault(); createRoom(); });

(async () => {
    try {
        await loadSession();
        await refreshRooms();
        // /?rooms (linked from the room-limit message elsewhere) opens your rooms straight away.
        if (new URLSearchParams(location.search).has('rooms')) openRoomsDialog({ atLimit: rooms.length >= roomLimit });
    } catch {
        /* the page works without the list */
    }
})();

/* ======================================================================
   The close: entrances and a button that leans toward the pointer
   ====================================================================== */

const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
        }
    }
}, { threshold: 0.2 });
$$('.close h2, .close-copy, .close-actions, .close-switch').forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${i * 90}ms`;
    io.observe(el);
});

const orb = $('#createRoomClose');
if (!reducedMotion && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    addEventListener('pointermove', (e) => {
        const r = orb.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const near = Math.hypot(dx, dy) < r.width * 1.1;
        orb.style.setProperty('--mx', near ? `${dx * 0.22}px` : '0px');
        orb.style.setProperty('--my', near ? `${dy * 0.22}px` : '0px');
    }, { passive: true });
}
