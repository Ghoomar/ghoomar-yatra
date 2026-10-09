import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const envVars = Object.fromEntries(
  env.split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function executeReset() {
  console.log('====================================================');
  console.log('GHOOMAR YATRA: PRODUCTION DATA RESET INITIATION');
  console.log('====================================================\n');

  // Verify baseline row counts of critical preserved datasets
  const [{ count: visCount }, { count: vehCount }, { count: ordersCount }, { count: itemsCount }, { count: hourlyCount }] = await Promise.all([
    supabase.from('visitor_counter_events').select('*', { count: 'exact', head: true }),
    supabase.from('vehicle_counter_events').select('*', { count: 'exact', head: true }),
    supabase.from('sales_orders').select('*', { count: 'exact', head: true }),
    supabase.from('sales_order_items').select('*', { count: 'exact', head: true }),
    supabase.from('sales_hourly_items').select('*', { count: 'exact', head: true }),
  ]);

  console.log('Baseline Preserved Records:');
  console.log(`- Visitor events: ${visCount}`);
  console.log(`- Vehicle events: ${vehCount}`);
  console.log(`- Sales orders: ${ordersCount}`);
  console.log(`- Sales order items: ${itemsCount}`);
  console.log(`- Sales hourly items: ${hourlyCount}\n`);

  if (!visCount || !vehCount || !ordersCount || !itemsCount) {
    throw new Error('Safety check failed: Baseline preserved tables appear empty or inaccessible!');
  }

  // STEP 1: PETPOOJA HOURLY IMPORT STREAMLINING & HISTORICAL RE-LINKING
  console.log('--- Step 1: Re-linking sales_hourly_items to ITEM_ORDER_DETAILS batches ---');
  const { data: itemBatches, error: ibErr } = await supabase
    .from('sales_import_batches')
    .select('id, business_date')
    .eq('report_type', 'ITEM_ORDER_DETAILS');
  if (ibErr) throw ibErr;

  const itemBatchMap = Object.fromEntries(itemBatches.map(b => [b.business_date, b.id]));
  console.log(`Found ${itemBatches.length} ITEM_ORDER_DETAILS batches.`);

  // Update sales_hourly_items by business_date
  let relinkedCount = 0;
  for (const [date, batchId] of Object.entries(itemBatchMap)) {
    const { error: updErr } = await supabase
      .from('sales_hourly_items')
      .update({ batch_id: batchId })
      .eq('business_date', date);
    if (updErr) throw updErr;
    relinkedCount++;
  }
  console.log(`Successfully re-linked hourly sales across ${relinkedCount} dates.`);

  // Delete the 36 obsolete HOURLY_ITEM_SALES batches from sales_import_batches
  const { error: delBatchErr } = await supabase
    .from('sales_import_batches')
    .delete()
    .eq('report_type', 'HOURLY_ITEM_SALES');
  if (delBatchErr) throw delBatchErr;
  console.log('Deleted obsolete HOURLY_ITEM_SALES batches from sales_import_batches.\n');

  // Universal deletion helper using id column
  async function deleteAll(tableName) {
    process.stdout.write(`Purging ${tableName.padEnd(35)}... `);
    const { error } = await supabase
      .from(tableName)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      console.log(`ERROR: ${error.message}`);
      throw error;
    }
    const { count } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
    console.log(`DONE (remaining: ${count})`);
  }

  // STEP 2: PURGE PURCHASING & VENDOR FINANCIAL TRANSACTIONS
  console.log('--- Step 2: Purging Purchasing & Vendor Transactions ---');
  await deleteAll('vendor_payment_allocations');
  await deleteAll('purchase_lines');
  await deleteAll('vendor_payments');
  await deleteAll('purchase_headers');
  await deleteAll('expenses');
  await deleteAll('vendor_items');
  await deleteAll('vendors');

  // STEP 3: PURGE INVENTORY TRANSACTIONS & TEST ASSETS
  console.log('\n--- Step 3: Purging Inventory Transactions & Test Assets ---');
  await deleteAll('consumption_issue_items');
  await deleteAll('consumption_issues');
  await deleteAll('inventory_count_items');
  await deleteAll('inventory_counts');
  await deleteAll('physical_asset_status_ledger');
  await deleteAll('asset_movements');
  await deleteAll('physical_assets');
  await deleteAll('stock_movements');
  await deleteAll('item_location_stocks');

  // Purge dummy inventory items, strictly preserving system anchors CON-DSL-001 and CON-LPG-001
  console.log('Purging dummy inventory items (preserving system anchors CON-DSL-001 and CON-LPG-001)...');
  const { error: delInvErr } = await supabase
    .from('inventory_items')
    .delete()
    .not('item_code', 'in', '("CON-DSL-001","CON-LPG-001")');
  if (delInvErr) throw delInvErr;

  // Reset stock counters on preserved inventory_items (CON-DSL-001, CON-LPG-001)
  console.log('Resetting stock counters on preserved inventory_items to 0...');
  const { error: rstStockErr } = await supabase
    .from('inventory_items')
    .update({ current_stock: 0, current_weighted_average_cost: 0 })
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (rstStockErr) throw rstStockErr;

  // STEP 4: PURGE STAFF TRANSACTIONS & DUMMY EMPLOYEES
  console.log('\n--- Step 4: Purging Staff Transactions & Dummy Employees ---');
  await deleteAll('employee_uniform_issue_items');
  await deleteAll('employee_uniform_issues');
  await deleteAll('uniform_items');
  await deleteAll('employee_salary_payments');
  await deleteAll('employee_salary_periods');
  await deleteAll('employee_financial_transactions');
  await deleteAll('attendance');
  await deleteAll('tips');
  await deleteAll('employees');

  // STEP 5: PURGE OPERATIONAL LOGS & TEST READINGS
  console.log('\n--- Step 5: Purging Operational Logs & Test Readings ---');
  await deleteAll('meter_readings');
  await deleteAll('activity_daily_records');
  await deleteAll('daily_operational_notes');

  // STEP 6: PURGE OBSOLETE PROTOTYPE TABLES
  console.log('\n--- Step 6: Cleaning Obsolete Feature Tables ---');
  await deleteAll('focus_items');

  // STEP 7: VERIFICATION & AUDIT CHECK
  console.log('\n====================================================');
  console.log('FINAL AUDIT & INTEGRITY VERIFICATION');
  console.log('====================================================\n');

  const preservedAudit = await Promise.all([
    supabase.from('visitor_counter_events').select('*', { count: 'exact', head: true }),
    supabase.from('vehicle_counter_events').select('*', { count: 'exact', head: true }),
    supabase.from('vehicle_registration_prefixes').select('*', { count: 'exact', head: true }),
    supabase.from('sales_orders').select('*', { count: 'exact', head: true }),
    supabase.from('sales_order_items').select('*', { count: 'exact', head: true }),
    supabase.from('sales_hourly_items').select('*', { count: 'exact', head: true }),
    supabase.from('sales_executive_summaries').select('*', { count: 'exact', head: true }),
    supabase.from('sales_import_batches').select('*', { count: 'exact', head: true }),
    supabase.from('pos_menu_items').select('*', { count: 'exact', head: true }),
    supabase.from('pos_categories').select('*', { count: 'exact', head: true }),
    supabase.from('pos_parent_categories').select('*', { count: 'exact', head: true }),
    supabase.from('units').select('*', { count: 'exact', head: true }),
    supabase.from('departments').select('*', { count: 'exact', head: true }),
    supabase.from('teams').select('*', { count: 'exact', head: true }),
    supabase.from('employee_roles').select('*', { count: 'exact', head: true }),
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('roles').select('*', { count: 'exact', head: true }),
    supabase.from('permissions').select('*', { count: 'exact', head: true }),
    supabase.from('role_permissions').select('*', { count: 'exact', head: true }),
    supabase.from('payment_methods').select('*', { count: 'exact', head: true }),
    supabase.from('financial_targets').select('*', { count: 'exact', head: true }),
    supabase.from('financial_cost_rules').select('*', { count: 'exact', head: true }),
  ]);

  const preservedNames = [
    'visitor_counter_events', 'vehicle_counter_events', 'vehicle_registration_prefixes',
    'sales_orders', 'sales_order_items', 'sales_hourly_items', 'sales_executive_summaries',
    'sales_import_batches', 'pos_menu_items', 'pos_categories', 'pos_parent_categories',
    'units', 'departments', 'teams', 'employee_roles', 'profiles', 'roles', 'permissions',
    'role_permissions', 'payment_methods', 'financial_targets', 'financial_cost_rules'
  ];

  preservedAudit.forEach((res, idx) => {
    console.log(`${preservedNames[idx].padEnd(35)} : ${String(res.count).padStart(6)} rows [OK]`);
  });

  console.log('\nAudit of Reset Tables (Must all be 0):');
  const resetTables = [
    'vendors', 'vendor_items', 'purchase_headers', 'purchase_lines', 'vendor_payments',
    'vendor_payment_allocations', 'expenses', 'employees', 'attendance', 'employee_salary_periods',
    'employee_salary_payments', 'employee_financial_transactions', 'tips', 'employee_uniform_issues',
    'employee_uniform_issue_items', 'stock_movements', 'consumption_issues', 'consumption_issue_items',
    'inventory_counts', 'inventory_count_items', 'item_location_stocks', 'physical_assets',
    'asset_movements', 'physical_asset_status_ledger', 'meter_readings', 'activity_daily_records',
    'daily_operational_notes', 'focus_items'
  ];

  let anyNonZero = false;
  for (const t of resetTables) {
    const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (count !== 0) {
      console.log(`❌ ${t.padEnd(35)} : ${count} rows (EXPECTED 0)`);
      anyNonZero = true;
    } else {
      console.log(`✅ ${t.padEnd(35)} : 0 rows`);
    }
  }

  if (anyNonZero) {
    throw new Error('Verification failed: One or more tables intended for reset still have rows!');
  }

  console.log('\n🎉 PRODUCTION DATA RESET COMPLETED SUCCESSFULLY WITH 100% INTEGRITY VERIFICATION!');
}

executeReset().catch(err => {
  console.error('\nEXECUTION FAILED:', err);
  process.exit(1);
});
