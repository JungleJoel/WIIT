import type { Knex } from "knex";
import { CrudRepository } from "./crudRepository";
import type { Node } from "../models/node/node";
import { Tx } from "../db/unitOfWork";

export class NodeRepository extends CrudRepository<Node> {
  constructor(protected readonly db: Knex) {
    super(db, "nodes");
  }

  async findById(id: number, trx?: Tx): Promise<Node | undefined> {
    return this.q(trx)
      .where({ id })
      .select();
  }

  /** All nodes of one structure, in sibling order. */
  async findByStructure(structureId: number, trx?: Tx): Promise<Node[]> {
    return this.q(trx)
      .where({ structureId })
      .orderBy([{ column: "parentId" }, { column: "sortOrder" }, { column: "id" }]);
  }

  async findChildren(parentId: number): Promise<Node[]> {
    return super.findAll(parentId);
  }

  async findAncestorIds(nodeId: number, trx?: Tx): Promise<number[]> {

    const dbInstance = trx || this.db;

    const query = dbInstance.raw(`
      WITH RECURSIVE ancestor_tree AS (
        SELECT parent_id
        FROM nodes
        WHERE id = :node_id

        UNION ALL

        SELECT n.parent_id
        FROM nodes n
        INNER JOIN ancestor tree a ON n.id = a.parent_id
        WHERE n.parent_id IS NOT NULL;
      )
      SELECT "parent_id" as id FROM ancestor_tree WHERE parent_id IS NOT NULL;
      `, { nodeId });

    const result = await query;

    const rows = (result && typeof result === 'object' && 'rows' in result)
      ? (result.rows as { id: number }[])
      : (result as { id: number }[]);

    return rows.map(row => row.id);
  }

  async nextSortOrder(structureId: number, parentId: number | null, trx?: Tx): Promise<number> {
    return this.q(trx)
      .where(structureId)
      .select("sort_order");
  }

  async insert(newNode: Node, userId: number, trx: Tx): Promise<Node> {
    const [createdNode] = await this.q(trx)
      .insert({
        ...newNode,
        created_by: userId,
        updated_by: userId
      }).returning('*');

    return createdNode;
  }

  async updateById(id: number, changes: Partial<Node>, userId: number, trx: Tx): Promise<Node> {
    const [updatedNode] = await this.q(trx)
      .where({ id })
      .update(changes)
      .returning('*');

    return updatedNode;
  }

  async deletedById(id: number, userId: number, trx: Tx): Promise<boolean> {
    const result = await this.q(trx)
      .where({ id })
      .delete();
    return !!result;
  }
}
