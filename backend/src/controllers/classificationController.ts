import type { Request, Response } from 'express';
import { BaseController } from './baseController';
import type { RequestContext } from '../types/requestContext';
import { validId } from './nodeApiSupport';
import type { NodeService } from '../services/nodeService';

/** Translate process HTTP requests into NodeService calls and turn their results into HTTP responses. */
export class ClassificationController extends BaseController {

  /** BaseController supplies the current user; NodeService owns classification rules and data access workflows. */
  constructor(context: RequestContext, private readonly nodeService: NodeService) { super(context); }


  /** Return every classification structure with its nodes nested into a tree. If the product later needs
   * one selected structure at a time, this route will need a structure ID or another selection rule. */

  getTree = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.nodeService.classificationTree());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load process tree.' });
    }
  };



  /** Load one classification node. Reject malformed IDs before querying; hide nodes from other structure types as not found. */

  getOne = async (req: Request, res: Response): Promise<void> => {
    const id = validId(req.params.id);
    if (id === null) { res.status(400).json({ error: 'id must be a positive integer.' }); return; }
    try {
      const node = await this.nodeService.classificationNode(id);
      if (!node) { res.status(404).json({ error: 'Process not found.' }); return; }
      res.json(node);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load process.' });
    }
  };



  /** Create a child in a classification structure. The service checks structure/type/parent rules, then the repository
   * inserts the node and audit record together. The dynamic property-value request shape is not defined here yet, so this
   * endpoint currently accepts the fixed columns on nodes only. */

  create = async(req: Request, res: Response): Promise<void> => {
    if (!this.isAuthenticated()){ this.unauthorized(res); return; }
    if (!this.isUserPrivilegeGroup(['administrator', 'hasPermissions'])) {
      this.forbidden(res, 'Editing nodes requires administrator or hasPermissions.'); return;
    }
    const body = req.body ?? {};
    const { structureId, parentId, nodeTypeId, referenceCode = null, sortOrder = 0 } = body;
    const title = body.title ?? body.name;
    if (body.date !== undefined){ res.status(400).json({ error: 'Use validFrom and/or validTo; nodes have no single date field.' }); return; }
    const structureIdNum = Number(structureId);
    const nodeTypeIdNum = Number(nodeTypeId);
    if (!Number.isSafeInteger(structureIdNum) ||!Number.isSafeInteger(nodeTypeIdNum) || typeof title !== 'string'|| !title.trim()) {
      res.status(400).json({ error: 'Expected structureId, nodeTypeId, and a non-empty title.' }); return;
    }

    // These endpoints create children only; creating a root needs a separate, explicit contract.
    const parentIdNum = validId(String(parentId ?? ''));
    if(parentIdNum === null) { res.status(400).json({ error: 'parentId is required and must identify an existing node in this structure.' }); return; }
    try {
      const created = await this.nodeService.createClassification({ structureId: structureIdNum, parentId: parentIdNum,
        nodeTypeId: nodeTypeIdNum, title, referenceCode, sortOrder, userId: this.requestContext.user?.id ?? null });
      res.status(201).json(created);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create process.';
      const invalidRequest = ['Unknown classification structure or active node type.', 'Parent must exist in the selected structure.', 'This node type is not allowed under that parent type.'].includes(message);
      res.status(invalidRequest ? 400 : 500).json({ error: message });
    }
  };



  /** Delete a classification node and return the deleted row. The repository logs the change and removes node relations
   * in one transaction; the database's parent foreign key still blocks deletion when children remain. */

  remove = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthenticated()) { this.unauthorized(res); return; }
    if (!this.isUserPrivilegeGroup(['administrator', 'hasPermissions'])) {
      this.forbidden(res, 'Editing nodes requires administrator or hasPermissions.'); return;
    }
    const id = validId(req.params.id);
    if (id === null) { res.status(400).json({ error: 'id must be a positive integer.' }); return; }
    try {
      const node = await this.nodeService.classificationNode(id);
      if (!node) { res.status(404).json({ error: 'Process not found.' }); return; }
      await this.nodeService.delete(id, node, this.requestContext.user?.id ?? null);
      res.json(node);
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : 'Could not delete process.' });
    }
  };



  /** Apply only supplied fields to a classification node, then return the saved row. The repository adds update metadata
   * and records before/after values. Both camelCase and legacy snake_case keys are accepted for compatibility. */

  update = async (req: Request, res: Response): Promise<void> => {
    if (!this.isAuthenticated()) { this.unauthorized(res); return; }
    if (!this.isUserPrivilegeGroup(['administrator', 'hasPermissions'])) {
      this.forbidden(res, 'Editing nodes requires administrator or hasPermissions.'); return;
    }
    const id = validId(req.params.id);
    if(id === null) { res.status(400).json({ error: 'id must be a positive integer.' }); return; }
    const body = req.body ?? {};
    const allowedFields: Record<string, string> = {
      title: 'title', referenceCode: 'referenceCode', previousReferenceCode: 'previousReferenceCode', sortOrder: 'sortOrder',
      isPublished: 'isPublished', validFrom: 'validFrom', validTo: 'validTo', description: 'description', portalUrl: 'portalUrl',
      reference_code: 'referenceCode', previous_reference_code: 'previousReferenceCode', sort_order: 'sortOrder',
      is_published: 'isPublished', valid_from: 'validFrom', valid_to: 'validTo', portal_url: 'portalUrl',
    };
    const changes: Record<string, unknown> = {};
    for (const [source, target] of Object.entries(allowedFields)) if (body[source] !== undefined) changes[target] = body[source];

    if (body.name !== undefined) changes.title = body.name;
    if (body.date !==undefined) { res.status(400).json({ error: 'Use validFrom and/or validTo; there is no single date field.' }); return; }
    if (!Object.keys(changes).length) { res.status(400).json({ error: 'No supported fields were supplied.' }); return; }

    try{
      const node = await this.nodeService.classificationNode(id);
      if (!node){ res.status(404).json({ error: 'Process not found.' }); return;}
      const updated = await this.nodeService.update(id, node.structureId, changes, this.requestContext.user?.id ?? null, node);
      res.json(updated);

    } catch (error){
      res.status(409).json({ error: error instanceof Error ? error.message : 'Could not update process.'});
    }
  };
}
