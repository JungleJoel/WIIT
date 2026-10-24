/**
 * EAD import test – runs without SQL Server (same SQLite setup as ead-export.test.ts).
 *
 *   npx tsx test/ead-import.test.ts
 *   EAD3_XSD=schema/ead3/ead3.xsd npx tsx test/ead-import.test.ts     (also validate exports)
 *   KLARA_FILE=path/to/KS_IHP.ead3 npx tsx test/ead-import.test.ts   (also import the real file)
 *
 * 1. Klara-shaped file (test/fixtures/klara-sample.ead3.xml, hand-written):
 *    two trees → two structures, node types from the seed are reused, relations
 *    between the trees, sekretess / gallring as properties, re-import refused.
 * 2. Round trip: export the seeded Informationshanteringsplan, import it, export again.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import knexLib, { type Knex } from 'knex';
import { createTables } from './sqliteSchema';
import { EadImportService, EadImportValidationError } from '../src/services/EADImportService';
import { EadImportConflictError } from '../src/ead/eadImport';
import { loadStructure, type TreeNode } from '../src/ead/loadStructure';
import { buildEad3 } from '../src/ead/buildEad3';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { seed } = require('../seeds/01_demo') as { seed: (knex: Knex) => Promise<void> };

const fixed = { generatedAt: new Date('2026-10-22T12:00:00Z') };

function validate(xml: string, name: string): void {
  const xsd = process.env.EAD3_XSD;
  if (!xsd) return;
  const file = path.join(process.env.OUT_DIR || '.', name);
  fs.writeFileSync(file, xml);
  execFileSync('xmllint', ['--noout', '--schema', xsd, file], { stdio: 'inherit' });
}

async function exportXml(knex: Knex, id: number): Promise<string> {
  const loaded = await loadStructure(knex, id);
  assert.ok(loaded);
  return buildEad3(loaded, fixed);
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

(async () => {
  const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await createTables(knex);
  await seed(knex);
  const service = new EadImportService(knex);
  const admin = (await knex('users').first('id')).id as number;
  const typesBefore = Number((await knex('node_types').count({ n: '*' }).first())?.n);

  // ── 1. Klara-shaped file ───────────────────────────────────────────────────
  const klara = fs.readFileSync(path.join(__dirname, 'fixtures/klara-sample.ead3.xml'), 'utf8');

  const preview = service.preview(klara);
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.trees.map((t) => [t.structureType, t.nodeCount]), [['klassificering', 11], ['forvaring', 7]]);
  assert.equal(Number((await knex('structures').count({ n: '*' }).first())?.n), 2, 'preview writes nothing');
  console.log('✓ preview: two trees, nothing written');

  const result = await service.import(klara, { sourceFileName: 'klara-sample.ead3.xml', userId: admin });
  const [ihp, fe] = result.structures;
  assert.ok(ihp && fe);
  assert.equal(ihp.structureType, 'klassificering');
  assert.equal(fe.structureType, 'forvaring');
  assert.equal(ihp.nodeCount + fe.nodeCount, 18);

  const ihpRow = await knex('structures').where({ id: ihp.id }).first();
  assert.equal(ihpRow.name, 'Informationshanteringsplan');
  assert.equal(ihpRow.version, 'Version 2');
  assert.equal(ihpRow.external_id, 'PS1004');
  assert.equal(ihpRow.description, 'Malmö universitets informationshanteringsplan.');
  console.log('✓ structures: name, version, external_id, description from the wrapper');

  // Node types: the seed's types are reused; only Arkivpaket is new
  assert.deepEqual(result.createdNodeTypes, ['Arkivpaket (forvaring)']);
  assert.equal(Number((await knex('node_types').count({ n: '*' }).first())?.n), typesBefore + 1);
  const typeOf = async (externalId: string): Promise<string> =>
    (await knex('nodes as n').join('node_types as t', 't.id', 'n.node_type_id')
      .whereIn('n.structure_id', [ihp.id, fe.id])
      .andWhere('n.external_id', externalId).first('t.code')).code;
  assert.equal(await typeOf('PR1'), 'verksamhetsomrade');
  assert.equal(await typeOf('PR11'), 'processgrupp');
  assert.equal(await typeOf('PR111'), 'process');
  assert.equal(await typeOf('HS111'), 'handlingsslag');
  assert.equal(await typeOf('AT1'), 'handlingstyp');
  assert.equal(await typeOf('UN-LADOK'), 'verksamhetssystem');
  assert.equal(await typeOf('UN-S1'), 'svit');
  console.log('✓ node types: structuralunit + didnote → verksamhetsområde/processgrupp/process; seed types reused');

  // Nodes: HS / HT1 repeat under different parents and are all kept as reference codes (008)
  const at1 = await knex('nodes').where({ structure_id: ihp.id, external_id: 'AT1' }).first();
  assert.equal(at1.reference_code, 'HT1');
  assert.equal(at1.description, 'Gallras 2 år efter avslutat ärende.\nBeslut bevaras.', '<br/> → newline');
  assert.equal(at1.source_updated_by, 'ai6999');
  assert.ok(at1.source_updated_at);
  assert.equal(Boolean(at1.is_published), true);
  const at2 = await knex('nodes').where({ structure_id: ihp.id, external_id: 'AT2' }).first();
  assert.equal(Boolean(at2.is_published), false, 'no audience → not published');
  assert.equal(Number((await knex('nodes').where({ structure_id: ihp.id, reference_code: 'HS' }).count({ n: '*' }).first())?.n), 2);
  console.log('✓ nodes: reference codes, <br/>, modified/modifiedby, audience');

  // Properties: the seed's handlingstyp fields are reused (same ead_element)
  const props = async (nodeId: number): Promise<Record<string, string[]>> => {
    const rows = await knex('node_property_values as v').join('property_definitions as d', 'd.id', 'v.property_definition_id')
      .where('v.node_id', nodeId).orderBy('v.value_order').select('d.key', 'v.value_text');
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.key] ??= []).push(r.value_text);
    return out;
  };
  const p1 = await props(at1.id);
  assert.deepEqual(p1.sekretess, ['OSL 21 kap. 1 §'], 'sekretess from <c><archdesc><accessrestrict>');
  assert.deepEqual(p1.gallringsforeskrifter, ['RA-FS 2021:6']);
  assert.deepEqual(p1.lank, ['https://www.mau.se/']);
  const sekr = await knex('property_definitions as d').join('node_types as t', 't.id', 'd.node_type_id')
    .where({ 't.code': 'handlingstyp', 'd.ead_element': 'accessrestrict' }).select('d.key');
  assert.deepEqual(sekr.map((r) => r.key), ['sekretess'], 'no duplicate field created');
  const svit = await knex('nodes').where({ structure_id: fe.id, external_id: 'UN-S1' }).first();
  assert.deepEqual((await props(svit.id)).placering, ['Arkivlokal Niagara']);
  console.log('✓ properties: sekretess, gallring, länk, placering in the existing fields');

  // Relations between the trees; the unknown target is kept, not lost
  assert.equal(result.relationCount, 3);
  const rel = await knex('node_relations as r').join('relation_types as rt', 'rt.id', 'r.relation_type_id')
    .join('nodes as t', 't.id', 'r.to_node_id').where('r.from_node_id', at1.id).select('rt.code', 't.title');
  assert.deepEqual(rel, [{ code: 'relaterad_till', title: 'Ladok' }]);
  assert.deepEqual((await props(at2.id)).ead_referens, ['UN-FINNS-INTE (Gammalt system)']);
  assert.ok(result.warnings.some((w) => /1 referens/.test(w)));
  console.log('✓ relations: handlingstyp → verksamhetssystem; unresolved ref kept as a field');

  // Logged
  const jobs = await knex('transfer_jobs').where({ direction: 'import' });
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every((j) => j.status === 'done' && j.file_name === 'klara-sample.ead3.xml'));
  console.log('✓ transfer_jobs: one row per structure');

  // Re-import is refused, and leaves nothing behind
  const nodesBefore = Number((await knex('nodes').count({ n: '*' }).first())?.n);
  await assert.rejects(service.import(klara), EadImportConflictError);
  assert.equal(Number((await knex('nodes').count({ n: '*' }).first())?.n), nodesBefore);
  console.log('✓ re-import refused (409), nothing written');

  await assert.rejects(service.import('<notead/>'), EadImportValidationError);
  await assert.rejects(service.import('<ead><archdesc><dsc><c><did/></c></dsc></archdesc></ead>'), EadImportValidationError);
  console.log('✓ broken files rejected (400)');

  // Export of what was imported
  const ihpXml = await exportXml(knex, ihp.id);
  assert.match(ihpXml, /<c level="otherlevel" otherlevel="structuralunit" id="PR1">/);
  assert.match(ihpXml, /<didnote localtype="structuralunitdescription">Processgrupp<\/didnote>/);
  assert.match(ihpXml, /<accessrestrict localtype="sekretess">[\s\S]*?OSL 21 kap\. 1 §/);
  assert.match(ihpXml, /<appraisal localtype="gallringsforeskrifter">[\s\S]*?RA-FS 2021:6/);
  assert.match(ihpXml, /<relatedmaterial localtype="relaterad_till">[\s\S]*?Grouping of record keeping entities: Ladok/);
  validate(ihpXml, 'imported-klara-ihp.ead3.xml');
  const feXml = await exportXml(knex, fe.id);
  assert.match(feXml, /otherlevel="Arkivpaket"/);
  validate(feXml, 'imported-klara-forvaring.ead3.xml');
  console.log('✓ exported again: valid EAD3 with sekretess, gallring, didnote and relations');

  // ── 2. Round trip of the seeded structure ───────────────────────────────────
  const seeded = (await knex('structures').where({ code: 'ihp' }).first('id')).id as number;
  const original = await loadStructure(knex, seeded);
  assert.ok(original);
  const xml1 = buildEad3(original, fixed);
  const back = await service.import(xml1, { structureName: 'IHP återimport' });
  assert.equal(back.structures.length, 1);
  const again = await loadStructure(knex, back.structures[0]!.id);
  assert.ok(again);

  const summary = (nodes: TreeNode[]): string[] => flatten(nodes).map((n) =>
    [n.reference_code, n.title, n.type.code, n.description ?? '',
      ...n.properties.map((p) => `${p.key}=${p.value}`).sort()].join(' | '));
  assert.deepEqual(summary(again.roots), summary(original.roots));
  assert.deepEqual(back.createdNodeTypes, [], 'every type found again');
  console.log(`✓ round trip: ${flatten(again.roots).length} nodes, titles, codes, types, fields identical`);

  // The client's Excel fields for handlingstyp keep their TYPE, not just their text
  const typed = await knex('node_property_values as v')
    .join('property_definitions as d', 'd.id', 'v.property_definition_id')
    .join('nodes as n', 'n.id', 'v.node_id')
    .where('n.structure_id', back.structures[0]!.id).whereIn('d.key', ['diariefors', 'bevaras'])
    .select('d.key', 'v.value_text', 'v.value_boolean');
  assert.ok(typed.filter((r) => r.key === 'diariefors').every((r) => r.value_boolean !== null && r.value_text === null),
    'ja/nej stored as boolean');
  assert.ok(typed.filter((r) => r.key === 'bevaras').every((r) => ['Bevaras', 'Gallras'].includes(r.value_text)),
    'listruta stored as the choice text');
  const odd = xml1.replace('<p>Gallras</p>', '<p>Gallras snart</p>').replace('IHP', 'IHP2');
  const bad = await service.import(odd.replace(/<recordid>[^<]*</, '<recordid>annan<'), { structureName: 'IHP listruta' });
  assert.ok(bad.warnings.some((w) => /finns inte i listrutan/.test(w)), 'value outside the listruta is reported');
  console.log('✓ Excel fields: ja/nej as boolean, listruta checked against its choices');

  // ── 3. Optional: the real Klara file ─────────────────────────────────────────
  if (process.env.KLARA_FILE) {
    const real = await service.import(fs.readFileSync(process.env.KLARA_FILE, 'utf8'),
      { sourceFileName: path.basename(process.env.KLARA_FILE) });
    console.log('Real file:', JSON.stringify({
      structures: real.structures, relations: real.relationCount,
      createdNodeTypes: real.createdNodeTypes, warnings: real.warnings.slice(0, 15),
      warningCount: real.warnings.length,
    }, null, 2));
    for (const s of real.structures) validate(await exportXml(knex, s.id), `real-${s.code}.ead3.xml`);
  }

  await knex.destroy();
  console.log('All EAD import tests passed');
})().catch((e: unknown) => { console.error(e); process.exit(1); });
