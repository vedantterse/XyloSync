import * as Minio from 'minio';
import { config } from './config.js';
import { publicId } from './identity.js';

export const minio = new Minio.Client({
    endPoint: config.minio.endPoint,
    port: config.minio.port,
    useSSL: config.minio.useSSL,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
    region: config.minio.region
});

export const BUCKET = config.minio.bucket;

export const ROOM_PREFIX = 'rooms/';
export const MAIL_PREFIX = '_mail/';

export const roomPrefix = (code) => `${ROOM_PREFIX}${code}/`;
export const roomKey = (code, name) => `${roomPrefix(code)}${name}`;
export const mailDraftPrefix = (userId, draftId) => `${MAIL_PREFIX}${userId}/${draftId}/`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ensureBucket({ attempts = 30 } = {}) {
    for (let i = 1; ; i++) {
        try {
            if (!(await minio.bucketExists(BUCKET))) {
                await minio.makeBucket(BUCKET, config.minio.region);
                console.log(`[storage] created bucket "${BUCKET}"`);
            }
            // Abandoned email attachments are cleaned up automatically after a day.
            await minio.setBucketLifecycle(BUCKET, {
                Rule: [{
                    ID: 'expire-mail-drafts',
                    Status: 'Enabled',
                    Filter: { Prefix: MAIL_PREFIX },
                    Expiration: { Days: 1 }
                }]
            });
            return;
        } catch (err) {
            if (i >= attempts) throw err;
            console.log(`[storage] waiting for MinIO (${err.code || err.message})`);
            await sleep(2000);
        }
    }
}

// Ask MinIO to call our webhook whenever an object inside rooms/ is created or removed.
export async function enableBucketWebhook({ attempts = 30 } = {}) {
    const arn = Minio.buildARN('minio', 'sqs', '', config.webhook.targetId, 'webhook');
    const queue = new Minio.QueueConfig(arn);
    queue.addFilterPrefix(ROOM_PREFIX);
    queue.addEvent(Minio.ObjectCreatedAll);
    queue.addEvent(Minio.ObjectRemovedAll);
    const notification = new Minio.NotificationConfig();
    notification.add(queue);

    for (let i = 1; ; i++) {
        try {
            await minio.setBucketNotification(BUCKET, notification);
            console.log(`[storage] bucket events -> ${arn}`);
            return;
        } catch (err) {
            if (i >= attempts) throw err;
            console.log(`[storage] waiting to register bucket webhook (${err.code || err.message})`);
            await sleep(2000);
        }
    }
}

export function sanitizeFileName(raw) {
    let name = String(raw ?? '')
        .normalize('NFC')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/]/g, '_')
        .replace(/^[.\s]+/, '')
        .trim();
    if (name.length > 200) {
        const dot = name.lastIndexOf('.');
        const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
        name = name.slice(0, 200 - ext.length) + ext;
    }
    return name || 'file';
}

const isNotFound = (err) => ['NotFound', 'NoSuchKey'].includes(err?.code);

export async function statOrNull(key) {
    try {
        return await minio.statObject(BUCKET, key);
    } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
    }
}

// "report.pdf" -> "report (1).pdf" when the name is already taken in the room.
export async function uniqueRoomFileName(code, name) {
    if (!(await statOrNull(roomKey(code, name)))) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; n < 1000; n++) {
        const candidate = `${base} (${n})${ext}`;
        if (!(await statOrNull(roomKey(code, candidate)))) return candidate;
    }
    return `${base} (${Date.now()})${ext}`;
}

export function uploaderMetadata(user, contentType) {
    return {
        'Content-Type': contentType || 'application/octet-stream',
        'X-Amz-Meta-Uploader-Id': user.id,
        // Header values must be ASCII, so the display name is URI-encoded.
        'X-Amz-Meta-Uploader-Name': encodeURIComponent(user.name)
    };
}

function decodeMeta(value) {
    try { return decodeURIComponent(value); } catch { return value; }
}

export function toFileDto(name, { size, lastModified, metaData = {} }) {
    return {
        name,
        size: Number(size) || 0,
        type: metaData['content-type'] || 'application/octet-stream',
        uploadedAt: new Date(lastModified || Date.now()).toISOString(),
        uploader: metaData['uploader-name'] ? decodeMeta(metaData['uploader-name']) : null,
        // The public id lets screens show the uploader's current name after a rename.
        uploaderId: metaData['uploader-id'] ? publicId(metaData['uploader-id']) : null
    };
}

export async function statRoomFile(code, name) {
    const stat = await statOrNull(roomKey(code, name));
    return stat ? toFileDto(name, stat) : null;
}

export function listObjects(prefix) {
    return new Promise((resolve, reject) => {
        const objects = [];
        const stream = minio.listObjectsV2(BUCKET, prefix, true);
        stream.on('data', (obj) => obj.name && objects.push(obj));
        stream.on('error', reject);
        stream.on('end', () => resolve(objects));
    });
}

async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}

export async function listRoomFiles(code) {
    const prefix = roomPrefix(code);
    const objects = await listObjects(prefix);
    const files = await mapLimit(objects, 16, (obj) => statRoomFile(code, obj.name.slice(prefix.length)));
    return files.filter(Boolean).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function roomUsage(code) {
    const objects = await listObjects(roomPrefix(code));
    return {
        fileCount: objects.length,
        totalSize: objects.reduce((sum, obj) => sum + (Number(obj.size) || 0), 0)
    };
}

export async function removePrefix(prefix) {
    const objects = await listObjects(prefix);
    const names = objects.map((obj) => obj.name);
    for (let i = 0; i < names.length; i += 1000) {
        await minio.removeObjects(BUCKET, names.slice(i, i + 1000));
    }
    return names.length;
}
