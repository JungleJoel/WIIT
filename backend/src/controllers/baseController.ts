import type { Response } from 'express';
import type { User } from '../models/user';
import type { RequestContext } from '../types/requestContext';


/** Shared HTTP helpers for controllers: request identity, access checks, and standard response shapes. */
export abstract class BaseController {

  /** Keep the current user's identity available to subclasses; database dependencies stay out of controllers. */
  constructor(protected readonly requestContext: RequestContext) {
  }

  /** Tell a handler whether authentication middleware attached a user to this request. */
  protected isAuthenticated(): boolean{
    return this.requestContext.user !== undefined;
  }


  /** Return the current user or throw when the route requires authentication. */
  protected requireAuth(): User {
    const user = this.requestContext.user;
    if (!user) throw new Error('Authentication required.');

    return user;
  }


  /** Match an allowed group against the roles, permissions, and groups currently attached to the user.
   The final AD/SSO role mapping is still pending; this helper reflects the session shape available today. */

  protected isUserPrivilegeGroup(privilegeGroups: string[] | undefined): boolean{
    if(!privilegeGroups?.length) return false;
    const user = this.requestContext.user;
    const userGroups= [...(user?.roles ?? []), ...(user?.permissions?? []), ...(user?.groups ?? [])];

    return privilegeGroups.some((group) => userGroups.includes(group));
  }

  /** Send 401 when a request lacks a logged-in user. */
  protected unauthorized(res: Response, message = 'Unauthorized'): void {
    res.status(401).json({ error: message });
  }

  /** Send 403 when the user is logged in but lacks the required group. */
  protected forbidden(res: Response, message = 'Forbidden'): void{
    res.status(403).json({ error: message });
  }


  /** Send the shared success envelope; existing endpoints still have some raw responses to standardize later. */
  protected success<T>(res: Response, data: T, message?: string): void {
    res.json({ success: true, data, message });
  }


  /** Send a shared error envelope with the supplied HTTP status. */
  protected error(res: Response, message: string, statusCode = 500): void{
    res.status(statusCode).json({ success: false, error: message });
  }
}
