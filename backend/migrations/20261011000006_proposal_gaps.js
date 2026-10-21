/**
 * 006 – gaps against the project proposal (Malmö universitet, "Webbapplikation
 *       för informationsredovisning i trädstrukturer") and the EAD3 export.
 *
 * nodes
 *   valid_from / valid_to   Giltighetstid per node. A process or serie can be closed
 *                           without being deleted (Arkivlagen: never lose history).
 *                           Exported as EAD3 <unitdate> when no date property is set.
 *   description             Short free-text description shown on the public site.
 *                           Exported as EAD3 <scopecontent>.
 *   portal_url              Deep link to the same object in MAU Arkiv
 *                           ("sömlöst länka till arkivportalen"). Exported as <dao>.
 *
 * structures
 *   agency_code / agency_name   Who maintains the description – required in EAD3 <control>.
 *   language_code               Language of the description (ISO 639-2b, 'swe').
 *   license                     The structure is published openly; record under what terms.
 *
 * Everything is nullable, so existing rows and the 001–005 seed keep working.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('nodes', (t) => {
    t.date('valid_from');
    t.date('valid_to');
    t.text('description');
    t.string('portal_url', 1000);
  });
  // Knex does not fill in ?? bindings for a CHECK added via alterTable
  await knex.raw(`
    ALTER TABLE nodes ADD CONSTRAINT ck_nodes_valid_range
      CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
  `);

  await knex.schema.alterTable('structures', (t) => {
    t.string('agency_code', 50);                        // ISIL or local code, e.g. 'SE-MAU'
    t.string('agency_name', 255);                       // 'Malmö universitet, Arkivfunktionen'
    t.string('language_code', 3).notNullable().defaultTo('swe');
    t.string('license', 100);                           // e.g. 'CC0' for the published metadata
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('structures', (t) => {
    t.dropColumn('license');
    t.dropColumn('language_code');
    t.dropColumn('agency_name');
    t.dropColumn('agency_code');
  });
  await knex.raw('ALTER TABLE nodes DROP CONSTRAINT ck_nodes_valid_range');
  await knex.schema.alterTable('nodes', (t) => {
    t.dropColumn('portal_url');
    t.dropColumn('description');
    t.dropColumn('valid_to');
    t.dropColumn('valid_from');
  });
};
