import { Knex } from "knex";
import { CrudRepository } from "./crudRepository";
import { Archive } from "../models/archive/archive";

export class ArchiveRepository extends CrudRepository<Archive> {
  constructor(protected readonly db: Knex) {
    super(db, 'archives');
  }

  async findAll(): Promise<Archive[]> {
    return super.findAll();
  }

  async findById(id: number): Promise<Archive | undefined> {
    return super.findOne(String.apply(id));
  }

}
