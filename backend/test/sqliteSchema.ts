/**
 * The WIIT tables in SQLite, for tests that run without SQL Server.
 * Same columns as the MSSQL migrations 001–010, without MSSQL-only details
 * (filtered unique indexes, CHECK constraints, foreign keys).
 * Add a column here when a migration adds one.
 */

import type { Knex } from 'knex';

export async function createTables(knex: Knex): Promise<void> {
  const audit = (t: Knex.CreateTableBuilder): void => {
    t.datetime('created_at'); t.integer('created_by'); t.datetime('updated_at'); t.integer('updated_by');
  };
  await knex.schema.createTable('users', (t) => {
    t.increments('id'); t.string('ad_object_id'); t.string('username'); t.string('display_name');
  });
  await knex.schema.createTable('archive_creators', (t) => {
    t.increments('id'); t.integer('parent_id'); t.string('creator_type').defaultTo('corporate'); t.string('name');
    t.integer('start_year'); t.integer('end_year'); t.text('description'); t.string('external_id');
    t.boolean('is_published').defaultTo(false); audit(t);
  });
  await knex.schema.createTable('archives', (t) => {
    t.increments('id'); t.integer('archive_creator_id'); t.string('reference_code'); t.string('name');
    t.integer('start_year'); t.integer('end_year'); t.text('description'); t.string('external_id');
    t.boolean('is_published').defaultTo(false); audit(t);
  });
  await knex.schema.createTable('structures', (t) => {
    t.increments('id'); t.string('code'); t.string('name'); t.string('structure_type'); t.text('description');
    t.date('valid_from'); t.date('valid_to'); t.boolean('is_published').defaultTo(false);
    t.string('agency_code'); t.string('agency_name'); t.string('language_code').defaultTo('swe'); t.string('license');
    t.string('version'); t.integer('previous_structure_id'); t.string('external_id'); audit(t);   // external_id: 008
  });
  await knex.schema.createTable('archive_structures', (t) => {
    t.increments('id'); t.integer('archive_id'); t.integer('structure_id');
    t.date('valid_from'); t.date('valid_to'); t.datetime('created_at'); t.integer('created_by');
  });
  await knex.schema.createTable('node_types', (t) => {
    t.increments('id'); t.string('code'); t.string('name'); t.string('structure_type');
    t.string('ead_level'); t.string('ead_otherlevel'); t.string('ead_unit_description');   // 010
  });
  await knex.schema.createTable('node_type_rules', (t) => { t.integer('parent_type_id'); t.integer('child_type_id'); });
  await knex.schema.createTable('nodes', (t) => {
    t.increments('id'); t.integer('structure_id'); t.integer('parent_id'); t.integer('node_type_id');
    t.string('reference_code'); t.string('previous_reference_code'); t.string('title');
    t.integer('sort_order').defaultTo(0); t.boolean('is_published').defaultTo(false); t.string('external_id');
    t.date('valid_from'); t.date('valid_to'); t.text('description'); t.string('portal_url');
    t.datetime('source_updated_at'); t.string('source_updated_by'); audit(t);   // source_updated_*: 008
  });
  await knex.schema.createTable('property_definitions', (t) => {
    t.increments('id'); t.integer('node_type_id'); t.string('key'); t.string('label'); t.string('data_type');
    t.boolean('is_public').defaultTo(true); t.string('ead_element'); t.text('help_text'); t.integer('sort_order').defaultTo(0);
    t.boolean('is_required').defaultTo(false); t.boolean('is_active').defaultTo(true); t.boolean('is_repeatable').defaultTo(false);   // 008
  });
  await knex.schema.createTable('property_options', (t) => {          // migration 009
    t.increments('id'); t.integer('property_definition_id'); t.string('value');
    t.integer('sort_order').defaultTo(0); t.boolean('is_active').defaultTo(true);
  });
  await knex.schema.createTable('node_property_values', (t) => {
    t.increments('id'); t.integer('node_id'); t.integer('property_definition_id'); t.text('value_text');
    t.decimal('value_number'); t.date('value_date'); t.boolean('value_boolean'); t.integer('updated_by');
    t.integer('value_order').defaultTo(0); t.datetime('updated_at');   // value_order: 008
  });
  await knex.schema.createTable('relation_types', (t) => {
    t.increments('id'); t.string('code'); t.string('name'); t.string('inverse_name'); t.string('ead_element'); t.boolean('is_active').defaultTo(true);
  });
  await knex.schema.createTable('node_relations', (t) => {
    t.increments('id'); t.integer('relation_type_id'); t.integer('from_node_id'); t.integer('to_node_id'); t.integer('created_by');
    t.date('valid_from'); t.date('valid_to'); t.text('note'); t.datetime('created_at');
  });
  await knex.schema.createTable('ad_group_roles', (t) => { t.increments('id'); t.string('ad_group'); t.string('role'); t.integer('structure_id'); });
  for (const name of ['change_log', 'structure_versions']) {
    await knex.schema.createTable(name, (t) => { t.increments('id'); });
  }
  await knex.schema.createTable('transfer_jobs', (t) => {
    t.increments('id'); t.string('direction'); t.string('format'); t.integer('structure_id'); t.string('file_name');
    t.string('status'); t.integer('node_count'); t.text('message'); t.datetime('started_at'); t.datetime('finished_at');
    t.integer('created_by');
  });
}
