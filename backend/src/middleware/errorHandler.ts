// middleware/errorHandler.ts
import type { ErrorRequestHandler } from 'express';
import { AppError } from '../error/appError';

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // If headers are already sent, Express's default handler must close the connection
  if (res.headersSent) {
    next(err);
    return;
  }

  // Expected, domain-level errors: safe to show the message to the client
  if (err instanceof AppError) {
    res.status(err.status).json({ success: false, error: err.message });
    return;
  }

  // Errors from multer / body-parser carry a 4xx status (file too large, bad JSON, wrong extension)
  const status = (err as { status?: number; statusCode?: number }).status
              ?? (err as { statusCode?: number }).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ success: false, error: (err as Error).message });
    return;
  }

  // Everything else is a bug or an infrastructure failure: log it, hide the details
  console.error(err);
  res.status(500).json({ success: false, error: 'Internal server error' });
};
