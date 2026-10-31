/** Node row as returned to TypeScript by the configured Knex string-case mapping (camelCase). */
export interface NodeRow {
  id: number;
  structureId: number;
  parentId: number | null;
  nodeTypeId: number;
  referenceCode: string | null;
  title: string;
  sortOrder: number;
  isPublished: boolean;
  [key: string]: unknown;
}
