export class AppError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export class ValidationError extends AppError { constructor(m: string) { super(400, m); } }
export class ForbiddenError  extends AppError { constructor(m = 'Forbidden') { super(403, m); } }
export class NotFoundError   extends AppError { constructor(m: string) { super(404, m); } }
export class ConflictError   extends AppError { constructor(m: string) { super(409, m); } }
