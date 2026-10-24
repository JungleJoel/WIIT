/**
 * NF5: Express routes for EAD import.
 *
 *   POST /api/import/ead/preview   file=<xml>                       → what would be imported, writes nothing
 *   POST /api/import/ead           file=<xml> [structureName]
 *                                  [structureType] [archiveId]      → 201 + created structures
 *
 * F5.3: both need the editor role, since an import adds archive data.
 * Arkivlagen: every attempt is logged in transfer_jobs – a successful one inside the import
 * transaction (eadImport.ts), a failed one here, because the transaction has been rolled back.
 *
 * Usage in server.ts:
 *   app.use('/api', createEadImportRouter({ knex, requireRole }));
 */

import path from 'node:path';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import multer from 'multer';
import type { Knex } from 'knex';
import { EadImportService, EadImportValidationError } from '../services/EADImportService';
import { EadImportConflictError, type StructureType } from './eadImport';
import type { AuthUser } from './exportRoute';

type MaybeAuthedRequest = Request & { user?: AuthUser };

export interface EadImportDeps {
  knex: Knex;
  requireRole: (role: string) => RequestHandler;
}

const STRUCTURE_TYPES: StructureType[] = ['klassificering', 'arkivforteckning', 'forvaring'];

// D3: the file is read into memory, so its size is limited
const MAX_IMPORT_FILE_SIZE = 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xml|ead|ead3)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Bara .xml-, .ead- och .ead3-filer tas emot.'));
  },
});

/**
 * Creates the import routes. Parse errors answer 400, an already imported file 409; other
 * errors are passed to the error middleware.
 */
export function createEadImportRouter({ knex, requireRole }: EadImportDeps): Router {
  const router = express.Router();
  const service = new EadImportService(knex);

  const readFile = (req: Request, res: Response): string | null => {
    if (!req.file) {
      res.status(400).json({ error: 'Ladda upp en EAD-fil i fältet "file".' });
      return null;
    }
    return req.file.buffer.toString('utf8');
  };

  const structureTypeOf = (req: Request): StructureType | undefined => {
    const t = req.body?.structureType;
    return STRUCTURE_TYPES.includes(t) ? t : undefined;
  };

  router.post('/import/ead/preview', requireRole('editor'), upload.single('file'), (req, res) => {
    const xml = readFile(req, res);
    if (xml === null) return;
    try {
      res.json(service.preview(xml, structureTypeOf(req)));
    } catch (err) {
      if (err instanceof EadImportValidationError) res.status(400).json({ error: err.message, issues: err.issues });
      else throw err;
    }
  });

  router.post('/import/ead', requireRole('editor'), upload.single('file'),
    async (req: MaybeAuthedRequest, res: Response, next: NextFunction) => {
      const xml = readFile(req, res);
      if (xml === null) return;
      const fileName = path.basename(req.file!.originalname);
      const userId = req.user?.id ?? null;
      const archiveId = Number(req.body?.archiveId) || null;

      try {
        const result = await service.import(xml, {
          sourceFileName: fileName,
          structureName: typeof req.body?.structureName === 'string' ? req.body.structureName.trim() || null : null,
          structureType: structureTypeOf(req),
          archiveId,
          userId,
        });
        res.status(201).json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Logged outside the transaction, which has been rolled back
        await knex('transfer_jobs').insert({
          direction: 'import', format: 'ead3', file_name: fileName, status: 'failed',
          message: message.slice(0, 4000), finished_at: knex.fn.now(), created_by: userId,
        }).catch(() => {});

        if (err instanceof EadImportValidationError) {
          res.status(400).json({ error: err.message, issues: err.issues });
        } else if (err instanceof EadImportConflictError) {
          res.status(409).json({ error: err.message });
        } else {
          next(err);
        }
      }
    });

  return router;
}
