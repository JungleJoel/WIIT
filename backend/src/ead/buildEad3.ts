/**
 * Turns a loaded structure (see loadStructure.ts) into an EAD3 XML string.
 * Pure function: no database, no I/O – that is what makes it easy to test.
 *
 * Mapping WIIT → EAD3
 * ───────────────────────────────────────────────────────────────────────────────
 *  structures.name / code / agency_*      <control> (recordid, titleproper, maintenanceagency)
 *  structures.version                     <control><filedesc><editionstmt><edition>
 *  archives (via archive_structures)      <archdesc level="fonds">, all top nodes in <dsc>
 *  archive_creators                       <did><origination><corpname|persname|famname>
 *  archive_creators.description           <bioghist>
 *  no archive, one root node              <archdesc level="…">
 *  several roots                          <archdesc level="collection"> named after the structure
 *  child nodes                            nested <c level="…"> inside <dsc>
 *  node_types.ead_level / ead_otherlevel  @level / @otherlevel
 *  nodes.reference_code                   <did><unitid>
 *  nodes.previous_reference_code          <did><unitid localtype="tidigare_beteckning">
 *  nodes.title                            <did><unittitle>
 *  nodes.valid_from / valid_to            <did><unitdatestructured> (unless a unitdate property exists)
 *  nodes.description                      <scopecontent><p>
 *  nodes.portal_url (MAU Arkiv)           <did><dao daotype="unknown" href="…">
 *  nodes.external_id                      @id (falls back to wiit-node-<id>)
 *  property, ead_element 'did/<x>'        <did><x>value</x>
 *  property, ead_element '<block>'        <block localtype="key"><head>label</head><p>value</p></block>
 *  property, ead_element 'dao' (url)      <did><dao>
 *  property, no / unknown ead_element     <odd localtype="key"> – nothing is silently lost
 *  relation, ead_element 'physloc'        <did><physloc localtype="code">target</physloc>
 *  relation, other                        <relatedmaterial localtype="code"><p>target</p>
 *
 * @localtype always carries the WIIT key/code, so an EAD3 import can map
 * elements back to the right property or relation type (round trip).
 */

import { el, render, isNcName, type Attrs, type XmlChild, type XmlElement } from './xml';
import {
  toIsoDate,
  type ArchiveCreator, type DbDate, type LoadedStructure, type NodeRelation,
  type NodeType, type StructureRow, type TreeNode,
} from './loadStructure';

export const EAD3_NS = 'http://ead3.archivists.org/schema/';

// did children we allow from 'did/<x>' (simple text content in EAD3)
const DID_TEXT = new Set(['unitdate', 'abstract', 'physdesc', 'materialspec', 'physloc', 'unitid']);

// Block-level descriptive elements: <x><head/>?<p/>+</x>
const BLOCKS = new Set([
  'scopecontent', 'appraisal', 'accessrestrict', 'userestrict', 'arrangement',
  'bioghist', 'custodhist', 'acqinfo', 'processinfo', 'accruals', 'altformavail',
  'originalsloc', 'otherfindaid', 'relatedmaterial', 'separatedmaterial',
  'phystech', 'prefercite', 'fileplan', 'odd',
]);

export interface BuildOptions {
  /** Timestamp written to <maintenanceevent>. Fixed in tests so output is stable. */
  generatedAt?: Date;
  publicOnly?: boolean;
  generator?: string;
}

export function buildEad3(
  loaded: LoadedStructure,
  { generatedAt = new Date(), publicOnly = false, generator = 'WIIT' }: BuildOptions = {},
): string {
  const { structure, roots } = loaded;

  const control = buildControl(structure, generatedAt, generator, publicOnly);

  let archdesc: XmlElement;
  if (loaded.archive) {
    // The structure belongs to an archive: the archive is the fonds, all top nodes go below it
    const a = loaded.archive;
    archdesc = el('archdesc', { level: 'fonds' }, [
      el('did', {}, [
        a.reference_code && el('unitid', {}, a.reference_code),
        el('unittitle', {}, a.name),
        yearRange(a.start_year, a.end_year),
        a.creator && buildOrigination(a.creator),
      ]),
      a.creator && a.creator.description && block('bioghist', 'arkivbildare', a.creator.name, a.creator.description),
      a.description && block('scopecontent', null, null, a.description),
      roots.length > 0 && el('dsc', {}, roots.map(buildC)),
    ]);
  } else if (roots.length === 1) {
    // The single top node *is* the archival unit
    const root = roots[0]!;
    archdesc = el('archdesc', levelAttrs(root.type), [
      buildDid(root),
      ...buildBlocks(root),
      root.children.length > 0 && el('dsc', {}, root.children.map(buildC)),
    ]);
  } else {
    // Zero or several top nodes: the structure itself becomes the unit
    archdesc = el('archdesc', { level: 'collection' }, [
      el('did', {}, [
        el('unitid', {}, structure.code),
        el('unittitle', {}, structure.name),
        dateRange(structure.valid_from, structure.valid_to),
      ]),
      structure.description && block('scopecontent', null, null, structure.description),
      roots.length > 0 && el('dsc', {}, roots.map(buildC)),
    ]);
  }

  const doc = el('ead', { xmlns: EAD3_NS, audience: publicOnly ? 'external' : 'internal' }, [control, archdesc]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(doc)}\n`;
}

// ─── control ────────────────────────────────────────────────────────────────

function buildControl(structure: StructureRow, generatedAt: Date, generator: string, publicOnly: boolean): XmlElement {
  const agencyName = structure.agency_name || 'Malmö universitet';
  const lang = structure.language_code || 'swe';
  return el('control', {}, [
    el('recordid', {}, `${structure.agency_code || 'WIIT'}-${structure.code}`),
    el('filedesc', {}, [
      el('titlestmt', {}, [el('titleproper', {}, structure.name)]),
      structure.version && el('editionstmt', {}, [el('edition', {}, structure.version)]),
    ]),
    el('maintenancestatus', { value: 'derived' }),
    el('maintenanceagency', {}, [
      structure.agency_code && el('agencycode', {}, structure.agency_code),
      el('agencyname', {}, agencyName),
    ]),
    el('languagedeclaration', {}, [
      el('language', { langcode: lang }, lang === 'swe' ? 'svenska' : lang),
      el('script', { scriptcode: 'Latn' }, 'latinsk skrift'),
    ]),
    structure.license && el('rightsdeclaration', {}, [
      el('abbr', {}, structure.license),
      el('citation', {}, `Metadata publicerad under ${structure.license}`),
    ]),
    el('maintenancehistory', {}, [
      el('maintenanceevent', {}, [
        el('eventtype', { value: 'derived' }),
        el('eventdatetime', { standarddatetime: generatedAt.toISOString() }, generatedAt.toISOString()),
        el('agenttype', { value: 'machine' }),
        el('agent', {}, generator),
        el('eventdescription', {}, publicOnly
          ? 'Export av publicerad (offentlig) del av strukturen'
          : 'Fullständig export av strukturen, inklusive opublicerade noder'),
      ]),
    ]),
  ]);
}

// ─── components ─────────────────────────────────────────────────────────────

function buildC(node: TreeNode): XmlElement {
  return el('c', { ...levelAttrs(node.type), id: nodeId(node) }, [
    buildDid(node),
    ...buildBlocks(node),
    ...node.children.map(buildC),
  ]);
}

function levelAttrs(type: NodeType): Attrs {
  return type.ead_level === 'otherlevel'
    ? { level: 'otherlevel', otherlevel: type.ead_otherlevel || type.code }
    : { level: type.ead_level };
}

function nodeId(node: TreeNode): string {
  return isNcName(node.external_id) ? node.external_id : `wiit-node-${node.id}`;
}

function buildDid(node: TreeNode): XmlElement {
  const props = node.properties;
  const hasDateProp = props.some((p) => p.ead_element === 'did/unitdate');

  const fromProps: XmlChild[] = props
    .filter((p) => p.ead_element && p.ead_element.startsWith('did/'))
    .map((p) => {
      const tag = p.ead_element!.slice(4);
      if (!DID_TEXT.has(tag)) return null;
      // EAD3 quirk: <unitdate> is the only did child without @localtype – import maps it by element name
      return el(tag, { localtype: tag === 'unitdate' ? null : p.key, label: p.label }, p.value);
    });

  const daos: XmlChild[] = [
    node.portal_url && el('dao', { daotype: 'unknown', href: node.portal_url, linktitle: 'Visa i MAU Arkiv' }),
    ...props.filter((p) => p.ead_element === 'dao')
      .map((p) => el('dao', { daotype: 'unknown', href: p.value, linktitle: p.label, localtype: p.key })),
  ];

  const physlocs = node.relations
    .filter((r) => r.ead_element === 'physloc')
    .map((r) => el('physloc', { localtype: r.code }, describeTarget(r)));

  return el('did', {}, [
    node.reference_code && el('unitid', {}, node.reference_code),
    node.previous_reference_code && el('unitid', { localtype: 'tidigare_beteckning', label: 'Tidigare beteckning' }, node.previous_reference_code),
    el('unittitle', {}, node.title),
    !hasDateProp && dateRange(node.valid_from, node.valid_to),
    ...fromProps,
    ...physlocs,
    ...daos,
  ]);
}

function buildBlocks(node: TreeNode): XmlElement[] {
  const out: XmlElement[] = [];
  if (node.description) out.push(block('scopecontent', null, null, node.description));

  for (const p of node.properties) {
    const e = p.ead_element;
    if (e && (e.startsWith('did/') && DID_TEXT.has(e.slice(4)))) continue;  // already in <did>
    if (e === 'dao') continue;                                              // already in <did>
    const tag = e && BLOCKS.has(e) ? e : 'odd';   // unknown mapping → <odd>, never dropped
    out.push(block(tag, p.key, p.label, p.value));
  }

  for (const r of node.relations) {
    if (r.ead_element === 'physloc') continue;
    const tag = r.ead_element && BLOCKS.has(r.ead_element) ? r.ead_element : 'relatedmaterial';
    out.push(block(tag, r.code, r.name, describeTarget(r)));
  }
  return out;
}

/** <tag localtype><head>label</head><p>para</p>…</tag> – blank lines split paragraphs. */
function block(tag: string, localtype: string | null, head: string | null, text: string): XmlElement {
  const paras = String(text).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return el(tag, { localtype }, [
    head && el('head', {}, head),
    ...(paras.length ? paras : ['']).map((p) => el('p', {}, p)),
  ]);
}

function describeTarget(r: NodeRelation): string {
  const t = r.target;
  const ref = t.reference_code ? `${t.reference_code} ` : '';
  return `${t.structure_name}: ${ref}${t.title}`;
}

const CREATOR_TAG: Record<ArchiveCreator['type'], string> = {
  corporate: 'corpname',
  person: 'persname',
  family: 'famname',
};

/** Arkivbildare → <origination><corpname|persname|famname><part>name</part></…></origination> */
function buildOrigination(creator: ArchiveCreator): XmlElement {
  const tag = CREATOR_TAG[creator.type] || 'corpname';
  return el('origination', { label: 'Arkivbildare' }, [
    el(tag, {}, [el('part', {}, creator.name)]),
  ]);
}

/** Whole years (archives, creators) → <unitdatestructured> with standarddate="YYYY". */
function yearRange(from: number | null, to: number | null): XmlElement | null {
  const y = (v: number | null): string | null => (v == null ? null : String(v).padStart(4, '0'));
  return dateRange(y(from), y(to));
}

function dateRange(from: DbDate, to: DbDate): XmlElement | null {
  const f = toIsoDate(from);
  const t = toIsoDate(to);
  if (!f && !t) return null;
  return el('unitdatestructured', {}, [
    el('daterange', {}, [
      f && el('fromdate', { standarddate: f }, f),
      t && el('todate', { standarddate: t }, t),
    ]),
  ]);
}
