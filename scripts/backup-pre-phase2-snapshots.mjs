import fs from 'fs';
import path from 'path';
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

  const backupDir = path.resolve('backups/pre_phase2');
  fs.mkdirSync(backupDir, { recursive: true });

  const tables = [
    'yatra_recipes',
    'yatra_recipe_ingredients',
    'yatra_menu_item_variants',
    'yatra_combos_thalis',
    'yatra_combo_components',
    'pos_menu_items',
    'pos_menu_item_aliases'
  ];

  for (const t of tables) {
    const res = await client.query(`SELECT * FROM public."${t}" ORDER BY id ASC`);
    const filePath = path.join(backupDir, `${t}.json`);
    fs.writeFileSync(filePath, JSON.stringify(res.rows, null, 2), 'utf8');
    console.log(`Backed up ${t}: ${res.rows.length} rows to ${filePath}`);
  }

  // Authorised pre-deletion snapshot for Paneer Rice & Paneer Dish (Combo Portion)
  const paneerRiceCombo = await client.query(`
    SELECT * FROM public.yatra_combos_thalis WHERE id = '7e7d7b0e-463e-4740-90de-a7e61c80943d'
  `);
  const paneerRiceComponents = await client.query(`
    SELECT * FROM public.yatra_combo_components WHERE combo_thali_id = '7e7d7b0e-463e-4740-90de-a7e61c80943d'
  `);
  const paneerDishRecipe = await client.query(`
    SELECT * FROM public.yatra_recipes WHERE id = 'b4df614a-a873-48da-929c-4faed5af6f9e'
  `);
  const paneerDishIngredients = await client.query(`
    SELECT * FROM public.yatra_recipe_ingredients WHERE recipe_id = 'b4df614a-a873-48da-929c-4faed5af6f9e'
  `);

  const deletionSnapshot = {
    captured_at: new Date().toISOString(),
    paneer_rice_combo: paneerRiceCombo.rows,
    paneer_rice_components: paneerRiceComponents.rows,
    paneer_dish_recipe: paneerDishRecipe.rows,
    paneer_dish_ingredients: paneerDishIngredients.rows
  };

  const deletionSnapshotPath = path.join(backupDir, 'authorised_deletion_snapshot_paneer_rice.json');
  fs.writeFileSync(deletionSnapshotPath, JSON.stringify(deletionSnapshot, null, 2), 'utf8');
  console.log(`Saved pre-deletion snapshot to ${deletionSnapshotPath}`);

  await client.end();
}

main().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
