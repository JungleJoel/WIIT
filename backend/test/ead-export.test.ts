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
import { createTables } from './sqliteSchema';

// The seed is still JS – typed here until it is converted
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { seed } = require('../seeds/01_demo') as { seed: (knex: Knex) => Promise<void> };

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
  assert.equal(Number(count?.n), 26, 'seed re-run gives the same data');
  console.log('✓ seed runs twice');

  const fixed = { generatedAt: new Date('2026-10-11T12:00:00Z') };
  const ihp = await idOf(knex, 'structures', 'ihp');
  const forv = await idOf(knex, 'structures', 'forvaring');

  // 1. Informationshanteringsplan: archive + creator on top, version, levels as in Klara
  const ihpXml = buildEad3(await load(knex, ihp), fixed);
  assert.match(ihpXml, /<edition>2<\/edition>/);
  assert.match(ihpXml, /<archdesc level="fonds">/);
  assert.match(ihpXml, /<unitid>MAU-001<\/unitid>/);
  assert.match(ihpXml, /<origination label="Arkivbildare">\s*<corpname>\s*<part>Malmö universitet<\/part>/);
  assert.match(ihpXml, /<c level="otherlevel" otherlevel="structuralunit"[^>]*>\s*<did>\s*<unitid>1<\/unitid>\s*<unittitle>Leda verksamhet<\/unittitle>\s*<didnote localtype="structuralunitdescription">Verksamhetsområde<\/didnote>/,
    'structuralunit + didnote as in Klara (010)');
  assert.match(ihpXml, /<unitid>4.2.1<\/unitid>\s*<unittitle>Förbereda forskning och söka extern finansiering<\/unittitle>/);
  assert.match(ihpXml, /<odd localtype="ansvarig">/);
  validate(ihpXml, 'ihp.ead3.xml');
  console.log('✓ informationshanteringsplan: arkiv, arkivbildare, version, nivåer');

  // 1b. Handlingsslag / handlingstyp (Klara's recordgroup / recordtype) and their fields
  assert.match(ihpXml, /<c level="otherlevel" otherlevel="recordgroup"/);
  assert.match(ihpXml, /<c level="otherlevel" otherlevel="recordtype"/);
  assert.equal((ihpXml.match(/<unitid>HS<\/unitid>/g) || []).length, 2, 'HS under two processes (008)');
  assert.match(ihpXml, /<appraisal localtype="gallringsforeskrifter">[\s\S]*?RA-FS 2021:6/);
  assert.match(ihpXml, /<odd localtype="bevaras">[\s\S]*?<p>Gallras<\/p>/, 'enum value (009) exported as text');
  assert.match(ihpXml, /<odd localtype="diariefors">[\s\S]*?<p>Nej<\/p>/, 'ja/nej exported');
  assert.match(ihpXml, /<accessrestrict localtype="sekretess">[\s\S]*?OSL 24 kap/);
  const ihpPub = buildEad3(await load(knex, ihp, { publicOnly: true }), { ...fixed, publicOnly: true });
  assert.doesNotMatch(ihpPub, /OSL 24 kap/, 'sekretess on handlingstyp hidden publicly');
  assert.match(ihpPub, /Malmö universitet<\/part>/);
  validate(ihpPub, 'ihp-public.ead3.xml');
  console.log('✓ handlingsslag/handlingstyp: listruta, ja/nej, sekretess hidden publicly');

  // 2. Förvaring, full: Klara's otherlevel names, placering in <did>, link to the IHP
  const forvXml = buildEad3(await load(knex, forv), fixed);
  assert.match(forvXml, /<c level="otherlevel" otherlevel="Verksamhetssystem"/);
  assert.match(forvXml, /<c level="otherlevel" otherlevel="Svit"/);
  assert.match(forvXml, /<c level="otherlevel" otherlevel="Arkivbox"/);
  assert.match(forvXml, /<physloc localtype="placering" label="Placering">Arkivlokal, hylla 3<\/physloc>/);
  assert.match(forvXml, /<odd localtype="redovisas_under">\s*<head>redovisas under<\/head>\s*<p>Informationshanteringsplan: HT1 Ansökan om extern finansiering<\/p>/);
  assert.ok(forvXml.indexOf('Ladok') < forvXml.indexOf('Primula'), 'sort_order respected');
  validate(forvXml, 'forvaring-full.ead3.xml');
  console.log('✓ förvaring: verksamhetssystem, svit, arkivbox, redovisas under');

  // 3. Förvaring, public: placering hidden, link to a published classification still shown
  const forvPub = buildEad3(await load(knex, forv, { publicOnly: true }), { ...fixed, publicOnly: true });
  assert.doesNotMatch(forvPub, /physloc/, 'is_public = 0 field hidden');
  assert.match(forvPub, /redovisas_under/, 'link to a published classification is shown');
  validate(forvPub, 'forvaring-public.ead3.xml');
  console.log('✓ public export hides placering');

  // 4. Unpublished creator → no <origination> publicly, but still in the full export
  await knex('archive_creators').where({ name: 'Malmö universitet' }).update({ is_published: false });
  const hidden = buildEad3(await load(knex, ihp, { publicOnly: true }), { ...fixed, publicOnly: true });
  assert.doesNotMatch(hidden, /origination/);
  assert.match(buildEad3(await load(knex, ihp), fixed), /origination/);
  validate(hidden, 'ihp-public-nocreator.ead3.xml');
  console.log('✓ unpublished arkivbildare hidden publicly');

  // 5. Unpublished structure → nothing publicly
  await knex('structures').where({ id: forv }).update({ is_published: false });
  assert.equal(await loadStructure(knex, forv, { publicOnly: true }), null);
  console.log('✓ unpublished structure not public');

  // 6. Structure with no archive link → falls back to the old behaviour
  const [inserted] = await knex('structures').insert(
    { code: 'los', name: 'Lös struktur', structure_type: 'klassificering', is_published: true }, ['id']);
  const loose = (inserted as { id: number }).id;
  const typeId = await idOf(knex, 'node_types', 'verksamhetsomrade');
  await knex('nodes').insert({ structure_id: loose, node_type_id: typeId, title: 'Ensam rot', is_published: true });
  const looseXml = buildEad3(await load(knex, loose), fixed);
  assert.match(looseXml, /<archdesc level="otherlevel" otherlevel="structuralunit">/);
  assert.doesNotMatch(looseXml, /origination/);
  validate(looseXml, 'los.ead3.xml');
  console.log('✓ structure without archive');

  await knex.destroy();
  console.log('All EAD3 export tests passed');
})().catch((e: unknown) => { console.error(e); process.exit(1); });
