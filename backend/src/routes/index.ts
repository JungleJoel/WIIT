import type { NextFunction, Request, Response, RequestHandler } from 'express';
import type { Knex } from 'knex';
import { ArchiveController } from '../controllers/archiveController';
import { ClassificationController } from '../controllers/classificationController';
import { RequestContext } from '../types/requestContext';
import { NodeRepository } from '../repos/nodeRepository';
import { NodeService } from '../services/nodeService';

/** Registers the HTTP API and connects each route to its controller and shared node workflow. */
export class Index {

  /** Keep Knex here only long enough to build the repository. Controllers never receive this connection. */
  constructor(private readonly db: Knex) {}

  /** Register these API routes. The service and repository are shared; each request gets a fresh controller. */
  setRoutes(app: any): void {


    /** Bind a classification operation to a request-scoped controller. */
    const nodeService= new NodeService(new NodeRepository(this.db));
    const classification = (method: 'getTree' | 'getOne'| 'create' | 'remove'| 'update'):
        RequestHandler =>
      this.controllerHandler((context, req, res) =>
          new ClassificationController(context, nodeService)[method](req, res));


    /** Bind archive-tree, series lookup, and series-creation routes. */
    const archive = (method: 'getTree' | 'getSeries' | 'createSeries'):
        RequestHandler =>
      this.controllerHandler((context, req, res) =>
          new ArchiveController(context, nodeService)[method](req, res));


    /** Bind the remaining archive item and volume routes. */
    const archiveItem = (method: 'deleteSeries' | 'updateSeries'| 'getVolumes'| 'createVolume' | 'updateVolume'| 'deleteVolume'):
        RequestHandler =>
      this.controllerHandler((context, req, res) =>
          new ArchiveController(context, nodeService)[method](req, res));


    /** Return a short response so local tooling can confirm the server is listening. */

    app.get('/', (_req: Request, res: Response) => res.send('Servern körs!'));

    app.get('/api/processes/tree', classification('getTree'));
    app.get('/api/processes/:id', classification('getOne'));
    app.post('/api/processes', classification('create'));
    app.delete('/api/processes/:id', classification('remove'));

    app.put('/api/processes/:id',classification('update'));
    app.get('/api/archives/tree', archive('getTree'));
    app.get('/api/archives/:archiveId/series/:seriesId', archive('getSeries'));

    app.post('/api/archives/:archiveId/series', archive('createSeries'));
    app.delete('/api/archives/:archiveId/series/:seriesId', archiveItem('deleteSeries'));
    app.put('/api/archives/:archiveId/series/:seriesId',archiveItem('updateSeries'));
    app.get('/api/archives/:archiveId/series/:seriesId/volumes', archiveItem('getVolumes'));
    app.post('/api/archives/:archiveId/series/:seriesId/volumes', archiveItem('createVolume'));
    app.put('/api/archives/volumes/:volumeId', archiveItem('updateVolume'));
    app.delete('/api/archives/volumes/:volumeId', archiveItem('deleteVolume'));
  }


  /** Add request identity, run the controller, and pass unexpected async failures to Express error handling. */

  private controllerHandler(
    action: (context: RequestContext, req: Request, res: Response) => Promise<void>,
  ): RequestHandler {

    return (req: Request, res: Response, next: NextFunction): void => {
      // RequestContext contains the user attached by session/authentication middleware.
      void action(new RequestContext(req), req, res).catch(next);
    };
  }
}
