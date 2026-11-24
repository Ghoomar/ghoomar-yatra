import fs from 'fs';
import pg from 'pg';

const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  const version = '20261124100000';
  const name = 'phase2_sales_forecasting_and_variance';
  const file = 'supabase/migrations/20261124100000_phase2_sales_forecasting_and_variance.sql';

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
