/**
 * Demo data – the combined model (generic trees + Lilas' archive concepts).
 *
 *   Arkivbildare:      Malmö universitet → Fakulteten för teknik och samhälle
 *   Arkiv:             MAU-001 Malmö universitets arkiv (uses all three structures below)
 *
 *   Klassificering:    1 Styra och leda verksamheten → 2 Ekonomi → 2.3 Hantera leverantörsfakturor
 *   Arkivförteckning:  F2 Fakturor → F2:1 Volym 1
 *   Förvaring:         Arkivlokal A → Hylla 3 → Kartong 12      (+ Arkivlokal B)
 *
 *   Relations:         F2 Fakturor --redovisas under--> 2.3 Hantera leverantörsfakturor
 *                      F2 Fakturor --förvaras i-->      Kartong 12
 *
 * Node types and fields are placeholders to confirm with Arkivfunktionen
 * (ideally replaced by a real extract from Klara).
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
  const mau = await insert('archive_creators', {
    name: 'Malmö universitet', start_year: 1998, is_published: true,
    description: 'Statlig högskola 1998–2018, universitet från 2018.', ...by,
  });
  await insert('archive_creators', {
    parent_id: mau, name: 'Fakulteten för teknik och samhälle', start_year: 2005, is_published: true, ...by,
  });
  const arkivMau = await insert('archives', {
    archive_creator_id: mau, reference_code: 'MAU-001', name: 'Malmö universitets arkiv',
    start_year: 1998, is_published: true, ...by,
  });

  // ---- Structures (three types) ------------------------------------------------
  const org = { agency_code: 'SE-MAU', agency_name: 'Malmö universitet, Arkivfunktionen', license: 'CC0' };
  const klass2015 = await insert('structures', {
    code: 'klass-2015', name: 'Klassificeringsstruktur 2015', structure_type: 'klassificering',
    version: '2015', valid_from: '2015-01-01', valid_to: '2020-12-31', is_published: true, ...org, ...by,
  });
  const klass = await insert('structures', {
    code: 'klass-2021', name: 'Klassificeringsstruktur 2021–', structure_type: 'klassificering',
    version: '2021', previous_structure_id: klass2015, valid_from: '2021-01-01', is_published: true, ...org, ...by,
  });
  const forteckning = await insert('structures', {
    code: 'mau-001-forteckning', name: 'Arkivförteckning MAU-001', structure_type: 'arkivforteckning',
    is_published: true, ...org, ...by,
  });
  const forv = await insert('structures', {
    code: 'forvaring', name: 'Förvaring MAU', structure_type: 'forvaring',
    is_published: false, ...org, ...by,
  });

  // Which structures the archive uses, and when (Lilas: archive_classification_structures)
  await knex('archive_structures').insert([
    { archive_id: arkivMau, structure_id: klass2015, valid_from: '2015-01-01', valid_to: '2020-12-31', created_by: admin },
    { archive_id: arkivMau, structure_id: klass, valid_from: '2021-01-01', created_by: admin },
    { archive_id: arkivMau, structure_id: forteckning, created_by: admin },
    { archive_id: arkivMau, structure_id: forv, created_by: admin },
  ]);

  // ---- Node types -------------------------------------------------------------
  const t = (code, name, structure_type, ead_level, ead_otherlevel) =>
    insert('node_types', { code, name, structure_type, ead_level, ead_otherlevel });

  // Klassificering (RA-FS 2008:4 / FGS: verksamhetsområde → processgrupp → process)
  const omrade   = await t('verksamhetsomrade', 'Verksamhetsområde', 'klassificering', 'class');
  const pgrupp   = await t('processgrupp',      'Processgrupp',      'klassificering', 'class');
  const process  = await t('process',           'Process',           'klassificering', 'class');
  // Arkivförteckning
  const serie    = await t('serie',    'Serie',    'arkivforteckning', 'series');
  const delserie = await t('delserie', 'Delserie', 'arkivforteckning', 'subseries');
  const volym    = await t('volym',    'Volym',    'arkivforteckning', 'file');
  // Förvaring
  const lokal    = await t('arkivlokal', 'Arkivlokal', 'forvaring', 'otherlevel', 'arkivlokal');
  const hylla    = await t('hylla',      'Hylla',      'forvaring', 'otherlevel', 'hylla');
  const kartong  = await t('kartong',    'Kartong',    'forvaring', 'otherlevel', 'kartong');

  await knex('node_type_rules').insert([
    { parent_type_id: omrade,   child_type_id: pgrupp },
    { parent_type_id: pgrupp,   child_type_id: process },
    { parent_type_id: serie,    child_type_id: delserie },
    { parent_type_id: serie,    child_type_id: volym },
    { parent_type_id: delserie, child_type_id: volym },
    { parent_type_id: lokal,    child_type_id: hylla },
    { parent_type_id: hylla,    child_type_id: kartong },
  ]);

  // ---- Property definitions ----------------------------------------------------
  const pd = (row) => insert('property_definitions', row);
  const pTid   = await pd({ node_type_id: serie, key: 'tidsomfang',  label: 'Tidsomfång',  data_type: 'text',     ead_element: 'did/unitdate', sort_order: 1 });
  const pBeskr = await pd({ node_type_id: serie, key: 'beskrivning', label: 'Beskrivning', data_type: 'longtext', ead_element: 'scopecontent', sort_order: 2 });
  const pGallr = await pd({ node_type_id: serie, key: 'gallring',    label: 'Gallring',    data_type: 'text',     ead_element: 'appraisal',    sort_order: 3,
    help_text: 'Skriv regeln i klartext, t.ex. "Gallras efter 2 år". Gallring sker manuellt.' });
  const pSekr  = await pd({ node_type_id: serie, key: 'sekretess',   label: 'Sekretess (OSL)', data_type: 'text', ead_element: 'accessrestrict', sort_order: 4, is_public: false });
  const pAnsv  = await pd({ node_type_id: process, key: 'ansvarig',  label: 'Ansvarig roll', data_type: 'text', ead_element: null, sort_order: 1 });

  // ---- Klassificering tree -------------------------------------------------------
  const n = (row) => insert('nodes', { ...by, ...row });
  const k1  = await n({ structure_id: klass, node_type_id: omrade,  reference_code: '1',   title: 'Styra och leda verksamheten', is_published: true });
  const k2  = await n({ structure_id: klass, parent_id: k1, node_type_id: pgrupp,  reference_code: '1.2', title: 'Ekonomi', is_published: true });
  const k23 = await n({ structure_id: klass, parent_id: k2, node_type_id: process, reference_code: '1.2.3', previous_reference_code: '2.3',
    title: 'Hantera leverantörsfakturor', is_published: true });
  await knex('node_property_values').insert({ node_id: k23, property_definition_id: pAnsv, value_text: 'Ekonomichef', updated_by: admin });

  // ---- Arkivförteckning tree ------------------------------------------------------
  const fakturor = await n({ structure_id: forteckning, node_type_id: serie, reference_code: 'F2', title: 'Fakturor', is_published: true,
    portal_url: 'https://arkiv.internal.mau.se/' });
  await n({ structure_id: forteckning, parent_id: fakturor, node_type_id: volym, reference_code: 'F2:1', title: 'Volym 1',
    valid_from: '2021-01-01', valid_to: '2021-12-31', is_published: true });

  await knex('node_property_values').insert([
    { node_id: fakturor, property_definition_id: pTid,   value_text: '2021–', updated_by: admin },
    { node_id: fakturor, property_definition_id: pBeskr, value_text: 'Leverantörsfakturor med underlag.', updated_by: admin },
    { node_id: fakturor, property_definition_id: pGallr, value_text: 'Gallras efter 10 år', updated_by: admin },
    { node_id: fakturor, property_definition_id: pSekr,  value_text: 'Kan innehålla uppgifter som omfattas av sekretess.', updated_by: admin },
  ]);

  // ---- Förvaring tree ---------------------------------------------------------------
  const lokalA = await n({ structure_id: forv, node_type_id: lokal, reference_code: 'A', title: 'Arkivlokal A' });
  await n({ structure_id: forv, node_type_id: lokal, reference_code: 'B', title: 'Arkivlokal B', sort_order: 1 });
  const hylla3 = await n({ structure_id: forv, parent_id: lokalA, node_type_id: hylla,   reference_code: 'A-3',    title: 'Hylla 3' });
  const kart12 = await n({ structure_id: forv, parent_id: hylla3, node_type_id: kartong, reference_code: 'A-3-12', title: 'Kartong 12' });

  // ---- Relations between the trees ---------------------------------------------------
  const forvarasI = await insert('relation_types', { code: 'forvaras_i', name: 'förvaras i', inverse_name: 'innehåller', ead_element: 'physloc' });
  const redovisas = await insert('relation_types', { code: 'redovisas_under', name: 'redovisas under', inverse_name: 'redovisar', ead_element: 'odd' });
  await knex('node_relations').insert([
    { relation_type_id: forvarasI, from_node_id: fakturor, to_node_id: kart12, created_by: admin },
    { relation_type_id: redovisas, from_node_id: fakturor, to_node_id: k23,    created_by: admin },
  ]);

  // ---- Permissions (AD group names are placeholders) ------------------------------------
  await knex('ad_group_roles').insert([
    { ad_group: 'MAU-Arkivfunktionen', role: 'admin',  structure_id: null },
    { ad_group: 'MAU-Registratorer',   role: 'editor', structure_id: forteckning },
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
