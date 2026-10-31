import type { Knex } from "knex";
import { CrudRepository } from "./crudRepository";
import type { Structure } from "../models/structure/structure";
import { ArchiveStructure } from "../models/archive/archiveStructure";

export class StructureRepository extends CrudRepository<Structure> {
  constructor(db: Knex) {
    super(db, "structures");
  }

  async findByType(structureType: string): Promise<Structure[]> {
    return await this.q()
      .where({ structure_type: structureType })
      .select();
  }

  async findById(id: number): Promise<Structure> {
    const [structure] = await this.q()
      .where({ id })
      .select();

    return structure;
  }

  async findLinkedToArchive(archiveId: number, structureType: string): Promise<Structure[]> {
    const structures = await this.q('archive_structures')
      .where({ archiveId })
      .andWhere({ structureType })
      .select('*')

    return structures;
  }

  async findLinksForArchives(archiveIds: number[]): Promise<ArchiveStructure[]> {
    const links = new Array<ArchiveStructure>();

    for (const archiveId in archiveIds) {
      const link = await this.q('archive_structures')
        .where({ archiveId })
        .select('*');

      links.push(link);
    }

    return links;
  }

}
