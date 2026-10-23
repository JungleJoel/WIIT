import { User } from "../models/user";
import { UserRepository } from "../repos/userRepository";

export class UserService {

  constructor(private readonly userRepo: UserRepository) { }

  async getAllUsers(limit: number, offset: number): Promise<User[]> {
    const users = await this.userRepo.findAll(limit, offset);
    if (!users) throw new Error('No Users');
    return users;
  }

}
