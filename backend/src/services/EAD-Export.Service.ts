import type { EadParser } from "../ead/eadParser";
import type { EadMapper } from "../ead/eadMapper";
import type { EadRepository, ImportDocumentResult } from "../repositories/ead.repository";
import type { EadIssue, EadMetadata, EadNode } from "../ead/ead.types";

export class EadImportValidationError extends Error {
  readonly issues: EadIssue[];

  constructor(issues: EadIssue[]) {
    super("EAD import validation failed.");
    this.name = "EadImportValidationError";
    this.issues = issues;
  }
}

export interface PreparedImport {
  metadata: EadMetadata;
  rootNode: EadNode | null;
  errors: EadIssue[];
  warnings: EadIssue[];
  nodeCount: number;
}

export interface PreviewResult {
  valid: boolean;
  metadata: EadMetadata;
  rootNode: EadNode | null;
  nodeCount: number;
  errors: EadIssue[];
  warnings: EadIssue[];
}

export interface ImportInput {
  xml: string;
  sourceFileName?: string | null;
  structureId?: number | null;
  structureName?: string | null;
}

export class EadImportService {
  constructor(
    private readonly parser: EadParser,
    private readonly mapper: EadMapper,
    private readonly repository: EadRepository
  ) {}

  prepare(xml: string): PreparedImport {
    const parsed = this.parser.parse(xml);
    const errors: EadIssue[] = [];
    const warnings: EadIssue[] = [];

    const mapped = this.mapper.map(parsed, errors, warnings);

    const countNodes = (node: EadNode | null): number => {
      if (!node) return 0;

      return (
        1 +
        (node.children || []).reduce(
          (total, childNode) => total + countNodes(childNode),
          0
        )
      );
    };

    return {
      ...mapped,
      errors,
      warnings,
      nodeCount: countNodes(mapped.rootNode),
    };
  }

  preview(xml: string): PreviewResult {
    const result = this.prepare(xml);

    return {
      valid: result.errors.length === 0,
      metadata: result.metadata,
      rootNode: result.rootNode,
      nodeCount: result.nodeCount,
      errors: result.errors,
      warnings: result.warnings,
    };
  }

  async import(input: ImportInput): Promise<ImportDocumentResult> {
    const result = this.prepare(input.xml);

    if (result.errors.length > 0) {
      throw new EadImportValidationError(result.errors);
    }

    const hasStructureId = input.structureId != null;
    const hasStructureName =
      typeof input.structureName === "string" &&
      input.structureName.trim().length > 0;

    if (hasStructureId === hasStructureName) {
      throw new Error("Provide exactly one of structureId or structureName.");
    }

    // The repository creates the structure INSIDE its transaction (so a failed
    // import leaves no empty structure behind) and fills version/description
    // from the classificationstructure wrapper.
    return this.repository.importDocument({
      structureId: input.structureId ?? null,
      structureName: hasStructureName ? (input.structureName as string).trim() : null,
      metadata: result.metadata,
      rootNode: result.rootNode,
      sourceFileName: input.sourceFileName,
    });
  }
}