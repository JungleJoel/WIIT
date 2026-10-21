/**
 * EAD3 export test – runs without SQL Server.
 *
 * Builds the WIIT tables in an in-memory SQLite database (same columns as the
 * MSSQL migrations 001–007, minus MSSQL-only details), runs the REAL demo seed
 * (seeds/01_demo.js) twice, then exports and checks the result.
 *
 *   npm i -D better-sqlite3
 *   npx tsx test/ead-export.test.ts         (optional: EAD3_XSD=path/to/ead3.xsd to validate)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import knexLib, { type Knex } from 'knex';
import { loadStructure, type LoadedStructure, type LoadOptions } from '../src/ead/loadStructure';
import { buildEad3 } from '../src/ead/buildEad3';

// The seed is still JS – typed here until it is converted
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { seed } = require('../seeds/01_demo') as { seed: (knex: Knex) => Promise<void> };

async function createTables(knex: Knex): Promise<void> {
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
    t.string('version'); t.integer('previous_structure_id'); audit(t);
  });
  await knex.schema.createTable('archive_structures', (t) => {
    t.increments('id'); t.integer('archive_id'); t.integer('structure_id');
    t.date('valid_from'); t.date('valid_to'); t.datetime('created_at'); t.integer('created_by');
  });
  await knex.schema.createTable('node_types', (t) => {
    t.increments('id'); t.string('code'); t.string('name'); t.string('structure_type');
    t.string('ead_level'); t.string('ead_otherlevel');
  });
  await knex.schema.createTable('node_type_rules', (t) => { t.integer('parent_type_id'); t.integer('child_type_id'); });
  await knex.schema.createTable('nodes', (t) => {
    t.increments('id'); t.integer('structure_id'); t.integer('parent_id'); t.integer('node_type_id');
    t.string('reference_code'); t.string('previous_reference_code'); t.string('title');
    t.integer('sort_order').defaultTo(0); t.boolean('is_published').defaultTo(false); t.string('external_id');
    t.date('valid_from'); t.date('valid_to'); t.text('description'); t.string('portal_url'); audit(t);
  });
  await knex.schema.createTable('property_definitions', (t) => {
    t.increments('id'); t.integer('node_type_id'); t.string('key'); t.string('label'); t.string('data_type');
    t.boolean('is_public').defaultTo(true); t.string('ead_element'); t.text('help_text'); t.integer('sort_order').defaultTo(0);
  });
  await knex.schema.createTable('node_property_values', (t) => {
    t.increments('id'); t.integer('node_id'); t.integer('property_definition_id'); t.text('value_text');
    t.decimal('value_number'); t.date('value_date'); t.boolean('value_boolean'); t.integer('updated_by');
  });
  await knex.schema.createTable('relation_types', (t) => {
    t.increments('id'); t.string('code'); t.string('name'); t.string('inverse_name'); t.string('ead_element');
  });
  await knex.schema.createTable('node_relations', (t) => {
    t.increments('id'); t.integer('relation_type_id'); t.integer('from_node_id'); t.integer('to_node_id'); t.integer('created_by');
  });
  await knex.schema.createTable('ad_group_roles', (t) => { t.increments('id'); t.string('ad_group'); t.string('role'); t.integer('structure_id'); });
  for (const name of ['change_log', 'structure_versions', 'transfer_jobs']) {
    await knex.schema.createTable(name, (t) => { t.increments('id'); });
  }
}

function validate(xml: string, name: string): void {
  const xsd = process.env.EAD3_XSD;
  if (!xsd) {
    console.log(`  (skipped XSD validation for ${name} – set EAD3_XSD)`);
    return;
  }
  const file = path.join(process.env.OUT_DIR || '.', name);
  fs.writeFileSync(file, xml);
  execFileSync('xmllint', ['--noout', '--schema', xsd, file], { stdio: 'inherit' });
}

async function idOf(knex: Knex, table: string, code: string): Promise<number> {
  const row = await knex(table).where({ code }).first('id');
  if (!row) throw new Error(`No ${table} row with code '${code}'`);
  return row.id as number;
}

/** loadStructure must find the structure in these tests – fail loudly if it doesn't. */
async function load(knex: Knex, id: number, opts?: LoadOptions): Promise<LoadedStructure> {
  const loaded = await loadStructure(knex, id, opts);
  assert.ok(loaded, `structure ${id} should load`);
  return loaded;
}

(async () => {
  const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await createTables(knex);
  await seed(knex);
  await seed(knex);                                   // must be re-runnable (clears in the right order)
  const count = await knex('nodes').count({ n: '*' }).first();
  assert.equal(Number(count?.n), 9, 'seed re-run gives the same data');
  console.log('✓ seed runs twice');

  const fixed = { generatedAt: new Date('2026-10-11T12:00:00Z') };
  const klass = await idOf(knex, 'structures', 'klass-2021');
  const forteckning = await idOf(knex, 'structures', 'mau-001-forteckning');
  const forv = await idOf(knex, 'structures', 'forvaring');

  // 1. Klassificering: archive + creator on top, version, previous beteckning
  const klassXml = buildEad3(await load(knex, klass), fixed);
  assert.match(klassXml, /<edition>2021<\/edition>/);
  assert.match(klassXml, /<archdesc level="fonds">/);
  assert.match(klassXml, /<unitid>MAU-001<\/unitid>/);
  assert.match(klassXml, /<origination label="Arkivbildare">\s*<corpname>\s*<part>Malmö universitet<\/part>/);
  assert.match(klassXml, /<bioghist localtype="arkivbildare">/);
  assert.match(klassXml, /<fromdate standarddate="1998">/);
  assert.match(klassXml, /<c level="class"/);
  assert.match(klassXml, /<unitid localtype="tidigare_beteckning" label="Tidigare beteckning">2.3<\/unitid>/);
  assert.match(klassXml, /<odd localtype="ansvarig">/);
  validate(klassXml, 'klass-2021.ead3.xml');
  console.log('✓ klassificering: arkiv, arkivbildare, version, tidigare beteckning');

  // 2. Arkivförteckning, full
  const fullXml = buildEad3(await load(knex, forteckning), fixed);
  assert.match(fullXml, /<c level="series"/);
  assert.match(fullXml, /<c level="file"/);
  assert.match(fullXml, /<physloc localtype="forvaras_i">Förvaring MAU: A-3-12 Kartong 12<\/physloc>/);
  assert.match(fullXml, /<odd localtype="redovisas_under">\s*<head>redovisas under<\/head>\s*<p>Klassificeringsstruktur 2021–: 1.2.3 Hantera leverantörsfakturor<\/p>/);
  assert.match(fullXml, /<accessrestrict localtype="sekretess">/);
  assert.match(fullXml, /<appraisal localtype="gallring">/);
  validate(fullXml, 'forteckning-full.ead3.xml');
  console.log('✓ arkivförteckning: förvaras i + redovisas under, sekretess i full export');

  // 3. Arkivförteckning, public
  const pubXml = buildEad3(await load(knex, forteckning, { publicOnly: true }), { ...fixed, publicOnly: true });
  assert.doesNotMatch(pubXml, /sekretess/, 'is_public = 0 field hidden');
  assert.doesNotMatch(pubXml, /physloc/, 'storage in unpublished Förvaring hidden');
  assert.match(pubXml, /redovisas_under/, 'link to a published classification is shown');
  assert.match(pubXml, /Malmö universitet<\/part>/);
  validate(pubXml, 'forteckning-public.ead3.xml');
  console.log('✓ public export hides secret field and storage');

  // 4. Unpublished creator → no <origination> publicly, but still in the full export
  await knex('archive_creators').where({ name: 'Malmö universitet' }).update({ is_published: false });
  const hidden = buildEad3(await load(knex, forteckning, { publicOnly: true }), { ...fixed, publicOnly: true });
  assert.doesNotMatch(hidden, /origination/);
  assert.match(buildEad3(await load(knex, forteckning), fixed), /origination/);
  validate(hidden, 'forteckning-public-nocreator.ead3.xml');
  console.log('✓ unpublished arkivbildare hidden publicly');

  // 5. Förvaring: unpublished → not public; full export has both top nodes under the archive
  assert.equal(await loadStructure(knex, forv, { publicOnly: true }), null);
  const forvXml = buildEad3(await load(knex, forv), fixed);
  assert.match(forvXml, /<c level="otherlevel" otherlevel="kartong"/);
  assert.ok(forvXml.indexOf('Arkivlokal A') < forvXml.indexOf('Arkivlokal B'), 'sort_order respected');
  validate(forvXml, 'forvaring-full.ead3.xml');
  console.log('✓ förvaring: not public, full export ok');

  // 6. Structure with no archive link → falls back to the old behaviour
  const [inserted] = await knex('structures').insert(
    { code: 'los', name: 'Lös struktur', structure_type: 'klassificering', is_published: true }, ['id']);
  const loose = (inserted as { id: number }).id;
  const typeId = await idOf(knex, 'node_types', 'verksamhetsomrade');
  await knex('nodes').insert({ structure_id: loose, node_type_id: typeId, title: 'Ensam rot', is_published: true });
  const looseXml = buildEad3(await load(knex, loose), fixed);
  assert.match(looseXml, /<archdesc level="class">/);
  assert.doesNotMatch(looseXml, /origination/);
  validate(looseXml, 'los.ead3.xml');
  console.log('✓ structure without archive');

  await knex.destroy();
  console.log('All EAD3 export tests passed');
})().catch((e: unknown) => { console.error(e); process.exit(1); });
