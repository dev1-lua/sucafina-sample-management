import type { NextFunction, Request, Response } from 'express';

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.API_KEY ?? 'dev-key-sucafina';
  if (req.header('x-api-key') !== expected) {
    return res.status(401).json({ error: 'invalid api key' });
  }
  next();
}

export function actorFrom(req: Request): string {
  return req.header('x-actor') ?? 'api';
}
