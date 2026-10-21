/**
 * 004 – relations between nodes (usually across trees)
 *
 * relation_types  what a link means, e.g. "förvaras i" / "innehåller"
 * node_relations  the links themselves, e.g. Serie F2 Fakturor  --förvaras i-->  Hylla 3
 *
 * Both FKs are NO ACTION: SQL Server forbids two cascade paths into one table,
 * and a node that still has relations should not disappear silently anyway.
 * The API removes a node's relations explicitly before deleting the node.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('relation_types', (t) => {
    t.increments('id').primary();
    t.string('code', 50).notNullable().unique();          // 'forvaras_i'
    t.string('name', 255).notNullable();                  // 'förvaras i'
    t.string('inverse_name', 255);                        // 'innehåller'
    t.string('ead_element', 100);                         // e.g. 'physloc', 'relatedmaterial'
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('node_relations', (t) => {
    t.increments('id').primary();
    t.integer('relation_type_id').notNullable()
      .references('id').inTable('relation_types').onDelete('NO ACTION');
    t.integer('from_node_id').notNullable()
      .references('id').inTable('nodes').onDelete('NO ACTION');
    t.integer('to_node_id').notNullable()
      .references('id').inTable('nodes').onDelete('NO ACTION');
    t.date('valid_from');
    t.date('valid_to');
    t.text('note');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').references('id').inTable('users');

    t.unique(['relation_type_id', 'from_node_id', 'to_node_id'],
      { indexName: 'uq_node_relations', useConstraint: true });
    t.check('?? <> ??', ['from_node_id', 'to_node_id'], 'ck_node_relations_not_self');
    t.index(['to_node_id'], 'ix_node_relations_to');      // "what is stored in this box?"
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('node_relations');
  await knex.schema.dropTableIfExists('relation_types');
};
