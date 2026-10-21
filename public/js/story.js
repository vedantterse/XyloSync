// Scroll-driven chapters on the landing page: everything here is scrubbed by the scroll
// position, so it plays forwards and backwards with the reader. Only transform and opacity
// change, written straight onto each element.
import { $, $$ } from './common.js';

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const visible = (r) => r.bottom > 0 && r.top < innerHeight;
const sideways = () => matchMedia('(min-width: 861px)').matches;

/* ---------- statement: split each phrase into masked words ---------- */

function splitWords(p) {
    const words = p.textContent.trim().split(/\s+/);
    p.textContent = '';
    return words.map((word, i) => {
        const outer = document.createElement('span');
        outer.className = 'w';
        const inner = document.createElement('span');
        inner.className = 'wi';
        // The full stop gets the signal colour: each phrase ends on a red dot.
        if (word.endsWith('.')) {
            inner.append(word.slice(0, -1));
            const dot = document.createElement('span');
            dot.className = 'stop';
            dot.textContent = '.';
            inner.append(dot);
        } else {
            inner.textContent = word;
        }
        outer.append(inner);
        p.append(outer);
        if (i < words.length - 1) p.append(' ');
        return inner;
    });
}

export function initStory({ reducedMotion }) {
    const statement = $('#statement');
    const phrases = $$('[data-phrase]', statement).map((el) => ({
        el,
        words: splitWords($('.words', el)),
        sub: $('.sub', el)
    }));

    const day = $('#day');
    const track = $('#dayTrack');
    const clock = $('#dayClock');
    const bar = $('#dayBar');
    const cards = $$('.day-card', track).map((el) => ({
        el,
        kind: el.dataset.card,
        title: $('h3', el),
        ui: $('.dc-ui', el),
        people: $$('.dc-person', el),
        fill: $('.dc-bar i', el),
        amount: $('[data-amount]', el),
        msgs: $$('.dc-msg', el),
        btn: $('.dc-btn', el)
    }));

    const figures = $$('.figure').map((el) => ({
        el,
        from: Number(el.dataset.countFrom || 0),
        to: Number(el.dataset.countTo || 0),
        value: $('[data-value]', el),
        path: $('.inf path', el)
    }));

    if (reducedMotion) {
        // Everything in its final state, nothing moving.
        document.body.classList.add('still');
        cards.forEach((c) => paintCard(c, 1, false));
        figures.forEach((f) => paintFigure(f, 1));
        return () => {};
    }

    function paintStatement() {
        const r = statement.getBoundingClientRect();
        if (!visible(r)) return;
        // Starts while the section is still arriving, so the first phrase is already rising.
        const p = clamp01((innerHeight * 0.5 - r.top) / (statement.offsetHeight - innerHeight * 0.5));
        const seg = 1 / phrases.length;
        phrases.forEach(({ words, sub }, i) => {
            const local = (p - i * seg) / seg;
            // In over the first 30% of its stretch, held until 82%, then out.
            const enter = clamp01(local / 0.3);
            const exit = i === phrases.length - 1 ? 0 : clamp01((local - 0.82) / 0.18);
            words.forEach((w, j) => {
                const inT = easeOut(clamp01(enter * 1.5 - j * 0.22));
                const outT = easeOut(clamp01(exit * 1.5 - j * 0.16));
                w.style.transform = `translate3d(0, ${(1 - inT) * 120 - outT * 120}%, 0)`;
            });
            const subT = clamp01((enter - 0.5) * 2.2) * (1 - clamp01(exit * 2.5));
            sub.style.opacity = String(subT);
            sub.style.transform = `translate3d(0, ${(1 - subT) * 18}px, 0)`;
        });
    }

    function paintDay() {
        const r = day.getBoundingClientRect();
        if (!visible(r)) return;
        let p;
        if (sideways()) {
            p = clamp01(-r.top / (day.offsetHeight - innerHeight));
            const shift = Math.max(0, track.scrollWidth - innerWidth);
            track.style.transform = `translate3d(${-p * shift}px, 0, 0)`;
        } else {
            p = clamp01((innerHeight * 0.6 - r.top) / r.height);
            track.style.transform = '';
        }
        const minutes = Math.round(540 + p * 480);
        clock.textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        bar.style.transform = `scaleX(${p})`;

        for (const card of cards) {
            const c = card.el.getBoundingClientRect();
            const local = sideways()
                ? clamp01(1 - ((c.left + c.width / 2) - innerWidth * 0.42) / (innerWidth * 0.5))
                : clamp01((innerHeight * 0.9 - c.top) / (innerHeight * 0.5));
            paintCard(card, local, true);
        }
    }

    function paintNumbers() {
        for (const f of figures) {
            const r = f.el.getBoundingClientRect();
            if (!visible(r) && r.top > innerHeight) { paintFigure(f, 0); continue; }
            paintFigure(f, easeOut(clamp01((innerHeight * 0.95 - r.top) / (innerHeight * 0.5))));
        }
    }

    return function update() {
        paintStatement();
        paintDay();
        paintNumbers();
    };
}

// One card of the day, at `local` (0 = arriving, 1 = in focus).
function paintCard(card, local, animate) {
    const e = easeOut(local);
    if (animate) {
        card.el.style.opacity = String(0.3 + 0.7 * e);
        const offset = (1 - e) * 48;
        const move = sideways() ? `translate3d(${offset}px, 0, 0)` : `translate3d(0, ${offset * 0.6}px, 0)`;
        card.title.style.transform = move;
        card.ui.style.transform = sideways() ? `translate3d(${offset * 1.6}px, 0, 0)` : move;
    }
    card.people.forEach((person, j) => {
        const k = easeOut(clamp01(e * 1.7 - j * 0.28));
        person.style.opacity = String(k);
        person.style.transform = `translate3d(0, ${(1 - k) * 14}px, 0) scale(${0.92 + 0.08 * k})`;
    });
    if (card.fill) {
        const k = clamp01((local - 0.15) / 0.75);
        card.fill.style.transform = `scaleX(${k})`;
        card.amount.textContent = (3.2 * k).toFixed(1);
    }
    card.msgs.forEach((msg, j) => {
        const k = easeOut(clamp01(e * 1.8 - j * 0.45));
        msg.style.opacity = String(k);
        msg.style.transform = `translate3d(0, ${(1 - k) * 16}px, 0)`;
    });
    if (card.btn) {
        const admitted = local > 0.85;
        card.btn.textContent = admitted ? 'Admitted' : 'Admit';
        card.btn.style.transform = `scale(${admitted ? 0.96 : 1})`;
        card.btn.style.opacity = admitted ? '0.7' : '1';
    }
}

function paintFigure(f, k) {
    if (f.path) {
        f.path.style.strokeDashoffset = String(1 - k);
        return;
    }
    f.value.textContent = String(Math.round(lerp(f.from, f.to, k)));
}
