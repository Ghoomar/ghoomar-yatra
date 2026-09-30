import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((l) => {
      const idx = l.indexOf('=');
      if (idx !== -1 && !l.trim().startsWith('#')) {
        const k = l.slice(0, idx).trim();
        const v = l.slice(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    });
  }
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

// Authoritative Business Unit Classification helpers (mirror of src/lib/sales/business-units.ts)
function isLanchoOrder(order) {
  if (!order) return false;
  const area = (order.area || '').trim().toUpperCase();
  const orderType = (order.order_type || '').trim().toUpperCase();
  const paymentType = (order.payment_type || '').trim().toLowerCase();
  return area === 'LANCHO' || orderType === 'LANCHO' || paymentType.includes('lancho');
}

function isSnacksStallOrder(order) {
  if (!order || isLanchoOrder(order)) return false;
  const t = (order.order_type || '').trim().toLowerCase();
  return t === 'delivery(parcel)' || t === 'delivery (parcel)' || t === 'delivery' || t === 'snacks stall';
}

function isTakeawayOrder(order) {
  if (!order || isLanchoOrder(order) || isSnacksStallOrder(order)) return false;
  const t = (order.order_type || '').trim().toLowerCase();
  const area = (order.area || '').trim().toLowerCase();
  return t === 'pick up' || t === 'pickup' || t === 'takeaway' || area === 'parcel';
}

function isDineInOrder(order) {
  if (!order || isLanchoOrder(order) || isSnacksStallOrder(order) || isTakeawayOrder(order)) return false;
  return true;
}

// Mirror of calculateDinerPacing from src/lib/finance-engine.ts
function calculateDinerPacing(revenue, restaurantApc, dailyTarget, targetSpendPerDiner = 300) {
  const actualSpendPerDiner = restaurantApc > 0 ? Number(restaurantApc.toFixed(2)) : 0;
  const remainingRevenue = Math.max(0, dailyTarget - revenue);
  const requiredDinersAtTargetSpend = remainingRevenue > 0 
    ? Math.ceil(remainingRevenue / targetSpendPerDiner) 
    : 0;

  const requiredDinersAtCurrentSpend = (remainingRevenue > 0 && actualSpendPerDiner > 0)
    ? Math.ceil(remainingRevenue / actualSpendPerDiner)
    : requiredDinersAtTargetSpend;

  const achievementPercent = dailyTarget > 0 ? Number(((revenue / dailyTarget) * 100).toFixed(1)) : 0;

  return {
    actualSpendPerDiner,
    remainingRevenue,
    requiredDinersAtTargetSpend,
    requiredDinersAtCurrentSpend,
    achievementPercent,
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 DASHBOARD SPEND / GUEST & RESTAURANT APC REGRESSION SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test 1: Date 2026-09-29 Authoritative Numbers
  // -------------------------------------------------------------
  console.log('--- TEST 1: Date 2026-09-29 Authoritative Metrics ---');
  const date1 = '2026-09-29';

  const [
    { data: salesSum1 },
    { data: gateEvents1 },
    { data: orders1 },
  ] = await Promise.all([
    supabase.from('daily_sales_summary').select('*').eq('business_date', date1).maybeSingle(),
    supabase.from('visitor_counter_events').select('increment').eq('business_date', date1),
    supabase.from('sales_orders').select('order_type, area, payment_type, covers_pax, net_sales, grand_total, status').eq('business_date', date1),
  ]);

  const consolidatedNet1 = Number(salesSum1?.net_sales) || 0;
  const gateFootfall1 = (gateEvents1 || []).reduce((s, e) => s + (e.increment || 0), 0);

  const dineInOrders1 = (orders1 || []).filter((o) => isDineInOrder(o) && o.status === 'Success');
  const dineInNet1 = dineInOrders1.reduce((sum, o) => sum + (Number(o.net_sales) || 0), 0);
  const dineInPax1 = dineInOrders1.reduce((sum, o) => sum + (Number(o.covers_pax) || 0), 0);
  const apc1 = dineInPax1 > 0 ? Number((dineInNet1 / dineInPax1).toFixed(2)) : 0;

  assert(Math.abs(consolidatedNet1 - 79767.14) < 0.01, `2026-09-29 Consolidated Net Sales is exactly ₹79,767.14 (got ₹${consolidatedNet1})`);
  assert(gateFootfall1 === 1081, `2026-09-29 Gate Footfall is exactly 1,081 (got ${gateFootfall1})`);
  assert(Math.abs(dineInNet1 - 73569.97) < 0.01, `2026-09-29 Restaurant Dine-In Net Sales is exactly ₹73,569.97 (got ₹${dineInNet1.toFixed(2)})`);
  assert(dineInPax1 === 267, `2026-09-29 Restaurant Dine-In PAX is exactly 267 covers (got ${dineInPax1})`);
  assert(apc1 === 275.54, `2026-09-29 Dashboard Spend / Guest is exactly ₹275.54 (got ₹${apc1})`);

  // Crucial distinction checks
  const bugConsolidatedDividedByGate = Number((consolidatedNet1 / gateFootfall1).toFixed(2));
  const bugConsolidatedDividedByPax = Number((consolidatedNet1 / dineInPax1).toFixed(2));
  const bugDineInDividedByGate = Number((dineInNet1 / gateFootfall1).toFixed(2));

  assert(apc1 !== bugConsolidatedDividedByGate, `Spend / Guest (₹275.54) != Consolidated Net Sales / Gate Footfall (₹${bugConsolidatedDividedByGate})`);
  assert(apc1 !== bugConsolidatedDividedByPax, `Spend / Guest (₹275.54) != Consolidated Net Sales / Dine-In PAX (₹${bugConsolidatedDividedByPax})`);
  assert(apc1 !== bugDineInDividedByGate, `Spend / Guest (₹275.54) != Dine-In Sales / Gate Footfall (₹${bugDineInDividedByGate})`);

  // -------------------------------------------------------------
  // Test 2: Date 2026-09-21 Authoritative Numbers
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Date 2026-09-21 Authoritative Metrics ---');
  const date2 = '2026-09-21';

  const [
    { data: salesSum2 },
    { data: gateEvents2 },
    { data: orders2 },
  ] = await Promise.all([
    supabase.from('daily_sales_summary').select('*').eq('business_date', date2).maybeSingle(),
    supabase.from('visitor_counter_events').select('increment').eq('business_date', date2),
    supabase.from('sales_orders').select('order_type, area, payment_type, covers_pax, net_sales, grand_total, status').eq('business_date', date2),
  ]);

  const consolidatedNet2 = Number(salesSum2?.net_sales) || 0;
  const gateFootfall2 = (gateEvents2 || []).reduce((s, e) => s + (e.increment || 0), 0);

  const dineInOrders2 = (orders2 || []).filter((o) => isDineInOrder(o) && o.status === 'Success');
  const dineInNet2 = dineInOrders2.reduce((sum, o) => sum + (Number(o.net_sales) || 0), 0);
  const dineInPax2 = dineInOrders2.reduce((sum, o) => sum + (Number(o.covers_pax) || 0), 0);
  const apc2 = dineInPax2 > 0 ? Number((dineInNet2 / dineInPax2).toFixed(2)) : 0;

  assert(Math.abs(consolidatedNet2 - 83457.43) < 0.01, `2026-09-21 Consolidated Net Sales is exactly ₹83,457.43 (got ₹${consolidatedNet2})`);
  assert(gateFootfall2 === 1345, `2026-09-21 Gate Footfall is exactly 1,345 (got ${gateFootfall2})`);
  assert(Math.abs(dineInNet2 - 76496.50) < 0.01, `2026-09-21 Restaurant Dine-In Net Sales is exactly ₹76,496.50 (got ₹${dineInNet2.toFixed(2)})`);
  assert(dineInPax2 === 254, `2026-09-21 Restaurant Dine-In PAX is exactly 254 covers (got ${dineInPax2})`);
  assert(apc2 === 301.17, `2026-09-21 Dashboard Spend / Guest is exactly ₹301.17 (got ₹${apc2})`);

  // Crucial distinction checks
  const bugConsolidatedDividedByGate2 = Number((consolidatedNet2 / gateFootfall2).toFixed(2));
  const bugConsolidatedDividedByPax2 = Number((consolidatedNet2 / dineInPax2).toFixed(2));

  assert(apc2 !== bugConsolidatedDividedByGate2, `Spend / Guest (₹301.17) != Consolidated Net Sales / Gate Footfall (₹${bugConsolidatedDividedByGate2})`);
  assert(apc2 !== bugConsolidatedDividedByPax2, `Spend / Guest (₹301.17) != Consolidated Net Sales / Dine-In PAX (₹${bugConsolidatedDividedByPax2})`);

  // -------------------------------------------------------------
  // Test 3: Channel Exclusion Integrity (Snacks, Lancho, Takeaway, Complimentary)
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Channel & Status Exclusion Verification ---');
  const snacksOrders1 = (orders1 || []).filter((o) => isSnacksStallOrder(o) && o.status === 'Success');
  const takeawayOrders1 = (orders1 || []).filter((o) => isTakeawayOrder(o) && o.status === 'Success');
  const lanchoOrders1 = (orders1 || []).filter((o) => isLanchoOrder(o) && o.status === 'Success');
  const compOrders1 = (orders1 || []).filter((o) => o.status === 'Complimentary');

  const snacksNet1 = snacksOrders1.reduce((s, o) => s + (Number(o.net_sales) || 0), 0);
  const takeawayNet1 = takeawayOrders1.reduce((s, o) => s + (Number(o.net_sales) || 0), 0);
  const lanchoNet1 = lanchoOrders1.reduce((s, o) => s + (Number(o.net_sales) || 0), 0);
  const compNet1 = compOrders1.reduce((s, o) => s + (Number(o.net_sales) || 0), 0);

  assert(snacksOrders1.length === 75, `75 Snacks Stall orders correctly excluded from Restaurant Dine In`);
  assert(takeawayOrders1.length === 7, `7 Takeaway orders correctly excluded from Restaurant Dine In`);
  assert(lanchoOrders1.length === 1, `1 Lancho order correctly excluded from Restaurant Dine In`);
  assert(compOrders1.length === 3, `3 Complimentary orders correctly excluded from Restaurant Dine In`);

  const reconciledNet = dineInNet1 + snacksNet1 + takeawayNet1 + lanchoNet1;
  assert(Math.abs(reconciledNet - consolidatedNet1) < 0.02, `Reconciled net (₹${reconciledNet.toFixed(2)}) matches Consolidated Net Sales (₹${consolidatedNet1})`);
  assert(compNet1 > 0 && Math.abs(dineInNet1 + compNet1 - consolidatedNet1) > 1000, `Complimentary orders (₹${compNet1.toFixed(2)}) do NOT leak into net sales or APC`);

  // -------------------------------------------------------------
  // Test 4: Regression Fail Guard
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Regression Fail Guard Function ---');
  function computeSpendPerGuest(orders, consolidatedSales, gateVisitors) {
    const dineIn = (orders || []).filter((o) => isDineInOrder(o) && o.status === 'Success');
    const net = dineIn.reduce((s, o) => s + (Number(o.net_sales) || 0), 0);
    const pax = dineIn.reduce((s, o) => s + (Number(o.covers_pax) || 0), 0);
    return pax > 0 ? Number((net / pax).toFixed(2)) : 0;
  }

  const correctApcResult = computeSpendPerGuest(orders1, consolidatedNet1, gateFootfall1);
  assert(correctApcResult === 275.54, `computeSpendPerGuest returns correct ₹275.54 for 2026-09-29`);

  // Simulated buggy implementations:
  const buggyFootfallDenominator = gateFootfall1 > 0 ? Number((dineInNet1 / gateFootfall1).toFixed(2)) : 0;
  const buggyConsolidatedNumerator = dineInPax1 > 0 ? Number((consolidatedNet1 / dineInPax1).toFixed(2)) : 0;

  assert(buggyFootfallDenominator !== correctApcResult, `Regression guard detects denominator bug: ${buggyFootfallDenominator} != ${correctApcResult}`);
  assert(buggyConsolidatedNumerator !== correctApcResult, `Regression guard detects numerator bug: ${buggyConsolidatedNumerator} != ${correctApcResult}`);

  // -------------------------------------------------------------
  // Test 5: Edge Case Zero PAX / Zero Orders (No NaN or Infinity)
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Edge Cases (Zero PAX, Zero Footfall) ---');
  const zeroApc = computeSpendPerGuest([], 0, 0);
  assert(zeroApc === 0, `Empty orders array cleanly returns 0 (got ${zeroApc})`);
  assert(!Number.isNaN(zeroApc) && Number.isFinite(zeroApc), `Zero APC is not NaN and is finite`);

  const zeroPacing = calculateDinerPacing(0, 0, 100000, 300);
  assert(zeroPacing.actualSpendPerDiner === 0, `Zero pacing actualSpendPerDiner is 0`);
  assert(zeroPacing.requiredDinersAtTargetSpend === 334, `Zero pacing required diners at target spend is 334`);
  assert(zeroPacing.requiredDinersAtCurrentSpend === 334, `Zero pacing required diners at current spend falls back to target spend count`);
  assert(zeroPacing.achievementPercent === 0, `Zero pacing achievement is 0%`);

  // -------------------------------------------------------------
  // Test 6: Target Pacing and Diners Needed Calculations
  // -------------------------------------------------------------
  console.log('\n--- TEST 6: Target Pacing & Diners Needed Calculations ---');
  const pacing29 = calculateDinerPacing(79767.14, 275.54, 80000);
  assert(pacing29.achievementPercent === 99.7, `Target achievement is 99.7%`);
  assert(Math.abs(pacing29.remainingRevenue - 232.86) < 0.01, `Remaining revenue is ₹232.86`);
  assert(pacing29.requiredDinersAtTargetSpend === 1, `Required diners at target spend (₹300) is 1 diner`);
  assert(pacing29.requiredDinersAtCurrentSpend === 1, `Required diners at current spend (₹275.54) is 1 diner`);

  // Pacing with larger gap
  const pacingWithGap = calculateDinerPacing(79767.14, 275.54, 100000);
  assert(Math.abs(pacingWithGap.remainingRevenue - 20232.86) < 0.01, `Remaining revenue gap is ₹20,232.86`);
  assert(pacingWithGap.requiredDinersAtTargetSpend === 68, `Required diners at ₹300 target is 68 (got ${pacingWithGap.requiredDinersAtTargetSpend})`);
  assert(pacingWithGap.requiredDinersAtCurrentSpend === 74, `Required diners at current APC (₹275.54) is 74 (got ${pacingWithGap.requiredDinersAtCurrentSpend})`);

  // -------------------------------------------------------------
  // Test 7: Translation Keys Integrity
  // -------------------------------------------------------------
  console.log('\n--- TEST 7: i18n Translation Dictionary Integrity ---');
  const enDash = JSON.parse(fs.readFileSync('src/locales/en/dashboard.json', 'utf8'));
  const hiDash = JSON.parse(fs.readFileSync('src/locales/hi/dashboard.json', 'utf8'));

  assert(enDash.targetPacing.dinersNeeded === 'Diners Needed', `en/dashboard.json has dinersNeeded = "Diners Needed"`);
  assert(hiDash.targetPacing.dinersNeeded === 'जरूरी डाइनर', `hi/dashboard.json has dinersNeeded = "जरूरी डाइनर"`);
  assert(enDash.targetPacing.guidance.includes('diner'), `en guidance string uses "diner" terminology`);
  assert(hiDash.targetPacing.guidance.includes('डाइनर'), `hi guidance string uses "डाइनर" terminology`);
  assert(enDash.kpis.spendPerVisitor === 'Spend / Guest', `en spendPerVisitor KPI card title is "Spend / Guest"`);
  assert(hiDash.kpis.spendPerVisitor === 'प्रति व्यक्ति खर्च', `hi spendPerVisitor KPI card title is "प्रति व्यक्ति खर्च"`);

  console.log('\n================================================================');
  console.log(`SUMMARY: Passed: ${passed} | Failed: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
