// The room's chat column: grouped bubbles, replies, reactions, edits, deletes and typing.
import { api, icon, html, avatar, hueFor, clockTime, toast, openMenu, confirmDialog, copyText } from './common.js';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const GROUP_GAP_MS = 5 * 60 * 1000;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function dayLabel(date) {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Text with links, built from text nodes only — message text is never parsed as HTML.
function richText(text) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(URL_RE)) {
        if (match.index > last) frag.append(text.slice(last, match.index));
        const a = document.createElement('a');
        a.href = match[0];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = match[0];
        frag.append(a);
        last = match.index + match[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
}

export function createChat(root, { code, me, isOwner, getSocket, onUnreadChange }) {
    root.innerHTML = `
        <div class="chat-head">
            <h2>Chat</h2>
            <span class="sub" data-sub></span>
            <button class="btn quiet icon" data-hide type="button" title="Hide chat" aria-label="Hide chat">${icon('x')}</button>
        </div>
        <div class="chat-log" data-log role="log" aria-live="polite"></div>
        <div class="typing" data-typing></div>
        <form class="composer" data-composer autocomplete="off">
            <div data-context></div>
            <div class="compose-row">
                <textarea data-input rows="1" maxlength="4000" placeholder="Message the room" aria-label="Message"></textarea>
                <button class="btn primary icon send" type="submit" title="Send (Enter)" aria-label="Send">${icon('send')}</button>
            </div>
        </form>`;

    const log = root.querySelector('[data-log]');
    const input = root.querySelector('[data-input]');
    const form = root.querySelector('[data-composer]');
    const contextSlot = root.querySelector('[data-context]');
    const typingLine = root.querySelector('[data-typing]');

    const messages = new Map();   // id -> message
    let order = [];               // ids, oldest first
    const elements = new Map();   // id -> element
    let hasMore = false;
    let loadingOlder = false;
    let unread = 0;
    let visible = true;
    let context = null;           // { mode: 'reply' | 'edit', message }
    let jumpPill = null;
    let pendingCounter = 0;

    /* ---------- rendering ---------- */

    const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const scrollToBottom = (smooth = false) => log.scrollTo({ top: log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

    function isFirstInGroup(m, prev) {
        return !prev || prev.authorId !== m.authorId || !sameDay(prev.createdAt, m.createdAt)
            || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > GROUP_GAP_MS;
    }

    function build(m, prev) {
        const mine = m.authorId === me.publicId;
        const first = isFirstInGroup(m, prev);
        const reactionEntries = Object.entries(m.reactions || {}).filter(([, ids]) => ids.length);
        const el = html`
            <div class="msg ${mine ? 'me' : ''} ${first ? 'first' : ''} ${m.deleted ? 'deleted' : ''} ${m.pending ? 'pending' : ''} ${reactionEntries.length ? 'has-reactions' : ''}" data-id="${m.id}">
                <span class="av-slot"></span>
                <div class="bubble" style="--hue:${hueFor(m.authorId)}"></div>
            </div>`;
        if (first && !mine) el.querySelector('.av-slot').innerHTML = avatar(m.authorName, m.authorId);

        const bubble = el.querySelector('.bubble');
        if (first && !mine) {
            const who = document.createElement('span');
            who.className = 'who';
            who.textContent = m.authorName;
            bubble.append(who);
        }
        if (m.replyTo && !m.deleted) {
            const quote = html`<button class="quote" type="button"><b></b><span></span></button>`;
            quote.querySelector('b').textContent = m.replyTo.authorId === me.publicId ? 'You' : m.replyTo.authorName;
            quote.querySelector('span').textContent = m.replyTo.deleted ? 'Deleted message' : m.replyTo.text;
            quote.addEventListener('click', () => focusMessage(m.replyTo.id));
            bubble.append(quote);
        }
        const text = document.createElement('span');
        text.className = 'text';
        if (m.deleted) text.textContent = mine ? 'You deleted this message' : 'This message was deleted';
        else text.append(richText(m.text));
        bubble.append(text);
        const stamp = document.createElement('span');
        stamp.className = 'stamp';
        stamp.textContent = m.pending ? 'Sending…' : `${m.editedAt && !m.deleted ? 'edited · ' : ''}${clockTime(m.createdAt)}`;
        stamp.title = new Date(m.createdAt).toLocaleString();
        bubble.append(stamp);

        if (reactionEntries.length) {
            const row = html`<div class="reactions"></div>`;
            for (const [emoji, ids] of reactionEntries) {
                const chip = html`<button class="reaction ${ids.includes(me.publicId) ? 'mine' : ''}" type="button"></button>`;
                chip.textContent = emoji;
                if (ids.length > 1) chip.append(Object.assign(document.createElement('span'), { className: 'n', textContent: ids.length }));
                chip.title = `${ids.length} reaction${ids.length === 1 ? '' : 's'}`;
                chip.addEventListener('click', () => react(m, ids.includes(me.publicId) ? null : emoji));
                row.append(chip);
            }
            bubble.append(row);
        }

        if (!m.deleted && !m.pending) {
            const actions = html`
                <div class="msg-actions">
                    <button type="button" data-a="react" title="React" aria-label="React">${icon('smile', 'sm')}</button>
                    <button type="button" data-a="reply" title="Reply" aria-label="Reply">${icon('reply', 'sm')}</button>
                    <button type="button" data-a="more" title="More" aria-label="More">${icon('moreH', 'sm')}</button>
                </div>`;
            actions.addEventListener('click', (e) => {
                const a = e.target.closest('[data-a]')?.dataset.a;
                if (a) el.classList.remove('actions-open');
                if (a === 'react') openPicker(m, bubble);
                if (a === 'reply') startReply(m);
                if (a === 'more') openMore(m, e.target.closest('button'));
            });
            el.append(actions);
            attachSwipe(el, m);
            // Touch screens have no hover: a tap on the bubble shows its actions.
            bubble.addEventListener('click', (e) => {
                if (!matchMedia('(hover: none)').matches || e.target.closest('a, .quote')) return;
                const open = !el.classList.contains('actions-open');
                log.querySelectorAll('.msg.actions-open').forEach((x) => x.classList.remove('actions-open'));
                el.classList.toggle('actions-open', open);
            });
        }
        return el;
    }

    function renderAll({ keepBottom = true } = {}) {
        const previousHeight = log.scrollHeight;
        const previousTop = log.scrollTop;
        log.replaceChildren();
        elements.clear();
        if (hasMore) {
            const older = html`<button class="btn quiet older" type="button">Load earlier messages</button>`;
            older.addEventListener('click', loadOlder);
            log.append(older);
        }
        if (!order.length) {
            log.append(html`<div class="chat-empty"><b>No messages yet</b>Say hello — everyone in this room sees it the moment you send it.</div>`);
            return;
        }
        let prev = null;
        for (const id of order) {
            const m = messages.get(id);
            if (!prev || !sameDay(prev.createdAt, m.createdAt)) log.append(dayEl(m.createdAt));
            const el = build(m, prev);
            elements.set(id, el);
            log.append(el);
            prev = m;
        }
        if (keepBottom) scrollToBottom();
        else log.scrollTop = previousTop + (log.scrollHeight - previousHeight);
    }

    const dayEl = (date) => { const d = html`<div class="day"></div>`; d.textContent = dayLabel(date); return d; };

    function append(m) {
        const prevId = order.at(-1);
        const prev = prevId ? messages.get(prevId) : null;
        messages.set(m.id, m);
        order.push(m.id);
        log.querySelector('.chat-empty')?.remove();
        if (!prev || !sameDay(prev.createdAt, m.createdAt)) log.append(dayEl(m.createdAt));
        const el = build(m, prev);
        elements.set(m.id, el);
        log.append(el);
    }

    function replace(id, next) {
        const index = order.indexOf(id);
        if (index === -1) return;
        messages.set(next.id, next);
        if (next.id !== id) { order[index] = next.id; messages.delete(id); }
        const old = elements.get(id);
        const prev = index > 0 ? messages.get(order[index - 1]) : null;
        const el = build(next, prev);
        elements.delete(id);
        elements.set(next.id, el);
        old?.replaceWith(el);
    }

    function focusMessage(id) {
        const el = elements.get(id);
        if (!el) return toast('That message is no longer in the history.');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1400);
    }

    /* ---------- history ---------- */

    async function load() {
        const data = await api(`/api/rooms/${code}/messages?limit=80`);
        messages.clear();
        order = [];
        for (const m of data.messages) { messages.set(m.id, m); order.push(m.id); }
        hasMore = data.hasMore;
        renderAll();
    }

    async function loadOlder() {
        if (loadingOlder || !hasMore || !order.length) return;
        loadingOlder = true;
        try {
            const data = await api(`/api/rooms/${code}/messages?limit=80&before=${encodeURIComponent(order[0])}`);
            for (const m of data.messages) messages.set(m.id, m);
            order = [...data.messages.map((m) => m.id), ...order];
            hasMore = data.hasMore;
            renderAll({ keepBottom: false });
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            loadingOlder = false;
        }
    }

    log.addEventListener('scroll', () => {
        if (log.scrollTop < 40) loadOlder();
        if (atBottom()) clearUnread();
    }, { passive: true });

    /* ---------- unread ---------- */

    function setUnread(n) {
        unread = n;
        onUnreadChange?.(unread, visible);
        if (visible && unread && !atBottom()) {
            if (!jumpPill) {
                jumpPill = html`<button class="jump" type="button">${icon('arrowDown', 'sm')}<span></span></button>`;
                jumpPill.addEventListener('click', () => { scrollToBottom(true); clearUnread(); });
                root.append(jumpPill);
            }
            jumpPill.querySelector('span').textContent = `${unread} new message${unread === 1 ? '' : 's'}`;
            const logRect = log.getBoundingClientRect();
            jumpPill.style.bottom = `${root.getBoundingClientRect().bottom - logRect.bottom + 12}px`;
        } else {
            jumpPill?.remove();
            jumpPill = null;
        }
    }
    const clearUnread = () => { if (unread) setUnread(0); };

    /* ---------- actions ---------- */

    function emit(event, payload) {
        const socket = getSocket();
        if (!socket?.connected) return Promise.reject(new Error('Not connected. Your message will need to be sent again.'));
        return new Promise((resolve, reject) => {
            socket.timeout(10000).emit(event, payload, (err, res) => {
                if (err) return reject(new Error('The server did not answer. Try again.'));
                if (!res?.ok) return reject(new Error(res?.error || 'Something went wrong.'));
                resolve(res);
            });
        });
    }

    async function send(text) {
        const replyTo = context?.mode === 'reply' ? context.message : null;
        const tempId = `pending-${++pendingCounter}`;
        append({
            id: tempId, authorId: me.publicId, authorName: me.name, text, pending: true,
            replyTo: replyTo && { id: replyTo.id, authorId: replyTo.authorId, authorName: replyTo.authorName, text: replyTo.text },
            createdAt: new Date().toISOString(), reactions: {}
        });
        scrollToBottom(true);
        clearContext();
        try {
            const { message } = await emit('chat:send', { text, replyToId: replyTo?.id });
            replace(tempId, message);
        } catch (err) {
            const index = order.indexOf(tempId);
            if (index !== -1) order.splice(index, 1);
            messages.delete(tempId);
            elements.get(tempId)?.remove();
            elements.delete(tempId);
            input.value = text;
            resize();
            toast(err.message, 'error');
        }
    }

    async function react(m, emoji) {
        try {
            const { reactions } = await emit('chat:react', { id: m.id, emoji });
            onReactions({ id: m.id, reactions });
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    let picker = null;
    function closePicker() { picker?.remove(); picker = null; }
    function openPicker(m, anchor) {
        closePicker();
        const mineNow = Object.entries(m.reactions || {}).find(([, ids]) => ids.includes(me.publicId))?.[0];
        picker = html`<div class="picker" role="menu"></div>`;
        for (const emoji of QUICK_REACTIONS) {
            const b = html`<button type="button" class="${emoji === mineNow ? 'mine' : ''}"></button>`;
            b.textContent = emoji;
            b.setAttribute('aria-label', `React ${emoji}`);
            b.addEventListener('click', () => { closePicker(); react(messages.get(m.id) || m, emoji === mineNow ? null : emoji); });
            picker.append(b);
        }
        document.body.append(picker);
        const r = anchor.getBoundingClientRect();
        const w = picker.offsetWidth;
        picker.style.top = `${Math.max(56, r.top - picker.offsetHeight - 8)}px`;
        picker.style.left = `${Math.max(8, Math.min(m.authorId === me.publicId ? r.right - w : r.left, innerWidth - w - 8))}px`;
        picker.querySelector('button').focus({ preventScroll: true });
    }
    document.addEventListener('pointerdown', (e) => { if (picker && !picker.contains(e.target)) closePicker(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && picker) { e.stopImmediatePropagation(); closePicker(); } }, true);

    function openMore(m, anchor) {
        const mine = m.authorId === me.publicId;
        const items = [
            { label: 'Reply', icon: 'reply', onClick: () => startReply(m) },
            { label: 'Copy text', icon: 'copy', onClick: async () => { await copyText(m.text); toast('Copied'); } }
        ];
        if (mine) items.push({ label: 'Edit', icon: 'pen', onClick: () => startEdit(m) });
        if (mine || isOwner) {
            items.push('sep', {
                label: mine ? 'Delete for everyone' : 'Delete as room owner', icon: 'trash', danger: true,
                onClick: async () => {
                    const ok = await confirmDialog({ title: 'Delete this message?', message: 'It will be removed for everyone in the room.', confirmText: 'Delete', danger: true });
                    if (!ok) return;
                    try {
                        const { message } = await emit('chat:delete', { id: m.id });
                        onUpdated(message);
                    } catch (err) { toast(err.message, 'error'); }
                }
            });
        }
        openMenu(anchor, items, { align: mine ? 'start' : 'end' });
    }

    // Swipe a message to the right to reply, like on a phone.
    function attachSwipe(el, m) {
        let startX = 0; let startY = 0; let dx = 0; let tracking = false;
        el.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            startX = t.clientX; startY = t.clientY; dx = 0; tracking = true;
        }, { passive: true });
        el.addEventListener('touchmove', (e) => {
            if (!tracking) return;
            const t = e.touches[0];
            dx = t.clientX - startX;
            if (Math.abs(t.clientY - startY) > 24) { tracking = false; el.style.transform = ''; return; }
            if (dx > 0) el.style.transform = `translateX(${Math.min(dx, 72) * 0.8}px)`;
        }, { passive: true });
        el.addEventListener('touchend', () => {
            if (tracking && dx > 56) startReply(m);
            tracking = false;
            el.style.transition = 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)';
            el.style.transform = '';
            setTimeout(() => { el.style.transition = ''; }, 220);
        });
    }

    /* ---------- composer ---------- */

    function resize() {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight + 2, 148)}px`;
    }

    function setContext(next) {
        context = next;
        contextSlot.replaceChildren();
        if (!next) return;
        const m = next.message;
        const bar = html`<div class="context"><div class="what"><b></b><span></span></div><button class="btn quiet icon" type="button" aria-label="Cancel">${icon('x', 'sm')}</button></div>`;
        bar.querySelector('b').textContent = next.mode === 'edit' ? 'Editing message' : `Replying to ${m.authorId === me.publicId ? 'yourself' : m.authorName}`;
        bar.querySelector('span').textContent = m.text;
        bar.querySelector('button').addEventListener('click', () => { if (context?.mode === 'edit') input.value = ''; clearContext(); resize(); input.focus(); });
        contextSlot.append(bar);
    }
    const clearContext = () => setContext(null);

    function startReply(m) {
        setContext({ mode: 'reply', message: m });
        input.focus();
    }

    function startEdit(m) {
        setContext({ mode: 'edit', message: m });
        input.value = m.text;
        resize();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }

    let typingSentAt = 0;
    let typingStop = null;
    function signalTyping() {
        const socket = getSocket();
        if (!socket?.connected) return;
        if (Date.now() - typingSentAt > 2500) {
            socket.emit('chat:typing', true);
            typingSentAt = Date.now();
        }
        clearTimeout(typingStop);
        typingStop = setTimeout(stopTyping, 3500);
    }
    function stopTyping() {
        clearTimeout(typingStop);
        if (typingSentAt) getSocket()?.emit('chat:typing', false);
        typingSentAt = 0;
    }

    input.addEventListener('input', () => { resize(); if (input.value.trim()) signalTyping(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            form.requestSubmit();
        } else if (e.key === 'Escape' && context) {
            e.stopPropagation();
            if (context.mode === 'edit') input.value = '';
            clearContext();
            resize();
        } else if (e.key === 'ArrowUp' && !input.value) {
            const lastMine = [...order].reverse().map((id) => messages.get(id)).find((m) => m.authorId === me.publicId && !m.deleted && !m.pending);
            if (lastMine) { e.preventDefault(); startEdit(lastMine); }
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        stopTyping();
        input.value = '';
        resize();
        if (context?.mode === 'edit') {
            const m = context.message;
            clearContext();
            if (text === m.text) return;
            try {
                const { message } = await emit('chat:edit', { id: m.id, text });
                onUpdated(message);
            } catch (err) {
                toast(err.message, 'error');
            }
            return;
        }
        send(text);
    });

    /* ---------- typing indicator ---------- */

    const typers = new Map();
    function renderTyping() {
        const names = [...typers.values()].map((t) => t.name);
        typingLine.textContent = !names.length ? ''
            : names.length === 1 ? `${names[0]} is typing…`
                : names.length === 2 ? `${names[0]} and ${names[1]} are typing…`
                    : `${names.length} people are typing…`;
    }

    /* ---------- incoming events ---------- */

    function onMessage(m) {
        const stick = atBottom();
        typers.delete(m.authorId);
        renderTyping();
        append(m);
        if (m.authorId !== me.publicId) {
            if (!visible || !stick || document.hidden) setUnread(unread + 1);
        }
        if (stick && visible) scrollToBottom(true);
    }

    function onUpdated(m) {
        if (messages.has(m.id)) replace(m.id, { ...messages.get(m.id), ...m });
        // Replies quoting this message show the edit or deletion too.
        for (const id of order) {
            const other = messages.get(id);
            if (other.replyTo?.id === m.id) {
                replace(id, { ...other, replyTo: { ...other.replyTo, text: m.deleted ? '' : m.text.slice(0, 160), deleted: m.deleted } });
            }
        }
        if (context?.message.id === m.id && m.deleted) clearContext();
    }

    function onReactions({ id, reactions }) {
        const m = messages.get(id);
        if (!m) return;
        const stick = atBottom();
        replace(id, { ...m, reactions });
        if (stick) scrollToBottom();
    }

    // Someone changed their name: every message and quote of theirs shows the new one.
    function onRenamed(id, name) {
        if (id === me.publicId) me.name = name;
        let changed = false;
        for (const [key, m] of messages) {
            const next = { ...m };
            if (m.authorId === id) { next.authorName = name; changed = true; }
            if (m.replyTo?.authorId === id) { next.replyTo = { ...m.replyTo, authorName: name }; changed = true; }
            messages.set(key, next);
        }
        const typer = typers.get(id);
        if (typer) { typer.name = name; renderTyping(); }
        if (changed) renderAll({ keepBottom: atBottom() });
    }

    function onTyping({ id, name, typing }) {
        if (id === me.publicId) return;
        clearTimeout(typers.get(id)?.timer);
        if (typing) typers.set(id, { name, timer: setTimeout(() => { typers.delete(id); renderTyping(); }, 5000) });
        else typers.delete(id);
        renderTyping();
    }

    root.querySelector('[data-hide]').addEventListener('click', () => root.dispatchEvent(new CustomEvent('chat:hide')));

    return {
        load,
        onMessage,
        onUpdated,
        onReactions,
        onTyping,
        onRenamed,
        setSubtitle(text) { root.querySelector('[data-sub]').textContent = text; },
        setVisible(v) {
            visible = v;
            if (v) {
                requestAnimationFrame(() => { if (unread) scrollToBottom(); clearUnread(); });
            }
            onUnreadChange?.(unread, visible);
        },
        focus() { input.focus(); },
        get unread() { return unread; }
    };
}
