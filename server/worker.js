import fs from 'fs';
import os from 'os';
import path from 'path';
import { once } from 'events';
import { Worker } from 'bullmq';
import archiver from 'archiver';
import { Emitter } from '@socket.io/redis-emitter';
import { createRedis, createQueueConnection } from './redis.js';
import { QUEUE_NAME, JOBS } from './queue.js';
import {
    minio, BUCKET, ensureBucket, listObjects, mailDraftPrefix, removePrefix, roomPrefix, roomKey, statOrNull
} from './storage.js';
import { transporter, renderMail } from './mailer.js';
import { destroyRoom, dueRooms, backfillExpiry } from './rooms.js';
import { config } from './config.js';

// Background jobs: email delivery, room cleanup and room expiry. Runs as its own container.
const emitter = new Emitter(createRedis());
const notifyUser = (userId, event, payload) => emitter.to(`user:${userId}`).emit(event, payload);

// Two attachments with the same name (an upload and a room file) must not collide in the ZIP.
function uniqueNames(entries) {
    const seen = new Set();
    return entries.map((entry) => {
        let name = entry.name;
        const dot = name.lastIndexOf('.');
        for (let n = 1; seen.has(name.toLowerCase()); n++) {
            name = dot > 0 ? `${entry.name.slice(0, dot)} (${n})${entry.name.slice(dot)}` : `${entry.name} (${n})`;
        }
        seen.add(name.toLowerCase());
        return { ...entry, name };
    });
}

async function zipEntries(entries, destination) {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(output);
    for (const entry of entries) {
        const stream = await minio.getObject(BUCKET, entry.key);
        archive.append(stream, { name: entry.name, date: entry.lastModified });
        await once(archive, 'entry');
    }
    await Promise.all([archive.finalize(), once(output, 'close')]);
}

async function sendMail(job) {
    const { userId, senderName, draftId, roomCode, roomFiles = [], recipients, message } = job.data;

    const entries = [];
    if (draftId) {
        const prefix = mailDraftPrefix(userId, draftId);
        for (const obj of await listObjects(prefix)) {
            entries.push({ key: obj.name, name: obj.name.slice(prefix.length), size: Number(obj.size) || 0, lastModified: obj.lastModified });
        }
    }
    for (const name of roomFiles) {
        const stat = await statOrNull(roomKey(roomCode, name));
        if (stat) entries.push({ key: roomKey(roomCode, name), name, size: Number(stat.size) || 0, lastModified: stat.lastModified });
    }
    if (!entries.length) throw new Error('The attachments are missing or were deleted.');

    const files = uniqueNames(entries);
    const { html, text, subject } = renderMail({ senderName, message, files });
    const zipPath = path.join(os.tmpdir(), `xylosync-${job.id}-${Date.now()}.zip`);
    const zipName = `XyloSync-${new Date().toISOString().slice(0, 10)}.zip`;

    notifyUser(userId, 'mail:status', { jobId: job.id, status: 'processing' });
    try {
        await zipEntries(files, zipPath);
        // Remember who already got it so a retry never sends twice.
        const delivered = new Set(job.data.delivered || []);
        for (const to of recipients) {
            if (delivered.has(to)) continue;
            await transporter.sendMail({
                from: config.mail.from,
                to,
                subject,
                html,
                text,
                attachments: [{ filename: zipName, path: zipPath, contentType: 'application/zip' }]
            });
            delivered.add(to);
            await job.updateData({ ...job.data, delivered: [...delivered] });
        }
    } finally {
        fs.rm(zipPath, { force: true }, () => {});
    }

    if (draftId) await removePrefix(mailDraftPrefix(userId, draftId));
    notifyUser(userId, 'mail:status', { jobId: job.id, status: 'sent', recipients });
    return { recipients: recipients.length, files: files.length };
}

async function purgeRoom(job) {
    const removed = await removePrefix(roomPrefix(job.data.code));
    return { removed };
}

/* ---------- room expiry ---------- */

async function expireRooms() {
    for (const code of await dueRooms()) {
        const result = await destroyRoom(code);
        if (result) {
            const payload = { code, reason: 'expired' };
            emitter.to(`room:${code}`).emit('room:deleted', payload);
            for (const id of result.waitingUserIds) notifyUser(id, 'room:deleted', payload);
            emitter.in(`room:${code}`).socketsLeave(`room:${code}`);
            console.log(`[worker] room ${code} expired`);
        }
        await removePrefix(roomPrefix(code));
    }
}

await ensureBucket();
const backfilled = await backfillExpiry();
if (backfilled) console.log(`[worker] set an expiry on ${backfilled} older room(s)`);

const worker = new Worker(QUEUE_NAME, async (job) => {
    switch (job.name) {
        case JOBS.sendMail: return sendMail(job);
        case JOBS.purgeRoom: return purgeRoom(job);
        default: throw new Error(`Unknown job ${job.name}`);
    }
}, { connection: createQueueConnection(), concurrency: 4 });

worker.on('completed', (job, result) => console.log(`[worker] ${job.name} #${job.id} done`, result));
worker.on('failed', (job, err) => {
    console.error(`[worker] ${job?.name} #${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
    if (job?.name === JOBS.sendMail && job.attemptsMade >= (job.opts.attempts || 1)) {
        notifyUser(job.data.userId, 'mail:status', { jobId: job.id, status: 'failed', error: err.message });
    }
});

let sweeping = false;
const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try { await expireRooms(); } catch (err) { console.error('[worker] expiry sweep failed:', err.message); } finally { sweeping = false; }
};
const sweeper = setInterval(sweep, 20_000);
sweep();

console.log(`[worker] XyloSync worker ready · rooms expire after ${config.roomTtlHours || '∞'} h`);

const shutdown = async () => {
    clearInterval(sweeper);
    await worker.close();
    process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
