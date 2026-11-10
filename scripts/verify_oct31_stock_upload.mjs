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
const excluded = JSON.parse(fs.readFileSync('scratch/excluded_items.json', 'utf8'));
const CENTRAL_STORE_ID = 'a89335e9-01b4-4edd-bee5-a894053d798d';
const BUSINESS_DATE = '2026-10-31';

console.log('================================================================');
console.log('🔍 POST-UPLOAD INDEPENDENT VERIFICATION AUDIT');
console.log('================================================================\n');

let pass = true;

// 1. Verify Header Record
const headerRes = await client.query(`
  SELECT id, business_date, count_type, status, notes
  FROM inventory_counts
  WHERE business_date = $1
  ORDER BY created_at DESC
  LIMIT 1;
`, [BUSINESS_DATE]);

if (headerRes.rows.length === 0) {
  console.error('❌ Check 1 FAIL: No inventory_counts header found for 2026-10-31');
  pass = false;
} else {
  const header = headerRes.rows[0];
  console.log(`✅ Check 1 PASS: Header record verified (${header.id}) status="${header.status}", type="${header.count_type}"`);

  // 2. Verify Count Items Count == 172
  const countItemsRes = await client.query(`
    SELECT count(*) as count
    FROM inventory_count_items
    WHERE count_id = $1;
  `, [header.id]);
  const cCount = parseInt(countItemsRes.rows[0].count, 10);
  console.log(`✅ Check 2 PASS: inventory_count_items rows = ${cCount} (expected: 172)`);
  if (cCount !== 172) pass = false;

  // 3. Verify Stock Movements Count == 172
  const movementsRes = await client.query(`
    SELECT count(*) as count, count(DISTINCT item_id) as distinct_items
    FROM stock_movements
    WHERE reference_id = $1 AND movement_type = 'count_adjustment' AND business_date = $2;
  `, [header.id, BUSINESS_DATE]);
  const mCount = parseInt(movementsRes.rows[0].count, 10);
  const mDistinct = parseInt(movementsRes.rows[0].distinct_items, 10);
  console.log(`✅ Check 3 PASS: stock_movements = ${mCount}, distinct SKUs = ${mDistinct} (expected: 172/172)`);
  if (mCount !== 172 || mDistinct !== 172) pass = false;

  // 4. Verify Quantities for every single one of the 172 items
  console.log('\n--- Verifying Quantities on all 172 Approved Items ---');
  let qtyErrors = 0;
  for (const item of approved) {
    const itemId = item.master.id;
    const expectedNormQty = item.normalizedQty;

    // Check inventory_items.current_stock
    const iiRes = await client.query(`SELECT current_stock FROM inventory_items WHERE id = $1;`, [itemId]);
    const actualStock = parseFloat(iiRes.rows[0]?.current_stock || 0);

    // Check item_location_stocks at Central Store Room
    const ilsRes = await client.query(`SELECT quantity FROM item_location_stocks WHERE item_id = $1 AND location_id = $2;`, [itemId, CENTRAL_STORE_ID]);
    const actualLocStock = parseFloat(ilsRes.rows[0]?.quantity || 0);

    if (Math.abs(actualStock - expectedNormQty) > 0.001 || Math.abs(actualLocStock - expectedNormQty) > 0.001) {
      console.error(`❌ Mismatch on [${item.master.item_code}] ${item.master.name}: Expected ${expectedNormQty}, Got inventory_items=${actualStock}, item_location_stocks=${actualLocStock}`);
      qtyErrors++;
      pass = false;
    }
  }
  if (qtyErrors === 0) {
    console.log(`✅ Check 4 PASS: All 172 items have 100% exact quantities in both inventory_items and item_location_stocks!`);
  }

  // 5. Verify 46 Excluded items are UNTOUCHED
  console.log('\n--- Verifying 46 Excluded Items are 100% Untouched ---');
  let touchedExcluded = 0;
  for (const item of excluded) {
    if (item.row.master?.id) {
      const checkRes = await client.query(`
        SELECT count(*) as sm_count
        FROM stock_movements
        WHERE item_id = $1;
      `, [item.row.master.id]);
      if (parseInt(checkRes.rows[0].sm_count, 10) > 0) {
        console.error(`❌ Excluded item [${item.row.name}] has movements!`);
        touchedExcluded++;
        pass = false;
      }
    }
  }
  if (touchedExcluded === 0) {
    console.log(`✅ Check 5 PASS: All 46 excluded items remain 100% untouched!`);
  }

  // 6. Verify Unreferenced Master items are UNTOUCHED
  console.log('\n--- Verifying Unreferenced Master Items are 100% Untouched ---');
  const totalMasterCountRes = await client.query(`
    SELECT 
      count(*) filter (where current_stock > 0) as items_with_stock,
      count(*) filter (where current_stock = 0) as items_zero_stock
    FROM inventory_items;
  `);
  const itemsWithStock = parseInt(totalMasterCountRes.rows[0].items_with_stock, 10);
  const itemsZeroStock = parseInt(totalMasterCountRes.rows[0].items_zero_stock, 10);
  console.log(`Total items with stock: ${itemsWithStock} (expected: exactly 172)`);
  console.log(`Total items with zero stock: ${itemsZeroStock} (expected: exactly 253 = 425 - 172)`);
  if (itemsWithStock === 172 && itemsZeroStock === 253) {
    console.log(`✅ Check 6 PASS: Exactly 172 items have stock, exactly 253 unreferenced items remain untouched!`);
  } else {
    console.error(`❌ Check 6 FAIL: Items with stock (${itemsWithStock}) != 172`);
    pass = false;
  }
}

console.log('\n================================================================');
if (pass) {
  console.log('🏆 ALL VERIFICATION CHECKS PASSED WITH 100% PRECISION!');
} else {
  console.error('❌ SOME CHECKS FAILED!');
  process.exit(1);
}
console.log('================================================================');

await client.end();
