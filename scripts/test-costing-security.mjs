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

import pg from 'pg';
import { NextRequest } from 'next/server.js';

const { GET: getRecipes, POST: postRecipe } = await import('../src/app/api/sops/recipes/route.ts');
const { GET: getRecipeDetail, PUT: putRecipeDetail } = await import('../src/app/api/sops/recipes/[id]/route.ts');
const { GET: getMenu } = await import('../src/app/api/sops/menu/route.ts');
const { GET: getMenuDetail, PUT: putMenuDetail } = await import('../src/app/api/sops/menu/[id]/route.ts');
const { calculateMenuEngineeringMatrix } = await import('../src/lib/sops/costing/matrix.ts');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function runCostingSecuritySuite() {
  await client.connect();
  console.log('🔒 Starting SOPs & Costing Security & Permissions Test Suite...\n');

  // Baseline check: discover standalone raw_materials count dynamically
  const rmPreRes = await client.query('SELECT COUNT(*) as cnt FROM public.raw_materials');
  const initialRmCount = Number(rmPreRes.rows[0].cnt);
  console.log(`[Read-Only Baseline] Standalone raw_materials: ${initialRmCount} rows`);

  // Set ENABLE_TEST_AUTH_OVERRIDE for testing
  process.env.ENABLE_TEST_AUTH_OVERRIDE = 'true';

  // Helper: Idempotent purge of temporary test roles
  async function purgeTestRole(roleName, fallbackSystemRoleName = 'Storekeeper') {
    try {
      const fallbackRes = await client.query('SELECT id FROM roles WHERE name = $1 AND is_system = true', [fallbackSystemRoleName]);
      const fallbackRoleId = fallbackRes.rows[0]?.id;

      const existingRoles = await client.query('SELECT id FROM roles WHERE name = $1', [roleName]);
      if (existingRoles.rows.length > 0) {
        const roleIds = existingRoles.rows.map(r => r.id);
        if (fallbackRoleId) {
          await client.query('UPDATE profiles SET role_id = $1 WHERE role_id = ANY($2)', [fallbackRoleId, roleIds]);
        }
        await client.query('DELETE FROM role_permissions WHERE role_id = ANY($1)', [roleIds]);
        await client.query('DELETE FROM roles WHERE id = ANY($1)', [roleIds]);
      }
    } catch (err) {
      console.warn(`[WARN] Failed to purge test role '${roleName}':`, err.message);
    }
  }

  const TEST_ROLE_NAME = 'Test Kitchen Staff';
  let testRoleId = null;
  const testUserId = '16e29066-9477-4232-a5c9-e4dedbc988d9'; // Ravi Kumar
  let originalRoleId = null;

  // 1. Pre-test idempotency cleanup
  await purgeTestRole(TEST_ROLE_NAME, 'Storekeeper');

  // 2. Resolve verified authentic Storekeeper system role
  const storekeeperRes = await client.query("SELECT id FROM roles WHERE name = 'Storekeeper' AND is_system = true");
  const authenticStorekeeperRoleId = storekeeperRes.rows[0]?.id;

  try {
    // Save original role ID
    const origRes = await client.query('SELECT role_id FROM profiles WHERE id = $1', [testUserId]);
    originalRoleId = origRes.rows[0]?.role_id || authenticStorekeeperRoleId;

    // -------------------------------------------------------------
    // Setup: Create a temporary test role without costing access
    // Has sops.recipes.view and sops.menu.view, but NOT sops.costing.view
    // -------------------------------------------------------------
    const roleRes = await client.query(`
      INSERT INTO roles (name, description)
      VALUES ($1, 'Temporary role for automated security testing')
      RETURNING id
    `, [TEST_ROLE_NAME]);
    testRoleId = roleRes.rows[0].id;

    // Grant sops.recipes.view and sops.menu.view permissions
    const permRes = await client.query(`
      SELECT id, code FROM permissions WHERE code IN ('sops.recipes.view', 'sops.menu.view')
    `);
    for (const p of permRes.rows) {
      await client.query(`
        INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
      `, [testRoleId, p.id]);
    }

    // Assign temporary role to test user
    await client.query('UPDATE profiles SET role_id = $1 WHERE id = $2', [testRoleId, testUserId]);

    console.log(`✅ Assigned temporary restricted role ${testRoleId} to test user ${testUserId}`);

    // -------------------------------------------------------------
    // TEST 0: Header Security Guard (Unset override or Production)
    // -------------------------------------------------------------
    console.log('\n--- TEST 0: Auth Override Security Guard (Header Ignored when Unset / Production) ---');
    {
      // 0a. When ENABLE_TEST_AUTH_OVERRIDE is unset
      delete process.env.ENABLE_TEST_AUTH_OVERRIDE;
      const guardedReq1 = new NextRequest('http://localhost:3000/api/sops/recipes', {
        headers: { 'x-test-user-id': testUserId },
      });
      const guardedRes1 = await getRecipes(guardedReq1);
      if (guardedRes1.status !== 401) {
        throw new Error(`Expected 401 when ENABLE_TEST_AUTH_OVERRIDE is unset, got ${guardedRes1.status}`);
      }
      console.log('  ✅ x-test-user-id ignored when ENABLE_TEST_AUTH_OVERRIDE is unset (401 Unauthorized)');

      // 0b. When ENABLE_TEST_AUTH_OVERRIDE is 'false'
      process.env.ENABLE_TEST_AUTH_OVERRIDE = 'false';
      const guardedReq2 = new NextRequest('http://localhost:3000/api/sops/menu', {
        headers: { 'x-test-user-id': testUserId },
      });
      const guardedRes2 = await getMenu(guardedReq2);
      if (guardedRes2.status !== 401) {
        throw new Error(`Expected 401 when ENABLE_TEST_AUTH_OVERRIDE is false, got ${guardedRes2.status}`);
      }
      console.log('  ✅ x-test-user-id ignored when ENABLE_TEST_AUTH_OVERRIDE is false (401 Unauthorized)');

      // 0c. When NODE_ENV === 'production'
      const origNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_TEST_AUTH_OVERRIDE = 'true';
      const guardedReq3 = new NextRequest('http://localhost:3000/api/sops/recipes', {
        headers: { 'x-test-user-id': testUserId },
      });
      const guardedRes3 = await getRecipes(guardedReq3);
      process.env.NODE_ENV = origNodeEnv; // restore immediately
      if (guardedRes3.status !== 401) {
        throw new Error(`Expected 401 in production mode, got ${guardedRes3.status}`);
      }
      console.log('  ✅ x-test-user-id ignored when NODE_ENV is production (401 Unauthorized)');

      // Restore override for subsequent tests
      process.env.ENABLE_TEST_AUTH_OVERRIDE = 'true';
    }

    // -------------------------------------------------------------
    // TEST 1: Unauthenticated Requests (No Auth / Invalid)
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Unauthenticated Request Protection ---');
    {
      const req1 = new NextRequest('http://localhost:3000/api/sops/recipes');
      const res1 = await getRecipes(req1);
      if (res1.status !== 401) throw new Error(`Expected 401 for unauthenticated recipes, got ${res1.status}`);

      const req2 = new NextRequest('http://localhost:3000/api/sops/menu');
      const res2 = await getMenu(req2);
      if (res2.status !== 401) throw new Error(`Expected 401 for unauthenticated menu, got ${res2.status}`);

      console.log('  ✅ Unauthenticated requests properly rejected with 401 Unauthorized');
    }

    // -------------------------------------------------------------
    // TEST 2: Unauthorized User (Gate Staff - No SOP permissions)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Unauthorized User (Gate Staff) ---');
    {
      // Jayveer (Gate Staff) ID
      const gateStaffId = '7c5b8722-49ec-4f4c-8573-618969c073f3';

      const req1 = new NextRequest('http://localhost:3000/api/sops/recipes', {
        headers: { 'x-test-user-id': gateStaffId },
      });
      const res1 = await getRecipes(req1);
      if (res1.status !== 403) throw new Error(`Expected 403 for Gate Staff on /api/sops/recipes, got ${res1.status}`);

      const req2 = new NextRequest('http://localhost:3000/api/sops/menu', {
        headers: { 'x-test-user-id': gateStaffId },
      });
      const res2 = await getMenu(req2);
      if (res2.status !== 403) throw new Error(`Expected 403 for Gate Staff on /api/sops/menu, got ${res2.status}`);

      console.log('  ✅ Gate Staff requests properly blocked with 403 Forbidden');
    }

    // -------------------------------------------------------------
    // TEST 3: Kitchen Staff - Cost Data Masking
    // Has recipe & menu view, but NO costing view
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Restricted Costing Masking for Kitchen Staff ---');
    {
      // 3a. /api/sops/recipes
      const req = new NextRequest('http://localhost:3000/api/sops/recipes', {
        headers: { 'x-test-user-id': testUserId },
      });
      const res = await getRecipes(req);
      if (res.status !== 200) throw new Error(`Expected 200 for Kitchen Staff on recipes, got ${res.status}`);

      const data = await res.json();
      if (data.hasCostAccess !== false) throw new Error(`Expected hasCostAccess: false, got ${data.hasCostAccess}`);
      if (!Array.isArray(data.recipes) || data.recipes.length === 0) throw new Error('Expected recipes array');

      for (const r of data.recipes) {
        if (r.total_batch_cost !== null) throw new Error(`Recipe ${r.name} exposed total_batch_cost: ${r.total_batch_cost}`);
        if (r.cost_per_output_unit !== null) throw new Error(`Recipe ${r.name} exposed cost_per_output_unit`);
        if (r.cost_per_serving !== null) throw new Error(`Recipe ${r.name} exposed cost_per_serving`);
        for (const line of r.ingredient_line_costs || []) {
          if (line.lineCost !== null) throw new Error(`Recipe ${r.name} ingredient exposed lineCost: ${line.lineCost}`);
          if (line.unitRate !== null) throw new Error(`Recipe ${r.name} ingredient exposed unitRate: ${line.unitRate}`);
        }
      }

      console.log(`  ✅ Recipes list (${data.recipes.length} recipes): All batch costs, unit rates, and line costs strictly masked to null`);

      // 3b. /api/sops/menu
      const menuReq = new NextRequest('http://localhost:3000/api/sops/menu', {
        headers: { 'x-test-user-id': testUserId },
      });
      const menuRes = await getMenu(menuReq);
      if (menuRes.status !== 200) throw new Error(`Expected 200 on menu, got ${menuRes.status}`);

      const menuData = await menuRes.json();
      if (menuData.hasCostAccess !== false) throw new Error(`Expected hasCostAccess: false on menu`);
      if (menuData.matrix.salesWeightedContributionThreshold !== null && menuData.matrix.salesWeightedContributionThreshold !== 0) {
        throw new Error(`Matrix salesWeightedContributionThreshold exposed: ${menuData.matrix.salesWeightedContributionThreshold}`);
      }

      for (const m of menuData.matrix.items) {
        if (m.foodCost !== null) throw new Error(`Matrix item ${m.name} exposed foodCost: ${m.foodCost}`);
        if (m.foodCostPct !== null) throw new Error(`Matrix item ${m.name} exposed foodCostPct: ${m.foodCostPct}`);
        if (m.unitContributionMargin !== null) throw new Error(`Matrix item ${m.name} exposed margin: ${m.unitContributionMargin}`);
      }

      for (const item of menuData.items) {
        if (item.defaultVariant && item.defaultVariant.food_cost !== null) {
          throw new Error(`Menu item ${item.name} exposed food_cost: ${item.defaultVariant.food_cost}`);
        }
        if (item.defaultVariant && item.defaultVariant.gas_cost !== null) {
          throw new Error(`Menu item ${item.name} exposed gas_cost on defaultVariant: ${item.defaultVariant.gas_cost}`);
        }
        for (const v of item.variants || []) {
          if (v.food_cost !== null) throw new Error(`Menu item ${item.name} variant ${v.variant_name} exposed food_cost: ${v.food_cost}`);
          if (v.gas_cost !== null) throw new Error(`Menu item ${item.name} variant ${v.variant_name} exposed gas_cost: ${v.gas_cost}`);
          if (v.operating_cost !== null) throw new Error(`Menu item ${item.name} variant ${v.variant_name} exposed operating_cost: ${v.operating_cost}`);
          if (v.packaging_cost !== null) throw new Error(`Menu item ${item.name} variant ${v.variant_name} exposed packaging_cost: ${v.packaging_cost}`);
          if (v.total_cost !== null) throw new Error(`Menu item ${item.name} variant ${v.variant_name} exposed total_cost: ${v.total_cost}`);
        }
      }

      if (!Array.isArray(menuData.combos) || menuData.combos.length === 0) {
        throw new Error('Expected combos array in menu response');
      }

      for (const combo of menuData.combos) {
        if (combo.food_cost !== null) throw new Error(`Combo ${combo.name} exposed food_cost: ${combo.food_cost}`);
        if (combo.total_food_cost !== null) throw new Error(`Combo ${combo.name} exposed total_food_cost: ${combo.total_food_cost}`);
        if (combo.operating_cost !== null) throw new Error(`Combo ${combo.name} exposed operating_cost: ${combo.operating_cost}`);
        if (combo.packaging_cost !== null) throw new Error(`Combo ${combo.name} exposed packaging_cost: ${combo.packaging_cost}`);
        if (combo.gas_cost !== null) throw new Error(`Combo ${combo.name} exposed gas_cost: ${combo.gas_cost}`);
        if (combo.other_operating_cost !== null) throw new Error(`Combo ${combo.name} exposed other_operating_cost: ${combo.other_operating_cost}`);
        if (combo.packaging_cost_dine_in !== null) throw new Error(`Combo ${combo.name} exposed packaging_cost_dine_in: ${combo.packaging_cost_dine_in}`);
        if (combo.packaging_cost_takeaway !== null) throw new Error(`Combo ${combo.name} exposed packaging_cost_takeaway: ${combo.packaging_cost_takeaway}`);
        if (combo.total_cost !== null) throw new Error(`Combo ${combo.name} exposed total_cost: ${combo.total_cost}`);
        if (combo.food_cost_pct !== null) throw new Error(`Combo ${combo.name} exposed food_cost_pct: ${combo.food_cost_pct}`);
        if (combo.margin_amount !== null) throw new Error(`Combo ${combo.name} exposed margin_amount: ${combo.margin_amount}`);
        if (combo.contribution_amount !== null) throw new Error(`Combo ${combo.name} exposed contribution_amount: ${combo.contribution_amount}`);
        if (combo.contribution_pct !== null) throw new Error(`Combo ${combo.name} exposed contribution_pct: ${combo.contribution_pct}`);
        for (const comp of combo.components || []) {
          if (comp.food_cost !== null) throw new Error(`Combo ${combo.name} component ${comp.component_name} exposed food_cost: ${comp.food_cost}`);
          if (comp.unit_rate !== null) throw new Error(`Combo ${combo.name} component ${comp.component_name} exposed unit_rate: ${comp.unit_rate}`);
        }
      }

      console.log(`  ✅ Menu master (${menuData.items.length} items): All food costs, food cost %, and contribution margins strictly masked to null`);
      console.log(`  ✅ Combos (${menuData.combos.length} combos): All food costs, operating costs, packaging costs, margins, and component rates strictly masked to null`);
      console.log(`  ✅ Matrix items (${menuData.matrix.items.length} items): All margins and thresholds masked`);

      // 3c. /api/sops/menu/[id] (Single-item route masking)
      const firstItemId = menuData.items[0]?.id;
      if (firstItemId) {
        const detailReq = new NextRequest(`http://localhost:3000/api/sops/menu/${firstItemId}`, {
          headers: { 'x-test-user-id': testUserId },
        });
        const detailRes = await getMenuDetail(detailReq, { params: { id: firstItemId } });
        if (detailRes.status !== 200) throw new Error(`Expected 200 on menu detail, got ${detailRes.status}`);
        const detailData = await detailRes.json();
        if (detailData.hasCostAccess !== false) throw new Error('Expected hasCostAccess: false on menu detail');
        for (const v of detailData.variants || []) {
          if (v.gas_cost !== null) throw new Error(`Menu detail variant ${v.variant_name} exposed gas_cost: ${v.gas_cost}`);
          if (v.other_operating_cost !== null) throw new Error(`Menu detail variant ${v.variant_name} exposed other_operating_cost`);
          if (v.packaging_cost_dine_in !== null) throw new Error(`Menu detail variant ${v.variant_name} exposed packaging_cost_dine_in`);
          if (v.packaging_cost_takeaway !== null) throw new Error(`Menu detail variant ${v.variant_name} exposed packaging_cost_takeaway`);
          if (v.dine_in) {
            if (v.dine_in.food_cost !== null) throw new Error(`Menu detail variant dine_in exposed food_cost`);
            if (v.dine_in.operating_cost !== null) throw new Error(`Menu detail variant dine_in exposed operating_cost`);
            if (v.dine_in.gas_cost !== null) throw new Error(`Menu detail variant dine_in exposed gas_cost`);
            if (v.dine_in.packaging_cost !== null) throw new Error(`Menu detail variant dine_in exposed packaging_cost`);
            if (v.dine_in.total_cost !== null) throw new Error(`Menu detail variant dine_in exposed total_cost`);
          }
          if (v.takeaway) {
            if (v.takeaway.food_cost !== null) throw new Error(`Menu detail variant takeaway exposed food_cost`);
            if (v.takeaway.operating_cost !== null) throw new Error(`Menu detail variant takeaway exposed operating_cost`);
            if (v.takeaway.packaging_cost !== null) throw new Error(`Menu detail variant takeaway exposed packaging_cost`);
            if (v.takeaway.total_cost !== null) throw new Error(`Menu detail variant takeaway exposed total_cost`);
          }
        }
        console.log(`  ✅ Menu item detail (${detailData.variants?.length || 0} variants): All variant cost allocations strictly masked to null`);
      }

      // 3d. Attempt POST /api/sops/recipes without manage permission -> 403
      const postReq = new NextRequest('http://localhost:3000/api/sops/recipes', {
        method: 'POST',
        headers: {
          'x-test-user-id': testUserId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Unauthorized Dish', category: 'FINAL_DISH' }),
      });
      const postRes = await postRecipe(postReq);
      if (postRes.status !== 403) throw new Error(`Expected 403 for unauthorized recipe creation, got ${postRes.status}`);

      console.log('  ✅ Recipe creation properly blocked for view-only kitchen staff with 403');
    }

    // -------------------------------------------------------------
    // TEST 4: The 4 Approved Permission Paths + Admin Full Cost Access
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: The 4 Approved Permission Paths & Admin Costing Access ---');
    {
      const costingPerms = [
        'sops.costing.view',
        'finance.profitability',
        'finance.purchases',
        'admin.manage',
      ];

      for (const permCode of costingPerms) {
        // Reset permissions for testRoleId: grant sops.recipes.view, sops.menu.view, and this permCode
        await client.query('DELETE FROM role_permissions WHERE role_id = $1', [testRoleId]);
        const pRes = await client.query(`
          SELECT id FROM permissions WHERE code IN ('sops.recipes.view', 'sops.menu.view', $1)
        `, [permCode]);
        for (const p of pRes.rows) {
          await client.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [testRoleId, p.id]);
        }

        const permReq = new NextRequest('http://localhost:3000/api/sops/recipes', {
          headers: { 'x-test-user-id': testUserId },
        });
        const permRes = await getRecipes(permReq);
        if (permRes.status !== 200) throw new Error(`Expected 200 with permission '${permCode}', got ${permRes.status}`);
        const permData = await permRes.json();
        if (permData.hasCostAccess !== true) {
          throw new Error(`Expected hasCostAccess: true when granted '${permCode}', got false`);
        }

        const menuReq = new NextRequest('http://localhost:3000/api/sops/menu', {
          headers: { 'x-test-user-id': testUserId },
        });
        const menuRes = await getMenu(menuReq);
        if (menuRes.status !== 200) throw new Error(`Expected 200 on menu with permission '${permCode}', got ${menuRes.status}`);
        const menuData = await menuRes.json();
        if (menuData.hasCostAccess !== true) {
          throw new Error(`Expected hasCostAccess: true on menu when granted '${permCode}', got false`);
        }

        console.log(`  ✅ Verified independent permission path: '${permCode}' grants full costing access`);
      }

      // Verify Admin Role access
      const adminId = '21c087eb-2517-436e-9e52-80a9455ea749';
      const adminReq = new NextRequest('http://localhost:3000/api/sops/recipes', {
        headers: { 'x-test-user-id': adminId },
      });
      const adminRes = await getRecipes(adminReq);
      if (adminRes.status !== 200) throw new Error(`Expected 200 for Admin, got ${adminRes.status}`);
      const adminData = await adminRes.json();
      if (adminData.hasCostAccess !== true) throw new Error(`Expected hasCostAccess: true for Admin`);
      console.log(`  ✅ Admin role verified: hasCostAccess = true`);

      // -------------------------------------------------------------
      // TEST 4b: Transitive Where-Used Graph for Gulab Jamun Prep & Ghee YM
      // -------------------------------------------------------------
      console.log('\n--- TEST 4b: Transitive Where-Used Graph Verification ---');

      // 1. Gulab Jamun Prep Where-Used Chain
      const gjPrep = adminData.recipes.find((r) => r.name.toLowerCase().includes('gulab jamun prep'));
      if (!gjPrep) throw new Error('Gulab Jamun Prep not found');

      const detailReq1 = new NextRequest(`http://localhost:3000/api/sops/recipes/${gjPrep.id}`, {
        headers: { 'x-test-user-id': adminId },
      });
      const detailRes1 = await getRecipeDetail(detailReq1, { params: Promise.resolve({ id: gjPrep.id }) });
      if (detailRes1.status !== 200) throw new Error(`Detail route returned ${detailRes1.status}`);

      const detailData1 = await detailRes1.json();
      const whereUsed1 = detailData1.whereUsed;
      if (!whereUsed1 || !whereUsed1.recipes || whereUsed1.recipes.length === 0) {
        throw new Error('Expected Gulab Jamun Prep to be used in at least one parent recipe');
      }

      const parentDish1 = whereUsed1.recipes.find((r) => r.name.toLowerCase().includes('gulab jamun') && !r.name.toLowerCase().includes('prep'));
      if (!parentDish1) throw new Error('Expected parent recipe to include Gulab Jamun dish');

      // Check costing_status presence on nodes
      for (const r of whereUsed1.recipes) {
        if (!r.costing_status) throw new Error(`Expected costing_status badge on recipe ${r.name}`);
      }

      console.log(`  ✅ Gulab Jamun Prep Where-Used:`);
      console.log(`     - Parent Recipe: '${parentDish1.name}' (depth: ${parentDish1.depth}, status: ${parentDish1.costing_status})`);
      console.log(`     - Linked Menu Items: ${whereUsed1.menuItems.length} items`);
      console.log(`     - Linked Combos: ${whereUsed1.combos.length} combos`);

      // 2. Ghee YM Transitive Where-Used Chain (Depth >= 2, Combos attached)
      const gheeRec = adminData.recipes.find((r) => r.name.trim().toLowerCase() === 'ghee ym');
      if (!gheeRec) throw new Error('Ghee YM recipe not found');

      const detailReq2 = new NextRequest(`http://localhost:3000/api/sops/recipes/${gheeRec.id}`, {
        headers: { 'x-test-user-id': adminId },
      });
      const detailRes2 = await getRecipeDetail(detailReq2, { params: Promise.resolve({ id: gheeRec.id }) });
      if (detailRes2.status !== 200) throw new Error(`Ghee YM detail returned ${detailRes2.status}`);

      const detailData2 = await detailRes2.json();
      const whereUsed2 = detailData2.whereUsed;
      if (!whereUsed2 || !whereUsed2.recipes || whereUsed2.recipes.length === 0) {
        throw new Error('Expected Ghee YM to have parent recipes in where-used graph');
      }

      // Verify transitive depth: Ghee YM -> Gulab Jamun Prep (depth 1) -> Gulab Jamun (depth 2)
      // and Ghee YM -> Dal Makhani 2 YM (depth 1) -> Dal Makhani (Combo Portion) (depth 2)
      const directPreps = whereUsed2.recipes.filter((r) => r.depth === 1);
      const transitiveDishes = whereUsed2.recipes.filter((r) => r.depth > 1);

      console.log(`  ✅ Ghee YM Transitive Where-Used:`);
      console.log(`     - Direct Preparations (depth 1): ${directPreps.map(p => p.name).join(', ')}`);
      console.log(`     - Transitive Parent Dishes/Portions (depth >= 2): ${transitiveDishes.map(d => `${d.name} (d=${d.depth})`).join(', ')}`);
      console.log(`     - Linked Combos: ${whereUsed2.combos.map(c => c.name).join(', ')}`);

      if (directPreps.length === 0) throw new Error('Expected Ghee YM to have depth 1 direct preparations');
      if (transitiveDishes.length === 0) throw new Error('Expected Ghee YM to have depth > 1 transitive recipes');
      if (whereUsed2.combos.length === 0) throw new Error('Expected Ghee YM to link to composite combos/thalis via Dal Makhani');

      for (const r of whereUsed2.recipes) {
        if (!r.costing_status) throw new Error(`Missing costing_status on Ghee YM where-used recipe ${r.name}`);
      }
    }

    // -------------------------------------------------------------
    // TEST 5: Standalone Recipe Book Protection Guardrail
    // raw_materials must remain untouched at initial count
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Standalone Recipe Book Protection Guardrail ---');
    {
      const rmRes = await client.query('SELECT COUNT(*) as cnt FROM public.raw_materials');
      const rmCount = Number(rmRes.rows[0].cnt);
      if (rmCount !== initialRmCount) {
        throw new Error(`CRITICAL: public.raw_materials row count modified! Expected ${initialRmCount}, found ${rmCount}`);
      }
      console.log(`  ✅ Standalone public.raw_materials intact at exactly ${rmCount} rows`);
    }

    // -------------------------------------------------------------
    // TEST 6: Factory Reset State Guardrail
    // 0 stock, 0 WAC, is_costed = false across all items
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Factory Reset State Guardrail ---');
    {
      const nonZeroItems = await client.query(`
        SELECT COUNT(*) as cnt FROM inventory_items
        WHERE current_stock != 0 OR current_weighted_average_cost != 0 OR is_costed = true
      `);
      const nonZeroStocks = await client.query(`
        SELECT COUNT(*) as cnt FROM item_location_stocks
        WHERE quantity != 0
      `);

      const cnt = Number(nonZeroItems.rows[0].cnt);
      const locCnt = Number(nonZeroStocks.rows[0].cnt);
      if (cnt !== 0 && cnt !== 172) {
        throw new Error(`Resting DB has ${cnt} non-zero inventory_items! Expected 0 (reset) or 172 (Oct 31 closing stock)`);
      }
      if (locCnt !== 0 && locCnt !== 172) {
        throw new Error(`Resting DB has ${locCnt} non-zero item_location_stocks! Expected 0 (reset) or 172 (Oct 31 closing stock)`);
      }

      console.log(`  ✅ Inventory Resting State Verified: ${cnt === 0 ? '0 stock (Clean Factory Reset)' : '172 verified closing stock items (31-Oct-2026)'}`);
    }

    // -------------------------------------------------------------
    // TEST 7: Full SQL Sales Aggregation & Alias Integrity
    // Truncation Elimination (20,560 source rows vs 1,000 limit)
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Full SQL Sales Aggregation & Alias Integrity ---');
    {
      const countRes = await client.query("SELECT COUNT(*) as cnt FROM public.sales_order_items");
      const totalRows = Number(countRes.rows[0].cnt);
      console.log(`  sales_order_items total rows: ${totalRows} (observed >= 20,278)`);
      if (totalRows < 20278) {
        throw new Error(`Expected at least 20,278 sales_order_items, found ${totalRows}`);
      }

      // Prove that RPC get_menu_sales_aggregation matches direct SQL SUM with zero 1,000-row truncation
      const directAll = await client.query(`
        SELECT 
          ROUND(COALESCE(SUM(quantity), 0)::NUMERIC, 2) as units,
          ROUND(COALESCE(SUM(net_sales), 0)::NUMERIC, 2) as net
        FROM public.sales_order_items
        WHERE status = 'Success'
      `);
      const rpcAll = await client.query(`
        SELECT 
          ROUND(COALESCE(SUM(units_sold), 0)::NUMERIC, 2) as units,
          ROUND(COALESCE(SUM(net_sales), 0)::NUMERIC, 2) as net
        FROM public.get_menu_sales_aggregation(NULL, NULL)
      `);

      console.log(`  Direct SQL (All Success): ${directAll.rows[0].units} units, ₹${directAll.rows[0].net} net`);
      console.log(`  RPC Aggregation:          ${rpcAll.rows[0].units} units, ₹${rpcAll.rows[0].net} net`);

      if (parseFloat(rpcAll.rows[0].units) !== parseFloat(directAll.rows[0].units)) {
        throw new Error(`RPC units mismatch: expected ${directAll.rows[0].units}, got ${rpcAll.rows[0].units}`);
      }
      if (parseFloat(rpcAll.rows[0].net) !== parseFloat(directAll.rows[0].net)) {
        throw new Error(`RPC net sales mismatch: expected ${directAll.rows[0].net}, got ${rpcAll.rows[0].net}`);
      }
      console.log('  ✅ Zero 1,000-row truncation verified across full dataset (100% mathematical parity with direct SQL SUM)');

      // Verify date-range filtering parity
      const dateFrom = '2026-10-01';
      const dateTo = '2026-10-15';
      const directRange = await client.query(`
        SELECT 
          ROUND(COALESCE(SUM(quantity), 0)::NUMERIC, 2) as units,
          ROUND(COALESCE(SUM(net_sales), 0)::NUMERIC, 2) as net
        FROM public.sales_order_items
        WHERE status = 'Success'
          AND business_date >= $1 AND business_date <= $2
      `, [dateFrom, dateTo]);
      const rpcRange = await client.query(`
        SELECT 
          ROUND(COALESCE(SUM(units_sold), 0)::NUMERIC, 2) as units,
          ROUND(COALESCE(SUM(net_sales), 0)::NUMERIC, 2) as net
        FROM public.get_menu_sales_aggregation($1, $2)
      `, [dateFrom, dateTo]);

      if (parseFloat(rpcRange.rows[0].units) !== parseFloat(directRange.rows[0].units)) {
        throw new Error(`Date-range RPC units mismatch: expected ${directRange.rows[0].units}, got ${rpcRange.rows[0].units}`);
      }
      if (parseFloat(rpcRange.rows[0].net) !== parseFloat(directRange.rows[0].net)) {
        throw new Error(`Date-range RPC net mismatch: expected ${directRange.rows[0].net}, got ${rpcRange.rows[0].net}`);
      }
      console.log(`  ✅ Date-filtered sales aggregation (${dateFrom} to ${dateTo}) verified with 100% parity`);
    }

    // -------------------------------------------------------------
    // TEST 8: BCG Matrix Rules & States
    // (a) Mixed costed/uncosted items with valid sales
    // (b) NO_SALES_DATA
    // (c) NO_ELIGIBLE_COSTED_SALES
    // -------------------------------------------------------------
    console.log('\n--- TEST 8: BCG Menu Engineering Matrix Rules & States ---');
    {
      const mockItems = [
        { menuItemId: '1', name: 'Star Dish', category: 'Main', sellingPrice: 200, foodCost: 50, costingStatus: 'COSTED_ELIGIBLE', unitsSold: 40, netRevenue: 8000 },
        { menuItemId: '2', name: 'Plowhorse Dish', category: 'Main', sellingPrice: 100, foodCost: 80, costingStatus: 'COSTED_ELIGIBLE', unitsSold: 40, netRevenue: 4000 },
        { menuItemId: '3', name: 'Puzzle Dish', category: 'Main', sellingPrice: 300, foodCost: 100, costingStatus: 'COSTED_ELIGIBLE', unitsSold: 10, netRevenue: 3000 },
        { menuItemId: '4', name: 'Dog Dish', category: 'Main', sellingPrice: 100, foodCost: 90, costingStatus: 'COSTED_ELIGIBLE', unitsSold: 10, netRevenue: 1000 },
        { menuItemId: '5', name: 'Uncosted Dish', category: 'Main', sellingPrice: 150, foodCost: null, costingStatus: 'UNCOSTED', unitsSold: 20, netRevenue: 3000 }
      ];

      // (a) Mixed costed/uncosted items with valid sales
      const resA = calculateMenuEngineeringMatrix(mockItems);
      // N_items = 5 -> threshold = (100 / 5) * 0.70 = 14%
      if (Math.abs(resA.popularityThresholdPct - 14) > 0.001) {
        throw new Error(`Expected popularity threshold 14%, got ${resA.popularityThresholdPct}`);
      }
      // Total sales = 120 units. Costed sales = 100 units.
      // Margins: Star = 150, Plowhorse = 20, Puzzle = 200, Dog = 10
      // Weighted threshold = (150*40 + 20*40 + 200*10 + 10*10) / 100 = 8900 / 100 = 89
      if (resA.salesWeightedContributionThreshold === null || Math.abs(resA.salesWeightedContributionThreshold - 89) > 0.001) {
        throw new Error(`Expected sales-weighted contribution threshold 89, got ${resA.salesWeightedContributionThreshold}`);
      }
      if (resA.state !== 'ACTIVE') throw new Error(`Expected state ACTIVE, got ${resA.state}`);

      const star = resA.items.find(i => i.menuItemId === '1');
      const plowhorse = resA.items.find(i => i.menuItemId === '2');
      const puzzle = resA.items.find(i => i.menuItemId === '3');
      const dog = resA.items.find(i => i.menuItemId === '4');
      const uncosted = resA.items.find(i => i.menuItemId === '5');

      if (star?.quadrant !== 'STAR') throw new Error(`Expected Star, got ${star?.quadrant}`);
      if (plowhorse?.quadrant !== 'PLOWHORSE') throw new Error(`Expected Plowhorse, got ${plowhorse?.quadrant}`);
      if (puzzle?.quadrant !== 'PUZZLE') throw new Error(`Expected Puzzle, got ${puzzle?.quadrant}`);
      if (dog?.quadrant !== 'DOG') throw new Error(`Expected Dog, got ${dog?.quadrant}`);
      if (uncosted?.quadrant !== 'UNCOSTED') throw new Error(`Expected UNCOSTED quadrant, got ${uncosted?.quadrant}`);
      console.log('  ✅ (a) Mixed costed/uncosted items with valid sales verified: accurate sales-weighted thresholds and quadrant assignments');

      // (b) NO_SALES_DATA: Zero total sales in group
      const zeroSalesItems = mockItems.map(i => ({ ...i, unitsSold: 0, netRevenue: 0 }));
      const resB = calculateMenuEngineeringMatrix(zeroSalesItems);
      if (resB.state !== 'NO_SALES_DATA') throw new Error(`Expected state NO_SALES_DATA, got ${resB.state}`);
      if (resB.salesWeightedContributionThreshold !== null) {
        throw new Error(`Expected contributionThreshold null in NO_SALES_DATA, got ${resB.salesWeightedContributionThreshold}`);
      }
      const hasBCGQuadrantsB = resB.items.some(i => ['STAR', 'PLOWHORSE', 'PUZZLE', 'DOG'].includes(i.quadrant));
      if (hasBCGQuadrantsB) throw new Error('BCG profitability quadrants assigned during NO_SALES_DATA');
      console.log('  ✅ (b) NO_SALES_DATA verified: contributionThreshold = null, 0 BCG profitability quadrants assigned');

      // (c) NO_ELIGIBLE_COSTED_SALES: Valid sales exist (>0), but 0 costed items have sales
      const noEligibleSalesItems = mockItems.map(i => ({
        ...i,
        unitsSold: i.costingStatus === 'UNCOSTED' ? 50 : 0,
        netRevenue: i.costingStatus === 'UNCOSTED' ? 7500 : 0
      }));
      const resC = calculateMenuEngineeringMatrix(noEligibleSalesItems);
      if (resC.state !== 'NO_ELIGIBLE_COSTED_SALES') throw new Error(`Expected state NO_ELIGIBLE_COSTED_SALES, got ${resC.state}`);
      if (resC.salesWeightedContributionThreshold !== null) {
        throw new Error(`Expected contributionThreshold null in NO_ELIGIBLE_COSTED_SALES, got ${resC.salesWeightedContributionThreshold}`);
      }
      if (resC.totalUnitsSold !== 50) throw new Error(`Expected totalUnitsSold 50, got ${resC.totalUnitsSold}`);
      if (Math.abs(resC.popularityThresholdPct - 14) > 0.001) throw new Error(`Expected popularityThresholdPct 14, got ${resC.popularityThresholdPct}`);
      const uncostedC = resC.items.find(i => i.menuItemId === '5');
      if (Math.abs(uncostedC?.salesMixPct - 100) > 0.001) throw new Error(`Expected salesMixPct 100%, got ${uncostedC?.salesMixPct}`);
      const hasBCGQuadrantsC = resC.items.some(i => ['STAR', 'PLOWHORSE', 'PUZZLE', 'DOG'].includes(i.quadrant));
      if (hasBCGQuadrantsC) throw new Error('BCG profitability quadrants assigned during NO_ELIGIBLE_COSTED_SALES');
      console.log('  ✅ (c) NO_ELIGIBLE_COSTED_SALES verified: popularityThreshold & salesMixPct computed, contributionThreshold = null, 0 BCG quadrants assigned');
    }

    console.log('\n🎉 ALL SECURITY & DATA BOUNDARY TESTS PASSED PERFECTLY!\n');
  } finally {
    // Revert role of test user to authentic Storekeeper
    if (testUserId && (authenticStorekeeperRoleId || originalRoleId)) {
      await client.query('UPDATE profiles SET role_id = $1 WHERE id = $2', [authenticStorekeeperRoleId || originalRoleId, testUserId]);
    }
    await purgeTestRole(TEST_ROLE_NAME, 'Storekeeper');
    await client.end();
  }
}

runCostingSecuritySuite().catch((err) => {
  console.error('\n❌ Security Suite Failed:', err);
  process.exit(1);
});
