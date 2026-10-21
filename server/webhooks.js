import express from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from './config.js';
import { ROOM_PREFIX, statRoomFile } from './storage.js';
import { getRoom } from './rooms.js';
import { channel } from './realtime.js';

const KEY_RE = new RegExp(`^${ROOM_PREFIX}(\\d{5})/(.+)$`);

function isAuthorized(req) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    const a = Buffer.from(token);
    const b = Buffer.from(config.webhook.secret);
    return a.length === b.length && timingSafeEqual(a, b);
}

// S3 event records carry URL-encoded keys ("+" means space).
function decodeKey(key) {
    try { return decodeURIComponent(String(key).replace(/\+/g, ' ')); } catch { return String(key); }
}

async function handleRecord(io, record) {
    const event = record.eventName || '';
    const key = decodeKey(record.s3?.object?.key);
    const match = KEY_RE.exec(key);
    if (!match) return;
    const [, code, name] = match;
    if (!(await getRoom(code))) return;

    if (event.startsWith('s3:ObjectCreated:')) {
        const file = await statRoomFile(code, name);
        if (file) io.to(channel.room(code)).emit('file:added', file);
    } else if (event.startsWith('s3:ObjectRemoved:')) {
        io.to(channel.room(code)).emit('file:removed', { name });
    }
}

// MinIO bucket notifications -> Socket.IO broadcasts, so every client in a room
// sees new and deleted files without refreshing, no matter how they were written.
export function createWebhooks(io) {
    const router = express.Router();

    router.post('/webhooks/storage', express.json({ limit: '5mb' }), (req, res) => {
        if (!isAuthorized(req)) return res.sendStatus(401);
        res.sendStatus(204);
        const records = Array.isArray(req.body?.Records) ? req.body.Records : [];
        for (const record of records) {
            if (config.webhook.log) console.log('[webhook]', record.eventName, record.s3?.object?.key);
            handleRecord(io, record).catch((err) => console.error('[webhook]', err.message));
        }
    });

    return router;
}
