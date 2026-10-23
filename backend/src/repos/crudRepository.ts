import type { Knex } from "knex";

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
    public readonly knex: Knex,
    public readonly tableName: string,
  ) {}

  public get qb(): Knex.QueryBuilder {
    return this.knex(this.tableName);
  }

  async find(item: Partial<T>): Promise<T[]> {
    return this.qb.where(item).select();
  }

  async findAll(limit: number = 100, offset: number = 0): Promise<T[]> {
    return await this.qb.select().limit(limit).offset(offset);
  }

  async findOne(id: string | Partial<T>): Promise<T> {
    const query = typeof id === 'string' ? { id } : id;
    return this.qb.where(query).first();
  }

  async exists(id: string | Partial<T>): Promise<boolean> {
    const query = typeof id === 'string' ? { id } : id;
    const row = await this.qb.where(query).first();
    return !!row;
  }

  async create(item: Omit<T, 'id'>): Promise<T> {
    const [created] = await this.qb.insert(item).returning('*');
    return created;
  }

  async createMany(items: Omit<T, 'id'>[]): Promise<T[]> {
    return this.qb.insert(items).returning('*');
  }

  async update(id: string, item: Partial<T>): Promise<boolean> {
    const count = await this.qb.where({ id }).update(item);
    return count > 0;
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.qb.where({ id }).del();
    return count > 0;
  }
}
