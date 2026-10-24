/**
 * Demo data – built to look like Klara (Arkivfunktionen's current system).
 *
 * Klara has two top trees, Struktur and Förvaring:
 *
 *   Struktur
 *     Malmö universitet                                  arkivbildare
 *       Informationshanteringsplan (version 2)           klassificeringsstruktur
 *         1 Leda verksamhet                              verksamhetsområde   ← real level names
 *           1.1 Okategoriserade ärenden inom leda verksamhet        processgrupp
 *             1.1.1 Hantera okategoriserade ärenden inom leda verksamhet  process
 *               HS → HT1, HT2                            handlingsslag → handlingstyp (EXAMPLES)
 *         2 Stödja verksamhet, 3 Bedriva utbildning
 *         4 Bedriva forskning → 4.1 → 4.1.1, 4.2 → 4.2.1 → HS → HT1–HT3 (EXAMPLES)
 *     Malmö högskola 1998–2015                           second arkivbildare (GV/LS import later)
 *
 *   Förvaring  (as in Klara's KS_IHP.ead3, tree "recordkeepingentity")
 *     Verksamhetssystem → Ladok, Primula, Canvas
 *     Arkivförteckning 2016–2023
 *     Arkivförteckning 2024- → 4.2.1 → Svit 1 → Arkivbox 1
 *
 *   Relation:  Svit 1 --redovisas under--> HT1 Ansökan om extern finansiering
 *
 * Level names 1–4.2.1 are taken from Klara. Handlingstyper, field values, svit and
 * box are EXAMPLES. Which fields are fritext / listruta / ja-nej is a PROPOSAL to
 * confirm with Arkivfunktionen.
 *
 * The arkivbildare is reached through archives + archive_structures (migration 007).
 * Whether a klassificeringsstruktur must belong directly to one arkivbildare is an
 * open question for the client.
 */

exports.seed = async function (knex) {
  // ---- Clear in dependency order (children before parents) ------------------
  await knex('transfer_jobs').del();
  await knex('structure_versions').del();
  await knex('change_log').del();
  await knex('ad_group_roles').del();
  await knex('node_relations').del();
  await knex('relation_types').del();
  await knex('node_property_values').del();
  await knex('property_options').del();
  await knex('property_definitions').del();
  await knex('archive_structures').del();
  await deleteTree(knex, 'nodes');            // leaves first – a parent with children is protected
  await knex('node_type_rules').del();
  await knex('node_types').del();
  await knex('structures').update({ previous_structure_id: null });
  await knex('structures').del();
  await knex('archives').del();
  await deleteTree(knex, 'archive_creators');
  await knex('users').del();

  const insert = async (table, row) => {
    const [result] = await knex(table).insert(row, ['id']);
    return result.id;
  };

  // ---- Demo user (normally created on first SSO login) ----------------------
  const admin = await insert('users', {
    ad_object_id: '00000000-0000-0000-0000-000000000001',
    username: 'demo.arkivarie',
    display_name: 'Demo Arkivarie',
  });
  const by = { created_by: admin, updated_by: admin };

  // ---- Arkivbildare and arkiv -------------------------------------------------
  const mau = await insert('archive_creators', { name: 'Malmö universitet', is_published: true, ...by });
  await insert('archive_creators', {
    name: 'Malmö högskola 1998–2015', start_year: 1998, end_year: 2015, is_published: true,
    description: 'Föregångare till Malmö universitet. Arkivförteckningarna (GV, LS) importeras senare.', ...by,
  });
  const arkivMau = await insert('archives', {
    archive_creator_id: mau, reference_code: 'MAU-001', name: 'Malmö universitets arkiv', is_published: true, ...by,
  });

  // ---- Structures: one per top tree -------------------------------------------------
  const org = { agency_code: 'SE-MAU', agency_name: 'Malmö universitet, Arkivfunktionen', license: 'CC0' };
  const ihp = await insert('structures', {
    code: 'ihp', name: 'Informationshanteringsplan', structure_type: 'klassificering',
    version: '2', is_published: true, ...org, ...by,
  });
  const forv = await insert('structures', {
    code: 'forvaring', name: 'Förvaringsenheter', structure_type: 'forvaring',
    is_published: true, ...org, ...by,
  });

  await knex('archive_structures').insert([
    { archive_id: arkivMau, structure_id: ihp, created_by: admin },
    { archive_id: arkivMau, structure_id: forv, created_by: admin },
  ]);

  // ---- Node types -------------------------------------------------------------
  const t = (code, name, structure_type, ead_level, ead_otherlevel, ead_unit_description) =>
    insert('node_types', { code, name, structure_type, ead_level, ead_otherlevel, ead_unit_description });

  // Struktur (RA-FS 2008:4 / FGS): verksamhetsområde → processgrupp → process → HS → HT
  // Klara exports all three as otherlevel="structuralunit" and tells them apart with
  // <didnote localtype="structuralunitdescription">, so the import can only find them this way.
  const su = 'structuralunit';
  const omrade  = await t('verksamhetsomrade', 'Verksamhetsområde', 'klassificering', 'otherlevel', su, 'Verksamhetsområde');
  const pgrupp  = await t('processgrupp',      'Processgrupp',      'klassificering', 'otherlevel', su, 'Processgrupp');
  const process = await t('process',           'Process',           'klassificering', 'otherlevel', su, 'Process');
  const hslag   = await t('handlingsslag',     'Handlingsslag',     'klassificering', 'otherlevel', 'recordgroup');
  const htyp    = await t('handlingstyp',      'Handlingstyp',      'klassificering', 'otherlevel', 'recordtype');
  // Förvaring – @otherlevel values as in Klara's export
  const enhet   = await t('strukturenhet',     'Strukturenhet',     'forvaring', 'otherlevel', 'Strukturenhet');
  const system  = await t('verksamhetssystem', 'Verksamhetssystem', 'forvaring', 'otherlevel', 'Verksamhetssystem');
  const svit    = await t('svit',              'Svit',              'forvaring', 'otherlevel', 'Svit');
  const box     = await t('arkivbox',          'Arkivbox',          'forvaring', 'otherlevel', 'Arkivbox');

  await knex('node_type_rules').insert([
    { parent_type_id: omrade,  child_type_id: pgrupp },
    { parent_type_id: pgrupp,  child_type_id: process },
    { parent_type_id: process, child_type_id: hslag },
    { parent_type_id: hslag,   child_type_id: htyp },
    { parent_type_id: enhet,   child_type_id: enhet },
    { parent_type_id: enhet,   child_type_id: system },
    { parent_type_id: enhet,   child_type_id: svit },
    { parent_type_id: svit,    child_type_id: box },
  ]);

  // ---- Property definitions ----------------------------------------------------
  const pd = (row) => insert('property_definitions', row);
  const pAnsv = await pd({ node_type_id: process, key: 'ansvarig', label: 'Ansvarig roll', data_type: 'text', ead_element: null, sort_order: 1 });

  // Handlingstyp – fields from the client's Excel. Name and Beskrivning are nodes.title / description.
  // ead_element follows Klara's export: sekretess → accessrestrict, legal basis → appraisal.
  const hSekr  = await pd({ node_type_id: htyp, key: 'sekretess',             label: 'Sekretess',             data_type: 'text',    ead_element: 'accessrestrict', sort_order: 1, is_public: false,
    help_text: 'Ange paragraf i OSL, t.ex. "OSL 21 kap. 1 §". Lämna tomt om ingen sekretess.' });
  const hGallr = await pd({ node_type_id: htyp, key: 'gallringsforeskrifter', label: 'Gallringsföreskrifter', data_type: 'text',    ead_element: 'appraisal',      sort_order: 2,
    help_text: 'Rättslig grund, t.ex. "RA-FS 2021:6". Själva gallringen görs manuellt.' });
  const hBev   = await pd({ node_type_id: htyp, key: 'bevaras',               label: 'Bevaras / gallras',     data_type: 'enum',    ead_element: null,             sort_order: 3 });
  const hDiar  = await pd({ node_type_id: htyp, key: 'diariefors',            label: 'Diarieförs',            data_type: 'boolean', ead_element: null,             sort_order: 4 });
  await knex('property_options').insert([
    { property_definition_id: hBev, value: 'Bevaras',              sort_order: 1 },
    { property_definition_id: hBev, value: 'Gallras',              sort_order: 2 },
    { property_definition_id: hBev, value: 'Gallras efter beslut', sort_order: 3 },
  ]);

  // Förvaring
  const sTid  = await pd({ node_type_id: svit, key: 'tidsomfang', label: 'Tidsomfång', data_type: 'text', ead_element: 'did/unitdate', sort_order: 1 });
  const bPlac = await pd({ node_type_id: box,  key: 'placering',  label: 'Placering',  data_type: 'text', ead_element: 'did/physloc',  sort_order: 1, is_public: false,
    help_text: 'Var boxen står, t.ex. arkivlokal och hylla.' });

  // ---- Helpers ------------------------------------------------------------------
  const n = (row) => insert('nodes', { is_published: true, ...by, ...row });
  const vals = (rows) => knex('node_property_values').insert(rows.map((r) => ({ updated_by: admin, ...r })));
  let order = 0;
  const top = (code, title) => n({ structure_id: ihp, node_type_id: omrade, reference_code: code, title, sort_order: order++ });
  const under = (parent, type, code, title, extra = {}) =>
    n({ structure_id: ihp, parent_id: parent, node_type_id: type, reference_code: code, title, ...extra });

  // ---- Struktur: Informationshanteringsplan (level names from Klara) --------------------
  const v1 = await top('1', 'Leda verksamhet');
  const v2 = await top('2', 'Stödja verksamhet');
  const v3 = await top('3', 'Bedriva utbildning');
  const v4 = await top('4', 'Bedriva forskning');
  void v2; void v3;

  const g11  = await under(v1,  pgrupp,  '1.1',   'Okategoriserade ärenden inom leda verksamhet');
  const p111 = await under(g11, process, '1.1.1', 'Hantera okategoriserade ärenden inom leda verksamhet');
  const g41  = await under(v4,  pgrupp,  '4.1',   'Okategoriserade ärenden inom forskning');
  await under(g41, process, '4.1.1', 'Hantera okategoriserade ärenden inom forskning');
  const g42  = await under(v4,  pgrupp,  '4.2',   'Förbereda forskning och söka extern finansiering', { sort_order: 1 });
  const p421 = await under(g42, process, '4.2.1', 'Förbereda forskning och söka extern finansiering');
  await vals([{ node_id: p421, property_definition_id: pAnsv, value_text: 'Projektledare' }]);

  // EXAMPLE handlingstyper (HS / HT1 … repeat under every process – allowed since migration 008)
  const hs111 = await under(p111, hslag, 'HS', 'Handlingsslag');
  const ht111a = await under(hs111, htyp, 'HT1', 'Inkommande handling', { description: 'Skrivelser som kommer in och inte hör till någon annan process.' });
  const ht111b = await under(hs111, htyp, 'HT2', 'Utgående handling', { sort_order: 1 });
  await vals([
    { node_id: ht111a, property_definition_id: hBev,  value_text: 'Bevaras' },
    { node_id: ht111a, property_definition_id: hDiar, value_boolean: true },
    { node_id: ht111b, property_definition_id: hBev,  value_text: 'Bevaras' },
    { node_id: ht111b, property_definition_id: hDiar, value_boolean: true },
  ]);

  const hs421 = await under(p421, hslag, 'HS', 'Handlingsslag');
  const ansokan = await under(hs421, htyp, 'HT1', 'Ansökan om extern finansiering', { description: 'Ansökan till forskningsfinansiär med bilagor.' });
  const beslut  = await under(hs421, htyp, 'HT2', 'Beslut om beviljade medel', { sort_order: 1 });
  const budget  = await under(hs421, htyp, 'HT3', 'Budgetunderlag', { sort_order: 2 });
  await vals([
    { node_id: ansokan, property_definition_id: hSekr,  value_text: 'OSL 24 kap. 8 §' },
    { node_id: ansokan, property_definition_id: hBev,   value_text: 'Bevaras' },
    { node_id: ansokan, property_definition_id: hDiar,  value_boolean: true },
    { node_id: beslut,  property_definition_id: hBev,   value_text: 'Bevaras' },
    { node_id: beslut,  property_definition_id: hDiar,  value_boolean: true },
    { node_id: budget,  property_definition_id: hGallr, value_text: 'RA-FS 2021:6' },
    { node_id: budget,  property_definition_id: hBev,   value_text: 'Gallras' },
    { node_id: budget,  property_definition_id: hDiar,  value_boolean: false },
  ]);

  // ---- Förvaring (as the recordkeepingentity tree in Klara's export) -------------------
  const f = (parent, type, code, title, extra = {}) =>
    n({ structure_id: forv, parent_id: parent, node_type_id: type, reference_code: code, title, ...extra });
  const vs = await f(null, enhet, null, 'Verksamhetssystem');
  await f(vs, system, null, 'Ladok');
  await f(vs, system, null, 'Primula', { sort_order: 1 });
  await f(vs, system, null, 'Canvas', { sort_order: 2 });
  await f(null, enhet, null, 'Arkivförteckning 2016–2023', { sort_order: 1 });
  const af24 = await f(null, enhet, null, 'Arkivförteckning 2024-', { sort_order: 2 });
  const af421 = await f(af24, enhet, '4.2.1', 'Förbereda forskning och söka extern finansiering');
  const svit1 = await f(af421, svit, '1', 'Ansökningar om extern finansiering');
  const box1  = await f(svit1, box, '1', 'Arkivbox 1');
  await vals([
    { node_id: svit1, property_definition_id: sTid,  value_text: '2024–' },
    { node_id: box1,  property_definition_id: bPlac, value_text: 'Arkivlokal, hylla 3' },
  ]);

  // ---- Relations between the trees ---------------------------------------------------
  await insert('relation_types', { code: 'forvaras_i', name: 'förvaras i', inverse_name: 'innehåller', ead_element: 'physloc' });
  const redovisas = await insert('relation_types', { code: 'redovisas_under', name: 'redovisas under', inverse_name: 'redovisar', ead_element: 'odd' });
  // Klara's <unitid localtype="relations"><ref target="…">, e.g. handlingstyp → verksamhetssystem.
  // The EAD import creates this type itself if a database has not been seeded.
  await insert('relation_types', { code: 'relaterad_till', name: 'relaterad till', inverse_name: 'relaterad från', ead_element: 'relatedmaterial' });
  await knex('node_relations').insert([
    { relation_type_id: redovisas, from_node_id: svit1, to_node_id: ansokan, created_by: admin },
  ]);

  // ---- Permissions (AD group names are placeholders) ------------------------------------
  await knex('ad_group_roles').insert([
    { ad_group: 'MAU-Arkivfunktionen', role: 'admin',  structure_id: null },
    { ad_group: 'MAU-Registratorer',   role: 'editor', structure_id: forv },
  ]);
};

/** Delete a self-referencing table leaf-first, because a parent with children is protected. */
async function deleteTree(knex, table) {
  for (;;) {
    const { n } = await knex(table).count({ n: '*' }).first();
    if (Number(n) === 0) return;
    await knex(table)
      .whereNotIn('id', knex(table).whereNotNull('parent_id').select('parent_id'))
      .del();
  }
}
