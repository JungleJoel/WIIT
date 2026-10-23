export interface Structure {
  id: number;
  code: string;
  name: string;
  structureType: string;
  description?: string;
  validFrom?: Date;
  validTo?: Date;
  isPublished: boolean;
  version?: string;
  agencyCode?: string;
  agencyName?: string;
  languageCode: string;
}
