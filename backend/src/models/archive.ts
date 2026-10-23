export interface Archive {
  id: number;
  archiveCreatorId: number;
  referenceCode?: string;
  name: string;
  startYear?: number;
  endYear?: number;
  description?: string;
  externalId?: string;
  isPublished: boolean;
}
