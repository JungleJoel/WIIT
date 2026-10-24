/**
 * Types shared by the EAD import: eadParser.ts → eadMapper.ts → eadImport.ts.
 * They describe the file as read, before anything is written to the database.
 */

/** Raw object produced by fast-xml-parser. */
export type ParsedEad = Record<string, unknown>;

/** A problem found while reading a file. path is an XPath-like location, e.g. /ead/archdesc. */
export interface EadIssue {
  path?: string;
  message: string;
}

/** The document-level information in <control>. */
export interface EadMetadata {
  recordId: string | null;
  titleProper: string | null;
  edition: string | null;
  agencyName: string | null;
  countryCode: string | null;
  languageCode: string | null;
  scriptCode: string | null;
  publicationStatus: string | null;
  eadVersion: string;
}

/** One <didnote>. Klara uses localtype="structuralunitdescription" to name the level. */
export interface EadDidNote {
  localtype: string | null;
  text: string | null;
}

/** An element that has no field of its own on EadNode (physloc, legalstatus, relation, odd …). */
export interface EadProperty {
  element: string;
  localtype: string | null;
  label: string | null;
  value: string | null;
}

/** One <ref> inside <unitid localtype="relations">: a link to another <c> by its @id. */
export interface EadRef {
  targetEadId: string | null;
  label: string | null;
  linkRole: string | null;
}

/** <archdesc> or one <c>, with its children. */
export interface EadNode {
  nodeType: "ead_root" | "ead_component";
  name: string;
  unitid: string | null;
  unitidLabel: string | null;
  eadId: string | null;
  level: string | null;
  otherlevel: string | null;
  structuralUnitDescription: string | null;
  didNotes: EadDidNote[];
  audience: string | null;
  /** Text of <abstract>. The description shown to users is scopeContent. */
  description: string | null;
  /** Text of <scopecontent>; Klara's escaped <br/> has been turned into line breaks. */
  scopeContent: string | null;
  appraisal: string | null;
  /** Text of <accessrestrict>, also when Klara wraps it in a nested <archdesc>. */
  accessRestrict: string | null;
  modifiedAt: Date | null;
  modifiedBy: string | null;
  /** From <unitdatestructured><daterange>; only full YYYY-MM-DD dates. */
  validFrom: string | null;
  validTo: string | null;
  properties: EadProperty[];
  refs: EadRef[];
  children: EadNode[];
}

/** Result of EadMapper.map: the metadata and the <archdesc> tree. */
export interface MappedEad {
  metadata: EadMetadata;
  rootNode: EadNode | null;
}