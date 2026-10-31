import type { Knex } from "knex";
import { CrudRepository } from "./crudRepository";
import type { Node } from "../models/node/node";
import type { NodePropertyValues } from "../models/node/nodePropertyValues";

export class NodeRepository extends CrudRepository<Node> {
  constructor(knex: Knex) {
    super(knex, "nodes");
  }

  /** All nodes of one structure, in sibling order. */
  async findByStructure(structureId: number): Promise<Node[]> {
    return this.qb
      .where({ structureId })
      .orderBy([{ column: "parentId" }, { column: "sortOrder" }, { column: "id" }]);
  }

  /** All property values of one structure in a single query (a join, so no huge IN list on MSSQL). */
  async findValuesByStructure(structureId: number): Promise<NodePropertyValues[]> {
    return this.knex("node_property_values as v")
      .join("nodes as n", "n.id", "v.node_id")
      .where("n.structure_id", structureId)
      .select("v.*");
  }
}
/**
import type { Knex } from 'knex';
import type { NodeRow } from '../models/node/nodeRow';

export class NodeRepository{

  constructor(private readonly db: Knex) {}


  async classificationStructures(): Promise<any[]>{
    return this.db('structures').where({ structure_type: 'klassificering' }).select('*');
  }

  async nodesInStructure(structureId: number): Promise<NodeRow[]> {
    return this.db<NodeRow>('nodes').where({ structure_id: structureId }).select('*');
  }



  async node(id: number): Promise<NodeRow | undefined> {
    return this.db<NodeRow>('nodes').where({ id }).first();
  }




  async activeClassificationTarget(structureId: number, typeId: number): Promise<boolean> {
    const structure = await this.db('structures').where({ id: structureId, structure_type: 'klassificering' }).first();
    const type = await this.db('node_types').where({ id: typeId, structure_type: 'klassificering', is_active: true }).first();
    return Boolean(structure && type);
  }



  async classificationNode(id: number): Promise<NodeRow | undefined> {
    const node = await this.node(id);
    if(!node) return undefined;
    const type = await this.db('node_types').where({ id: node.nodeTypeId, structure_type: 'klassificering' }).first();
    return type ? node : undefined;
  }




  async series(archiveId: number, seriesId: number): Promise<NodeRow | undefined> {
    return this.db<NodeRow>('nodes as n')
      .join('node_types as nt', 'nt.id', 'n.node_type_id')
      .join('structures as s', 's.id', 'n.structure_id')
      .join('archive_structures as ast', 'ast.structure_id', 's.id')
      .where({ 'n.id': seriesId, 'ast.archive_id': archiveId, 's.structure_type': 'arkivforteckning', 'nt.ead_level': 'series' })
      .select('n.*').first();
  }




  async volumes(seriesId: number): Promise<any[]> {
    return this.db('nodes as n').join('node_types as nt', 'nt.id', 'n.node_type_id')
      .where('n.parent_id', seriesId).orderBy([{ column: 'n.sort_order' }, { column: 'n.id' }])
      .select('n.*', 'nt.code as node_type_code', 'nt.name as node_type_name');
  }




  async volume(volumeId: number, archiveId?: number): Promise<NodeRow | undefined> {
    return this.db<NodeRow>('nodes as v').join('nodes as p', 'p.id', 'v.parent_id')
      .join('node_types as pt', 'pt.id', 'p.node_type_id').join('structures as s', 's.id', 'v.structure_id')
      .modify((query) => {
        query.where({ 'v.id': volumeId, 's.structure_type': 'arkivforteckning', 'pt.ead_level': 'series' });
        if (archiveId !== undefined) query.join('archive_structures as ast', 'ast.structure_id', 's.id').where('ast.archive_id', archiveId);
      }).select('v.*').first();
  }





  async archiveTreeData(): Promise<any[]>{
    const archives = await this.db('archives').select('*');
    const output = [];
    for (const archive of archives){
      const linked = await this.db('archive_structures as ast').join('structures as s', 's.id', 'ast.structure_id')
        .where('ast.archive_id', archive.id).select('s.*', 'ast.valid_from as archive_valid_from', 'ast.valid_to as archive_valid_to');
      const structures = [];
      for (const structure of linked) structures.push({ structure, nodes: await this.nodesInStructure(structure.id) });
      output.push({ ...archive, structures });
    }
    return output;
  }




  async archiveStructure(archiveId: number, requestedId?: number): Promise<{ archive?: any; structures: Array<{id:number}> }> {
    const archive = await this.db('archives').where({ id: archiveId }).first();
    let query = this.db('archive_structures as ast').join('structures as s', 's.id', 'ast.structure_id')
      .where({ 'ast.archive_id': archiveId, 's.structure_type': 'arkivforteckning' }).select('s.id');
    if(requestedId !== undefined) query = query.andWhere('s.id', requestedId);

    return { archive, structures: await query };
  }


  async seriesTypes(requestedId?: number): Promise<Array<{id:number}>> {
    let query = this.db('node_types').where({ structure_type: 'arkivforteckning', ead_level: 'series', is_active: true });
    if(requestedId !== undefined) query = query.andWhere({ id: requestedId });

    return query.select('id');
  }


  async volumeTypes(parentTypeId: number, requestedId?: number): Promise<Array<{id:number}>> {
    let query = this.db('node_type_rules as r').join('node_types as nt', 'nt.id', 'r.child_type_id')
      .where({ 'r.parent_type_id': parentTypeId, 'nt.is_active': true }).select('nt.id');
    if (requestedId !== undefined) query = query.andWhere('nt.id', requestedId);

    return query;
  }


  async allowedChild(parentTypeId: number, childTypeId: number): Promise<boolean> {
    return Boolean(await this.db('node_type_rules').where({ parent_type_id: parentTypeId, child_type_id: childTypeId }).first());
  }


  async nextSortOrder(structureId: number, parentId: number |null): Promise<number> {
    const row = await this.db('nodes').where({ structure_id: structureId, parent_id: parentId }).max({ value: 'sort_order' }).first();

    return Number(row?.value ?? -1) + 1;
  }

  async createNode(values: Record<string, unknown>, structureId: number, userId: number | null): Promise<NodeRow> {
    return this.db.transaction(async (trx) =>{
      const [node] = await trx('nodes').insert({ ...values, created_by: userId, updated_by: userId }).returning('*');
      await trx('change_log').insert({ entity_type: 'node', entity_id: node.id, structure_id: structureId, action: 'create', new_value: JSON.stringify(node), changed_by: userId });

      return node as NodeRow;

    });
  }


  async updateNode(id: number, structureId: number, changes: Record<string, unknown>, userId: number | null, oldNode: NodeRow): Promise<NodeRow | undefined> {
    return this.db.transaction(async (trx) => {
      const update = { ...changes, updated_at: trx.fn.now(), updated_by: userId };
      await trx('nodes').where({ id }).update(update);
      const current = await trx<NodeRow>('nodes').where({ id }).first();
      if(current) await trx('change_log').insert({ entity_type: 'node', entity_id: id, structure_id: structureId,
        action: (changes.isPublished ?? changes.is_published) === undefined || Boolean(changes.isPublished ?? changes.is_published) === Boolean(oldNode.isPublished) ? 'update' : (changes.isPublished ?? changes.is_published) ? 'publish' : 'unpublish',
        old_value: JSON.stringify(oldNode), new_value: JSON.stringify(current), changed_by: userId });

      return current;
    });
  }


  async deleteNode(id: number, node: NodeRow, userId: number | null): Promise<void> {
    await this.db.transaction(async (trx) =>{
      await trx('change_log').insert({ entity_type: 'node', entity_id: id, structure_id: node.structureId, action: 'delete', old_value: JSON.stringify(node), changed_by: userId });
      await trx('node_relations').where((q) => q.where({ from_node_id: id }).orWhere({ to_node_id: id })).del();
      await trx('nodes').where({ id }).del();

    });
  }
}
  */
