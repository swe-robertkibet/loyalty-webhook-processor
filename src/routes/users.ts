import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { logger } from '../utils/logger';
import type { UserResponse, ErrorResponse } from '../types/api.types';

const router = Router();

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      const errorResponse: ErrorResponse = {
        error: 'NOT_FOUND',
        message: 'User not found',
      };
      return res.status(404).json(errorResponse);
    }

    const userResponse: UserResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      points: user.points,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return res.status(200).json(userResponse);
  } catch (error) {
    logger.error({ error, userId: req.params.id }, 'ERROR FETCHING USER');

    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch user',
    };
    return res.status(500).json(errorResponse);
  }
});

export default router;
