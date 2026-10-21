/**
 * 002 – the trees
 *
 * structures       one named hierarchy, e.g. "Klassificeringsstruktur 2021–" or "Förvaring MAU"
 * node_types       what a node can be (Arkiv, Serie, Volym, Hylla …), mapped to EAD3 @level
 * node_type_rules  which type may be placed under which (keeps the trees valid)
 * nodes            every node in every tree – adjacency list (parent_id)
 *
 * Key rules enforced by the database:
 *  - A node with children cannot be deleted (parent_id FK = NO ACTION).
 *  - A child must be in the same structure as its parent (composite FK).
 *  - A node cannot be its own parent.
 */

exports.up = async function (knex) {

  // structures
  await knex.schema.createTable('structures', (t) => {
    t.increments('id').primary();
    t.string('code', 50).notNullable().unique();          // 'klass-2021', 'forvaring'
    t.string('name', 255).notNullable();
    t.string('structure_type', 20).notNullable();         // 'struktur' | 'forvaring'
    t.text('description');
    t.date('valid_from');                                 // giltighetstid
    t.date('valid_to');
    t.boolean('is_published').notNullable().defaultTo(false); // visible on the public site
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').references('id').inTable('users');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    t.integer('updated_by').references('id').inTable('users');

    t.check("?? IN ('struktur','forvaring')", ['structure_type'], 'ck_structures_type');
    t.check('?? IS NULL OR ?? IS NULL OR ?? <= ??',
      ['valid_from', 'valid_to', 'valid_from', 'valid_to'], 'ck_structures_valid_range');
  });

  // ---------------------------------------------------------------------------
  // node_types
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('node_types', (t) => {
    t.increments('id').primary();
    t.string('code', 50).notNullable().unique();          // 'serie', 'volym', 'hylla'
    t.string('name', 255).notNullable();                  // 'Serie'
    t.string('structure_type', 20).notNullable();         // which kind of tree it belongs to
    t.string('ead_level', 20).notNullable();              // EAD3 @level
    t.string('ead_otherlevel', 100);                      // when ead_level = 'otherlevel'
    t.text('description');
    t.boolean('is_active').notNullable().defaultTo(true); // retire a type without deleting history

    t.check("?? IN ('struktur','forvaring')", ['structure_type'], 'ck_node_types_structure_type');
    t.check(
      "?? IN ('collection','fonds','class','recordgrp','series','subfonds','subgrp','subseries','file','item','otherlevel')",
      ['ead_level'], 'ck_node_types_ead_level');
    t.check("?? <> 'otherlevel' OR ?? IS NOT NULL",
      ['ead_level', 'ead_otherlevel'], 'ck_node_types_otherlevel');
  });

  // ---------------------------------------------------------------------------
  // node_type_rules – allowed parent → child combinations
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('node_type_rules', (t) => {
    t.integer('parent_type_id').notNullable()
      .references('id').inTable('node_types').onDelete('NO ACTION');
    t.integer('child_type_id').notNullable()
      .references('id').inTable('node_types').onDelete('NO ACTION');
    t.primary(['parent_type_id', 'child_type_id']);
  });

  // ---------------------------------------------------------------------------
  // nodes
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('nodes', (t) => {
    t.increments('id').primary();
    t.integer('structure_id').notNullable()
      .references('id').inTable('structures').onDelete('NO ACTION');
    t.integer('parent_id');                               // NULL = root node
    t.integer('node_type_id').notNullable()
      .references('id').inTable('node_types').onDelete('NO ACTION');
    t.string('reference_code', 100);                      // referenskod / beteckning, e.g. '2.3.1'
    t.string('title', 500).notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);   // order among siblings
    t.boolean('is_published').notNullable().defaultTo(false);
    t.string('external_id', 255);                         // EAD <c id="…"> – keeps re-imports idempotent
    t.specificType('row_version', 'rowversion');          // optimistic locking when two archivists edit
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').references('id').inTable('users');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    t.integer('updated_by').references('id').inTable('users');

    // Needed so the composite FK below has something unique to point at
    t.unique(['structure_id', 'id'], { indexName: 'uq_nodes_structure_id', useConstraint: true });

    t.check('?? IS NULL OR ?? <> ??', ['parent_id', 'parent_id', 'id'], 'ck_nodes_not_own_parent');

    t.index(['parent_id', 'sort_order'], 'ix_nodes_parent_sort');  // children in order
    t.index(['structure_id', 'parent_id'], 'ix_nodes_structure_parent');
  });

  // Parent must exist AND be in the same structure.
  // NO ACTION = a parent with children cannot be deleted.
  // (Separate step: the unique key above must exist before the FK can point at it.)
  await knex.schema.alterTable('nodes', (t) => {
    t.foreign(['structure_id', 'parent_id'], 'fk_nodes_parent_same_structure')
      .references(['structure_id', 'id']).inTable('nodes')
      .onDelete('NO ACTION');
  });

  // Reference codes unique within a structure (only when set)
  await knex.raw(`
    CREATE UNIQUE INDEX uq_nodes_structure_reference_code
      ON nodes (structure_id, reference_code)
      WHERE reference_code IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_nodes_structure_external_id
      ON nodes (structure_id, external_id)
      WHERE external_id IS NOT NULL
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('nodes');
  await knex.schema.dropTableIfExists('node_type_rules');
  await knex.schema.dropTableIfExists('node_types');
  await knex.schema.dropTableIfExists('structures');
};
