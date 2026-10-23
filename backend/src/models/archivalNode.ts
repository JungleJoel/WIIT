export class ArchivalNode {
  constructor(
    public readonly id: number,
    public readonly structureId: number,
    public readonly parentId: number | null,
    public readonly nodeTypeId: number,
    public title: string,
    public sortOrder: number,
    public isPublished: boolean,
    public referenceCode?: string,
    public externalId?: string,
    public description?: string,
    public properties: Record<string, string | number | boolean | Date | null> = {}
  ) {}


  public getProperty<T>(key: string): T | undefined {
    return this.properties[key] as T;
  }
}
