import fs from 'fs';
import { spawnSync } from 'child_process';

if (!process.env.__TSX_RUNNING__) {
  const quotedArgs = process.argv.slice(1).map(arg => `"${arg}"`);
  const result = spawnSync('npx tsx ' + quotedArgs.join(' '), {
    stdio: 'inherit',
    env: { ...process.env, __TSX_RUNNING__: '1' },
    shell: true,
  });
  process.exit(result.status ?? 0);
}

const env = fs.readFileSync('.env.local', 'utf8');
env.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
});

import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
const { resolveAllGroupWacs, resolveGroupWac, fetchAndResolveGroupWacs } = await import('../src/lib/sops/costing/wac.ts');
const { calculateAllRecipes, calculateRecipeCost, calculateVariantCost } = await import('../src/lib/sops/costing/calculator.ts');
const { calculateComboThaliCost } = await import('../src/lib/sops/costing/combos.ts');

const client = new Client({ connectionString: process.env.DATABASE_URL });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function runTests() {
  await client.connect();
  console.log('=== STARTING DAG COSTING & RECIPE MIGRATION VERIFICATION SUITE ===\n');

  let looseItem = null;
  let mdhItem = null;
  let rcpGroup = null;

  try {
    // 0. Verify Baseline: No items should have active costing or uncommitted DAG test movements
    const baseCheck = await client.query(`
      SELECT COUNT(*) as count 
      FROM public.inventory_items 
      WHERE current_weighted_average_cost != 0 OR is_costed = true
    `);
    const poCheck = await client.query(`
      SELECT COUNT(*) as count 
      FROM public.purchase_headers 
      WHERE id IN ('22222222-0001-4000-8000-000000000001', '22222222-0002-4000-8000-000000000002')
    `);
    console.log(`[Baseline] Items with non-zero WAC/costed: ${baseCheck.rows[0].count} (must be 0), test POs: ${poCheck.rows[0].count} (must be 0)`);
    if (parseInt(baseCheck.rows[0].count) !== 0 || parseInt(poCheck.rows[0].count) !== 0) {
      throw new Error(`Resting DB not at clean baseline: ${baseCheck.rows[0].count} costed items, ${poCheck.rows[0].count} test POs`);
    }

    // 1. Fetch DB records needed for Costing Engine
    const groupsRes = await client.query(`
      SELECT g.*, u.symbol as base_unit_symbol
      FROM public.logical_ingredient_groups g
      LEFT JOIN public.units u ON g.base_unit_id = u.id
      ORDER BY g.name
    `);
    const allGroups = groupsRes.rows.map(g => ({
      id: g.id,
      group_code: g.group_code,
      name: g.name,
      last_valid_wac: g.last_valid_wac ? parseFloat(g.last_valid_wac) : null,
      base_unit_symbol: g.base_unit_symbol
    }));

    const itemsRes = await client.query(`
      SELECT i.*, u.symbol as unit_symbol
      FROM public.inventory_items i
      LEFT JOIN public.units u ON i.unit_id = u.id
      ORDER BY i.name
    `);
    const allItems = itemsRes.rows.map(i => ({
      id: i.id,
      item_code: i.item_code,
      name: i.name,
      group_id: i.group_id,
      brand_name: i.brand_name,
      current_stock: parseFloat(i.current_stock || 0),
      current_weighted_average_cost: parseFloat(i.current_weighted_average_cost || 0),
      is_costed: i.is_costed || false,
      is_active: i.is_active !== false,
      unit_symbol: i.unit_symbol
    }));

    const recipesRes = await client.query(`
      SELECT * FROM public.yatra_recipes ORDER BY category, name
    `);
    const allRecipes = recipesRes.rows;

    const ingsRes = await client.query(`
      SELECT ri.*, g.name as group_name
      FROM public.yatra_recipe_ingredients ri
      LEFT JOIN public.logical_ingredient_groups g ON ri.ingredient_group_id = g.id
      ORDER BY ri.recipe_id, ri.sort_order
    `);
    const allIngs = ingsRes.rows;

    // Attach ingredients to recipes
    const ingsByRecipe = new Map();
    for (const ing of allIngs) {
      if (!ingsByRecipe.has(ing.recipe_id)) ingsByRecipe.set(ing.recipe_id, []);
      ingsByRecipe.get(ing.recipe_id).push({
        id: ing.id,
        recipe_id: ing.recipe_id,
        ingredient_type: ing.ingredient_type,
        ingredient_group_id: ing.ingredient_group_id,
        inventory_item_id: ing.inventory_item_id,
        sub_recipe_id: ing.sub_recipe_id,
        quantity: parseFloat(ing.quantity),
        unit: ing.unit,
        sort_order: ing.sort_order,
        ingredient_group: ing.group_name ? { id: ing.ingredient_group_id, name: ing.group_name } : undefined
      });
    }

    const recipesWithIngs = allRecipes.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      batch_yield_quantity: r.batch_yield_quantity ? parseFloat(r.batch_yield_quantity) : null,
      batch_yield_unit: r.batch_yield_unit,
      portion_size_quantity: r.portion_size_quantity ? parseFloat(r.portion_size_quantity) : null,
      portion_size_unit: r.portion_size_unit,
      is_active: r.is_active,
      ingredients: ingsByRecipe.get(r.id) || []
    }));

    // 2. Test Resting State: All recipes should be UNCOSTED or COSTING_INCOMPLETE
    console.log('\n--- TEST 1: Resting DB State Costing ---');
    const initialGroupWacs = resolveAllGroupWacs(allGroups, allItems);
    const initialRecipeCosts = calculateAllRecipes(recipesWithIngs, initialGroupWacs);

    let costedCount = 0;
    let uncostedCount = 0;
    let incompleteCount = 0;

    for (const [rId, cost] of initialRecipeCosts.entries()) {
      if (cost.status === 'COSTED_ELIGIBLE') costedCount++;
      else if (cost.status === 'UNCOSTED') uncostedCount++;
      else if (cost.status === 'COSTING_INCOMPLETE') incompleteCount++;
    }

    console.log(`Initial status counts across ${initialRecipeCosts.size} recipes:`);
    console.log(`  COSTED_ELIGIBLE: ${costedCount} (Expected: 0)`);
    console.log(`  UNCOSTED: ${uncostedCount} (Expected: >= 54)`);
    console.log(`  COSTING_INCOMPLETE: ${incompleteCount} (Expected: >= 5)`);

    if (costedCount !== 0) {
      throw new Error(`Expected 0 COSTED_ELIGIBLE recipes in resting state, found ${costedCount}`);
    }
    if (uncostedCount < 54) {
      throw new Error(`Expected at least 54 UNCOSTED recipes in resting state, found ${uncostedCount}`);
    }
    if (incompleteCount < 5) {
      throw new Error(`Expected at least 5 COSTING_INCOMPLETE recipes in resting state, found ${incompleteCount}`);
    }

    // Verify Moongdal Halwa evaluates to COSTING_INCOMPLETE due to null batch yield
    const halwaRec = recipesWithIngs.find(r => r.name === 'Moongdal Halwa');
    if (!halwaRec) throw new Error('Moongdal Halwa recipe not found');
    const halwaCost = initialRecipeCosts.get(halwaRec.id);
    console.log(`Active recipe "Moongdal Halwa": status = ${halwaCost?.status}, reasons = ${halwaCost?.reasons.join('; ')}`);
    if (halwaCost?.status !== 'COSTING_INCOMPLETE') {
      throw new Error(`Moongdal Halwa expected COSTING_INCOMPLETE due to null batch yield, got ${halwaCost?.status}`);
    }
    if (!halwaCost?.reasons.some(r => r.includes('batch yield') || r.includes('Missing or zero finished batch yield'))) {
      throw new Error(`Moongdal Halwa expected missing batch yield reason, got: ${halwaCost?.reasons.join('; ')}`);
    }

    // Verify the archived empty shell recipes are COSTING_INCOMPLETE
    const emptyShellNames = ['Pizza Base YM', 'Spring Roll Sauce YM', 'Spring Roll Vegetables YM', 'Veg Sandwich'];
    for (const name of emptyShellNames) {
      const rec = recipesWithIngs.find(r => r.name === name);
      if (!rec) throw new Error(`Empty shell recipe not found: ${name}`);
      const cost = initialRecipeCosts.get(rec.id);
      console.log(`Empty shell "${name}": status = ${cost?.status}, reasons = ${cost?.reasons.join('; ')}`);
      if (cost?.status !== 'COSTING_INCOMPLETE') {
        throw new Error(`Empty shell "${name}" expected COSTING_INCOMPLETE, got ${cost?.status}`);
      }
    }

    // Verify Rajasthani Chopped Masala YM is active with 7 ingredients and is UNCOSTED (resting baseline)
    const rcMasala = recipesWithIngs.find(r => r.name === 'Rajasthani Chopped Masala YM');
    if (!rcMasala) throw new Error('Rajasthani Chopped Masala YM not found');
    const rcmCost = initialRecipeCosts.get(rcMasala.id);
    console.log(`Active recipe "Rajasthani Chopped Masala YM": status = ${rcmCost?.status}, ingredients = ${rcMasala.ingredients.length}`);
    if (rcmCost?.status !== 'UNCOSTED') {
      throw new Error(`Rajasthani Chopped Masala YM expected UNCOSTED, got ${rcmCost?.status}`);
    }
    console.log('✓ Test 1 Passed: Resting state verified; empty shells COSTING_INCOMPLETE, Rajasthani Chopped Masala UNCOSTED.');

    // 3. Test 2: 3-Tier WAC Resolution (Red Chilli Powder) with Real Postgres Transactions
    console.log('\n--- TEST 2: 3-Tier Logical-Group WAC Resolution with Real Postgres Transactions ---');
    rcpGroup = allGroups.find(g => g.group_code === 'GRP-SPM-022');
    if (!rcpGroup) throw new Error('GRP-SPM-022 not found');

    const rcpItems = allItems.filter(i => i.group_id === rcpGroup.id);
    looseItem = rcpItems.find(i => i.item_code === 'SPM-042');
    mdhItem = rcpItems.find(i => i.item_code === 'SPM-RCP-MDH');
    const goldieeItem = rcpItems.find(i => i.item_code === 'SPM-022');

    if (!looseItem || !mdhItem || !goldieeItem) {
      throw new Error('SPM-042 (Loose), SPM-RCP-MDH (MDH), or SPM-022 (Goldiee) not found in Red Chilli Powder group');
    }

    const storeLocRes = await client.query("SELECT id FROM public.inventory_locations WHERE code = 'STORE' OR name ILIKE '%central store%' LIMIT 1;");
    const storeLocId = storeLocRes.rows[0].id;
    const testVendorId = '22222222-0000-4000-8000-000000000001';
    await client.query(`
      INSERT INTO public.vendors (id, vendor_code, name)
      VALUES ($1, 'TEST-DAG-VEND', 'Test DAG Costing Vendor')
      ON CONFLICT (id) DO NOTHING;
    `, [testVendorId]);
    const vendorId = testVendorId;

    const poLooseId = '22222222-0001-4000-8000-000000000001';
    const poMdhId = '22222222-0002-4000-8000-000000000002';

    // Receive 3.6 kg of Loose @ ₹350/kg and 2.8 kg of MDH @ ₹600/kg through real purchase workflow
    console.log('\n  [Setup] Inward 3.6 kg Loose @ ₹350/kg and 2.8 kg MDH @ ₹600/kg via real purchase transaction workflow');
    await client.query(`
      INSERT INTO public.purchase_headers (id, purchase_number, vendor_id, purchase_date, business_date, net_amount, total_amount, status)
      VALUES ($1, 'TEST-PO-DAG-LOOSE', $2, CURRENT_DATE, CURRENT_DATE, 1260.00, 1260.00, 'approved')
      ON CONFLICT (id) DO UPDATE SET status = 'approved';
    `, [poLooseId, vendorId]);
    await client.query(`
      INSERT INTO public.purchase_lines (purchase_id, item_id, quantity, rate, total_amount)
      VALUES ($1, $2, 3.6, 350.00, 1260.00)
      ON CONFLICT DO NOTHING;
    `, [poLooseId, looseItem.id]);
    await client.query(`
      SELECT public.execute_inventory_transaction(
        p_item_id => $1,
        p_business_date => CURRENT_DATE,
        p_movement_type => 'purchase',
        p_quantity => 3.6,
        p_unit_cost => 350.00,
        p_destination_location_id => $2,
        p_reference_id => $3,
        p_reference_type => 'purchase_header'
      );
    `, [looseItem.id, storeLocId, poLooseId]);

    await client.query(`
      INSERT INTO public.purchase_headers (id, purchase_number, vendor_id, purchase_date, business_date, net_amount, total_amount, status)
      VALUES ($1, 'TEST-PO-DAG-MDH', $2, CURRENT_DATE, CURRENT_DATE, 1680.00, 1680.00, 'approved')
      ON CONFLICT (id) DO UPDATE SET status = 'approved';
    `, [poMdhId, vendorId]);
    await client.query(`
      INSERT INTO public.purchase_lines (purchase_id, item_id, quantity, rate, total_amount)
      VALUES ($1, $2, 2.8, 600.00, 1680.00)
      ON CONFLICT DO NOTHING;
    `, [poMdhId, mdhItem.id]);
    await client.query(`
      SELECT public.execute_inventory_transaction(
        p_item_id => $1,
        p_business_date => CURRENT_DATE,
        p_movement_type => 'purchase',
        p_quantity => 2.8,
        p_unit_cost => 600.00,
        p_destination_location_id => $2,
        p_reference_id => $3,
        p_reference_type => 'purchase_header'
      );
    `, [mdhItem.id, storeLocId, poMdhId]);

    const scnAGroupRes1 = await client.query('SELECT last_valid_wac FROM public.logical_ingredient_groups WHERE id = $1', [rcpGroup.id]);
    const scnAWac1 = parseFloat(scnAGroupRes1.rows[0].last_valid_wac);
    console.log(`  Real Purchase Workflow Group WAC: ${scnAWac1} (Expected: 459.375000)`);
    if (Math.abs(scnAWac1 - 459.375) > 0.0001) {
      throw new Error(`Real purchase receipt failed: expected last_valid_wac 459.375, got ${scnAWac1}`);
    }

    // --- Scenario A: Single Atomic Multi-Item Depletion ---
    console.log('\n  [Scenario A] Single Atomic Multi-Item Depletion Transaction');
    // Test Order 1: (Loose first, MDH second)
    await client.query('BEGIN');
    await client.query('UPDATE public.inventory_items SET current_stock = 0 WHERE id = $1', [looseItem.id]);
    await client.query('UPDATE public.inventory_items SET current_stock = 0 WHERE id = $1', [mdhItem.id]);
    await client.query('COMMIT');

    const scnAGroupResOrder1 = await client.query('SELECT last_valid_wac FROM public.logical_ingredient_groups WHERE id = $1', [rcpGroup.id]);
    const scnAWacOrder1 = parseFloat(scnAGroupResOrder1.rows[0].last_valid_wac);
    console.log(`  Scenario A (Loose first, MDH second) Zero-Stock Preserved WAC: ${scnAWacOrder1} (Expected: 459.375000)`);
    if (Math.abs(scnAWacOrder1 - 459.375) > 0.0001) {
      throw new Error(`Scenario A Order 1 failed: expected preserved last_valid_wac 459.375, got ${scnAWacOrder1}`);
    }
    const wacsOrder1 = await fetchAndResolveGroupWacs(supabase);
    const rcpResOrder1 = wacsOrder1.get(rcpGroup.id);
    if (!rcpResOrder1 || Math.abs((rcpResOrder1.wac || 0) - 459.375) > 0.0001 || rcpResOrder1.tier !== 2) {
      throw new Error(`fetchAndResolveGroupWacs Order 1 failed: expected Tier 2 459.375, got tier ${rcpResOrder1?.tier}, wac ${rcpResOrder1?.wac}`);
    }

    // Restore stock for Order 2: Loose = 3.6, MDH = 2.8
    await client.query('UPDATE public.inventory_items SET current_stock = 3.6 WHERE id = $1', [looseItem.id]);
    await client.query('UPDATE public.inventory_items SET current_stock = 2.8 WHERE id = $1', [mdhItem.id]);

    // Test Order 2: (MDH first, Loose second)
    await client.query('BEGIN');
    await client.query('UPDATE public.inventory_items SET current_stock = 0 WHERE id = $1', [mdhItem.id]);
    await client.query('UPDATE public.inventory_items SET current_stock = 0 WHERE id = $1', [looseItem.id]);
    await client.query('COMMIT');

    const scnAGroupResOrder2 = await client.query('SELECT last_valid_wac FROM public.logical_ingredient_groups WHERE id = $1', [rcpGroup.id]);
    const scnAWacOrder2 = parseFloat(scnAGroupResOrder2.rows[0].last_valid_wac);
    console.log(`  Scenario A (MDH first, Loose second) Zero-Stock Preserved WAC: ${scnAWacOrder2} (Expected: 459.375000)`);
    if (Math.abs(scnAWacOrder2 - 459.375) > 0.0001) {
      throw new Error(`Scenario A Order 2 failed: expected preserved last_valid_wac 459.375, got ${scnAWacOrder2}`);
    }
    const wacsOrder2 = await fetchAndResolveGroupWacs(supabase);
    const rcpResOrder2 = wacsOrder2.get(rcpGroup.id);
    if (!rcpResOrder2 || Math.abs((rcpResOrder2.wac || 0) - 459.375) > 0.0001 || rcpResOrder2.tier !== 2) {
      throw new Error(`fetchAndResolveGroupWacs Order 2 failed: expected Tier 2 459.375, got tier ${rcpResOrder2?.tier}, wac ${rcpResOrder2?.wac}`);
    }
    console.log('  ✓ Scenario A Passed: Deferred trigger preserves 459.375000 across both depletion orders and resolves Tier 2 from database snapshot.');

    // --- Scenario B: Sequential Separate Committed Transactions ---
    console.log('\n  [Scenario B] Sequential Separate Committed Transactions');
    // Reset stock: Loose = 3.6kg @ 350, MDH = 2.8kg @ 600
    await client.query('UPDATE public.inventory_items SET current_stock = 3.6 WHERE id = $1', [looseItem.id]);
    await client.query('UPDATE public.inventory_items SET current_stock = 2.8 WHERE id = $1', [mdhItem.id]);

    // Tx 1: Deplete Loose to 0
    await client.query('BEGIN');
    await client.query('UPDATE public.inventory_items SET current_stock = 0 WHERE id = $1', [looseItem.id]);
    await client.query('COMMIT');

    const scnBGroupRes1 = await client.query('SELECT last_valid_wac FROM public.logical_ingredient_groups WHERE id = $1', [rcpGroup.id]);
    const scnBWac1 = parseFloat(scnBGroupRes1.rows[0].last_valid_wac);
    console.log(`  Scenario B Tx1 Group WAC (Loose depleted, MDH remains): ${scnBWac1} (Expected: 600.000000)`);
    if (Math.abs(scnBWac1 - 600) > 0.0001) {
      throw new Error(`Scenario B Tx1 failed: expected 600.000000, got ${scnBWac1}`);
    }
    const wacsScnBTx1 = await fetchAndResolveGroupWacs(supabase);
    const rcpResScnBTx1 = wacsScnBTx1.get(rcpGroup.id);
    if (!rcpResScnBTx1 || Math.abs((rcpResScnBTx1.wac || 0) - 600) > 0.0001 || rcpResScnBTx1.tier !== 1) {
      throw new Error(`fetchAndResolveGroupWacs Scenario B Tx1 failed: expected Tier 1 600, got tier ${rcpResScnBTx1?.tier}, wac ${rcpResScnBTx1?.wac}`);
    }

    // Tx 2: Deplete MDH to 0
    await client.query('BEGIN');
    await client.query('UPDATE public.inventory_items SET current_stock = 0 WHERE id = $1', [mdhItem.id]);
    await client.query('COMMIT');

    const scnBGroupRes2 = await client.query('SELECT last_valid_wac FROM public.logical_ingredient_groups WHERE id = $1', [rcpGroup.id]);
    const scnBWac2 = parseFloat(scnBGroupRes2.rows[0].last_valid_wac);
    console.log(`  Scenario B Tx2 Group WAC (MDH depleted, 0 stock): ${scnBWac2} (Expected: 600.000000)`);
    if (Math.abs(scnBWac2 - 600) > 0.0001) {
      throw new Error(`Scenario B Tx2 failed: expected preserved 600.000000, got ${scnBWac2}`);
    }
    const wacsScnBTx2 = await fetchAndResolveGroupWacs(supabase);
    const rcpResScnBTx2 = wacsScnBTx2.get(rcpGroup.id);
    if (!rcpResScnBTx2 || Math.abs((rcpResScnBTx2.wac || 0) - 600) > 0.0001 || rcpResScnBTx2.tier !== 2) {
      throw new Error(`fetchAndResolveGroupWacs Scenario B Tx2 failed: expected Tier 2 600, got tier ${rcpResScnBTx2?.tier}, wac ${rcpResScnBTx2?.wac}`);
    }
    console.log('  ✓ Scenario B Passed: Sequential depletion updates to MDH rate 600 and preserves it at 0 stock.');

    // --- Scenario C: Real Invoice Cancellation ---
    console.log('\n  [Scenario C] Real Invoice Cancellation (All Cost Sources Cancelled)');
    // Reverse test consumption issues to restore location and item stock matching receipts
    await client.query('UPDATE public.item_location_stocks SET quantity = 3.6, updated_at = now() WHERE item_id = $1 AND location_id = $2', [looseItem.id, storeLocId]);
    await client.query('UPDATE public.item_location_stocks SET quantity = 2.8, updated_at = now() WHERE item_id = $1 AND location_id = $2', [mdhItem.id, storeLocId]);
    await client.query('UPDATE public.inventory_items SET current_stock = 3.6, updated_at = now() WHERE id = $1', [looseItem.id]);
    await client.query('UPDATE public.inventory_items SET current_stock = 2.8, updated_at = now() WHERE id = $1', [mdhItem.id]);

    // Cancel both purchase invoices through the real cancel_purchase_invoice workflow
    await client.query('SELECT public.cancel_purchase_invoice($1, $2);', [poLooseId, 'DAG Test Cancellation Loose']);
    await client.query('SELECT public.cancel_purchase_invoice($1, $2);', [poMdhId, 'DAG Test Cancellation MDH']);

    const scnCGroupRes = await client.query('SELECT last_valid_wac FROM public.logical_ingredient_groups WHERE id = $1', [rcpGroup.id]);
    const scnCWac = scnCGroupRes.rows[0].last_valid_wac;
    console.log(`  Scenario C Group WAC after real invoice cancellation: ${scnCWac} (Expected: null)`);
    if (scnCWac !== null) {
      throw new Error(`Scenario C failed: expected last_valid_wac to be null, got ${scnCWac}`);
    }

    const wacsScnC = await fetchAndResolveGroupWacs(supabase);
    const rcpResScnC = wacsScnC.get(rcpGroup.id);
    if (!rcpResScnC || rcpResScnC.wac !== null || rcpResScnC.tier !== 3 || rcpResScnC.isCosted !== false) {
      throw new Error(`fetchAndResolveGroupWacs Scenario C failed: expected Tier 3 UNCOSTED (null), got tier ${rcpResScnC?.tier}, wac ${rcpResScnC?.wac}`);
    }
    console.log('  ✓ Scenario C Passed: Real invoice cancellation strictly clears last_valid_wac to NULL and fetchAndResolveGroupWacs returns Tier 3 UNCOSTED.');

    // 4. Test 3: Multi-Tier DAG Costing for Gulab Jamun
    console.log('\n--- TEST 3: Multi-Tier Topological DAG Costing for Gulab Jamun ---');
    const gjRecipe = recipesWithIngs.find(r => r.name === 'Gulab Jamun');
    const chasniRecipe = recipesWithIngs.find(r => r.name === 'Chasni');
    const gheeRecipe = recipesWithIngs.find(r => r.name === 'Ghee YM');
    const gjPrepRecipe = recipesWithIngs.find(r => r.name === 'Gulab Jamun Prep');

    if (!gjRecipe || !chasniRecipe || !gheeRecipe || !gjPrepRecipe) {
      throw new Error('Gulab Jamun DAG recipes missing');
    }

    const groupRates = {
      'Refined Sugar': 0.045,        // ₹45/kg = ₹0.045/g
      'Vanaspati Ghee': 0.140,      // ₹140/kg = ₹0.14/g
      'Desi Ghee': 0.500,           // ₹500/kg = ₹0.50/g
      'Khoya': 0.300,               // ₹300/kg = ₹0.30/g
      'Paneer': 0.320,              // ₹320/kg = ₹0.32/g
      'Maida': 0.040,                // ₹40/kg = ₹0.04/g
      'Jaiphal / Nutmeg': 1.500,   // ₹1500/kg = ₹1.50/g (1 chutki = 0.36g = ₹0.54)
      'Refined Oil': 0.120,         // ₹120/kg = ₹0.12/g
      'Basmati Rice': 0.080,        // ₹80/kg = ₹0.08/g
      'Carrot': 0.040,              // ₹40/kg = ₹0.04/g
      'English Cucumber': 0.040,    // ₹40/kg = ₹0.04/g
      'Lemon Garnish': 0.060,       // ₹60/kg = ₹0.06/g
    };

    // Construct mock items with stock/WAC for these groups and fallback for all other raw materials
    const mockItemsDAG = allItems.map(item => {
      const grp = allGroups.find(g => g.id === item.group_id);
      if (grp && groupRates[grp.name] !== undefined) {
        return {
          ...item,
          current_stock: 10000,
          current_weighted_average_cost: groupRates[grp.name],
          is_costed: true
        };
      }
      return {
        ...item,
        current_stock: 10000,
        current_weighted_average_cost: 0.05,
        is_costed: true
      };
    });

    const dagWacs = resolveAllGroupWacs(allGroups, mockItemsDAG);
    const dagCosts = calculateAllRecipes(recipesWithIngs, dagWacs);

    const gheeCost = dagCosts.get(gheeRecipe.id);
    const chasniCost = dagCosts.get(chasniRecipe.id);
    const gjPrepCost = dagCosts.get(gjPrepRecipe.id);
    const gjCost = dagCosts.get(gjRecipe.id);

    console.log(`Ghee YM: status = ${gheeCost?.status}, batchCost = ₹${gheeCost?.totalBatchCost?.toFixed(2)}, costPerUnit = ₹${gheeCost?.costPerOutputUnit?.toFixed(2)}/${gheeCost?.recipe.batch_yield_unit}`);
    console.log(`Chasni: status = ${chasniCost?.status}, batchCost = ₹${chasniCost?.totalBatchCost?.toFixed(2)}, costPerUnit = ₹${chasniCost?.costPerOutputUnit?.toFixed(2)}/${chasniCost?.recipe.batch_yield_unit}`);
    console.log(`Gulab Jamun Prep: status = ${gjPrepCost?.status}, batchCost = ₹${gjPrepCost?.totalBatchCost?.toFixed(2)}, costPerUnit = ₹${gjPrepCost?.costPerOutputUnit?.toFixed(2)}/${gjPrepCost?.recipe.batch_yield_unit}`);
    console.log(`Gulab Jamun: status = ${gjCost?.status}, batchCost = ₹${gjCost?.totalBatchCost?.toFixed(2)}, costPerServing = ₹${gjCost?.costPerServing?.toFixed(2)}/${gjRecipe.portion_size_unit}`);

    if (gheeCost?.status !== 'COSTED_ELIGIBLE') throw new Error(`Ghee YM expected COSTED_ELIGIBLE, got ${gheeCost?.status}: ${gheeCost?.reasons.join('; ')}`);
    if (chasniCost?.status !== 'COSTED_ELIGIBLE') throw new Error(`Chasni expected COSTED_ELIGIBLE, got ${chasniCost?.status}: ${chasniCost?.reasons.join('; ')}`);
    if (gjPrepCost?.status !== 'COSTED_ELIGIBLE') throw new Error(`Gulab Jamun Prep expected COSTED_ELIGIBLE, got ${gjPrepCost?.status}: ${gjPrepCost?.reasons.join('; ')}`);
    if (gjCost?.status !== 'COSTED_ELIGIBLE') throw new Error(`Gulab Jamun expected COSTED_ELIGIBLE, got ${gjCost?.status}: ${gjCost?.reasons.join('; ')}`);

    // Explicit output_unit and serving_unit assertions
    if (!gheeCost?.output_unit || gheeCost.output_unit !== 'kg') throw new Error(`Ghee YM expected output_unit 'kg', got ${gheeCost?.output_unit}`);
    if (!chasniCost?.output_unit || chasniCost.output_unit !== 'kg') throw new Error(`Chasni expected output_unit 'kg', got ${chasniCost?.output_unit}`);
    if (!gjPrepCost?.output_unit || gjPrepCost.output_unit !== 'kg') throw new Error(`Gulab Jamun Prep expected output_unit 'kg', got ${gjPrepCost?.output_unit}`);
    if (!gjCost?.serving_unit || gjCost.serving_unit !== 'pcs') throw new Error(`Gulab Jamun expected serving_unit 'pcs', got ${gjCost?.serving_unit}`);

    // Verify expected mathematical values:
    // Chasni batch: 4kg sugar @ 45 = 180. Yield = 9kg -> cost/kg = 20
    if (Math.abs(chasniCost.costPerOutputUnit - 20) > 0.01) {
      throw new Error(`Chasni cost/kg expected 20, got ${chasniCost.costPerOutputUnit}`);
    }
    // Ghee YM batch: 0.5kg vanaspati @ 140 (=70) + 2kg desi @ 500 (=1000) = 1070. Yield = 2.5kg -> cost/kg = 428
    if (Math.abs(gheeCost.costPerOutputUnit - 428) > 0.01) {
      throw new Error(`Ghee YM cost/kg expected 428, got ${gheeCost.costPerOutputUnit}`);
    }
    // Gulab Jamun single pcs (25g Chasni + 25g GJ Prep): approx ₹10.25
    if (Math.abs(gjCost.costPerServing - 10.25) > 0.2) {
      throw new Error(`Gulab Jamun cost per pcs expected ~10.25, got ${gjCost.costPerServing}`);
    }
    console.log('✓ Test 3 Passed: Multi-tier DAG resolved in topological order with exact transitive cost propagation.');

    // 5. Test 4: 1:N Variant Costing, White Pasta Variant Linking & Combo Costing
    console.log('\n--- TEST 4: 1:N Variant Costing, Single POS Menu Linking & Combo Costing ---');
    
    // 4a. Gulab Jamun Variant Cost
    const gjVariantRes = await client.query(`
      SELECT v.*, p.price as selling_price, p.name as pos_name
      FROM public.yatra_menu_item_variants v
      JOIN public.pos_menu_items p ON v.menu_item_id = p.id
      WHERE v.recipe_id = $1
    `, [gjRecipe.id]);

    const gjVariant = gjVariantRes.rows[0];
    const varCost = calculateVariantCost(
      {
        id: gjVariant.id,
        menu_item_id: gjVariant.menu_item_id,
        recipe_id: gjVariant.recipe_id,
        variant_name: gjVariant.variant_name,
        is_default: gjVariant.is_default,
        serving_quantity: gjVariant.serving_quantity ? parseFloat(gjVariant.serving_quantity) : null,
        serving_unit: gjVariant.serving_unit,
        gas_cost: parseFloat(gjVariant.gas_cost || 0),
        other_operating_cost: parseFloat(gjVariant.other_operating_cost || 0),
        packaging_cost_dine_in: parseFloat(gjVariant.packaging_cost_dine_in || 0),
        packaging_cost_takeaway: parseFloat(gjVariant.packaging_cost_takeaway || 0),
        default_service_channel: gjVariant.default_service_channel,
        is_active: gjVariant.is_active,
        menu_item: { id: gjVariant.menu_item_id, name: gjVariant.pos_name, price: parseFloat(gjVariant.selling_price) }
      },
      gjCost,
      'DINE_IN'
    );

    console.log('Gulab Jamun Variant Cost Result:', {
      foodCost: varCost.food_cost,
      totalCost: varCost.total_cost,
      foodCostPercent: varCost.food_cost_pct,
      margin: varCost.margin_amount,
      status: varCost.costing_status
    });

    if (varCost.costing_status !== 'COSTED_ELIGIBLE' || varCost.food_cost === null) {
      throw new Error(`Variant cost calculation failed: status = ${varCost.costing_status}, food_cost = ${varCost.food_cost}`);
    }

    // 4b. Combo portion recipes costing verification
    const dalPortionRec = recipesWithIngs.find(r => r.name === 'Dal Makhani (Combo Portion)');
    const ricePortionRec = recipesWithIngs.find(r => r.name === 'Cooked Rice (Combo Portion)');
    const saladPortionRec = recipesWithIngs.find(r => r.name === 'Salad (Combo Portion)');
    if (!dalPortionRec || !ricePortionRec || !saladPortionRec) {
      throw new Error('Combo portion recipes missing');
    }
    const dalPortionCost = dagCosts.get(dalPortionRec.id);
    const ricePortionCost = dagCosts.get(ricePortionRec.id);
    const saladPortionCost = dagCosts.get(saladPortionRec.id);

    console.log(`Dal Makhani (Combo Portion): status = ${dalPortionCost?.status}, batchCost = ₹${dalPortionCost?.totalBatchCost?.toFixed(2)}`);
    console.log(`Cooked Rice (Combo Portion): status = ${ricePortionCost?.status}, batchCost = ₹${ricePortionCost?.totalBatchCost?.toFixed(2)}`);
    console.log(`Salad (Combo Portion): status = ${saladPortionCost?.status}, batchCost = ₹${saladPortionCost?.totalBatchCost?.toFixed(2)}`);

    if (dalPortionCost?.status !== 'COSTED_ELIGIBLE') throw new Error(`Dal Makhani portion expected COSTED_ELIGIBLE, got ${dalPortionCost?.status}`);
    if (ricePortionCost?.status !== 'COSTED_ELIGIBLE') throw new Error(`Cooked Rice portion expected COSTED_ELIGIBLE, got ${ricePortionCost?.status}`);
    if (saladPortionCost?.status !== 'COSTED_ELIGIBLE') throw new Error(`Salad portion expected COSTED_ELIGIBLE, got ${saladPortionCost?.status}`);
    console.log('✓ 4b Passed: All 3 combo portion recipes successfully costed and verified as COSTED_ELIGIBLE.');

    // 4c. Verify White Sauce Pasta Kaushinder & Sumit recipes and variants under single pos_menu_items record
    const pastaItemRes = await client.query(`
      SELECT id, name FROM public.pos_menu_items WHERE name = 'White Pasta'
    `);
    if (pastaItemRes.rows.length !== 1) {
      throw new Error(`Expected exactly 1 'White Pasta' pos_menu_items record, found ${pastaItemRes.rows.length}`);
    }
    const whitePastaId = pastaItemRes.rows[0].id;

    const pastaVariantsRes = await client.query(`
      SELECT v.*, r.id as recipe_id, r.name as recipe_name
      FROM public.yatra_menu_item_variants v
      JOIN public.yatra_recipes r ON v.recipe_id = r.id
      WHERE v.menu_item_id = $1
      ORDER BY v.variant_name
    `, [whitePastaId]);

    console.log(`White Pasta variants found: ${pastaVariantsRes.rows.length}`);
    if (pastaVariantsRes.rows.length !== 2) {
      throw new Error(`Expected exactly 2 variants under White Pasta, found ${pastaVariantsRes.rows.length}`);
    }
    const varNames = pastaVariantsRes.rows.map(v => v.variant_name).sort();
    if (JSON.stringify(varNames) !== JSON.stringify(['Kaushinder', 'Sumit'])) {
      throw new Error(`Expected variants ['Kaushinder', 'Sumit'], got ${JSON.stringify(varNames)}`);
    }
    const defaultVariants = pastaVariantsRes.rows.filter(v => v.is_default);
    if (defaultVariants.length !== 1 || defaultVariants[0].variant_name !== 'Sumit') {
      throw new Error(`Expected exactly 1 default variant ('Sumit'), got ${defaultVariants.map(v => v.variant_name).join(', ')}`);
    }

    // Verify both White Pasta recipes are COSTED_ELIGIBLE
    const kaushinderRec = recipesWithIngs.find(r => r.name === 'White Sauce Pasta Kaushinder');
    const sumitRec = recipesWithIngs.find(r => r.name === 'White Sauce Pasta Sumit');
    const kaushinderCost = dagCosts.get(kaushinderRec.id);
    const sumitCost = dagCosts.get(sumitRec.id);

    console.log(`White Sauce Pasta Kaushinder recipe: status = ${kaushinderCost?.status}, costPerServing = ₹${kaushinderCost?.costPerServing?.toFixed(2)}`);
    console.log(`White Sauce Pasta Sumit recipe: status = ${sumitCost?.status}, costPerServing = ₹${sumitCost?.costPerServing?.toFixed(2)}`);

    if (kaushinderCost?.status !== 'COSTED_ELIGIBLE') throw new Error(`Kaushinder recipe expected COSTED_ELIGIBLE, got ${kaushinderCost?.status}`);
    if (sumitCost?.status !== 'COSTED_ELIGIBLE') throw new Error(`Sumit recipe expected COSTED_ELIGIBLE, got ${sumitCost?.status}`);

    for (const v of pastaVariantsRes.rows) {
      const vRec = recipesWithIngs.find(r => r.id === v.recipe_id);
      const vCost = dagCosts.get(vRec.id);
      const variantCostResult = calculateVariantCost(
        {
          id: v.id,
          menu_item_id: whitePastaId,
          recipe_id: v.recipe_id,
          variant_name: v.variant_name,
          is_default: v.is_default,
          serving_quantity: v.serving_quantity ? parseFloat(v.serving_quantity) : null,
          serving_unit: v.serving_unit,
          gas_cost: parseFloat(v.gas_cost || 0),
          other_operating_cost: parseFloat(v.other_operating_cost || 0),
          packaging_cost_dine_in: parseFloat(v.packaging_cost_dine_in || 0),
          packaging_cost_takeaway: parseFloat(v.packaging_cost_takeaway || 0),
          default_service_channel: v.default_service_channel || 'DINE_IN',
          is_active: v.is_active,
          menu_item: { id: whitePastaId, name: 'White Pasta', price: 220 }
        },
        vCost,
        'DINE_IN'
      );
      console.log(`White Pasta Variant '${v.variant_name}': status = ${variantCostResult.costing_status}, food_cost = ₹${variantCostResult.food_cost?.toFixed(2)}, margin = ₹${variantCostResult.margin_amount?.toFixed(2)}`);
      if (variantCostResult.costing_status !== 'COSTED_ELIGIBLE' || variantCostResult.food_cost === null) {
        throw new Error(`Variant ${v.variant_name} expected COSTED_ELIGIBLE, got ${variantCostResult.costing_status}`);
      }
    }
    console.log('✓ 4c Passed: White Sauce Pasta Kaushinder and Sumit link cleanly to single pos_menu_items record and both compute COSTED_ELIGIBLE.');

    // 4d. Verify Combo / Thali Costing Structure & Calculation
    const combosRes = await client.query('SELECT * FROM public.yatra_combos_thalis');
    const comboCompsRes = await client.query('SELECT * FROM public.yatra_combo_components ORDER BY combo_thali_id, sort_order');

    console.log(`Verifying ${combosRes.rows.length} Combos/Thalis and ${comboCompsRes.rows.length} Components...`);
    if (combosRes.rows.length !== 3) {
      throw new Error(`Expected 3 combos/thalis, found ${combosRes.rows.length}`);
    }
    if (comboCompsRes.rows.length !== 9) {
      throw new Error(`Expected 9 combo components, found ${comboCompsRes.rows.length}`);
    }

    for (const combo of combosRes.rows) {
      const comps = comboCompsRes.rows.filter(c => c.combo_thali_id === combo.id).map(c => ({
        id: c.id,
        combo_thali_id: c.combo_thali_id,
        component_name: c.component_name,
        recipe_id: c.recipe_id,
        variant_id: c.variant_id,
        portion_quantity: parseFloat(c.portion_quantity),
        portion_unit: c.portion_unit,
        sort_order: c.sort_order
      }));

      const comboCost = calculateComboThaliCost(
        {
          id: combo.id,
          name: combo.name,
          product_type: combo.product_type,
          menu_item_id: combo.menu_item_id,
          selling_price: parseFloat(combo.selling_price),
          gas_cost: parseFloat(combo.gas_cost || 0),
          other_operating_cost: parseFloat(combo.other_operating_cost || 0),
          packaging_cost_dine_in: parseFloat(combo.packaging_cost_dine_in || 0),
          packaging_cost_takeaway: parseFloat(combo.packaging_cost_takeaway || 0),
          default_service_channel: combo.default_service_channel,
          is_active: combo.is_active,
          components: comps
        },
        dagCosts,
        'TAKEAWAY'
      );

      console.log(`Combo "${combo.name}": status = ${comboCost.status}, components = ${comps.length}, gas = ₹${comboCost.operating_cost?.toFixed(2)}, packaging = ₹${comboCost.packaging_cost?.toFixed(2)}`);
      
      if (comboCost.status !== 'COSTED_ELIGIBLE') {
        throw new Error(`Combo "${combo.name}" expected COSTED_ELIGIBLE, got ${comboCost.status}: ${comboCost.reasons?.join(', ')}`);
      }

      // Verify operating cost formula: gas + other_operating
      const expectedOpCost = parseFloat(combo.gas_cost || 0) + parseFloat(combo.other_operating_cost || 0);
      if (Math.abs(comboCost.operating_cost - expectedOpCost) > 0.001) {
        throw new Error(`Combo operating cost mismatch: expected ${expectedOpCost}, got ${comboCost.operating_cost}`);
      }
      // Verify packaging cost for TAKEAWAY channel
      const expectedPkg = parseFloat(combo.packaging_cost_takeaway || 0);
      if (Math.abs(comboCost.packaging_cost - expectedPkg) > 0.001) {
        throw new Error(`Combo takeaway packaging mismatch: expected ${expectedPkg}, got ${comboCost.packaging_cost}`);
      }

      // Assert total_food_cost equals exact sum of component costs and is strictly separate from operating/packaging
      const sumComponentCosts = comboCost.components.reduce((sum, c) => sum + (c.food_cost || 0), 0);
      if (Math.abs((comboCost.total_food_cost || 0) - sumComponentCosts) > 0.001) {
        throw new Error(`Combo "${combo.name}" total_food_cost mismatch: expected ${sumComponentCosts}, got ${comboCost.total_food_cost}`);
      }
      if (comboCost.total_food_cost === comboCost.total_cost) {
        throw new Error(`Combo "${combo.name}" food cost not kept strictly separate from gas and packaging costs`);
      }
    }
    console.log('✓ 4d Passed: 1:N Variant and Combo costing validated with component and operating cost assertions.');

    // 6. Test 5: Reversal & Incomplete Propagation
    console.log('\n--- TEST 5: Reversal / Invoice Cancellation Propagation ---');
    // Remove Refined Sugar from costed items (simulate cancellation of sugar invoice)
    const itemsWithoutSugar = mockItemsDAG.map(item => {
      const grp = allGroups.find(g => g.id === item.group_id);
      if (grp?.name === 'Refined Sugar') {
        return { ...item, current_stock: 0, current_weighted_average_cost: 0, is_costed: false };
      }
      return item;
    });

    const wacsNoSugar = resolveAllGroupWacs(allGroups, itemsWithoutSugar);
    const costsNoSugar = calculateAllRecipes(recipesWithIngs, wacsNoSugar);

    const chasniRev = costsNoSugar.get(chasniRecipe.id);
    const gjRev = costsNoSugar.get(gjRecipe.id);

    console.log(`Chasni after sugar cancellation: status = ${chasniRev?.status}, error = ${chasniRev?.reasons.join('; ')}`);
    console.log(`Gulab Jamun after sugar cancellation: status = ${gjRev?.status}, error = ${gjRev?.reasons.join('; ')}`);

    if (chasniRev?.status !== 'UNCOSTED') {
      throw new Error(`Chasni expected UNCOSTED, got ${chasniRev?.status}`);
    }
    if (gjRev?.status !== 'UNCOSTED') {
      throw new Error(`Gulab Jamun expected UNCOSTED due to Chasni, got ${gjRev?.status}`);
    }
    console.log('✓ Test 5 Passed: Upstream invoice cancellation correctly cascades UNCOSTED status down the entire DAG.');

  } finally {
    // 7. Strict Cleanup & Baseline Reset
    console.log('\n--- STRICT TEARDOWN & BASELINE RESTORATION ---');
    await client.query(`
      DELETE FROM public.stock_movements WHERE reference_id IN ('22222222-0001-4000-8000-000000000001', '22222222-0002-4000-8000-000000000002') OR notes LIKE '%DAG Test%';
      DELETE FROM public.purchase_lines WHERE purchase_id IN ('22222222-0001-4000-8000-000000000001', '22222222-0002-4000-8000-000000000002');
      DELETE FROM public.purchase_headers WHERE id IN ('22222222-0001-4000-8000-000000000001', '22222222-0002-4000-8000-000000000002');
      DELETE FROM public.vendors WHERE id = '22222222-0000-4000-8000-000000000001';
    `);

    if (looseItem && mdhItem) {
      await client.query(`
        UPDATE public.inventory_items 
        SET current_stock = 0, current_weighted_average_cost = 0, is_costed = false
        WHERE id IN ($1, $2);
      `, [looseItem.id, mdhItem.id]);

      await client.query(`
        UPDATE public.item_location_stocks 
        SET quantity = 0
        WHERE item_id IN ($1, $2);
      `, [looseItem.id, mdhItem.id]);
    }

    if (rcpGroup) {
      await client.query(`
        UPDATE public.logical_ingredient_groups
        SET last_valid_wac = NULL
        WHERE id = $1;
      `, [rcpGroup.id]);
    }

    const finalAudit = await client.query(`
      SELECT COUNT(*) as count 
      FROM public.inventory_items 
      WHERE current_weighted_average_cost != 0 OR is_costed = true
    `);
    console.log(`[Teardown Audit] Items with non-zero WAC/is_costed: ${finalAudit.rows[0].count} (must be 0)`);
    if (parseInt(finalAudit.rows[0].count) !== 0) {
      console.error('FATAL: Database not reset to 0 WAC baseline!');
      process.exit(1);
    }
    console.log('✓ Teardown verified: Test items cleaned up, 0 WAC baseline preserved without affecting physical stock balances.');
    await client.end();
  }

  console.log('\n=== ALL DAG COSTING & MIGRATION TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
