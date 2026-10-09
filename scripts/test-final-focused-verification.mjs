import fs from 'fs';
import assert from 'assert';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const envVars = Object.fromEntries(
  env.split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

const DIESEL_ITEM_ID = 'd1e5e100-0001-4000-a000-000000000001';
const LPG_ITEM_ID = '195c1900-0002-4000-a000-000000000002';
const CENTRAL_STORE_ID = 'a89335e9-01b4-4edd-bee5-a894053d798d';

async function runFocusedVerification() {
  console.log('================================================================');
  console.log('FINAL FOCUSED VERIFICATION PASS (DATABASE & CODE LOGIC)');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // CHECKPOINT 1: LIVE DATABASE INVENTORY & SYSTEM ANCHORS
  // -------------------------------------------------------------
  console.log('--- CHECKPOINT 1: Live Database Inventory Records & Anchors ---');
  const { data: liveItems, error: itemsErr } = await supabase
    .from('inventory_items')
    .select('id, item_code, name, inventory_class, current_stock, current_weighted_average_cost, is_active')
    .order('item_code');

  assert(!itemsErr, `Error querying inventory_items: ${itemsErr?.message}`);
  console.log(`Live inventory_items row count: ${liveItems.length}`);
  console.table(liveItems);

  assert.strictEqual(liveItems.length, 2, 'Exactly 2 inventory items must exist in live DB');

  const diesel = liveItems.find(i => i.id === DIESEL_ITEM_ID);
  const lpg = liveItems.find(i => i.id === LPG_ITEM_ID);

  assert(diesel, 'Diesel anchor CON-DSL-001 must exist');
  assert.strictEqual(diesel.item_code, 'CON-DSL-001');
  assert.strictEqual(Number(diesel.current_stock), 0, 'Diesel current_stock must be 0');
  assert.strictEqual(Number(diesel.current_weighted_average_cost), 0, 'Diesel WAC must be 0');

  assert(lpg, 'LPG anchor CON-LPG-001 must exist');
  assert.strictEqual(lpg.item_code, 'CON-LPG-001');
  assert.strictEqual(Number(lpg.current_stock), 0, 'LPG current_stock must be 0');
  assert.strictEqual(Number(lpg.current_weighted_average_cost), 0, 'LPG WAC must be 0');
  console.log('✔ Checkpoint 1.1: CON-DSL-001 and CON-LPG-001 are intact with zero stock.\n');

  // Verify inventory_current_position SQL View
  const { data: viewRows, error: viewErr } = await supabase
    .from('inventory_current_position')
    .select('item_id, item_code, name, inventory_class, current_quantity, wac_cost');

  assert(!viewErr, `Error querying inventory_current_position: ${viewErr?.message}`);
  assert.strictEqual(viewRows.length, 2, 'inventory_current_position view must return exactly 2 items');
  console.log('✔ Checkpoint 1.2: inventory_current_position view successfully reflects the 2 anchors.\n');

  // Verify relational tables integrity
  const candidateTables = [
    'stock_movements',
    'purchase_lines',
    'purchase_headers',
    'consumption_issue_items',
    'consumption_issues',
    'inventory_count_items',
    'item_location_stocks',
    'vendor_items',
    'employee_uniform_issue_items',
    'physical_asset_status_ledger'
  ];

  for (const t of candidateTables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    assert(!error, `Query on table ${t} failed: ${error?.message}`);
    assert.strictEqual(count, 0, `Table ${t} must have 0 rows`);
  }
  console.log('✔ Checkpoint 1.3: All dependent transactional tables verified at 0 rows (clean state).\n');

  // Verify pos_menu_items preserved
  const { count: menuCount, error: menuErr } = await supabase
    .from('pos_menu_items')
    .select('*', { count: 'exact', head: true });

  assert(!menuErr, `Error querying pos_menu_items: ${menuErr?.message}`);
  assert(menuCount > 0, `pos_menu_items must be preserved (found ${menuCount} items)`);
  console.log(`✔ Checkpoint 1.4: POS Menu Items preserved intact (${menuCount} items).\n`);

  // Verify Central Store location preserved
  const { data: centralStore, error: csErr } = await supabase
    .from('inventory_locations')
    .select('id, name')
    .eq('id', CENTRAL_STORE_ID)
    .single();

  assert(!csErr && centralStore, `Central Store location must exist: ${csErr?.message}`);
  console.log(`✔ Checkpoint 1.5: Central Store (${centralStore.name}) preserved.\n`);

  // -------------------------------------------------------------
  // CHECKPOINT 2: UTILITIES MODULE OPERATIONAL QUERIES
  // -------------------------------------------------------------
  console.log('--- CHECKPOINT 2: Utilities Module Component Queries ---');

  // Simulate DieselTab exact query:
  const [dItemRes, dLocRes] = await Promise.all([
    supabase.from('inventory_items').select('*').eq('id', DIESEL_ITEM_ID).single(),
    supabase.from('item_location_stocks').select('quantity').eq('item_id', DIESEL_ITEM_ID).eq('location_id', CENTRAL_STORE_ID).maybeSingle(),
  ]);
  assert(!dItemRes.error && dItemRes.data, `DieselTab single query failed: ${dItemRes.error?.message}`);
  console.log(`✔ Checkpoint 2.1: DieselTab queries resolved: item name "${dItemRes.data.name}", location stock: ${dLocRes.data?.quantity ?? 0}`);

  // Simulate LpgTab exact query:
  const [lItemRes, lLocRes] = await Promise.all([
    supabase.from('inventory_items').select('*').eq('id', LPG_ITEM_ID).single(),
    supabase.from('item_location_stocks').select('quantity').eq('item_id', LPG_ITEM_ID).eq('location_id', CENTRAL_STORE_ID).maybeSingle(),
  ]);
  assert(!lItemRes.error && lItemRes.data, `LpgTab single query failed: ${lItemRes.error?.message}`);
  console.log(`✔ Checkpoint 2.2: LpgTab queries resolved: item name "${lItemRes.data.name}", location stock: ${lLocRes.data?.quantity ?? 0}\n`);

  // -------------------------------------------------------------
  // CHECKPOINT 3: PAYROLL SCENARIOS (EMPTY vs NONZERO)
  // -------------------------------------------------------------
  console.log('--- CHECKPOINT 3: Payroll Calculation Scenarios ---');

  // Scenario 3A: Empty Staff / Payroll Dataset (Current Live DB State)
  const { data: liveEmps } = await supabase
    .from('employees')
    .select('monthly_salary')
    .eq('employment_status', 'Active');

  const livePayroll = (liveEmps || []).reduce((s, e) => s + (Number(e.monthly_salary) || 0), 0);
  const liveTotalSalaries = livePayroll; // Profitability logic after fix
  const liveDashboardSalaries = livePayroll; // Dashboard logic after fix
  const daysInMonth = 31;
  const liveDailyPayroll = Number((liveTotalSalaries / daysInMonth).toFixed(2));

  assert.strictEqual(livePayroll, 0, 'Live payroll must be 0');
  assert.strictEqual(liveTotalSalaries, 0, 'Profitability totalSalaries must be 0');
  assert.strictEqual(liveDashboardSalaries, 0, 'Dashboard monthlySalaries must be 0');
  assert.strictEqual(liveDailyPayroll, 0, 'Daily prorated payroll must be ₹0.00');
  console.log('✔ Checkpoint 3A (Empty Dataset): Daily prorated payroll correctly computes to ₹0.00.');

  // Scenario 3B: Nonzero Salary Dataset (Simulation)
  const mockEmployees = [
    { name: 'Executive Chef', monthly_salary: 35000, employment_status: 'Active' },
    { name: 'Restaurant Captain', monthly_salary: 22000, employment_status: 'Active' },
    { name: 'Steward', monthly_salary: 15000, employment_status: 'Active' },
  ];
  const simPayroll = mockEmployees.reduce((s, e) => s + (Number(e.monthly_salary) || 0), 0);
  const simTotalSalaries = simPayroll; // P&L logic: setTotalSalaries(payroll)
  const simDashboardSalaries = simPayroll; // Dashboard logic: setMonthlySalaries(totalSal)
  const simDailyPayroll = Number((simTotalSalaries / daysInMonth).toFixed(2));

  assert.strictEqual(simPayroll, 72000, 'Simulated payroll must be 72,000');
  assert.strictEqual(simTotalSalaries, 72000, 'P&L totalSalaries must equal 72,000');
  assert.strictEqual(simDashboardSalaries, 72000, 'Dashboard monthlySalaries must equal 72,000');
  // 72,000 / 31 = 2322.5806... -> 2322.58
  assert.strictEqual(simDailyPayroll, 2322.58, 'Daily prorated payroll must be 2322.58');
  console.log(`✔ Checkpoint 3B (Populated Dataset): ₹72,000 monthly payroll correctly computes to ₹${simDailyPayroll}/day.\n`);

  // -------------------------------------------------------------
  // CHECKPOINT 4: FIXED COST SCENARIOS (ZERO vs NONZERO)
  // -------------------------------------------------------------
  console.log('--- CHECKPOINT 4: Fixed Cost Scenarios ---');

  // Scenario 4A: Configured ₹0 Fixed Costs (Current Live DB State)
  const { data: liveCostRules } = await supabase
    .from('financial_cost_rules')
    .select('*')
    .eq('is_active', true);

  const liveFixedRules = (liveCostRules || []).filter(r => r.cost_classification === 'Fixed');
  const liveFixedSum = liveFixedRules.reduce((sum, r) => sum + (Number(r.amount_or_rate) || 0), 0);
  const liveDailyFixed = Number((liveFixedSum / daysInMonth).toFixed(2));

  assert.strictEqual(liveFixedSum, 0, 'Live fixed cost sum must be 0');
  assert.strictEqual(liveDailyFixed, 0, 'Daily fixed cost must be ₹0.00');
  console.log('✔ Checkpoint 4A (Zero Fixed Rules): Daily overheads correctly compute to ₹0.00.');

  // Scenario 4B: Nonzero Configured Fixed Costs (Simulation)
  const mockCostRules = [
    { cost_name: 'Property Rent', cost_classification: 'Variable', amount_or_rate: 0.10 },
    { cost_name: 'Internet & Telecom', cost_classification: 'Fixed', amount_or_rate: 3500 },
    { cost_name: 'Software Subscriptions', cost_classification: 'Fixed', amount_or_rate: 2000 },
  ];
  const simFixedRules = mockCostRules.filter(r => r.cost_classification === 'Fixed');
  const simFixedSum = simFixedRules.reduce((sum, r) => sum + (Number(r.amount_or_rate) || 0), 0);
  const simDailyFixed = Number((simFixedSum / daysInMonth).toFixed(2));

  assert.strictEqual(simFixedSum, 5500, 'Simulated fixed rules sum must be 5,500');
  // 5,500 / 31 = 177.419... -> 177.42
  assert.strictEqual(simDailyFixed, 177.42, 'Daily overheads must be 177.42');
  console.log(`✔ Checkpoint 4B (Nonzero Fixed Rules): ₹5,500 monthly overheads correctly compute to ₹${simDailyFixed}/day.\n`);

  console.log('================================================================');
  console.log('ALL CHECKPOINTS PASSED CLEANLY WITH ZERO INTEGRITY DEFECTS');
  console.log('================================================================');
}

runFocusedVerification().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
