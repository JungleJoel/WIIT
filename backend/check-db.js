const knex = require('knex')(require('./knexfile').development);

async function main() {
    // 1. Read both trees with a recursive query
    const rows = await knex.raw(`
    WITH tree AS (
      SELECT id, parent_id, structure_id, title, 0 AS depth,
             CAST(RIGHT('00000' + CAST(sort_order AS varchar(10)), 5) AS varchar(1000)) AS path
      FROM nodes WHERE parent_id IS NULL
      UNION ALL
      SELECT n.id, n.parent_id, n.structure_id, n.title, t.depth + 1,
             CAST(t.path + '/' + RIGHT('00000' + CAST(n.sort_order AS varchar(10)), 5) AS varchar(1000))
      FROM nodes n JOIN tree t ON n.parent_id = t.id
    )
    SELECT * FROM tree ORDER BY structure_id, path
  `);

    console.log('\n--- Trees ---');
    for (const r of rows) {
        console.log('  '.repeat(r.depth) + '- ' + r.title);
    }

    // 2. Show the link between the trees
    const relations = await knex('node_relations as r')
        .join('nodes as s', 's.id', 'r.source_node_id')
        .join('nodes as t', 't.id', 'r.target_node_id')
        .select('s.title as source', 'r.relation_type', 't.title as target');

    console.log('\n--- Relations ---');
    for (const r of relations) {
        console.log(`${r.source}  --${r.relation_type}-->  ${r.target}`);
    }

    // 3. Try to delete a node that has children (should fail)
    console.log('\n--- Delete test ---');
    try {
        await knex('nodes').where({ title: 'Examensarbeten' }).del();
        console.log('PROBLEM: the node was deleted even though it has children!');
    } catch (err) {
        console.log('Blocked as expected: a node with children cannot be deleted.');
    }

    await knex.destroy();
}

main();