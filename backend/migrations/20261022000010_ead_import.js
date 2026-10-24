/**
 * 010 – node types that are told apart by a description, not only by @otherlevel.
 *
 * NF5: Klara exports Verksamhetsområde, Processgrupp and Process with the same level:
 *
 *   <c level="otherlevel" otherlevel="structuralunit">
 *     <did><didnote localtype="structuralunitdescription">Processgrupp</didnote>
 *
 * so @otherlevel alone cannot identify the node type on import, and the export must write
 * the <didnote> back to keep the file readable by Klara.
 *
 * 1. node_types.ead_unit_description holds that text. It is a property of the node TYPE
 *    (every Process says "Process"), so it is stored once on node_types and not on every node.
 *
 * 2. The unique index from 008 (one node type per @otherlevel and structure type) is widened
 *    to include the description. Otherwise the three types could not exist side by side.
 *
 * 3. Databases that were seeded before this migration have the three types as level 'class'.
 *    They are updated to otherlevel 'structuralunit'. A new database gets the same values from
 *    seeds/01_demo.js, because seeds run after migrations.
 */

const STRUCTURAL_UNITS = [
  { code: 'verksamhetsomrade', description: 'Verksamhetsområde' },
  { code: 'processgrupp', description: 'Processgrupp' },
  { code: 'process', description: 'Process' },
];

exports.up = async function (knex) {
  // 1
  await knex.schema.alterTable('node_types', (t) => {
    t.string('ead_unit_description', 100);
  });

  // 2
  await knex.raw('DROP INDEX uq_node_types_otherlevel ON node_types');
  await knex.raw(`
    CREATE UNIQUE INDEX uq_node_types_otherlevel_unit
      ON node_types (structure_type, ead_otherlevel, ead_unit_description)
      WHERE ead_otherlevel IS NOT NULL
  `);

  // 3 – only rows that still have the seed values from before 010 are touched
  for (const { code, description } of STRUCTURAL_UNITS) {
    await knex('node_types')
      .where({ code, ead_level: 'class' })
      .update({ ead_level: 'otherlevel', ead_otherlevel: 'structuralunit', ead_unit_description: description });
  }
};

exports.down = async function (knex) {
  // 3
  await knex('node_types')
    .whereIn('code', STRUCTURAL_UNITS.map((s) => s.code))
    .where({ ead_otherlevel: 'structuralunit' })
    .update({ ead_level: 'class', ead_otherlevel: null, ead_unit_description: null });

  // 2 – fails if an import has created more structuralunit types (an unknown description),
  // because the narrower index allows only one per structure type. Remove those types first.
  await knex.raw('DROP INDEX uq_node_types_otherlevel_unit ON node_types');
  await knex.raw(`
    CREATE UNIQUE INDEX uq_node_types_otherlevel
      ON node_types (structure_type, ead_otherlevel) WHERE ead_otherlevel IS NOT NULL
  `);

  // 1
  await knex.schema.alterTable('node_types', (t) => {
    t.dropColumn('ead_unit_description');
  });
};
