/**
 * 001 – users
 *
 * Local cache of people who have logged in through MAU SSO (AD).
 * We never store passwords – identity always comes from AD.
 * Needed first because every other table records created_by / updated_by.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('ad_object_id', 64).notNullable().unique(); // stable AD/Entra objectId (never changes)
    t.string('username', 255).notNullable();             // e.g. ab1234
    t.string('display_name', 255);
    t.string('email', 255);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.datetime('last_login_at');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('users');
};
