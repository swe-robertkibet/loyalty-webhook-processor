import { Worker, Job } from 'bullmq';
import { config } from './utils/config';
import { logger } from './utils/logger';
import { prisma } from './db';
import { loyaltyService } from './services/loyalty';
import type { PaymentEventJob } from './types/queue.types';

const redisConnection = {
  url: config.redis.url,
  maxRetriesPerRequest: null,
};

async function processPaymentJob(job: Job<PaymentEventJob>): Promise<void> {
  const { eventId, type, payload } = job.data;
  const { userId, amount } = payload;

  logger.info(
    { eventId, jobId: job.id, attempt: job.attemptsMade + 1 },
    'STARTING JOB PROCESSING'
  );

  try {
    await prisma.event.update({
      where: { eventId },
      data: {
        attempts: job.attemptsMade + 1,
      },
    });

    const result = await loyaltyService.processPaymentEvent({
      eventId,
      userId,
      amount,
      type,
    });

    await prisma.event.update({
      where: { eventId },
      data: {
        status: 'processed',
        processedAt: new Date(),
      },
    });

    logger.info(
      {
        eventId,
        jobId: job.id,
        userId: result.userId,
        pointsAwarded: result.pointsAwarded,
        totalPoints: result.totalPoints,
      },
      'JOB COMPLETED SUCCESSFULLY'
    );
  } catch (error) {
    await prisma.event.update({
      where: { eventId },
      data: {
        attempts: job.attemptsMade + 1,
        status: job.attemptsMade + 1 >= config.queue.maxRetries ? 'failed' : 'pending',
      },
    });

    logger.error(
      {
        eventId,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        maxRetries: config.queue.maxRetries,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'JOB PROCESSING FAILED'
    );

    throw error;
  }
}

const worker = new Worker<PaymentEventJob>(config.queue.name, processPaymentJob, {
  connection: redisConnection,
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000,
  },
});

worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'WORKER: JOB COMPLETED');
});

worker.on('failed', (job, error) => {
  logger.error(
    {
      jobId: job?.id,
      error: error.message,
      attemptsMade: job?.attemptsMade,
    },
    'WORKER: JOB FAILED'
  );
});

worker.on('error', (error) => {
  logger.error({ error: error.message }, 'WORKER ERROR');
});

const gracefulShutdown = async () => {
  logger.info('SHUTTING DOWN WORKER');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

logger.info(
  {
    queueName: config.queue.name,
    concurrency: 5,
    maxRetries: config.queue.maxRetries,
  },
  'WORKER STARTED'
);
