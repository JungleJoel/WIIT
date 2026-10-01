/**
 * WIIT – demo seed (draft v0)
 *
 * Creates example node types for a Struktur tree and a Förvaring tree,
 * a small tree in each, and a "förvaras i" relation between them.
 * The node types are placeholders to discuss with Arkivfunktionen.
 */

exports.seed = async function (knex) {
  // Clear in dependency order
  await knex('node_relations').del();
  await knex('node_property_values').del();
  await knex('nodes').del();
  await knex('node_type_rules').del();
  await knex('property_definitions').del();
  await knex('node_types').del();
  await knex('structures').del();

  const insert = async (table, row) => {
    const [result] = await knex(table).insert(row, ['id']);
    return result.id;
  };

  // --- Node types: Struktur (mapped to EAD3 levels) ---------------------------
  const arkiv    = await insert('node_types', { code: 'arkiv',    name: 'Arkiv',    structure_type: 'struktur', ead_level: 'fonds' });
  const serie    = await insert('node_types', { code: 'serie',    name: 'Serie',    structure_type: 'struktur', ead_level: 'series' });
  const delserie = await insert('node_types', { code: 'delserie', name: 'Delserie', structure_type: 'struktur', ead_level: 'subseries' });
  const volym    = await insert('node_types', { code: 'volym',    name: 'Volym',    structure_type: 'struktur', ead_level: 'file' });
  const handling = await insert('node_types', { code: 'handling', name: 'Handling', structure_type: 'struktur', ead_level: 'item' });

  // --- Node types: Förvaring (no EAD level of their own -> otherlevel) --------
  const lokal   = await insert('node_types', { code: 'arkivlokal', name: 'Arkivlokal', structure_type: 'forvaring', ead_level: 'otherlevel', ead_otherlevel: 'arkivlokal' });
  const hylla   = await insert('node_types', { code: 'hylla',      name: 'Hylla',      structure_type: 'forvaring', ead_level: 'otherlevel', ead_otherlevel: 'hylla' });
  const kartong = await insert('node_types', { code: 'kartong',    name: 'Kartong',    structure_type: 'forvaring', ead_level: 'otherlevel', ead_otherlevel: 'kartong' });

  // --- Allowed parent/child combinations --------------------------------------
  await knex('node_type_rules').insert([
    { parent_type_id: arkiv,    child_type_id: serie },
    { parent_type_id: serie,    child_type_id: delserie },
    { parent_type_id: serie,    child_type_id: volym },
    { parent_type_id: delserie, child_type_id: volym },
    { parent_type_id: volym,    child_type_id: handling },
    { parent_type_id: lokal,    child_type_id: hylla },
    { parent_type_id: hylla,    child_type_id: kartong },
  ]);

  // --- Property definitions ----------------------------------------------------
  const serieTid     = await insert('property_definitions', { node_type_id: serie, key: 'tidsomfang',  label: 'Tidsomfång',  data_type: 'text', ead_element: 'did/unitdate', sort_order: 1 });
  const serieBeskr   = await insert('property_definitions', { node_type_id: serie, key: 'beskrivning', label: 'Beskrivning', data_type: 'text', ead_element: 'scopecontent', sort_order: 2 });
  const serieGallr   = await insert('property_definitions', { node_type_id: serie, key: 'gallring',    label: 'Gallring',    data_type: 'text', ead_element: 'appraisal',    sort_order: 3 });
  const volymTid     = await insert('property_definitions', { node_type_id: volym, key: 'tidsomfang',  label: 'Tidsomfång',  data_type: 'text', ead_element: 'did/unitdate', sort_order: 1 });
  await insert('property_definitions',                       { node_type_id: arkiv, key: 'arkivbildare', label: 'Arkivbildare', data_type: 'text', ead_element: 'did/origination', is_required: true, sort_order: 1 });

  // --- Struktur tree -----------------------------------------------------------
  const struktur = await insert('structures', { name: 'Malmö universitet – Struktur (demo)', structure_type: 'struktur' });

  const nArkiv  = await insert('nodes', { structure_id: struktur, parent_id: null,   node_type_id: arkiv, title: 'Malmö universitet',          reference_code: 'MAU',     sort_order: 1 });
  const nSerieF = await insert('nodes', { structure_id: struktur, parent_id: nArkiv, node_type_id: serie, title: 'Examensarbeten',             reference_code: 'MAU-F1',  sort_order: 1 });
  const nVolym1 = await insert('nodes', { structure_id: struktur, parent_id: nSerieF, node_type_id: volym, title: 'Examensarbeten 2024',       reference_code: 'MAU-F1:1', sort_order: 1 });
  await insert('nodes',                  { structure_id: struktur, parent_id: nSerieF, node_type_id: volym, title: 'Examensarbeten 2025',       reference_code: 'MAU-F1:2', sort_order: 2 });

  await knex('node_property_values').insert([
    { node_id: nSerieF, property_definition_id: serieTid,   value: '2020–' },
    { node_id: nSerieF, property_definition_id: serieBeskr, value: 'Godkända examensarbeten på grund- och avancerad nivå.' },
    { node_id: nSerieF, property_definition_id: serieGallr, value: 'Bevaras' },
    { node_id: nVolym1, property_definition_id: volymTid,   value: '2024' },
  ]);

  // --- Förvaring tree ----------------------------------------------------------
  const forvaring = await insert('structures', { name: 'Malmö universitet – Förvaring (demo)', structure_type: 'forvaring' });

  const nLokal   = await insert('nodes', { structure_id: forvaring, parent_id: null,    node_type_id: lokal,   title: 'Arkivlokal Orkanen', sort_order: 1 });
  const nHylla   = await insert('nodes', { structure_id: forvaring, parent_id: nLokal,  node_type_id: hylla,   title: 'Hylla 3',            sort_order: 1 });
  const nKartong = await insert('nodes', { structure_id: forvaring, parent_id: nHylla,  node_type_id: kartong, title: 'Kartong 12',         sort_order: 1 });

  // --- Relation between the trees -------------------------------------------------
  await knex('node_relations').insert({
    source_node_id: nVolym1,
    target_node_id: nKartong,
    relation_type: 'forvaras_i',
  });
};
