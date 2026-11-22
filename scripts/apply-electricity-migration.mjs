import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl });

async function run() {
  await client.connect();
  const file = 'supabase/migrations/20261122180000_electricity_metering_allocation_and_reconciliation.sql';
  const version = '20261122180000';
  const name = 'electricity_metering_allocation_and_reconciliation';

  console.log(`Applying migration ${version}_${name}...`);
  const sql = fs.readFileSync(file, 'utf8');

  await client.query('BEGIN;');
  try {
    await client.query(sql);
    await client.query(`
      INSERT INTO supabase_migrations.schema_migrations (version, name)
      VALUES ($1, $2)
      ON CONFLICT (version) DO NOTHING;
    `, [version, name]);
    await client.query('COMMIT;');
    console.log(`✅ Successfully applied ${version}_${name}`);
  } catch (err) {
    await client.query('ROLLBACK;');
    console.error(`❌ Migration failed:`, err);
    throw err;
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
