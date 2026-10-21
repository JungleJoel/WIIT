/**
 * Express routes for EAD3 export.
 *
 *   GET /api/structures/:id/export/ead3            → public part only (no login needed)
 *   GET /api/structures/:id/export/ead3?full=true  → everything, incl. unpublished nodes
 *                                                     and is_public = 0 fields (needs editor/admin)
 *
 * Every export is logged in transfer_jobs (Arkivlagen: traceability of what left the system).
 *
 * Usage in server.ts:
 *   import { createEadExportRouter } from './ead/exportRoute';
 *   app.use('/api', createEadExportRouter({ knex, requireRole }));
 *
 * requireRole(role) is your auth middleware (mock now, SSO/AD later). It must set req.user.id.
 */

import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import type { Knex } from 'knex';
import { loadStructure, type TreeNode } from './loadStructure';
import { buildEad3 } from './buildEad3';

/** What the auth middleware puts on req. Move this to src/middleware/auth.ts once that exists. */
export interface AuthUser {
  id: number;
}
type MaybeAuthedRequest = Request & { user?: AuthUser };

export interface EadExportDeps {
  knex: Knex;
  requireRole: (role: string) => RequestHandler;
}

type TransferStatus = 'pending' | 'running' | 'done' | 'failed';

export function createEadExportRouter({ knex, requireRole }: EadExportDeps): Router {
  const router = express.Router();

  // Decide public vs full BEFORE auth, so the public export works without login
  const chooseMode: RequestHandler = (req, res, next) => {
    if (req.query.full === 'true') return requireRole('editor')(req, res, next);
    return next();
  };

  router.get('/structures/:id/export/ead3', chooseMode, async (req: MaybeAuthedRequest, res: Response, next: NextFunction) => {
    const structureId = Number(req.params.id);
    if (!Number.isInteger(structureId) || structureId <= 0) {
      res.status(400).json({ error: 'Ogiltigt struktur-id' });
      return;
    }
    const publicOnly = req.query.full !== 'true';
    const userId = req.user?.id ?? null;

    let jobId: number | null = null;
    try {
      // Must exist before logging: transfer_jobs.structure_id is a foreign key
      const exists = await knex('structures').where({ id: structureId }).first('id');
      if (!exists) {
        res.status(404).json({ error: 'Strukturen finns inte eller är inte publicerad' });
        return;
      }

      const [job] = (await knex('transfer_jobs').insert({
        direction: 'export', format: 'ead3', structure_id: structureId,
        status: 'running', created_by: userId,
      }, ['id'])) as Array<{ id: number } | number>;
      // MSSQL/Postgres return { id }, some drivers return the bare id
      jobId = typeof job === 'object' ? job.id : (job ?? null);

      const loaded = await loadStructure(knex, structureId, { publicOnly });
      if (!loaded) {
        if (jobId != null) await finish(knex, jobId, 'failed', 0, 'Strukturen finns inte eller är inte publicerad');
        res.status(404).json({ error: 'Strukturen finns inte eller är inte publicerad' });
        return;
      }

      const xml = buildEad3(loaded, { publicOnly });
      const fileName = `${loaded.structure.code}${publicOnly ? '' : '-full'}.ead3.xml`;
      if (jobId != null) await finish(knex, jobId, 'done', countNodes(loaded.roots), null, fileName);

      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(xml);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (jobId != null) await finish(knex, jobId, 'failed', null, message.slice(0, 4000)).catch(() => {});
      next(err);
    }
  });

  return router;
}

function finish(
  knex: Knex,
  id: number,
  status: TransferStatus,
  nodeCount: number | null,
  message: string | null,
  fileName?: string,
): Promise<number> {
  return knex('transfer_jobs').where({ id }).update({
    status, node_count: nodeCount, message, file_name: fileName ?? null, finished_at: knex.fn.now(),
  });
}

export function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}
