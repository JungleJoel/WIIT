// db/unitOfWork.ts
export type Tx = Knex.Transaction;
export class UnitOfWork {
  constructor(private readonly db: Knex) {}
  run<T>(fn: (trx: Tx) => Promise<T>): Promise<T> { return this.db.transaction(fn); }
}
