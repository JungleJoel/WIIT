/** Raw object produced by fast-xml-parser. */
export type ParsedEad = Record<string, unknown>;

export interface EadIssue {
  path?: string;
  message: string;
}

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

export interface EadDidNote {
  localtype: string | null;
  text: string | null;
}

export interface EadProperty {
  element: string;
  localtype: string | null;
  label: string | null;
  value: string | null;
}

export interface EadRef {
  targetEadId: string | null;
  label: string | null;
  linkRole: string | null;
}

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
  description: string | null;
  scopeContent: string | null;
  appraisal: string | null;
  accessRestrict: string | null;
  modifiedAt: Date | null;
  modifiedBy: string | null;
  validFrom: string | null;
  validTo: string | null;
  properties: EadProperty[];
  refs: EadRef[];
  children: EadNode[];
}

export interface MappedEad {
  metadata: EadMetadata;
  rootNode: EadNode | null;
}