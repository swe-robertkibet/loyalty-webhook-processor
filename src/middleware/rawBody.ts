import { Request, Response, NextFunction } from 'express';

export function rawBodyMiddleware(req: Request, _res: Response, next: NextFunction): void {
  let data = '';

  req.on('data', (chunk) => {
    data += chunk;
  });

  req.on('end', () => {
    (req as Request & { rawBody: string }).rawBody = data;
    next();
  });
}
