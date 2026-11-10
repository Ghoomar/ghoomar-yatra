/**
 * Comprehensive HTTP-Level Test Harness for Milestone M1 (Inventory Locations)
 * 
 * Verifies all Next.js API route handlers:
 * - GET /api/admin/inventory/locations (Collection)
 * - POST /api/admin/inventory/locations (Creation & Auto-Hindi)
 * - GET /api/admin/inventory/locations/[id] (Resource & ?checkDependencies=true)
 * - PUT /api/admin/inventory/locations/[id] (Update & System Invariants)
 * - DELETE /api/admin/inventory/locations/[id] (Mandatory Deletion Safeguards)
 * 
 * Verifies all 3 Deletion Rules & System Invariant:
 * - Rule 1: Non-zero stock returns HTTP 400 with rule: 'HAS_STOCK' and populated items array with units.
 * - Rule 2: Historical records return HTTP 400 with rule: 'HAS_HISTORY' and history_counts.
 * - Rule 3: Pristine location returns HTTP 200 with success: true and cleans up 0-stock placeholders.
 * - Invariant: STORE returns HTTP 400 with rule: 'RESERVED_STORE'.
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';

// ---------------------------------------------------------------------------
// 1. Environment Setup
// ---------------------------------------------------------------------------
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
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
}

// Enable test auth override for direct route testing in non-production
process.env.ENABLE_TEST_AUTH_OVERRIDE = 'true';

const ADMIN_USER_ID = '21c087eb-2517-436e-9e52-80a9455ea749'; // System Administrator
const NON_ADMIN_USER_ID = '16e29066-9477-4232-a5c9-e4dedbc988d9'; // Storekeeper
const BASE_URL = 'http://localhost:3000';

// Connect to PostgreSQL for fixture management & database trigger checks
const dbClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
await dbClient.connect();

// Dynamically import Next.js route handlers
const { GET: getLocations, POST: postLocation } = await import('../src/app/api/admin/inventory/locations/route.ts');
const {
  GET: getLocationById,
  PUT: putLocationById,
  DELETE: deleteLocationById,
} = await import('../src/app/api/admin/inventory/locations/[id]/route.ts');

// ---------------------------------------------------------------------------
// Test Reporting Infrastructure
// ---------------------------------------------------------------------------
let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;
const results = [];

function assert(condition, testId, description, details = null) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✅ [PASS] [${testId}] ${description}`);
    results.push({ testId, description, status: 'PASS', details });
  } else {
    failedAssertions++;
    console.error(`  ❌ [FAIL] [${testId}] ${description}`);
    if (details) {
      console.error(`     Details:`, typeof details === 'object' ? JSON.stringify(details) : details);
    }
    results.push({ testId, description, status: 'FAIL', details });
  }
}

// Helper to construct request objects
function makeRequest(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  if (options.userId) {
    headers.set('x-test-user-id', options.userId);
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return new Request(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

function makeContext(id) {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Cleanup Helper
// ---------------------------------------------------------------------------
async function cleanupTestFixtures() {
  const testCodes = ['TEST-HTTP-SUGG', 'TEST-HTTP-EXP', 'TEST-HTTP-R1', 'TEST-HTTP-R2', 'TEST-HTTP-R3'];
  for (const code of testCodes) {
    await dbClient.query(`
      DELETE FROM stock_movements WHERE source_location_id IN (SELECT id FROM inventory_locations WHERE code = $1)
         OR destination_location_id IN (SELECT id FROM inventory_locations WHERE code = $1)
    `, [code]);
    await dbClient.query(`
      DELETE FROM consumption_issues WHERE source_location_id IN (SELECT id FROM inventory_locations WHERE code = $1)
    `, [code]);
    await dbClient.query(`
      DELETE FROM item_location_stocks WHERE location_id IN (SELECT id FROM inventory_locations WHERE code = $1)
    `, [code]);
    await dbClient.query(`
      DELETE FROM inventory_locations WHERE code = $1
    `, [code]);
  }
}

// ---------------------------------------------------------------------------
// Main Test Execution
// ---------------------------------------------------------------------------
console.log('========================================================================');
console.log('🚀 RUNNING HTTP-LEVEL TEST HARNESS FOR MILESTONE M1 (INVENTORY LOCATIONS)');
console.log('========================================================================\n');

try {
  // Pre-cleanup
  await cleanupTestFixtures();

  // Fetch inventory items to use for stock testing
  const { rows: invItems } = await dbClient.query(`
    SELECT id, item_code, name, name_hi, unit_id
    FROM inventory_items
    WHERE is_active = true
    LIMIT 2
  `);
  if (invItems.length < 1) {
    throw new Error('Database must have at least 1 active inventory item for stock tests.');
  }
  const testItem = invItems[0];

  // Fetch system STORE location
  const { rows: storeRows } = await dbClient.query(`
    SELECT id, code, name, name_hi, is_active
    FROM inventory_locations
    WHERE code = 'STORE'
  `);
  if (storeRows.length < 1) {
    throw new Error('System reserved location STORE must exist.');
  }
  const storeLocation = storeRows[0];

  // -------------------------------------------------------------------------
  // GROUP 1: Authentication & Authorization Security Checks (401 & 403)
  // -------------------------------------------------------------------------
  console.log('--- Group 1: Authentication & Authorization Security Checks ---');

  // 1.1 Unauthenticated collection GET
  const unauthGetRes = await getLocations(makeRequest('/api/admin/inventory/locations'));
  assert(unauthGetRes.status === 401, 'AUTH_GET_COLLECTION_UNAUTH_401', 'Unauthenticated collection GET returns HTTP 401');

  // 1.2 Non-admin collection GET
  const nonAdminGetRes = await getLocations(makeRequest('/api/admin/inventory/locations', { userId: NON_ADMIN_USER_ID }));
  assert(nonAdminGetRes.status === 403, 'AUTH_GET_COLLECTION_FORBIDDEN_403', 'Non-admin collection GET returns HTTP 403');

  // 1.3 Unauthenticated POST
  const unauthPostRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    body: { code: 'ANY', name: 'Any', location_type: 'kitchen_section' },
  }));
  assert(unauthPostRes.status === 401, 'AUTH_POST_UNAUTH_401', 'Unauthenticated POST returns HTTP 401');

  // 1.4 Non-admin POST
  const nonAdminPostRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: NON_ADMIN_USER_ID,
    body: { code: 'ANY', name: 'Any', location_type: 'kitchen_section' },
  }));
  assert(nonAdminPostRes.status === 403, 'AUTH_POST_FORBIDDEN_403', 'Non-admin POST returns HTTP 403');

  // 1.5 Unauthenticated PUT
  const unauthPutRes = await putLocationById(
    makeRequest(`/api/admin/inventory/locations/${storeLocation.id}`, {
      method: 'PUT',
      body: { notes: 'test' },
    }),
    makeContext(storeLocation.id)
  );
  assert(unauthPutRes.status === 401, 'AUTH_PUT_UNAUTH_401', 'Unauthenticated PUT returns HTTP 401');

  // 1.6 Non-admin PUT
  const nonAdminPutRes = await putLocationById(
    makeRequest(`/api/admin/inventory/locations/${storeLocation.id}`, {
      method: 'PUT',
      userId: NON_ADMIN_USER_ID,
      body: { notes: 'test' },
    }),
    makeContext(storeLocation.id)
  );
  assert(nonAdminPutRes.status === 403, 'AUTH_PUT_FORBIDDEN_403', 'Non-admin PUT returns HTTP 403');

  // 1.7 Unauthenticated DELETE
  const unauthDelRes = await deleteLocationById(
    makeRequest(`/api/admin/inventory/locations/${storeLocation.id}`, { method: 'DELETE' }),
    makeContext(storeLocation.id)
  );
  assert(unauthDelRes.status === 401, 'AUTH_DELETE_UNAUTH_401', 'Unauthenticated DELETE returns HTTP 401');

  // 1.8 Non-admin DELETE
  const nonAdminDelRes = await deleteLocationById(
    makeRequest(`/api/admin/inventory/locations/${storeLocation.id}`, {
      method: 'DELETE',
      userId: NON_ADMIN_USER_ID,
    }),
    makeContext(storeLocation.id)
  );
  assert(nonAdminDelRes.status === 403, 'AUTH_DELETE_FORBIDDEN_403', 'Non-admin DELETE returns HTTP 403');

  // -------------------------------------------------------------------------
  // GROUP 2: Collection API & Enriched Metadata (GET)
  // -------------------------------------------------------------------------
  console.log('\n--- Group 2: Collection API & Enriched Metadata ---');

  const adminGetRes = await getLocations(makeRequest('/api/admin/inventory/locations', { userId: ADMIN_USER_ID }));
  assert(adminGetRes.status === 200, 'COLL_GET_STATUS_200', 'Admin collection GET returns HTTP 200');
  const collectionData = await adminGetRes.json();
  assert(collectionData.success === true && Array.isArray(collectionData.locations),
    'COLL_GET_PAYLOAD_STRUCTURE', 'Returns { success: true, locations: [...] }');

  const storeItem = collectionData.locations.find(l => l.code === 'STORE');
  assert(Boolean(storeItem), 'COLL_STORE_EXISTS', 'STORE location exists in collection');
  assert(storeItem?.is_system_reserved === true, 'COLL_STORE_IS_SYSTEM_RESERVED', 'STORE is marked is_system_reserved: true');
  assert(storeItem?.can_delete === false, 'COLL_STORE_CAN_DELETE_FALSE', 'STORE is marked can_delete: false');
  assert(typeof storeItem?.stock_summary?.total_quantity === 'number',
    'COLL_STOCK_SUMMARY_EXISTS', 'Location includes stock_summary object');

  // -------------------------------------------------------------------------
  // GROUP 3: Creation Validation & Auto-Hindi Translation (POST)
  // -------------------------------------------------------------------------
  console.log('\n--- Group 3: Creation Validation & Hindi Suggestion Engine ---');

  // 3.1 Empty code
  const emptyCodeRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: ADMIN_USER_ID,
    body: { code: '', name: 'Test Room', location_type: 'kitchen_section' },
  }));
  assert(emptyCodeRes.status === 400, 'POST_VAL_EMPTY_CODE', 'Empty code rejected with HTTP 400');

  // 3.2 Empty name
  const emptyNameRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: ADMIN_USER_ID,
    body: { code: 'TEST-CODE', name: '   ', location_type: 'kitchen_section' },
  }));
  assert(emptyNameRes.status === 400, 'POST_VAL_EMPTY_NAME', 'Whitespace name rejected with HTTP 400');

  // 3.3 Invalid location type
  const invalidTypeRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: ADMIN_USER_ID,
    body: { code: 'TEST-CODE', name: 'Test', location_type: 'invalid_warehouse_zone' },
  }));
  assert(invalidTypeRes.status === 400, 'POST_VAL_INVALID_TYPE', 'Invalid location type rejected with HTTP 400');

  // 3.4 Duplicate code 'STORE'
  const dupStoreRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: ADMIN_USER_ID,
    body: { code: 'STORE', name: 'Duplicate Store', location_type: 'central_store' },
  }));
  assert(dupStoreRes.status === 409, 'POST_VAL_DUP_STORE', 'Duplicate code STORE rejected with HTTP 409 Conflict');

  // 3.5 Case-insensitive duplicate 'store'
  const dupLowerRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: ADMIN_USER_ID,
    body: { code: 'store', name: 'Duplicate Lower Store', location_type: 'central_store' },
  }));
  assert(dupLowerRes.status === 409, 'POST_VAL_DUP_STORE_LOWER', 'Duplicate lowercase code "store" rejected with HTTP 409');

  // 3.6 Creation with Auto-Suggested Hindi Name
  const suggPostRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: ADMIN_USER_ID,
    body: {
      code: 'TEST-HTTP-SUGG',
      name: 'Beverage Counter', // Should auto-suggest 'बेवरेज काउंटर'
      location_type: 'service_bar',
      is_active: true,
    },
  }));
  assert(suggPostRes.status === 201, 'POST_SUGG_HINDI_STATUS_201', 'Creation with auto-Hindi returns HTTP 201 Created');
  const suggData = await suggPostRes.json();
  assert(suggData.data?.name_hi === 'बेवरेज काउंटर', 'POST_SUGG_HINDI_ACCURATE',
    `Auto-suggested Hindi name is 'बेवरेज काउंटर' (got '${suggData.data?.name_hi}')`);

  // 3.7 Creation with Explicit Hindi Name
  const expPostRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: ADMIN_USER_ID,
    body: {
      code: 'TEST-HTTP-EXP',
      name: 'Custom Service Area',
      name_hi: 'कस्टम सर्विस एरिया',
      location_type: 'kitchen_section',
      is_active: true,
    },
  }));
  assert(expPostRes.status === 201, 'POST_EXPLICIT_HINDI_STATUS_201', 'Creation with explicit Hindi returns HTTP 201');
  const expData = await expPostRes.json();
  assert(expData.data?.name_hi === 'कस्टम सर्विस एरिया', 'POST_EXPLICIT_HINDI_SAVED', 'Explicit Hindi name preserved');

  // -------------------------------------------------------------------------
  // GROUP 4: Location Single-Resource & Dependency Inspection (GET /[id])
  // -------------------------------------------------------------------------
  console.log('\n--- Group 4: Single Resource & Dependency Inspection (?checkDependencies=true) ---');

  // 4.1 Missing location returns 404
  const missingIdRes = await getLocationById(
    makeRequest('/api/admin/inventory/locations/00000000-0000-0000-0000-000000000000', { userId: ADMIN_USER_ID }),
    makeContext('00000000-0000-0000-0000-000000000000')
  );
  assert(missingIdRes.status === 404, 'GET_ID_NOT_FOUND_404', 'Non-existent ID returns HTTP 404');

  // 4.2 Standard fetch
  const stdFetchRes = await getLocationById(
    makeRequest(`/api/admin/inventory/locations/${storeLocation.id}`, { userId: ADMIN_USER_ID }),
    makeContext(storeLocation.id)
  );
  assert(stdFetchRes.status === 200, 'GET_ID_STANDARD_200', 'Standard resource fetch returns HTTP 200');

  // 4.3 STORE dependency inspection
  const storeDepRes = await getLocationById(
    makeRequest(`/api/admin/inventory/locations/${storeLocation.id}?checkDependencies=true`, { userId: ADMIN_USER_ID }),
    makeContext(storeLocation.id)
  );
  assert(storeDepRes.status === 200, 'GET_ID_STORE_DEP_200', 'STORE dependency inspection returns HTTP 200');
  const storeDepData = await storeDepRes.json();
  assert(storeDepData.isStore === true && storeDepData.canDelete === false,
    'GET_ID_STORE_DEP_FLAGS', 'STORE marked isStore: true, canDelete: false');

  // -------------------------------------------------------------------------
  // GROUP 5: System Invariants & Location Updates (PUT /[id])
  // -------------------------------------------------------------------------
  console.log('\n--- Group 5: Location Updates & System Invariant Protections (PUT) ---');

  // 5.1 Block STORE code rename
  const storeRenameRes = await putLocationById(
    makeRequest(`/api/admin/inventory/locations/${storeLocation.id}`, {
      method: 'PUT',
      userId: ADMIN_USER_ID,
      body: { code: 'STORE_NEW' },
    }),
    makeContext(storeLocation.id)
  );
  assert(storeRenameRes.status === 400, 'PUT_STORE_RENAME_BLOCKED_400', 'Renaming STORE code returns HTTP 400');

  // 5.2 Block STORE deactivation
  const storeDeactRes = await putLocationById(
    makeRequest(`/api/admin/inventory/locations/${storeLocation.id}`, {
      method: 'PUT',
      userId: ADMIN_USER_ID,
      body: { is_active: false },
    }),
    makeContext(storeLocation.id)
  );
  assert(storeDeactRes.status === 400, 'PUT_STORE_DEACT_BLOCKED_400', 'Deactivating STORE returns HTTP 400');

  // 5.3 Allow updating notes on STORE
  const storeNotesRes = await putLocationById(
    makeRequest(`/api/admin/inventory/locations/${storeLocation.id}`, {
      method: 'PUT',
      userId: ADMIN_USER_ID,
      body: { notes: 'Primary central warehouse for Ghoomar Yatra' },
    }),
    makeContext(storeLocation.id)
  );
  assert(storeNotesRes.status === 200, 'PUT_STORE_NOTES_ALLOWED_200', 'Updating notes on STORE returns HTTP 200');

  // -------------------------------------------------------------------------
  // GROUP 6: MANDATORY DELETION SAFEGUARDS (DELETE /[id])
  // -------------------------------------------------------------------------
  console.log('\n--- Group 6: Mandatory Deletion Safeguards (Rules 1, 2, 3 & System Invariant) ---');

  // 6.1 System Invariant: STORE deletion blocked
  const storeDelRes = await deleteLocationById(
    makeRequest(`/api/admin/inventory/locations/${storeLocation.id}`, {
      method: 'DELETE',
      userId: ADMIN_USER_ID,
    }),
    makeContext(storeLocation.id)
  );
  const storeDelData = await storeDelRes.json();
  assert(storeDelRes.status === 400 && storeDelData.rule === 'RESERVED_STORE',
    'SAFEGUARD_INVARIANT_STORE_DELETE_400',
    `STORE deletion blocked with HTTP 400 and rule: 'RESERVED_STORE' (status: ${storeDelRes.status}, rule: '${storeDelData.rule}')`);

  // 6.2 Rule 1: Non-zero stock strictly blocks deletion
  console.log('\n  -> Setting up Rule 1 fixture: Location with positive stock');
  const r1CreateRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: ADMIN_USER_ID,
    body: {
      code: 'TEST-HTTP-R1',
      name: 'Rule 1 Test Stall',
      location_type: 'stall_counter',
      is_active: true,
    },
  }));
  const r1LocId = (await r1CreateRes.json()).data.id;

  // Insert non-zero stock (e.g. 15.5 units)
  await dbClient.query(`
    INSERT INTO item_location_stocks (id, item_id, location_id, quantity, updated_at)
    VALUES (gen_random_uuid(), $1, $2, 15.500, now())
  `, [testItem.id, r1LocId]);

  // Test 6.2a: Dependency check inspection
  const r1DepRes = await getLocationById(
    makeRequest(`/api/admin/inventory/locations/${r1LocId}?checkDependencies=true`, { userId: ADMIN_USER_ID }),
    makeContext(r1LocId)
  );
  assert(r1DepRes.status === 200, 'RULE1_DEP_CHECK_STATUS_200',
    `Rule 1 ?checkDependencies=true returns HTTP 200 (got ${r1DepRes.status})`);
  const r1DepData = await r1DepRes.json();
  assert(r1DepData.canDelete === false, 'RULE1_DEP_CAN_DELETE_FALSE', 'Rule 1 ?checkDependencies=true marks canDelete: false');
  assert(r1DepData.currentStock?.hasPositiveStock === true, 'RULE1_DEP_HAS_STOCK_TRUE', 'Rule 1 currentStock.hasPositiveStock is true');
  assert(Array.isArray(r1DepData.currentStock?.items) && r1DepData.currentStock.items.length === 1,
    'RULE1_DEP_ITEMS_ARRAY', 'Rule 1 currentStock.items has 1 item');
  assert(Boolean(r1DepData.currentStock?.items?.[0]?.unitSymbol),
    'RULE1_DEP_ITEM_UNIT', `Rule 1 item contains unitSymbol: '${r1DepData.currentStock?.items?.[0]?.unitSymbol}'`);

  // Test 6.2b: Route handler DELETE invocation
  const r1DelRes = await deleteLocationById(
    makeRequest(`/api/admin/inventory/locations/${r1LocId}`, {
      method: 'DELETE',
      userId: ADMIN_USER_ID,
    }),
    makeContext(r1LocId)
  );
  const r1DelData = await r1DelRes.json();
  assert(r1DelRes.status === 400, 'RULE1_HTTP_STATUS_400',
    `Rule 1 non-zero stock DELETE returns HTTP 400 (got ${r1DelRes.status})`, r1DelData);
  assert(r1DelData.rule === 'HAS_STOCK', 'RULE1_PAYLOAD_RULE_HAS_STOCK',
    `Rule 1 response payload contains rule: 'HAS_STOCK' (got '${r1DelData.rule}')`);
  assert(Array.isArray(r1DelData.items) && r1DelData.items.length === 1, 'RULE1_PAYLOAD_ITEMS_POPULATED',
    `Rule 1 response items array populated with affected items (length: ${r1DelData.items?.length})`);
  assert(r1DelData.items?.[0]?.quantity === 15.5 && Boolean(r1DelData.items?.[0]?.unit), 'RULE1_PAYLOAD_ITEM_UNIT_QTY',
    `Rule 1 item details include quantity (15.5) and unit ('${r1DelData.items?.[0]?.unit}')`);

  // Verify location is still alive in DB
  const { rows: r1DbCheck } = await dbClient.query('SELECT id FROM inventory_locations WHERE id = $1', [r1LocId]);
  assert(r1DbCheck.length === 1, 'RULE1_DB_RECORD_PRESERVED', 'Location record preserved in database');

  // 6.3 Rule 2: Zero stock but historical records exist
  console.log('\n  -> Setting up Rule 2 fixture: Location with historical transaction reference');
  const r2CreateRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: ADMIN_USER_ID,
    body: {
      code: 'TEST-HTTP-R2',
      name: 'Rule 2 Test Room',
      location_type: 'general_storage',
      is_active: true,
    },
  }));
  const r2LocId = (await r2CreateRes.json()).data.id;

  // Set stock to 0
  await dbClient.query(`
    INSERT INTO item_location_stocks (id, item_id, location_id, quantity, updated_at)
    VALUES (gen_random_uuid(), $1, $2, 0, now())
  `, [testItem.id, r2LocId]);

  // Record historical stock movement
  await dbClient.query(`
    INSERT INTO stock_movements (
      id, business_date, item_id, movement_type, quantity, unit_cost, total_value,
      source_location_id, destination_location_id, movement_date, created_at
    ) VALUES (
      gen_random_uuid(), CURRENT_DATE, $1, 'transfer', 5.0, 20.0, 100.0,
      $2, $3, CURRENT_DATE, now()
    )
  `, [testItem.id, r2LocId, storeLocation.id]);

  // Test 6.3a: Dependency check inspection
  const r2DepRes = await getLocationById(
    makeRequest(`/api/admin/inventory/locations/${r2LocId}?checkDependencies=true`, { userId: ADMIN_USER_ID }),
    makeContext(r2LocId)
  );
  assert(r2DepRes.status === 200, 'RULE2_DEP_CHECK_STATUS_200', 'Rule 2 dependency check returns HTTP 200');
  const r2DepData = await r2DepRes.json();
  assert(r2DepData.canDelete === false, 'RULE2_DEP_CAN_DELETE_FALSE', 'Rule 2 marks canDelete: false');
  assert(r2DepData.historicalReferences?.hasReferences === true, 'RULE2_DEP_HAS_HISTORY', 'Rule 2 hasReferences is true');
  assert(r2DepData.historicalReferences?.stockMovementsCount === 1, 'RULE2_DEP_MOVEMENT_COUNT', 'Rule 2 reports 1 movement');

  // Test 6.3b: Route handler DELETE invocation
  const r2DelRes = await deleteLocationById(
    makeRequest(`/api/admin/inventory/locations/${r2LocId}`, {
      method: 'DELETE',
      userId: ADMIN_USER_ID,
    }),
    makeContext(r2LocId)
  );
  const r2DelData = await r2DelRes.json();
  assert(r2DelRes.status === 400, 'RULE2_HTTP_STATUS_400',
    `Rule 2 historical reference DELETE returns HTTP 400 (got ${r2DelRes.status})`);
  assert(r2DelData.rule === 'HAS_HISTORY', 'RULE2_PAYLOAD_RULE_HAS_HISTORY',
    `Rule 2 response payload contains rule: 'HAS_HISTORY' (got '${r2DelData.rule}')`);
  assert(r2DelData.history_counts?.stock_movements === 1, 'RULE2_PAYLOAD_HISTORY_COUNTS',
    `Rule 2 history_counts reports { stock_movements: 1 }`);

  // Test 6.3c: Deactivate instead workflow
  const r2DeactRes = await putLocationById(
    makeRequest(`/api/admin/inventory/locations/${r2LocId}`, {
      method: 'PUT',
      userId: ADMIN_USER_ID,
      body: { is_active: false },
    }),
    makeContext(r2LocId)
  );
  assert(r2DeactRes.status === 200, 'RULE2_DEACTIVATE_WORKFLOW_200', 'Deactivate instead workflow returns HTTP 200');
  const r2DeactData = await r2DeactRes.json();
  assert(r2DeactData.data?.is_active === false, 'RULE2_DEACTIVATE_IS_ACTIVE_FALSE', 'Location is successfully deactivated');

  // Verify historical movement is preserved
  const { rows: r2HistCheck } = await dbClient.query('SELECT id FROM stock_movements WHERE source_location_id = $1', [r2LocId]);
  assert(r2HistCheck.length === 1, 'RULE2_AUDIT_HISTORY_PRESERVED', 'Historical stock movement audit row remains intact');

  // 6.4 Rule 3: Pristine location with 0-quantity placeholder rows safely deleted
  console.log('\n  -> Setting up Rule 3 fixture: Pristine location with zero stock placeholder');
  const r3CreateRes = await postLocation(makeRequest('/api/admin/inventory/locations', {
    method: 'POST',
    userId: ADMIN_USER_ID,
    body: {
      code: 'TEST-HTTP-R3',
      name: 'Rule 3 Pristine Room',
      location_type: 'dining_hall',
      is_active: true,
    },
  }));
  const r3LocId = (await r3CreateRes.json()).data.id;

  // Insert a 0-quantity placeholder row
  await dbClient.query(`
    INSERT INTO item_location_stocks (id, item_id, location_id, quantity, updated_at)
    VALUES (gen_random_uuid(), $1, $2, 0, now())
  `, [testItem.id, r3LocId]);

  // Test 6.4a: Dependency check
  const r3DepRes = await getLocationById(
    makeRequest(`/api/admin/inventory/locations/${r3LocId}?checkDependencies=true`, { userId: ADMIN_USER_ID }),
    makeContext(r3LocId)
  );
  assert(r3DepRes.status === 200, 'RULE3_DEP_CHECK_STATUS_200', 'Rule 3 dependency check returns HTTP 200');
  const r3DepData = await r3DepRes.json();
  assert(r3DepData.canDelete === true, 'RULE3_DEP_CAN_DELETE_TRUE', 'Rule 3 reports canDelete: true');

  // Test 6.4b: Route handler DELETE invocation
  const r3DelRes = await deleteLocationById(
    makeRequest(`/api/admin/inventory/locations/${r3LocId}`, {
      method: 'DELETE',
      userId: ADMIN_USER_ID,
    }),
    makeContext(r3LocId)
  );
  assert(r3DelRes.status === 200, 'RULE3_HTTP_STATUS_200',
    `Rule 3 pristine location DELETE returns HTTP 200 (got ${r3DelRes.status})`);
  const r3DelData = await r3DelRes.json();
  assert(r3DelData.success === true, 'RULE3_PAYLOAD_SUCCESS_TRUE', 'Rule 3 response contains success: true');

  // Verify DB record is completely deleted
  const { rows: r3DbCheck } = await dbClient.query('SELECT id FROM inventory_locations WHERE id = $1', [r3LocId]);
  assert(r3DbCheck.length === 0, 'RULE3_DB_RECORD_DELETED', 'Pristine location record removed from database');

  // Verify 0-stock placeholder row was cleaned up
  const { rows: r3StockCheck } = await dbClient.query('SELECT id FROM item_location_stocks WHERE location_id = $1', [r3LocId]);
  assert(r3StockCheck.length === 0, 'RULE3_STOCK_PLACEHOLDER_PURGED', 'Zero-quantity placeholder rows cleanly purged');

  // -------------------------------------------------------------------------
  // GROUP 7: PostgreSQL Database-Level Triggers
  // -------------------------------------------------------------------------
  console.log('\n--- Group 7: PostgreSQL Database Trigger Safeguards ---');

  // 7.1 Direct SQL DELETE on STORE
  let storeSqlBlocked = false;
  try {
    await dbClient.query("DELETE FROM inventory_locations WHERE code = 'STORE'");
  } catch (err) {
    storeSqlBlocked = true;
    assert(err.message.includes('permanently reserved'), 'DB_TRG_STORE_DELETE_BLOCKED',
      `DB trigger blocked direct SQL DELETE on STORE: '${err.message}'`);
  }
  assert(storeSqlBlocked, 'DB_TRG_STORE_DELETE_ACTIVE', 'STORE delete DB trigger is active');

  // 7.2 Direct SQL UPDATE deactivating STORE
  let storeSqlDeactBlocked = false;
  try {
    await dbClient.query("UPDATE inventory_locations SET is_active = false WHERE code = 'STORE'");
  } catch (err) {
    storeSqlDeactBlocked = true;
    assert(err.message.includes('cannot be deactivated'), 'DB_TRG_STORE_DEACT_BLOCKED',
      `DB trigger blocked direct SQL deactivation on STORE: '${err.message}'`);
  }
  assert(storeSqlDeactBlocked, 'DB_TRG_STORE_DEACT_ACTIVE', 'STORE deactivation DB trigger is active');

  // 7.3 Direct SQL DELETE on location with stock
  let r1SqlBlocked = false;
  try {
    await dbClient.query('DELETE FROM inventory_locations WHERE id = $1', [r1LocId]);
  } catch (err) {
    r1SqlBlocked = true;
    assert(err.message.includes('non-zero stock balances'), 'DB_TRG_R1_STOCK_BLOCKED',
      `DB trigger blocked direct SQL DELETE on location with stock: '${err.message}'`);
  }
  assert(r1SqlBlocked, 'DB_TRG_R1_STOCK_ACTIVE', 'Stock safeguard DB trigger is active');

  // 7.4 Direct SQL DELETE on location with historical stock movements
  let r2SqlBlocked = false;
  try {
    await dbClient.query('DELETE FROM inventory_locations WHERE id = $1', [r2LocId]);
  } catch (err) {
    r2SqlBlocked = true;
    assert(err.message.includes('historical stock movement'), 'DB_TRG_R2_HISTORY_BLOCKED',
      `DB trigger blocked direct SQL DELETE on location with history: '${err.message}'`);
  }
  assert(r2SqlBlocked, 'DB_TRG_R2_HISTORY_ACTIVE', 'History safeguard DB trigger is active');

} catch (err) {
  console.error('\n💥 FATAL UNCAUGHT ERROR IN TEST HARNESS:');
  console.error(err);
  failedAssertions++;
} finally {
  // Post-cleanup
  await cleanupTestFixtures();
  await dbClient.end();

  // Print Summary
  console.log('\n========================================================================');
  console.log('📊 TEST SUMMARY REPORT');
  console.log('========================================================================');
  console.log(`Total Assertions:  ${totalAssertions}`);
  console.log(`Passed Assertions: ${passedAssertions} (${Math.round((passedAssertions / (totalAssertions || 1)) * 100)}%)`);
  console.log(`Failed Assertions: ${failedAssertions}`);
  console.log('========================================================================\n');

  if (failedAssertions > 0) {
    console.error(`🚨 HARNESS RESULT: FAILED (${failedAssertions} failure(s) detected)`);
    process.exit(1);
  } else {
    console.log('✨ HARNESS RESULT: PASSED (100% assertions green)');
    process.exit(0);
  }
}
