import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { calculateDailyProfitability } from '../src/lib/finance-engine.js';

// Safe environment loader (reads runtime env or local .env.local; never commits credentials)
function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Error: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment or .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TEST_DATE = '2026-09-28';

async function runVerification() {
  console.log('======================================================================');
  console.log('📊 END-TO-END VERIFICATION: OPERATIONAL CONSUMPTION & DAILY P&L / EBITDA');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Fetch Master Data
  const { data: locations } = await supabase.from('inventory_locations').select('*');
  const storeLoc = locations.find((l) => l.code === 'STORE');

  const { data: employees } = await supabase
    .from('employees')
    .select('*, department:departments(*), team:teams(*), role:employee_roles(*)');
  const shivam = employees.find((e) => e.name === 'Shivam');

  const { data: a4Paper } = await supabase
    .from('inventory_items')
    .select('*, location_stocks:item_location_stocks(*)')
    .eq('name', 'A4 Paper')
    .single();

  const initStock = Number(a4Paper.current_stock);
  const initLocStock = Number(a4Paper.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);
  const a4Cost = Number(a4Paper.current_weighted_average_cost); // ₹20.00
  const testQty = 10;
  const expectedValue = testQty * a4Cost; // ₹200.00

  console.log(`Test Item: ${a4Paper.name}`);
  console.log(`Inventory Class: ${a4Paper.inventory_class}`);
  console.log(`Initial Stock in Store: ${initLocStock} units`);
  console.log(`Unit Cost: ₹${a4Cost.toFixed(2)}`);
  console.log(`Test Issue Quantity: ${testQty} units -> Expected Impact: ₹${expectedValue.toFixed(2)}\n`);

  // 2. Capture BEFORE State
  const { data: beforeFin } = await supabase
    .from('daily_financial_summary')
    .select('*')
    .eq('business_date', TEST_DATE)
    .single();

  const beforeRevenue = Number(beforeFin.revenue);
  const beforeCustomerFood = Number(beforeFin.customer_food_consumption);
  const beforeStaffFood = Number(beforeFin.staff_food_consumption);
  const beforeWastage = Number(beforeFin.wastage_cost);
  const beforeOperational = Number(beforeFin.operational_consumption || 0);
  const beforeTotalConsumption = Number(beforeFin.total_material_consumption);
  const beforeSurplus = Number(beforeFin.gross_operating_surplus);

  console.log('--------------------------------------------------');
  console.log(`📋 BEFORE STATE (Date: ${TEST_DATE})`);
  console.log('--------------------------------------------------');
  console.log(`  Revenue:                   ₹${beforeRevenue.toFixed(2)}`);
  console.log(`  Customer Food Consumed:    ₹${beforeCustomerFood.toFixed(2)}`);
  console.log(`  Staff Meals & Mess:        ₹${beforeStaffFood.toFixed(2)}`);
  console.log(`  Wastage & Spoilage:        ₹${beforeWastage.toFixed(2)}`);
  console.log(`  Operational Consumption:   ₹${beforeOperational.toFixed(2)}`);
  console.log(`  Total Consumption:         ₹${beforeTotalConsumption.toFixed(2)}`);
  console.log(`  Operating Surplus / EBITDA:₹${beforeSurplus.toFixed(2)}`);

  // 3. Create Store Issue Classified as Operational Consumption
  console.log('\n--- Executing Store Issue for Operational Consumption ---');
  const { data: issueHeader, error: headerErr } = await supabase
    .from('consumption_issues')
    .insert({
      business_date: TEST_DATE,
      source_location_id: storeLoc.id,
      department_id: shivam.department_id,
      team_id: shivam.team_id,
      received_by_staff_id: shivam.id,
      responsible_chef_id: shivam.id,
      purpose: 'Operational Consumption',
      notes: 'Audit Test: Issue 10 packs A4 Paper for Front Desk & Accounts',
    })
    .select()
    .single();

  assert(!headerErr && issueHeader?.id, 'consumption_issues header created with purpose=Operational Consumption');

  const { data: movId, error: txErr } = await supabase.rpc('execute_inventory_transaction', {
    p_item_id: a4Paper.id,
    p_business_date: TEST_DATE,
    p_movement_type: 'issue',
    p_quantity: testQty,
    p_unit_cost: a4Cost,
    p_source_location_id: storeLoc.id,
    p_department_id: shivam.department_id,
    p_responsible_person_id: shivam.id,
    p_purpose: 'Operational Consumption',
    p_reference_id: issueHeader.id,
    p_reference_type: 'consumption_issues',
    p_notes: `Stationery issued to ${shivam.name} (Operational Consumption)`,
  });

  assert(!txErr && movId, 'execute_inventory_transaction created stock movement with purpose=Operational Consumption');

  // 4. Capture AFTER State
  const { data: afterItem } = await supabase
    .from('inventory_items')
    .select('current_stock, location_stocks:item_location_stocks(*)')
    .eq('id', a4Paper.id)
    .single();

  const afterLocStock = Number(afterItem.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);

  const { data: afterFin } = await supabase
    .from('daily_financial_summary')
    .select('*')
    .eq('business_date', TEST_DATE)
    .single();

  const afterRevenue = Number(afterFin.revenue);
  const afterCustomerFood = Number(afterFin.customer_food_consumption);
  const afterStaffFood = Number(afterFin.staff_food_consumption);
  const afterWastage = Number(afterFin.wastage_cost);
  const afterOperational = Number(afterFin.operational_consumption || 0);
  const afterTotalConsumption = Number(afterFin.total_material_consumption);
  const afterSurplus = Number(afterFin.gross_operating_surplus);

  console.log('\n--------------------------------------------------');
  console.log(`📋 AFTER STATE (Date: ${TEST_DATE})`);
  console.log('--------------------------------------------------');
  console.log(`  Revenue:                   ₹${afterRevenue.toFixed(2)}  (Delta: ₹${(afterRevenue - beforeRevenue).toFixed(2)})`);
  console.log(`  Customer Food Consumed:    ₹${afterCustomerFood.toFixed(2)}  (Delta: ₹${(afterCustomerFood - beforeCustomerFood).toFixed(2)})`);
  console.log(`  Staff Meals & Mess:        ₹${afterStaffFood.toFixed(2)}  (Delta: ₹${(afterStaffFood - beforeStaffFood).toFixed(2)})`);
  console.log(`  Wastage & Spoilage:        ₹${afterWastage.toFixed(2)}  (Delta: ₹${(afterWastage - beforeWastage).toFixed(2)})`);
  console.log(`  Operational Consumption:   ₹${afterOperational.toFixed(2)}  (Delta: +₹${(afterOperational - beforeOperational).toFixed(2)})`);
  console.log(`  Total Consumption:         ₹${afterTotalConsumption.toFixed(2)}  (Delta: +₹${(afterTotalConsumption - beforeTotalConsumption).toFixed(2)})`);
  console.log(`  Operating Surplus / EBITDA:₹${afterSurplus.toFixed(2)}  (Delta: -₹${Math.abs(afterSurplus - beforeSurplus).toFixed(2)})`);

  // 5. Explicit Mathematical Assertions
  console.log('\n--- Mathematical Assertions ---');
  assert(initLocStock - afterLocStock === testQty, `Store location stock decreased by exactly ${testQty} (from ${initLocStock} to ${afterLocStock})`);
  assert(afterRevenue === beforeRevenue, `Revenue unchanged (₹${afterRevenue.toFixed(2)})`);
  assert(afterCustomerFood === beforeCustomerFood, `Customer Food Consumed strictly unchanged (₹${afterCustomerFood.toFixed(2)})`);
  assert(afterStaffFood === beforeStaffFood, `Staff Meals strictly unchanged (₹${afterStaffFood.toFixed(2)})`);
  assert(afterWastage === beforeWastage, `Wastage & Spoilage strictly unchanged (₹${afterWastage.toFixed(2)})`);
  assert(
    Math.abs(afterOperational - (beforeOperational + expectedValue)) < 0.01,
    `Operational Consumption increased by exactly ₹${expectedValue.toFixed(2)} (from ₹${beforeOperational.toFixed(2)} to ₹${afterOperational.toFixed(2)})`
  );
  assert(
    Math.abs(afterTotalConsumption - (beforeTotalConsumption + expectedValue)) < 0.01,
    `Total Material Consumption increased by exactly ₹${expectedValue.toFixed(2)} (from ₹${beforeTotalConsumption.toFixed(2)} to ₹${afterTotalConsumption.toFixed(2)})`
  );
  assert(
    Math.abs(afterSurplus - (beforeSurplus - expectedValue)) < 0.01,
    `Operating Surplus / EBITDA decreased by exactly ₹${expectedValue.toFixed(2)} (from ₹${beforeSurplus.toFixed(2)} to ₹${afterSurplus.toFixed(2)})`
  );

  // 6. Test Finance Engine calculateDailyProfitability Output
  console.log('\n--- Finance Engine calculateDailyProfitability Verification ---');
  const pnlOutput = calculateDailyProfitability({
    businessDate: TEST_DATE,
    isReported: true,
    grossSales: 54090.50,
    discounts: 0,
    netSales: 54090.50,
    paymentCommissions: 0,
    customerFoodConsumption: afterCustomerFood,
    staffFoodConsumption: afterStaffFood,
    wastageCost: afterWastage,
    operationalConsumption: afterOperational,
    operationalUtilities: {
      electricityCost: 0,
      electricityKvah: 0,
      electricityRate: 10,
      generatorDieselCost: 0,
      generatorDieselLiters: 0,
      commercialLpgCost: 0,
      commercialLpgCylinders: 0,
      totalOperationalUtilities: 0,
    },
    variableExpenses: 0,
    revenueLinkedRates: {
      rentPercent: 0.10,
      investorSharePercent: 0.08,
    },
    monthlyFixedAllocations: {
      totalMonthlySalaries: 68000,
      otherMonthlyFixedCosts: 3500,
      daysInMonth: 30,
    },
  });

  assert(pnlOutput.customerFoodConsumption === 0, 'pnlOutput.customerFoodConsumption is ₹0.00');
  assert(pnlOutput.foodCostPercent === 0, 'Food Cost % is strictly 0.00% (Not inflated by Operational Consumption)');
  assert(pnlOutput.operationalConsumption === expectedValue, `pnlOutput.operationalConsumption is exactly ₹${expectedValue.toFixed(2)}`);
  assert(pnlOutput.totalDirectConsumption === expectedValue, `pnlOutput.totalDirectConsumption is exactly ₹${expectedValue.toFixed(2)}`);
  assert(pnlOutput.complimentaryFoodConsumption === undefined, 'complimentaryFoodConsumption is completely absent from P&L output');
  assert(pnlOutput.samplingConsumption === undefined, 'samplingConsumption is completely absent from P&L output');

  // 7. Verify Petpooja Sales Source of Truth
  console.log('\n--- Petpooja Sales Source of Truth Verification ---');
  const { data: salesOrders } = await supabase
    .from('sales_orders')
    .select('id, net_sales, status')
    .eq('business_date', TEST_DATE);

  const { data: execSummary } = await supabase
    .from('sales_executive_summaries')
    .select('*')
    .eq('business_date', TEST_DATE)
    .single();

  assert(salesOrders && salesOrders.length > 0, `Sales orders for ${TEST_DATE} intact (${salesOrders.length} orders)`);
  assert(Number(execSummary.net_sales) === 54090.50, `Executive summary net sales intact (₹${Number(execSummary.net_sales).toFixed(2)})`);

  // 8. Clean Up Test Movement & Restore A4 Paper Stock
  console.log('\n--- Cleaning Up Test Movement & Restoring Baseline Stock ---');
  await supabase.from('stock_movements').delete().eq('id', movId);
  await supabase.from('consumption_issues').delete().eq('id', issueHeader.id);

  // Restore inventory items & location stock
  await supabase
    .from('inventory_items')
    .update({ current_stock: initStock, updated_at: new Date().toISOString() })
    .eq('id', a4Paper.id);

  await supabase
    .from('item_location_stocks')
    .update({ quantity: initLocStock, updated_at: new Date().toISOString() })
    .eq('id', a4Paper.location_stocks[0].id);

  const { data: restoredFin } = await supabase
    .from('daily_financial_summary')
    .select('*')
    .eq('business_date', TEST_DATE)
    .single();

  assert(Number(restoredFin.gross_operating_surplus) === beforeSurplus, `Operating Surplus restored to initial ₹${beforeSurplus.toFixed(2)}`);
  assert(Number(restoredFin.operational_consumption || 0) === beforeOperational, `Operational consumption restored to ₹${beforeOperational.toFixed(2)}`);

  console.log('\n======================================================================');
  console.log(`🏁 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
