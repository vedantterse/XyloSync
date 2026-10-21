import { createHmac, randomInt, randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import { config } from './config.js';

// Visitors get an anonymous identity stored in a signed, httpOnly cookie.
// The signature means nobody can impersonate another user by editing it.
const COOKIE = 'fs_id';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ADJECTIVES = [
    'Cosmic', 'Stellar', 'Quantum', 'Astro', 'Nova', 'Cyber', 'Lunar', 'Solar', 'Nebula', 'Eclipse',
    'Galactic', 'Hyper', 'Neon', 'Retro', 'Pixel', 'Shadow', 'Alpha', 'Omega', 'Binary', 'Velvet',
    'Turbo', 'Nano', 'Vortex', 'Orbit', 'Zenith', 'Pulse', 'Prism', 'Flux', 'Drift', 'Amber'
];
const NOUNS = [
    'Rider', 'Hunter', 'Walker', 'Runner', 'Pilot', 'Agent', 'Guardian', 'Seeker', 'Forge', 'Storm',
    'Blaze', 'Cipher', 'Drone', 'Sentinel', 'Star', 'Phantom', 'Wave', 'Comet', 'Rocket', 'Phoenix',
    'Galaxy', 'Specter', 'Rogue', 'Titan', 'Falcon', 'Otter', 'Lynx', 'Raven', 'Fox', 'Harbor'
];

const pick = (list) => list[randomInt(list.length)];
export const generateName = () => `${pick(ADJECTIVES)}${pick(NOUNS)}${randomInt(1000, 10000)}`;

export function cleanDisplayName(raw) {
    const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
    return name.length >= 2 && name.length <= 32 ? name : null;
}

// A stable id that is safe to show to other people: it identifies authors in chat and
// requests in the waiting room without revealing the cookie's user id.
export const publicId = (userId) =>
    createHmac('sha256', config.secret).update(`public:${userId}`).digest('base64url').slice(0, 16);

const isValidUser = (user) =>
    user && typeof user === 'object' && UUID_RE.test(user.id || '') && typeof user.name === 'string';

export function setIdentity(res, user) {
    res.cookie(COOKIE, { id: user.id, name: user.name, custom: !!user.custom }, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        maxAge: ONE_YEAR_MS,
        path: '/'
    });
}

export const parseCookies = cookieParser(config.secret);

const toUser = (raw) => ({ id: raw.id, name: raw.name, custom: !!raw.custom, publicId: publicId(raw.id) });

export function identity(req, res, next) {
    let user = req.signedCookies?.[COOKIE];
    if (!isValidUser(user)) {
        user = { id: randomUUID(), name: generateName(), custom: false };
        setIdentity(res, user);
    }
    req.user = toUser(user);
    next();
}

// Socket.IO handshake: reuse the same signed cookie.
export function socketIdentity(socket, next) {
    const req = socket.request;
    parseCookies(req, {}, () => {
        const user = req.signedCookies?.[COOKIE];
        if (!isValidUser(user)) return next(new Error('unauthorized'));
        socket.data.user = toUser(user);
        next();
    });
}
