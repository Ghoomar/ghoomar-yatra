import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { hasPermission, getRequiredPermissionForPath } from '../src/lib/rbac';

const require = createRequire(import.meta.url);

let pg: any;
try {
  pg = require('pg');
} catch {
  const scratchPg = 'C:/Users/nirak/.gemini/antigravity/brain/9cfec205-e3f7-4240-b3e1-1205064ae2d9/scratch/node_modules/pg';
  pg = require(scratchPg);
}

const { Client } = pg;
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const dbUrlLine = envContent.split('\n').find((l: string) => l.startsWith('DATABASE_URL='));
if (!dbUrlLine) throw new Error('DATABASE_URL not found in .env.local');
const dbUrl = dbUrlLine.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

const client = new Client({ connectionString: dbUrl });

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failCount++;
  }
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('🧪 TARGETED REGRESSION TEST: INVENTORY & ASSETS CONSOLIDATION');
  console.log('===============================================================\n');

  await client.connect();

  // -------------------------------------------------------------
  // SUITE 1: PHYSICAL ASSET & CHAIR METRICS (DECISION 1)
  // -------------------------------------------------------------
  console.log('📌 1. Physical Asset & Chair Metrics (AST-002)');

  const chairRes = await client.query(`
    SELECT id, item_code, name, inventory_class, current_stock, current_weighted_average_cost
    FROM inventory_items
    WHERE item_code = 'AST-002'
  `);
  const chair = chairRes.rows[0];
  assert(chair && Number(chair.current_stock) === 111, 'AST-002 Chair current_stock is exactly 111 pcs', `got ${chair?.current_stock}`);
  assert(chair && chair.inventory_class === 'Physical Asset', 'AST-002 inventory_class is Physical Asset');

  const locRes = await client.query(`
    SELECT ils.quantity, il.code, il.name
    FROM item_location_stocks ils
    JOIN inventory_locations il ON il.id = ils.location_id
    WHERE ils.item_id = $1
    ORDER BY il.code
  `, [chair.id]);

  const locSum = locRes.rows.reduce((sum: number, r: any) => sum + Number(r.quantity), 0);
  assert(locSum === 111, 'Location stocks for AST-002 sum exactly to 111 pcs across all rooms', `got ${locSum}`);

  const statusLedgerRes = await client.query(`
    SELECT event_type, sum(quantity) as qty
    FROM physical_asset_status_ledger
    WHERE item_id = $1
    GROUP BY event_type
  `, [chair.id]);

  const lossEvents = statusLedgerRes.rows.find((r: any) => r.event_type === 'loss');
  const breakageEvents = statusLedgerRes.rows.find((r: any) => r.event_type === 'breakage');
  const repairEvents = statusLedgerRes.rows.find((r: any) => r.event_type === 'repair');

  const lostQty = Number(lossEvents?.qty || 0);
  const netBroken = Math.max(0, Number(breakageEvents?.qty || 0) - Number(repairEvents?.qty || 0));

  assert(lostQty === 5, 'Status ledger records exactly 5 lost chairs', `got ${lostQty}`);
  assert(netBroken === 0, 'Status ledger net broken chairs is 0 (4 broken, 4 repaired)', `got ${netBroken}`);

  // In Physical Assets view: In Service must be 111, Lost must be 5.
  // "Total Owned = In Service + Lost" (116) must NOT be calculated.
  const physicalAssetsViewSrc = fs.readFileSync('src/components/inventory/PhysicalAssetsView.tsx', 'utf8');
  assert(
    !physicalAssetsViewSrc.includes('inService + netBroken + lostTotal'),
    'PhysicalAssetsView does NOT add lostTotal back into active/owned totals'
  );
  assert(
    physicalAssetsViewSrc.includes('in_service_qty: inService'),
    'PhysicalAssetsView sets in_service_qty directly from authoritative location stock'
  );
  assert(
    physicalAssetsViewSrc.includes('lost_qty: lostTotal'),
    'PhysicalAssetsView tracks lost_qty as a separate metric'
  );

  const modalSrc = fs.readFileSync('src/components/inventory/AssetDetailModal.tsx', 'utf8');
  assert(
    !modalSrc.includes('totalInService + brokenQty + lostQty'),
    'AssetDetailModal does NOT add lostQty back into totalOwned'
  );

  // -------------------------------------------------------------
  // SUITE 2: INVENTORY VALUATION KPI ISOLATION (DECISION 2)
  // -------------------------------------------------------------
  console.log('\n📌 2. Inventory Valuation KPI Isolation');

  const classValRes = await client.query(`
    SELECT inventory_class,
           sum(current_stock * current_weighted_average_cost) as class_value
    FROM inventory_items
    GROUP BY inventory_class
    ORDER BY inventory_class
  `);

  const foodVal = Number(classValRes.rows.find((r: any) => r.inventory_class === 'Food Raw Material')?.class_value || 0);
  const nonFoodVal = Number(classValRes.rows.find((r: any) => r.inventory_class === 'Non-Food Consumable')?.class_value || 0);
  const assetVal = Number(classValRes.rows.find((r: any) => r.inventory_class === 'Physical Asset')?.class_value || 0);
  const uniformVal = Number(classValRes.rows.find((r: any) => r.inventory_class === 'Uniform')?.class_value || 0);

  const consumableExpected = Math.round((foodVal + nonFoodVal) * 100) / 100;
  assert(consumableExpected === 1005612.78, 'Authoritative consumable stock value is exactly ₹1,005,612.78', `got ${consumableExpected}`);
  assert(Math.round(assetVal * 100) / 100 === 325599.91, 'Physical Asset value is ₹3,25,599.91', `got ${assetVal}`);
  assert(Math.round(uniformVal * 100) / 100 === 18900.00, 'Uniform stock value is ₹18,900.00', `got ${uniformVal}`);

  const invPageSrc = fs.readFileSync('src/app/inventory/page.tsx', 'utf8');
  assert(
    invPageSrc.includes("i.inventory_class === 'Food Raw Material' || i.inventory_class === 'Non-Food Consumable'"),
    'Inventory page explicitly isolates consumableItems to Food Raw Material and Non-Food Consumable'
  );
  assert(
    invPageSrc.includes('consumableStockValue = useMemo') && invPageSrc.includes('consumableItems.reduce'),
    'Primary Stock Value KPI in Inventory page is computed strictly over consumableItems'
  );
  assert(
    invPageSrc.includes('physicalAssetsValue') && invPageSrc.includes('uniformsStockValue'),
    'Secondary read-only indicators exist for Physical Asset and Uniform values'
  );
  assert(
    invPageSrc.includes("['ALL', 'Food Raw Material', 'Non-Food Consumable'].map"),
    'Consumable category class pills exclude Physical Asset and Uniform'
  );

  // -------------------------------------------------------------
  // SUITE 3: REMOVAL OF DEAD APPLICATION REFERENCES (DECISION 3)
  // -------------------------------------------------------------
  console.log('\n📌 3. Removal of Dead Application References');

  const uniformsPageSrc = fs.readFileSync('src/app/uniforms/page.tsx', 'utf8');
  assert(!uniformsPageSrc.includes('uniform_items'), 'uniform_items reference removed from src/app/uniforms/page.tsx');
  assert(!uniformsPageSrc.includes('legacy_uniform'), 'legacy_uniform removed from src/app/uniforms/page.tsx');

  const drawerSrc = fs.readFileSync('src/components/people/StaffLedgerDrawer.tsx', 'utf8');
  assert(!drawerSrc.includes('uniform_items'), 'uniform_items reference removed from src/components/people/StaffLedgerDrawer.tsx');
  assert(!drawerSrc.includes('legacy_uniform'), 'legacy_uniform removed from src/components/people/StaffLedgerDrawer.tsx');

  // Verify prototype tables remain intact in DB (NOT dropped in Phase 2)
  const legacyTablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name IN ('physical_assets', 'asset_movements', 'uniform_items')
  `);
  assert(legacyTablesRes.rows.length === 3, 'Legacy prototype tables remain safely preserved in DB (physical_assets, asset_movements, uniform_items)', `found ${legacyTablesRes.rows.length}`);

  // -------------------------------------------------------------
  // SUITE 4: PHYSICAL COUNT SCOPE DEFAULT (DECISION 4)
  // -------------------------------------------------------------
  console.log('\n📌 4. Physical Count Scope Default');

  const countSrc = fs.readFileSync('src/app/inventory/count/page.tsx', 'utf8');
  assert(
    countSrc.includes("useState<string>('CONSUMABLES')"),
    'Stock Count page defaults selectedClass to CONSUMABLES'
  );
  assert(
    countSrc.includes("if (selectedClass === 'CONSUMABLES')"),
    'Stock Count page filters to Food Raw Material and Non-Food Consumable by default'
  );
  assert(
    countSrc.includes('option value="CONSUMABLES"'),
    'Stock Count page provides CONSUMABLES option in class dropdown'
  );

  // -------------------------------------------------------------
  // SUITE 5: RBAC PERMISSION ISOLATION & ROUTE AUTHORIZATION
  // -------------------------------------------------------------
  console.log('\n📌 5. RBAC Permission Isolation & Route Authorization');

  // A. Strict Granular Permission Isolation (Zero Cross-Bleed)
  assert(
    hasPermission('Viewer', ['inventory.stock'], 'inventory.stock') === true,
    'User with inventory.stock is granted access to inventory.stock'
  );
  assert(
    hasPermission('Viewer', ['inventory.stock'], 'inventory.assets') === false,
    'Strict Isolation: user with ONLY inventory.stock CANNOT access inventory.assets'
  );
  assert(
    hasPermission('Viewer', ['inventory.assets'], 'inventory.assets') === true,
    'User with inventory.assets is granted access to inventory.assets'
  );
  assert(
    hasPermission('Viewer', ['inventory.assets'], 'inventory.stock') === false,
    'Strict Isolation: user with ONLY inventory.assets CANNOT access inventory.stock'
  );
  assert(
    hasPermission('Viewer', [], 'inventory.stock') === false,
    'Unauthorized user without inventory.stock is denied stock access'
  );
  assert(
    hasPermission('Viewer', [], 'inventory.assets') === false,
    'Unauthorized user without inventory.assets is denied assets access'
  );
  assert(
    hasPermission('Admin', [], 'inventory.stock') === true,
    'Admin role retains universal access to inventory.stock'
  );
  assert(
    hasPermission('Admin', [], 'inventory.assets') === true,
    'Admin role retains universal access to inventory.assets'
  );

  // B. Route-Level Required Permissions
  const invRoutePerm = getRequiredPermissionForPath('/inventory');
  assert(
    Array.isArray(invRoutePerm) && invRoutePerm.includes('inventory.stock') && invRoutePerm.includes('inventory.assets'),
    'AppShell route gate for /inventory permits users with either inventory.stock or inventory.assets'
  );
  const legacyAssetRoutePerm = getRequiredPermissionForPath('/inventory/assets');
  assert(
    legacyAssetRoutePerm === 'inventory.assets',
    'Legacy route /inventory/assets requires inventory.assets'
  );

  // C. Sidebar Navigation & Dynamic Route Targeting
  const sidebarSrc = fs.readFileSync('src/components/navigation/Sidebar.tsx', 'utf8');
  assert(
    sidebarSrc.includes("labelKey: 'navigation.items.inventoryAndAssets'"),
    'Sidebar includes single consolidated Inventory & Assets entry'
  );
  assert(
    !sidebarSrc.includes("href: '/inventory/assets'"),
    'Old separate /inventory/assets entry removed from Sidebar'
  );
  assert(
    sidebarSrc.includes("permission: ['inventory.stock', 'inventory.assets']"),
    'Sidebar nav entry checks both permissions to show entry if user has either'
  );
  assert(
    sidebarSrc.includes("targetHref = (item.href === '/inventory' && !hasPermission('inventory.stock') && hasPermission('inventory.assets'))"),
    'Sidebar dynamically routes assets-only users directly to ?tab=assets'
  );

  // D. Legacy Redirect Preservation
  const redirectSrc = fs.readFileSync('src/app/inventory/assets/page.tsx', 'utf8');
  assert(
    redirectSrc.includes("redirect('/inventory?tab=assets')"),
    '/inventory/assets cleanly redirects to /inventory?tab=assets'
  );

  // E. Tab-Level Authorization Guard in /inventory
  assert(
    invPageSrc.includes("const canAccessStock = hasPermission('inventory.stock')"),
    '/inventory evaluates canAccessStock explicitly'
  );
  assert(
    invPageSrc.includes("const canAccessAssets = hasPermission('inventory.assets')"),
    '/inventory evaluates canAccessAssets explicitly'
  );
  assert(
    invPageSrc.includes('isTabAuthorized =') && invPageSrc.includes('!isTabAuthorized'),
    '/inventory blocks unauthorized tab access with AccessRestrictedNotice'
  );
  assert(
    invPageSrc.includes('canAccessStock && canAccessAssets &&'),
    '/inventory only shows tab switcher buttons when user possesses BOTH permissions'
  );

  // -------------------------------------------------------------
  // SUITE 6: BILINGUAL I18N PARITY
  // -------------------------------------------------------------
  console.log('\n📌 6. Bilingual i18n Translations Parity');

  const enNav = JSON.parse(fs.readFileSync('src/locales/en/navigation.json', 'utf8'));
  const hiNav = JSON.parse(fs.readFileSync('src/locales/hi/navigation.json', 'utf8'));
  assert(Boolean(enNav.items?.inventoryAndAssets), 'en navigation.items.inventoryAndAssets exists');
  assert(Boolean(hiNav.items?.inventoryAndAssets), 'hi navigation.items.inventoryAndAssets exists');

  const enInv = JSON.parse(fs.readFileSync('src/locales/en/inventory.json', 'utf8'));
  const hiInv = JSON.parse(fs.readFileSync('src/locales/hi/inventory.json', 'utf8'));
  assert(Boolean(enInv.stock?.topTabs?.stock), 'en inventory.stock.topTabs.stock exists');
  assert(Boolean(hiInv.stock?.topTabs?.stock), 'hi inventory.stock.topTabs.stock exists');
  assert(Boolean(enInv.stock?.topTabs?.assets), 'en inventory.stock.topTabs.assets exists');
  assert(Boolean(hiInv.stock?.topTabs?.assets), 'hi inventory.stock.topTabs.assets exists');
  assert(Boolean(enInv.count?.consumablesOnly), 'en inventory.count.consumablesOnly exists');
  assert(Boolean(hiInv.count?.consumablesOnly), 'hi inventory.count.consumablesOnly exists');

  await client.end();

  console.log('\n===============================================================');
  console.log(`📊 RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('===============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
