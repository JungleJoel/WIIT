import { Knex } from "knex";
import { NodeRelation } from "../models/node/nodeRelation";
import { CrudRepository } from "./crudRepository";
import { Tx } from "../db/unitOfWork";

export class NodeRelationRepository extends CrudRepository<NodeRelation> {
  constructor(protected readonly db: Knex) {
    super(db, 'node_relations');
  }

  async deleteForNode(nodeId: number, trx: Tx): Promise<void> {
    await this.q(trx)
      .where({ nodeId })
      .delete();
  }
}
