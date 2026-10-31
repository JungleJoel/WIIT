import type { Knex } from "knex";
import { CrudRepository } from "./crudRepository";
import type { NodeType } from "../models/node/nodeType";

export class NodeTypeRepository extends CrudRepository<NodeType> {
  constructor(db: Knex) {
    super(db, "node_types");
  }

  async findById(id: number): Promise<NodeType | undefined> {
    return await this.q()
      .where({ id })
      .select()
  }

  async findActiveByStructureType(structureType: string): Promise<NodeType[]> {
    const nodeTypes = await this.q()
      .where({ structureType })
      .andWhere('is_active', true)
      .select('*');
    return nodeTypes;
  }

  async findAllowedChildren(parentTypeId: number): Promise<NodeType[]> {
    const allowedChildren = await this.q()
      .join("node_type_rules as ntr", "ntr.parent_type_id", "id")
      .where({ parentTypeId })
      .select('*')

    return allowedChildren;
  }

  async isAllowedChild(parentId: number, childTypeId: number): Promise<boolean> {
    const rule = await this.q()
      .join("node_type_rules as ntr", "ntr.parent_type_id", "id")
      .where({ parentId })
      .andWhere({ childTypeId })
      .first()

    return !!rule;
  }
}
