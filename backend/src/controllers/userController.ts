import { User } from "../models/user";
import { UserService } from "../services/userService";
import { BaseController } from "./baseController";
import { Request, Response } from "express";
import type { RequestContext } from '../types/requestContext';

export class UserController extends BaseController {

  /* this supplies the request context to BaseController and retains the user service for the user lookups. */
  constructor(context: RequestContext, private readonly userService: UserService) {
    super(context);
  }

  /* Requests the first 100 users from UserService and returns them as JSON.
  A missing result or thrown service error gives an HTTP error response. */

  getAllUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const users = await this.userService.getAllUsers(100, 0);

      if (!users) {
        this.error(res, "Users not found", 500)
        return;
      }

      this.success<User[]>(res, users)
    } catch (error: any) {
      this.error(res, error.message, 404)
    }
  }
}
