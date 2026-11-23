import fs from 'fs';
import pg from 'pg';

const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const client = new pg.Client({ connectionString: dbUrl });

async function run() {
  await client.connect();
  const version = '20261124000000';
  const name = 'phase1_inventory_abc_par_and_purchase_requests';
  const file = 'supabase/migrations/20261124000000_phase1_inventory_abc_par_and_purchase_requests.sql';

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
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
