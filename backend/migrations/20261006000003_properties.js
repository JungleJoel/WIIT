/**
 * 003 – properties ("egenskaper")
 *
 * property_definitions  which fields a node type has (Tidsomfång, Gallring, Sekretess …)
 * node_property_values  the actual values per node
 *
 * The client wants to manage this themselves, so new fields are rows, not
 * schema changes. Each field can map to an EAD3 element for import/export.
 *
 * is_public = false keeps a field out of the public site (OSL / GDPR),
 * even when the node itself is published.
 */

exports.up = async function (knex) {

  // property_definitions
  await knex.schema.createTable('property_definitions', (t) => {
    t.increments('id').primary();
    t.integer('node_type_id').notNullable()
      .references('id').inTable('node_types').onDelete('NO ACTION');
    t.string('key', 100).notNullable();                   // 'tidsomfang', 'gallring'
    t.string('label', 255).notNullable();                 // 'Tidsomfång'
    t.string('data_type', 20).notNullable().defaultTo('text');
    t.boolean('is_required').notNullable().defaultTo(false);
    t.boolean('is_public').notNullable().defaultTo(true); // shown on the public site?
    t.string('ead_element', 100);                         // 'did/unitdate', 'appraisal', 'scopecontent'
    t.text('help_text');                                  // guidance for the archivist in the admin UI
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);

    t.unique(['node_type_id', 'key'], { indexName: 'uq_property_definitions_type_key', useConstraint: true });
    t.check("?? IN ('text','longtext','number','date','boolean','url')",
      ['data_type'], 'ck_property_definitions_data_type');
  });


  // node_property_values – one typed column per data_type, only one is used
  await knex.schema.createTable('node_property_values', (t) => {
    t.increments('id').primary();
    t.integer('node_id').notNullable()
      .references('id').inTable('nodes').onDelete('CASCADE');  // values die with their node
    t.integer('property_definition_id').notNullable()
      .references('id').inTable('property_definitions').onDelete('NO ACTION'); // never silently drop archive data
    t.text('value_text');                                  // text, longtext, url
    t.decimal('value_number', 18, 4);
    t.date('value_date');
    t.boolean('value_boolean');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    t.integer('updated_by').references('id').inTable('users');

    t.unique(['node_id', 'property_definition_id'],
      { indexName: 'uq_node_property_values_node_def', useConstraint: true });
    t.check(`
      (CASE WHEN ?? IS NULL THEN 0 ELSE 1 END
     + CASE WHEN ?? IS NULL THEN 0 ELSE 1 END
     + CASE WHEN ?? IS NULL THEN 0 ELSE 1 END
     + CASE WHEN ?? IS NULL THEN 0 ELSE 1 END) <= 1`,
      ['value_text', 'value_number', 'value_date', 'value_boolean'],
      'ck_node_property_values_one_value');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('node_property_values');
  await knex.schema.dropTableIfExists('property_definitions');
};
