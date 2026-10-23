export interface ArchiveCreator {
  id: number;
  parentId?: number | null;
  creatorType: 'corporate' | 'person' | 'family';
  name: string;
  startYear?: number;
  endYear?: number;
  description?: string;
  externalId?: string;
  isPublished: boolean;
}
