import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

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

const TEST_DATE = '2026-09-29';

async function runTests() {
  console.log('====================================================');
  console.log('🚀 STORE ISSUES, TRANSFERS & WASTAGE TEST SUITE');
  console.log('====================================================\n');

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

  // Clean up any prior test records for TEST_DATE
  await supabase.from('stock_movements').delete().eq('business_date', TEST_DATE);
  await supabase.from('consumption_issues').delete().eq('business_date', TEST_DATE);

  // Fetch Master Data
  const { data: locations } = await supabase.from('inventory_locations').select('*');
  const storeLoc = locations.find((l) => l.code === 'STORE');
  const bevLoc = locations.find((l) => l.code === 'BEV-CTR');

  const { data: employees } = await supabase
    .from('employees')
    .select('*, department:departments(*), team:teams(*), role:employee_roles(*)');
  const ramVerma = employees.find((e) => e.name === 'Ram Verma');
  const shivam = employees.find((e) => e.name === 'Shivam');

  const { data: items } = await supabase
    .from('inventory_items')
    .select('*, category:inventory_categories(*), location_stocks:item_location_stocks(*)');
  
  const chaap = items.find((i) => i.name === 'Chaap');
  const redOnion = items.find((i) => i.name.includes('Red Onion'));
  const a4Paper = items.find((i) => i.name === 'A4 Paper');
  const paneer = items.find((i) => i.name.includes('Paneer'));
  const mineralWater = items.find((i) => i.name.includes('Mineral Water'));
  const chair = items.find((i) => i.name === 'Chair');
  const chefCoat = items.find((i) => i.name.includes('Chef Coat'));
  const diesel = items.find((i) => i.name.includes('Diesel'));

  const baselineChaapStock = Number(chaap.current_stock);
  const baselineChaapLocStock = Number(chaap.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);
  const baselineOnionStock = Number(redOnion.current_stock);
  const baselineOnionLocStock = Number(redOnion.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);
  const baselineA4Stock = Number(a4Paper.current_stock);
  const baselineA4LocStock = Number(a4Paper.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);
  const baselineMwStock = Number(mineralWater.current_stock);
  const baselineMwStoreStock = Number(mineralWater.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);
  const baselineMwBevStock = Number(mineralWater.location_stocks.find((s) => s.location_id === bevLoc.id)?.quantity || 0);

  // ------------------------------------------------------------------
  // TEST 1: Item Eligibility Filtering
  // ------------------------------------------------------------------
  console.log('\n--- 1. Item Eligibility Filtering ---');
  assert(chaap && chaap.inventory_class === 'Food Raw Material', 'Chaap is Food Raw Material');
  assert(a4Paper && a4Paper.inventory_class === 'Non-Food Consumable', 'A4 Paper is Non-Food Consumable');
  assert(chair && chair.inventory_class === 'Physical Asset', 'Chair is Physical Asset (must be excluded from Issue)');
  assert(chefCoat && chefCoat.inventory_class === 'Uniform', 'Chef Coat is Uniform (must be excluded from Issue)');
  assert(diesel && diesel.category?.name.includes('Fuel'), 'Diesel is Fuel (must be excluded from generic Issue)');

  // ------------------------------------------------------------------
  // TEST 2: Staff-First Auto-Inference
  // ------------------------------------------------------------------
  console.log('\n--- 2. Staff-First Auto-Inference ---');
  assert(ramVerma.department?.name === 'Kitchen & Production', 'Ram Verma infers Department: Kitchen & Production');
  assert(ramVerma.team?.name === 'North Indian Kitchen', 'Ram Verma infers Team: North Indian Kitchen');
  assert(shivam.department?.name === 'Stores & Inventory', 'Shivam infers Department: Stores & Inventory');

  // ------------------------------------------------------------------
  // TEST 3: Zero Stock Safeguard
  // ------------------------------------------------------------------
  console.log('\n--- 3. Zero Stock Safeguard ---');
  const paneerStoreStock = paneer.location_stocks?.find((s) => s.location_id === storeLoc.id)?.quantity || 0;
  assert(paneerStoreStock <= 0, `Fresh Malai Paneer has 0 stock (${paneerStoreStock})`);

  // ------------------------------------------------------------------
  // TEST 4: Normal Issue (Customer Food)
  // ------------------------------------------------------------------
  console.log('\n--- 4. Normal Issue (Customer Food Production) ---');
  const initChaapStock = Number(chaap.current_stock);
  const initChaapLocStock = Number(chaap.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);

  // 1. Create consumption_issues header with receiving staff
  const { data: issue1, error: iss1Err } = await supabase
    .from('consumption_issues')
    .insert({
      business_date: TEST_DATE,
      source_location_id: storeLoc.id,
      department_id: ramVerma.department_id,
      team_id: ramVerma.team_id,
      received_by_staff_id: ramVerma.id,
      responsible_chef_id: ramVerma.id,
      purpose: 'Customer Food',
      notes: 'Test Customer Food Issue to Ram Verma',
    })
    .select()
    .single();

  assert(!iss1Err && issue1?.id, `Created consumption_issues header with received_by_staff_id`);

  // 2. Add line and execute transaction
  const issueQty = 2;
  const unitCost = Number(chaap.current_weighted_average_cost);

  await supabase.from('consumption_issue_items').insert({
    issue_id: issue1.id,
    item_id: chaap.id,
    quantity: issueQty,
    unit_cost: unitCost,
    total_value: issueQty * unitCost,
  });

  const { data: movId1, error: tx1Err } = await supabase.rpc('execute_inventory_transaction', {
    p_item_id: chaap.id,
    p_business_date: TEST_DATE,
    p_movement_type: 'issue',
    p_quantity: issueQty,
    p_unit_cost: unitCost,
    p_source_location_id: storeLoc.id,
    p_department_id: ramVerma.department_id,
    p_responsible_person_id: ramVerma.id,
    p_purpose: 'Customer Food',
    p_reference_id: issue1.id,
    p_reference_type: 'consumption_issues',
    p_notes: `Issued to ${ramVerma.name}`,
  });

  assert(!tx1Err && movId1, 'execute_inventory_transaction created issue stock movement');

  // Verify stock decremented
  const { data: updatedChaap } = await supabase
    .from('inventory_items')
    .select('current_stock, location_stocks:item_location_stocks(*)')
    .eq('id', chaap.id)
    .single();
  const updatedChaapLoc = updatedChaap.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity;

  assert(Number(updatedChaap.current_stock) === initChaapStock - issueQty, `Total stock decremented by ${issueQty}`);
  assert(Number(updatedChaapLoc) === initChaapLocStock - issueQty, `Location stock decremented by ${issueQty}`);

  // ------------------------------------------------------------------
  // TEST 5: Staff Khana Issue
  // ------------------------------------------------------------------
  console.log('\n--- 5. Staff Khana Issue ---');
  const initOnionStock = Number(redOnion.current_stock);
  const staffKhanaQty = 3;
  const onionCost = Number(redOnion.current_weighted_average_cost);

  const { data: issue2, error: iss2Err } = await supabase
    .from('consumption_issues')
    .insert({
      business_date: TEST_DATE,
      source_location_id: storeLoc.id,
      department_id: ramVerma.department_id,
      team_id: ramVerma.team_id,
      received_by_staff_id: ramVerma.id,
      responsible_chef_id: ramVerma.id,
      purpose: 'Staff Food',
      notes: 'Test Staff Khana to Ram Verma',
    })
    .select()
    .single();

  assert(!iss2Err && issue2?.id, 'Created Staff Khana consumption_issues header');

  const { data: movId2, error: tx2Err } = await supabase.rpc('execute_inventory_transaction', {
    p_item_id: redOnion.id,
    p_business_date: TEST_DATE,
    p_movement_type: 'staff_food',
    p_quantity: staffKhanaQty,
    p_unit_cost: onionCost,
    p_source_location_id: storeLoc.id,
    p_department_id: ramVerma.department_id,
    p_responsible_person_id: ramVerma.id,
    p_purpose: 'Staff Food',
    p_reference_id: issue2.id,
    p_reference_type: 'consumption_issues',
    p_notes: `Staff Khana issued to ${ramVerma.name}`,
  });

  assert(!tx2Err && movId2, 'Staff Khana movement created with movement_type=staff_food, purpose=Staff Food');

  // ------------------------------------------------------------------
  // TEST 6: Operational Consumption (Non-Food Consumables)
  // ------------------------------------------------------------------
  console.log('\n--- 6. Operational Consumption (Consumables to Staff) ---');
  const initA4Stock = Number(a4Paper.current_stock);
  const a4Qty = 1;
  const a4Cost = Number(a4Paper.current_weighted_average_cost);

  const { data: issue3, error: iss3Err } = await supabase
    .from('consumption_issues')
    .insert({
      business_date: TEST_DATE,
      source_location_id: storeLoc.id,
      department_id: shivam.department_id,
      team_id: shivam.team_id,
      received_by_staff_id: shivam.id,
      responsible_chef_id: shivam.id,
      purpose: 'Operational Consumption',
      notes: 'Test Stationery to Shivam',
    })
    .select()
    .single();

  assert(!iss3Err && issue3?.id, 'Created Operational Consumption header without check constraint error!');

  const { data: movId3, error: tx3Err } = await supabase.rpc('execute_inventory_transaction', {
    p_item_id: a4Paper.id,
    p_business_date: TEST_DATE,
    p_movement_type: 'issue',
    p_quantity: a4Qty,
    p_unit_cost: a4Cost,
    p_source_location_id: storeLoc.id,
    p_department_id: shivam.department_id,
    p_responsible_person_id: shivam.id,
    p_purpose: 'Operational Consumption',
    p_reference_id: issue3.id,
    p_reference_type: 'consumption_issues',
    p_notes: `Issued to ${shivam.name}`,
  });

  assert(!tx3Err && movId3, 'Operational Consumption movement recorded successfully');

  // ------------------------------------------------------------------
  // TEST 7: Wastage Event (Separate Workflow, No Staff/Dept)
  // ------------------------------------------------------------------
  console.log('\n--- 7. Wastage Event (No Staff, No Department) ---');
  const wasteQty = 1;
  const { data: wasteMovId, error: wasteErr } = await supabase.rpc('execute_inventory_transaction', {
    p_item_id: redOnion.id,
    p_business_date: TEST_DATE,
    p_movement_type: 'wastage',
    p_quantity: wasteQty,
    p_unit_cost: onionCost,
    p_source_location_id: storeLoc.id,
    p_purpose: 'Wastage',
    p_notes: 'Transit damage write-off',
    p_department_id: null,
    p_responsible_person_id: null,
  });

  assert(!wasteErr && wasteMovId, 'Wastage recorded via execute_inventory_transaction without recipient');

  const { data: wasteMov } = await supabase.from('stock_movements').select('*').eq('id', wasteMovId).single();
  assert(wasteMov.movement_type === 'wastage' && wasteMov.purpose === 'Wastage', 'Movement type & purpose verified as Wastage');
  assert(wasteMov.responsible_person_id === null, 'No recipient recorded for wastage');

  // ------------------------------------------------------------------
  // TEST 8: Spoilage Event (Separate Workflow, No Staff/Dept)
  // ------------------------------------------------------------------
  console.log('\n--- 8. Spoilage Event (No Staff, No Department) ---');
  const spoilQty = 1;
  const { data: spoilMovId, error: spoilErr } = await supabase.rpc('execute_inventory_transaction', {
    p_item_id: chaap.id,
    p_business_date: TEST_DATE,
    p_movement_type: 'spoilage',
    p_quantity: spoilQty,
    p_unit_cost: unitCost,
    p_source_location_id: storeLoc.id,
    p_purpose: 'Spoilage',
    p_notes: 'Spoiled / Sour',
    p_department_id: null,
    p_responsible_person_id: null,
  });

  assert(!spoilErr && spoilMovId, 'Spoilage recorded via execute_inventory_transaction without recipient');

  // ------------------------------------------------------------------
  // TEST 9: Inter-Location Transfer
  // ------------------------------------------------------------------
  console.log('\n--- 9. Inter-Location Transfer (Store -> Beverage Counter) ---');
  const initMwTotal = Number(mineralWater.current_stock);
  const initMwStore = Number(mineralWater.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);
  const initMwBev = Number(mineralWater.location_stocks.find((s) => s.location_id === bevLoc.id)?.quantity || 0);
  const transferQty = 5;
  const mwCost = Number(mineralWater.current_weighted_average_cost);

  const { data: trfMovId, error: trfErr } = await supabase.rpc('execute_inventory_transaction', {
    p_item_id: mineralWater.id,
    p_business_date: TEST_DATE,
    p_movement_type: 'transfer',
    p_quantity: transferQty,
    p_unit_cost: mwCost,
    p_source_location_id: storeLoc.id,
    p_destination_location_id: bevLoc.id,
    p_purpose: 'Inter-Location Stock Transfer',
    p_notes: 'Transferred from Central Store to Beverage Counter',
    p_department_id: null,
    p_responsible_person_id: null,
  });

  assert(!trfErr && trfMovId, 'Transfer executed without recipient or purpose dropdown');

  const { data: updatedMw } = await supabase
    .from('inventory_items')
    .select('current_stock, location_stocks:item_location_stocks(*)')
    .eq('id', mineralWater.id)
    .single();
  const updatedMwStore = Number(updatedMw.location_stocks.find((s) => s.location_id === storeLoc.id)?.quantity || 0);
  const updatedMwBev = Number(updatedMw.location_stocks.find((s) => s.location_id === bevLoc.id)?.quantity || 0);

  assert(Number(updatedMw.current_stock) === initMwTotal, 'Total inventory remains CONSTANT after transfer');
  assert(updatedMwStore === initMwStore - transferQty, `Source location decremented by ${transferQty}`);
  assert(updatedMwBev === initMwBev + transferQty, `Destination location incremented by ${transferQty}`);

  // ------------------------------------------------------------------
  // TEST 10: Downstream Daily P&L & MTD Financial Summary
  // ------------------------------------------------------------------
  console.log('\n--- 10. Downstream Daily P&L & MTD Financial Summary ---');
  const { data: finSum, error: finErr } = await supabase
    .from('daily_financial_summary')
    .select('*')
    .eq('business_date', TEST_DATE)
    .single();

  assert(!finErr && finSum, 'daily_financial_summary queried successfully for test date');

  const expectedCustFood = issueQty * unitCost; // 2 * 200 = 400
  const expectedStaffFood = staffKhanaQty * onionCost; // 3 * 26.67 = 80.01
  const expectedWastage = (wasteQty * onionCost) + (spoilQty * unitCost); // 26.67 + 200 = 226.67
  const expectedConsumable = a4Qty * a4Cost; // 20
  const expectedTotalConsumption = expectedCustFood + expectedStaffFood + expectedWastage + expectedConsumable;

  console.log(`  Customer Food Cost: ₹${finSum.customer_food_consumption} (Expected ~₹${expectedCustFood})`);
  console.log(`  Staff Food Cost: ₹${finSum.staff_food_consumption} (Expected ~₹${expectedStaffFood})`);
  console.log(`  Wastage Cost: ₹${finSum.wastage_cost} (Expected ~₹${expectedWastage})`);
  console.log(`  Total Consumption: ₹${finSum.total_material_consumption} (Expected ~₹${expectedTotalConsumption})`);

  assert(Math.abs(Number(finSum.customer_food_consumption) - expectedCustFood) < 0.1, 'Customer food cost accurately populated in view');
  assert(Math.abs(Number(finSum.staff_food_consumption) - expectedStaffFood) < 0.1, 'Staff food cost accurately populated in view');
  assert(Math.abs(Number(finSum.wastage_cost) - expectedWastage) < 0.1, 'Wastage cost accurately populated in view');
  assert(Math.abs(Number(finSum.total_material_consumption) - expectedTotalConsumption) < 0.1, 'Total consumption accurately includes Operational Consumption');

  // MTD RPC
  const { data: mtdRes, error: mtdErr } = await supabase.rpc('get_mtd_financial_summary', { p_business_date: TEST_DATE });
  assert(!mtdErr && mtdRes && mtdRes.length > 0, 'get_mtd_financial_summary RPC executed cleanly');

  // ------------------------------------------------------------------
  // TEST 11: Audit Trail Verification
  // ------------------------------------------------------------------
  console.log('\n--- 11. Audit Trail & CCTV Correlation ---');
  const { data: auditMovs } = await supabase
    .from('stock_movements')
    .select('id, created_at, movement_type, purpose, quantity, unit_cost, total_value, source_location_id, destination_location_id, responsible_person_id')
    .eq('business_date', TEST_DATE)
    .order('created_at', { ascending: false });

  assert(auditMovs.length >= 6, `Retrieved ${auditMovs.length} stock movements for ${TEST_DATE}`);
  const sampleMov = auditMovs[0];
  assert(sampleMov.created_at && sampleMov.created_at.includes('T'), 'Exact server timestamp recorded for CCTV matching');

  // Clean up test records
  await supabase.from('stock_movements').delete().eq('business_date', TEST_DATE);
  await supabase.from('consumption_issues').delete().eq('business_date', TEST_DATE);

  // Restore baseline stocks
  await supabase.from('inventory_items').update({ current_stock: baselineChaapStock }).eq('id', chaap.id);
  await supabase.from('item_location_stocks').update({ quantity: baselineChaapLocStock }).eq('item_id', chaap.id).eq('location_id', storeLoc.id);

  await supabase.from('inventory_items').update({ current_stock: baselineOnionStock }).eq('id', redOnion.id);
  await supabase.from('item_location_stocks').update({ quantity: baselineOnionLocStock }).eq('item_id', redOnion.id).eq('location_id', storeLoc.id);

  await supabase.from('inventory_items').update({ current_stock: baselineA4Stock }).eq('id', a4Paper.id);
  await supabase.from('item_location_stocks').update({ quantity: baselineA4LocStock }).eq('item_id', a4Paper.id).eq('location_id', storeLoc.id);

  await supabase.from('inventory_items').update({ current_stock: baselineMwStock }).eq('id', mineralWater.id);
  await supabase.from('item_location_stocks').update({ quantity: baselineMwStoreStock }).eq('item_id', mineralWater.id).eq('location_id', storeLoc.id);
  await supabase.from('item_location_stocks').update({ quantity: baselineMwBevStock }).eq('item_id', mineralWater.id).eq('location_id', bevLoc.id);

  console.log('\n====================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
