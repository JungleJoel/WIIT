import 'dotenv/config';
import knexLib, { Knex } from 'knex';
import knexConfig from '../knexfile';

const knex: Knex = knexLib(knexConfig.development);

async function expectFail(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(` ${label}: was ALLOWED (should fail)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0]!.slice(0, 90) : String(e);
    console.log(` ${label}: blocked → ${msg}`);
  }
}

(async (): Promise<void> => {
  await expectFail('Delete parent with children', () =>
    knex('nodes').where('reference_code', 'A-3').del());

  await expectFail('Delete node with relation', () =>
    knex('nodes').where('reference_code', 'F2').del());

  const hylla = await knex('nodes').where('reference_code', 'A-3').first<{ id: number }>('id');
  if (!hylla) throw new Error('A-3 not found — run seeds first');

  await expectFail('Move child into another tree', () =>
    knex('nodes').where('reference_code', 'F2:1').update({ parent_id: hylla.id }));

  await knex.destroy();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
