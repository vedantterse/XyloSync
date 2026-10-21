import express from 'express';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import { once } from 'events';
import { config } from './config.js';
import { HttpError, wrap, contentDisposition } from './http.js';
import { cleanDisplayName, setIdentity } from './identity.js';
import {
    createRoom, deleteRoom, getRoom, getAccess, canEnter, listUserRooms, toRoomDto,
    isLookupBlocked, recordLookupMiss, requestAdmission, cancelRequest, listRequests, listMembers,
    admit, deny, removeMember, rememberPerson, peopleNames, renameEverywhere, renameMember
} from './rooms.js';
import {
    minio, BUCKET, roomKey, roomPrefix, mailDraftPrefix, sanitizeFileName, uniqueRoomFileName,
    uploaderMetadata, statRoomFile, statOrNull, listRoomFiles, listObjects, roomUsage
} from './storage.js';
import { history } from './chat.js';
import { jobs, JOBS } from './queue.js';
import { channel } from './realtime.js';

const json = express.json({ limit: '2mb' });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const MAX_RECIPIENTS = 5;
const MAX_NOTE_CHARS = 100_000;

// Types that are safe to render inline in the browser. Everything else downloads.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon)|video\/|audio\/|application\/pdf$)/;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|log|csv|tsv|json|ya?ml|xml|ini|cfg|conf|toml|env|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|sh|bash|zsh|ps1|sql|css|scss|html?|vue|svelte)$/i;

function readFileHeader(req) {
    const raw = req.get('x-file-name');
    if (!raw) throw new HttpError(400, 'Missing X-File-Name header.');
    try {
        return sanitizeFileName(decodeURIComponent(raw));
    } catch {
        return sanitizeFileName(raw);
    }
}

// Stream the raw request body straight into MinIO: no buffering on disk, no size limit.
async function streamUpload(req, key, user) {
    const length = Number(req.get('content-length'));
    const size = Number.isFinite(length) && length >= 0 ? length : undefined;
    const type = req.get('x-file-type') || 'application/octet-stream';

    let aborted = false;
    req.on('close', () => { if (!req.complete) aborted = true; });

    try {
        await minio.putObject(BUCKET, key, req, size, uploaderMetadata(user, type));
    } catch (err) {
        if (aborted) throw new HttpError(499, 'Upload cancelled.');
        throw err;
    }
    if (aborted || !req.complete) {
        // Never keep a truncated object around.
        await minio.removeObject(BUCKET, key).catch(() => {});
        throw new HttpError(499, 'Upload cancelled.');
    }
}

const personDto = (entry) => ({ id: entry.publicId, name: entry.name, at: new Date(entry.at || entry.joinedAt).toISOString() });

export function createApi(io) {
    const api = express.Router();

    const loadRoom = wrap(async (req, res, next) => {
        if (await isLookupBlocked(req.ip)) {
            throw new HttpError(429, 'Too many invalid room codes. Try again in a few minutes.');
        }
        const room = await getRoom(req.params.code);
        if (!room) {
            await recordLookupMiss(req.ip);
            throw new HttpError(404, 'Room not found. It may have been deleted.');
        }
        req.room = room;
        req.access = await getAccess(room, req.user);
        // Inside the room people go by their room name (chosen in the waiting room for private rooms).
        req.member = { ...req.user, name: req.access.name || req.user.name };
        if (canEnter(req.access.access)) await rememberPerson(room.code, req.user, req.member.name);
        next();
    });

    // Files, notes and chat are only for people the room has let in.
    const requireMember = (req, res, next) => {
        if (!canEnter(req.access.access)) {
            return next(new HttpError(403, req.access.access === 'pending'
                ? 'Waiting for the owner to let you in.'
                : 'This room is private. Ask the owner to let you in.'));
        }
        next();
    };

    const requireOwner = (req, res, next) => {
        if (req.room.ownerId !== req.user.id) return next(new HttpError(403, 'Only the room owner can do that.'));
        next();
    };

    const notifyOwnerOfRequests = async (room) => {
        const requests = (await listRequests(room.code)).map(personDto);
        io.to(channel.user(room.ownerId)).emit('lobby:requests', { code: room.code, requests });
    };

    const broadcastMembers = async (room) => {
        const members = (await listMembers(room.code)).map(personDto);
        io.to(channel.room(room.code)).emit('room:members', { code: room.code, members });
    };

    /* ---------- identity ---------- */

    api.get('/me', (req, res) => {
        res.json({
            success: true,
            user: { name: req.user.name, publicId: req.user.publicId, custom: req.user.custom },
            limits: { maxRoomsPerUser: config.maxRoomsPerUser },
            mailInboxUrl: config.mail.inboxUrl || null
        });
    });

    // Tell everyone in a room that someone's name changed, so every screen updates in place.
    const announceRename = (code, user, name, isOwner) => {
        io.to(channel.room(code)).emit('room:renamed', { code, id: user.publicId, name, isOwner });
        io.broadcastPresence(code).catch(() => {});
    };

    api.patch('/me', json, wrap(async (req, res) => {
        const name = cleanDisplayName(req.body?.name);
        if (!name) throw new HttpError(400, 'Display name must be 2 to 32 characters.');
        const user = { ...req.user, name, custom: true };
        const affected = await renameEverywhere(user, name);
        setIdentity(res, user);
        for (const { code, isOwner } of affected) announceRename(code, user, name, isOwner);
        res.json({ success: true, user: { name, publicId: user.publicId, custom: true } });
    }));

    // In a private room, members change the name they use in that room only.
    api.patch('/rooms/:code/me', json, loadRoom, wrap(async (req, res) => {
        if (!req.room.requiresApproval || req.room.ownerId === req.user.id) {
            throw new HttpError(400, 'Change your name from the room menu — it applies everywhere.');
        }
        const name = await renameMember(req.room, req.user, req.body?.name);
        announceRename(req.room.code, req.user, name, false);
        await broadcastMembers(req.room);
        res.json({ success: true, name });
    }));

    /* ---------- rooms ---------- */

    api.get('/rooms', wrap(async (req, res) => {
        const rooms = await listUserRooms(req.user.id);
        const withUsage = await Promise.all(rooms.map(async (room) => ({
            ...toRoomDto(room, req.user),
            ...(await roomUsage(room.code))
        })));
        res.json({ success: true, rooms: withUsage, limit: config.maxRoomsPerUser });
    }));

    api.post('/rooms', json, wrap(async (req, res) => {
        const room = await createRoom(req.user, { requiresApproval: req.body?.requiresApproval === true });
        res.status(201).json({ success: true, room: toRoomDto(room, req.user) });
    }));

    api.get('/rooms/:code', loadRoom, (req, res) => {
        res.json({ success: true, room: toRoomDto(req.room, req.user, req.access) });
    });

    api.delete('/rooms/:code', loadRoom, requireOwner, wrap(async (req, res) => {
        const { code } = req.room;
        const { waitingUserIds } = await deleteRoom(code, req.user.id);
        io.to(channel.room(code)).emit('room:deleted', { code });
        for (const id of waitingUserIds) io.to(channel.user(id)).emit('room:deleted', { code });
        io.in(channel.room(code)).socketsLeave(channel.room(code));
        // Removing every object can take a while for big rooms, so it runs on the worker.
        await jobs.add(JOBS.purgeRoom, { code }, { jobId: `purge-${code}-${Date.now()}` });
        res.json({ success: true });
    }));

    /* ---------- waiting room ---------- */

    api.post('/rooms/:code/requests', json, loadRoom, wrap(async (req, res) => {
        const entry = await requestAdmission(req.room, req.user, req.body?.name);
        await notifyOwnerOfRequests(req.room);
        res.status(201).json({ success: true, request: personDto(entry) });
    }));

    api.delete('/rooms/:code/requests/me', loadRoom, wrap(async (req, res) => {
        if (await cancelRequest(req.room.code, req.user)) await notifyOwnerOfRequests(req.room);
        res.json({ success: true });
    }));

    api.get('/rooms/:code/requests', loadRoom, requireOwner, wrap(async (req, res) => {
        res.json({ success: true, requests: (await listRequests(req.room.code)).map(personDto) });
    }));

    api.post('/rooms/:code/requests/:pid/admit', loadRoom, requireOwner, wrap(async (req, res) => {
        const member = await admit(req.room.code, req.params.pid);
        io.to(channel.user(member.userId)).emit('lobby:admitted', { code: req.room.code, name: member.name });
        await Promise.all([notifyOwnerOfRequests(req.room), broadcastMembers(req.room)]);
        res.json({ success: true, member: personDto(member) });
    }));

    api.post('/rooms/:code/requests/:pid/deny', loadRoom, requireOwner, wrap(async (req, res) => {
        const request = await deny(req.room.code, req.params.pid);
        io.to(channel.user(request.userId)).emit('lobby:denied', { code: req.room.code });
        await notifyOwnerOfRequests(req.room);
        res.json({ success: true });
    }));

    api.get('/rooms/:code/members', loadRoom, requireMember, wrap(async (req, res) => {
        const members = req.room.requiresApproval ? (await listMembers(req.room.code)).map(personDto) : [];
        res.json({ success: true, members });
    }));

    api.delete('/rooms/:code/members/:pid', loadRoom, requireOwner, wrap(async (req, res) => {
        const member = await removeMember(req.room.code, req.params.pid);
        const { code } = req.room;
        io.to(channel.user(member.userId)).emit('room:removed', { code });
        io.in(channel.user(member.userId)).socketsLeave(channel.room(code));
        await broadcastMembers(req.room);
        io.broadcastPresence(code).catch(() => {});
        res.json({ success: true });
    }));

    /* ---------- chat ---------- */

    api.get('/rooms/:code/messages', loadRoom, requireMember, wrap(async (req, res) => {
        const before = typeof req.query.before === 'string' ? req.query.before : undefined;
        res.json({ success: true, ...(await history(req.room.code, { before, limit: Number(req.query.limit) || 60 })) });
    }));

    /* ---------- files ---------- */

    api.get('/rooms/:code/files', loadRoom, requireMember, wrap(async (req, res) => {
        const [files, names] = await Promise.all([listRoomFiles(req.room.code), peopleNames(req.room.code)]);
        res.json({ success: true, files: files.map((f) => ({ ...f, uploader: names[f.uploaderId] || f.uploader })) });
    }));

    api.post('/rooms/:code/files', loadRoom, requireMember, wrap(async (req, res) => {
        const { code } = req.room;
        const name = await uniqueRoomFileName(code, readFileHeader(req));
        await streamUpload(req, roomKey(code, name), req.member);
        res.status(201).json({ success: true, file: await statRoomFile(code, name) });
    }));

    api.post('/rooms/:code/notes', json, loadRoom, requireMember, wrap(async (req, res) => {
        const content = String(req.body?.content ?? '');
        if (!content.trim()) throw new HttpError(400, 'Write something before saving the note.');
        if (content.length > MAX_NOTE_CHARS) throw new HttpError(413, 'Notes are limited to 100,000 characters.');

        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
        let base = sanitizeFileName(String(req.body?.name || '').trim() || `Note ${stamp}`);
        if (!/\.(txt|md)$/i.test(base)) base += '.txt';

        const { code } = req.room;
        const name = await uniqueRoomFileName(code, base);
        const body = Buffer.from(content, 'utf8');
        await minio.putObject(BUCKET, roomKey(code, name), body, body.length,
            uploaderMetadata(req.member, 'text/plain; charset=utf-8'));
        res.status(201).json({ success: true, file: await statRoomFile(code, name) });
    }));

    api.get('/rooms/:code/files/:name', loadRoom, requireMember, wrap(async (req, res) => {
        const name = req.params.name;
        const key = roomKey(req.room.code, name);
        const stat = await statOrNull(key);
        if (!stat) throw new HttpError(404, 'File not found.');

        const storedType = stat.metaData?.['content-type'] || 'application/octet-stream';
        let type = 'application/octet-stream';
        let disposition = 'attachment';
        if (req.query.inline) {
            if (INLINE_TYPES.test(storedType)) {
                type = storedType;
                disposition = 'inline';
            } else if (storedType.startsWith('text/') || TEXT_EXTENSIONS.test(name)) {
                type = 'text/plain; charset=utf-8';
                disposition = 'inline';
            }
        }

        res.setHeader('Content-Type', type);
        res.setHeader('Content-Disposition', contentDisposition(disposition, name));
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('ETag', `"${stat.etag}"`);
        res.setHeader('Last-Modified', new Date(stat.lastModified).toUTCString());
        res.setHeader('Cache-Control', 'private, no-cache');
        // User content is rendered in a sandbox so an uploaded SVG/HTML file can't run scripts.
        if (type !== 'application/pdf') res.setHeader('Content-Security-Policy', 'sandbox; default-src \'none\'; img-src \'self\' data:; media-src \'self\'; style-src \'unsafe-inline\'');

        if (req.get('if-none-match') === `"${stat.etag}"`) return res.status(304).end();

        const size = Number(stat.size);
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
        let stream;
        if (range && size > 0 && (range[1] || range[2])) {
            const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
            const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            if (start > end || start >= size) {
                res.setHeader('Content-Range', `bytes */${size}`);
                return res.status(416).end();
            }
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
            res.setHeader('Content-Length', end - start + 1);
            stream = await minio.getPartialObject(BUCKET, key, start, end - start + 1);
        } else {
            res.setHeader('Content-Length', size);
            stream = await minio.getObject(BUCKET, key);
        }
        if (req.method === 'HEAD') return stream.destroy(), res.end();
        stream.on('error', (err) => res.destroy(err));
        res.on('close', () => stream.destroy());
        stream.pipe(res);
    }));

    api.delete('/rooms/:code/files/:name', loadRoom, requireOwner, wrap(async (req, res) => {
        const key = roomKey(req.room.code, req.params.name);
        if (!(await statOrNull(key))) throw new HttpError(404, 'File not found.');
        await minio.removeObject(BUCKET, key);
        res.json({ success: true });
    }));

    api.get('/rooms/:code/archive', loadRoom, requireMember, wrap(async (req, res) => {
        const { code } = req.room;
        const prefix = roomPrefix(code);
        const objects = await listObjects(prefix);
        if (!objects.length) throw new HttpError(404, 'This room has no files yet.');

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', contentDisposition('attachment', `XyloSync-${code}.zip`));
        const archive = archiver('zip', { store: true });
        archive.on('warning', (err) => console.warn('[archive]', err.message));
        archive.on('error', (err) => res.destroy(err));
        res.on('close', () => { if (!res.writableFinished) archive.abort(); });
        archive.pipe(res);
        // Open one object at a time so large rooms don't hold hundreds of connections.
        for (const obj of objects) {
            if (res.destroyed) return;
            const stream = await minio.getObject(BUCKET, obj.name);
            archive.append(stream, { name: obj.name.slice(prefix.length), date: obj.lastModified });
            await once(archive, 'entry');
        }
        await archive.finalize();
    }));

    /* ---------- email ---------- */

    api.put('/mail/drafts/:draftId/files', wrap(async (req, res) => {
        const { draftId } = req.params;
        if (!UUID_RE.test(draftId)) throw new HttpError(400, 'Invalid draft id.');
        const name = readFileHeader(req);
        await streamUpload(req, `${mailDraftPrefix(req.user.id, draftId)}${name}`, req.user);
        res.status(201).json({ success: true, name });
    }));

    api.post('/mail/send', json, wrap(async (req, res) => {
        const { draftId, message = '', roomCode } = req.body || {};
        if (draftId && !UUID_RE.test(draftId)) throw new HttpError(400, 'Invalid draft id.');
        const roomFiles = Array.isArray(req.body?.roomFiles)
            ? [...new Set(req.body.roomFiles.map((n) => String(n)))].slice(0, 500)
            : [];

        const recipients = [...new Set((Array.isArray(req.body?.recipients) ? req.body.recipients : [])
            .map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
        if (!recipients.length) throw new HttpError(400, 'Add at least one recipient.');
        if (recipients.length > MAX_RECIPIENTS) throw new HttpError(400, `Up to ${MAX_RECIPIENTS} recipients per email.`);
        const invalid = recipients.find((e) => !EMAIL_RE.test(e));
        if (invalid) throw new HttpError(400, `"${invalid}" is not a valid email address.`);
        if (String(message).length > 1000) throw new HttpError(400, 'Message is limited to 1000 characters.');

        // Files picked from a room: the sender must still be allowed in that room.
        let senderName = req.user.name;
        if (roomFiles.length) {
            if (await isLookupBlocked(req.ip)) throw new HttpError(429, 'Too many invalid room codes. Try again in a few minutes.');
            const room = await getRoom(roomCode);
            if (!room) {
                await recordLookupMiss(req.ip);
                throw new HttpError(404, 'Room not found.');
            }
            const access = await getAccess(room, req.user);
            if (!canEnter(access.access)) throw new HttpError(403, 'You are not in this room.');
            senderName = access.name;
            for (const name of roomFiles) {
                if (!(await statOrNull(roomKey(room.code, name)))) throw new HttpError(400, `“${name}” is no longer in the room.`);
            }
        }

        const uploaded = draftId ? await listObjects(mailDraftPrefix(req.user.id, draftId)) : [];
        if (!uploaded.length && !roomFiles.length) throw new HttpError(400, 'Attach at least one file.');

        const job = await jobs.add(JOBS.sendMail, {
            userId: req.user.id,
            senderName,
            draftId: draftId || null,
            roomCode: roomFiles.length ? roomCode : null,
            roomFiles,
            recipients,
            message: String(message).trim()
        }, { jobId: `mail-${draftId || randomUUID()}` });

        res.status(202).json({ success: true, jobId: job.id });
    }));

    return api;
}
