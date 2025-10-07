import 'dotenv/config';
import { z } from 'zod';
import type { Config } from '../types/config.types';

const configSchema = z.object({
  database: z.object({
    url: z.string().url(),
  }),
  redis: z.object({
    url: z.string().url(),
  }),
  server: z.object({
    port: z.coerce.number().int().positive().default(3000),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  }),
  webhook: z.object({
    secret: z.string().min(16),
  }),
  loyalty: z.object({
    pointsPer100Currency: z.coerce.number().int().positive().default(1),
  }),
  queue: z.object({
    name: z.string().default('payment-events'),
    maxRetries: z.coerce.number().int().positive().default(5),
  }),
  logging: z.object({
    level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }),
});

function loadConfig(): Config {
  const rawConfig = {
    database: {
      url: process.env.DATABASE_URL,
    },
    redis: {
      url: process.env.REDIS_URL,
    },
    server: {
      port: process.env.PORT,
      nodeEnv: process.env.NODE_ENV,
    },
    webhook: {
      secret: process.env.WEBHOOK_SECRET,
    },
    loyalty: {
      pointsPer100Currency: process.env.POINTS_PER_100_CURRENCY,
    },
    queue: {
      name: process.env.QUEUE_NAME,
      maxRetries: process.env.MAX_RETRIES,
    },
    logging: {
      level: process.env.LOG_LEVEL,
    },
  };

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('CONFIGURATION VALIDATION FAILED:', result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
