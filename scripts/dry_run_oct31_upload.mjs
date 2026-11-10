import fs from 'fs';
import pg from 'pg';

if (fs.existsSync('.env.local')) {
  fs.readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
    const idx = l.indexOf('=');
    if (idx !== -1 && !l.trim().startsWith('#')) {
      process.env[l.slice(0, idx).trim()] = l.slice(idx + 1).trim();
    }
  });
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const approved = JSON.parse(fs.readFileSync('scratch/approved_items.json', 'utf8'));
console.log(`Loaded ${approved.length} approved items for dry run.`);

const CENTRAL_STORE_ID = 'a89335e9-01b4-4edd-bee5-a894053d798d';
const BUSINESS_DATE = '2026-10-31';

await client.query('BEGIN;');

try {
  // 1. Insert header
  const headerRes = await client.query(`
    INSERT INTO inventory_counts (
      business_date,
      count_type,
      status,
      notes
    ) VALUES ($1, $2, $3, $4)
    RETURNING id;
  `, [
    BUSINESS_DATE,
    'Physical Verification — Central Store Room',
    'approved',
    'Manually verified physical closing stock as of 31 October 2026 (172 approved items)'
  ]);

  const countId = headerRes.rows[0].id;
  console.log(`Created inventory_counts header ID: ${countId}`);

  let successCount = 0;
  for (const item of approved) {
    const itemId = item.master.id;
    const normQty = item.normalizedQty;

    // Get current stock
    const currRes = await client.query(`SELECT current_stock, current_weighted_average_cost FROM inventory_items WHERE id = $1;`, [itemId]);
    const expectedQty = parseFloat(currRes.rows[0]?.current_stock || 0);
    const wacCost = parseFloat(currRes.rows[0]?.current_weighted_average_cost || 0);
    const varianceQty = normQty - expectedQty;
    const varianceVal = varianceQty * wacCost;

    // Insert count item
    await client.query(`
      INSERT INTO inventory_count_items (
        count_id,
        item_id,
        expected_quantity,
        physical_quantity,
        variance_quantity,
        variance_value,
        reason,
        notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
    `, [
      countId,
      itemId,
      expectedQty,
      normQty,
      varianceQty,
      varianceVal,
      `Physical stock as of 31 Oct 2026 (${item.unitConversionExplanation})`,
      `Row #${item.row.index}: ${item.row.name} (Raw: ${item.rawQty})`
    ]);

    // Invoke RPC
    const rpcRes = await client.query(`
      SELECT execute_inventory_transaction(
        p_item_id := $1::uuid,
        p_business_date := $2::date,
        p_movement_type := 'count_adjustment'::text,
        p_quantity := $3::numeric,
        p_unit_cost := $4::numeric,
        p_destination_location_id := $5::uuid,
        p_purpose := 'Monthly Physical Verification'::text,
        p_reference_id := $6::uuid,
        p_reference_type := 'inventory_counts'::text,
        p_notes := $7::text
      ) as movement_id;
    `, [
      itemId,
      BUSINESS_DATE,
      varianceQty,
      wacCost,
      CENTRAL_STORE_ID,
      countId,
      `Verified physical count as of 31 Oct 2026: ${normQty} ${item.targetUnit}`
    ]);

    if (!rpcRes.rows[0]?.movement_id) {
      throw new Error(`Failed to create movement for item ${item.master.item_code}`);
    }

    successCount++;
  }

  console.log(`Dry run successfully processed all ${successCount} items!`);

  // Verify resulting balances in transaction
  const checkRes = await client.query(`
    SELECT count(*) as count_items, sum(current_stock) as total_stock
    FROM inventory_items
    WHERE current_stock > 0;
  `);
  console.log('Items with positive stock in transaction:', checkRes.rows[0]);

  // Rollback dry run
  await client.query('ROLLBACK;');
  console.log('Dry run completed safely: TRANSACTION ROLLED BACK.');
} catch (err) {
  await client.query('ROLLBACK;');
  console.error('Dry run failed:', err);
  process.exit(1);
} finally {
  await client.end();
}
