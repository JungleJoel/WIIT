/**
 * 008 – fixes found when comparing the schema with the real EAD exports from
 *       Arkivfunktionen (KS_IHP.ead3 from Klara, GV.ead / LS.ead in RA-EAD).
 *
 * 1. Reference codes unique per PARENT, not per structure.
 *    Klara: all 175 record groups have unitid "HS", and HT1, HT2 … repeat under
 *    every group. RA-EAD: volumes are numbered 1, 2, 3 … in every series.
 *
 * 2. structure_types lookup table instead of a hard-coded CHECK.
 *    Klara's second tree holds Verksamhetssystem and two arkivförteckningar,
 *    which do not fit the three fixed values. The client wants to add types
 *    themselves (modularity), so a new type is a row, not a migration.
 *    The column names stay the same, so no code has to change.
 *
 * 3. transfer_jobs.format: 'ra-fs' is a regulation, not a file format.
 *    Replaced by 'ra-ead' (Riksarkivet's EAD 2002 variant used in GV/LS).
 *
 * 4. structures.external_id – re-importing the same Klara file must update
 *    the structure, not create a duplicate (NF5). Also used to find the
 *    target tree of cross-tree relations (<ref target="UN…">).
 *
 * 5. node_types: one EAD @otherlevel value maps to exactly one node type per
 *    structure type, so the importer can find the type without guessing.
 *
 * 6. Repeatable properties: a node can have several values of the same field
 *    (e.g. several <relation href>). value_order keeps them in order.
 *
 * 7. nodes.source_updated_at / source_updated_by – change info from the source
 *    system (Klara <unitid localtype="modified"/"modifiedby">). The person is
 *    a Klara user, not a WIIT user, so it is stored as text.
 *
 * 8. Indexes on foreign keys – SQL Server does not create them automatically.
 */

const STRUCTURE_TYPES = [
  { code: 'klassificering', name: 'Klassificeringsstruktur' },
  { code: 'arkivforteckning', name: 'Arkivförteckning' },
  { code: 'forvaring', name: 'Förvaring' },
];

exports.up = async function (knex) {
  // 1. Reference codes unique per parent (F6.1)
  await knex.raw('DROP INDEX uq_nodes_structure_reference_code ON nodes');
  await knex.raw(`
    CREATE UNIQUE INDEX uq_nodes_parent_reference_code
      ON nodes (structure_id, parent_id, reference_code)
      WHERE reference_code IS NOT NULL
  `);

  // 2. structure_types lookup table (F1)
  await knex.schema.createTable('structure_types', (t) => {
    t.string('code', 20).primary();
    t.string('name', 255).notNullable();
    t.text('description');
    t.boolean('is_active').notNullable().defaultTo(true);
  });
  await knex('structure_types').insert(STRUCTURE_TYPES);

  await knex.raw('ALTER TABLE structures DROP CONSTRAINT ck_structures_type');
  await knex.raw('ALTER TABLE node_types DROP CONSTRAINT ck_node_types_structure_type');
  await knex.schema.alterTable('structures', (t) => {
    t.foreign('structure_type', 'fk_structures_structure_type')
      .references('code').inTable('structure_types').onDelete('NO ACTION');
  });
  await knex.schema.alterTable('node_types', (t) => {
    t.foreign('structure_type', 'fk_node_types_structure_type')
      .references('code').inTable('structure_types').onDelete('NO ACTION');
  });

  // 3. transfer_jobs.format (NF5, NF6)
  await knex.raw('ALTER TABLE transfer_jobs DROP CONSTRAINT ck_transfer_jobs_format');
  await knex('transfer_jobs').where({ format: 'ra-fs' }).update({ format: 'ra-ead' });
  await knex.raw(`
    ALTER TABLE transfer_jobs ADD CONSTRAINT ck_transfer_jobs_format
      CHECK (format IN ('ead3', 'fgs', 'ra-ead'))
  `);

  // 4. structures.external_id (NF5)
  await knex.schema.alterTable('structures', (t) => {
    t.string('external_id', 255);                       // EAD <recordid> / Klara classificationstructure id
  });
  await knex.raw(`
    CREATE UNIQUE INDEX uq_structures_external_id
      ON structures (external_id) WHERE external_id IS NOT NULL
  `);

  // 5. One node type per @otherlevel value and structure type
  await knex.raw(`
    CREATE UNIQUE INDEX uq_node_types_otherlevel
      ON node_types (structure_type, ead_otherlevel) WHERE ead_otherlevel IS NOT NULL
  `);

  // 6. Repeatable properties (F3.6)
  await knex.schema.alterTable('property_definitions', (t) => {
    t.boolean('is_repeatable').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('node_property_values', (t) => {
    t.integer('value_order').notNullable().defaultTo(0);
  });
  await knex.raw('ALTER TABLE node_property_values DROP CONSTRAINT uq_node_property_values_node_def');
  await knex.schema.alterTable('node_property_values', (t) => {
    t.unique(['node_id', 'property_definition_id', 'value_order'],
      { indexName: 'uq_node_property_values_node_def_order', useConstraint: true });
  });

  // 7. Change info from the source system
  await knex.schema.alterTable('nodes', (t) => {
    t.datetime('source_updated_at');
    t.string('source_updated_by', 255);
  });

  // 8. Indexes on foreign keys
  await knex.schema.alterTable('nodes', (t) => {
    t.index(['node_type_id'], 'ix_nodes_node_type');
  });
  await knex.schema.alterTable('node_relations', (t) => {
    t.index(['from_node_id'], 'ix_node_relations_from');
  });
  await knex.schema.alterTable('node_property_values', (t) => {
    t.index(['property_definition_id'], 'ix_node_property_values_definition');
  });
  await knex.schema.alterTable('property_definitions', (t) => {
    t.index(['node_type_id'], 'ix_property_definitions_node_type');
  });
};

exports.down = async function (knex) {
  // 8
  await knex.schema.alterTable('property_definitions', (t) => {
    t.dropIndex(['node_type_id'], 'ix_property_definitions_node_type');
  });
  await knex.schema.alterTable('node_property_values', (t) => {
    t.dropIndex(['property_definition_id'], 'ix_node_property_values_definition');
  });
  await knex.schema.alterTable('node_relations', (t) => {
    t.dropIndex(['from_node_id'], 'ix_node_relations_from');
  });
  await knex.schema.alterTable('nodes', (t) => {
    t.dropIndex(['node_type_id'], 'ix_nodes_node_type');
  });

  // 7
  await knex.schema.alterTable('nodes', (t) => {
    t.dropColumn('source_updated_by');
    t.dropColumn('source_updated_at');
  });

  // 6 – extra values of a repeated field cannot be kept in the old model
  await knex('node_property_values').where('value_order', '>', 0).del();
  await knex.raw('ALTER TABLE node_property_values DROP CONSTRAINT uq_node_property_values_node_def_order');
  await knex.schema.alterTable('node_property_values', (t) => {
    t.unique(['node_id', 'property_definition_id'],
      { indexName: 'uq_node_property_values_node_def', useConstraint: true });
  });
  await knex.schema.alterTable('node_property_values', (t) => {
    t.dropColumn('value_order');
  });
  await knex.schema.alterTable('property_definitions', (t) => {
    t.dropColumn('is_repeatable');
  });

  // 5
  await knex.raw('DROP INDEX uq_node_types_otherlevel ON node_types');

  // 4
  await knex.raw('DROP INDEX uq_structures_external_id ON structures');
  await knex.schema.alterTable('structures', (t) => {
    t.dropColumn('external_id');
  });

  // 3
  await knex.raw('ALTER TABLE transfer_jobs DROP CONSTRAINT ck_transfer_jobs_format');
  await knex('transfer_jobs').where({ format: 'ra-ead' }).update({ format: 'ra-fs' });
  await knex.raw(`
    ALTER TABLE transfer_jobs ADD CONSTRAINT ck_transfer_jobs_format
      CHECK (format IN ('ead3', 'fgs', 'ra-fs'))
  `);

  // 2 – only the three original types can go back into a CHECK
  await knex.schema.alterTable('node_types', (t) => {
    t.dropForeign('structure_type', 'fk_node_types_structure_type');
  });
  await knex.schema.alterTable('structures', (t) => {
    t.dropForeign('structure_type', 'fk_structures_structure_type');
  });
  await knex.raw(`ALTER TABLE structures ADD CONSTRAINT ck_structures_type
                  CHECK (structure_type IN ('klassificering','arkivforteckning','forvaring'))`);
  await knex.raw(`ALTER TABLE node_types ADD CONSTRAINT ck_node_types_structure_type
                  CHECK (structure_type IN ('klassificering','arkivforteckning','forvaring'))`);
  await knex.schema.dropTableIfExists('structure_types');

  // 1 – fails if the same code now exists under two parents; fix the data first
  await knex.raw('DROP INDEX uq_nodes_parent_reference_code ON nodes');
  await knex.raw(`
    CREATE UNIQUE INDEX uq_nodes_structure_reference_code
      ON nodes (structure_id, reference_code)
      WHERE reference_code IS NOT NULL
  `);
};
