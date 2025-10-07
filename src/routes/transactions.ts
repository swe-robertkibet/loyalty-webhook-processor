import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { logger } from '../utils/logger';
import type { TransactionResponse, ErrorResponse } from '../types/api.types';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId, limit = '100', offset = '0' } = req.query;

    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    if (isNaN(limitNum) || isNaN(offsetNum) || limitNum < 1 || offsetNum < 0) {
      const errorResponse: ErrorResponse = {
        error: 'INVALID_PARAMS',
        message: 'Invalid limit or offset parameters',
      };
      return res.status(400).json(errorResponse);
    }

    const where = userId ? { userId: userId as string } : {};

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limitNum, 1000),
      skip: offsetNum,
    });

    const transactionResponses: TransactionResponse[] = transactions.map((tx) => ({
      id: tx.id,
      eventId: tx.eventId,
      userId: tx.userId,
      amount: tx.amount,
      points: tx.points,
      createdAt: tx.createdAt,
    }));

    return res.status(200).json({
      transactions: transactionResponses,
      count: transactionResponses.length,
      limit: limitNum,
      offset: offsetNum,
    });
  } catch (error) {
    logger.error({ error }, 'ERROR FETCHING TRANSACTIONS');

    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch transactions',
    };
    return res.status(500).json(errorResponse);
  }
});

export default router;
