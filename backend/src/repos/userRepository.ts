import { Knex } from "knex";
import { User } from "../models/user";
import { CrudRepository } from "./crudRepository";

export class UserRepository extends CrudRepository<User> {
  constructor(knex: Knex, tableName: string) {
    super(knex, tableName);
  }

  async getAll(limit: number, offset: number): Promise<User[]> {
    const users = await super.findAll(limit, offset);
    if (!users) {
      throw new Error("No Users found!")
    }
    console.log("DB RESULT:", users);
    return users;
  }

}
