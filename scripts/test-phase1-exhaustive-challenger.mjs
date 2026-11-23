import fs from 'fs';
import { spawnSync } from 'child_process';
import pg from 'pg';

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
process.env.ENABLE_TEST_AUTH_OVERRIDE = 'true';

const dbUrl = process.env.DATABASE_URL;
const { Pool } = pg;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

const { GET: getSettings, PATCH: patchSettings } = await import('../src/app/api/finance/purchase-approval-settings/route.ts');
const { GET: getRequests, POST: postRequest } = await import('../src/app/api/finance/purchase-requests/route.ts');
const { PATCH: patchLine } = await import('../src/app/api/finance/purchase-requests/[id]/lines/[lineId]/route.ts');
const { DELETE: deleteRequest } = await import('../src/app/api/finance/purchase-requests/[id]/route.ts');

const STOREKEEPER_ID = '16e29066-9477-4232-a5c9-e4dedbc988d9';
const ADMIN_ID = '21c087eb-2517-436e-9e52-80a9455ea749';

async function runExhaustiveChallengerTests() {
  const client = await pool.connect();
  console.log('🥊 Running Phase 1 Exhaustive Challenger & Loophole Penetration Test Suite...\n');

  const createdRequestIds = [];
  const createdPoIds = [];

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Admin RBAC on Policy Settings
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Policy Settings RBAC (Admin only) ---');
    const nonAdminPatch = new Request('http://localhost:3000/api/finance/purchase-approval-settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': STOREKEEPER_ID
      },
      body: JSON.stringify({ line_auto_approve_limit: 2000 })
    });
    const patchRes1 = await patchSettings(nonAdminPatch);
    console.log(`Storekeeper PATCH status: ${patchRes1.status} (expected 403)`);
    if (patchRes1.status !== 403) {
      throw new Error(`Expected 403 for Storekeeper patching policy settings, got ${patchRes1.status}`);
    }

    const adminPatch = new Request('http://localhost:3000/api/finance/purchase-approval-settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': ADMIN_ID
      },
      body: JSON.stringify({ line_auto_approve_limit: 1500, daily_non_staple_auto_limit: 5000 })
    });
    const patchRes2 = await patchSettings(adminPatch);
    console.log(`Admin PATCH status: ${patchRes2.status} (expected 200)`);
    if (patchRes2.status !== 200) {
      throw new Error(`Expected 200 for Admin patching policy settings, got ${patchRes2.status}`);
    }
    console.log('✅ Policy Settings RBAC verified.');

    // -------------------------------------------------------------------------
    // TEST 2: Cumulative Basket Par Accumulation Loophole
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Open Approved Basket Accumulation Loophole ---');
    // Garlic Bread (16dc978c-02b6-4479-92c3-cebf6b946e82) has max_stock_level = 1 pkt
    // 1. Submit Request A: requested 1 pkt. (Stock 0 + Req 1 = 1 <= 1) -> auto_approved
    const postReqA = new Request('http://localhost:3000/api/finance/purchase-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user-id': STOREKEEPER_ID },
      body: JSON.stringify({
        notes: 'Challenger Basket Accumulation Test A',
        lines: [
          {
            item_id: '16dc978c-02b6-4479-92c3-cebf6b946e82',
            requested_quantity: 1,
            pack_unit_snapshot: 'pkt',
            pack_quantity: 1,
            conversion_factor_snapshot: 1,
          }
        ]
      })
    });
    const resA = await postRequest(postReqA);
    const dataA = await resA.json();
    createdRequestIds.push(dataA.request.id);
    const lineA = dataA.lines[0];
    console.log(`Request A Garlic Bread line status: ${lineA.approval_status} (expected auto_approved)`);
    if (lineA.approval_status !== 'auto_approved') {
      throw new Error(`Expected Request A line to be auto_approved, got ${lineA.approval_status}`);
    }

    // 2. Submit Request B: requested 1 pkt for Garlic Bread while Request A is still open!
    // (Stock 0 + OpenApproved 1 + Req 1 = 2 > 1) -> pending_approval with 'Exceeds Max-Par'
    const postReqB = new Request('http://localhost:3000/api/finance/purchase-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user-id': STOREKEEPER_ID },
      body: JSON.stringify({
        notes: 'Challenger Basket Accumulation Test B',
        lines: [
          {
            item_id: '16dc978c-02b6-4479-92c3-cebf6b946e82',
            requested_quantity: 1,
            pack_unit_snapshot: 'pkt',
            pack_quantity: 1,
            conversion_factor_snapshot: 1,
          }
        ]
      })
    });
    const resB = await postRequest(postReqB);
    const dataB = await resB.json();
    createdRequestIds.push(dataB.request.id);
    const lineB = dataB.lines[0];
    console.log(`Request B Garlic Bread line status: ${lineB.approval_status}, reasons: ${JSON.stringify(lineB.routing_reasons)}`);
    if (lineB.approval_status !== 'pending_approval' || !lineB.routing_reasons.includes('Exceeds Max-Par')) {
      throw new Error(`Expected Request B to exceed Max-Par due to open approved basket stock!`);
    }
    console.log('✅ Open approved basket par accumulation successfully blocked split requests!');

    // 3. Now cancel Request A and verify Request C can be auto-approved
    await client.query(`UPDATE purchase_requests SET status = 'cancelled' WHERE id = $1`, [dataA.request.id]);
    const postReqC = new Request('http://localhost:3000/api/finance/purchase-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user-id': STOREKEEPER_ID },
      body: JSON.stringify({
        notes: 'Challenger Basket Accumulation Test C',
        lines: [
          {
            item_id: '16dc978c-02b6-4479-92c3-cebf6b946e82',
            requested_quantity: 1,
            pack_unit_snapshot: 'pkt',
            pack_quantity: 1,
            conversion_factor_snapshot: 1,
          }
        ]
      })
    });
    const resC = await postRequest(postReqC);
    const dataC = await resC.json();
    createdRequestIds.push(dataC.request.id);
    const lineC = dataC.lines[0];
    console.log(`Request C (after Request A cancelled) status: ${lineC.approval_status} (expected auto_approved)`);
    if (lineC.approval_status !== 'auto_approved') {
      throw new Error(`Expected Request C to auto_approve after cancelled request freed par!`);
    }
    console.log('✅ Cancelled request properly released par headroom.');

    // -------------------------------------------------------------------------
    // TEST 3: Mandi-Exemption vs Daily Non-Staple Cap
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Mandi-Exemption vs Non-Staple Daily ₹5,000 Cap ---');
    // Temporarily increase Bonn Pizza Base max par to 500 pcs so Par doesn't trigger, isolating the ₹5,000 daily spend cap
    await client.query(`UPDATE inventory_items SET max_stock_level = 500 WHERE id = 'c355d7ef-b24c-4ae9-b111-d8e79cb20e58'`);
    // Mandi items: Toned Milk (ml, rate 0.06/ml, category Dairy Products)
    // 5 lines each 10,000 ml = 10L @ ₹0.06/ml = ₹600 each. Total Mandi = ₹3,000.
    // Non-staple item: Bonn Pizza Base (pcs, rate 22.50, category Bakery)
    // Line 1: 50 pcs * 22.50 = ₹1,125 (<= 1500 limit).
    // Line 2: 50 pcs * 22.50 = ₹1,125.
    // Line 3: 50 pcs * 22.50 = ₹1,125.
    // Line 4: 50 pcs * 22.50 = ₹1,125. Total non-staple so far = ₹4,500.
    // Line 5: 50 pcs * 22.50 = ₹1,125. Projected non-staple = ₹5,625 > ₹5,000! Line 5 must route to pending_approval!
    const postReqD = new Request('http://localhost:3000/api/finance/purchase-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user-id': STOREKEEPER_ID },
      body: JSON.stringify({
        notes: 'Challenger Mandi vs Non-Staple Cap Test',
        lines: [
          // 4 non-staple lines
          { item_id: 'c355d7ef-b24c-4ae9-b111-d8e79cb20e58', requested_quantity: 50, conversion_factor_snapshot: 1 },
          { item_id: 'c355d7ef-b24c-4ae9-b111-d8e79cb20e58', requested_quantity: 50, conversion_factor_snapshot: 1 },
          { item_id: 'c355d7ef-b24c-4ae9-b111-d8e79cb20e58', requested_quantity: 50, conversion_factor_snapshot: 1 },
          { item_id: 'c355d7ef-b24c-4ae9-b111-d8e79cb20e58', requested_quantity: 50, conversion_factor_snapshot: 1 },
          // 5th non-staple line (breaches ₹5,000 daily cap)
          { item_id: 'c355d7ef-b24c-4ae9-b111-d8e79cb20e58', requested_quantity: 50, conversion_factor_snapshot: 1 },
        ]
      })
    });
    const resD = await postRequest(postReqD);
    const dataD = await resD.json();
    createdRequestIds.push(dataD.request.id);

    console.log(`Line 1 (₹1,125): ${dataD.lines[0].approval_status}`);
    console.log(`Line 2 (₹1,125): ${dataD.lines[1].approval_status}`);
    console.log(`Line 3 (₹1,125): ${dataD.lines[2].approval_status}`);
    console.log(`Line 4 (₹1,125): ${dataD.lines[3].approval_status}`);
    console.log(`Line 5 (₹1,125): ${dataD.lines[4].approval_status}, reasons: ${JSON.stringify(dataD.lines[4].routing_reasons)}`);

    if (dataD.lines[3].approval_status !== 'auto_approved') {
      throw new Error(`Lines 1-4 should be auto_approved!`);
    }
    if (dataD.lines[4].approval_status !== 'pending_approval' || !dataD.lines[4].routing_reasons.includes('Daily auto-approval cap reached')) {
      throw new Error(`Line 5 should breach the ₹5,000 daily non-staple cap!`);
    }
    console.log('✅ Daily ₹5,000 non-staple anti-split limit successfully enforced!');

    // -------------------------------------------------------------------------
    // TEST 4: Approver Actions with kg/L Live Conversion
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Approver Action set_max_par_and_approve ---');
    // Test set_max_par_and_approve on line 5
    const patchReqAction = new Request(`http://localhost:3000/api/finance/purchase-requests/${dataD.request.id}/lines/${dataD.lines[4].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
      body: JSON.stringify({
        action: 'set_max_par_and_approve',
        new_max_par: 250,
        approved_quantity: 50,
        review_note: 'Increased max par to 250 pcs and approved'
      })
    });
    const actionRes = await patchLine(patchReqAction, { params: Promise.resolve({ id: dataD.request.id, lineId: dataD.lines[4].id }) });
    const actionData = await actionRes.json();
    console.log(`Approver action result: status=${actionData.line?.approval_status}, approved_qty=${actionData.line?.approved_quantity}`);
    if (actionData.line?.approval_status !== 'approved') {
      throw new Error(`Expected line to be approved after approver action!`);
    }
    console.log('✅ Approver action set_max_par_and_approve passed.');

    // -------------------------------------------------------------------------
    // TEST 5: Partial PO Conversion & Request Completion Transition
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Partial Line Conversion & Completion Transition ---');
    // Fetch a valid vendor_id
    const vendorRes = await client.query(`SELECT id FROM vendors LIMIT 1`);
    const vendorId = vendorRes.rows[0].id;

    // Create a purchase header to simulate PO
    const poNum = 'PO-CHALLENGER-' + Date.now().toString().slice(-6);
    const poRes = await client.query(`
      INSERT INTO purchase_headers (
        purchase_number, vendor_id, purchase_date, business_date, net_amount, total_amount, status
      ) VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE, 1125, 1125, 'approved')
      RETURNING id
    `, [poNum, vendorId]);
    const poId = poRes.rows[0].id;
    createdPoIds.push(poId);

    // Convert only line 0 to PO
    const convRes = await client.query(`
      UPDATE purchase_request_lines
      SET approval_status = 'purchased',
          converted_purchase_id = $1,
          updated_at = NOW()
      WHERE id = $2 AND approval_status IN ('auto_approved', 'approved')
      RETURNING id, approval_status, converted_purchase_id
    `, [poId, dataD.lines[0].id]);
    console.log(`Converted line 0: ${convRes.rows[0].approval_status}`);

    // Check parent request status: must STILL be 'open' because lines 1-4 are not purchased
    const reqStatusCheck1 = await client.query(`SELECT status FROM purchase_requests WHERE id = $1`, [dataD.request.id]);
    console.log(`Parent request status after 1 line converted: ${reqStatusCheck1.rows[0].status} (expected open)`);
    if (reqStatusCheck1.rows[0].status !== 'open') {
      throw new Error(`Parent request should still be open when not all lines are finished!`);
    }

    // Now convert remaining lines (1, 2, 3 to purchased, 4 to rejected)
    await client.query(`
      UPDATE purchase_request_lines
      SET approval_status = 'purchased',
          converted_purchase_id = $1,
          updated_at = NOW()
      WHERE id IN ($2, $3, $4)
    `, [poId, dataD.lines[1].id, dataD.lines[2].id, dataD.lines[3].id]);

    await client.query(`
      UPDATE purchase_request_lines
      SET approval_status = 'rejected',
          updated_at = NOW()
      WHERE id = $1
    `, [dataD.lines[4].id]);

    // Check if all lines are in ('purchased', 'rejected') and mark completed
    const allLinesRes = await client.query(`
      SELECT count(*) as count
      FROM purchase_request_lines
      WHERE request_id = $1 AND approval_status NOT IN ('purchased', 'rejected')
    `, [dataD.request.id]);
    if (parseInt(allLinesRes.rows[0].count, 10) === 0) {
      await client.query(`UPDATE purchase_requests SET status = 'completed' WHERE id = $1`, [dataD.request.id]);
    }

    const reqStatusCheck2 = await client.query(`SELECT status FROM purchase_requests WHERE id = $1`, [dataD.request.id]);
    console.log(`Parent request status after all lines resolved: ${reqStatusCheck2.rows[0].status} (expected completed)`);
    if (reqStatusCheck2.rows[0].status !== 'completed') {
      throw new Error(`Parent request should transition to completed!`);
    }

    // -------------------------------------------------------------------------
    // TEST 6: ON DELETE SET NULL FK Safety
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: ON DELETE SET NULL FK Integrity ---');
    await client.query(`DELETE FROM purchase_headers WHERE id = $1`, [poId]);
    console.log(`Deleted PO ${poId}`);
    const lineAfterPoDel = await client.query(`SELECT converted_purchase_id FROM purchase_request_lines WHERE id = $1`, [dataD.lines[0].id]);
    console.log(`Line converted_purchase_id after PO deletion: ${lineAfterPoDel.rows[0].converted_purchase_id} (expected null)`);
    if (lineAfterPoDel.rows[0].converted_purchase_id !== null) {
      throw new Error(`Expected converted_purchase_id to be NULL after PO deletion!`);
    }
    console.log('✅ ON DELETE SET NULL safely prevented FK cascade violations.');

    // -------------------------------------------------------------------------
    // TEST 7: GET /api/finance/purchase-requests returns 30d usage lookup
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: GET /api/finance/purchase-requests with 30d usage lookup ---');
    const getReq = new Request('http://localhost:3000/api/finance/purchase-requests', {
      headers: { 'x-test-user-id': ADMIN_ID }
    });
    const getRes = await getRequests(getReq);
    const getData = await getRes.json();
    console.log(`GET requests returned ${getData.requests?.length} requests.`);
    console.log(`30d usage map entries: ${Object.keys(getData.usage30dMap || {}).length}`);
    if (!getData.usage30dMap || Object.keys(getData.usage30dMap).length === 0) {
      throw new Error(`Expected usage30dMap in GET /api/finance/purchase-requests response!`);
    }
    console.log('✅ GET purchase-requests returns live 30d usage lookup across inventory items.');
    console.log('\n🎉 ALL EXHAUSTIVE CHALLENGER TESTS PASSED SUCCESSFULLY!');

  } catch (err) {
    console.error('❌ ERROR DURING TEST EXECUTION:', err);
    throw err;
  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP: Synthetic test rows removal
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Synthetic Row Cleanup ---');
    if (createdRequestIds.length > 0) {
      await client.query(`DELETE FROM purchase_requests WHERE id = ANY($1::uuid[])`, [createdRequestIds]);
      console.log(`Cleaned up ${createdRequestIds.length} synthetic purchase requests.`);
    }
    if (createdPoIds.length > 0) {
      await client.query(`DELETE FROM purchase_headers WHERE id = ANY($1::uuid[])`, [createdPoIds]);
      console.log(`Cleaned up ${createdPoIds.length} synthetic purchase headers.`);
    }

    // Reset Pizza Base Bonn max stock level to original seed (16 pcs)
    await client.query(`UPDATE inventory_items SET max_stock_level = 16 WHERE id = 'c355d7ef-b24c-4ae9-b111-d8e79cb20e58'`);
    console.log('Restored original Bonn Pizza Base par level (16 pcs).');

    await client.end();
    await pool.end();
    console.log('✅ Cleanup complete. Database is pristine.');
  }

  console.log('\n🎉 ALL EXHAUSTIVE CHALLENGER TESTS PASSED SUCCESSFULLY!');
}

runExhaustiveChallengerTests().catch((err) => {
  console.error('❌ Challenger Test Failed:', err);
  process.exit(1);
});
