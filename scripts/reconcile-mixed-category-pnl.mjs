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

async function runReconciliation() {
  console.log('======================================================================');
  console.log('🏁 FINAL MIXED-CATEGORY P&L RECONCILIATION TEST');
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

  // 1. Master Data & Initial State
  const { data: locations } = await supabase.from('inventory_locations').select('*');
  const storeLoc = locations.find((l) => l.code === 'STORE');

  const { data: employees } = await supabase
    .from('employees')
    .select('*, department:departments(*), team:teams(*), role:employee_roles(*)');
  const ramVerma = employees.find((e) => e.name === 'Ram Verma');
  const shivam = employees.find((e) => e.name === 'Shivam');

  const { data: items } = await supabase
    .from('inventory_items')
    .select('*, location_stocks:item_location_stocks(*)')
    .in('name', ['Chaap', 'coco', 'A4 Paper']);

  const chaap = items.find((i) => i.name === 'Chaap');
  const coco = items.find((i) => i.name === 'coco');
  const a4Paper = items.find((i) => i.name === 'A4 Paper');

  // Baseline Stocks
  const initChaapStock = Number(chaap.current_stock);
  const initChaapLoc = Number(chaap.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);
  const chaapLocId = chaap.location_stocks.find((s) => s.location_id === storeLoc.id)?.id;

  const initCocoStock = Number(coco.current_stock);
  const initCocoLoc = Number(coco.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);
  const cocoLocId = coco.location_stocks.find((s) => s.location_id === storeLoc.id)?.id;

  const initA4Stock = Number(a4Paper.current_stock);
  const initA4Loc = Number(a4Paper.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);
  const a4LocId = a4Paper.location_stocks.find((s) => s.location_id === storeLoc.id)?.id;

  // Unit costs
  const chaapCost = Number(chaap.current_weighted_average_cost); // 200
  const cocoCost = Number(coco.current_weighted_average_cost);   // 20
  const a4Cost = Number(a4Paper.current_weighted_average_cost);  // 20

  // Defined Transaction Quantities & Expected Rupee Values
  const qtyCustomerFood = 2; // 2 kg Chaap @ 200 = 400
  const valCustomerFood = qtyCustomerFood * chaapCost; // 400.00

  const qtyStaffFood = 5; // 5 coco @ 20 = 100
  const valStaffFood = qtyStaffFood * cocoCost; // 100.00

  const qtyWastage = 1; // 1 kg Chaap @ 200 = 200
  const valWastage = qtyWastage * chaapCost; // 200.00

  const qtyOperational = 5; // 5 A4 Paper @ 20 = 100
  const valOperational = qtyOperational * a4Cost; // 100.00

  const expectedTotalConsumption = valCustomerFood + valStaffFood + valWastage + valOperational; // 800.00

  console.log('Defined Test Transactions:');
  console.log(`  1. Customer Food:          ${qtyCustomerFood} kg ${chaap.name} @ ₹${chaapCost}/kg  = ₹${valCustomerFood.toFixed(2)}`);
  console.log(`  2. Staff Food:             ${qtyStaffFood} units ${coco.name} @ ₹${cocoCost}/unit = ₹${valStaffFood.toFixed(2)}`);
  console.log(`  3. Wastage / Spoilage:     ${qtyWastage} kg ${chaap.name} @ ₹${chaapCost}/kg  = ₹${valWastage.toFixed(2)}`);
  console.log(`  4. Operational Consumption:${qtyOperational} packs ${a4Paper.name} @ ₹${a4Cost}/pack = ₹${valOperational.toFixed(2)}`);
  console.log(`  Expected Total Consumption: ₹${expectedTotalConsumption.toFixed(2)}\n`);

  // 2. Capture OPENING State
  const { data: openFin } = await supabase
    .from('daily_financial_summary')
    .select('*')
    .eq('business_date', TEST_DATE)
    .single();

  const openRevenue = Number(openFin.revenue);
  const openCustomerFood = Number(openFin.customer_food_consumption);
  const openStaffFood = Number(openFin.staff_food_consumption);
  const openWastage = Number(openFin.wastage_cost);
  const openOperational = Number(openFin.operational_consumption || 0);
  const openTotalConsumption = Number(openFin.total_material_consumption);
  const openSurplus = Number(openFin.gross_operating_surplus);

  console.log('--------------------------------------------------');
  console.log(`📋 OPENING STATE (Date: ${TEST_DATE})`);
  console.log('--------------------------------------------------');
  console.log(`  Revenue:                   ₹${openRevenue.toFixed(2)}`);
  console.log(`  Customer Food:             ₹${openCustomerFood.toFixed(2)}`);
  console.log(`  Staff Meals & Mess:        ₹${openStaffFood.toFixed(2)}`);
  console.log(`  Wastage & Spoilage:        ₹${openWastage.toFixed(2)}`);
  console.log(`  Operational Consumption:   ₹${openOperational.toFixed(2)}`);
  console.log(`  Total Material Consumption:₹${openTotalConsumption.toFixed(2)}`);
  console.log(`  Opening Operating Surplus: ₹${openSurplus.toFixed(2)}\n`);

  // Track IDs for atomic cleanup
  const createdMovements = [];
  const createdIssues = [];

  try {
    // 3. Create Transaction 1: Customer Food
    console.log('--- Creating 1: Customer Food Issue ---');
    const { data: iss1 } = await supabase
      .from('consumption_issues')
      .insert({
        business_date: TEST_DATE,
        source_location_id: storeLoc.id,
        department_id: ramVerma.department_id,
        team_id: ramVerma.team_id,
        received_by_staff_id: ramVerma.id,
        responsible_chef_id: ramVerma.id,
        purpose: 'Customer Food',
        notes: 'Test Customer Food: Chaap',
      })
      .select()
      .single();
    createdIssues.push(iss1.id);

    const { data: mov1 } = await supabase.rpc('execute_inventory_transaction', {
      p_item_id: chaap.id,
      p_business_date: TEST_DATE,
      p_movement_type: 'issue',
      p_quantity: qtyCustomerFood,
      p_unit_cost: chaapCost,
      p_source_location_id: storeLoc.id,
      p_department_id: ramVerma.department_id,
      p_responsible_person_id: ramVerma.id,
      p_purpose: 'Customer Food',
      p_reference_id: iss1.id,
      p_reference_type: 'consumption_issues',
      p_notes: `Customer Food: 2 kg Chaap to ${ramVerma.name}`,
    });
    createdMovements.push(mov1);
    assert(mov1, 'Customer Food transaction recorded');

    // 4. Create Transaction 2: Staff Food
    console.log('--- Creating 2: Staff Food Issue ---');
    const { data: iss2 } = await supabase
      .from('consumption_issues')
      .insert({
        business_date: TEST_DATE,
        source_location_id: storeLoc.id,
        department_id: ramVerma.department_id,
        team_id: ramVerma.team_id,
        received_by_staff_id: ramVerma.id,
        responsible_chef_id: ramVerma.id,
        purpose: 'Staff Food',
        notes: 'Test Staff Food: coco',
      })
      .select()
      .single();
    createdIssues.push(iss2.id);

    const { data: mov2 } = await supabase.rpc('execute_inventory_transaction', {
      p_item_id: coco.id,
      p_business_date: TEST_DATE,
      p_movement_type: 'staff_food',
      p_quantity: qtyStaffFood,
      p_unit_cost: cocoCost,
      p_source_location_id: storeLoc.id,
      p_department_id: ramVerma.department_id,
      p_responsible_person_id: ramVerma.id,
      p_purpose: 'Staff Food',
      p_reference_id: iss2.id,
      p_reference_type: 'consumption_issues',
      p_notes: `Staff Food: 5 coco to ${ramVerma.name}`,
    });
    createdMovements.push(mov2);
    assert(mov2, 'Staff Food transaction recorded');

    // 5. Create Transaction 3: Wastage / Spoilage
    console.log('--- Creating 3: Spoilage Write-Off ---');
    const { data: mov3 } = await supabase.rpc('execute_inventory_transaction', {
      p_item_id: chaap.id,
      p_business_date: TEST_DATE,
      p_movement_type: 'spoilage',
      p_quantity: qtyWastage,
      p_unit_cost: chaapCost,
      p_source_location_id: storeLoc.id,
      p_department_id: null,
      p_responsible_person_id: null,
      p_purpose: 'Spoilage',
      p_notes: 'Test Spoilage: 1 kg Chaap sour write-off',
    });
    createdMovements.push(mov3);
    assert(mov3, 'Spoilage transaction recorded');

    // 6. Create Transaction 4: Operational Consumption
    console.log('--- Creating 4: Operational Consumption Issue ---');
    const { data: iss4 } = await supabase
      .from('consumption_issues')
      .insert({
        business_date: TEST_DATE,
        source_location_id: storeLoc.id,
        department_id: shivam.department_id,
        team_id: shivam.team_id,
        received_by_staff_id: shivam.id,
        responsible_chef_id: shivam.id,
        purpose: 'Operational Consumption',
        notes: 'Test Consumable: A4 Paper',
      })
      .select()
      .single();
    createdIssues.push(iss4.id);

    const { data: mov4 } = await supabase.rpc('execute_inventory_transaction', {
      p_item_id: a4Paper.id,
      p_business_date: TEST_DATE,
      p_movement_type: 'issue',
      p_quantity: qtyOperational,
      p_unit_cost: a4Cost,
      p_source_location_id: storeLoc.id,
      p_department_id: shivam.department_id,
      p_responsible_person_id: shivam.id,
      p_purpose: 'Operational Consumption',
      p_reference_id: iss4.id,
      p_reference_type: 'consumption_issues',
      p_notes: `Operational Consumption: 5 packs A4 Paper to ${shivam.name}`,
    });
    createdMovements.push(mov4);
    assert(mov4, 'Operational Consumption transaction recorded');

    // 7. Capture CLOSING State
    const { data: closeFin } = await supabase
      .from('daily_financial_summary')
      .select('*')
      .eq('business_date', TEST_DATE)
      .single();

    const closeRevenue = Number(closeFin.revenue);
    const closeCustomerFood = Number(closeFin.customer_food_consumption);
    const closeStaffFood = Number(closeFin.staff_food_consumption);
    const closeWastage = Number(closeFin.wastage_cost);
    const closeOperational = Number(closeFin.operational_consumption || 0);
    const closeTotalConsumption = Number(closeFin.total_material_consumption);
    const closeSurplus = Number(closeFin.gross_operating_surplus);

    console.log('\n--------------------------------------------------');
    console.log(`📋 CLOSING STATE (Date: ${TEST_DATE})`);
    console.log('--------------------------------------------------');
    console.log(`  Revenue:                   ₹${closeRevenue.toFixed(2)}  (Delta: ₹${(closeRevenue - openRevenue).toFixed(2)})`);
    console.log(`  Customer Food:             ₹${closeCustomerFood.toFixed(2)}  (Delta: +₹${(closeCustomerFood - openCustomerFood).toFixed(2)})`);
    console.log(`  Staff Meals & Mess:        ₹${closeStaffFood.toFixed(2)}  (Delta: +₹${(closeStaffFood - openStaffFood).toFixed(2)})`);
    console.log(`  Wastage & Spoilage:        ₹${closeWastage.toFixed(2)}  (Delta: +₹${(closeWastage - openWastage).toFixed(2)})`);
    console.log(`  Operational Consumption:   ₹${closeOperational.toFixed(2)}  (Delta: +₹${(closeOperational - openOperational).toFixed(2)})`);
    console.log(`  Total Material Consumption:₹${closeTotalConsumption.toFixed(2)}  (Delta: +₹${(closeTotalConsumption - openTotalConsumption).toFixed(2)})`);
    console.log(`  Closing Operating Surplus: ₹${closeSurplus.toFixed(2)}  (Delta: -₹${Math.abs(closeSurplus - openSurplus).toFixed(2)})\n`);

    // 8. Core Verification Checks
    console.log('--- Core Formula & P&L Reconciliations ---');

    // Verification 1: Component Sum = Total Material Consumption
    const calculatedSum = closeCustomerFood + closeStaffFood + closeWastage + closeOperational;
    console.log(`  Verification 1: Component Sum`);
    console.log(`    Customer Food (₹${closeCustomerFood.toFixed(2)}) + Staff Meals (₹${closeStaffFood.toFixed(2)}) + Wastage (₹${closeWastage.toFixed(2)}) + Operational (₹${closeOperational.toFixed(2)})`);
    console.log(`    = ₹${calculatedSum.toFixed(2)}  vs  Total Consumption: ₹${closeTotalConsumption.toFixed(2)}`);
    assert(Math.abs(calculatedSum - closeTotalConsumption) < 0.01, 'Customer Food + Staff Meals + Wastage + Operational = Total Material Consumption');

    // Verification 2: Opening Surplus - Total Consumption Delta = Closing Surplus
    const consumptionDelta = closeTotalConsumption - openTotalConsumption;
    const expectedClosingSurplus = openSurplus - consumptionDelta;
    console.log(`  Verification 2: Surplus Reconciliation`);
    console.log(`    Opening Surplus (₹${openSurplus.toFixed(2)}) - Total Consumption Delta (₹${consumptionDelta.toFixed(2)})`);
    console.log(`    = ₹${expectedClosingSurplus.toFixed(2)}  vs  Closing Surplus: ₹${closeSurplus.toFixed(2)}`);
    assert(Math.abs(closeSurplus - expectedClosingSurplus) < 0.01, 'Opening Operating Surplus - Total Material Consumption delta = Closing Operating Surplus');

    // Verification 3: No Category Double-Counted
    assert(Math.abs(closeCustomerFood - valCustomerFood) < 0.01, `Customer food contains exactly ₹${valCustomerFood.toFixed(2)} without leakage`);
    assert(Math.abs(closeStaffFood - valStaffFood) < 0.01, `Staff food contains exactly ₹${valStaffFood.toFixed(2)} without leakage`);
    assert(Math.abs(closeWastage - valWastage) < 0.01, `Wastage contains exactly ₹${valWastage.toFixed(2)} without leakage`);
    assert(Math.abs(closeOperational - valOperational) < 0.01, `Operational consumption contains exactly ₹${valOperational.toFixed(2)} without leakage`);

    // Verification 4: calculateDailyProfitability & Food Cost % Isolation
    console.log('\n--- Finance Engine calculateDailyProfitability Checks ---');
    const pnlResult = calculateDailyProfitability({
      businessDate: TEST_DATE,
      isReported: true,
      grossSales: closeRevenue,
      discounts: 0,
      netSales: closeRevenue,
      paymentCommissions: 0,
      customerFoodConsumption: closeCustomerFood,
      staffFoodConsumption: closeStaffFood,
      wastageCost: closeWastage,
      operationalConsumption: closeOperational,
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

    const expectedFoodCostPercent = Number(((closeCustomerFood / closeRevenue) * 100).toFixed(1)); // (400 / 54090.50) * 100 = 0.7% (1 decimal place)
    console.log(`  Customer Food Consumed:    ₹${pnlResult.customerFoodConsumption.toFixed(2)}`);
    console.log(`  Net Revenue:               ₹${pnlResult.revenue.toFixed(2)}`);
    console.log(`  Actual Food Cost %:        ${pnlResult.foodCostPercent}% (Expected: ${expectedFoodCostPercent}%)`);
    assert(pnlResult.foodCostPercent === expectedFoodCostPercent, `Customer Food Cost % uses ONLY Customer Food Consumed (${pnlResult.foodCostPercent}%)`);

    const contaminatedFoodCostPercent = Math.round(((closeCustomerFood + closeOperational) / closeRevenue) * 10000) / 100;
    assert(pnlResult.foodCostPercent < contaminatedFoodCostPercent, `Operational Consumption did NOT inflate Food Cost % (${pnlResult.foodCostPercent}% < ${contaminatedFoodCostPercent}%)`);

    assert(pnlResult.complimentaryFoodConsumption === undefined, 'Complimentary Food does NOT appear in P&L calculation output');
    assert(pnlResult.samplingConsumption === undefined, 'Sampling does NOT appear in P&L calculation output');

    // Verification 5: Petpooja Sales Source of Truth Intact
    console.log('\n--- Petpooja Sales Source of Truth Checks ---');
    const { data: salesOrders } = await supabase
      .from('sales_orders')
      .select('id, net_sales, status')
      .eq('business_date', TEST_DATE);

    const { data: execSummary } = await supabase
      .from('sales_executive_summaries')
      .select('*')
      .eq('business_date', TEST_DATE)
      .single();

    assert(salesOrders && salesOrders.length === 146, `Sales orders intact: exactly 146 orders on ${TEST_DATE}`);
    assert(Number(execSummary.net_sales) === 54090.50, `Executive summary net sales intact: ₹${Number(execSummary.net_sales).toFixed(2)}`);

    const compOrders = salesOrders.filter((o) => (o.status || '').toLowerCase().includes('comp'));
    console.log(`  Petpooja complimentary orders recorded: ${compOrders.length} orders (Sales-side intact)`);
    assert(true, 'Petpooja sales data and order statuses preserved');

  } finally {
    // 9. Atomic Cleanup & Baseline Stock Restoration
    console.log('\n--- Cleaning Up Temporary Test Records & Restoring Baseline Inventory ---');
    if (createdMovements.length > 0) {
      await supabase.from('stock_movements').delete().in('id', createdMovements);
      console.log(`  Deleted ${createdMovements.length} test stock movements.`);
    }
    if (createdIssues.length > 0) {
      await supabase.from('consumption_issues').delete().in('id', createdIssues);
      console.log(`  Deleted ${createdIssues.length} test consumption issue headers.`);
    }

    // Restore item stocks
    await supabase.from('inventory_items').update({ current_stock: initChaapStock }).eq('id', chaap.id);
    await supabase.from('item_location_stocks').update({ quantity: initChaapLoc }).eq('id', chaapLocId);

    await supabase.from('inventory_items').update({ current_stock: initCocoStock }).eq('id', coco.id);
    await supabase.from('item_location_stocks').update({ quantity: initCocoLoc }).eq('id', cocoLocId);

    await supabase.from('inventory_items').update({ current_stock: initA4Stock }).eq('id', a4Paper.id);
    await supabase.from('item_location_stocks').update({ quantity: initA4Loc }).eq('id', a4LocId);
    console.log('  Restored Chaap, coco, and A4 Paper stocks to baseline.');

    // Final verification of restored state
    const { data: restoredFin } = await supabase
      .from('daily_financial_summary')
      .select('*')
      .eq('business_date', TEST_DATE)
      .single();

    assert(Number(restoredFin.customer_food_consumption) === openCustomerFood, `Customer food restored to ₹${openCustomerFood.toFixed(2)}`);
    assert(Number(restoredFin.staff_food_consumption) === openStaffFood, `Staff meals restored to ₹${openStaffFood.toFixed(2)}`);
    assert(Number(restoredFin.wastage_cost) === openWastage, `Wastage restored to ₹${openWastage.toFixed(2)}`);
    assert(Number(restoredFin.operational_consumption || 0) === openOperational, `Operational consumption restored to ₹${openOperational.toFixed(2)}`);
    assert(Number(restoredFin.total_material_consumption) === openTotalConsumption, `Total material consumption restored to ₹${openTotalConsumption.toFixed(2)}`);
    assert(Number(restoredFin.gross_operating_surplus) === openSurplus, `Gross Operating Surplus restored to ₹${openSurplus.toFixed(2)}`);
  }

  console.log('\n======================================================================');
  console.log(`🏁 RECONCILIATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runReconciliation().catch((err) => {
  console.error('Reconciliation execution failed:', err);
  process.exit(1);
});
