import { Queue, QueueEvents } from 'bullmq';
import { config } from './utils/config';
import { logger } from './utils/logger';
import type { PaymentEventJob } from './types/queue.types';

const redisConnection = {
  url: config.redis.url,
  maxRetriesPerRequest: null,
};

export const paymentQueue = new Queue<PaymentEventJob>(config.queue.name, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: config.queue.maxRetries,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: {
      count: 100,
      age: 3600,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});

// QUEUE EVENTS FOR MONITORING
const queueEvents = new QueueEvents(config.queue.name, {
  connection: redisConnection,
});

queueEvents.on('completed', ({ jobId }) => {
  logger.info({ jobId }, 'JOB COMPLETED');
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error({ jobId, failedReason }, 'JOB FAILED');
});

queueEvents.on('stalled', ({ jobId }) => {
  logger.warn({ jobId }, 'JOB STALLED');
});

// GRACEFUL SHUTDOWN
const gracefulShutdown = async () => {
  logger.info('SHUTTING DOWN QUEUE CONNECTION');
  await paymentQueue.close();
  await queueEvents.close();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export { queueEvents };
