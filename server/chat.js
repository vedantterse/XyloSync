import { randomBytes } from 'crypto';
import { redis } from './redis.js';
import { keys } from './rooms.js';
import { HttpError } from './http.js';

// Room chat lives in Redis next to the room and is deleted with it:
//   chat:ids        list of message ids, oldest first
//   chat:msgs       id -> message JSON
//   chat:reactions  "<messageId>|<authorId>" -> emoji (one reaction per person, like WhatsApp)
export const MAX_TEXT = 4000;
const MAX_HISTORY = 2000;
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const newId = () => `${Date.now().toString(36).padStart(9, '0')}${randomBytes(4).toString('hex')}`;
const parse = (json) => { try { return JSON.parse(json); } catch { return null; } };

function cleanText(raw) {
    const text = String(raw ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
    if (!text) throw new HttpError(400, 'Message is empty.');
    if (text.length > MAX_TEXT) throw new HttpError(400, `Messages are limited to ${MAX_TEXT} characters.`);
    return text;
}

function isEmoji(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 16 && /\p{Extended_Pictographic}/u.test(value) && !/\s/.test(value);
}

async function reactionsFor(code, ids) {
    if (!ids.length) return {};
    const wanted = new Set(ids);
    const all = await redis.hgetall(keys.chatReactions(code));
    const byMessage = {};
    for (const [field, emoji] of Object.entries(all)) {
        const [id, authorId] = field.split('|');
        if (!wanted.has(id)) continue;
        ((byMessage[id] ||= {})[emoji] ||= []).push(authorId);
    }
    return byMessage;
}

async function withReactions(code, messages) {
    const [reactions, names] = await Promise.all([
        reactionsFor(code, messages.map((m) => m.id)),
        redis.hgetall(keys.people(code))
    ]);
    // Authors are shown under their current name, even on old messages and quotes.
    return messages.map((m) => ({
        ...m,
        authorName: names[m.authorId] || m.authorName,
        replyTo: m.replyTo ? { ...m.replyTo, authorName: names[m.replyTo.authorId] || m.replyTo.authorName } : null,
        reactions: reactions[m.id] || {}
    }));
}

export async function history(code, { before, limit = 60 } = {}) {
    const total = await redis.llen(keys.chatIds(code));
    let end = total - 1;
    if (before) {
        const ids = await redis.lrange(keys.chatIds(code), 0, -1);
        const index = ids.indexOf(before);
        end = index === -1 ? -1 : index - 1;
    }
    if (end < 0) return { messages: [], hasMore: false };
    const start = Math.max(0, end - Math.min(limit, 200) + 1);
    const ids = await redis.lrange(keys.chatIds(code), start, end);
    const raw = ids.length ? await redis.hmget(keys.chatMsgs(code), ...ids) : [];
    const messages = raw.map(parse).filter(Boolean);
    return { messages: await withReactions(code, messages), hasMore: start > 0 };
}

async function getMessage(code, id) {
    const raw = typeof id === 'string' && id.length < 40 ? await redis.hget(keys.chatMsgs(code), id) : null;
    const message = raw && parse(raw);
    if (!message) throw new HttpError(404, 'Message not found.');
    return message;
}

export async function send(code, author, { text, replyToId }) {
    const body = cleanText(text);
    let replyTo = null;
    if (replyToId) {
        const original = await getMessage(code, replyToId);
        replyTo = {
            id: original.id,
            authorId: original.authorId,
            authorName: (await redis.hget(keys.people(code), original.authorId)) || original.authorName,
            text: original.deleted ? '' : original.text.slice(0, 160),
            deleted: !!original.deleted
        };
    }
    const message = {
        id: newId(),
        authorId: author.publicId,
        authorName: author.name,
        text: body,
        replyTo,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false
    };
    const [, [, length]] = await redis.multi()
        .hset(keys.chatMsgs(code), message.id, JSON.stringify(message))
        .rpush(keys.chatIds(code), message.id)
        .exec();
    if (length > MAX_HISTORY) {
        const dropped = await redis.lrange(keys.chatIds(code), 0, length - MAX_HISTORY - 1);
        await redis.multi().ltrim(keys.chatIds(code), length - MAX_HISTORY, -1).hdel(keys.chatMsgs(code), ...dropped).exec();
    }
    return { ...message, reactions: {} };
}

export async function edit(code, author, { id, text }) {
    const message = await getMessage(code, id);
    if (message.authorId !== author.publicId) throw new HttpError(403, 'You can only edit your own messages.');
    if (message.deleted) throw new HttpError(400, 'This message was deleted.');
    if (Date.now() - Date.parse(message.createdAt) > EDIT_WINDOW_MS) throw new HttpError(400, 'Messages can be edited for 24 hours.');
    const updated = { ...message, text: cleanText(text), editedAt: new Date().toISOString() };
    await redis.hset(keys.chatMsgs(code), id, JSON.stringify(updated));
    return (await withReactions(code, [updated]))[0];
}

export async function remove(code, author, { id }, { isOwner = false } = {}) {
    const message = await getMessage(code, id);
    if (message.authorId !== author.publicId && !isOwner) throw new HttpError(403, 'You can only delete your own messages.');
    const updated = { ...message, text: '', deleted: true, editedAt: null };
    const fields = Object.keys(await redis.hgetall(keys.chatReactions(code))).filter((f) => f.startsWith(`${id}|`));
    const tx = redis.multi().hset(keys.chatMsgs(code), id, JSON.stringify(updated));
    if (fields.length) tx.hdel(keys.chatReactions(code), ...fields);
    await tx.exec();
    return { ...updated, reactions: {} };
}

export async function react(code, author, { id, emoji }) {
    await getMessage(code, id);
    const field = `${id}|${author.publicId}`;
    if (emoji === null || emoji === undefined || emoji === '') {
        await redis.hdel(keys.chatReactions(code), field);
    } else {
        if (!isEmoji(emoji)) throw new HttpError(400, 'Unsupported reaction.');
        await redis.hset(keys.chatReactions(code), field, emoji);
    }
    return (await reactionsFor(code, [id]))[id] || {};
}
