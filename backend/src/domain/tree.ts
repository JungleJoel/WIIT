export function toTree<T extends { id: number; parentId: number | null; sortOrder: number }>(rows: T[]): Array<T & { children: ... }>;
export function wouldCreateCycle(nodeId: number, newParentId: number, ancestorIdsOfNewParent: number[]): boolean;  // F6.1.1
