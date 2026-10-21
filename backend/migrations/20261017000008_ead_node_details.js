/**
 * 008 – keep what the EAD import reads, so the tree can be rebuilt and exported.
 *
 * Design rule: a value that is single per node and present on most nodes becomes a
 * column on `nodes`. Rare or repeatable EAD elements reuse the existing custom-field
 * tables (custom_field_definitions / classification_node_custom_values, migration
 * 20261016) instead of getting their own table.
 */

exports.up = async function (knex) {

  /**
   * nodes – new columns
   *
   * unit_id                       The original EAD <unitid> of the node (e.g. '1.1.1', 'HS', 'HT3').
   *                               Kept separately from reference_code because reference_code is
   *                               UNIQUE per structure while ids like 'HS' and 'HT1' repeat under
   *                               every process. Nothing is lost on import.
   * unit_id_label                 The @label attribute of that <unitid> (e.g. 'Version 2').
   * structural_unit_description   Text of <didnote localtype="structuralunitdescription">, e.g.
   *                               'Verksamhetsområde', 'Processgrupp', 'Process'. Only present on
   *                               otherlevel="structuralunit" nodes; it decides the node type and
   *                               is stored so the EAD can be written back identically.
   * access_restrict               Text of <accessrestrict> (sekretess grounds, e.g. 'OSL 21 kap. 1 §').
   *                               A column, not a custom field, because it is a core
   *                               informationshanteringsplan property.
   */
  await knex.schema.alterTable('nodes', (t) => {
    t.string('unit_id', 255).nullable();
    t.string('unit_id_label', 255).nullable();
    t.string('structural_unit_description', 100).nullable();
    t.text('access_restrict').nullable();
  });

  /**
   * node_ead_refs – links between nodes that come from the EAD file
   *
   * One row per <unitid localtype="relations"><ref target="…"> element.
   * A node can point to several targets, so a single column on nodes would not be enough.
   * The target often lives in a tree that is not imported yet (the recordkeepingentity
   * branch), so the raw EAD id is kept and resolved later.
   *
   *   node_id          The node that holds the link (source).
   *   target_ead_id    The EAD @id of the target <c> (ref/@target). Always filled.
   *   label            Visible link text of the <ref> (e.g. 'Verksamhetssystem').
   *   link_role        ref/@linkrole (e.g. 'internal').
   *   target_node_id   The real target node once it exists in the database; NULL until then.
   *                    NO ACTION, because SQL Server forbids a second cascade path to nodes.
   *
   * Temporary by design: once the target tree is imported, these rows are converted
   * into node_relations and this table can be dropped.
   */
  await knex.schema.createTable('node_ead_refs', (t) => {
    t.increments('id').primary();
    t.integer('node_id').notNullable().references('id').inTable('nodes').onDelete('CASCADE');
    t.string('target_ead_id', 255).nullable();
    t.string('label', 500).nullable();
    t.string('link_role', 100).nullable();
    t.integer('target_node_id').nullable().references('id').inTable('nodes').onDelete('NO ACTION');
    t.index(['node_id'], 'ix_node_ead_refs_node');
    t.index(['target_ead_id'], 'ix_node_ead_refs_target');
  });

  /**
   * node_types – data fix (no schema change)
   *
   * verksamhetsomrade / processgrupp / process are EAD level="otherlevel"
   * otherlevel="structuralunit" (told apart by structural_unit_description), not level 'class'.
   */
  await knex('node_types')
    .whereIn('code', ['verksamhetsomrade', 'processgrupp', 'process'])
    .where({ ead_level: 'class' })
    .update({ ead_level: 'otherlevel', ead_otherlevel: 'structuralunit' });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('node_ead_refs');
  await knex.schema.alterTable('nodes', (t) => {
    t.dropColumn('access_restrict');
    t.dropColumn('structural_unit_description');
    t.dropColumn('unit_id_label');
    t.dropColumn('unit_id');
  });
};
