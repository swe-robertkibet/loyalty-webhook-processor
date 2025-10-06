import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { verifyWebhookSignature } from '../utils/verifySignature';
import { logger } from '../utils/logger';
import { paymentQueue } from '../queue';
import type { WebhookPayload, WebhookResponse, WebhookErrorResponse } from '../types/webhook.types';

const router = Router();

const webhookPayloadSchema = z.object({
  eventId: z.string().min(1),
  type: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
  timestamp: z.string().datetime(),
});

router.post('/payment', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-webhook-signature'] as string;

    if (!signature) {
      const errorResponse: WebhookErrorResponse = {
        success: false,
        error: 'MISSING_SIGNATURE',
        message: 'Webhook signature is required',
      };
      logger.warn('WEBHOOK REQUEST WITHOUT SIGNATURE');
      return res.status(401).json(errorResponse);
    }

    const rawBody = JSON.stringify(req.body);

    if (!verifyWebhookSignature(rawBody, signature)) {
      const errorResponse: WebhookErrorResponse = {
        success: false,
        error: 'INVALID_SIGNATURE',
        message: 'Webhook signature verification failed',
      };
      logger.warn({ signature }, 'INVALID WEBHOOK SIGNATURE');
      return res.status(401).json(errorResponse);
    }

    const validationResult = webhookPayloadSchema.safeParse(req.body);

    if (!validationResult.success) {
      const errorResponse: WebhookErrorResponse = {
        success: false,
        error: 'INVALID_PAYLOAD',
        message: 'Invalid webhook payload format',
      };
      logger.warn({ errors: validationResult.error.format() }, 'INVALID WEBHOOK PAYLOAD');
      return res.status(400).json(errorResponse);
    }

    const payload: WebhookPayload = validationResult.data;

    // STORE EVENT IN DATABASE WITH UNIQUE CONSTRAINT ON eventId
    try {
      await prisma.event.create({
        data: {
          eventId: payload.eventId,
          type: payload.type,
          payload: payload as unknown as Prisma.JsonObject,
          status: 'pending',
        },
      });

      logger.info({ eventId: payload.eventId }, 'EVENT STORED IN DATABASE');
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        logger.warn({ eventId: payload.eventId }, 'DUPLICATE EVENT RECEIVED');

        const successResponse: WebhookResponse = {
          success: true,
          message: 'Event already received and processed',
          eventId: payload.eventId,
        };
        return res.status(200).json(successResponse);
      }
      throw error;
    }

    // ENQUEUE JOB FOR PROCESSING
    const job = await paymentQueue.add('process-payment', {
      eventId: payload.eventId,
      type: payload.type,
      payload: {
        userId: payload.userId,
        amount: payload.amount,
        currency: payload.currency,
        timestamp: payload.timestamp,
      },
    });

    logger.info({ eventId: payload.eventId, jobId: job.id }, 'JOB ENQUEUED FOR PROCESSING');

    const successResponse: WebhookResponse = {
      success: true,
      message: 'Event received and queued for processing',
      eventId: payload.eventId,
      jobId: job.id,
    };

    return res.status(202).json(successResponse);
  } catch (error) {
    logger.error({ error }, 'WEBHOOK PROCESSING ERROR');

    const errorResponse: WebhookErrorResponse = {
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to process webhook',
    };
    return res.status(500).json(errorResponse);
  }
});

export default router;
