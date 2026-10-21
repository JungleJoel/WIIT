/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. إنشاء جدول ead_documents (ترويسة ملف الـ XML)
  await knex.schema.createTable('ead_documents', (table) => {
    table.increments('id').primary();
    table.integer('structure_id').unsigned().nullable().references('id').inTable('structures').onDelete('CASCADE');
    table.string('record_id', 255).nullable();
    table.string('title_proper', 255).nullable();
    table.string('edition', 255).nullable();
    table.string('agency_name', 255).nullable();
    table.string('country_code', 10).nullable().defaultTo('SE');
    table.string('language_code', 20).nullable();
    table.string('script_code', 20).nullable();
    table.string('publication_status', 50).nullable();
    table.string('source_file_name', 255).nullable();
    table.datetime('imported_at').nullable().defaultTo(knex.fn.now());
  });

  // 2. تعديل جدول nodes الحالي وإضافة حقول الـ EAD المفقودة
  await knex.schema.alterTable('nodes', (table) => {
    table.integer('ead_document_id').unsigned().nullable().references('id').inTable('ead_documents').onDelete('SET NULL');
    table.string('ead_id', 255).nullable();
    table.text('scope_content').nullable();
    table.text('appraisal').nullable();
    table.datetime('modified_at').nullable();
    table.string('modified_by', 255).nullable();
    table.string('ead_audience', 50).nullable();
    table.string('local_type', 100).nullable();
  });

  // 3. إنشاء جدول تعريفات الخصائص المخصصة (لـ Handlingstyp)
  await knex.schema.createTable('custom_field_definitions', (table) => {
    table.increments('id').primary();
    table.integer('structure_id').unsigned().notNullable().references('id').inTable('structures').onDelete('CASCADE');
    table.string('field_name', 100).notNullable();
    table.string('display_name', 255).notNullable();
    table.string('data_type', 50).notNullable();
    table.boolean('is_required').notNullable().defaultTo(false);
  });

  // 4. إنشاء جدول قيم الخصائص المخصصة المرتبطة بالعقد
  await knex.schema.createTable('classification_node_custom_values', (table) => {
    table.increments('id').primary();
    table.integer('node_id').unsigned().notNullable().references('id').inTable('nodes').onDelete('CASCADE');
    table.integer('custom_field_definition_id').unsigned().notNullable().references('id').inTable('custom_field_definitions').onDelete('CASCADE');
    table.text('value').nullable();
  });

  // 5. إنشاء الجداول الأرشيفية الإضافية (السلاسل والمجلدات والتخزين)
  await knex.schema.createTable('archive_series', (table) => {
    table.increments('id').primary();
    table.integer('archive_id').unsigned().notNullable().references('id').inTable('archives').onDelete('CASCADE');
    table.string('name', 500).notNullable();
    table.string('signum', 100).nullable();
    table.string('location', 255).nullable();
    table.text('description').nullable();
    table.string('ead_id', 255).nullable().unique();
    table.string('ead_audience', 50).nullable();
  });

  await knex.schema.createTable('archive_volumes', (table) => {
    table.increments('id').primary();
    table.integer('series_id').unsigned().notNullable().references('id').inTable('archive_series').onDelete('CASCADE');
    table.string('time_from', 100).nullable();
    table.string('time_to', 100).nullable();
    table.text('volume_note').nullable();
    table.string('ead_id', 255).nullable().unique();
    table.string('ead_audience', 50).nullable();
  });

  await knex.schema.createTable('fe_structures', (table) => {
    table.increments('id').primary();
    table.string('name', 500).notNullable();
    table.text('description').nullable();
    table.date('valid_from').nullable();
    table.date('valid_to').nullable();
  });

  await knex.schema.createTable('fe_structure_units', (table) => {
    table.increments('id').primary();
    table.integer('fe_structure_id').unsigned().notNullable().references('id').inTable('fe_structures').onDelete('CASCADE');
    table.integer('parent_id').unsigned().nullable().references('id').inTable('fe_structure_units');
    table.string('name', 500).notNullable();
    table.string('unit_type', 100).nullable();
    table.string('time_from', 100).nullable();
    table.string('time_to', 100).nullable();
    table.text('description').nullable();
    table.string('ead_id', 255).nullable().unique();
    table.string('ead_audience', 50).nullable();
  });

  await knex.schema.createTable('storage_units', (table) => {
    table.increments('id').primary();
    table.integer('fe_structure_unit_id').unsigned().notNullable().references('id').inTable('fe_structure_units').onDelete('CASCADE');
    table.string('name', 500).notNullable();
    table.string('unit_type', 100).nullable();
    table.string('time_from', 100).nullable();
    table.string('time_to', 100).nullable();
    table.text('description').nullable();
    table.string('ead_id', 255).nullable().unique();
    table.string('ead_audience', 50).nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // التراجع بحذف الجداول والعواميد بعكس ترتيب الإنشاء لضمان عدم كسر الـ Foreign Keys
  await knex.schema.dropTableIfExists('storage_units');
  await knex.schema.dropTableIfExists('fe_structure_units');
  await knex.schema.dropTableIfExists('fe_structures');
  await knex.schema.dropTableIfExists('archive_volumes');
  await knex.schema.dropTableIfExists('archive_series');
  await knex.schema.dropTableIfExists('classification_node_custom_values');
  await knex.schema.dropTableIfExists('custom_field_definitions');

  await knex.schema.alterTable('nodes', (table) => {
    table.dropForeign(['ead_document_id']);
    table.dropColumn('ead_document_id');
    table.dropColumn('ead_id');
    table.dropColumn('scope_content');
    table.dropColumn('appraisal');
    table.dropColumn('modified_at');
    table.dropColumn('modified_by');
    table.dropColumn('ead_audience');
    table.dropColumn('local_type');
  });

  await knex.schema.dropTableIfExists('ead_documents');
};