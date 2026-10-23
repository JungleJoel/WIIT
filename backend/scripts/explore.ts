import 'dotenv/config';
import knexLib, { Knex } from 'knex';
import knexConfig from '../knexfile';

const knex: Knex = knexLib(knexConfig.development);

interface ExploreRow {
  id: number;
  title: string;
  parent: string | null;
  type: string;
  ead_level: string;
  tree: string;
}

(async (): Promise<void> => {
  const rows = await knex.raw<ExploreRow[]>(`
    SELECT
      n.id,
      n.title,
      p.title  AS parent,
      t.name   AS type,
      t.ead_level,
      s.name   AS tree
    FROM nodes n
      JOIN node_types t ON t.id = n.node_type_id
      JOIN structures s ON s.id = n.structure_id
      LEFT JOIN nodes p ON p.id = n.parent_id
    ORDER BY n.id
  `);
  console.table(rows);
  await knex.destroy();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
