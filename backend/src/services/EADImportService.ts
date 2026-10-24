/**
 * NF5: EAD import in three steps – parse (eadParser.ts), map (eadMapper.ts), then either a
 * preview or writing to the database (eadImport.ts). Preview and import share the first two
 * steps, so the preview shows exactly what the import would do.
 */

import type { Knex } from 'knex';
import { EadParser } from '../ead/eadParser';
import { EadMapper } from '../ead/eadMapper';
import { importEad, findTrees, type ImportResult, type StructureType } from '../ead/eadImport';
import type { EadIssue, EadMetadata, EadNode, ParsedEad } from '../ead/ead.types';

/** The file cannot be imported (bad XML, no EAD root, a node without title …). The route answers 400. */
export class EadImportValidationError extends Error {
  constructor(readonly issues: EadIssue[]) {
    super('EAD-filen kunde inte importeras.');
    this.name = 'EadImportValidationError';
  }
}

export interface PreviewResult {
  valid: boolean;
  metadata: EadMetadata;
  /** The structures the import would create, with node counts. */
  trees: Array<{ name: string; structureType: StructureType; nodeCount: number }>;
  nodeCount: number;
  errors: EadIssue[];
  warnings: EadIssue[];
}

export interface ImportOptions {
  sourceFileName?: string | null;
  structureName?: string | null;
  structureType?: StructureType;
  archiveId?: number | null;
  userId?: number | null;
}

const count = (n: EadNode): number => 1 + n.children.reduce((s, c) => s + count(c), 0);

/** Entry point for the EAD import, used by importRoute.ts. */
export class EadImportService {
  constructor(
    private readonly knex: Knex,
    private readonly parser = new EadParser(),
    private readonly mapper = new EadMapper(),
  ) {}

  private prepare(xml: string): { metadata: EadMetadata; rootNode: EadNode | null; errors: EadIssue[]; warnings: EadIssue[] } {
    let parsed: ParsedEad;
    try {
      parsed = this.parser.parse(xml);
    } catch (err) {
      throw new EadImportValidationError([{ message: err instanceof Error ? err.message : String(err) }]);
    }
    const errors: EadIssue[] = [];
    const warnings: EadIssue[] = [];
    const mapped = this.mapper.map(parsed, errors, warnings);
    return { ...mapped, errors, warnings };
  }

  /**
   * Reads a file and reports which structures and how many nodes an import would create,
   * so the user can check the file before anything is written.
   *
   * @throws EadImportValidationError if the file is not well-formed EAD.
   */
  preview(xml: string, structureType: StructureType = 'klassificering'): PreviewResult {
    const { metadata, rootNode, errors, warnings } = this.prepare(xml);
    const treeWarnings: string[] = [];
    const trees = rootNode ? findTrees(rootNode, structureType, treeWarnings) : [];
    const sizes = trees.map((t) => t.topNodes.reduce((s, n) => s + count(n), 0));
    return {
      valid: errors.length === 0 && rootNode !== null,
      metadata,
      trees: trees.map((t, i) => ({
        name: t.wrapper?.name || metadata.titleProper || 'Importerad struktur',
        structureType: t.structureType,
        nodeCount: sizes[i]!,
      })),
      nodeCount: sizes.reduce((a, b) => a + b, 0),
      errors,
      warnings: [...warnings, ...treeWarnings.map((message) => ({ message }))],
    };
  }

  /**
   * Reads a file and imports it. Warnings from reading and from writing are returned together.
   *
   * @throws EadImportValidationError if the file is not well-formed EAD or the mapper found errors.
   * @throws EadImportConflictError if the file has already been imported.
   */
  async import(xml: string, options: ImportOptions = {}): Promise<ImportResult> {
    const { metadata, rootNode, errors, warnings } = this.prepare(xml);
    if (errors.length > 0 || !rootNode) throw new EadImportValidationError(errors);

    const result = await importEad(this.knex, { metadata, rootNode, ...options });
    return { ...result, warnings: [...warnings.map((w) => w.message), ...result.warnings] };
  }
}
