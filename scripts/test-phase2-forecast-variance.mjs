import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(idxOrEnd(trimmed, eqIdx)).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
function idxOrEnd(s, idx) {
  return idx + 1;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

  try {
    // ----------------------------------------------------
    // TEST 1: 100% Bill Accounting & Classification Coverage
    // ----------------------------------------------------
    console.log('Test 1: 100% Bill Preservation & Accounting Coverage');
    const [{ count: totalOrders }, { count: totalClassified }, { count: totalSnapshots }] = await Promise.all([
      supabase.from('sales_orders').select('*', { count: 'exact', head: true }),
      supabase.from('sales_bill_classifications').select('*', { count: 'exact', head: true }),
      supabase.from('sales_forecast_snapshots').select('*', { count: 'exact', head: true }),
    ]);

    assert((totalOrders || 0) >= 8864, `Raw sales orders count is >= 8,864 (actual: ${totalOrders})`);
    assert(totalClassified === totalOrders, `Classified bills count (${totalClassified}) exactly equals raw orders count (${totalOrders})`);
    const totalDistinctDates = totalSnapshots || 0;

    // ----------------------------------------------------
    // TEST 2: Status Exclusion (Cancelled vs Complimentary)
    // ----------------------------------------------------
    console.log('\nTest 2: Status Exclusion (Cancelled vs Complimentary)');
    const [{ count: cancelledCount }, { count: compCount }] = await Promise.all([
      supabase.from('sales_bill_classifications').select('*', { count: 'exact', head: true }).eq('bill_class', 'cancelled'),
      supabase.from('sales_orders').select('*', { count: 'exact', head: true }).eq('status', 'Complimentary'),
    ]);

    assert(cancelledCount === 54, `Exactly 54 Cancelled bills classified as 'cancelled' (actual: ${cancelledCount})`);
    assert((compCount || 0) >= 133, `Raw Complimentary orders count is >= 133 (actual: ${compCount})`);

    const { data: nov17 } = await supabase
      .from('sales_forecast_snapshots')
      .select('*')
      .eq('business_date', '2026-11-17')
      .maybeSingle();

    assert(Boolean(nov17), 'Nov 17, 2026 snapshot exists');
    if (nov17) {
      const nov17FoodRev = Number(nov17.actual_net_revenue);
      const nov17OutsideRev = Number(nov17.decomp_outside_activities_net || 0);
      const nov17PetpoojaTotal = Number(
        nov17.learning_summary_json?.total_petpooja_net_revenue ?? (nov17FoodRev + nov17OutsideRev)
      );
      const nov17CompMenuVal = Number(nov17.decomp_complimentary_menu_value);
      const nov17ActualPax = Number(nov17.actual_pax);
      const nov17BillsCount = Number(nov17.actual_orders);

      assert(
        Math.abs(nov17PetpoojaTotal - 91521.87) < 0.05 && Math.abs((nov17FoodRev + nov17OutsideRev) - 91521.87) < 0.05,
        `Nov 17 Kitchen Food (₹${nov17FoodRev}) + Outside Act (₹${nov17OutsideRev}) reconciles exactly to ₹91,521.87`
      );
      assert(nov17CompMenuVal === 4844.85, `Nov 17 complimentary menu value tracked at ₹4,844.85 (actual: ₹${nov17CompMenuVal})`);
      assert(nov17ActualPax === 321, `Nov 17 total PAX preserved in quantity track is 321 (318 success + 3 comp, actual: ${nov17ActualPax})`);
      assert(nov17BillsCount === 73, `Nov 17 total orders preserved in quantity track is 73 (71 success + 2 comp, actual: ${nov17BillsCount})`);
    }

    // ----------------------------------------------------
    // TEST 3: Nov 10 Sales Reality Check (Assert NOT 44524.28)
    // ----------------------------------------------------
    console.log('\nTest 3: Nov 10, 2026 Sales Reality (Assert NOT 44524.28)');
    const { data: nov10Orders } = await supabase
      .from('sales_orders')
      .select('net_sales, covers_pax')
      .eq('business_date', '2026-11-10');

    const nov10RawNet = Math.round((nov10Orders || []).reduce((s, r) => s + Number(r.net_sales || 0), 0) * 100) / 100;
    const nov10RawBills = (nov10Orders || []).length;
    const nov10RawPax = (nov10Orders || []).reduce((s, r) => s + Number(r.covers_pax || 0), 0);

    assert(nov10RawNet !== 44524.28, `Nov 10 net sales is NOT 44,524.28 (raw actual: ₹${nov10RawNet})`);
    assert(nov10RawNet === 64741.00, `Nov 10 raw net sales (Success + Complimentary) is exactly ₹64,741.00 (actual: ₹${nov10RawNet})`);
    assert(nov10RawBills === 63, `Nov 10 raw bills count is 63 (actual: ${nov10RawBills})`);
    assert(nov10RawPax === 221, `Nov 10 raw PAX count is 221 (actual: ${nov10RawPax})`);

    const { data: nov10Snap } = await supabase
      .from('sales_forecast_snapshots')
      .select('*')
      .eq('business_date', '2026-11-10')
      .maybeSingle();

    assert(Boolean(nov10Snap), 'Nov 10, 2026 snapshot exists');
    if (nov10Snap) {
      const nov10TotalReconciled = Math.round((Number(nov10Snap.actual_net_revenue) + Number(nov10Snap.decomp_outside_activities_net || 0)) * 100) / 100;
      assert(nov10TotalReconciled === 64146.00, `Nov 10 Kitchen Food + Outside reconciled revenue is ₹64,146.00 with ₹0 comp revenue (actual: ₹${nov10TotalReconciled})`);
      assert(Number(nov10Snap.decomp_complimentary_menu_value) === 595.00, `Nov 10 complimentary menu value is ₹595.00 (actual: ₹${nov10Snap.decomp_complimentary_menu_value})`);
      assert(Number(nov10Snap.actual_orders) === 63, `Nov 10 total orders preserved is 63 (actual: ${nov10Snap.actual_orders})`);
      assert(Number(nov10Snap.actual_pax) === 221, `Nov 10 total PAX preserved is 221 (actual: ${nov10Snap.actual_pax})`);
    }

    // ----------------------------------------------------
    // TEST 4: Bill Classification Precedence & Edge Cases
    // ----------------------------------------------------
    console.log('\nTest 4: Bill Classification Precedence & Edge Cases');
    const targetInvoices = ['1677', '2214', '7580', '7575', '7784', '7782', '8004', '7993', '8031', '2014'];
    const { data: invClassRows } = await supabase
      .from('sales_bill_classifications')
      .select(`
        bill_pax, bill_net_amount, bill_class, group_type, bill_apc, classification_reason,
        order:sales_orders!sales_bill_classifications_sales_order_id_fkey!inner(invoice_no)
      `)
      .in('order.invoice_no', targetInvoices);

    for (const r of invClassRows || []) {
      const invNo = r.order?.invoice_no;
      if (['1677', '2214'].includes(invNo)) {
        assert(
          r.bill_class === 'data_anomaly' && String(r.classification_reason).includes('PAX-typo'),
          `Invoice ${invNo} (${r.bill_pax} PAX / ₹${r.bill_net_amount}) classified as data_anomaly via PAX-typo guard`
        );
      } else if (['7580', '7575', '7784', '7782', '8004', '7993', '8031'].includes(invNo)) {
        assert(
          r.bill_class === 'large_group',
          `Group invoice ${invNo} (₹${r.bill_net_amount}) classified as large_group (type: ${r.group_type})`
        );
      } else if (invNo === '2014') {
        assert(
          r.bill_class === 'high_value_anomaly',
          `Invoice 2014 (6 PAX / ₹${r.bill_net_amount}) classified as high_value_anomaly`
        );
      }
    }

    // ----------------------------------------------------
    // TEST 5: Lancho Phone Blacklist & Channel Separation
    // ----------------------------------------------------
    console.log('\nTest 5: Lancho Phone Blacklist & Delivery Channel Isolation');
    const { data: lanchoRows } = await supabase
      .from('sales_bill_classifications')
      .select(`
        sales_order_id, bill_class, group_cluster_id,
        order:sales_orders!sales_bill_classifications_sales_order_id_fkey!inner(invoice_no, customer_phone, order_type, area)
      `)
      .eq('order.customer_phone', '9927300836');

    assert((lanchoRows || []).length > 0, `Found ${(lanchoRows || []).length} Lancho orders with phone 9927300836`);
    const falseGroupMerges = (lanchoRows || []).filter((r) => r.group_cluster_id !== null);
    assert(
      falseGroupMerges.length === 0,
      `Zero false group merges on Lancho support phone 9927300836 (${falseGroupMerges.length} merges found)`
    );
    const paxAnomalies = (lanchoRows || []).filter((r) => r.bill_class === 'data_anomaly' && r.order?.order_type !== 'Dine In');
    assert(
      paxAnomalies.length === 0,
      `Zero Lancho Delivery orders falsely flagged as data_anomaly due to covers_pax=0 or 1`
    );

    // ----------------------------------------------------
    // TEST 6: Outside Activities Exclusion (16 items)
    // ----------------------------------------------------
    console.log('\nTest 6: Outside Activities Non-Restaurant Exclusion (16 items)');
    const { data: nov14 } = await supabase
      .from('sales_forecast_snapshots')
      .select('*')
      .eq('business_date', '2026-11-14')
      .maybeSingle();

    if (nov14) {
      const nov14TotalNet = Number(nov14.actual_net_revenue);
      const nov14GroupNet = Number(nov14.decomp_group_net);
      const nov14NormalNet = Number(nov14.decomp_normal_net);
      const nov14HighValNet = Number(nov14.decomp_high_value_net || 0);
      const nov14AnomalyNet = Number(nov14.decomp_data_anomaly_net || 0);
      const nov14OutsideNet = Number(nov14.decomp_outside_activities_net);
      const nov14FoodSum = nov14GroupNet + nov14NormalNet + nov14HighValNet + nov14AnomalyNet;
      const nov14PetpoojaTotal = Number(
        nov14.learning_summary_json?.total_petpooja_net_revenue ?? (nov14TotalNet + nov14OutsideNet)
      );

      assert(
        Math.abs(nov14FoodSum - nov14TotalNet) < 0.05,
        `Nov 14 Kitchen Food decomposition reconciles exactly: Group (₹${nov14GroupNet}) + Normal (₹${nov14NormalNet}) + HighVal (₹${nov14HighValNet}) + Anomaly (₹${nov14AnomalyNet}) = Food Actual (₹${nov14TotalNet})`
      );
      assert(
        Math.abs((nov14TotalNet + nov14OutsideNet) - nov14PetpoojaTotal) < 0.05,
        `Nov 14 Kitchen Food + Outside Activities (₹${nov14OutsideNet}) reconciles to Petpooja Total (₹${nov14PetpoojaTotal})`
      );
    }

    // ----------------------------------------------------
    // TEST 7: Dual-Track Isolation Test (Mathematical Proof)
    // ----------------------------------------------------
    console.log('\nTest 7: Dual-Track Mathematical Isolation (Price vs Volume Shocks)');
    const { computeTrackUpdate } = await import('../src/lib/forecasting/math.ts');

    const revBaseline = 50000;
    const qtyBaseline = 300;

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

    assert(revPriceShock.updated_baseline > revBaseline, `Price shock updated rev_baseline from ₹${revBaseline} to ₹${revPriceShock.updated_baseline.toFixed(2)}`);
    assert(qtyPriceShock.updated_baseline === qtyBaseline, `Price shock left qty_baseline 100% unaffected (remained ${qtyPriceShock.updated_baseline})`);

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

    assert(qtyVolShock.updated_baseline > qtyBaseline, `Volume shock updated qty_baseline from ${qtyBaseline} to ${qtyVolShock.updated_baseline.toFixed(2)}`);
    assert(revVolShock.updated_baseline === revBaseline, `Volume shock left rev_baseline 100% unaffected (remained ₹${revVolShock.updated_baseline.toFixed(2)})`);

    // ----------------------------------------------------
    // TEST 8: RBAC Cost Stripping Logic
    // ----------------------------------------------------
    console.log('\nTest 8: RBAC Cost Stripping Security Verification');
    const { explodeBomDemands } = await import('../src/lib/inventory/bom-explosion.ts');

    const suggestionsWithCosts = await explodeBomDemands(
      supabase,
      [{ dish_name: 'Dal Makhani', predicted_quantity: 20 }],
      85.0,
      true
    );
    const suggestionsWithoutCosts = await explodeBomDemands(
      supabase,
      [{ dish_name: 'Dal Makhani', predicted_quantity: 20 }],
      85.0,
      false
    );

    assert(suggestionsWithCosts.length > 0, `BOM explosion generated suggestions (count: ${suggestionsWithCosts.length})`);
    if (suggestionsWithCosts.length > 0) {
      assert(suggestionsWithCosts.some((s) => s.unit_cost !== undefined), 'Admin/Costing view includes unit_cost and line_cost');
    }
    if (suggestionsWithoutCosts.length > 0) {
      const anyCostLeaked = suggestionsWithoutCosts.some((s) => s.unit_cost !== undefined || s.line_cost !== undefined);
      assert(!anyCostLeaked, 'Storekeeper view has 0 cost leakage (unit_cost and line_cost are strictly undefined)');
    }

    // ----------------------------------------------------
    // TEST 9: Synthetic Test Cleanup Verification
    // ----------------------------------------------------
    console.log('\nTest 9: Synthetic Test Cleanup Verification');
    const { count: syntheticCnt } = await supabase
      .from('sales_orders')
      .select('*', { count: 'exact', head: true })
      .like('invoice_no', 'SYNTHETIC_%');
    assert((syntheticCnt || 0) === 0, 'No orphaned synthetic test records present in sales_orders');

    // ----------------------------------------------------
    // TEST 10: Zero-Price Bill Classification Anomaly Unit Test
    // ----------------------------------------------------
    console.log('\nTest 10: Zero-Price Bill Classification Anomaly Unit Test');
    const { classifyBill, DEFAULT_THRESHOLDS } = await import('../src/lib/forecasting/bill-classifier.ts');

    const unexplainedZeroOrder = {
      id: 'test-zero-unexplained',
      business_date: '2026-11-20',
      invoice_no: '999999',
      status: 'Success',
      order_type: 'Dine In',
      area: 'Restaurant',
      covers_pax: 2,
      gross_amount: 0,
      net_sales: 0,
      items: [{ item_name: 'Butter Naan', quantity: 2, net_sales: 0 }],
    };
    const unexplainedClass = classifyBill(unexplainedZeroOrder, DEFAULT_THRESHOLDS);
    assert(unexplainedClass.bill_class === 'data_anomaly', `Unexplained zero-net Success order classified as data_anomaly (actual: ${unexplainedClass.bill_class})`);

    const driverMitraOrder = {
      id: 'test-driver-mitra',
      business_date: '2026-11-20',
      invoice_no: '999998',
      status: 'Success',
      order_type: 'Dine In',
      area: 'Restaurant',
      covers_pax: 1,
      gross_amount: 0,
      net_sales: 0,
      items: [{ item_name: 'Driver Mitra Thali', quantity: 1, net_sales: 0 }],
    };
    const driverClass = classifyBill(driverMitraOrder, DEFAULT_THRESHOLDS);
    assert(driverClass.bill_class === 'normal', `Known complimentary zero-net order classified as normal (actual: ${driverClass.bill_class})`);

    // ----------------------------------------------------
    // TEST 11: Dynamic Category Derivation & Clean Normal Mix Isolation
    // ----------------------------------------------------
    console.log('\nTest 11: Category Mix Learning & Clean Normal Mix Isolation');
    const { data: modelStates } = await supabase
      .from('sales_forecast_model_state')
      .select('day_of_week, category_volume_mix_json, category_revenue_mix_json, dish_volume_mix_json');

    assert((modelStates || []).length === 7, `All 7 days of week model states present (actual: ${(modelStates || []).length})`);

    let hasNonEmptyCatVol = false;
    let hasNonEmptyCatRev = false;
    let leakedGroupDish = false;
    for (const ms of modelStates || []) {
      const volKeys = Object.keys(ms.category_volume_mix_json || {});
      const revKeys = Object.keys(ms.category_revenue_mix_json || {});
      const dishKeys = Object.keys(ms.dish_volume_mix_json || {});
      if (volKeys.length > 0) hasNonEmptyCatVol = true;
      if (revKeys.length > 0) hasNonEmptyCatRev = true;
      if (dishKeys.some((k) => k.toLowerCase().includes('school picnic'))) {
        leakedGroupDish = true;
      }
      if (volKeys.includes('Group Packages')) {
        leakedGroupDish = true;
      }
    }
    assert(hasNonEmptyCatVol, 'category_volume_mix_json populated across model states');
    assert(hasNonEmptyCatRev, 'category_revenue_mix_json populated across model states');
    assert(!leakedGroupDish, 'School Picnic / Group Packages cleanly excluded from normal weekday dish & category mixes');

    const { data: schoolProfile } = await supabase
      .from('sales_forecast_group_profiles')
      .select('*')
      .eq('group_type', 'school_group')
      .maybeSingle();

    const schoolMixKeys = Object.keys(schoolProfile?.typical_dish_mix_json || {});
    assert(
      schoolMixKeys.some((k) => k.toLowerCase().includes('school picnic')),
      `school_group profile captures School Picnic dish mix (${schoolMixKeys.join(', ')})`
    );

    const nov17Cats = Array.isArray(nov17?.actual_categories_json) ? nov17.actual_categories_json : [];
    assert(
      nov17Cats.some((c) => c.category === 'Group Packages'),
      `Nov 17 snapshot categorizes School Picnic items as 'Group Packages'`
    );

    const { data: allSnaps } = await supabase
      .from('sales_forecast_snapshots')
      .select('business_date, actual_categories_json, event_rev_multiplier_used, event_qty_multiplier_used');

    const snapsWithCats = (allSnaps || []).filter(
      (s) => Array.isArray(s.actual_categories_json) && s.actual_categories_json.length > 0
    );
    assert(
      snapsWithCats.length === totalDistinctDates,
      `All ${totalDistinctDates} snapshots have non-empty actual_categories_json (actual: ${snapsWithCats.length})`
    );

    // ----------------------------------------------------
    // TEST 12: Event Multipliers Verification
    // ----------------------------------------------------
    console.log('\nTest 12: Snapshot Multipliers Verification');
    const snapsWithMults = (allSnaps || []).filter(
      (s) => s.event_rev_multiplier_used != null && s.event_qty_multiplier_used != null
    );
    assert(
      snapsWithMults.length === totalDistinctDates,
      `All ${totalDistinctDates} snapshots have valid event_rev_multiplier_used and event_qty_multiplier_used (actual: ${snapsWithMults.length})`
    );

    // ----------------------------------------------------
    // TEST 13: Real BOM Explosion & Movement vs Count-Bounded Variance Modes
    // ----------------------------------------------------
    console.log('\nTest 13: BOM Explosion & Movement-Based vs Count-Bounded Variance Modes');
    const { calculateInventoryVariance } = await import('../src/lib/inventory/variance.ts');

    const mReport = await calculateInventoryVariance(supabase, '2026-11-01', '2026-11-22', 'movement_based', true);
    assert(mReport.mode === 'movement_based', `movement_based report generated with mode: ${mReport.mode}`);
    assert(mReport.items.length > 0, `movement_based report exploded real BOM variance items for Nov 1-22 (count: ${mReport.items.length})`);
    assert(mReport.items.some((i) => i.theoretical_consumption > 0), 'At least one item has non-zero theoretical_consumption');

    const cReport = await calculateInventoryVariance(supabase, '2026-11-01', '2026-11-22', 'count_bounded', true);
    assert(cReport.mode === 'count_bounded', `count_bounded report generated with mode: ${cReport.mode}`);
    assert(cReport.items.length > 0, `count_bounded report returned BOM variance items (count: ${cReport.items.length})`);
    assert(
      cReport.count_pending_count > 0 && cReport.items.every((i) => i.count_status === 'count_pending' && i.actual_consumption === 0),
      `count_bounded honestly badges uncounted items as count_pending with 0 fabricated purchases-as-usage (${cReport.count_pending_count} pending)`
    );

    // ----------------------------------------------------
    // TEST 14: Live Route RBAC Test (GET /api/inventory/variance for Admin 200 vs Storekeeper 403)
    // ----------------------------------------------------
    console.log('\nTest 14: Live Route RBAC Verification (GET /api/inventory/variance)');
    process.env.ENABLE_TEST_AUTH_OVERRIDE = 'true';

    const { NextRequest } = await import('next/server.js');
    const { GET: getVariance } = await import('../src/app/api/inventory/variance/route.ts');

    const ADMIN_USER_ID = '7628b8c9-8222-493d-9757-9744ad209ce4'; // Nirakh (Admin)
    const STOREKEEPER_USER_ID = '0c4088b8-4d1e-4d06-8ece-8884f597316e'; // Rahul (Storekeeper)

    const adminReq = new NextRequest(
      'http://localhost:3000/api/inventory/variance?start_date=2026-11-01&end_date=2026-11-22&mode=movement_based',
      { headers: { 'x-test-user-id': ADMIN_USER_ID } }
    );
    const adminRes = await getVariance(adminReq);
    const adminBody = await adminRes.json();

    assert(adminRes.status === 200, `Admin GET /api/inventory/variance returns 200 OK (actual: ${adminRes.status})`);
    assert(
      adminBody.success === true && Array.isArray(adminBody.report?.items) && adminBody.report.items.length > 0,
      `Admin receives non-empty BOM variance report (items: ${adminBody.report?.items?.length})`
    );

    const skReq = new NextRequest(
      'http://localhost:3000/api/inventory/variance?start_date=2026-11-01&end_date=2026-11-22&mode=movement_based',
      { headers: { 'x-test-user-id': STOREKEEPER_USER_ID } }
    );
    const skRes = await getVariance(skReq);
    assert(skRes.status === 403, `Storekeeper GET /api/inventory/variance strictly returns 403 Forbidden (actual: ${skRes.status})`);

    // ----------------------------------------------------
    // TEST 15: Bill #8228 Override, Threshold Deduplication & Channel Reasons
    // ----------------------------------------------------
    console.log('\nTest 15: Bill #8228 PAX=12 Normal, #2014 Anomaly, Thresholds & Channel Reasons');
    const [{ data: b8228Order }, { data: b8228Class }, { data: b8228Edit }, { data: b8228Items }, { count: threshCnt }] =
      await Promise.all([
        supabase.from('sales_orders').select('id, covers_pax').eq('id', '7404e3dc-7791-4933-92e4-b958e1bdd3fc').single(),
        supabase.from('sales_bill_classifications').select('bill_class, bill_pax, bill_apc').eq('sales_order_id', '7404e3dc-7791-4933-92e4-b958e1bdd3fc').single(),
        supabase.from('sales_bill_manual_edits').select('override_covers_pax, is_active').eq('sales_order_id', '7404e3dc-7791-4933-92e4-b958e1bdd3fc').eq('is_active', true).maybeSingle(),
        supabase.from('sales_order_items').select('covers').eq('business_date', '2026-11-25').eq('invoice_no', '8228'),
        supabase.from('sales_bill_classification_thresholds').select('*', { count: 'exact', head: true }),
      ]);

    assert(b8228Order?.covers_pax === 12, `Bill #8228 covers_pax is 12 in sales_orders (actual: ${b8228Order?.covers_pax})`);
    assert(b8228Edit?.override_covers_pax === 12 && b8228Edit?.is_active === true, 'Bill #8228 has active sales_bill_manual_edits override = 12');
    assert(b8228Class?.bill_class === 'normal' && b8228Class?.bill_pax === 12, `Bill #8228 re-classified as normal at 12 PAX / ₹${b8228Class?.bill_apc} APC`);
    assert((b8228Items || []).length > 0 && (b8228Items || []).every((i) => i.covers === 12), 'All Bill #8228 sales_order_items synced to covers = 12');
    assert(threshCnt === 1, `sales_bill_classification_thresholds deduplicated to 1 clean row (actual: ${threshCnt})`);

    const { PATCH: patchBill } = await import('../src/app/api/finance/sales/bills/[id]/route.ts');
    const nonAdminPatchReq = new NextRequest(
      'http://localhost:3000/api/finance/sales/bills/7404e3dc-7791-4933-92e4-b958e1bdd3fc',
      {
        method: 'PATCH',
        headers: { 'x-test-user-id': STOREKEEPER_USER_ID, 'content-type': 'application/json' },
        body: JSON.stringify({ covers_pax: 10, reason: 'Unauthorized attempt' }),
      }
    );
    const nonAdminPatchRes = await patchBill(nonAdminPatchReq, {
      params: Promise.resolve({ id: '7404e3dc-7791-4933-92e4-b958e1bdd3fc' }),
    });
    assert(nonAdminPatchRes.status === 403, `Non-Admin PATCH /api/finance/sales/bills/[id] returns 403 Forbidden (actual: ${nonAdminPatchRes.status})`);

    // ----------------------------------------------------
    // TEST 16: Canonical Menu Merge Integrity & 5-Dal / Chilli Potato Rules
    // ----------------------------------------------------
    console.log('\nTest 16: Menu Merge Integrity, Canonical Rollup & Preserved Distinctions');
    const [
      { count: activeNsCount },
      { data: activeDItems },
      { data: keyItems },
      { data: aliasesCheck },
      { data: rpcSales },
    ] = await Promise.all([
      supabase.from('pos_menu_items').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('needs_setup', true),
      supabase.from('pos_menu_items').select('name').eq('is_active', true).ilike('name', '%[d]%'),
      supabase.from('pos_menu_items').select('id, name, is_active, needs_setup').in('name', [
        'Yellow Dal Fry', 'Yellow Dal Takda', 'Dal Makhani', 'Punjabi Dal Tadka', 'Dhaba Dal Tadka',
        'Chilli Potato', 'Honey Chilli Potato', 'Gondpak Halwa', 'Premium Thali', 'Jodhpuri Gatte Ri Sabzi', 'Buttermilk',
      ]),
      supabase.from('pos_menu_item_aliases').select('alias, menu_item:pos_menu_items!pos_menu_item_aliases_menu_item_id_fkey(name)'),
      supabase.rpc('get_menu_sales_aggregation', { p_date_from: null, p_date_to: null, p_channel: 'ALL' }),
    ]);

    assert(activeNsCount === 0, `Active needs_setup count is 0 (actual: ${activeNsCount})`);
    assert((activeDItems || []).length === 0, `Active [D] items count is 0 (actual: ${(activeDItems || []).length})`);

    const activeNamesSet = new Set((keyItems || []).filter((i) => i.is_active && !i.needs_setup).map((i) => i.name));
    assert(
      ['Yellow Dal Fry', 'Yellow Dal Takda', 'Dal Makhani', 'Punjabi Dal Tadka', 'Dhaba Dal Tadka'].every((n) => activeNamesSet.has(n)),
      'All 5 distinct Dals preserved active with needs_setup = false'
    );
    assert(
      activeNamesSet.has('Chilli Potato') && activeNamesSet.has('Honey Chilli Potato'),
      'Chilli Potato and Honey Chilli Potato preserved as distinct active items'
    );

    const aliasMapCheck = new Map((aliasesCheck || []).map((a) => [a.alias, a.menu_item?.name]));
    assert(aliasMapCheck.get('Halwa') === 'Gondpak Halwa', `Halwa alias resolves to Gondpak Halwa (actual: ${aliasMapCheck.get('Halwa')})`);
    assert(
      aliasMapCheck.get('Punjabi Premium Thali') === 'Premium Thali' &&
      aliasMapCheck.get('Yatra Premium Thali') === 'Premium Thali',
      'Punjabi Premium Thali & Yatra Premium Thali resolve cleanly to Premium Thali'
    );

    const buttermilkRow = (keyItems || []).find((i) => i.name === 'Buttermilk');
    const rpcById = new Map((rpcSales || []).map((r) => [r.menu_item_id, r]));
    const buttermilkSales = buttermilkRow ? rpcById.get(buttermilkRow.id) : null;
    assert(Boolean(buttermilkSales) && Number(buttermilkSales.units_sold) > 0, `get_menu_sales_aggregation rolls up Buttermilk cleanly (units: ${buttermilkSales?.units_sold})`);

    const gattaRow = (keyItems || []).find((i) => i.name === 'Jodhpuri Gatte Ri Sabzi');
    const { data: gattaVariants } = gattaRow
      ? await supabase.from('yatra_menu_item_variants').select('id, is_active').eq('menu_item_id', gattaRow.id)
      : { data: [] };
    assert((gattaVariants || []).length > 0, 'Jodhpuri Gatte Ri Sabzi owns moved Gatta Curry recipe variant');

    // ----------------------------------------------------
    // TEST 17: Normalized Dish Mix, Headline Sign Parity & Mapped Volume Cap
    // ----------------------------------------------------
    console.log('\nTest 17: Normalized Dish Shares, Sign Parity & Mapped Volume <= Predicted Total Units');
    const { generateDayForecast } = await import('../src/lib/forecasting/engine.ts');
    const { data: fullModelStates } = await supabase.from('sales_forecast_model_state').select('*');

    let badMixSum = false;
    let badForecastCap = false;
    let leakedDishName = false;
    for (const ms of fullModelStates || []) {
      const sharesSum = Object.values(ms.dish_volume_mix_json || {}).reduce((acc, v) => acc + Number(v?.share || 0), 0);
      if (sharesSum > 1.01 || sharesSum < 0.98) badMixSum = true;
      if (Object.keys(ms.dish_volume_mix_json || {}).some((k) => /\s*\[d\]$/i.test(k) || /^test item$/i.test(k))) {
        leakedDishName = true;
      }
      const fc = generateDayForecast('2026-11-26', ms, null, undefined, null);
      const mappedQtySum = fc.dishes.reduce((acc, d) => acc + Number(d.predicted_quantity || 0), 0);
      if (mappedQtySum > fc.predicted_total_units + 0.05) badForecastCap = true;
    }
    assert(!badMixSum, 'All 7 DOW dish_volume_mix_json share sums normalized cleanly to ~1.00');
    assert(!leakedDishName, 'Zero [D] or Test Item entries present in dish_volume_mix_json');
    assert(!badForecastCap, 'SUM(dishes.predicted_quantity) <= predicted_total_units on all 7 DOWs');

    const { data: snapParityRows } = await supabase
      .from('sales_forecast_snapshots')
      .select('business_date, predicted_net_revenue, actual_net_revenue, signed_rev_error, predicted_total_units, actual_total_units, signed_unit_error');
    const signMismatch = (snapParityRows || []).filter((s) => {
      const revDiff = Number(s.actual_net_revenue || 0) - Number(s.predicted_net_revenue || 0);
      const unitDiff = Number(s.actual_total_units || 0) - Number(s.predicted_total_units || 0);
      return Math.abs(revDiff - Number(s.signed_rev_error || 0)) > 0.1 || Math.abs(unitDiff - Number(s.signed_unit_error || 0)) > 0.2;
    });
    assert(signMismatch.length === 0, `100% of ${totalDistinctDates} snapshots have headline signed_rev_error & signed_unit_error matching Displayed Actual - Predicted`);
  } catch (err) {
    console.error('Test execution error:', err);
    failedTests++;
  }

  console.log('\n====================================================');
  console.log(`Results: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests();
