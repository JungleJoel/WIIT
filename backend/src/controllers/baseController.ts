import { Request, Response } from 'express';
import { User } from '../models/user';


/**
 * The base controller all other controllers should extend.
 */
export abstract class BaseController {

  protected unauthorized(res: Response, message: string = "Unauthorized"): void {
    //TODO: ADD LOGGER HERE
    res.status(401).json({ error: message });
  }

  protected forbidden(res: Response, message: string = "Forbidden"): void {
    //TODO: ADD LOGGER HERE
    res.status(403).json({ error: message });
  }

  protected success<T>(res: Response, data: T, message?: string): void {
    res.json({ success: true, data, message });
  }

  protected error(res: Response, message: string, statusCode: number = 500): void {
    //ADD LOGGER HERE
    res.status(statusCode).json({ success: false, error: message });
  }
}
