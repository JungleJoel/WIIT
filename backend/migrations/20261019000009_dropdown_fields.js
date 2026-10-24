/**
 * 009 – dropdown fields ("listruta") from the client's Excel
 *
 * Ingrid compared the schema with the client's Excel for the klassificeringsstruktur
 * ("Small inconsistencies – migrations vs excel sheet from client", Drive, 2026-10-19).
 * The Handlingstyp fields must be "fritext / listruta / ja-nej":
 *
 *   fritext  → data_type 'text' / 'longtext'   (already exists)
 *   ja-nej   → data_type 'boolean'             (already exists)
 *   listruta → data_type 'enum'                (NEW, this migration)
 *
 * 1. property_definitions.data_type also allows 'enum'.
 *
 * 2. property_options – the allowed choices of an 'enum' field, one row per choice.
 *    The client wants to manage fields themselves, so a new choice is a row, not a
 *    migration (same idea as property_definitions in 003).
 *
 *    The chosen value is stored as TEXT in node_property_values.value_text, not as
 *    an id pointing to property_options. Why:
 *      - the EAD export (loadStructure.ts) already reads value_text for text fields,
 *        so export and import work without any change;
 *      - an archive must keep what was registered: if a choice is renamed or
 *        retired later, old nodes still show the value they were given.
 *    The cost: the database cannot check that a value is one of the choices.
 *    The API must do that check when a value is saved.
 *
 *    A choice that is no longer used is retired with is_active = false, not deleted,
 *    so old values still have their choice in the list.
 *
 * The node type 'handlingstyp' and its fields are DATA, not schema, so they are added
 * in seeds/01_demo.js (and later by the client in the admin UI).
 */

exports.up = async function (knex) {
  // 1. 'enum' as data type
  await knex.raw('ALTER TABLE property_definitions DROP CONSTRAINT ck_property_definitions_data_type');
  await knex.raw(`
    ALTER TABLE property_definitions ADD CONSTRAINT ck_property_definitions_data_type
      CHECK (data_type IN ('text','longtext','number','date','boolean','url','enum'))
  `);

  // 2. property_options
  await knex.schema.createTable('property_options', (t) => {
    t.increments('id').primary();
    t.integer('property_definition_id').notNullable()
      .references('id').inTable('property_definitions').onDelete('CASCADE'); // choices belong to their field
    t.string('value', 255).notNullable();               // 'Ja', 'Nej', 'Delvis' – stored as-is in value_text
    t.integer('sort_order').notNullable().defaultTo(0); // order in the dropdown
    t.boolean('is_active').notNullable().defaultTo(true);

    // The unique index also serves as the index on the foreign key
    t.unique(['property_definition_id', 'value'],
      { indexName: 'uq_property_options_definition_value', useConstraint: true });
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('property_options');

  // 'enum' fields become plain text fields – their values are already in value_text,
  // so nothing is lost
  await knex('property_definitions').where({ data_type: 'enum' }).update({ data_type: 'text' });
  await knex.raw('ALTER TABLE property_definitions DROP CONSTRAINT ck_property_definitions_data_type');
  await knex.raw(`
    ALTER TABLE property_definitions ADD CONSTRAINT ck_property_definitions_data_type
      CHECK (data_type IN ('text','longtext','number','date','boolean','url'))
  `);
};
