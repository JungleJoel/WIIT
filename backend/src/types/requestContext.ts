import type { Request } from 'express';
import type { User } from '../models/user';

export type SessionUser = User & {
  roles?: string[];
  permissions?: string[];
  groups?: string[];
};

/** Request-specific identity passed from a route handler to its controller. It deliberately contains no database connection. */
export class RequestContext {
  readonly user: SessionUser | undefined;


  /** Keep the original request and read the user attached by authentication middleware. */
  constructor(readonly request: Request) {
    this.user = request.user as SessionUser | undefined;
  }
}
