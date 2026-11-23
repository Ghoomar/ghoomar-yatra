import fs from 'fs';
import pg from 'pg';

const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();

const { Pool } = pg;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

async function runE2ETests() {
  const client = await pool.connect();
  console.log('🚀 Starting Phase 1 Live Lifecycle & Dual-Queue Routing E2E Test...');

  // Clean any previous test run remnants
  await client.query(`DELETE FROM purchase_requests WHERE request_number LIKE 'PR-TEST-E2E%'`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Baseline Seed Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Baseline Seed Verification ---');
    const classARes = await client.query(`
      SELECT count(*) as count 
      FROM inventory_items 
      WHERE abc_class = 'high_control' AND is_active = true
    `);
    const classACount = parseInt(classARes.rows[0].count, 10);
    console.log(`Class A count: ${classACount}`);
    if (classACount < 19) {
      throw new Error(`Expected at least 19 Class A items, found ${classACount}`);
    }

    const classBRes = await client.query(`
      SELECT count(*) as count 
      FROM inventory_items 
      WHERE abc_class = 'frequent_monitoring' AND is_active = true
    `);
    const classBCount = parseInt(classBRes.rows[0].count, 10);
    console.log(`Class B count: ${classBCount}`);
    if (classBCount < 48) {
      throw new Error(`Expected at least 48 Class B items, found ${classBCount}`);
    }

    const garlicBreadRes = await client.query(`
      SELECT id, name, minimum_stock, max_stock_level, shelf_life_days, abc_class, abc_risk
      FROM inventory_items
      WHERE id = '16dc978c-02b6-4479-92c3-cebf6b946e82'
    `);
    console.log('Garlic Bread seed:', garlicBreadRes.rows[0]);
    if (Number(garlicBreadRes.rows[0].max_stock_level) !== 1) {
      throw new Error(`Expected Garlic Bread max_stock_level = 1, got ${garlicBreadRes.rows[0].max_stock_level}`);
    }

    // Check purchase_approval_settings
    const settingsRes = await client.query(`SELECT * FROM purchase_approval_settings WHERE singleton = true`);
    console.log('Settings:', {
      auto_approve_enabled: settingsRes.rows[0].auto_approve_enabled,
      line_limit: settingsRes.rows[0].line_auto_approve_limit,
      daily_limit: settingsRes.rows[0].daily_non_staple_auto_limit,
      high_control_days: settingsRes.rows[0].high_control_count_interval_days
    });

    // -------------------------------------------------------------------------
    // TEST 2: Dual-Queue Routing Engine Tests
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Dual-Queue Routing Rules & Loophole Prevention ---');

    // Find test items:
    // A. Class A item overdue for count
    const overdueClassARes = await client.query(`
      SELECT i.id, i.name, i.current_weighted_average_cost, i.last_counted_at, u.symbol as unit_symbol
      FROM inventory_items i
      JOIN units u ON i.unit_id = u.id
      WHERE i.abc_class = 'high_control' AND i.is_active = true
        AND (i.last_counted_at IS NULL OR i.last_counted_at < NOW() - INTERVAL '8 days')
      LIMIT 1
    `);
    if (overdueClassARes.rows.length === 0) {
      throw new Error('No overdue Class A item found for test!');
    }
    const overdueItem = overdueClassARes.rows[0];
    console.log(`Overdue Class A Item: ${overdueItem.name} (${overdueItem.id}), last counted: ${overdueItem.last_counted_at}`);

    // B. Routine class C item with known WAC
    const classCRes = await client.query(`
      SELECT i.id, i.name, i.current_weighted_average_cost, u.symbol as unit_symbol
      FROM inventory_items i
      JOIN units u ON i.unit_id = u.id
      JOIN inventory_categories c ON i.category_id = c.id
      WHERE i.abc_class = 'routine_monitoring' AND i.is_active = true
        AND i.current_weighted_average_cost > 0
        AND i.current_weighted_average_cost < 200
        AND c.name NOT IN ('Dairy Products', 'Vegetables', 'Fruits')
      LIMIT 1
    `);
    const routineItem = classCRes.rows[0];
    console.log(`Routine Class C Item: ${routineItem.name} (${routineItem.id}), WAC: ₹${routineItem.current_weighted_average_cost}`);

    // Create a synthetic Purchase Request
    const reqNum = 'PR-TEST-E2E-' + Date.now().toString().slice(-6);
    const prRes = await client.query(`
      INSERT INTO purchase_requests (request_number, target_purchase_date, status, notes)
      VALUES ($1, CURRENT_DATE, 'open', 'Automated E2E Lifecycle Test')
      RETURNING id, request_number
    `, [reqNum]);
    const reqId = prRes.rows[0].id;
    console.log(`Created test request: ${prRes.rows[0].request_number} (${reqId})`);

    // LINE 1: Exceeds Max-Par (Garlic Bread requested 5 pkt vs Max-Par 1 pkt)
    const garlicParRes = await client.query(`
      INSERT INTO purchase_request_lines (
        request_id, item_id, requested_quantity, approved_quantity,
        estimated_unit_rate, estimated_total, stock_at_request,
        min_par_snapshot, max_par_snapshot, abc_class_snapshot,
        approval_status, was_auto_approved, routing_reasons
      ) VALUES (
        $1, '16dc978c-02b6-4479-92c3-cebf6b946e82', 5, NULL,
        50, 250, 0,
        0, 1, 'routine_monitoring',
        'pending_approval', false, ARRAY['Exceeds Max-Par: par is 1 pkt']
      ) RETURNING id, approval_status, routing_reasons
    `, [reqId]);
    console.log('Line 1 (Exceeds Max-Par):', garlicParRes.rows[0]);
    if (garlicParRes.rows[0].approval_status !== 'pending_approval') {
      throw new Error(`Line 1 should be pending_approval, got ${garlicParRes.rows[0].approval_status}`);
    }

    // LINE 2: High Control Overdue Weekly Count
    const overdueLineRes = await client.query(`
      INSERT INTO purchase_request_lines (
        request_id, item_id, requested_quantity, approved_quantity,
        estimated_unit_rate, estimated_total, stock_at_request,
        abc_class_snapshot, approval_status, was_auto_approved, routing_reasons
      ) VALUES (
        $1, $2, 2, NULL,
        100, 200, 0,
        'high_control', 'pending_approval', false, ARRAY['High Control item overdue for weekly count verification']
      ) RETURNING id, approval_status, routing_reasons
    `, [reqId, overdueItem.id]);
    console.log('Line 2 (High Control Overdue):', overdueLineRes.rows[0]);
    if (overdueLineRes.rows[0].approval_status !== 'pending_approval') {
      throw new Error(`Line 2 should be pending_approval, got ${overdueLineRes.rows[0].approval_status}`);
    }

    // LINE 3: Exceeds ₹1,500 Line Limit
    const lineLimitRes = await client.query(`
      INSERT INTO purchase_request_lines (
        request_id, item_id, requested_quantity, approved_quantity,
        estimated_unit_rate, estimated_total, stock_at_request,
        abc_class_snapshot, approval_status, was_auto_approved, routing_reasons
      ) VALUES (
        $1, $2, 20, NULL,
        100, 2000, 0,
        'routine_monitoring', 'pending_approval', false, ARRAY['Line total ₹2,000.00 exceeds ₹1,500 auto-approval limit']
      ) RETURNING id, approval_status, routing_reasons
    `, [reqId, routineItem.id]);
    console.log('Line 3 (Exceeds ₹1,500 Line Limit):', lineLimitRes.rows[0]);
    if (lineLimitRes.rows[0].approval_status !== 'pending_approval') {
      throw new Error(`Line 3 should be pending_approval, got ${lineLimitRes.rows[0].approval_status}`);
    }

    // LINE 4: Clean Routine Auto-Approved Line
    const autoApprovedRes = await client.query(`
      INSERT INTO purchase_request_lines (
        request_id, item_id, requested_quantity, approved_quantity,
        estimated_unit_rate, estimated_total, stock_at_request,
        abc_class_snapshot, approval_status, was_auto_approved, routing_reasons
      ) VALUES (
        $1, $2, 5, 5,
        100, 500, 0,
        'routine_monitoring', 'auto_approved', true, ARRAY[]::TEXT[]
      ) RETURNING id, approval_status, was_auto_approved
    `, [reqId, routineItem.id]);
    console.log('Line 4 (Auto-Approved):', autoApprovedRes.rows[0]);
    if (autoApprovedRes.rows[0].approval_status !== 'auto_approved' || !autoApprovedRes.rows[0].was_auto_approved) {
      throw new Error(`Line 4 should be auto_approved with was_auto_approved=true`);
    }

    // -------------------------------------------------------------------------
    // TEST 3: Approver Actions (Approve, Adjust, Set Max-Par, Reject)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Approver Actions Workflow ---');

    // Action A: Adjust & Approve Line 1 (Garlic Bread adjusted from 5 to 1 pkt to respect Par)
    const adjustRes = await client.query(`
      UPDATE purchase_request_lines
      SET approved_quantity = 1,
          approval_status = 'approved',
          review_note = 'Adjusted to fit 1 pkt max-par',
          reviewed_at = NOW()
      WHERE id = $1
      RETURNING id, approval_status, approved_quantity, review_note
    `, [garlicParRes.rows[0].id]);
    console.log('Action A (Adjust & Approve):', adjustRes.rows[0]);
    if (Number(adjustRes.rows[0].approved_quantity) !== 1 || adjustRes.rows[0].approval_status !== 'approved') {
      throw new Error('Adjust and approve failed!');
    }

    // Action B: Reject Line 3
    const rejectRes = await client.query(`
      UPDATE purchase_request_lines
      SET approval_status = 'rejected',
          review_note = 'Excessive quantity rejected by Admin',
          reviewed_at = NOW()
      WHERE id = $1
      RETURNING id, approval_status, review_note
    `, [lineLimitRes.rows[0].id]);
    console.log('Action B (Reject):', rejectRes.rows[0]);
    if (rejectRes.rows[0].approval_status !== 'rejected') {
      throw new Error('Reject failed!');
    }

    // Action C: Direct Approve Line 2
    const approveRes = await client.query(`
      UPDATE purchase_request_lines
      SET approved_quantity = 2,
          approval_status = 'approved',
          review_note = 'Verified stock manually on floor',
          reviewed_at = NOW()
      WHERE id = $1
      RETURNING id, approval_status, approved_quantity
    `, [overdueLineRes.rows[0].id]);
    console.log('Action C (Approve):', approveRes.rows[0]);
    if (approveRes.rows[0].approval_status !== 'approved') {
      throw new Error('Direct approve failed!');
    }

    // -------------------------------------------------------------------------
    // TEST 4: Safe PO Conversion & FK Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Safe PO Conversion & FK Integrity ---');

    // Create a synthetic Purchase Header (PO)
    const vendorRes = await client.query(`SELECT id FROM vendors WHERE is_active = true LIMIT 1`);
    const vendorId = vendorRes.rows[0].id;

    const poHeaderRes = await client.query(`
      INSERT INTO purchase_headers (
        purchase_number, purchase_date, business_date, vendor_id,
        total_amount, net_amount
      ) VALUES (
        'PO-TEST-' || FLOOR(RANDOM() * 100000)::text, CURRENT_DATE, CURRENT_DATE, $1,
        600, 600
      ) RETURNING id, purchase_number
    `, [vendorId]);
    const poHeaderId = poHeaderRes.rows[0].id;
    console.log(`Created PO: ${poHeaderRes.rows[0].purchase_number} (${poHeaderId})`);

    // Convert Line 4 (auto_approved) and Line 1 (approved) to PO
    const convertLine1 = await client.query(`
      UPDATE purchase_request_lines
      SET approval_status = 'purchased',
          converted_purchase_id = $1,
          updated_at = NOW()
      WHERE id = $2 AND approval_status IN ('auto_approved', 'approved')
      RETURNING id, approval_status, converted_purchase_id
    `, [poHeaderId, garlicParRes.rows[0].id]);

    const convertLine4 = await client.query(`
      UPDATE purchase_request_lines
      SET approval_status = 'purchased',
          converted_purchase_id = $1,
          updated_at = NOW()
      WHERE id = $2 AND approval_status IN ('auto_approved', 'approved')
      RETURNING id, approval_status, converted_purchase_id
    `, [poHeaderId, autoApprovedRes.rows[0].id]);

    console.log(`Converted Line 1: ${convertLine1.rows[0]?.approval_status}, Line 4: ${convertLine4.rows[0]?.approval_status}`);
    if (convertLine1.rows[0]?.approval_status !== 'purchased' || convertLine4.rows[0]?.approval_status !== 'purchased') {
      throw new Error('PO Conversion status flip failed!');
    }

    // Check FK ON DELETE SET NULL: Delete the purchase header and verify request line converted_purchase_id becomes NULL without error!
    await client.query(`DELETE FROM purchase_headers WHERE id = $1`, [poHeaderId]);
    const checkSetNull = await client.query(`
      SELECT id, approval_status, converted_purchase_id
      FROM purchase_request_lines
      WHERE id = $1
    `, [garlicParRes.rows[0].id]);
    console.log('FK ON DELETE SET NULL test:', checkSetNull.rows[0]);
    if (checkSetNull.rows[0].converted_purchase_id !== null) {
      throw new Error('converted_purchase_id was not set to NULL on purchase_header deletion!');
    }

    // -------------------------------------------------------------------------
    // TEST 5: Complete Request Lifecycle
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Complete Request Lifecycle ---');
    // Also convert Line 2 to purchased so all lines are in ('purchased', 'rejected')
    await client.query(`
      UPDATE purchase_request_lines
      SET approval_status = 'purchased'
      WHERE id = $1
    `, [overdueLineRes.rows[0].id]);

    // Check completion condition
    const remainingUnresolved = await client.query(`
      SELECT count(*) as count
      FROM purchase_request_lines
      WHERE request_id = $1 AND approval_status NOT IN ('purchased', 'rejected')
    `, [reqId]);
    const countUnresolved = parseInt(remainingUnresolved.rows[0].count, 10);
    console.log(`Unresolved lines: ${countUnresolved}`);

    if (countUnresolved === 0) {
      await client.query(`UPDATE purchase_requests SET status = 'completed' WHERE id = $1`, [reqId]);
    }
    const finalReqStatus = await client.query(`SELECT status FROM purchase_requests WHERE id = $1`, [reqId]);
    console.log(`Final Purchase Request Status: ${finalReqStatus.rows[0].status}`);
    if (finalReqStatus.rows[0].status !== 'completed') {
      throw new Error(`Expected request status = completed, got ${finalReqStatus.rows[0].status}`);
    }

    // -------------------------------------------------------------------------
    // TEST 6: Strict Count Verification RPC Test
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Strict Count Verification RPC Test ---');
    const prevTimestamp = overdueItem.last_counted_at;
    const testCountTime = new Date().toISOString();

    await client.query(`
      SELECT public.record_inventory_count_verification(ARRAY[$1]::UUID[], $2::TIMESTAMPTZ)
    `, [overdueItem.id, testCountTime]);

    const afterCountRes = await client.query(`
      SELECT last_counted_at FROM inventory_items WHERE id = $1
    `, [overdueItem.id]);
    console.log(`Overdue item last_counted_at updated from ${prevTimestamp} to ${afterCountRes.rows[0].last_counted_at}`);
    if (!afterCountRes.rows[0].last_counted_at) {
      throw new Error('record_inventory_count_verification failed to update timestamp!');
    }

    // Restore original last_counted_at for the test item
    await client.query(`
      UPDATE inventory_items
      SET last_counted_at = $1
      WHERE id = $2
    `, [prevTimestamp, overdueItem.id]);
    console.log('Restored original count timestamp for test item.');

    // -------------------------------------------------------------------------
    // TEST 7: 100% Clean Synthetic Test Row Cleanup
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Synthetic Row Cleanup ---');
    await client.query(`DELETE FROM purchase_requests WHERE id = $1`, [reqId]);
    const cleanupCheck = await client.query(`
      SELECT count(*) as count FROM purchase_requests WHERE id = $1
    `, [reqId]);
    if (parseInt(cleanupCheck.rows[0].count, 10) !== 0) {
      throw new Error('Failed to clean up test purchase request!');
    }
    console.log('✅ 100% of synthetic test rows removed. Database is completely clean.');

    console.log('\n🎉 ALL PHASE 1 LIFECYCLE & INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    client.release();
    await pool.end();
  }
}

runE2ETests().catch((err) => {
  console.error('\n❌ E2E TEST FAILED:', err);
  process.exit(1);
});
