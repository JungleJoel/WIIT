/**
 * 007 – combined model: archive concepts (Lilas' proposal) on top of the generic trees.
 *
 * From Lilas' model
 *   archive_creators     Arkivbildare, can be nested (a faculty under the university).
 *                        Exported as EAD3 <origination>, later EAC-CPF.
 *   archives             Arkiv – one per creator (or more). Becomes EAD3 <archdesc level="fonds">.
 *   archive_structures   Which structures an archive uses, and WHEN
 *                        (was archive_classification_structures; now works for every
 *                        structure type, not only classification).
 *   'arkivforteckning'   Third structure type: Serie → Volym lives in its own tree,
 *                        separate from the klassificeringsstruktur (process tree).
 *   structures.version / previous_structure_id
 *                        "Klassificeringsstruktur 2021" replaces "… 2015" – kept as a link,
 *                        not just a text name, so the history can be followed.
 *   nodes.previous_reference_code
 *                        Old beteckning when a node is renumbered.
 *
 * Kept from the generic model (unchanged)
 *   nodes / node_types / property_definitions  – the client manages levels and fields as rows
 *   node_relations                             – serie "förvaras i" kartong, serie "redovisas under" process
 *   is_published / is_public, ad_group_roles, change_log, transfer_jobs
 */

const STRUCTURE_TYPES = "('klassificering','arkivforteckning','forvaring')";

exports.up = async function (knex) {

  // 1. Three structure types. 'struktur' is renamed to 'klassificering'

  await knex.raw('ALTER TABLE structures DROP CONSTRAINT ck_structures_type');
  await knex.raw('ALTER TABLE node_types DROP CONSTRAINT ck_node_types_structure_type');
  await knex('structures').where({ structure_type: 'struktur' }).update({ structure_type: 'klassificering' });
  await knex('node_types').where({ structure_type: 'struktur' }).update({ structure_type: 'klassificering' });
  await knex.raw(`ALTER TABLE structures ADD CONSTRAINT ck_structures_type
                  CHECK (structure_type IN ${STRUCTURE_TYPES})`);
  await knex.raw(`ALTER TABLE node_types ADD CONSTRAINT ck_node_types_structure_type
                  CHECK (structure_type IN ${STRUCTURE_TYPES})`);


  // 2. Versions of a structure

  await knex.schema.alterTable('structures', (t) => {
    t.string('version', 50);                                // '2021', '2.0'
    t.integer('previous_structure_id')                      // the structure this one replaces
      .references('id').inTable('structures').onDelete('NO ACTION');
  });


  await knex.schema.alterTable('nodes', (t) => {
    t.string('previous_reference_code', 100);
  });


  // 3. archive_creators – arkivbildare
  await knex.schema.createTable('archive_creators', (t) => {
    t.increments('id').primary();
    t.integer('parent_id');                                 // NULL = top level
    t.string('creator_type', 20).notNullable().defaultTo('corporate');
    t.string('name', 500).notNullable();
    t.integer('start_year');
    t.integer('end_year');
    t.text('description');                                  // history → EAD3 <bioghist> / EAC-CPF
    t.string('external_id', 255);                           // authority id, e.g. EAC-CPF recordId
    t.boolean('is_published').notNullable().defaultTo(false);
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').references('id').inTable('users');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    t.integer('updated_by').references('id').inTable('users');

    t.check("?? IN ('corporate','person','family')", ['creator_type'], 'ck_archive_creators_type');
    t.check('?? IS NULL OR ?? IS NULL OR ?? <= ??',
      ['start_year', 'end_year', 'start_year', 'end_year'], 'ck_archive_creators_years');
  });
  await knex.schema.alterTable('archive_creators', (t) => {
    // NO ACTION: a creator with sub-creators cannot be deleted (same rule as nodes)
    t.foreign('parent_id', 'fk_archive_creators_parent')
      .references('id').inTable('archive_creators').onDelete('NO ACTION');
  });
  await knex.raw(`
    CREATE UNIQUE INDEX uq_archive_creators_external_id
      ON archive_creators (external_id) WHERE external_id IS NOT NULL
  `);


  // 4. archives – arkiv
  await knex.schema.createTable('archives', (t) => {
    t.increments('id').primary();
    t.integer('archive_creator_id').notNullable()
      .references('id').inTable('archive_creators').onDelete('NO ACTION');
    t.string('reference_code', 100);                        // arkivnummer / referenskod
    t.string('name', 500).notNullable();
    t.integer('start_year');
    t.integer('end_year');
    t.text('description');
    t.string('external_id', 255);                           // EAD <eadid>/recordid on re-import
    t.boolean('is_published').notNullable().defaultTo(false);
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').references('id').inTable('users');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    t.integer('updated_by').references('id').inTable('users');

    t.check('?? IS NULL OR ?? IS NULL OR ?? <= ??',
      ['start_year', 'end_year', 'start_year', 'end_year'], 'ck_archives_years');
    t.index(['archive_creator_id'], 'ix_archives_creator');
  });
  await knex.raw(`
    CREATE UNIQUE INDEX uq_archives_reference_code
      ON archives (reference_code) WHERE reference_code IS NOT NULL
  `);


  // 5. archive_structures – which structures an archive uses, and when
  await knex.schema.createTable('archive_structures', (t) => {
    t.increments('id').primary();
    t.integer('archive_id').notNullable()
      .references('id').inTable('archives').onDelete('NO ACTION');
    t.integer('structure_id').notNullable()
      .references('id').inTable('structures').onDelete('NO ACTION');
    t.date('valid_from');
    t.date('valid_to');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').references('id').inTable('users');

    t.unique(['archive_id', 'structure_id'], { indexName: 'uq_archive_structures', useConstraint: true });
    t.check('?? IS NULL OR ?? IS NULL OR ?? <= ??',
      ['valid_from', 'valid_to', 'valid_from', 'valid_to'], 'ck_archive_structures_valid_range');
    t.index(['structure_id'], 'ix_archive_structures_structure');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('archive_structures');
  await knex.schema.dropTableIfExists('archives');
  await knex.schema.alterTable('archive_creators', (t) => {
    t.dropForeign('parent_id', 'fk_archive_creators_parent');
  });
  await knex.schema.dropTableIfExists('archive_creators');

  await knex.schema.alterTable('nodes', (t) => { t.dropColumn('previous_reference_code'); });
  await knex.schema.alterTable('structures', (t) => {
    t.dropForeign('previous_structure_id');
    t.dropColumn('previous_structure_id');
    t.dropColumn('version');
  });

  await knex.raw('ALTER TABLE structures DROP CONSTRAINT ck_structures_type');
  await knex.raw('ALTER TABLE node_types DROP CONSTRAINT ck_node_types_structure_type');
  // Arkivförteckning trees cannot be expressed in the old model – fold them back into 'struktur'
  await knex('structures').whereIn('structure_type', ['klassificering', 'arkivforteckning']).update({ structure_type: 'struktur' });
  await knex('node_types').whereIn('structure_type', ['klassificering', 'arkivforteckning']).update({ structure_type: 'struktur' });
  await knex.raw(`ALTER TABLE structures ADD CONSTRAINT ck_structures_type
                  CHECK (structure_type IN ('struktur','forvaring'))`);
  await knex.raw(`ALTER TABLE node_types ADD CONSTRAINT ck_node_types_structure_type
                  CHECK (structure_type IN ('struktur','forvaring'))`);
};
