import { $, $$, api, toast, mark, hydrateIcons, setupThemeToggle, formatBytes, extLabel, initials, hueFor } from './common.js';

hydrateIcons();
$$('[data-mark]').forEach((el) => { el.outerHTML = mark(); });
setupThemeToggle($('#themeToggle'));

// Every chapter is scrubbed by the scroll position, so it plays forwards and backwards with
// the reader. Only transform and opacity change per frame; geometry is measured on resize.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reducedMotion) document.body.classList.add('still');

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const smooth = (t) => t * t * (3 - 2 * t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (r) => r.bottom > 0 && r.top < innerHeight;
const narrow = () => matchMedia('(max-width: 860px)').matches;
const navHeight = () => parseFloat(getComputedStyle(document.body).getPropertyValue('--nav')) || 64;

// Progress through a pinned section: 0 when its sticky child pins, 1 when it lets go.
function pinProgress(section) {
    const r = section.getBoundingClientRect();
    const nav = navHeight();
    return clamp01((nav - r.top) / Math.max(1, section.offsetHeight - innerHeight + nav));
}

/* ======================================================================
   Headlines: each word rises out of its own mask
   ====================================================================== */

function splitWords(el) {
    const words = el.textContent.trim().split(/\s+/);
    el.setAttribute('aria-label', el.textContent.trim());
    el.textContent = '';
    words.forEach((word, i) => {
        const outer = document.createElement('span');
        outer.className = 'w';
        outer.setAttribute('aria-hidden', 'true');
        const inner = document.createElement('span');
        inner.className = 'wi';
        inner.style.setProperty('--i', i);
        if (word.endsWith('.')) {
            inner.append(word.slice(0, -1));
            const stop = document.createElement('span');
            stop.className = 'stop';
            stop.textContent = '.';
            inner.append(stop);
        } else {
            inner.textContent = word;
        }
        outer.append(inner);
        el.append(outer);
        if (i < words.length - 1) el.append(' ');
    });
}

const rises = $$('.rise');
rises.forEach(splitWords);
if (reducedMotion) {
    rises.forEach((el) => el.classList.add('in'));
} else {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
    }), { threshold: 0.35 });
    rises.forEach((el) => io.observe(el));
}

/* ======================================================================
   Chapter 1 — the journey: one file through the real pipeline
   ====================================================================== */

const MAX_FILE = 15 * 1024 * 1024;      // the per-file upload limit
const LINK = 12.5e6;                    // a 100 Mbit/s connection, in bytes per second
const SAMPLES = [
    { name: 'Q3 report.pdf', size: 2.4e6 },
    { name: 'site-visit.jpg', size: 4.1e6 },
    { name: 'walkthrough.mp4', size: 9.8e6 },
    { name: 'build-1042.zip', size: 14.2e6 },
    { name: 'wifi-password.txt', size: 32 }
];
let sampleIndex = 0;

const journey = $('#journey');
const machine = $('.machine');
const trackArea = $('#trackArea');
const stations = $$('.station');
const packet = $('#packet');
const clock = $('#clock');
const parts = $('#parts');
const trail = document.createElement('span');
trail.className = 'trail';
trackArea.prepend(trail);

const fmtMs = (ms) => (ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms).toLocaleString()} ms`);
const READY = { title: 'Ready when you are.', text: 'Scroll down and the file moves with you. Nothing is uploaded — this is a model of what happens inside a room.' };

// Real timings: the upload depends on size; after it finishes, storage tells the app over a
// webhook and the app tells every screen — about 60 ms in our measurements.
function timelineFor(file) {
    const upload = Math.max(4, (file.size / LINK) * 1000);
    const steps = [
        { at: 0, title: 'You drop the file.', text: 'Your browser checks it’s under 15 MB, then streams it to XyloSync in one request. Nothing is split up for you to reassemble.' },
        { at: Math.min(6, upload), title: 'XyloSync passes it straight through.', text: 'The bytes go on to storage while they are still arriving. The server never waits for the whole file or keeps a copy of it, so a busy room costs it almost no memory.' },
        { at: upload, title: 'Storage writes it as it streams in.', text: `${formatBytes(file.size)} lands in MinIO piece by piece. When the last byte arrives, the file exists — complete or not at all.` },
        { at: upload + 38, title: 'Storage rings the doorbell.', text: 'MinIO calls XyloSync’s webhook: “a new file just landed in room 48213.” Files added any other way announce themselves the same way.' },
        { at: upload + 44, title: 'One message to everyone in the room.', text: 'XyloSync sends the file’s name, size and sender down the live connection every open screen keeps with it.' },
        { at: upload + 58, title: `Every screen has ${file.name}.`, text: 'Phones, laptops and tablets show it with a red dot for “new” — no refresh, no polling, no app to install.' }
    ];
    steps.forEach((s, i) => { s.label = i === 0 ? '0 ms' : `+${fmtMs(s.at - steps[i - 1].at)}`; });
    return { file, upload, shown: 8, steps, summary: `${fmtMs(upload)} to upload on 100 Mbit/s, then 58 ms to every screen` };
}

let timeline = null;
let centers = [];
let runId = 0;
let manual = null;          // while a timed run owns the machine: { y } is where the page was
let shownStep = -2;

function prepare(file) {
    timeline = timelineFor(file);
    parts.innerHTML = '<i></i>'.repeat(timeline.shown);
    $('#packetExt').textContent = extLabel(file.name);
    $('#fileLabel').textContent = `${file.name} · ${formatBytes(file.size)}`;
    shownStep = -2;
}

function explain(title, text, step) {
    $('#stepNow').textContent = String(step);
    $('#exTitle').textContent = title;
    $('#exText').textContent = text;
}

function measureJourney() {
    // Too tall to pin in this window: let it scroll past and scrub on the way instead.
    const tall = $('.journey-head').offsetHeight + machine.offsetHeight + 40;
    journey.classList.toggle('unpinned', !reducedMotion && tall > innerHeight - navHeight());
    const a = trackArea.getBoundingClientRect();
    centers = stations.map((s) => {
        const n = $('.node', s).getBoundingClientRect();
        return { x: n.left - a.left + n.width / 2, y: n.top - a.top + n.height / 2 };
    });
    const first = centers[0];
    const last = centers.at(-1);
    trail.style.left = `${first.x - (narrow() ? 0.75 : 0)}px`;
    trail.style.top = `${first.y - (narrow() ? 0 : 0.75)}px`;
    trail.style.width = narrow() ? '' : `${last.x - first.x}px`;
    trail.style.height = narrow() ? `${last.y - first.y}px` : '';
}

function setTrail(k) {
    trail.style.transform = narrow() ? `scaleY(${k})` : `scaleX(${k})`;
}

function movePacket(x, y) {
    packet.style.setProperty('--x', `${x}px`);
    packet.style.setProperty('--y', `${y}px`);
}

// The scrubbed state: `p` is how far through the chapter the reader has scrolled.
function paintJourney(p) {
    const last = stations.length - 1;
    const pos = clamp01((p - 0.06) / 0.84) * last;
    const i = Math.min(last - 1, Math.floor(pos));
    // Each hop lingers a little at both stations, so every stop gets a moment on screen.
    const f = smooth(clamp01((pos - i - 0.18) / 0.64));
    const at = pos >= last ? last : i + f;
    const started = p > 0.03;

    movePacket(lerp(centers[i].x, centers[i + 1].x, f), lerp(centers[i].y, centers[i + 1].y, f));
    packet.classList.toggle('on', started);
    setTrail(at / last);

    const reached = started ? Math.floor(at + 0.001) : -1;
    const resting = f === 0 || f === 1;
    stations.forEach((s, k) => {
        s.classList.toggle('reached', k <= reached);
        s.classList.toggle('active', resting && k === reached && started);
        $('[data-time]', s).textContent = k <= reached ? timeline.steps[k].label : '';
    });

    const { steps } = timeline;
    clock.textContent = Math.round(lerp(steps[i].at, steps[i + 1].at, f)).toLocaleString();
    const segs = $$('i', parts);
    const on = i > 1 ? segs.length : i === 1 ? Math.round(f * segs.length) : 0;
    segs.forEach((seg, k) => seg.classList.toggle('on', k < on));

    if (reached !== shownStep) {
        shownStep = reached;
        const step = reached < 0 ? READY : steps[reached];
        explain(step.title, step.text, reached + 1);
        $('#clockNote').textContent = reached === last ? timeline.summary : 'from the first byte';
    }
}

function journeyProgress() {
    if (!journey.classList.contains('unpinned')) return pinProgress(journey);
    const r = journey.getBoundingClientRect();
    return clamp01((innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.2));
}

// Counts the clock from one value to the next over the hop's on-screen duration.
function runClock(from, to, duration, id) {
    const start = performance.now();
    return new Promise((resolve) => {
        const tick = (now) => {
            if (id !== runId) return resolve();
            const t = duration ? clamp01((now - start) / duration) : 1;
            clock.textContent = Math.round(from + (to - from) * t).toLocaleString();
            if (t < 1) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
    });
}

// A timed run: the sample (or a dropped file) travels on its own, at slow or real speed.
// It keeps the machine until the reader scrolls on, then scrolling takes over again.
async function run(file) {
    const id = ++runId;
    manual = { y: scrollY };
    prepare(file);
    const real = $('#realSpeed').checked;
    const { steps } = timeline;

    stations.forEach((s) => { s.classList.remove('reached', 'active'); $('[data-time]', s).textContent = ''; });
    $('#clockNote').textContent = 'from the first byte';
    clock.textContent = '0';
    packet.classList.remove('on', 'scrub');
    trail.style.transition = 'none';
    setTrail(0);
    packet.style.setProperty('--hop', '0ms');
    movePacket(centers[0].x, centers[0].y);
    await wait(30);
    if (id !== runId) return;
    packet.classList.add('on');

    for (let i = 0; i < steps.length; i++) {
        if (id !== runId) return;
        const step = steps[i];
        const station = stations[i];
        const prev = steps[i - 1];
        const realGap = prev ? step.at - prev.at : 0;
        // Slow motion gives every hop time to read; real speed uses the real gap (the
        // upload of a big file is shortened so the demo doesn't take minutes).
        const hop = i === 0 ? 0 : real ? Math.max(40, Math.min(realGap, 2500)) : reducedMotion ? 0 : (i === 2 ? 1600 : 900);

        stations.forEach((s) => s.classList.remove('active'));
        packet.style.setProperty('--hop', `${hop}ms`);
        movePacket(centers[i].x, centers[i].y);
        trail.style.transition = `transform ${hop}ms var(--ease-in-out)`;
        setTrail(i / (steps.length - 1));
        if (i === 2) {
            const segs = $$('i', parts);
            segs.forEach((seg, k) => setTimeout(() => { if (id === runId) seg.classList.add('on'); }, (hop / segs.length) * (k + 1)));
        }
        await runClock(prev ? prev.at : 0, step.at, hop, id);
        if (id !== runId) return;
        station.classList.add('reached', 'active');
        $('[data-time]', station).textContent = step.label;
        explain(step.title, step.text, i + 1);
        if (!real) await wait(reducedMotion ? 300 : 650);
    }
    stations.forEach((s) => s.classList.remove('active'));
    $('#clockNote').textContent = timeline.summary;
}

// Scrolling on hands the machine back to the scroll position, with the last file still loaded.
function releaseRun() {
    if (!manual || Math.abs(scrollY - manual.y) < 80) return;
    manual = null;
    runId++;
    trail.style.transition = '';
    shownStep = -2;
    if (!reducedMotion) packet.classList.add('scrub');
}

$('#sendSample').addEventListener('click', () => {
    run(SAMPLES[sampleIndex % SAMPLES.length]);
    sampleIndex++;
});
$('#realSpeed').addEventListener('change', (e) => {
    $('#speedNote').textContent = e.target.checked ? 'Real timings — blink and you miss it.' : 'Shown 30× slower so you can follow it.';
});

// Drop any file on the page: it's measured here and never uploaded.
let depth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); depth++; document.body.classList.add('dropping'); } });
addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dropping'); });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropping');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.size > MAX_FILE) {
        toast(`${file.name} is ${formatBytes(file.size)} — a real room takes files up to 15 MB, so your browser would stop it before uploading.`, 'info');
        return;
    }
    const r = machine.getBoundingClientRect();
    if (r.top < navHeight() || r.bottom > innerHeight) {
        const pinned = !journey.classList.contains('unpinned') && !reducedMotion;
        const top = pinned ? journey.offsetTop - navHeight() : scrollY + r.top - (innerHeight - r.height) / 2;
        scrollTo({ top, behavior: 'instant' });
    }
    run({ name: file.name, size: file.size });
});

/* ======================================================================
   Chapter 2 — two screens, one room
   ====================================================================== */

const sync = $('#sync');
const beats = $$('[data-beat]');
const stage = $('#syncStage');
const wirePath = $('#wirePath');
const pulse = $('#pulse');
const latency = $('#latency');
const ghost = $('#ghost');
const typing = $('#typing');
const REPLY = 'Got it — looks right.';

function screen(frame) {
    const rows = $$('.df-row', frame);
    const msgs = $$('.df-msg', frame);
    return {
        frame,
        rows,
        newRow: $('[data-new]', frame),
        goneRow: $('[data-gone]', frame),
        first: msgs[0],
        reply: $('[data-reply]', frame),
        heart: $('[data-heart]', frame),
        rowStep: 0,
        msgStep: 0
    };
}
const lap = screen($('#laptop'));
const tel = screen($('#phone'));
let wireLength = 0;
let ghostTo = { x: 0, y: 0 };

function measureSync() {
    for (const s of [lap, tel]) {
        s.rowStep = s.rows[1].offsetTop - s.rows[0].offsetTop;
        s.msgStep = s.reply.offsetTop - s.first.offsetTop;
    }
    const st = stage.getBoundingClientRect();
    const a = $('#laptop').getBoundingClientRect();
    const b = $('#phone').getBoundingClientRect();
    const sx = a.left - st.left + a.width * 0.32;
    const sy = a.bottom - st.top;
    const ex = b.left - st.left;
    const ey = Math.max(b.top - st.top + b.height * 0.66, sy + 44);
    const svg = $('#wire');
    svg.setAttribute('viewBox', `0 0 ${st.width} ${st.height}`);
    wirePath.setAttribute('d', `M ${sx} ${sy} C ${sx} ${ey}, ${lerp(sx, ex, 0.4)} ${ey}, ${ex} ${ey}`);
    wireLength = wirePath.getTotalLength();
    // Where the dragged file lands: the top row of the laptop's list.
    ghost.style.transform = '';
    const g = ghost.getBoundingClientRect();
    const n = lap.newRow.getBoundingClientRect();
    ghostTo = { x: n.left - g.left, y: n.top - g.top };
}

// A message on the wire: `k` is how far along it is, `back` sends it from the phone.
function paintPulse(k, back) {
    if (k <= 0 || k >= 1) {
        pulse.style.opacity = '0';
        latency.style.opacity = '0';
        return;
    }
    const pt = wirePath.getPointAtLength((back ? 1 - k : k) * wireLength);
    pulse.style.opacity = '1';
    pulse.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
    const mid = wirePath.getPointAtLength(wireLength * 0.55);
    latency.style.opacity = String(clamp01(Math.min(k, 1 - k) * 6));
    latency.style.transform = `translate(${mid.x + 10}px, ${mid.y + 10}px)`;
}

const show = (el, k, y = 8) => {
    el.style.opacity = String(k);
    el.style.transform = `translate3d(0, ${(1 - k) * -y}px, 0)`;
};
const pop = (el, k) => {
    el.style.opacity = String(k);
    el.style.transform = `scale(${0.6 + 0.4 * easeOut(k)})`;
};
const window01 = (t, a, b) => clamp01((t - a) / (b - a));

function paintScreen(s, { added, reply, heart, doomed, gone }) {
    // Rows below a missing row close the gap; the file that's deleted fades and the rest move up.
    show(s.newRow, added);
    s.newRow.style.visibility = added ? '' : 'hidden';
    s.goneRow.style.opacity = String(1 - gone);
    s.goneRow.style.transform = `translate3d(0, ${-(1 - added) * s.rowStep}px, 0) scale(${1 - gone * 0.04})`;
    s.goneRow.classList.toggle('doomed', doomed && gone < 1);
    s.rows.slice(2).forEach((row) => {
        row.style.transform = `translate3d(0, ${-(1 - added) * s.rowStep - easeOut(gone) * s.rowStep}px, 0)`;
    });
    s.reply.style.opacity = String(reply);
    s.reply.style.transform = `translate3d(0, ${(1 - reply) * 10}px, 0)`;
    s.first.style.transform = `translate3d(0, ${(1 - reply) * s.msgStep}px, 0)`;
    pop(s.heart, heart);
}

function paintSync(q) {
    const t = beats.map((_, b) => clamp01(q * beats.length - b));
    const active = Math.min(beats.length - 1, Math.floor(q * beats.length));
    beats.forEach((li, b) => {
        li.classList.toggle('on', b === active);
        li.style.setProperty('--k', String(t[b]));
    });

    // Beat 1: Maya drops a file on the laptop; it lands there, then crosses to the phone.
    const [t0, t1, t2, t3] = t;
    const lift = easeOut(window01(t0, 0, 0.22));
    const land = smooth(window01(t0, 0.24, 0.44));
    ghost.style.opacity = String(lift * (1 - window01(t0, 0.4, 0.46)));
    ghost.style.transform = `translate3d(${land * ghostTo.x}px, ${(1 - lift) * -28 + land * ghostTo.y}px, 0) scale(${0.96 + 0.04 * lift - 0.04 * land})`;

    // Beat 2: Arjun types on the phone and sends; the laptop gets it.
    const typed = Math.round(REPLY.length * window01(t1, 0.04, 0.42));
    typing.textContent = t1 >= 0.48 ? '' : REPLY.slice(0, typed);

    paintScreen(lap, {
        added: window01(t0, 0.42, 0.5),
        reply: window01(t1, 0.72, 0.8),
        heart: window01(t2, 0.12, 0.22),
        doomed: t3 > 0.08,
        gone: window01(t3, 0.3, 0.44)
    });
    paintScreen(tel, {
        added: window01(t0, 0.72, 0.8),
        reply: window01(t1, 0.48, 0.56),
        heart: window01(t2, 0.56, 0.66),
        doomed: false,
        gone: window01(t3, 0.68, 0.82)
    });

    // One message on the wire at a time: laptop → phone, phone → laptop, and so on.
    const legs = [
        [t0, 0.5, 0.72, false],
        [t1, 0.52, 0.72, true],
        [t2, 0.24, 0.54, false],
        [t3, 0.46, 0.68, false]
    ];
    const leg = legs.find(([tt, a, b]) => tt > a && tt < b);
    paintPulse(leg ? window01(leg[0], leg[1], leg[2]) : 0, leg?.[3]);
}

/* ======================================================================
   Chapter 3 — rooms forget: scroll scrubs through a room's eight hours
   ====================================================================== */

const life = $('#lifetime');
const lifeRoom = $('#lifeRoom');
const lifeBar = $('.life-bar');
const lifeNow = $('#lifeNow');
const lifeClock = $('#lifeClock');
const lifeFiles = $$('.lr-files i');
const wipes = $$('#wipe li');

const lifeProgress = () => clamp01((pinProgress(life) - 0.04) / 0.92);

function paintLife(p) {
    $('#lifeFill').style.transform = `scaleX(${p})`;
    lifeNow.style.transform = `translate3d(${p * lifeBar.clientWidth}px, 0, 0)`;
    // The time label slides from left-aligned to right-aligned so it never leaves the page.
    lifeClock.style.transform = `translateX(${-p * 100}%)`;
    const minutes = Math.round(p * 480);
    lifeClock.textContent = `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
    const shownFiles = Math.min(lifeFiles.length, Math.floor(p * 16));
    lifeFiles.forEach((f, i) => f.classList.toggle('on', i < shownFiles));
    const gone = p >= 0.995;
    const late = p >= 0.969;
    lifeBar.classList.toggle('late', late);
    lifeRoom.classList.toggle('gone', gone);
    lifeRoom.classList.toggle('warn', late && !gone);
    wipes.forEach((li, i) => li.classList.toggle('wiped', p >= 0.975 + i * 0.006));
    const left = 480 - minutes;
    $('#lifeLeft').textContent = gone ? 'Gone.' : `${Math.floor(left / 60)} h ${String(left % 60).padStart(2, '0')} min`;
    $('#lifeLeftNote').textContent = gone ? 'room 48213 deleted itself' : 'until room 48213 deletes itself';
    $('.life-left').classList.toggle('late', late);
    $('#lifeState').textContent = gone ? 'Deleted — nothing left on the server'
        : late ? `Deletes in ${480 - minutes} min`
            : `Live · ${shownFiles} ${shownFiles === 1 ? 'file' : 'files'}`;
}

/* ======================================================================
   Chapter 4 — names: the same rule the server applies in private rooms
   ====================================================================== */

const people = $$('.ir-person');
const nameTry = $('#nameTry');
const verdict = $('#verdict');
const suggest = $('#suggest');
const askJoin = $('#askJoin');
const askState = $('#askState');
const youJoined = $('#youJoined');
const nameKey = (name) => name.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const nameOf = (p) => p.textContent.slice($('.avatar', p).textContent.length).trim();
const takenBy = (key) => people.find((p) => !p.hidden && nameOf(p) && nameKey(nameOf(p)) === key);
let clashing = false;
let joined = false;
let askTimer = 0;

function shake(el) {
    if (reducedMotion) return;
    el.animate([
        { transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' },
        { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }
    ], { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
}

function checkName() {
    const value = nameTry.value.trim();
    const key = nameKey(value);
    const clash = key ? takenBy(key) : null;
    people.forEach((p) => p.classList.toggle('clash', p === clash));
    verdict.className = 'verdict';
    suggest.hidden = true;
    let free = false;
    if (!key) {
        verdict.textContent = 'Type a name to see if you could ask to join.';
    } else if (key.length < 2) {
        verdict.textContent = 'Names need at least two characters.';
        verdict.classList.add('no');
    } else if (clash) {
        verdict.textContent = `Turned away — ${nameOf(clash)} is already in this room, and “${value}” counts as the same name.`;
        verdict.classList.add('no');
        const base = nameOf(clash);
        const options = [`${base} S.`, `${base} 2`, `The other ${base}`]
            .filter((n) => n.length <= 32 && !takenBy(nameKey(n)));
        if (options.length) {
            suggest.replaceChildren('Try ', ...options.map((n) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = n;
                b.addEventListener('click', () => { nameTry.value = n; checkName(); nameTry.focus(); });
                return b;
            }));
            suggest.hidden = false;
        }
        if (!clashing) shake(nameTry.closest('.field'));
    } else {
        verdict.textContent = `“${value}” is free. You could ask to join, and Maya would decide.`;
        verdict.classList.add('ok');
        free = true;
    }
    clashing = Boolean(clash);
    if (!joined) askJoin.disabled = !free;
}

nameTry.addEventListener('input', checkName);
nameTry.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !askJoin.disabled) askJoin.click(); });

askJoin.addEventListener('click', () => {
    if (joined) {
        // Start over: leave the room and try another name.
        joined = false;
        youJoined.hidden = true;
        askJoin.textContent = 'Ask to join';
        askState.className = 'ask-state';
        askState.textContent = '';
        nameTry.readOnly = false;
        nameTry.value = '';
        checkName();
        nameTry.focus();
        return;
    }
    const name = nameTry.value.trim();
    askJoin.disabled = true;
    nameTry.readOnly = true;
    askState.className = 'ask-state waiting';
    askState.textContent = 'Waiting for Maya to let you in…';
    clearTimeout(askTimer);
    askTimer = setTimeout(() => {
        joined = true;
        $('#youName').textContent = name;
        const av = $('#youAvatar');
        av.textContent = initials(name);
        av.style.setProperty('--hue', hueFor(name));
        youJoined.hidden = false;
        if (!reducedMotion) {
            youJoined.animate([{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
        }
        askState.className = 'ask-state in';
        askState.textContent = `Maya let you in as ${name}.`;
        askJoin.textContent = 'Try another name';
        askJoin.disabled = false;
    }, 1400);
});

/* ======================================================================
   Chapter pill: where you are, and a way to jump
   ====================================================================== */

const chapters = $$('[data-chapter]');
const pill = $('#chapters');
const pillButtons = chapters.map((section) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<i></i><span></span>';
    $('span', b).textContent = section.dataset.chapter;
    b.setAttribute('aria-label', section.dataset.chapter);
    b.addEventListener('click', () => {
        const extra = section.id === 'names' ? 100 : 0;
        scrollTo({ top: section.offsetTop - navHeight() + extra, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    pill.append(b);
    return b;
});

function chapterProgress(section) {
    if (section === journey) return journeyProgress();
    if (section === sync) return pinProgress(sync);
    if (section === life) return lifeProgress();
    const r = section.getBoundingClientRect();
    return clamp01((innerHeight * 0.8 - r.top) / r.height);
}

function paintPill() {
    const intro = $('#intro').getBoundingClientRect();
    const end = $('#end').getBoundingClientRect();
    pill.classList.toggle('shown', intro.bottom < innerHeight * 0.5 && end.top > innerHeight - 8);
    let current = 0;
    chapters.forEach((section, i) => { if (section.getBoundingClientRect().top <= innerHeight * 0.5) current = i; });
    pillButtons.forEach((b, i) => {
        b.classList.toggle('on', i === current);
        b.classList.toggle('done', i < current);
        if (i === current) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
        $('i', b).style.setProperty('--k', String(i === current ? chapterProgress(chapters[i]) : 0));
    });
}

/* ======================================================================
   The frame loop and the end
   ====================================================================== */

function measure() {
    measureJourney();
    measureSync();
}

function frame() {
    ticking = false;
    releaseRun();
    if (!reducedMotion) {
        if (!manual && visible(journey.getBoundingClientRect())) paintJourney(journeyProgress());
        if (visible(sync.getBoundingClientRect())) paintSync(clamp01((pinProgress(sync) - 0.04) / 0.92));
        if (visible(life.getBoundingClientRect())) paintLife(lifeProgress());
        paintPill();
    }
}
let ticking = false;
const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };

prepare(SAMPLES[0]);
measure();
if (reducedMotion) {
    // Still pages show each chapter at a telling moment, and nothing moves with the scroll.
    paintJourney(0);
    paintSync(0.749);
    paintLife(0.5);
} else {
    packet.classList.add('scrub');
    frame();
}
addEventListener('scroll', request, { passive: true });
addEventListener('resize', () => {
    measure();
    if (manual) {
        const at = stations.filter((s) => s.classList.contains('reached')).length - 1;
        packet.style.setProperty('--hop', '0ms');
        movePacket(centers[Math.max(0, at)].x, centers[Math.max(0, at)].y);
    }
    frame();
});
document.fonts?.ready.then(() => { measure(); frame(); });

// The round button leans toward the pointer.
const orb = $('.orb');
if (!reducedMotion && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    addEventListener('pointermove', (e) => {
        const r = orb.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const near = Math.hypot(dx, dy) < r.width * 1.1;
        orb.style.setProperty('--mx', near ? `${dx * 0.22}px` : '0px');
        orb.style.setProperty('--my', near ? `${dy * 0.22}px` : '0px');
    }, { passive: true });
}

$$('[data-create]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
        const { room } = await api('/api/rooms', { method: 'POST', body: {} });
        location.href = `/room/${room.code}`;
    } catch (err) {
        btn.disabled = false;
        if (err.status === 409) {
            toast(err.message, 'error', { action: { label: 'Your rooms', onClick: () => { location.href = '/?rooms'; } } });
        } else {
            toast(err.message, 'error');
        }
    }
}));
