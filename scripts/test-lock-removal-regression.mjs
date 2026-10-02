/**
 * Comprehensive Validation & Regression Test Suite:
 * Total Removal of Business-Day Locking Mechanism & Architecture
 *
 * Verifies:
 * 1. Database table removal: business_days table does not exist (PGRST205 error).
 * 2. Downstream view resilience: daily_financial_summary queries successfully with closing_status='open'.
 * 3. Live CRUD capability on past/locked dates: INSERT, UPDATE, DELETE succeed without lock rejection.
 * 4. Business integrity preservation: Database check constraints still reject invalid operational records.
 * 5. Permission migration: operations.daily exists, operations.closing is gone, role assignments preserved.
 * 6. Application cleanliness: /operations/closing route deleted, flags removed, rbac updated.
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((l) => {
      const idx = l.indexOf('=');
      if (idx !== -1 && !l.trim().startsWith('#')) {
        const k = l.slice(0, idx).trim();
        const v = l.slice(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    });
  }
}
loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials not found in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}:`, err.message);
    failed++;
  }
}

console.log('================================================================');
console.log('🧪 LOCKING MECHANISM REMOVAL & PERMISSION INTEGRITY TEST SUITE');
console.log('================================================================\n');

async function runTests() {
  console.log('📌 Test Group 1: Database Table Deletion & Error Handling');

  await test('business_days table is completely dropped from database schema', async () => {
    const { data, error } = await supabase.from('business_days').select('*').limit(1);
    assert.ok(error, 'Querying business_days must fail');
    assert.ok(
      error.code === 'PGRST205' || error.message.includes('Could not find') || error.message.includes('relation "public.business_days" does not exist'),
      `Expected table missing error, got: ${error.message} (${error.code})`
    );
  });

  console.log('\n📌 Test Group 2: Financial Views & Downstream SQL Resilience');

  await test('daily_financial_summary view executes without business_days dependency', async () => {
    const { data, error } = await supabase
      .from('daily_financial_summary')
      .select('business_date, closing_status, revenue, customer_food_consumption, total_material_consumption')
      .limit(5);

    assert.equal(error, null, error?.message);
    assert.ok(Array.isArray(data), 'Result must be an array');
    if (data.length > 0) {
      assert.equal(data[0].closing_status, 'open', 'closing_status defaults to open for backward compatibility');
    }
  });

  console.log('\n📌 Test Group 3: Live CRUD on Previously-Locked Historical Dates');

  await test('Operational record can be INSERTED, UPDATED, and DELETED on historical date (2026-09-11)', async () => {
    // 2026-09-11 was the historical date previously stored in business_days
    const { data: categories, error: catErr } = await supabase
      .from('expense_categories')
      .select('id')
      .limit(1);

    assert.equal(catErr, null, catErr?.message);
    assert.ok(categories.length > 0, 'Must have at least one expense category');
    const categoryId = categories[0].id;

    // 1. Insert on historical date
    const { data: inserted, error: insErr } = await supabase
      .from('expenses')
      .insert({
        business_date: '2026-09-11',
        expense_date: '2026-09-11',
        category_id: categoryId,
        amount: 125.00,
        description: 'Regression test expense for lock removal',
        paid_to: 'Test Vendor',
        notes: 'lock-removal-test',
      })
      .select('id, business_date, amount')
      .single();

    assert.equal(insErr, null, `Insert failed: ${insErr?.message}`);
    assert.equal(inserted.business_date, '2026-09-11');
    assert.equal(Number(inserted.amount), 125);
    const createdId = inserted.id;

    // 2. Update on historical date
    const { data: updated, error: updErr } = await supabase
      .from('expenses')
      .update({ amount: 150.00 })
      .eq('id', createdId)
      .select('id, amount')
      .single();

    assert.equal(updErr, null, `Update failed: ${updErr?.message}`);
    assert.equal(Number(updated.amount), 150, 'UPDATE on historical date succeeds without lock block');

    // 3. Delete on historical date
    const { error: delErr } = await supabase
      .from('expenses')
      .delete()
      .eq('id', createdId);

    assert.equal(delErr, null, `Delete failed: ${delErr?.message}`);
  });

  console.log('\n📌 Test Group 4: Data Integrity & Check Constraints Remain Intact');

  await test('Database check constraints still reject invalid operational records', async () => {
    const { error } = await supabase
      .from('stock_movements')
      .insert({
        business_date: '2026-09-11',
        item_id: '00000000-0000-0000-0000-000000000000',
        movement_type: 'invalid_movement_type_that_violates_check',
        quantity: 10,
      });

    assert.ok(error, 'Invalid operational record must be rejected by check constraint');
    assert.ok(
      error.message.includes('check constraint') || error.message.includes('violates') || error.code === '23514',
      `Expected check constraint violation, got: ${error.message}`
    );
  });

  console.log('\n📌 Test Group 5: RBAC Permission Migration (operations.closing -> operations.daily)');

  await test('operations.daily exists and operations.closing is removed from permissions table', async () => {
    const { data: closingPerm } = await supabase
      .from('permissions')
      .select('*')
      .eq('code', 'operations.closing');
    assert.equal(closingPerm?.length || 0, 0, 'operations.closing must NOT exist in permissions table');

    const { data: dailyPerm } = await supabase
      .from('permissions')
      .select('*')
      .eq('code', 'operations.daily');
    assert.equal(dailyPerm?.length, 1, 'operations.daily must exist in permissions table');
    assert.equal(dailyPerm[0].module, 'operations');
    assert.equal(dailyPerm[0].action, 'manage');
  });

  await test('role_permissions assignments are preserved for operations.daily', async () => {
    const { data: dailyPerm } = await supabase
      .from('permissions')
      .select('id')
      .eq('code', 'operations.daily')
      .single();

    const { data: rolePerms, error } = await supabase
      .from('role_permissions')
      .select('role_id, roles(name)')
      .eq('permission_id', dailyPerm.id);

    assert.equal(error, null, error?.message);
    const roleNames = rolePerms.map((rp) => rp.roles.name);
    assert.ok(roleNames.includes('Admin'), 'Admin must have operations.daily');
    assert.ok(roleNames.includes('General Manager'), 'General Manager must have operations.daily');
    assert.ok(roleNames.includes('Accountant'), 'Accountant must have operations.daily');
    assert.ok(roleNames.includes('Cashier'), 'Cashier must have operations.daily');
  });

  console.log('\n📌 Test Group 6: Application Source Code Cleanliness');

  await test('/operations/closing route file is completely removed', async () => {
    const exists = fs.existsSync('src/app/operations/closing/page.tsx');
    assert.equal(exists, false, 'src/app/operations/closing/page.tsx must not exist');
  });

  await test('day_closing_open flag is completely removed from Dashboard code', async () => {
    const dashCode = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');
    assert.ok(!dashCode.includes('day_closing_open'), 'Dashboard must not reference day_closing_open');
    assert.ok(!dashCode.includes('isDayClosed'), 'Dashboard must not have isDayClosed state');
    assert.ok(!dashCode.includes("from('business_days')"), 'Dashboard must not query business_days');
  });

  await test('Admin users route does not reference business_days', async () => {
    const userCode = fs.readFileSync('src/app/api/admin/users/route.ts', 'utf8');
    assert.ok(!userCode.includes('business_days'), 'users route must not query business_days');
  });

  await test('RBAC route permissions does not contain /operations/closing and maps /operations/daily to operations.daily', async () => {
    const rbacCode = fs.readFileSync('src/lib/rbac.ts', 'utf8');
    assert.ok(!rbacCode.includes("'/operations/closing'"), 'RBAC must not contain /operations/closing route');
    assert.ok(rbacCode.includes("'/operations/daily': 'operations.daily'"), 'RBAC must map /operations/daily to operations.daily');
  });

  await test('Sidebar navigation maps Daily Operations to operations.daily permission', async () => {
    const sidebarCode = fs.readFileSync('src/components/navigation/Sidebar.tsx', 'utf8');
    assert.ok(!sidebarCode.includes("permission: 'operations.closing'"), 'Sidebar must not reference operations.closing');
    assert.ok(sidebarCode.includes("permission: 'operations.daily'"), 'Sidebar must use operations.daily');
  });

  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
}

runTests();
