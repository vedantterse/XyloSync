import Redis from 'ioredis';
import { config } from './config.js';

export function createRedis(options = {}) {
    const client = new Redis(config.redisUrl, options);
    client.on('error', (err) => console.error('[redis]', err.message));
    return client;
}

// General-purpose client for request handlers (fails fast when Redis is down).
export const redis = createRedis();

// BullMQ requires maxRetriesPerRequest: null on its connections.
export const createQueueConnection = () => createRedis({ maxRetriesPerRequest: null });
