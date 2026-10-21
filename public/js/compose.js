// Quick notes and email composition dialogs for the room page.
import { api, icon, html, toast, openModal, formatBytes, extLabel, escapeHtml, session, uploadRaw, uuid, allowedFiles, maxFileLabel } from './common.js';

/* ======================================================================
   Notes
   ====================================================================== */

export function openNoteDialog(code, onSaved) {
    const dialog = html`
        <form class="modal wide" role="dialog" aria-modal="true" autocomplete="off">
            <div class="modal-head">
                <div class="titles">
                    <h2>New note</h2>
                    <p>Saved to the room as a text file everyone can open. Formatting is preserved.</p>
                </div>
                <button type="button" class="btn quiet icon" data-close title="Close" aria-label="Close">${icon('x')}</button>
            </div>
            <div class="modal-body">
                <div class="field">
                    <label for="noteName">Title</label>
                    <input class="input" id="noteName" maxlength="80" placeholder="Untitled note">
                </div>
                <div class="field">
                    <label for="noteBody">Note</label>
                    <textarea class="textarea note-editor" style="min-height:240px;font-family:var(--mono);font-size:13px" id="noteBody" maxlength="100000" placeholder="Paste a link, a snippet, a to-do list…" autofocus></textarea>
                    <div class="hint field-hint"><span class="count">0 characters</span><span>Ctrl Enter to save</span></div>
                </div>
            </div>
            <div class="modal-foot">
                <button type="button" class="btn quiet" data-close>Cancel</button>
                <button type="submit" class="btn primary">Save to room</button>
            </div>
        </form>`;

    const body = dialog.querySelector('#noteBody');
    const count = dialog.querySelector('.count');
    const submit = dialog.querySelector('[type=submit]');
    const modal = openModal(dialog);

    body.addEventListener('input', () => {
        count.textContent = `${body.value.length.toLocaleString()} character${body.value.length === 1 ? '' : 's'}`;
    });
    body.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            body.setRangeText('\t', body.selectionStart, body.selectionEnd, 'end');
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) dialog.requestSubmit();
    });

    dialog.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!body.value.trim()) {
            body.focus();
            return toast('Write something first', 'info');
        }
        submit.disabled = true;
        try {
            const { file } = await api(`/api/rooms/${code}/notes`, {
                method: 'POST',
                body: { name: dialog.querySelector('#noteName').value, content: body.value }
            });
            onSaved?.(file);
            modal.close();
            toast(`Saved “${file.name}”`, 'success');
        } catch (err) {
            toast(err.message, 'error');
            submit.disabled = false;
        }
    });
}

/* ======================================================================
   Email
   ====================================================================== */

const MAX_RECIPIENTS = 5;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const pendingJobs = new Set();

export function handleMailStatus({ jobId, status, recipients, error }) {
    if (!pendingJobs.has(jobId)) return;
    if (status === 'sent') {
        pendingJobs.delete(jobId);
        toast(`Email delivered to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`, 'success', { duration: 4500 });
    } else if (status === 'failed') {
        pendingJobs.delete(jobId);
        toast(`Email failed: ${error || 'unknown error'}`, 'error', { duration: 6000 });
    }
}

export function openMailDialog({ roomCode = null, roomFiles = [] } = {}) {
    const inbox = session.mailInboxUrl;
    const dialog = html`
        <form class="modal wide" role="dialog" aria-modal="true" autocomplete="off" novalidate>
            <div class="modal-head">
                <div class="titles">
                    <h2>Email files</h2>
                    <p>Recipients get everything as one ZIP attachment. Delivery runs in the background.</p>
                </div>
                <button type="button" class="btn quiet icon" data-close title="Close" aria-label="Close">${icon('x')}</button>
            </div>
            <div class="modal-body">
                <div class="field">
                    <label for="mailTo">To</label>
                    <div class="chips-input" id="chips">
                        <input id="mailTo" type="email" inputmode="email" placeholder="name@example.com" autofocus>
                    </div>
                    <div class="hint field-hint"><span>Press Enter or comma to add · up to ${MAX_RECIPIENTS}</span><span class="rcount">0/${MAX_RECIPIENTS}</span></div>
                </div>
                <div class="field">
                    <label for="mailMsg">Message <span class="subtle">(optional)</span></label>
                    <textarea class="textarea" id="mailMsg" maxlength="1000" rows="3" placeholder="Here are the files we talked about."></textarea>
                </div>
                <div class="field" data-room-files hidden>
                    <span class="label">From this room <span class="hint" data-room-count></span></span>
                    <div class="pick-list"></div>
                </div>
                <div class="field">
                    <span class="label">Upload from this device</span>
                    <label class="attach-drop" id="attachDrop">
                        ${icon('paperclip')}<span>Drop files here or <u>browse</u> — up to ${maxFileLabel()} each</span>
                        <input type="file" multiple hidden>
                    </label>
                    <div class="attach-list"></div>
                </div>
            </div>
            <div class="modal-foot">
                <span class="left">${inbox ? `Local mail lands in <a href="${inbox}" target="_blank" rel="noopener">Mailpit ↗</a>` : ''}</span>
                <button type="button" class="btn quiet" data-close>Cancel</button>
                <button type="submit" class="btn primary"><span class="send-label">Send</span></button>
            </div>
        </form>`;

    const chips = dialog.querySelector('#chips');
    const toInput = dialog.querySelector('#mailTo');
    const rcount = dialog.querySelector('.rcount');
    const drop = dialog.querySelector('#attachDrop');
    const fileInput = drop.querySelector('input');
    const list = dialog.querySelector('.attach-list');
    const submit = dialog.querySelector('[type=submit]');
    const sendLabel = dialog.querySelector('.send-label');

    const recipients = [];
    const attachments = [];
    const picked = new Set();
    let sending = false;

    const modal = openModal(dialog, {
        onClose: () => attachments.forEach((a) => a.request?.abort())
    });

    /* recipients */
    const renderCount = () => {
        rcount.textContent = `${recipients.length}/${MAX_RECIPIENTS}`;
        toInput.hidden = recipients.length >= MAX_RECIPIENTS;
    };
    const addRecipient = (raw) => {
        const email = raw.trim().replace(/[,;]+$/, '').toLowerCase();
        if (!email) return true;
        if (!EMAIL_RE.test(email)) { toast(`“${email}” doesn’t look like an email address`, 'error'); return false; }
        if (recipients.includes(email)) return true;
        if (recipients.length >= MAX_RECIPIENTS) { toast(`Up to ${MAX_RECIPIENTS} recipients`, 'info'); return false; }
        recipients.push(email);
        const chip = html`<span class="chip"><span></span><button type="button" aria-label="Remove">${icon('x', 'sm')}</button></span>`;
        chip.firstElementChild.textContent = email;
        chip.querySelector('button').addEventListener('click', () => {
            recipients.splice(recipients.indexOf(email), 1);
            chip.remove();
            renderCount();
            toInput.focus();
        });
        chips.insertBefore(chip, toInput);
        renderCount();
        return true;
    };
    const commitInput = () => {
        const parts = toInput.value.split(/[\s,;]+/).filter(Boolean);
        const rejected = parts.filter((p) => !addRecipient(p));
        toInput.value = rejected.join(', ');
    };
    chips.addEventListener('click', () => toInput.focus());
    toInput.addEventListener('keydown', (e) => {
        if (['Enter', ',', ';', ' '].includes(e.key)) {
            if (toInput.value.trim()) { e.preventDefault(); commitInput(); }
            else if (e.key === 'Enter') e.preventDefault();
        } else if (e.key === 'Backspace' && !toInput.value && recipients.length) {
            chips.querySelectorAll('.chip')[recipients.length - 1]?.querySelector('button').click();
        }
    });
    toInput.addEventListener('blur', commitInput);
    // Mobile keyboards and autofill don't send usable keydown events, so also watch the value.
    toInput.addEventListener('input', () => { if (/[\s,;]/.test(toInput.value)) commitInput(); });

    /* attachments */
    const renderAttachments = () => {
        list.replaceChildren(...attachments.map((a) => a.row));
        const total = attachments.reduce((s, a) => s + a.file.size, 0) + [...picked].reduce((s, f) => s + f.size, 0);
        const count = attachments.length + picked.size;
        sendLabel.textContent = count ? `Send ${count} ${count === 1 ? 'file' : 'files'} · ${formatBytes(total)}` : 'Send';
        const roomCount = dialog.querySelector('[data-room-count]');
        if (roomCount) roomCount.textContent = picked.size ? `· ${picked.size} selected` : '';
    };
    const addFiles = (files) => {
        for (const file of allowedFiles(files)) {
            const row = html`
                <div class="attach-item">
                    <span class="attach-ext">${escapeHtml(extLabel(file.name))}</span>
                    <span class="name"></span>
                    <span class="size">${formatBytes(file.size)}</span>
                    <button type="button" class="btn quiet icon" title="Remove" aria-label="Remove">${icon('x', 'sm')}</button>
                </div>`;
            row.querySelector('.name').textContent = file.name;
            const entry = { file, row, request: null };
            row.querySelector('button').addEventListener('click', () => {
                if (sending) return;
                attachments.splice(attachments.indexOf(entry), 1);
                renderAttachments();
            });
            attachments.push(entry);
        }
        renderAttachments();
    };
    fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        addFiles(e.dataTransfer.files);
    });

    /* files already in the room */
    if (roomCode && roomFiles.length) {
        const section = dialog.querySelector('[data-room-files]');
        const pickList = section.querySelector('.pick-list');
        section.hidden = false;
        for (const f of roomFiles) {
            const row = html`<label class="pick"><input type="checkbox"><span class="attach-ext">${escapeHtml(extLabel(f.name))}</span><span class="name"></span><span class="size">${formatBytes(f.size)}</span></label>`;
            row.querySelector('.name').textContent = f.name;
            row.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) picked.add(f); else picked.delete(f);
                renderAttachments();
            });
            pickList.append(row);
        }
    }

    /* send */
    dialog.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (sending) return;
        commitInput();
        if (!recipients.length) { toInput.focus(); return toast('Add at least one recipient', 'info'); }
        if (!attachments.length && !picked.size) return toast('Pick or upload at least one file', 'info');

        sending = true;
        submit.disabled = true;
        modal.dismissible = false;
        const draftId = attachments.length ? uuid() : undefined;
        const total = attachments.reduce((s, a) => s + a.file.size, 0) || 1;
        const loaded = new Map();
        const progress = () => {
            const sum = [...loaded.values()].reduce((s, v) => s + v, 0);
            sendLabel.textContent = `Uploading ${Math.floor((sum / total) * 100)}%`;
        };

        try {
            for (const a of attachments) {
                let bar = a.row.querySelector('.bar-track');
                if (!bar) {
                    bar = html`<div class="bar-track" style="width:64px"><span></span></div>`;
                    a.row.querySelector('.size').replaceWith(bar);
                }
                a.row.querySelector('button').hidden = true;
                a.request = uploadRaw(`/api/mail/drafts/${draftId}/files`, a.file, {
                    method: 'PUT',
                    onProgress: (l, t) => {
                        loaded.set(a, l);
                        bar.firstElementChild.style.width = `${(l / t) * 100}%`;
                        progress();
                    }
                });
                await a.request.promise;
                loaded.set(a, a.file.size);
                bar.firstElementChild.style.width = '100%';
            }
            sendLabel.textContent = 'Queueing…';
            const { jobId } = await api('/api/mail/send', {
                method: 'POST',
                body: {
                    draftId,
                    recipients,
                    message: dialog.querySelector('#mailMsg').value,
                    ...(picked.size ? { roomCode, roomFiles: [...picked].map((f) => f.name) } : {})
                }
            });
            pendingJobs.add(jobId);
            modal.dismissible = true;
            modal.close();
            toast('Email queued — you’ll be notified when it’s delivered', 'info', { duration: 4500 });
        } catch (err) {
            sending = false;
            submit.disabled = false;
            modal.dismissible = true;
            sendLabel.textContent = 'Retry';
            if (err.status !== 499) toast(err.message, 'error');
        }
    });

    renderCount();
}
