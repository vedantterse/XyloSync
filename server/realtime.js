import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createRedis } from './redis.js';
import { socketIdentity } from './identity.js';
import { getRoom, getAccess, canEnter, isRoomCode, rememberPerson, peopleNames } from './rooms.js';
import * as chat from './chat.js';

export const channel = {
    room: (code) => `room:${code}`,
    user: (userId) => `user:${userId}`
};

export function createRealtime(httpServer) {
    const io = new Server(httpServer, {
        serveClient: true,
        maxHttpBufferSize: 64 * 1024
    });

    // The Redis adapter lets every app instance (and the worker, via the emitter)
    // broadcast to sockets connected to any other instance.
    const pub = createRedis();
    io.adapter(createAdapter(pub, pub.duplicate()));

    io.use(socketIdentity);

    const broadcastPresence = async (code) => {
        const [sockets, names] = await Promise.all([io.in(channel.room(code)).fetchSockets(), peopleNames(code)]);
        const people = new Map();
        for (const s of sockets) {
            if (s.data.user && s.data.room === code) {
                const id = s.data.user.publicId;
                people.set(id, { id, name: names[id] || s.data.roomName || s.data.user.name });
            }
        }
        io.to(channel.room(code)).emit('room:presence', { count: people.size, people: [...people.values()].slice(0, 24) });
    };

    // Every chat action re-checks access, so someone removed from a private room is cut off at once.
    const inRoom = async (socket) => {
        const code = socket.data.room;
        const room = code && await getRoom(code);
        if (!room) throw Object.assign(new Error('Room not found.'), { status: 404 });
        const { access, name } = await getAccess(room, socket.data.user);
        if (!canEnter(access)) throw Object.assign(new Error('You are not in this room.'), { status: 403 });
        return { room, author: { ...socket.data.user, name }, isOwner: access === 'owner' };
    };

    const handler = (socket, fn) => async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
            reply({ ok: true, ...(await fn(payload || {})) });
        } catch (err) {
            if (!err.status) console.error('[realtime]', err);
            reply({ ok: false, error: err.status ? err.message : 'Something went wrong.' });
        }
    };

    io.on('connection', (socket) => {
        socket.join(channel.user(socket.data.user.id));
        let sent = [];

        socket.on('room:watch', handler(socket, async (code) => {
            if (!isRoomCode(code)) throw Object.assign(new Error('Room not found.'), { status: 404 });
            const room = await getRoom(code);
            if (!room) throw Object.assign(new Error('Room not found.'), { status: 404 });
            const { access, name } = await getAccess(room, socket.data.user);
            if (!canEnter(access)) throw Object.assign(new Error('Waiting for approval.'), { status: 403 });

            const previous = socket.data.room;
            if (previous && previous !== code) {
                socket.leave(channel.room(previous));
                broadcastPresence(previous).catch(() => {});
            }
            socket.data.room = code;
            socket.data.roomName = name;
            await rememberPerson(code, socket.data.user, name);
            socket.join(channel.room(code));
            broadcastPresence(code).catch(() => {});
            return {};
        }));

        socket.on('chat:send', handler(socket, async ({ text, replyToId }) => {
            const now = Date.now();
            sent = sent.filter((t) => now - t < 5000);
            if (sent.length >= 10) throw Object.assign(new Error('Slow down a little.'), { status: 429 });
            sent.push(now);
            const { room, author } = await inRoom(socket);
            const message = await chat.send(room.code, author, { text, replyToId });
            socket.to(channel.room(room.code)).emit('chat:message', message);
            return { message };
        }));

        socket.on('chat:edit', handler(socket, async ({ id, text }) => {
            const { room, author } = await inRoom(socket);
            const message = await chat.edit(room.code, author, { id, text });
            io.to(channel.room(room.code)).emit('chat:updated', message);
            return { message };
        }));

        socket.on('chat:delete', handler(socket, async ({ id }) => {
            const { room, author, isOwner } = await inRoom(socket);
            const message = await chat.remove(room.code, author, { id }, { isOwner });
            io.to(channel.room(room.code)).emit('chat:updated', message);
            return { message };
        }));

        socket.on('chat:react', handler(socket, async ({ id, emoji }) => {
            const { room, author } = await inRoom(socket);
            const reactions = await chat.react(room.code, author, { id, emoji });
            io.to(channel.room(room.code)).emit('chat:reactions', { id, reactions });
            return { reactions };
        }));

        socket.on('chat:typing', (typing) => {
            const code = socket.data.room;
            // Someone removed from a private room has left the channel; they can't signal typing.
            if (!code || !socket.rooms.has(channel.room(code))) return;
            socket.volatile.to(channel.room(code)).emit('chat:typing', {
                id: socket.data.user.publicId,
                name: socket.data.roomName || socket.data.user.name,
                typing: !!typing
            });
        });

        socket.on('disconnect', () => {
            if (socket.data.room) broadcastPresence(socket.data.room).catch(() => {});
        });
    });

    io.broadcastPresence = broadcastPresence;
    return io;
}
