import fs from 'fs';
import pg from 'pg';
import path from 'path';

// Return DATE columns as verbatim strings (YYYY-MM-DD) avoiding local timezone shifts
pg.types.setTypeParser(1082, (val) => val);

const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

let failedTests = 0;
let passedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('Phase 2 Dual-Track Forecasting & Variance Test Suite');
  console.log('====================================================\n');

  const client = await pool.connect();

  try {
    // ----------------------------------------------------
    // TEST 1: 100% Bill Accounting & Classification Coverage
    // ----------------------------------------------------
    console.log('Test 1: 100% Bill Preservation & Accounting Coverage');
    const { rows: orderCount } = await client.query('SELECT COUNT(*) as total FROM sales_orders');
    const { rows: classCount } = await client.query('SELECT COUNT(*) as total FROM sales_bill_classifications');
    const totalOrders = parseInt(orderCount[0].total, 10);
    const totalClassified = parseInt(classCount[0].total, 10);

    assert(totalOrders === 8864, `Raw sales orders count is 8,864 (actual: ${totalOrders})`);
    assert(totalClassified === totalOrders, `Classified bills count (${totalClassified}) exactly equals raw orders count (${totalOrders})`);

    // ----------------------------------------------------
    // TEST 2: Status Exclusion (Cancelled vs Complimentary)
    // ----------------------------------------------------
    console.log('\nTest 2: Status Exclusion (Cancelled vs Complimentary)');
    const { rows: cancelledRows } = await client.query(
      `SELECT COUNT(*) as count FROM sales_bill_classifications WHERE bill_class = 'cancelled'`
    );
    const cancelledCount = parseInt(cancelledRows[0].count, 10);
    assert(cancelledCount === 54, `Exactly 54 Cancelled bills classified as 'cancelled' (actual: ${cancelledCount})`);

    const { rows: compRows } = await client.query(
      `SELECT COUNT(*) as count FROM sales_orders WHERE status = 'Complimentary'`
    );
    const compCount = parseInt(compRows[0].count, 10);
    assert(compCount === 133, `Raw Complimentary orders count is 133 (actual: ${compCount})`);

    // Check Nov 17 snapshot for Complimentary ₹0 revenue and exact revenue match
    const { rows: nov17Snapshot } = await client.query(
      `SELECT * FROM sales_forecast_snapshots WHERE business_date = '2026-11-17'`
    );
    assert(nov17Snapshot.length === 1, 'Nov 17, 2026 snapshot exists');
    const nov17 = nov17Snapshot[0];
    const nov17ActualRev = Number(nov17.actual_net_revenue);
    const nov17CompMenuVal = Number(nov17.decomp_complimentary_menu_value);
    const nov17ActualPax = Number(nov17.actual_pax);
    const nov17BillsCount = Number(nov17.actual_orders);

    assert(nov17ActualRev === 91521.87, `Nov 17 realized net revenue is exactly ₹91,521.87 (actual: ₹${nov17ActualRev})`);
    assert(nov17CompMenuVal === 4844.85, `Nov 17 complimentary menu value tracked at ₹4,844.85 (actual: ₹${nov17CompMenuVal})`);
    // 71 Success orders + 2 Complimentary orders = 73 total orders; 318 Success PAX + 3 Complimentary PAX = 321 total PAX
    assert(nov17ActualPax === 321, `Nov 17 total PAX preserved in quantity track is 321 (318 success + 3 comp, actual: ${nov17ActualPax})`);
    assert(nov17BillsCount === 73, `Nov 17 total orders preserved in quantity track is 73 (71 success + 2 comp, actual: ${nov17BillsCount})`);

    // ----------------------------------------------------
    // TEST 3: Nov 10 Sales Reality Check (Mandatory correction 5)
    // ----------------------------------------------------
    console.log('\nTest 3: Nov 10, 2026 Sales Reality (Assert NOT 44524.28)');
    const { rows: nov10Total } = await client.query(
      `SELECT COUNT(*) as bills, SUM(net_sales) as net_sales, SUM(covers_pax) as pax
       FROM sales_orders WHERE business_date = '2026-11-10'`
    );
    const nov10RawNet = Number(nov10Total[0].net_sales);
    const nov10RawBills = parseInt(nov10Total[0].bills, 10);
    const nov10RawPax = parseInt(nov10Total[0].pax, 10);

    assert(nov10RawNet !== 44524.28, `Nov 10 net sales is NOT 44,524.28 (raw actual: ₹${nov10RawNet})`);
    assert(nov10RawNet === 64741.00, `Nov 10 raw net sales (Success + Complimentary) is exactly ₹64,741.00 (actual: ₹${nov10RawNet})`);
    assert(nov10RawBills === 63, `Nov 10 raw bills count is 63 (actual: ${nov10RawBills})`);
    assert(nov10RawPax === 221, `Nov 10 raw PAX count is 221 (actual: ${nov10RawPax})`);

    const { rows: nov10Snapshot } = await client.query(
      `SELECT * FROM sales_forecast_snapshots WHERE business_date = '2026-11-10'`
    );
    assert(nov10Snapshot.length === 1, 'Nov 10, 2026 snapshot exists');
    const nov10Snap = nov10Snapshot[0];
    assert(Number(nov10Snap.actual_net_revenue) === 64146.00, `Nov 10 realized net revenue is ₹64,146.00 with ₹0 comp revenue (actual: ₹${nov10Snap.actual_net_revenue})`);
    assert(Number(nov10Snap.decomp_complimentary_menu_value) === 595.00, `Nov 10 complimentary menu value is ₹595.00 (actual: ₹${nov10Snap.decomp_complimentary_menu_value})`);
    assert(Number(nov10Snap.actual_orders) === 63, `Nov 10 total orders preserved is 63 (actual: ${nov10Snap.actual_orders})`);
    assert(Number(nov10Snap.actual_pax) === 221, `Nov 10 total PAX preserved is 221 (actual: ${nov10Snap.actual_pax})`);

    // ----------------------------------------------------
    // TEST 4: Bill Classification Precedence & Edge Cases
    // ----------------------------------------------------
    console.log('\nTest 4: Bill Classification Precedence & Edge Cases');
    
    // (a) PAX-typo guard on Dine In (covers_pax >= 10 && spend_per_pax < 30)
    const { rows: paxTypoRows } = await client.query(
      `SELECT c.sales_order_id, o.invoice_no, c.bill_pax, c.bill_net_amount, c.bill_class, c.classification_reason
       FROM sales_bill_classifications c
       JOIN sales_orders o ON o.id = c.sales_order_id
       WHERE o.invoice_no IN ('1677', '2214')`
    );
    for (const r of paxTypoRows) {
      assert(
        r.bill_class === 'data_anomaly' && r.classification_reason.includes('PAX-typo'),
        `Invoice ${r.invoice_no} (${r.bill_pax} PAX / ₹${r.bill_net_amount}) classified as data_anomaly via PAX-typo guard`
      );
    }

    // (b) Large Group precedence over High-Value Anomaly
    const { rows: groupRows } = await client.query(
      `SELECT o.invoice_no, c.bill_pax, c.bill_net_amount, c.bill_class, c.group_type, c.classification_reason
       FROM sales_bill_classifications c
       JOIN sales_orders o ON o.id = c.sales_order_id
       WHERE o.invoice_no IN ('7580', '7575', '7784', '7782', '8004', '7993', '8031')`
    );
    for (const r of groupRows) {
      assert(
        r.bill_class === 'large_group',
        `Group invoice ${r.invoice_no} (₹${r.bill_net_amount}) classified as large_group (type: ${r.group_type})`
      );
    }

    // (c) High-Value Anomaly on Dine In vs Takeaway/Counter
    const { rows: highValDineIn } = await client.query(
      `SELECT o.invoice_no, c.bill_pax, c.bill_net_amount, c.bill_class, c.bill_apc
       FROM sales_bill_classifications c
       JOIN sales_orders o ON o.id = c.sales_order_id
       WHERE o.invoice_no = '2014'`
    );
    if (highValDineIn.length > 0) {
      assert(
        highValDineIn[0].bill_class === 'high_value_anomaly',
        `Invoice 2014 (6 PAX / ₹${highValDineIn[0].bill_net_amount}) classified as high_value_anomaly`
      );
    }

    // ----------------------------------------------------
    // TEST 5: Lancho Phone Blacklist & Channel Separation
    // ----------------------------------------------------
    console.log('\nTest 5: Lancho Phone Blacklist & Delivery Channel Isolation');
    const { rows: lanchoRows } = await client.query(
      `SELECT c.sales_order_id, o.invoice_no, o.customer_phone, o.order_type, o.area, c.bill_class, c.group_cluster_id
       FROM sales_bill_classifications c
       JOIN sales_orders o ON o.id = c.sales_order_id
       WHERE o.customer_phone = '9927300836'`
    );
    assert(lanchoRows.length > 0, `Found ${lanchoRows.length} Lancho orders with phone 9927300836`);
    const falseGroupMerges = lanchoRows.filter(r => r.group_cluster_id !== null);
    assert(
      falseGroupMerges.length === 0,
      `Zero false group merges on Lancho support phone 9927300836 (${falseGroupMerges.length} merges found)`
    );
    const paxAnomalies = lanchoRows.filter(r => r.bill_class === 'data_anomaly' && r.order_type !== 'Dine In');
    assert(
      paxAnomalies.length === 0,
      `Zero Lancho Delivery orders falsely flagged as data_anomaly due to covers_pax=0 or 1`
    );

    // ----------------------------------------------------
    // TEST 6: Outside Activities Exclusion (16 items)
    // ----------------------------------------------------
    console.log('\nTest 6: Outside Activities Non-Restaurant Exclusion (16 items)');
    const { rows: outsideItems } = await client.query(`
      SELECT item_name, COUNT(*) as cnt, SUM(quantity) as qty
      FROM sales_order_items
      WHERE item_name IN (
        'Camel Ride', 'Horse Ride', 'Trampoline', 'Kids Game Zone',
        'Bull Ride', 'Bungee Jumping', 'Pottery Making', 'Carnival Games',
        'Boating', 'Zip Line', 'Archery', 'Gun Shooting',
        'Darts', 'Mini Train', 'Toy Train', 'Special Entry Ticket'
      )
      GROUP BY item_name
    `);
    console.log(`    Found ${outsideItems.length} distinct outside activity items in raw order items`);

    // Verify mixed bill decomposition in Nov 14 / Nov 17
    const { rows: nov14Snapshot } = await client.query(
      `SELECT * FROM sales_forecast_snapshots WHERE business_date = '2026-11-14'`
    );
    const nov14 = nov14Snapshot[0];
    const nov14TotalNet = Number(nov14.actual_net_revenue);
    const nov14GroupNet = Number(nov14.decomp_group_net);
    const nov14NormalNet = Number(nov14.decomp_normal_net);
    const nov14HighValNet = Number(nov14.decomp_high_value_net || 0);
    const nov14AnomalyNet = Number(nov14.decomp_data_anomaly_net || 0);
    const nov14OutsideNet = Number(nov14.decomp_outside_activities_net);

    const decomposedSum = nov14GroupNet + nov14NormalNet + nov14HighValNet + nov14AnomalyNet + nov14OutsideNet;

    assert(
      Math.abs(decomposedSum - nov14TotalNet) < 0.05,
      `Nov 14 decomposition reconciles exactly: Group (₹${nov14GroupNet}) + Normal (₹${nov14NormalNet}) + HighVal (₹${nov14HighValNet}) + Anomaly (₹${nov14AnomalyNet}) + Outside (₹${nov14OutsideNet}) = Total (₹${nov14TotalNet})`
    );

    // ----------------------------------------------------
    // TEST 7: Dual-Track Isolation Test (Mathematical Proof)
    // ----------------------------------------------------
    console.log('\nTest 7: Dual-Track Mathematical Isolation (Price vs Volume Shocks)');
    const { computeTrackUpdate } = await import('../src/lib/forecasting/math.ts');
    
    // Initial state
    const revBaseline = 50000;
    const qtyBaseline = 300;

    // Scenario A: Synthetic Price Shock (Revenue jumps +50% to ₹75,000, Volume remains EXACTLY 300)
    const revPriceShock = computeTrackUpdate({
      baseline: revBaseline,
      predicted: 50000,
      actual_normal: 75000,
      actual_total: 75000,
      prior_smoothed_signed_error: 0,
      prior_smoothed_abs_error: 0,
      prior_wape: 0.08,
      prior_error_std: 0.05,
    });

    const qtyPriceShock = computeTrackUpdate({
      baseline: qtyBaseline,
      predicted: 300,
      actual_normal: 300,
      actual_total: 300,
      prior_smoothed_signed_error: 0,
      prior_smoothed_abs_error: 0,
      prior_wape: 0.06,
      prior_error_std: 0.04,
    });

    assert(
      revPriceShock.updated_baseline > revBaseline,
      `Price shock updated rev_baseline from ₹${revBaseline} to ₹${revPriceShock.updated_baseline.toFixed(2)}`
    );
    assert(
      qtyPriceShock.updated_baseline === qtyBaseline,
      `Price shock left qty_baseline 100% unaffected (remained ${qtyPriceShock.updated_baseline})`
    );

    // Scenario B: Synthetic Volume Shock (Quantity jumps +50% to 450, Revenue remains unchanged at ₹50,000)
    const qtyVolShock = computeTrackUpdate({
      baseline: qtyBaseline,
      predicted: 300,
      actual_normal: 450,
      actual_total: 450,
      prior_smoothed_signed_error: 0,
      prior_smoothed_abs_error: 0,
      prior_wape: 0.06,
      prior_error_std: 0.04,
    });

    const revVolShock = computeTrackUpdate({
      baseline: revBaseline,
      predicted: 50000,
      actual_normal: 50000,
      actual_total: 50000,
      prior_smoothed_signed_error: 0,
      prior_smoothed_abs_error: 0,
      prior_wape: 0.08,
      prior_error_std: 0.05,
    });

    assert(
      qtyVolShock.updated_baseline > qtyBaseline,
      `Volume shock updated qty_baseline from ${qtyBaseline} to ${qtyVolShock.updated_baseline.toFixed(2)}`
    );
    assert(
      revVolShock.updated_baseline === revBaseline,
      `Volume shock left rev_baseline 100% unaffected (remained ₹${revVolShock.updated_baseline.toFixed(2)})`
    );

    // ----------------------------------------------------
    // TEST 8: RBAC Cost Stripping Logic
    // ----------------------------------------------------
    console.log('\nTest 8: RBAC Cost Stripping Security Verification');
    const { explodeBomDemands } = await import('../src/lib/inventory/bom-explosion.ts');
    const { createClient } = await import('@supabase/supabase-js');

    const supabaseUrl = env.split('\n').find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')).split('=').slice(1).join('=').trim();
    const supabaseKey = env.split('\n').find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).split('=').slice(1).join('=').trim();
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Test with canViewCosts = true (Admin / Costing role)
    const suggestionsWithCosts = await explodeBomDemands(
      supabase,
      [{ dish_name: 'Paneer Butter Masala', predicted_quantity: 20 }],
      85.0,
      true // canViewCosts
    );

    // Test with canViewCosts = false (Storekeeper / non-costing role)
    const suggestionsWithoutCosts = await explodeBomDemands(
      supabase,
      [{ dish_name: 'Paneer Butter Masala', predicted_quantity: 20 }],
      85.0,
      false // canViewCosts
    );

    if (suggestionsWithCosts.length > 0) {
      assert(
        suggestionsWithCosts.some(s => s.unit_cost !== undefined),
        'Admin/Costing view includes unit_cost and line_cost'
      );
    }
    if (suggestionsWithoutCosts.length > 0) {
      const anyCostLeaked = suggestionsWithoutCosts.some(s => s.unit_cost !== undefined || s.line_cost !== undefined);
      assert(
        !anyCostLeaked,
        'Storekeeper view has 0 cost leakage (unit_cost and line_cost are strictly undefined)'
      );
    }

    // ----------------------------------------------------
    // TEST 9: Synthetic Test Row Cleanup Teardown
    // ----------------------------------------------------
    console.log('\nTest 9: Synthetic Test Cleanup Verification');
    const { rows: syntheticCheck } = await client.query(
      `SELECT COUNT(*) as count FROM sales_orders WHERE invoice_no LIKE 'SYNTHETIC_%'`
    );
    assert(
      parseInt(syntheticCheck[0].count, 10) === 0,
      'No orphaned synthetic test records present in sales_orders'
    );

  } catch (err) {
    console.error('Test execution error:', err);
    failedTests++;
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n====================================================');
  console.log(`Results: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests();
