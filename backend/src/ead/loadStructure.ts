import type { Knex } from 'knex';

/**
 * Reads one structure and everything the EAD3 export needs, in 6 queries
 * (not one query per node), and returns plain JS objects.
 *
 *   options.publicOnly = true  →  the same data the public site may show:
 *     - only nodes with is_published = 1
 *     - a node is dropped if any ancestor is unpublished (the whole branch is hidden)
 *     - only properties with is_public = 1 (OSL / GDPR)
 *
 * Returns: { structure, archive, roots: [node, …] }
 *   archive  the archive (arkiv) this structure belongs to, with its creator, or null
 *   node     { id, reference_code, title, ..., type, properties: [], relations: [], children: [] }
 */

/** MSSQL returns DATE as a JS Date; SQLite (tests) as a string. */
export type DbDate = Date | string | null;
/** MSSQL returns BIT as boolean; SQLite as 0/1. */
export type DbBool = boolean | number;

export type EadLevel =
  | 'collection' | 'fonds' | 'class' | 'recordgrp' | 'series' | 'subfonds'
  | 'subgrp' | 'subseries' | 'file' | 'item' | 'otherlevel';

export type PropertyDataType = 'text' | 'longtext' | 'number' | 'date' | 'boolean' | 'url' | 'enum'; // enum: migration 009, value in value_text

export type CreatorType = 'corporate' | 'person' | 'family';

/** A row in `structures` (the columns the export uses). */
export interface StructureRow {
  id: number;
  code: string;
  name: string;
  structure_type: string;
  description: string | null;
  valid_from: DbDate;
  valid_to: DbDate;
  is_published: DbBool;
  agency_code: string | null;
  agency_name: string | null;
  language_code: string | null;
  license: string | null;
  version: string | null;
  previous_structure_id: number | null;
}

/** nodes joined with node_types, as selected in loadStructure. */
export interface NodeQueryRow {
  id: number;
  parent_id: number | null;
  reference_code: string | null;
  previous_reference_code: string | null;
  title: string;
  sort_order: number;
  is_published: DbBool;
  external_id: string | null;
  valid_from: DbDate;
  valid_to: DbDate;
  description: string | null;
  portal_url: string | null;
  type_code: string;
  type_name: string;
  ead_level: EadLevel;
  ead_otherlevel: string | null;
  ead_unit_description: string | null;
}

/** node_property_values joined with property_definitions. Only the column matching data_type is set. */
export interface PropertyQueryRow {
  node_id: number;
  key: string;
  label: string;
  data_type: PropertyDataType;
  ead_element: string | null;
  sort_order: number;
  value_text: string | null;
  value_number: number | string | null;   // DECIMAL can come back as a string
  value_date: DbDate;
  value_boolean: DbBool | null;
}

/** node_relations joined with relation_types and the target node + its structure. */
export interface RelationQueryRow {
  from_node_id: number;
  relation_code: string;
  relation_name: string;
  ead_element: string | null;
  target_id: number;
  target_reference_code: string | null;
  target_title: string;
  target_is_published: DbBool;
  target_structure_name: string;
  target_structure_is_published: DbBool;
}

interface ArchiveQueryRow {
  id: number;
  reference_code: string | null;
  name: string;
  start_year: number | null;
  end_year: number | null;
  description: string | null;
  external_id: string | null;
  is_published: DbBool;
  creator_id: number;
  creator_name: string;
  creator_type: CreatorType;
  creator_start_year: number | null;
  creator_end_year: number | null;
  creator_description: string | null;
  creator_is_published: DbBool;
}

export interface NodeType {
  code: string;
  name: string;
  ead_level: EadLevel;
  ead_otherlevel: string | null;
  /** Text of <didnote localtype="structuralunitdescription">, e.g. 'Process'. Set only for Klara's structuralunit types. */
  ead_unit_description: string | null;
}

export interface NodeProperty {
  key: string;
  label: string;
  data_type: PropertyDataType;
  ead_element: string | null;
  /** Always a string, already formatted (dates as YYYY-MM-DD, booleans as Ja/Nej). */
  value: string;
}

export interface NodeRelation {
  code: string;
  name: string;
  ead_element: string | null;
  target: {
    id: number;
    reference_code: string | null;
    title: string;
    structure_name: string;
  };
}

export interface TreeNode {
  id: number;
  parent_id: number | null;
  reference_code: string | null;
  previous_reference_code: string | null;
  title: string;
  sort_order: number;
  is_published: boolean;
  external_id: string | null;
  valid_from: DbDate;
  valid_to: DbDate;
  description: string | null;
  portal_url: string | null;
  type: NodeType;
  properties: NodeProperty[];
  relations: NodeRelation[];
  children: TreeNode[];
}

export interface ArchiveCreator {
  id: number;
  name: string;
  type: CreatorType;
  start_year: number | null;
  end_year: number | null;
  description: string | null;
}

export interface Archive {
  id: number;
  reference_code: string | null;
  name: string;
  start_year: number | null;
  end_year: number | null;
  description: string | null;
  external_id: string | null;
  creator: ArchiveCreator | null;
}

export interface LoadedStructure {
  structure: StructureRow;
  archive: Archive | null;
  roots: TreeNode[];
}

export interface LoadOptions {
  publicOnly?: boolean;
}

export async function loadStructure(
  knex: Knex,
  structureId: number,
  { publicOnly = false }: LoadOptions = {},
): Promise<LoadedStructure | null> {
  const structure = await knex<StructureRow>('structures').where({ id: structureId }).first();
  if (!structure) return null;
  if (publicOnly && !structure.is_published) return null;

  const archive = await loadArchive(knex, structureId, publicOnly);

  const nodeRows: NodeQueryRow[] = await knex('nodes as n')
    .join('node_types as nt', 'nt.id', 'n.node_type_id')
    .where('n.structure_id', structureId)
    .select(
      'n.id', 'n.parent_id', 'n.reference_code', 'n.previous_reference_code',
      'n.title', 'n.sort_order',
      'n.is_published', 'n.external_id', 'n.valid_from', 'n.valid_to',
      'n.description', 'n.portal_url',
      'nt.code as type_code', 'nt.name as type_name',
      'nt.ead_level', 'nt.ead_otherlevel', 'nt.ead_unit_description',
    )
    .orderBy([{ column: 'n.parent_id' }, { column: 'n.sort_order' }, { column: 'n.id' }]);

  const nodeIds = nodeRows.map((n) => n.id);
  if (nodeIds.length === 0) return { structure, archive, roots: [] };

  // Property values (only the typed column that is set is used)
  const propQuery = knex('node_property_values as v')
    .join('property_definitions as d', 'd.id', 'v.property_definition_id')
    .join('nodes as n', 'n.id', 'v.node_id')
    .where('n.structure_id', structureId)
    .select(
      'v.node_id', 'd.key', 'd.label', 'd.data_type', 'd.ead_element', 'd.sort_order',
      'v.value_text', 'v.value_number', 'v.value_date', 'v.value_boolean',
    )
    .orderBy([{ column: 'v.node_id' }, { column: 'd.sort_order' }]);
  if (publicOnly) propQuery.where('d.is_public', true);
  const propRows: PropertyQueryRow[] = await propQuery;

  // Relations FROM nodes in this tree, with the target node (usually in another tree)
  const relRows: RelationQueryRow[] = await knex('node_relations as r')
    .join('relation_types as rt', 'rt.id', 'r.relation_type_id')
    .join('nodes as src', 'src.id', 'r.from_node_id')
    .join('nodes as tgt', 'tgt.id', 'r.to_node_id')
    .join('structures as ts', 'ts.id', 'tgt.structure_id')
    .where('src.structure_id', structureId)
    .select(
      'r.from_node_id', 'rt.code as relation_code', 'rt.name as relation_name', 'rt.ead_element',
      'tgt.id as target_id', 'tgt.reference_code as target_reference_code',
      'tgt.title as target_title', 'tgt.is_published as target_is_published',
      'ts.name as target_structure_name', 'ts.is_published as target_structure_is_published',
    );

  return { structure, archive, roots: buildTree(nodeRows, propRows, relRows, publicOnly) };
}

/**
 * The archive that uses this structure (archive_structures). If several archives use it,
 * the one whose link started most recently wins. Public mode skips unpublished archives
 * and leaves out an unpublished creator.
 */
async function loadArchive(knex: Knex, structureId: number, publicOnly: boolean): Promise<Archive | null> {
  const q = knex('archive_structures as l')
    .join('archives as a', 'a.id', 'l.archive_id')
    .join('archive_creators as c', 'c.id', 'a.archive_creator_id')
    .where('l.structure_id', structureId)
    .select(
      'a.id', 'a.reference_code', 'a.name', 'a.start_year', 'a.end_year', 'a.description',
      'a.external_id', 'a.is_published',
      'c.id as creator_id', 'c.name as creator_name', 'c.creator_type',
      'c.start_year as creator_start_year', 'c.end_year as creator_end_year',
      'c.description as creator_description', 'c.is_published as creator_is_published',
    )
    .orderBy([{ column: 'l.valid_from', order: 'desc' }, { column: 'a.id' }]);
  if (publicOnly) q.where('a.is_published', true);
  const row = (await q.first()) as ArchiveQueryRow | undefined;
  if (!row) return null;

  const showCreator = !publicOnly || Boolean(row.creator_is_published);
  return {
    id: row.id,
    reference_code: row.reference_code,
    name: row.name,
    start_year: row.start_year,
    end_year: row.end_year,
    description: row.description,
    external_id: row.external_id,
    creator: showCreator ? {
      id: row.creator_id,
      name: row.creator_name,
      type: row.creator_type,
      start_year: row.creator_start_year,
      end_year: row.creator_end_year,
      description: row.creator_description,
    } : null,
  };
}


/** Pure: rows → nested tree. Exported for tests. */
export function buildTree(
  nodeRows: NodeQueryRow[],
  propRows: PropertyQueryRow[],
  relRows: RelationQueryRow[],
  publicOnly = false,
): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  for (const r of nodeRows) {
    byId.set(r.id, {
      id: r.id,
      parent_id: r.parent_id,
      reference_code: r.reference_code,
      previous_reference_code: r.previous_reference_code,
      title: r.title,
      sort_order: r.sort_order,
      is_published: Boolean(r.is_published),
      external_id: r.external_id,
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      description: r.description,
      portal_url: r.portal_url,
      type: {
        code: r.type_code, name: r.type_name,
        ead_level: r.ead_level, ead_otherlevel: r.ead_otherlevel,
        ead_unit_description: r.ead_unit_description ?? null,
      },
      properties: [],
      relations: [],
      children: [],
    });
  }

  for (const p of propRows) {
    const node = byId.get(p.node_id);
    if (!node) continue;
    const value = pickValue(p);
    if (value === null || value === '') continue;
    node.properties.push({
      key: p.key, label: p.label, data_type: p.data_type,
      ead_element: p.ead_element, value,
    });
  }

  for (const r of relRows) {
    const node = byId.get(r.from_node_id);
    if (!node) continue;
    // Don't reveal a storage location the public may not see
    if (publicOnly && !(r.target_is_published && r.target_structure_is_published)) continue;
    node.relations.push({
      code: r.relation_code, name: r.relation_name, ead_element: r.ead_element,
      target: {
        id: r.target_id, reference_code: r.target_reference_code,
        title: r.target_title, structure_name: r.target_structure_name,
      },
    });
  }

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id == null) roots.push(node);
    else byId.get(node.parent_id)?.children.push(node);
  }

  const order = (a: TreeNode, b: TreeNode): number => a.sort_order - b.sort_order || a.id - b.id;
  const prune = (list: TreeNode[]): TreeNode[] => list
    .filter((n) => !publicOnly || n.is_published)    // unpublished hides its whole branch
    .sort(order)
    .map((n) => ({ ...n, children: prune(n.children) }));
  return prune(roots);
}

function pickValue(p: PropertyQueryRow): string | null {
  switch (p.data_type) {
    case 'number':  return p.value_number == null ? null : String(Number(p.value_number));
    case 'date':    return p.value_date == null ? null : toIsoDate(p.value_date);
    case 'boolean': return p.value_boolean == null ? null : (p.value_boolean ? 'Ja' : 'Nej');
    default:        return p.value_text;
  }
}

/** MSSQL returns DATE as a JS Date; SQLite (tests) as a string. Normalise to 'YYYY-MM-DD'. */
export function toIsoDate(d: DbDate | undefined): string | null {
  if (d == null) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}
