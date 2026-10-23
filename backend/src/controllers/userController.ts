import { UserService } from "../services/userService";
import { BaseController } from "./baseController";
import { Request, Response } from "express";

export class UserController extends BaseController {
  constructor(private readonly userService: UserService) {
    super();
  }

  getAllUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const users = await this.userService.getAllUsers(100, 0);

      if (!users) {
        res.status(404).json({ error: "Users not found" })
        return;
      }

      res.json(users);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }
}
