import type { Request, Response } from 'express';
import { BaseController } from './baseController';
import type { RequestContext } from '../types/requestContext';
import { validId } from './nodeApiSupport';
import type { NodeRow } from '../models/node/nodeRow';
import type { NodeService } from '../services/nodeService';

const EDIT_GROUPS = ['administrator', 'hasPermissions'];

/** Translate archive, series, and volume HTTP requests into service workflows and HTTP responses. */
export class ArchiveController extends BaseController {

  /** BaseController provides the current user; NodeService handles archive rules and repository workflows. */
  constructor(context: RequestContext, private readonly nodeService: NodeService) { super(context); }


  /** Return archives with linked structures and nested nodes. The current endpoint returns the full tree;
   * whether it should apply publication filtering is still a product decision. */

  getTree = async (_req: Request, res: Response): Promise<void> => {
    try {
      const output = await this.nodeService.archiveTree();
      res.json(output);
    } catch (error) {
      this.error(res, error instanceof Error ? error.message : 'Could not load archive tree.');
    }
  };

  /** Create a series beneath a parent in an archive-linked inventory structure. The service resolves structure/type
   * rules and the repository saves the node with its audit record. This currently identifies a series by EAD level
   * 'series'; confirm that this matches the customer's configured node types. */

  createSeries = async (req: Request, res: Response): Promise<void> => {
    if (!this.requireEditor(res)) return;
    const archiveId = validId(req.params.archiveId);
    if (archiveId === null) { this.error(res, 'archiveId must be a positive integer.', 400); return; }
    const requestedStructureId = req.body?.structureId == null ? undefined : validId(String(req.body.structureId));
    if (req.body?.structureId != null && !requestedStructureId) { this.error(res, 'structureId must be a positive integer.', 400); return; }
    const { archive, structure, error } = await this.archiveStructure(archiveId, requestedStructureId);
    if (error) { this.error(res, error.message, error.status); return; }
    if (!archive || !structure){ this.error(res, 'Archive or archival inventory structure not found.', 404); return;}

    const typeId = await this.resolveSeriesType(req.body?.nodeTypeId);

    if(!typeId) {
      this.error(res, 'Could not determine the node type. Supply nodeTypeId if more than one matching type exists.', 400);
      return;
    }
    const parent = await this.requiredParent(req.body?.parentId, structure.id, res);
    if (parent === false) return;
    if (!(await this.isAllowedChild(parent.nodeTypeId, typeId))){
      this.error(res, 'This node type is not allowed under the selected parent.', 400); return;
    }
    const fields = nodeFields(req.body);
    if (fields.error){ this.error(res, fields.error, 400); return; }
    if (typeof fields.values.title !== 'string' || !fields.values.title.trim()) {
      this.error(res, 'name/title is required to create a series.', 400); return;
    }
    try{
      const sortOrder = fields.values.sortOrder ?? await this.nextSortOrder(structure.id, parent.id);
      const created = await this.nodeService.create({ structureId: structure.id, parentId: parent.id,
        nodeTypeId: typeId, ...fields.values, sortOrder }, structure.id, this.requestContext.user?.id ?? null);
      res.status(201).json(created);

    } catch (error) {
      this.error(res, error instanceof Error ? error.message : 'Could not create series.', 409);
    }
  };


  /** Confirm archive membership, then delete the series through the shared audited delete workflow. */

  deleteSeries = async (req: Request, res: Response): Promise<void> => {
    if(!this.requireEditor(res)) return;
    const archiveId = validId(req.params.archiveId);
    const seriesId = validId(req.params.seriesId);
    if (archiveId === null || seriesId === null) { this.error(res, 'Archive and series IDs must be positive integers.', 400); return; }
    const series = await this.findSeries(archiveId, seriesId);
    if (!series) { this.error(res, 'Series not found for this archive.', 404); return;}
    await this.deleteNodeAndRelations(seriesId, res);
  };


  /** Verify the series belongs to this archive, map supplied fields, and return the saved node. */

  updateSeries = async (req: Request, res: Response): Promise<void> => {
    if (!this.requireEditor(res)) return;
    const archiveId = validId(req.params.archiveId);
    const seriesId = validId(req.params.seriesId);
    if (archiveId === null || seriesId === null) { this.error(res, 'Archive and series IDs must be positive integers.', 400); return; }
    const series = await this.findSeries(archiveId, seriesId);
    if (!series) { this.error(res, 'Series not found for this archive.', 404); return; }
    const fields = nodeFields(req.body);
    if (fields.error) { this.error(res, fields.error, 400); return; }
    if (!Object.keys(fields.values).length) { this.error(res, 'No supported node fields were supplied.', 400); return; }
    try {
      const updated = await this.nodeService.update(seriesId, series.structureId, fields.values, this.requestContext.user?.id ?? null, series);
      res.json(updated);
    } catch (error) {
      this.error(res, error instanceof Error ? error.message : 'Could not update series.', 409);
    }
  };

  /** List direct children of a series in display order and include each child's type name.
   * This assumes every direct child is a volume; confirm whether the frontend needs a type filter. */

  getVolumes = async (req: Request, res: Response): Promise<void> => {
    const archiveId = validId(req.params.archiveId);
    const seriesId = validId(req.params.seriesId);
    if (archiveId === null || seriesId === null) { this.error(res, 'Archive and series IDs must be positive integers.', 400); return; }
    const series = await this.findSeries(archiveId, seriesId);
    if (!series) { this.error(res, 'Series not found for this archive.', 404); return; }
    try {

      const volumes = await this.nodeService.volumes(seriesId);
      res.json(volumes);
    } catch (error) {
      this.error(res, error instanceof Error ? error.message : 'Could not load volumes.');
    }
  };


  /** Create a child under a series. Allowed child types come from node_type_rules; when several are configured,
   * the caller must send nodeTypeId. Confirm that these configured child types are the intended volumes. */

  createVolume = async (req: Request, res: Response): Promise<void> => {
    if (!this.requireEditor(res)) return;
    const archiveId = validId(req.params.archiveId);
    const seriesId = validId(req.params.seriesId);
    if(archiveId === null || seriesId === null){ this.error(res, 'Archive and series IDs must be positive integers.', 400); return; }
    const series = await this.findSeries(archiveId, seriesId);
    if (!series) { this.error(res, 'Series not found for this archive.', 404); return; }
    const typeId = await this.resolveVolumeType(series.nodeTypeId, req.body?.nodeTypeId);

    if (!typeId){
      this.error(res, 'Could not determine the volume node type. Supply nodeTypeId if the series allows multiple child types.', 400);
      return;
    }
    const fields = nodeFields(req.body);
    if (fields.error) { this.error(res, fields.error, 400); return; }
    if (typeof fields.values.title !== 'string' || !fields.values.title.trim()) {
      this.error(res, 'A non-empty name/title is required to create a volume.', 400); return;
    }
    try {
      const sortOrder = fields.values.sortOrder ?? await this.nextSortOrder(series.structureId, seriesId);
      const created = await this.nodeService.create({ structureId: series.structureId, parentId: seriesId,
        nodeTypeId: typeId, ...fields.values, sortOrder }, series.structureId, this.requestContext.user?.id ?? null);
      res.status(201).json(created);

    } catch (error) {
      this.error(res, error instanceof Error ? error.message : 'Could not create volume.', 409);
    }
  };


  /** Update a volume after checking that its parent series belongs to body.archiveId. The archive ID is currently
   * required in the body; moving it into the path would require a separate frontend/API contract change. */

  updateVolume = async (req: Request, res: Response): Promise<void> => {

    if (!this.requireEditor(res)) return;
    const volumeId = validId(req.params.volumeId);

    if (volumeId === null) {this.error(res, 'volumeId must be a positive integer.', 400); return; }
    const archiveId = req.body?.archiveId == null ? null : validId(String(req.body.archiveId));

    if (archiveId === null) {this.error(res, 'archiveId must be supplied as a positive integer.', 400); return; }
    const volume = await this.findVolume(volumeId, archiveId);

    if (!volume){this.error(res, 'Volume not found.', 404); return; }
    const fields = nodeFields(req.body);

    if(fields.error) {this.error(res, fields.error, 400); return; }

    if(!Object.keys(fields.values).length) {
      this.error(res, 'No supported node fields were supplied.', 400); return; }

    try {
      const updated = await this.nodeService.update(volumeId, volume.structureId,
          fields.values, this.requestContext.user?.id ?? null, volume);
      res.json(updated);
    } catch (error) {
      this.error(res, error instanceof Error ? error.message : 'Could not update volume.', 409);
    }
  };



  /** Delete a volume beneath a series. The shared workflow audits the deletion and removes relations;
   * the database prevents deletion if the node still has children. */

  deleteVolume = async (req: Request, res: Response): Promise<void> => {
    if(!this.requireEditor(res)) return;
    const volumeId = validId(req.params.volumeId);
    if(volumeId === null) { this.error(res, 'volumeId must be a positive integer.', 400); return; }
    const volume = await this.findVolume(volumeId);
    if (!volume) { this.error(res, 'Volume not found.', 404); return; }
    await this.deleteNodeAndRelations(volumeId, res);

  };


  /** Stop the request with codes 401 or 403 unless the session user has one of the configured permissions. */

  private requireEditor(res: Response): boolean {
    if (!this.isAuthenticated()) {
      this.unauthorized(res);
      return false; }
    if (!this.isUserPrivilegeGroup(EDIT_GROUPS)){
      this.forbidden(res, 'Editing nodes requires administrator or hasPermissions.');
      return false;
    }
    return true;
  }


  /** Read a series only when it belongs to the archive named in the URL. */

  getSeries = async (req: Request, res: Response): Promise<void> => {
    const archiveId = validId(req.params.archiveId);
    const seriesId = validId(req.params.seriesId);
    if (archiveId === null || seriesId === null) { this.error(res, 'Archive and series IDs must be positive integers.', 400); return; }

    try {
      const node = await this.findSeries(archiveId, seriesId);
      if (!node) { this.error(res, 'Series not found for this archive.', 404); return; }
      res.json(node);
    } catch (error) {
      this.error(res, error instanceof Error ? error.message : 'Could not load series.');
    }
  };


  /** Find the target node and enforce the current archive/series definition. The service/repository currently use
   * EAD level "series"; if customer-defined series use otherlevel, adjust that rule there. */
  private async findSeries(archiveId: number, seriesId: number): Promise<NodeRow |undefined> {
    return this.nodeService.series(archiveId, seriesId);
  }


  /** Find a node whose parent is a series in an inventory structure, optionally checking its archive link. */

  private async findVolume(volumeId: number, archiveId?: number): Promise<NodeRow | undefined> {
    return this.nodeService.volume(volumeId, archiveId);
  }

  /** Ask the service for the eligible inventory structure. If several are linked, require structureId rather than guess.
   * Confirm whether multiple inventory structures per archive are intended. */

  private async archiveStructure(archiveId: number, requestedId: unknown): Promise<{
    archive?: Record<string, unknown>; structure?: { id: number }; error?:{ message: string; status: number };
  }> {
    const requested = requestedId === undefined || requestedId === null? undefined : validId(String(requestedId)) ?? undefined;
    if (requestedId !== undefined && requestedId !== null && !requested) return { error: { message: 'structureId must be a positive integer.', status: 400 } };
    const result = await this.nodeService.archiveAndStructure(archiveId, requested);
    if (result.error) return { error: result.error };

    return { archive: result.archive, structure: result.structure };

  }


  /** Resolve one active series type. The current rule uses EAD level "series"; confirm this matches configured types. */

  private async resolveSeriesType(requested: unknown): Promise<number| null> {
    return this.nodeService.resolveSeriesType(requested);
  }


  /** Resolve an allowed child type. Use it when unique; otherwise require nodeTypeId.
   * Confirm that every allowed child type should be treated as a volume. */

  private async resolveVolumeType(parentTypeId: number, requested: unknown): Promise<number | null> {
    return this.nodeService.resolveVolumeType(parentTypeId, requested);

  }



  /** Require a positive parent ID that belongs to the selected structure. These routes do not create root nodes. */

  private async requiredParent(value: unknown, structureId: number, res: Response): Promise<NodeRow | false>{
    if(value === undefined|| value === null) {
      this.error(res, 'parentId is required; nodes cannot be created as roots.', 400);
      return false;
    }
    const id = validId(String(value));
    if(!id){ this.error(res, 'parentId must be a positive integer.', 400); return false; }
    const parent = await this.nodeService.parent(id, structureId);
    if (!parent){
      this.error(res, 'Parent must exist in the selected structure.', 400);
      return false;

    }

    return parent;
  }


  /** Ask the service whether node_type_rules allows this parent/child type pair. */
  private async isAllowedChild(parentTypeId: number, childTypeId: number): Promise<boolean>{
    return this.nodeService.isAllowedChild(parentTypeId, childTypeId);
  }


  /** Choose the next sibling position when the frontend did not send sortOrder. */
  private async nextSortOrder(structureId: number, parentId: number | null): Promise<number> {
    return this.nodeService.nextSortOrder(structureId, parentId);
  }


  /** Run the shared audited delete workflow and return the removed row. The database blocks deletion if children remain. */

  private async deleteNodeAndRelations(id: number, res: Response): Promise<void> {
    try{
      const node = await this.nodeService.node(id);
      if(!node) { this.error(res, 'Node not found.', 404); return; }

      await this.nodeService.delete(id, node, this.requestContext.user?.id ?? null);
      res.json(node);

    } catch (error){
      this.error(res, error instanceof Error ? error.message : 'Could not delete node; Node may have children.', 409);
    }
  }

}



/** Pick the fixed node columns this API accepts and normalize title/name. Dynamic node_property_values are not handled;
 * their frontend payload shape still needs to be agreed. */

function nodeFields(body: Record<string, unknown> | undefined): { values: Record<string, unknown>; error?: string } {

/*Only fixed columns on nodes are mapped; EAV property values need a separate request contract.*/
  const input = body ?? {};
  const values: Record<string, unknown> = {};
  const fields: Record<string, string> ={
    title: 'title', name: 'title', referenceCode: 'referenceCode', previousReferenceCode: 'previousReferenceCode',
    sortOrder: 'sortOrder', validFrom: 'validFrom', validTo: 'validTo', description: 'description',
    portalUrl: 'portalUrl', isPublished: 'isPublished',
  };

  for(const [source, target] of Object.entries(fields)) {
    if(input[source] !== undefined) values[target] = input[source];

  }
  if('title' in values && (typeof values.title !== 'string' || !values.title.trim())) {
    return { values, error: 'name/title must not be empty strings.' };
  }
  if(input.date !== undefined) return { values, error: 'Use validFrom and/or validTo; the schema has no single date field.' };

  return { values };
}
