import type { Node } from "../models/node/node";
import type { NodeValue, TreeNode } from "../models/node/treeNode";
import type { NodePropertyValues } from "../models/node/nodePropertyValues";
import type { NodeRepository } from "../repos/nodeRepository";
import { NodeRelationRepository } from "../repos/nodeRelationRepository";
import { ChangeLogRepository } from "../repos/changeLogRepository";
import { Tx, UnitOfWork } from "../db/unitOfWork";

export class NodeService {
  constructor(
    private nodes: NodeRepository,
    private relations: NodeRelationRepository,
    private changeLog: ChangeLogRepository,
    private uow: UnitOfWork,
  ) {}

  async get(id: number): Promise<Node> {
    const node = await this.nodes.findById(id);

    if (!node) {
      throw new Error(`Node with ID ${id} not found.`);
    }

    return node;
  }

  async create(input: Node, userId: number): Promise<Node> {
    //LILAS IS IMPLEMENTING! ADD HER CODE HERE!
    throw new Error("Not implemented yet")
  }

  async update(id: number, changes: Partial<Node>, userId: number, trx: Tx): Promise<Node> {
    return this.nodes.updateById(id, changes, userId, trx);
  }

  async delete(id: number, userId: number, trx: Tx): Promise<boolean> {
    return this.nodes.deletedById(id, userId, trx)
  }

  // DON'T THINK WE NEED TO IMPLEMENT THIS ONE!
  async move() {}





  /**
   * The whole tree of one structure.
   *
   * publicOnly = true is what the public site may show:
   *   - null if the structure is not published
   *   - unpublished nodes are dropped together with their whole branch
   *   - only values of fields with isPublic = true
   *
   * @returns null if the structure does not exist (or is hidden in public mode)
   */
  async getTree(structureId: number, publicOnly = false): Promise<TreeNode[] | null> {
    const structure = await this.structures.findById(structureId);
    if (!structure) return null;
    if (publicOnly && !structure.isPublished) return null;

    const nodes = await this.nodes.findByStructure(structureId);
    if (nodes.length === 0) return [];

    const values = await this.nodes.findValuesByStructure(structureId);

    const [types, defs] = await Promise.all([
      this.nodeTypes.findByIds([...new Set(nodes.map((n) => n.nodeTypeId))]),
      this.definitions.findByIds([...new Set(values.map((v) => v.propertyDefinitionId))]),
    ]);

    const valuesByNode = this.groupValues(values, new Map(defs.map((d) => [d.id, d])), publicOnly);
    const typeById = new Map(types.map((t) => [t.id, t]));

    const roots = this.nest(nodes, typeById, valuesByNode);
    return publicOnly ? this.prunePublic(roots) : roots;
  }

  /** Attaches each value to its field definition, drops non-public fields in public mode, keeps file order. */
  private groupValues(
    values: NodePropertyValues[],
    defById: Map<number, NodeValue["definition"]>,
    publicOnly: boolean,
  ): Map<number, NodeValue[]> {
    const byNode = new Map<number, NodeValue[]>();

    for (const v of values) {
      const definition = defById.get(v.propertyDefinitionId);
      if (!definition) continue;
      if (publicOnly && !definition.isPublic) continue;   // OSL / GDPR

      const list = byNode.get(v.nodeId) ?? [];
      list.push({ ...v, definition });
      byNode.set(v.nodeId, list);
    }

    for (const list of byNode.values()) {
      list.sort((a, b) =>
        a.definition.sortOrder - b.definition.sortOrder || a.valueOrder - b.valueOrder);
    }
    return byNode;
  }

  /** Flat rows to a nested tree. Rows arrive ordered by sortOrder, so siblings stay in order. */
  private nest(
    nodes: Node[],
    typeById: Map<number, TreeNode["nodeType"]>,
    valuesByNode: Map<number, NodeValue[]>,
  ): TreeNode[] {
    const byId = new Map<number, TreeNode>();

    for (const n of nodes) {
      const { rowVersion: _rowVersion, ...rest } = n;
      byId.set(n.id, {
        ...rest,
        nodeType: typeById.get(n.nodeTypeId)!,
        values: valuesByNode.get(n.id) ?? [],
        children: [],
      });
    }

    const roots: TreeNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId == null ? null : byId.get(node.parentId);
      (parent ? parent.children : roots).push(node);
    }
    return roots;
  }

  /** Unpublished node = whole branch hidden, since children are only reachable through the parent. */
  private prunePublic(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .filter((n) => Boolean(n.isPublished))   // MSSQL: boolean, SQLite: 0/1
      .map((n) => ({ ...n, children: this.prunePublic(n.children) }));
  }
/**
import { NodeRepository } from '../repos/nodeRepository';
import { toTree, validId } from '../controllers/nodeApiSupport';
import type { NodeRow } from '../models/node/nodeRow';


export class NodeService {

  constructor(private readonly nodes: NodeRepository) {}



  async classificationTree() {
    const structures = await this.nodes.classificationStructures();
    const result =[];
    for (const structure of structures) result.push({ structure, nodes: toTree(await this.nodes.nodesInStructure(structure.id)) });

    return result;

  }


  async classificationNode(id: number) {
    return this.nodes.classificationNode(id); }


  async series(archiveId: number, seriesId: number) {
    return this.nodes.series(archiveId, seriesId); }



  async archiveTree() {
    return (await this.nodes.archiveTreeData()).map((archive: any) =>({
      ...archive,
      structures: archive.structures.map((item: any) => ({ ...item, nodes: toTree(item.nodes) })),
    }
    ));
  }


  async volumes(seriesId: number) {
    return this.nodes.volumes(seriesId); }


  async archiveAndStructure(archiveId: number, requestedId?: number): Promise<{
    archive?: Record<string, unknown>;
    structure?: { id: number };
    error?: { message: string; status: number };
  }> {
    const result = await this.nodes.archiveStructure(archiveId, requestedId);
    if (!result.archive) return { error: { message: 'Archive not found.', status: 404 } };
    if (!result.structures.length) return { error: { message: 'Archive has no linked archival inventory structure.', status: 409 } };
    if (result.structures.length > 1) return { error: { message: 'More than one archival inventory structure is linked; supply structureId.', status: 409 } };

    return { archive: result.archive, structure: result.structures[0] };
  }




  async resolveSeriesType(requested: unknown): Promise<number | null> {
    const id = requested == null ? undefined : validId(String(requested)) ?? undefined;
    if (requested != null && !id)
      return null;
    const types = await this.nodes.seriesTypes(id);

    return types.length === 1 ? Number(types[0].id) : null;
  }



  async resolveVolumeType(parentTypeId: number, requested: unknown): Promise<number | null> {
    const id = requested == null ? undefined : validId(String(requested)) ?? undefined;
    if (requested != null && !id)
      return null;
    const types = await this.nodes.volumeTypes(parentTypeId, id);

    return types.length === 1 ? Number(types[0].id) : null;
  }


  async parent(parentId: number, structureId: number): Promise<NodeRow | undefined> {
    const parent = await this.nodes.node(parentId);

    return parent?.structureId === structureId ? parent : undefined;
  }


  async isAllowedChild(parentTypeId: number, childTypeId: number) {
    return this.nodes.allowedChild(parentTypeId, childTypeId); }


  async nextSortOrder(structureId: number, parentId: number | null) {
    return this.nodes.nextSortOrder(structureId, parentId); }


  async create(values: Record<string, unknown>, structureId: number, userId: number | null) {
    return this.nodes.createNode(values, structureId, userId);
  }



  async createClassification(input: { structureId: number; parentId: number; nodeTypeId: number; title: string; referenceCode: unknown; sortOrder: unknown; userId: number | null }) {
    if (!(await this.nodes.activeClassificationTarget(input.structureId, input.nodeTypeId))) throw new Error('Unknown classification structure or active node type.');
    const parent = await this.parent(input.parentId, input.structureId);
    if(!parent) throw new Error('Parent must exist in the selected structure.');
    if(!(await this.isAllowedChild(parent.nodeTypeId, input.nodeTypeId))) throw new Error('This node type is not allowed under that parent type.');

    return this.create({ structureId: input.structureId, parentId: parent.id, nodeTypeId: input.nodeTypeId,
      title: input.title.trim(), referenceCode: input.referenceCode, sortOrder: input.sortOrder }, input.structureId, input.userId);
  }


  async update(id: number, structureId: number, values: Record<string, unknown>, userId: number | null, current: NodeRow) {
    return this.nodes.updateNode(id, structureId, values, userId, current);
  }


  async delete(id: number, current: NodeRow, userId: number|null) {
    return this.nodes.deleteNode(id, current, userId); }


  async volume(volumeId: number, archiveId?: number) {
    return this.nodes.volume(volumeId, archiveId); }


  async node(id: number) {
    return this.nodes.node(id);}
}
*/
