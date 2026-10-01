/**
 * WIIT – core schema (draft v0)
 *
 * Tables:
 *   structures            one row per tree (Struktur, Förvaring, ...)
 *   node_types            allowed object types, mapped to EAD3 levels
 *   node_type_rules       which node type may be a child of which
 *   property_definitions  which properties each node type has
 *   nodes                 the tree itself (adjacency list via parent_id)
 *   node_property_values  property values per node
 *   node_relations        links between nodes in different trees
 *
 * MSSQL notes:
 * - nodes.parent_id has NO cascade on delete, so the database itself refuses to
 *   delete a node that still has children (client requirement).
 * - A composite FK (structure_id, parent_id) -> (structure_id, id) guarantees that
 *   a parent always belongs to the same tree as its child.
 * - node_relations has two FKs to nodes, so it cannot cascade (SQL Server
 *   rejects multiple cascade paths). Delete a node's relations in the service
 *   layer before deleting the node.
 * - Some constraints use knex.raw because Knex creates *filtered* unique indexes
 *   on MSSQL, and a foreign key cannot reference a filtered index.
 */

exports.up = async function (knex) {
  // ---------------------------------------------------------------------------
  // structures
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('structures', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.string('structure_type', 50).notNullable(); // 'struktur' | 'forvaring' | ...
    t.text('description');
    t.boolean('is_published').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  // ---------------------------------------------------------------------------
  // node_types
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('node_types', (t) => {
    t.increments('id').primary();
    t.string('code', 50).notNullable();              // 'serie', 'volym', 'hylla'
    t.string('name', 255).notNullable();             // label shown in the UI
    t.string('structure_type', 50).notNullable();    // which kind of tree it belongs to
    t.string('ead_level', 20).notNullable();         // EAD3 @level
    t.string('ead_otherlevel', 100);                 // EAD3 @otherlevel when ead_level = 'otherlevel'
    t.text('description');
    t.timestamps(true, true);
  });
  await knex.raw(`
    ALTER TABLE node_types ADD CONSTRAINT uq_node_types_code UNIQUE (code);
    ALTER TABLE node_types ADD CONSTRAINT ck_node_types_ead_level CHECK (
      ead_level IN ('collection','fonds','class','recordgrp','series','subfonds',
                    'subgrp','subseries','file','item','otherlevel')
    );
    ALTER TABLE node_types ADD CONSTRAINT ck_node_types_otherlevel CHECK (
      ead_level <> 'otherlevel' OR ead_otherlevel IS NOT NULL
    );
  `);

  // ---------------------------------------------------------------------------
  // node_type_rules – allowed parent/child combinations
  // (a root-level type is simply one that is never listed as a child)
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('node_type_rules', (t) => {
    t.integer('parent_type_id').notNullable().references('id').inTable('node_types');
    t.integer('child_type_id').notNullable().references('id').inTable('node_types');
    t.primary(['parent_type_id', 'child_type_id']);
  });

  // ---------------------------------------------------------------------------
  // property_definitions – which properties a node type has
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('property_definitions', (t) => {
    t.increments('id').primary();
    t.integer('node_type_id').notNullable()
      .references('id').inTable('node_types').onDelete('CASCADE');
    t.string('key', 100).notNullable();              // 'tidsomfang', 'gallring'
    t.string('label', 255).notNullable();            // 'Tidsomfång'
    t.string('data_type', 20).notNullable().defaultTo('text');
    t.boolean('is_required').notNullable().defaultTo(false);
    t.string('ead_element', 100);                    // e.g. 'did/unitdate', 'scopecontent'
    t.integer('sort_order').notNullable().defaultTo(0);
  });
  await knex.raw(`
    ALTER TABLE property_definitions
      ADD CONSTRAINT uq_property_definitions_type_key UNIQUE (node_type_id, [key]);
    ALTER TABLE property_definitions ADD CONSTRAINT ck_property_definitions_data_type CHECK (
      data_type IN ('text','number','date','boolean')
    );
  `);

  // ---------------------------------------------------------------------------
  // nodes – the trees
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('nodes', (t) => {
    t.increments('id').primary();
    t.integer('structure_id').notNullable().references('id').inTable('structures');
    t.integer('parent_id');                          // NULL = root node
    t.integer('node_type_id').notNullable().references('id').inTable('node_types');
    t.string('title', 500).notNullable();
    t.string('reference_code', 100);                 // referenskod, e.g. 'A1', 'F2:3'
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.string('created_by', 255);                     // AD user, filled in once SSO exists
    t.string('updated_by', 255);
    t.index(['parent_id', 'sort_order'], 'ix_nodes_parent_sort');
    t.index(['structure_id'], 'ix_nodes_structure');
  });
  await knex.raw(`
    ALTER TABLE nodes ADD CONSTRAINT uq_nodes_structure_id UNIQUE (structure_id, id);

    ALTER TABLE nodes ADD CONSTRAINT fk_nodes_parent_same_structure
      FOREIGN KEY (structure_id, parent_id) REFERENCES nodes (structure_id, id);

    ALTER TABLE nodes ADD CONSTRAINT ck_nodes_not_own_parent CHECK (
      parent_id IS NULL OR parent_id <> id
    );

    CREATE UNIQUE INDEX ux_nodes_structure_reference_code
      ON nodes (structure_id, reference_code)
      WHERE reference_code IS NOT NULL;
  `);

  // ---------------------------------------------------------------------------
  // node_property_values
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('node_property_values', (t) => {
    t.integer('node_id').notNullable()
      .references('id').inTable('nodes').onDelete('CASCADE');
    t.integer('property_definition_id').notNullable()
      .references('id').inTable('property_definitions');
    t.text('value');
    t.primary(['node_id', 'property_definition_id']);
  });

  // ---------------------------------------------------------------------------
  // node_relations – links between trees (e.g. Volym "förvaras i" Kartong)
  // ---------------------------------------------------------------------------
  await knex.schema.createTable('node_relations', (t) => {
    t.increments('id').primary();
    t.integer('source_node_id').notNullable().references('id').inTable('nodes');
    t.integer('target_node_id').notNullable().references('id').inTable('nodes');
    t.string('relation_type', 50).notNullable();     // 'forvaras_i', ...
    t.text('note');
    t.timestamps(true, true);
    t.index(['target_node_id'], 'ix_node_relations_target');
  });
  await knex.raw(`
    ALTER TABLE node_relations ADD CONSTRAINT uq_node_relations
      UNIQUE (source_node_id, target_node_id, relation_type);
    ALTER TABLE node_relations ADD CONSTRAINT ck_node_relations_not_self CHECK (
      source_node_id <> target_node_id
    );
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('node_relations');
  await knex.schema.dropTableIfExists('node_property_values');
  await knex.schema.dropTableIfExists('nodes');
  await knex.schema.dropTableIfExists('property_definitions');
  await knex.schema.dropTableIfExists('node_type_rules');
  await knex.schema.dropTableIfExists('node_types');
  await knex.schema.dropTableIfExists('structures');
};
