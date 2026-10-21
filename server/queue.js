import { Queue } from 'bullmq';
import { createQueueConnection } from './redis.js';

export const QUEUE_NAME = 'xylosync-jobs';

export const JOBS = {
    sendMail: 'send-mail',
    purgeRoom: 'purge-room'
};

export const jobs = new Queue(QUEUE_NAME, {
    connection: createQueueConnection(),
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 500
    }
});
