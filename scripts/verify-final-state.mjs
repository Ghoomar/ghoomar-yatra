import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Locate pg driver
let pg;
try {
  pg = require('pg');
} catch {
  const scratchPg = 'C:/Users/nirak/.gemini/antigravity/brain/9cfec205-e3f7-4240-b3e1-1205064ae2d9/scratch/node_modules/pg';
  if (fs.existsSync(scratchPg)) {
    pg = require(scratchPg);
  } else {
    throw new Error('pg module not found');
  }
}

const { Client } = pg;

// Read DATABASE_URL from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const dbUrlLine = envContent.split('\n').find((l) => l.startsWith('DATABASE_URL='));
if (!dbUrlLine) {
  throw new Error('DATABASE_URL not found in .env.local');
}
const dbUrl = dbUrlLine.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

const client = new Client({ connectionString: dbUrl });

async function verify() {
  await client.connect();
  console.log('================================================================');
  console.log('🔍 FINAL LIVE DATABASE VERIFICATION PASS');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, label, details) {
    if (condition) {
      console.log(`✅ PASS: ${label}${details !== undefined ? ` -> ${details}` : ''}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${label}${details !== undefined ? ` -> ${details}` : ''}`);
      failed++;
    }
  }

  // 1. Data Counts
  console.log('--- 1. TABLE ROW COUNTS ---');
  const countsRes = await client.query(`
    SELECT 
      (SELECT count(*) FROM inventory_items) AS items_count,
      (SELECT count(*) FROM stock_movements) AS movements_count,
      (SELECT count(*) FROM purchase_lines) AS purchase_lines_count,
      (SELECT count(*) FROM purchase_headers) AS purchase_headers_count,
      (SELECT count(*) FROM sales_import_batches) AS sales_import_batches_count;
  `);
  const counts = countsRes.rows[0];
  assert(Number(counts.items_count) === 21, 'inventory_items count', `${counts.items_count} items`);
  assert(Number(counts.movements_count) === 181, 'stock_movements count', `${counts.movements_count} movements`);
  assert(Number(counts.purchase_lines_count) === 29, 'purchase_lines count', `${counts.purchase_lines_count} lines`);
  assert(Number(counts.purchase_headers_count) === 17, 'purchase_headers count', `${counts.purchase_headers_count} headers`);
  assert(Number(counts.sales_import_batches_count) === 124, 'sales_import_batches count', `${counts.sales_import_batches_count} batches`);

  // 2. Chaap & Valuation Invariants
  console.log('\n--- 2. INVENTORY VALUATION & CHAAP INVARIANTS ---');
  const chaapRes = await client.query(`
    SELECT current_stock, current_weighted_average_cost
    FROM inventory_items
    WHERE item_code = 'DAI-001';
  `);
  const chaap = chaapRes.rows[0];
  assert(Number(chaap.current_stock) === 3991, 'Chaap (DAI-001) current_stock', `${chaap.current_stock} g`);
  assert(Number(chaap.current_weighted_average_cost) === 200, 'Chaap current_weighted_average_cost', `₹${chaap.current_weighted_average_cost}`);

  const valRes = await client.query(`
    SELECT ROUND(COALESCE(SUM(current_stock * current_weighted_average_cost), 0)::numeric, 2) AS total_val
    FROM inventory_items;
  `);
  const totalVal = valRes.rows[0].total_val;
  assert(Number(totalVal) === 1360017.89, 'Total inventory valuation', `₹${totalVal}`);

  // 3. Obsolete Columns Absent
  console.log('\n--- 3. OBSOLETE COLUMNS ABSENT CHECK ---');
  const colsRes = await client.query(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name IN ('inventory_items', 'purchase_lines', 'stock_movements')
      AND column_name IN ('shelf_life_days', 'batch_number', 'expiry_date');
  `);
  assert(colsRes.rows.length === 0, 'Obsolete batch/expiry columns absent from inventory tables', `${colsRes.rows.length} columns remaining`);
  if (colsRes.rows.length > 0) {
    console.table(colsRes.rows);
  }

  // 4. Obsolete Index Absent
  console.log('\n--- 4. OBSOLETE INDEX ABSENT CHECK ---');
  const idxRes = await client.query(`
    SELECT tablename, indexname 
    FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname = 'idx_stock_movements_expiry';
  `);
  assert(idxRes.rows.length === 0, 'Index idx_stock_movements_expiry absent', `${idxRes.rows.length} remaining`);

  // 5. execute_inventory_transaction RPC Inspection
  console.log('\n--- 5. EXECUTE_INVENTORY_TRANSACTION STORED PROCEDURE ---');
  const procRes = await client.query(`
    SELECT 
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS identity_args,
      p.pronargs AS arg_count,
      p.prosecdef AS is_security_definer,
      r.rolname AS owner_name,
      p.proconfig AS config_settings
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'public' AND p.proname = 'execute_inventory_transaction';
  `);

  assert(procRes.rows.length === 1, 'Exactly ONE execute_inventory_transaction function in pg_proc', `count = ${procRes.rows.length}`);
  const proc = procRes.rows[0];

  const expected14Args = 'p_item_id uuid, p_business_date date, p_movement_type text, p_quantity numeric, p_unit_cost numeric, p_source_location_id uuid, p_destination_location_id uuid, p_department_id uuid, p_responsible_person_id uuid, p_purpose text, p_reference_id uuid, p_reference_type text, p_notes text, p_created_by uuid';
  assert(proc.identity_args === expected14Args, 'Exact 14-parameter signature (no batch_number or expiry_date)', proc.identity_args);
  assert(Number(proc.arg_count) === 14, 'Arg count is exactly 14 (no 16-param overload)', `${proc.arg_count}`);
  assert(proc.is_security_definer === true, 'SECURITY DEFINER is enabled', `${proc.is_security_definer}`);
  assert(proc.owner_name === 'postgres', 'Function owner is postgres', `${proc.owner_name}`);
  const hasSearchPath = Array.isArray(proc.config_settings) && proc.config_settings.some(c => c.includes('search_path=public, pg_temp'));
  assert(hasSearchPath, 'search_path = public, pg_temp is enforced', `${JSON.stringify(proc.config_settings)}`);

  // 6. Grants & Access Denials
  console.log('\n--- 6. RPC PRIVILEGES & RBAC GRANTS ---');
  const privRes = await client.query(`
    SELECT grantee, privilege_type 
    FROM information_schema.routine_privileges 
    WHERE routine_schema = 'public' AND routine_name = 'execute_inventory_transaction';
  `);
  const grantees = privRes.rows.map(r => r.grantee);
  console.log('Routine grantees:', grantees.join(', '));
  assert(!grantees.includes('anon'), 'anon EXECUTE is DENIED', 'OK');
  assert(!grantees.includes('PUBLIC'), 'PUBLIC EXECUTE is DENIED', 'OK');
  assert(grantees.includes('authenticated'), 'authenticated EXECUTE is GRANTED', 'OK');
  assert(grantees.includes('service_role') || grantees.includes('postgres'), 'service_role / postgres EXECUTE is GRANTED', 'OK');

  // 7. Migration applied record
  console.log('\n--- 7. SUPABASE MIGRATIONS AUDIT TABLE ---');
  const migRes = await client.query(`
    SELECT version, name
    FROM supabase_migrations.schema_migrations
    WHERE version = '20261005200000';
  `);
  assert(migRes.rows.length === 1, 'Migration 20261005200000 recorded in schema_migrations', `version = ${migRes.rows[0]?.version}`);

  console.log('\n================================================================');
  console.log(`🏁 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  await client.end();
  if (failed > 0) process.exit(1);
}

verify().catch((err) => {
  console.error('Verification failed with error:', err);
  process.exit(1);
});
