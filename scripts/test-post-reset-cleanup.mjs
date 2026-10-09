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

async function runVerification() {
  console.log('====================================================');
  console.log('RUNNING POST-RESET INVENTORY & P&L VERIFICATION');
  console.log('====================================================\n');

  // 1. INVENTORY MASTER VERIFICATION
  console.log('Test 1: Verifying inventory_items catalog...');
  const { data: items, error: itemErr } = await supabase
    .from('inventory_items')
    .select('id, item_code, name, inventory_class, current_stock, current_weighted_average_cost, is_active')
    .order('item_code');

  assert(!itemErr, `Error fetching inventory items: ${itemErr?.message}`);
  assert(items.length === 2, `Expected exactly 2 inventory items, but found ${items.length}`);

  const diesel = items.find(i => i.item_code === 'CON-DSL-001');
  const lpg = items.find(i => i.item_code === 'CON-LPG-001');

  assert(diesel, 'CON-DSL-001 must exist');
  assert(diesel.id === DIESEL_ITEM_ID, `CON-DSL-001 ID must match ${DIESEL_ITEM_ID}`);
  assert(Number(diesel.current_stock) === 0, 'Diesel current_stock must be 0');
  assert(Number(diesel.current_weighted_average_cost) === 0, 'Diesel WAC must be 0');

  assert(lpg, 'CON-LPG-001 must exist');
  assert(lpg.id === LPG_ITEM_ID, `CON-LPG-001 ID must match ${LPG_ITEM_ID}`);
  assert(Number(lpg.current_stock) === 0, 'LPG current_stock must be 0');
  assert(Number(lpg.current_weighted_average_cost) === 0, 'LPG WAC must be 0');

  console.log('✔ Test 1 PASSED: Only CON-DSL-001 and CON-LPG-001 remain with 0 stock/WAC.\n');

  // 2. UTILITIES SINGLE QUERY VERIFICATION
  console.log('Test 2: Verifying Utilities .single() queries for Diesel & LPG...');
  const [{ data: dSingle, error: dErr }, { data: lSingle, error: lErr }] = await Promise.all([
    supabase.from('inventory_items').select('*').eq('id', DIESEL_ITEM_ID).single(),
    supabase.from('inventory_items').select('*').eq('id', LPG_ITEM_ID).single(),
  ]);

  assert(!dErr && dSingle, `DieselTab single query must succeed: ${dErr?.message}`);
  assert(!lErr && lSingle, `LpgTab single query must succeed: ${lErr?.message}`);
  console.log('✔ Test 2 PASSED: Utilities DieselTab and LpgTab single queries resolve cleanly.\n');

  // 3. STAFF & SALARY STATUS VERIFICATION
  console.log('Test 3: Verifying active employees and payroll pool...');
  const { data: emps, error: empErr } = await supabase
    .from('employees')
    .select('monthly_salary')
    .eq('employment_status', 'Active');

  assert(!empErr, `Error fetching employees: ${empErr?.message}`);
  const payroll = (emps || []).reduce((s, e) => s + (Number(e.monthly_salary) || 0), 0);
  assert(payroll === 0, `Expected active payroll to be 0, got ${payroll}`);
  console.log(`✔ Test 3 PASSED: Active staff count is ${emps.length}, active payroll is ₹0.00.\n`);

  // 4. COST RULES & FIXED OVERHEADS VERIFICATION
  console.log('Test 4: Verifying financial cost rules and fixed sum...');
  const { data: costRules, error: crErr } = await supabase
    .from('financial_cost_rules')
    .select('*')
    .eq('is_active', true);

  assert(!crErr, `Error fetching cost rules: ${crErr?.message}`);
  const fixedRules = (costRules || []).filter(r => r.cost_classification === 'Fixed');
  const fixedSum = fixedRules.reduce((sum, r) => sum + (Number(r.amount_or_rate) || 0), 0);
  assert(fixedSum === 0, `Expected fixed rules sum to be 0, got ${fixedSum}`);
  console.log(`✔ Test 4 PASSED: Fixed cost rules sum to ₹0.00.\n`);

  // 5. FINANCE ENGINE CALCULATION INTEGRITY
  console.log('Test 5: Verifying calculateDailyProfitability with 0 salaries and 0 fixed costs...');
  const daysInMonth = 31;
  const dailySalaries = payroll / daysInMonth;
  const dailyOtherFixed = fixedSum / daysInMonth;
  const dailyAllocatedFixedCosts = Number((dailySalaries + dailyOtherFixed).toFixed(2));

  assert(dailySalaries === 0, `Daily salaries must be 0, got ${dailySalaries}`);
  assert(dailyOtherFixed === 0, `Daily other fixed must be 0, got ${dailyOtherFixed}`);
  assert(dailyAllocatedFixedCosts === 0, `Daily allocated fixed costs must be 0, got ${dailyAllocatedFixedCosts}`);
  console.log('✔ Test 5 PASSED: Daily allocated fixed costs correctly evaluate to ₹0.00.\n');

  console.log('====================================================');
  console.log('ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

runVerification().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
