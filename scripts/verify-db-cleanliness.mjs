/**
 * scripts/verify-db-cleanliness.mjs
 * Verification of PostgreSQL database resting state per M4 criteria.
 */
import fs from 'fs';
import pg from 'pg';

if (fs.existsSync('.env.local')) {
  const envFile = fs.readFileSync('.env.local', 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  });
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function verifyDbCleanliness() {
  await client.connect();
  console.log('=== POSTGRESQL DATABASE RESTING STATE AUDIT ===\n');

  // 1. Raw materials count == 236
  const q1 = await client.query('SELECT COUNT(*) FROM public.raw_materials;');
  const rawMaterialsCount = parseInt(q1.rows[0].count, 10);
  console.log(`1. public.raw_materials: ${rawMaterialsCount} rows (expected: 236) -> ${rawMaterialsCount === 236 ? '✅ PASS' : '❌ FAIL'}`);

  // 2. Non-system roles count == 0
  const q2 = await client.query('SELECT COUNT(*) FROM public.roles WHERE is_system = false;');
  const nonSystemRoles = parseInt(q2.rows[0].count, 10);
  console.log(`2. public.roles non-system: ${nonSystemRoles} rows (expected: 0) -> ${nonSystemRoles === 0 ? '✅ PASS' : '❌ FAIL'}`);

  // 3. Inventory items active/costed/stock == 0 or 172 (post-closing stock)
  const q3 = await client.query('SELECT COUNT(*) FROM inventory_items WHERE current_stock != 0 OR current_weighted_average_cost != 0 OR is_costed = true;');
  const unresetItems = parseInt(q3.rows[0].count, 10);
  const q3Valid = unresetItems === 0 || unresetItems === 172;
  console.log(`3. inventory_items with non-zero stock/WAC/costed: ${unresetItems} rows (expected: 0 reset or 172 closing verified) -> ${q3Valid ? '✅ PASS' : '❌ FAIL'}`);

  // 4. Item location stocks quantity != 0 == 0 or 172 (post-closing stock)
  const q4 = await client.query('SELECT COUNT(*) FROM item_location_stocks WHERE quantity != 0;');
  const nonZeroLocationStocks = parseInt(q4.rows[0].count, 10);
  const q4Valid = nonZeroLocationStocks === 0 || nonZeroLocationStocks === 172;
  console.log(`4. item_location_stocks with quantity != 0: ${nonZeroLocationStocks} rows (expected: 0 reset or 172 closing verified) -> ${q4Valid ? '✅ PASS' : '❌ FAIL'}`);

  // 5. Ravi Kumar profile assigned to canonical Storekeeper
  const q5 = await client.query(`
    SELECT p.full_name, p.email, r.name as role_name, r.is_system 
    FROM profiles p 
    JOIN roles r ON p.role_id = r.id 
    WHERE p.id = '16e29066-9477-4232-a5c9-e4dedbc988d9';
  `);
  const ravi = q5.rows[0];
  const raviValid = ravi && ravi.role_name === 'Storekeeper' && ravi.is_system === true;
  console.log(`5. Test user Ravi Kumar role: '${ravi?.role_name}' (is_system: ${ravi?.is_system}) -> ${raviValid ? '✅ PASS' : '❌ FAIL'}`);

  // 6. System STORE location exists and is active
  const q6 = await client.query("SELECT COUNT(*) FROM inventory_locations WHERE code = 'STORE' AND is_active = true;");
  const storeExists = parseInt(q6.rows[0].count, 10) === 1;
  console.log(`6. Protected STORE location: ${storeExists ? '✅ PASS' : '❌ FAIL'}`);

  await client.end();

  const allPassed = rawMaterialsCount === 236 && nonSystemRoles === 0 && unresetItems === 0 && nonZeroLocationStocks === 0 && raviValid && storeExists;
  console.log(`\nOVERALL RESTING STATE: ${allPassed ? '🎉 100% PRISTINE & COMPLIANT' : '💥 INTEGRITY DEFECT DETECTED'}`);
  process.exit(allPassed ? 0 : 1);
}

verifyDbCleanliness().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
