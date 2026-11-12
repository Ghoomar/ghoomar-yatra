import fs from 'fs';
import pg from 'pg';

const env = fs.readFileSync('.env.local', 'utf8');
env.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
});

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  console.log('--- Applying Phase A Schema + Phase B Data Migration to Live Supabase DB ---');

  try {
    await client.query('BEGIN;');

    // 1. Run Phase A Schema Migration
    const schemaSql = fs.readFileSync('supabase/migrations/20261112000000_native_culinary_4tier_architecture.sql', 'utf8');
    await client.query(schemaSql);
    console.log('✅ Phase A Schema applied.');

    // 2. Run Phase B Data Migration
    const dataSql = fs.readFileSync('supabase/migrations/20261112010000_surviving_combos_and_4tier_data.sql', 'utf8');
    await client.query(dataSql);
    console.log('✅ Phase B Data Migration applied.');

    // Assertions
    const counts = await client.query(`
      SELECT 
        (SELECT count(*) FROM public.yatra_canonical_dishes) as dishes,
        (SELECT count(*) FROM public.yatra_recipe_formulations) as formulations,
        (SELECT count(*) FROM public.yatra_serving_configurations) as configs,
        (SELECT count(*) FROM public.yatra_menu_item_compositions) as compositions,
        (SELECT count(*) FROM public.yatra_recipes) as legacy_recipes,
        (SELECT count(*) FROM public.yatra_combos_thalis) as legacy_combos,
        (SELECT count(*) FROM public.yatra_combo_components) as legacy_components,
        (SELECT count(*) FROM public.pos_menu_items WHERE canonical_dish_id IS NOT NULL) as linked_menu_items,
        (SELECT count(*) FROM public.pos_menu_items WHERE product_type = 'COMBO') as combos_count,
        (SELECT count(*) FROM public.pos_menu_items WHERE product_type = 'THALI') as thalis_count
    `);
    console.log('Migration Verification Counts:', counts.rows[0]);

    if (parseInt(counts.rows[0].legacy_recipes) !== 62) throw new Error('Expected 62 legacy recipes');
    if (parseInt(counts.rows[0].legacy_combos) !== 2) throw new Error('Expected 2 legacy combos');
    if (parseInt(counts.rows[0].legacy_components) !== 6) throw new Error('Expected 6 legacy components');
    if (parseInt(counts.rows[0].linked_menu_items) !== 23) throw new Error('Expected 23 linked menu items');
    if (parseInt(counts.rows[0].compositions) !== 6) throw new Error('Expected 6 compositions');

    await client.query('COMMIT;');
    console.log('🎉 COMMIT succeeded! Live database successfully upgraded to 4-tier culinary architecture.');
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    console.error('❌ Migration failed, rolled back:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
