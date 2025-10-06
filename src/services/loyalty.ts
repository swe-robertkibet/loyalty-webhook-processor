import { prisma } from '../db';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type {
  ProcessPaymentEventParams,
  ProcessPaymentEventResult,
  LoyaltyCalculation,
} from '../types/loyalty.types';

export class LoyaltyService {
  calculatePoints(amount: number): LoyaltyCalculation {
    const pointsEarned = Math.floor(amount / 100) * config.loyalty.pointsPer100Currency;

    return {
      amount,
      pointsEarned,
    };
  }

  async processPaymentEvent(
    params: ProcessPaymentEventParams
  ): Promise<ProcessPaymentEventResult> {
    const { eventId, userId, amount, type } = params;

    logger.info({ eventId, userId, amount, type }, 'PROCESSING PAYMENT EVENT');

    // CHECK IF TRANSACTION ALREADY EXISTS FOR THIS EVENT
    const existingTransaction = await prisma.transaction.findFirst({
      where: { eventId },
    });

    if (existingTransaction) {
      logger.warn({ eventId, transactionId: existingTransaction.id }, 'DUPLICATE EVENT DETECTED');

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      return {
        userId,
        pointsAwarded: existingTransaction.points,
        totalPoints: user?.points || 0,
        transactionId: existingTransaction.id,
      };
    }

    const { pointsEarned } = this.calculatePoints(amount);

    // ATOMIC TRANSACTION: FETCH/CREATE USER + ADD POINTS + RECORD TRANSACTION
    const result = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            id: userId,
            points: 0,
          },
        });
      }

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          points: {
            increment: pointsEarned,
          },
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          eventId,
          userId,
          amount,
          points: pointsEarned,
        },
      });

      return {
        userId: updatedUser.id,
        pointsAwarded: pointsEarned,
        totalPoints: updatedUser.points,
        transactionId: transaction.id,
      };
    });

    logger.info(
      {
        eventId,
        userId: result.userId,
        pointsAwarded: result.pointsAwarded,
        totalPoints: result.totalPoints,
      },
      'LOYALTY POINTS AWARDED'
    );

    return result;
  }
}

export const loyaltyService = new LoyaltyService();
