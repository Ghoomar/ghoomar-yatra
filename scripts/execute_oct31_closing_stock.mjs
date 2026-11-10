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
console.log(`================================================================`);
console.log(`📦 PRODUCTION EXECUTION: 31 OCTOBER 2026 PHYSICAL STOCK CLOSING`);
console.log(`================================================================`);
console.log(`Items to process: ${approved.length}`);

const CENTRAL_STORE_ID = 'a89335e9-01b4-4edd-bee5-a894053d798d';
const BUSINESS_DATE = '2026-10-31';

await client.query('BEGIN;');

try {
  // 0. Clean previous count run for 2026-10-31 if any (idempotent re-run safety)
  await client.query(`DELETE FROM public.stock_movements WHERE business_date = $1 AND movement_type = 'count_adjustment';`, [BUSINESS_DATE]);
  await client.query(`DELETE FROM public.inventory_count_items WHERE count_id IN (SELECT id FROM public.inventory_counts WHERE business_date = $1);`, [BUSINESS_DATE]);
  await client.query(`DELETE FROM public.inventory_counts WHERE business_date = $1;`, [BUSINESS_DATE]);
  await client.query(`UPDATE public.item_location_stocks SET quantity = 0 WHERE location_id = $1;`, [CENTRAL_STORE_ID]);
  await client.query(`UPDATE public.inventory_items SET current_stock = 0;`);

  // 1. Insert inventory_counts header
  const headerRes = await client.query(`
    INSERT INTO inventory_counts (
      business_date,
      count_type,
      status,
      approved_at,
      notes
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING id;
  `, [
    BUSINESS_DATE,
    'Physical Verification — Central Store Room',
    'approved',
    '2026-10-31 23:59:59+05:30',
    'Physical verification as of 31 October 2026 (172 approved items reconciled from physical count sheet)'
  ]);

  const countId = headerRes.rows[0].id;
  console.log(`✅ Created inventory_counts header: ${countId}`);

  let successCount = 0;
  for (const item of approved) {
    const itemId = item.master.id;
    const normQty = item.normalizedQty;

    // Get current stock & WAC
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
      `Physical closing stock as of 31 Oct 2026 (${item.unitConversionExplanation})`,
      `Row #${item.row.index}: ${item.row.name} (Raw: ${item.rawQty})`
    ]);

    // Invoke RPC execute_inventory_transaction
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

  // Audit log record
  await client.query(`
    INSERT INTO audit_logs (
      action,
      entity_type,
      entity_id,
      new_values
    ) VALUES ($1, $2, $3, $4);
  `, [
    'CREATE',
    'inventory_counts',
    countId,
    JSON.stringify({
      business_date: BUSINESS_DATE,
      location: 'Central Store Room',
      location_id: CENTRAL_STORE_ID,
      items_reconciled: successCount,
      notes: 'Monthly physical stock count verification as of 31 October 2026'
    })
  ]);

  await client.query('COMMIT;');
  console.log(`\n🎉 TRANSACTION COMMITTED SUCCESSFULLY!`);
  console.log(`Total items updated: ${successCount} items.`);
} catch (err) {
  await client.query('ROLLBACK;');
  console.error('❌ Execution failed, transaction rolled back:', err);
  process.exit(1);
} finally {
  await client.end();
}
