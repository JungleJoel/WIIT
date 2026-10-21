/**
 * 005 – permissions, change log, manual versions, import/export history
 *
 * ad_group_roles      maps an MAU AD group to a WIIT role, optionally limited to one structure
 *                     (permissions come from AD – we only store the mapping)
 * change_log          who changed what and when (traceability – Arkivlagen/TF)
 * structure_versions  manual "save a version" snapshots – the client does NOT want automatic versioning
 * transfer_jobs       log of EAD3 / FGS imports and exports
 */

exports.up = async function (knex) {

  // ad_group_roles
  await knex.schema.createTable('ad_group_roles', (t) => {
    t.increments('id').primary();
    t.string('ad_group', 255).notNullable();              // AD group objectId or name
    t.string('role', 20).notNullable();                   // 'admin' | 'editor' | 'viewer'
    t.integer('structure_id')                             // NULL = applies to all structures
      .references('id').inTable('structures').onDelete('CASCADE');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());

    t.check("?? IN ('admin','editor','viewer')", ['role'], 'ck_ad_group_roles_role');
    t.index(['ad_group'], 'ix_ad_group_roles_group');
  });
  await knex.raw(`
    CREATE UNIQUE INDEX uq_ad_group_roles_global
      ON ad_group_roles (ad_group, role) WHERE structure_id IS NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_ad_group_roles_scoped
      ON ad_group_roles (ad_group, role, structure_id) WHERE structure_id IS NOT NULL
  `);

  // change_log – append-only; no FKs to the changed rows so history survives deletes
  await knex.schema.createTable('change_log', (t) => {
    t.bigIncrements('id').primary();
    t.string('entity_type', 50).notNullable();            // 'node', 'structure', 'node_relation' …
    t.integer('entity_id').notNullable();
    t.integer('structure_id');                            // makes "history for this tree" cheap
    t.string('action', 20).notNullable();
    t.text('old_value');                                  // JSON
    t.text('new_value');                                  // JSON
    t.text('comment');
    t.integer('changed_by').references('id').inTable('users');
    t.datetime('changed_at').notNullable().defaultTo(knex.fn.now());

    t.check("?? IN ('create','update','delete','move','publish','unpublish','import')",
      ['action'], 'ck_change_log_action');
    t.check('?? IS NULL OR ISJSON(??) = 1', ['old_value', 'old_value'], 'ck_change_log_old_json');
    t.check('?? IS NULL OR ISJSON(??) = 1', ['new_value', 'new_value'], 'ck_change_log_new_json');
    t.index(['entity_type', 'entity_id'], 'ix_change_log_entity');
    t.index(['structure_id', 'changed_at'], 'ix_change_log_structure');
  });


  // structure_versions – manual snapshots of a whole tree
  await knex.schema.createTable('structure_versions', (t) => {
    t.increments('id').primary();
    t.integer('structure_id').notNullable()
      .references('id').inTable('structures').onDelete('NO ACTION');
    t.string('version_label', 50).notNullable();          // '1.0', '2026-10 revidering'
    t.text('comment');
    t.text('snapshot').notNullable();                     // JSON of the full tree
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').references('id').inTable('users');

    t.unique(['structure_id', 'version_label'],
      { indexName: 'uq_structure_versions_label', useConstraint: true });
    t.check('ISJSON(??) = 1', ['snapshot'], 'ck_structure_versions_json');
  });


  // transfer_jobs – EAD3 / FGS / RA-FS import & export history
  await knex.schema.createTable('transfer_jobs', (t) => {
    t.increments('id').primary();
    t.string('direction', 10).notNullable();              // 'import' | 'export'
    t.string('format', 20).notNullable();                 // 'ead3' | 'fgs' | 'ra-fs'
    t.integer('structure_id')
      .references('id').inTable('structures').onDelete('NO ACTION');
    t.string('file_name', 255);
    t.string('status', 20).notNullable().defaultTo('pending');
    t.integer('node_count');
    t.text('message');                                    // validation errors / summary
    t.datetime('started_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('finished_at');
    t.integer('created_by').references('id').inTable('users');

    t.check("?? IN ('import','export')", ['direction'], 'ck_transfer_jobs_direction');
    t.check("?? IN ('ead3','fgs','ra-fs')", ['format'], 'ck_transfer_jobs_format');
    t.check("?? IN ('pending','running','done','failed')", ['status'], 'ck_transfer_jobs_status');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('transfer_jobs');
  await knex.schema.dropTableIfExists('structure_versions');
  await knex.schema.dropTableIfExists('change_log');
  await knex.schema.dropTableIfExists('ad_group_roles');
};
