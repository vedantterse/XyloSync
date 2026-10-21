import { randomInt } from 'crypto';
import { redis } from './redis.js';
import { config } from './config.js';
import { HttpError } from './http.js';
import { cleanDisplayName } from './identity.js';

// Room metadata lives in Redis; the files themselves live in MinIO under rooms/<code>/.
export const keys = {
    room: (code) => `room:${code}`,
    members: (code) => `room:${code}:members`,     // userId -> {name, publicId, joinedAt}
    requests: (code) => `room:${code}:requests`,   // userId -> {name, publicId, at}
    names: (code) => `room:${code}:names`,         // lower-cased names in use (approval rooms)
    chatIds: (code) => `room:${code}:chat:ids`,
    chatMsgs: (code) => `room:${code}:chat:msgs`,
    chatReactions: (code) => `room:${code}:chat:reactions`,
    people: (code) => `room:${code}:people`,       // publicId -> current name, for everyone who has been inside
    userRooms: (userId) => `user:${userId}:rooms`,
    visited: (userId) => `user:${userId}:visited`, // rooms someone has been inside, so a rename can reach them
    expiry: 'rooms:expiry'                          // sorted set: code scored by expiresAt
};

const roomDataKeys = (code) => [
    keys.room(code), keys.members(code), keys.requests(code), keys.names(code),
    keys.chatIds(code), keys.chatMsgs(code), keys.chatReactions(code), keys.people(code)
];

export const isRoomCode = (code) => /^\d{5}$/.test(String(code));
const nameKey = (name) => name.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const parse = (json) => { try { return JSON.parse(json); } catch { return null; } };

export async function getRoom(code) {
    if (!isRoomCode(code)) return null;
    const room = await redis.hgetall(keys.room(code));
    if (!room?.ownerId) return null;
    return {
        code: room.code || String(code),
        ownerId: room.ownerId,
        ownerName: room.ownerName,
        createdAt: Number(room.createdAt) || Date.now(),
        expiresAt: Number(room.expiresAt) || null,
        requiresApproval: room.approval === '1'
    };
}

// What this user may do in the room, and the name they go by there.
export async function getAccess(room, user) {
    if (room.ownerId === user.id) return { access: 'owner', name: room.ownerName };
    if (!room.requiresApproval) return { access: 'member', name: user.name };
    const [member, request] = await redis.multi()
        .hget(keys.members(room.code), user.id)
        .hget(keys.requests(room.code), user.id)
        .exec();
    const m = member[1] && parse(member[1]);
    if (m) return { access: 'member', name: m.name };
    const r = request[1] && parse(request[1]);
    if (r) return { access: 'pending', name: r.name };
    return { access: 'none', name: null };
}

export const canEnter = (access) => access === 'owner' || access === 'member';

export function toRoomDto(room, user, access) {
    return {
        code: room.code,
        ownerName: room.ownerName,
        isOwner: room.ownerId === user.id,
        requiresApproval: room.requiresApproval,
        createdAt: new Date(room.createdAt).toISOString(),
        expiresAt: room.expiresAt ? new Date(room.expiresAt).toISOString() : null,
        ...(access ? { access: access.access, displayName: access.name } : {})
    };
}

export async function listUserRooms(userId) {
    const codes = await redis.smembers(keys.userRooms(userId));
    const rooms = await Promise.all(codes.map(getRoom));
    const stale = codes.filter((_, i) => !rooms[i] || rooms[i].ownerId !== userId);
    if (stale.length) await redis.srem(keys.userRooms(userId), ...stale);
    return rooms
        .filter((room) => room && room.ownerId === userId)
        .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createRoom(user, { requiresApproval = false } = {}) {
    const owned = await redis.scard(keys.userRooms(user.id));
    if (owned >= config.maxRoomsPerUser) {
        throw new HttpError(409, `You can own up to ${config.maxRoomsPerUser} rooms. Delete one to create another.`);
    }
    for (let attempt = 0; attempt < 50; attempt++) {
        const code = String(randomInt(10000, 100000));
        // HSETNX makes code allocation atomic, so two rooms can never share a code.
        if (await redis.hsetnx(keys.room(code), 'ownerId', user.id)) {
            const createdAt = Date.now();
            const ttlMs = config.roomTtlHours > 0 ? config.roomTtlHours * 3600 * 1000 : 0;
            const tx = redis.multi()
                .hset(keys.people(code), user.publicId, user.name)
                .hset(keys.room(code), {
                    code, ownerName: user.name, createdAt, approval: requiresApproval ? '1' : '0',
                    ...(ttlMs ? { expiresAt: createdAt + ttlMs } : {})
                })
                .sadd(keys.userRooms(user.id), code);
            if (ttlMs) tx.zadd(keys.expiry, createdAt + ttlMs, code);
            if (requiresApproval) tx.sadd(keys.names(code), nameKey(user.name));
            await tx.exec();
            return getRoom(code);
        }
    }
    throw new HttpError(503, 'Could not allocate a room code, please try again.');
}

// Removes everything about a room from Redis: metadata, chat, reactions, members and the
// waiting list. Returns who was waiting so they can be told. Files are purged by the worker.
export async function destroyRoom(code) {
    const room = await getRoom(code);
    if (!room) return null;
    const waiting = await listRequests(code);
    await redis.multi()
        .del(...roomDataKeys(code))
        .srem(keys.userRooms(room.ownerId), code)
        .zrem(keys.expiry, code)
        .exec();
    return { room, waitingUserIds: waiting.map((w) => w.userId) };
}

export async function deleteRoom(code, userId) {
    const room = await getRoom(code);
    if (!room) throw new HttpError(404, 'Room not found.');
    if (room.ownerId !== userId) throw new HttpError(403, 'Only the room owner can delete this room.');
    return destroyRoom(code);
}

export const dueRooms = (now = Date.now()) => redis.zrangebyscore(keys.expiry, 0, now);

// Rooms made before expiry existed get the default lifetime counted from their creation.
export async function backfillExpiry() {
    if (config.roomTtlHours <= 0) return 0;
    let cursor = '0';
    let count = 0;
    do {
        const [next, found] = await redis.scan(cursor, 'MATCH', 'room:?????', 'COUNT', 500);
        cursor = next;
        for (const key of found) {
            const room = await getRoom(key.slice(5));
            if (!room || room.expiresAt) continue;
            const expiresAt = room.createdAt + config.roomTtlHours * 3600 * 1000;
            await redis.multi().hset(key, 'expiresAt', expiresAt).zadd(keys.expiry, expiresAt, room.code).exec();
            count++;
        }
    } while (cursor !== '0');
    return count;
}

/* ---------- names ---------- */

// Names are looked up when they are shown, from one directory per room, so a rename reaches
// old chat messages, files, the room header and the people list alike.
export async function rememberPerson(code, user, name) {
    await redis.multi()
        .hset(keys.people(code), user.publicId, name)
        .sadd(keys.visited(user.id), code)
        .exec();
}

export const peopleNames = (code) => redis.hgetall(keys.people(code));

// A new global name: used as the owner's name in every room they own, and as their name in
// every open room they have been in. In private rooms they joined, they keep the room name
// they chose there (they change that one from inside the room).
export async function renameEverywhere(user, name) {
    const owned = (await Promise.all((await redis.smembers(keys.userRooms(user.id))).map(getRoom)))
        .filter((room) => room && room.ownerId === user.id);

    for (const room of owned) {
        if (!room.requiresApproval || nameKey(room.ownerName) === nameKey(name)) continue;
        if (await redis.sismember(keys.names(room.code), nameKey(name))) {
            throw new HttpError(409, `Someone in your private room ${room.code} is already called “${name}”.`);
        }
    }

    const affected = [];
    for (const room of owned) {
        const tx = redis.multi()
            .hset(keys.room(room.code), 'ownerName', name)
            .hset(keys.people(room.code), user.publicId, name);
        if (room.requiresApproval) tx.srem(keys.names(room.code), nameKey(room.ownerName)).sadd(keys.names(room.code), nameKey(name));
        await tx.exec();
        affected.push({ code: room.code, isOwner: true });
    }

    for (const code of await redis.smembers(keys.visited(user.id))) {
        if (affected.some((a) => a.code === code)) continue;
        const room = await getRoom(code);
        if (!room) { await redis.srem(keys.visited(user.id), code); continue; }
        if (room.requiresApproval) continue;
        await redis.hset(keys.people(code), user.publicId, name);
        affected.push({ code, isOwner: false });
    }
    return affected;
}

// A member of a private room changes the name they go by in that room.
export async function renameMember(room, user, rawName) {
    const name = cleanDisplayName(rawName);
    if (!name) throw new HttpError(400, 'Your name must be 2 to 32 characters.');
    const raw = await redis.hget(keys.members(room.code), user.id);
    const member = raw && parse(raw);
    if (!member) throw new HttpError(403, 'You are not in this room.');
    if (nameKey(name) !== nameKey(member.name)) {
        if (!user.custom && nameKey(name) === nameKey(user.name)) {
            throw new HttpError(400, 'Choose your own name — generated names are not allowed in private rooms.');
        }
        if (!(await redis.sadd(keys.names(room.code), nameKey(name)))) {
            throw new HttpError(409, `“${name}” is already taken in this room. Try another name.`);
        }
        await redis.srem(keys.names(room.code), nameKey(member.name));
    }
    await redis.multi()
        .hset(keys.members(room.code), user.id, JSON.stringify({ ...member, name }))
        .hset(keys.people(room.code), user.publicId, name)
        .exec();
    return name;
}

/* ---------- waiting room (approval rooms) ---------- */

export async function requestAdmission(room, user, rawName) {
    if (!room.requiresApproval) throw new HttpError(400, 'This room does not need approval.');
    const current = await getAccess(room, user);
    if (canEnter(current.access)) throw new HttpError(409, 'You are already in this room.');

    // Asking again and again (for example after being removed) is throttled.
    const rate = `ratelimit:join-request:${room.code}:${user.id}`;
    const [[, attempts]] = await redis.multi().incr(rate).expire(rate, 600, 'NX').exec();
    if (attempts > 8) throw new HttpError(429, 'Too many requests to join. Wait a few minutes and try again.');

    const name = cleanDisplayName(rawName);
    if (!name) throw new HttpError(400, 'Your name must be 2 to 32 characters.');
    if (!user.custom && nameKey(name) === nameKey(user.name)) {
        throw new HttpError(400, 'Choose your own name — generated names are not allowed in private rooms.');
    }

    // Re-asking with a new name frees the old one first.
    if (current.access === 'pending') await redis.srem(keys.names(room.code), nameKey(current.name));
    // SADD is atomic, so two people can never claim the same name at the same moment.
    if (!(await redis.sadd(keys.names(room.code), nameKey(name)))) {
        if (current.access === 'pending') await redis.sadd(keys.names(room.code), nameKey(current.name));
        throw new HttpError(409, `“${name}” is already taken in this room. Try another name.`);
    }
    const entry = { name, publicId: user.publicId, at: Date.now() };
    await redis.hset(keys.requests(room.code), user.id, JSON.stringify(entry));
    return entry;
}

export async function cancelRequest(code, user) {
    const raw = await redis.hget(keys.requests(code), user.id);
    const entry = raw && parse(raw);
    if (!entry) return null;
    await redis.multi().hdel(keys.requests(code), user.id).srem(keys.names(code), nameKey(entry.name)).exec();
    return entry;
}

async function entries(key) {
    const all = await redis.hgetall(key);
    return Object.entries(all).map(([userId, json]) => ({ userId, ...parse(json) })).filter((e) => e.name);
}

export const listRequests = async (code) => (await entries(keys.requests(code))).sort((a, b) => a.at - b.at);
export const listMembers = async (code) => (await entries(keys.members(code))).sort((a, b) => a.joinedAt - b.joinedAt);

async function findByPublicId(key, pid) {
    return (await entries(key)).find((e) => e.publicId === pid) || null;
}

export async function admit(code, pid) {
    const request = await findByPublicId(keys.requests(code), pid);
    if (!request) throw new HttpError(404, 'That request is no longer waiting.');
    const member = { name: request.name, publicId: request.publicId, joinedAt: Date.now() };
    await redis.multi()
        .hdel(keys.requests(code), request.userId)
        .hset(keys.members(code), request.userId, JSON.stringify(member))
        .exec();
    return { userId: request.userId, ...member };
}

export async function deny(code, pid) {
    const request = await findByPublicId(keys.requests(code), pid);
    if (!request) throw new HttpError(404, 'That request is no longer waiting.');
    await redis.multi().hdel(keys.requests(code), request.userId).srem(keys.names(code), nameKey(request.name)).exec();
    return request;
}

export async function removeMember(code, pid) {
    const member = await findByPublicId(keys.members(code), pid);
    if (!member) throw new HttpError(404, 'That person is not in this room.');
    await redis.multi().hdel(keys.members(code), member.userId).srem(keys.names(code), nameKey(member.name)).exec();
    return member;
}

/* ---------- brute-force protection ---------- */

// Throttle failed room lookups per IP so 5-digit codes can't be brute-forced.
const MISS_LIMIT = 40;
const MISS_WINDOW_S = 600;

export async function isLookupBlocked(ip) {
    return Number(await redis.get(`ratelimit:room-miss:${ip}`)) >= MISS_LIMIT;
}

export async function recordLookupMiss(ip) {
    const key = `ratelimit:room-miss:${ip}`;
    const [[, count]] = await redis.multi().incr(key).expire(key, MISS_WINDOW_S, 'NX').exec();
    return count;
}
