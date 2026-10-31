/** Helpers shared by the classification and archive request handlers; no database calls here!! */
import type { NodeRow } from '../models/node/nodeRow';
export type { NodeRow } from '../models/node/nodeRow';


/** Turn flat node rows into a display tree. Parentless rows become roots; other rows attach to their parent,
 * and each sibling list is sorted by sortOrder then ID. */

export function toTree(rows: NodeRow[]): Array<NodeRow & { children: NodeRow[] }>{
  const indexed = new Map<number, NodeRow & { children: NodeRow[] }>();
  for(const row of rows) indexed.set(row.id, { ...row, children: [] });
  const roots: Array<NodeRow & { children: NodeRow[] }> = [];
  for(const node of indexed.values()) {

    // Keep accepting snake_case rows too, so older callers can use this helper during a staged migration (?)
    const parentId = node.parentId ?? (node as any).parent_id;
    if (parentId == null) roots.push(node);
    else indexed.get(parentId)?.children.push(node);
  }
  const order = (a: NodeRow, b: NodeRow) =>
      a.sortOrder - b.sortOrder || a.id - b.id;
  const sort = (nodes: Array<NodeRow &{ children: NodeRow[] }>): void => {
    nodes.sort(order);
    nodes.forEach((node) =>
        sort(node.children as Array<NodeRow & { children: NodeRow[] }>));
  };
  sort(roots);

  return roots;
}


/** Parse one positive integer route parameter. Arrays, zero, negatives, and non-numeric values are rejected. */

export function validId(value: string| string[]): number| null{
  if (Array.isArray(value)){
    if (value.length !== 1) return null;
    value = value[0];}
  const id = Number(value);

  return Number.isSafeInteger(id) && id >0 ? id : null;
}
