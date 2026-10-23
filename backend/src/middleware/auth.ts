// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.user = req.session.user;
  next();
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export const requireRole = (...roles: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const has = roles.some(r => req.user?.roles?.includes(r));
    if (!has) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
