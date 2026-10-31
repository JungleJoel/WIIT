import type { Knex } from "knex";
import { Tx } from "../db/unitOfWork";

interface Writer<T> {
  create(item: Omit<T, 'id'>): Promise<T>;
  createMany(item: Omit<T, 'id'>[]): Promise<T[]>;
  update(id: string, item: Partial<T>): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

interface Reader<T> {
  find(item: Partial<T>): Promise<T[]>;
  findOne(id: string | Partial<T>): Promise<T>;
  findAll(limit: number | 100, offset: number | 0): Promise<T[]>
  exists(id: string | Partial<T>): Promise<boolean>;
}

export abstract class CrudRepository<T> implements Reader<T>, Writer<T> {
  constructor(
    protected readonly db: Knex,
    protected readonly tableName: string,
  ) {}

  // Use this.q(knex) when no transaction is needed and Tx when transaction is needed.
  protected q(trx?: Knex | Tx): Knex.QueryBuilder { return (trx ?? this.db)(this.tableName); }

  async find(item: Partial<T>): Promise<T[]> {
    return this.q(this.db).where(item).select();
  }

  async findAll(limit: number = 100, offset: number = 0): Promise<T[]> {
    return this.q(this.db).select().limit(limit).offset(offset);
  }

  async findOne(id: string | Partial<T>): Promise<T> {
    type Id = number | string;
    const asWhere = <T>(id: Id | Partial<T>): object =>
      typeof id === 'object' ? id : { id };
    return this.q(this.db).where(asWhere).first();
  }

  async exists(id: string | Partial<T>): Promise<boolean> {
    const query = typeof id === 'string' ? { id } : id;
    const row = await this.q(this.db).where(query).first();
    return !!row;
  }

  async create(item: Omit<T, 'id'>): Promise<T> {
    const [created] = await this.q().insert(item).returning('*');
    return created;
  }

  async createMany(items: Omit<T, 'id'>[]): Promise<T[]> {
    return this.q().insert(items).returning('*');
  }

  async update(id: string, item: Partial<T>): Promise<boolean> {
    const count = await this.q().where({ id }).update(item);
    return count > 0;
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.q().where({ id }).del();
    return count > 0;
  }
}
