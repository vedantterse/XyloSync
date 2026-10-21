const env = process.env;

const bool = (value, fallback = false) =>
    value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

export const config = {
    appName: 'XyloSync',
    port: Number(env.PORT || 3000),
    secret: env.APP_SECRET || 'xylosync-dev-secret-change-me',
    cookieSecure: bool(env.COOKIE_SECURE, false),
    maxRoomsPerUser: Number(env.MAX_ROOMS_PER_USER || 3),
    // Rooms delete themselves (files, chat, members) this long after creation. 0 keeps them forever.
    roomTtlHours: Number(env.ROOM_TTL_HOURS ?? 8),

    redisUrl: env.REDIS_URL || 'redis://localhost:6379',

    minio: {
        endPoint: env.MINIO_ENDPOINT || 'localhost',
        port: Number(env.MINIO_PORT || 9000),
        useSSL: bool(env.MINIO_USE_SSL, false),
        accessKey: env.MINIO_ACCESS_KEY || 'xylosync',
        secretKey: env.MINIO_SECRET_KEY || 'xylosync-secret',
        bucket: env.MINIO_BUCKET || 'xylosync',
        region: env.MINIO_REGION || 'us-east-1'
    },

    // MinIO calls POST /webhooks/storage for every object created/removed in a room.
    webhook: {
        secret: env.WEBHOOK_SECRET || 'xylosync-webhook-secret',
        targetId: env.MINIO_WEBHOOK_TARGET || 'XYLOSYNC',
        log: bool(env.LOG_WEBHOOKS, false)
    },

    mail: {
        host: env.SMTP_HOST || 'localhost',
        port: Number(env.SMTP_PORT || 1025),
        secure: bool(env.SMTP_SECURE, false),
        user: env.SMTP_USER || '',
        pass: env.SMTP_PASS || '',
        from: env.MAIL_FROM || 'XyloSync <no-reply@xylosync.local>',
        // Shown in the UI so people can open the local Mailpit inbox.
        inboxUrl: env.MAIL_INBOX_URL || ''
    }
};

if (config.secret === 'xylosync-dev-secret-change-me') {
    console.warn('[config] APP_SECRET is not set; using an insecure development secret.');
}
