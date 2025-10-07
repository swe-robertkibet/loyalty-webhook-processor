import { Router, Request, Response } from 'express';
import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';

const router = Router();

const register = new Registry();

collectDefaultMetrics({ register });

export const webhookCounter = new Counter({
  name: 'webhook_requests_total',
  help: 'Total number of webhook requests',
  labelNames: ['status'],
  registers: [register],
});

export const jobProcessingDuration = new Histogram({
  name: 'job_processing_duration_seconds',
  help: 'Duration of job processing in seconds',
  labelNames: ['status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const queueSize = new Gauge({
  name: 'queue_size',
  help: 'Current size of the job queue',
  registers: [register],
});

export const pointsAwarded = new Counter({
  name: 'loyalty_points_awarded_total',
  help: 'Total loyalty points awarded',
  registers: [register],
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    return res.status(200).send(metrics);
  } catch (error) {
    return res.status(500).send('Error generating metrics');
  }
});

export default router;
