import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { paymentQueue } from '../queue';
import { logger } from '../utils/logger';
import type { HealthResponse } from '../types/api.types';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const healthResponse: HealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: {
        status: 'down',
      },
      redis: {
        status: 'down',
      },
    },
  };

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatency = Date.now() - dbStart;

    healthResponse.services.database = {
      status: 'up',
      latency: dbLatency,
    };
  } catch (error) {
    logger.error({ error }, 'DATABASE HEALTH CHECK FAILED');
    healthResponse.status = 'unhealthy';
  }

  try {
    const redisStart = Date.now();
    const client = await paymentQueue.client;
    await client.ping();
    const redisLatency = Date.now() - redisStart;

    healthResponse.services.redis = {
      status: 'up',
      latency: redisLatency,
    };
  } catch (error) {
    logger.error({ error }, 'REDIS HEALTH CHECK FAILED');
    healthResponse.status = 'unhealthy';
  }

  const statusCode = healthResponse.status === 'healthy' ? 200 : 503;
  return res.status(statusCode).json(healthResponse);
});

export default router;
