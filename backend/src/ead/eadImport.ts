/**
 * NF5: writes an EAD file that eadMapper.ts has read into the WIIT tables, so that it can be
 * exported again with loadStructure.ts / buildEad3.ts.
 *
 *   EAD                                         WIIT
 *   <c otherlevel="classificationstructure">    structures, type 'klassificering'
 *   <c otherlevel="recordkeepingentity">        structures, type 'forvaring' (Klara's second tree)
 *     its unittitle / unitid@label / scopecontent  structures.name / version / description
 *     its @id                                   structures.external_id
 *   <c> below                                   nodes
 *     @id                                       nodes.external_id
 *     <unitid>                                  nodes.reference_code (unique per parent)
 *     <unittitle>                               nodes.title
 *     @audience="external"                      nodes.is_published
 *     <scopecontent>                            nodes.description
 *     <unitdatestructured><daterange>           nodes.valid_from / valid_to
 *     <unitid localtype="modified"/"modifiedby"> nodes.source_updated_at / _by
 *     @level / @otherlevel / didnote            node_types (found, or created with a warning)
 *     <appraisal>, <accessrestrict>, <physloc>,
 *     <abstract>, <legalstatus>, <odd>, …       node_property_values, in the field found by
 *                                               ead_element or key, or a new field
 *     <unitid localtype="relations"><ref>       node_relations 'relaterad_till'
 *
 * Archive data must not be lost on import, so a value that does not fit (a repeated code, a
 * reference to a node that does not exist) is kept as a field and reported as a warning.
 */

import type { Knex } from 'knex';
import type { EadMetadata, EadNode, EadProperty } from './ead.types';


export type StructureType = 'klassificering' | 'arkivforteckning' | 'forvaring';

export interface ImportInput {
  metadata: EadMetadata;
  rootNode: EadNode;
  sourceFileName?: string | null;
  /** Name for the structure when the file holds ONE tree. Ignored for Klara's two-tree files. */
  structureName?: string | null;
  /** Structure type when the file holds one tree without a Klara wrapper. Default 'klassificering'. */
  structureType?: StructureType;
  /** Link the new structure(s) to this archive (archive_structures → arkivbildare). */
  archiveId?: number | null;
  userId?: number | null;
}

export interface ImportedStructure {
  id: number;
  code: string;
  name: string;
  structureType: string;
  nodeCount: number;
}

export interface ImportResult {
  structures: ImportedStructure[];
  relationCount: number;
  createdNodeTypes: string[];
  warnings: string[];
}

/** A tree in the file has already been imported. The route answers 409. */
export class EadImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EadImportConflictError';
  }
}

interface NodeTypeRow {
  id: number;
  code: string;
  structure_type: string;
  ead_level: string;
  ead_otherlevel: string | null;
  ead_unit_description: string | null;
}

interface PropertyDefRow {
  id: number;
  node_type_id: number;
  key: string;
  label: string;
  data_type: string;
  ead_element: string | null;
  is_repeatable: boolean | number;
}

/** The field an EAD element is stored in, and how to create it if the node type lacks it. */
interface PropertySpec {
  key: string;
  label: string;
  eadElement: string | null;
  dataType: 'text' | 'longtext' | 'url';
  isPublic: boolean;
  repeatable: boolean;
}

interface Tree {
  structureType: StructureType;
  /** The EAD element that becomes the structure (null = the document itself). */
  wrapper: EadNode | null;
  topNodes: EadNode[];
}

interface PendingValue { nodeId: number; nodeTypeId: number; spec: PropertySpec; value: string }
interface PendingRef { nodeId: number; target: string; label: string | null }


const EAD_LEVELS = new Set([
  'collection', 'fonds', 'class', 'recordgrp', 'series', 'subfonds',
  'subgrp', 'subseries', 'file', 'item', 'otherlevel',
]);

/** Klara's wrappers directly under <dsc>: each one becomes its own structure. */
const WRAPPERS: Record<string, StructureType> = {
  classificationstructure: 'klassificering',
  recordkeepingentity: 'forvaring',
};

/**
 * EAD elements that are stored as fields. ead_element is the same value that buildEad3.ts
 * reads, so each value is written back to the element it came from. Keys and labels are the
 * ones in the seed and the client's Excel (sekretess, gallringsforeskrifter, placering), so an
 * import fills the existing fields instead of creating new ones.
 */
const ELEMENT_SPECS: Record<string, PropertySpec> = {
  appraisal:      { key: 'gallringsforeskrifter', label: 'Gallringsföreskrifter', eadElement: 'appraisal',      dataType: 'longtext', isPublic: true,  repeatable: false },
  accessrestrict: { key: 'sekretess',             label: 'Sekretess',             eadElement: 'accessrestrict', dataType: 'longtext', isPublic: false, repeatable: false },
  abstract:       { key: 'abstract',              label: 'Sammanfattning',        eadElement: 'did/abstract',   dataType: 'longtext', isPublic: true,  repeatable: false },
  physloc:        { key: 'placering',             label: 'Placering',             eadElement: 'did/physloc',    dataType: 'text',     isPublic: false, repeatable: true  },
  legalstatus:    { key: 'rattslig_status',       label: 'Rättslig status',       eadElement: 'legalstatus',    dataType: 'text',     isPublic: true,  repeatable: false },
  relation:       { key: 'lank',                  label: 'Länk',                  eadElement: 'dao',            dataType: 'url',      isPublic: true,  repeatable: true  },
  unitid:         { key: 'annan_beteckning',      label: 'Annan beteckning',      eadElement: 'did/unitid',     dataType: 'text',     isPublic: true,  repeatable: true  },
};
const UNITID_LABEL: PropertySpec = { key: 'beteckning_etikett', label: 'Etikett för beteckning', eadElement: null, dataType: 'text', isPublic: true, repeatable: false };
const UNRESOLVED_REF: PropertySpec = { key: 'ead_referens', label: 'Olöst EAD-referens', eadElement: null, dataType: 'text', isPublic: false, repeatable: true };

const RELATION_TYPE = { code: 'relaterad_till', name: 'relaterad till', inverse_name: 'relaterad från', ead_element: 'relatedmaterial' };

// Column lengths in the migrations; longer values would make SQL Server reject the whole import
const MAX = { title: 500, reference_code: 100, external_id: 255, code: 50, source_updated_by: 255 };


/**
 * Normalises a value for comparison: case-insensitive like SQL Server's default collation,
 * and without accents, so 'Verksamhetsområde' and 'verksamhetsomrade' match.
 */
export const norm = (value: unknown): string =>
  String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const slug = (value: string): string =>
  norm(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'typ';

const insertId = (rows: unknown): number => {
  const first = (rows as Array<{ id: number } | number>)[0];
  return typeof first === 'object' ? first.id : Number(first);
};

/** Only full YYYY-MM-DD dates fit the DATE columns; anything else becomes null. */
const isoDate = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function countNodes(nodes: EadNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

/**
 * Finds the trees in a file; each one becomes a structure.
 *
 * Klara puts its trees as wrappers directly under <dsc> (classificationstructure,
 * recordkeepingentity). Other files hold one tree: when <archdesc> is a fonds or collection,
 * for example WIIT's own export, its children are the top nodes; otherwise <archdesc> is the
 * top node itself. Components next to Klara's wrappers are not imported and get a warning.
 */
export function findTrees(root: EadNode, fallbackType: StructureType, warnings: string[]): Tree[] {
  const wrapped = root.children.filter((c) => WRAPPERS[norm(c.otherlevel)]);
  if (wrapped.length > 0) {
    for (const other of root.children.filter((c) => !WRAPPERS[norm(c.otherlevel)])) {
      warnings.push(`"${other.name}" (${other.otherlevel || other.level}) ligger bredvid Klaras träd och importerades inte.`);
    }
    return wrapped.map((w) => ({
      structureType: WRAPPERS[norm(w.otherlevel)]!,
      wrapper: w,
      topNodes: w.children,
    }));
  }
  const isContainer = !root.level || ['fonds', 'collection'].includes(norm(root.level));
  return [{ structureType: fallbackType, wrapper: null, topNodes: isContainer ? root.children : [root] }];
}


/**
 * Imports one EAD document: creates a structure per tree with its nodes, fields and relations,
 * and logs each structure in transfer_jobs.
 *
 * Everything runs in one transaction (section 5.5), so a failed import leaves nothing behind.
 *
 * @throws EadImportConflictError if a tree with the same external id has already been imported.
 * @throws Error if a component has level="otherlevel" without @otherlevel, or if the database
 *   rejects a row.
 */
export async function importEad(knex: Knex, input: ImportInput): Promise<ImportResult> {
  const warnings: string[] = [];
  const trees = findTrees(input.rootNode, input.structureType ?? 'klassificering', warnings);
  const userId = input.userId ?? null;

  return knex.transaction(async (trx) => {
    // Read once and kept in memory: a Klara file has ~1 400 nodes but only a handful of types
    const nodeTypes: NodeTypeRow[] = await trx('node_types')
      .select('id', 'code', 'structure_type', 'ead_level', 'ead_otherlevel', 'ead_unit_description');
    const usedTypeCodes = new Set(nodeTypes.map((t) => norm(t.code)));
    const createdNodeTypes: string[] = [];

    const propertyDefs: PropertyDefRow[] = await trx('property_definitions')
      .select('id', 'node_type_id', 'key', 'label', 'data_type', 'ead_element', 'is_repeatable');
    // F3.6: the database cannot check listruta values (migration 009), so the import does
    const options: Array<{ property_definition_id: number; value: string }> = await trx('property_options')
      .where({ is_active: true }).select('property_definition_id', 'value');

    const typeFor = async (node: EadNode, structureType: StructureType): Promise<number> => {
      let level = norm(node.level) || 'otherlevel';
      let otherlevel = node.otherlevel;
      if (!EAD_LEVELS.has(level)) { otherlevel = node.level; level = 'otherlevel'; }  // non-standard @level
      if (level === 'otherlevel' && !otherlevel) {
        throw new Error(`"${node.name}" har level="otherlevel" men saknar @otherlevel.`);
      }
      const unitDescription = norm(otherlevel) === 'structuralunit' ? node.structuralUnitDescription : null;

      const found = nodeTypes.find((t) =>
        t.structure_type === structureType &&
        norm(t.ead_level) === level &&
        norm(t.ead_otherlevel) === norm(level === 'otherlevel' ? otherlevel : null) &&
        norm(t.ead_unit_description) === norm(unitDescription));
      if (found) return found.id;

      // An unknown type is created rather than rejected, so one new level in Klara does not
      // stop the whole import. The warning tells the archivist to check its name and rules.
      const name = (unitDescription || otherlevel || level).slice(0, 255);
      let code = slug(name).slice(0, MAX.code);
      for (let i = 2; usedTypeCodes.has(code); i++) code = `${slug(name).slice(0, MAX.code - 4)}_${i}`;
      usedTypeCodes.add(code);

      const row: Omit<NodeTypeRow, 'id'> = {
        code, structure_type: structureType, ead_level: level,
        ead_otherlevel: level === 'otherlevel' ? otherlevel : null,
        ead_unit_description: unitDescription,
      };
      const id = insertId(await trx('node_types').insert({ ...row, name }, ['id']));
      nodeTypes.push({ id, ...row });
      createdNodeTypes.push(`${name} (${structureType})`);
      return id;
    };

    /**
     * The field a value is stored in. A field the archivist has set up is reused (matched on
     * EAD element first, then on key) and only a missing one is created, so Klara's values land
     * in the fields from the client's Excel.
     */
    const definitionFor = async (nodeTypeId: number, spec: PropertySpec, multiple: boolean): Promise<PropertyDefRow> => {
      const ofType = propertyDefs.filter((d) => d.node_type_id === nodeTypeId);
      let def = (spec.eadElement && ofType.find((d) => d.ead_element === spec.eadElement))
        || ofType.find((d) => norm(d.key) === norm(spec.key));
      if (!def) {
        const id = insertId(await trx('property_definitions').insert({
          node_type_id: nodeTypeId, key: spec.key, label: spec.label, data_type: spec.dataType,
          ead_element: spec.eadElement, is_public: spec.isPublic, is_repeatable: spec.repeatable || multiple,
          sort_order: 100 + ofType.length,   // after the fields the archivist set up
        }, ['id']));
        def = { id, node_type_id: nodeTypeId, key: spec.key, label: spec.label, data_type: spec.dataType,
          ead_element: spec.eadElement, is_repeatable: spec.repeatable || multiple };
        propertyDefs.push(def);
      } else if (multiple && !def.is_repeatable) {
        await trx('property_definitions').where({ id: def.id }).update({ is_repeatable: true });
        def.is_repeatable = true;
      }
      return def;
    };

    /**
     * F3.6: the value in the column that matches the field's type (fritext / listruta / ja-nej
     * from the client's Excel, plus date and number). EAD only carries text, so it is
     * converted here; a value that does not fit is kept as text and reported.
     */
    const typedValue = (def: PropertyDefRow, value: string, nodeId: number): Record<string, unknown> => {
      const where = `nod ${nodeId}, fält "${def.label}"`;
      switch (def.data_type) {
        case 'boolean': {
          const v = norm(value);
          if (['ja', 'yes', 'true', '1', 'x'].includes(v)) return { value_boolean: true };
          if (['nej', 'no', 'false', '0'].includes(v)) return { value_boolean: false };
          warnings.push(`${where}: "${value}" är inte ja/nej – sparad som text, syns inte i fältet.`);
          return { value_text: value };
        }
        case 'date': {
          const d = isoDate(value.trim().slice(0, 10));
          if (d) return { value_date: d };
          warnings.push(`${where}: "${value}" är inget datum (ÅÅÅÅ-MM-DD) – sparad som text, syns inte i fältet.`);
          return { value_text: value };
        }
        case 'number': {
          const n = Number(value.replace(',', '.').replace(/\s/g, ''));
          if (Number.isFinite(n)) return { value_number: n };
          warnings.push(`${where}: "${value}" är inget tal – sparad som text, syns inte i fältet.`);
          return { value_text: value };
        }
        case 'enum': {
          const choices = options.filter((o) => o.property_definition_id === def.id);
          const match = choices.find((o) => norm(o.value) === norm(value));
          if (match) return { value_text: match.value };          // the list's spelling
          if (choices.length) warnings.push(`${where}: "${value}" finns inte i listrutan (${choices.map((o) => o.value).join(' / ')}) – sparad ändå.`);
          return { value_text: value };
        }
        default:
          return { value_text: value };
      }
    };

    const usedStructureCodes = new Set(
      (await trx('structures').select('code')).map((r: { code: string }) => norm(r.code)));
    const nodeIdByEadId = new Map<string, number>();
    const values: PendingValue[] = [];
    const refs: PendingRef[] = [];
    const imported: ImportedStructure[] = [];

    for (const tree of trees) {
      const w = tree.wrapper;
      const name = (w?.name || (trees.length === 1 ? input.structureName : null)
        || input.metadata.titleProper || 'Importerad struktur').slice(0, 255);
      const externalId = (w?.eadId || input.metadata.recordId || null)?.slice(0, MAX.external_id) ?? null;

      if (externalId) {
        const existing = await trx('structures').where({ external_id: externalId }).first('id', 'name');
        if (existing) {
          throw new EadImportConflictError(
            `"${name}" är redan importerad som strukturen "${existing.name}" (id ${existing.id}). ` +
            'Ta bort den först om den ska importeras om.');
        }
      }

      const base = slug(w?.unitid ? `${name}_${w.unitid}` : name).slice(0, MAX.code - 4);
      let code = base;
      for (let i = 2; usedStructureCodes.has(code); i++) code = `${base}_${i}`;
      usedStructureCodes.add(code);

      const structureId = insertId(await trx('structures').insert({
        code, name,
        structure_type: tree.structureType,
        description: w?.scopeContent ?? null,
        valid_from: isoDate(w?.validFrom ?? null),
        valid_to: isoDate(w?.validTo ?? null),
        is_published: w ? norm(w.audience) === 'external' : false,
        version: (w?.unitidLabel || input.metadata.edition || null)?.slice(0, 50) ?? null,
        agency_name: input.metadata.agencyName?.slice(0, 255) ?? null,
        language_code: (input.metadata.languageCode || 'swe').slice(0, 3),
        external_id: externalId,
        created_by: userId, updated_by: userId,
      }, ['id']));

      if (input.archiveId) {
        await trx('archive_structures').insert({ archive_id: input.archiveId, structure_id: structureId, created_by: userId });
      }

      // external_id is unique per structure (002); a repeated @id is dropped with a warning
      const usedExternalIds = new Set<string>();

      const insertNode = async (node: EadNode, parentId: number | null, sortOrder: number,
        usedCodes: Set<string>): Promise<void> => {
        const nodeTypeId = await typeFor(node, tree.structureType);

        // F6.1: reference_code is unique among siblings (008); a repeat is kept as a field instead
        let referenceCode = node.unitid?.trim() || null;
        const extraValues: Array<{ spec: PropertySpec; value: string }> = [];
        if (referenceCode && (usedCodes.has(norm(referenceCode)) || referenceCode.length > MAX.reference_code)) {
          warnings.push(`"${node.name}": beteckningen "${referenceCode}" finns redan på samma nivå (eller är för lång) – sparad som Annan beteckning.`);
          extraValues.push({ spec: ELEMENT_SPECS.unitid!, value: referenceCode });
          referenceCode = null;
        }
        if (referenceCode) usedCodes.add(norm(referenceCode));

        let externalIdOfNode = node.eadId?.slice(0, MAX.external_id) || null;
        if (externalIdOfNode && usedExternalIds.has(externalIdOfNode)) {
          warnings.push(`"${node.name}": @id "${externalIdOfNode}" förekommer flera gånger – bara den första sparades.`);
          externalIdOfNode = null;
        }
        if (externalIdOfNode) usedExternalIds.add(externalIdOfNode);

        let validFrom = isoDate(node.validFrom);
        let validTo = isoDate(node.validTo);
        if (validFrom && validTo && validFrom > validTo) {
          warnings.push(`"${node.name}": slutdatum ${validTo} före startdatum ${validFrom} – slutdatum sparades inte.`);
          validTo = null;
        }

        if (node.name.length > MAX.title) {
          warnings.push(`"${node.name.slice(0, 60)}…": titeln är längre än ${MAX.title} tecken och kortades.`);
        }

        const nodeId = insertId(await trx('nodes').insert({
          structure_id: structureId,
          parent_id: parentId,
          node_type_id: nodeTypeId,
          reference_code: referenceCode,
          title: node.name.slice(0, MAX.title),
          sort_order: sortOrder,
          is_published: norm(node.audience) === 'external',
          external_id: externalIdOfNode,
          description: node.scopeContent,
          valid_from: validFrom,
          valid_to: validTo,
          source_updated_at: node.modifiedAt,
          source_updated_by: node.modifiedBy?.slice(0, MAX.source_updated_by) ?? null,
          created_by: userId, updated_by: userId,
        }, ['id']));
        if (node.eadId) nodeIdByEadId.set(node.eadId, nodeId);

        const add = (spec: PropertySpec, value: string | null): void => {
          if (value) values.push({ nodeId, nodeTypeId, spec, value });
        };
        add(ELEMENT_SPECS.appraisal!, node.appraisal);
        add(ELEMENT_SPECS.accessrestrict!, node.accessRestrict);
        add(ELEMENT_SPECS.abstract!, node.description);   // mapper: description = <abstract>
        if (node.unitidLabel) add(UNITID_LABEL, node.unitidLabel);
        for (const p of node.properties) add(specFor(p), p.value);
        for (const e of extraValues) add(e.spec, e.value);

        for (const r of node.refs) {
          if (r.targetEadId) refs.push({ nodeId, target: r.targetEadId, label: r.label });
        }

        const childCodes = new Set<string>();
        let i = 0;
        for (const c of node.children) await insertNode(c, nodeId, i++, childCodes);
      };

      const topCodes = new Set<string>();
      let i = 0;
      for (const top of tree.topNodes) await insertNode(top, null, i++, topCodes);

      imported.push({ id: structureId, code, name, structureType: tree.structureType, nodeCount: countNodes(tree.topNodes) });
    }

    // value_order keeps several values of one field on one node in file order (008)
    const counts = new Map<string, number>();
    for (const v of values) {
      const k = `${v.nodeId}|${v.nodeTypeId}|${v.spec.key}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const order = new Map<string, number>();
    const valueRows: object[] = [];
    for (const v of values) {
      const def = await definitionFor(v.nodeTypeId, v.spec, (counts.get(`${v.nodeId}|${v.nodeTypeId}|${v.spec.key}`) ?? 0) > 1);
      const k = `${v.nodeId}|${def.id}`;
      const n = order.get(k) ?? 0;
      order.set(k, n + 1);
      valueRows.push({ node_id: v.nodeId, property_definition_id: def.id, ...typedValue(def, v.value, v.nodeId), value_order: n, updated_by: userId });
    }
    // A batch insert needs the same columns in every row, so rows are grouped by which value
    // column they use. 100 rows × 5 columns stays under SQL Server's limit of 2 100 parameters.
    const byColumns = new Map<string, object[]>();
    for (const r of valueRows) {
      const cols = Object.keys(r).sort().join(',');
      byColumns.set(cols, [...(byColumns.get(cols) ?? []), r]);
    }
    for (const rows of byColumns.values()) await trx.batchInsert('node_property_values', rows, 100).transacting(trx);

    let relationCount = 0;
    if (refs.length) {
      let relType = await trx('relation_types').where({ code: RELATION_TYPE.code }).first('id');
      const relationTypeId = relType ? relType.id as number
        : insertId(await trx('relation_types').insert(RELATION_TYPE, ['id']));

      // A target that is not in this file may come from an earlier import; an @id that matches
      // more than one node is left unresolved rather than guessed
      const missing = [...new Set(refs.map((r) => r.target).filter((t) => !nodeIdByEadId.has(t)))];
      for (let i = 0; i < missing.length; i += 500) {
        const rows: Array<{ id: number; external_id: string }> = await trx('nodes')
          .whereIn('external_id', missing.slice(i, i + 500)).select('id', 'external_id');
        const byId = new Map<string, number[]>();
        for (const r of rows) byId.set(r.external_id, [...(byId.get(r.external_id) ?? []), r.id]);
        for (const [ext, ids] of byId) if (ids.length === 1) nodeIdByEadId.set(ext, ids[0]!);  // ambiguous → unresolved
      }

      const seen = new Set<string>();
      const relationRows: object[] = [];
      const unresolved: PendingValue[] = [];
      for (const r of refs) {
        const to = nodeIdByEadId.get(r.target);
        if (!to) {
          const nodeTypeId = (await trx('nodes').where({ id: r.nodeId }).first('node_type_id')).node_type_id as number;
          unresolved.push({ nodeId: r.nodeId, nodeTypeId, spec: UNRESOLVED_REF, value: r.label ? `${r.target} (${r.label})` : r.target });
          continue;
        }
        const k = `${r.nodeId}|${to}`;
        if (seen.has(k) || to === r.nodeId) continue;   // unique (type, from, to) in 004
        seen.add(k);
        relationRows.push({ relation_type_id: relationTypeId, from_node_id: r.nodeId, to_node_id: to, created_by: userId });
      }
      if (relationRows.length) await trx.batchInsert('node_relations', relationRows, 100).transacting(trx);
      relationCount = relationRows.length;

      if (unresolved.length) {
        warnings.push(`${unresolved.length} referens(er) pekar på noder som inte finns – sparade som "${UNRESOLVED_REF.label}".`);
        const rows: object[] = [];
        const n = new Map<number, number>();
        for (const u of unresolved) {
          const def = await definitionFor(u.nodeTypeId, u.spec, true);
          const i = n.get(u.nodeId) ?? 0;
          n.set(u.nodeId, i + 1);
          rows.push({ node_id: u.nodeId, property_definition_id: def.id, value_text: u.value, value_order: i, updated_by: userId });
        }
        await trx.batchInsert('node_property_values', rows, 100).transacting(trx);
      }
    }

    if (createdNodeTypes.length) {
      warnings.push(`Nya nodtyper skapades: ${createdNodeTypes.join(', ')}. Kontrollera namn och regler i administrationen.`);
    }

    // Arkivlagen: it must be possible to trace what came into the system, when and from which file
    for (const s of imported) {
      await trx('transfer_jobs').insert({
        direction: 'import', format: 'ead3', structure_id: s.id,
        file_name: input.sourceFileName?.slice(0, 255) ?? null,
        status: 'done', node_count: s.nodeCount,
        message: warnings.length ? warnings.join('\n').slice(0, 4000) : null,
        finished_at: trx.fn.now(), created_by: userId,
      });
    }

    return { structures: imported, relationCount, createdNodeTypes, warnings };
  });
}

/** A mapper property (physloc, relation, odd …) → which field it is stored in. */
function specFor(p: EadProperty): PropertySpec {
  if (p.element === 'odd') {
    // WIIT's export sets localtype to the field key; Klara's <odd> has none
    const key = p.localtype ? slug(p.localtype).slice(0, 100) : 'ovrigt';
    return { key, label: p.label || p.localtype || 'Övrigt', eadElement: null, dataType: 'longtext', isPublic: true, repeatable: false };
  }
  return ELEMENT_SPECS[p.element]
    ?? { key: slug(p.element).slice(0, 100), label: p.element, eadElement: null, dataType: 'text', isPublic: true, repeatable: false };
}
