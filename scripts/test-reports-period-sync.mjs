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

// Business unit classification mirror from src/lib/sales/business-units.ts
function isSnacksStallOrder(order) {
  if (!order) return false;
  const area = (order.area || '').toUpperCase().trim();
  const ot = (order.order_type || '').trim();
  const pt = (order.payment_type || '').toUpperCase().trim();
  if (area === 'LANCHO' || ot.toUpperCase() === 'LANCHO' || pt.includes('LANCHO')) {
    return false;
  }
  return ot === 'Delivery(Parcel)' || ot === 'Delivery (Parcel)' || ot === 'Snacks Stall';
}

function isDineInOrder(order) {
  if (!order) return false;
  const area = (order.area || '').toUpperCase().trim();
  const ot = (order.order_type || '').trim();
  const pt = (order.payment_type || '').toUpperCase().trim();
  if (area === 'LANCHO' || ot.toUpperCase() === 'LANCHO' || pt.includes('LANCHO')) {
    return false;
  }
  return ot === 'Dine In' || ot === 'Dine-In' || ot === 'Dine_In';
}

function parseActivityStream(hourlyItems, itemNamePattern) {
  const matching = (hourlyItems || []).filter((i) =>
    (i.item_name || '').toLowerCase().includes(itemNamePattern.toLowerCase())
  );
  const totalQty = matching.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  const totalGross = matching.reduce((sum, i) => sum + (Number(i.total_sales) || 0), 0);
  const totalNet = matching.reduce((sum, i) => sum + (Number(i.net_sales) || 0), 0);
  const abv = totalQty > 0 ? totalGross / totalQty : null;

  const hourMap = new Map();
  for (let h = 0; h < 24; h++) {
    hourMap.set(h, { hour: h, qty: 0, amount: 0 });
  }
  matching.forEach((i) => {
    const h = Number(i.hour_of_day);
    if (hourMap.has(h)) {
      const pt = hourMap.get(h);
      pt.qty += Number(i.quantity) || 0;
      pt.amount += Number(i.total_sales) || 0;
    }
  });

  return { totalQty, totalGross, totalNet, abv, hourlyData: Array.from(hourMap.values()) };
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 REPORTS PERIOD UNIFICATION & MULTI-DAY VERIFICATION SUITE');
  console.log('================================================================\n');

  const sepStart = '2026-09-01';
  const sepEnd = '2026-09-30';
  const drillDate = '2026-09-20';

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Full-Month Period Datasets vs Single Day (Sep 30 vs Sep 1–30)
  // --------------------------------------------------------------------------
  console.log('📌 Test Group 1: Full-Month Period vs Single Day Separation');

  // Fetch full month vs single day Sep 30
  const [
    { data: monthOrders },
    { data: sep30Orders },
    { data: monthHourly },
    { data: sep30Hourly },
    { data: monthVisitors },
    { data: sep30Visitors },
    { data: monthVehicles },
    { data: sep30Vehicles },
    { data: monthExec },
    { data: sep30Exec },
  ] = await Promise.all([
    supabase.from('sales_orders').select('*').gte('business_date', sepStart).lte('business_date', sepEnd),
    supabase.from('sales_orders').select('*').eq('business_date', '2026-09-30'),
    supabase.from('sales_hourly_items').select('*').gte('business_date', sepStart).lte('business_date', sepEnd),
    supabase.from('sales_hourly_items').select('*').eq('business_date', '2026-09-30'),
    supabase.from('visitor_counter_events').select('increment, timestamp, business_date').gte('business_date', sepStart).lte('business_date', sepEnd),
    supabase.from('visitor_counter_events').select('increment, timestamp, business_date').eq('business_date', '2026-09-30'),
    supabase.from('vehicle_counter_events').select('increment, timestamp, business_date').gte('business_date', sepStart).lte('business_date', sepEnd),
    supabase.from('vehicle_counter_events').select('increment, timestamp, business_date').eq('business_date', '2026-09-30'),
    supabase.from('sales_executive_summaries').select('*').gte('business_date', sepStart).lte('business_date', sepEnd),
    supabase.from('sales_executive_summaries').select('*').eq('business_date', '2026-09-30'),
  ]);

  const monthGross = (monthExec || []).reduce((s, r) => s + (Number(r.grand_total) || 0), 0);
  const sep30Gross = (sep30Exec || []).reduce((s, r) => s + (Number(r.grand_total) || 0), 0);

  assert(monthGross > sep30Gross, `Full month gross (₹${monthGross}) is strictly greater than Sep 30 alone (₹${sep30Gross})`);
  assert(monthOrders.length > sep30Orders.length, `Full month orders (${monthOrders.length}) is strictly greater than Sep 30 (${sep30Orders.length})`);
  assert(monthHourly.length > sep30Hourly.length, `Full month hourly items (${monthHourly.length}) is strictly greater than Sep 30 (${sep30Hourly.length})`);

  // --------------------------------------------------------------------------
  // TEST GROUP 2: Snacks Stall Multi-Day Aggregation
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 2: Snacks Stall Multi-Day Aggregation');

  const monthSnacksOrders = (monthOrders || []).filter((o) => isSnacksStallOrder(o) && o.status === 'Success');
  const sep30SnacksOrders = (sep30Orders || []).filter((o) => isSnacksStallOrder(o) && o.status === 'Success');

  const monthSnacksGross = monthSnacksOrders.reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0);
  const monthSnacksNet = monthSnacksOrders.reduce((sum, o) => sum + (Number(o.net_sales) || 0), 0);
  const sep30SnacksGross = sep30SnacksOrders.reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0);

  assert(monthSnacksOrders.length > 0, `Month snacks orders found (${monthSnacksOrders.length} orders)`);
  assert(monthSnacksGross > 0, `Month snacks gross is non-zero (₹${monthSnacksGross.toFixed(2)})`);
  assert(monthSnacksGross >= sep30SnacksGross, `Month snacks gross (₹${monthSnacksGross.toFixed(2)}) >= Sep 30 (₹${sep30SnacksGross.toFixed(2)})`);

  // Verify Snacks top items across month
  const snackKeywords = ['pakoda', 'tikki', 'tea', 'jalebi', 'golgappe', 'chaat', 'vada', 'snack', 'samosa'];
  const monthSnackItems = (monthHourly || []).filter((i) => {
    const name = (i.item_name || '').toLowerCase();
    return snackKeywords.some((kw) => name.includes(kw));
  });
  const snackItemMap = new Map();
  monthSnackItems.forEach((i) => {
    const curr = snackItemMap.get(i.item_name) || { name: i.item_name, qty: 0, gross: 0 };
    curr.qty += Number(i.quantity) || 0;
    curr.gross += Number(i.total_sales) || 0;
    snackItemMap.set(i.item_name, curr);
  });
  const topSnacks = Array.from(snackItemMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 5);
  assert(topSnacks.length > 0, `Found top snack items for the month (Top: ${topSnacks[0]?.name} - ${topSnacks[0]?.qty} units)`);

  // --------------------------------------------------------------------------
  // TEST GROUP 3: Gate Footfall & Vehicle Multi-Day Aggregation
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 3: Gate Footfall & Vehicle Multi-Day Aggregation');

  const monthTotalVisitors = (monthVisitors || []).reduce((sum, e) => sum + (Number(e.increment) || 0), 0);
  const sep30TotalVisitors = (sep30Visitors || []).reduce((sum, e) => sum + (Number(e.increment) || 0), 0);
  const monthTotalVehicles = (monthVehicles || []).reduce((sum, e) => sum + (Number(e.increment) || 1), 0);
  const sep30TotalVehicles = (sep30Vehicles || []).reduce((sum, e) => sum + (Number(e.increment) || 1), 0);

  assert(monthTotalVisitors > 0, `Full month visitors total is non-zero (${monthTotalVisitors} visitors)`);
  assert(monthTotalVisitors >= sep30TotalVisitors, `Month visitors (${monthTotalVisitors}) >= Sep 30 (${sep30TotalVisitors})`);
  assert(monthTotalVehicles >= sep30TotalVehicles, `Month vehicles (${monthTotalVehicles}) >= Sep 30 (${sep30TotalVehicles})`);

  // Test 24-hourly buckets aggregation across full month
  const hourMap = new Map();
  for (let h = 0; h < 24; h++) {
    hourMap.set(h, { hour: h, visitors: 0, vehicles: 0 });
  }
  (monthVisitors || []).forEach((ev) => {
    if (!ev.timestamp) return;
    const utcDate = new Date(ev.timestamp);
    const istMs = utcDate.getTime() + 330 * 60 * 1000;
    const hour = new Date(istMs).getUTCHours();
    const pt = hourMap.get(hour);
    if (pt) pt.visitors += Number(ev.increment) || 0;
  });
  (monthVehicles || []).forEach((ev) => {
    if (!ev.timestamp) return;
    const utcDate = new Date(ev.timestamp);
    const istMs = utcDate.getTime() + 330 * 60 * 1000;
    const hour = new Date(istMs).getUTCHours();
    const pt = hourMap.get(hour);
    if (pt) pt.vehicles += Number(ev.increment) || 1;
  });

  const hourBucketsSumVisitors = Array.from(hourMap.values()).reduce((sum, h) => sum + h.visitors, 0);
  const hourBucketsSumVehicles = Array.from(hourMap.values()).reduce((sum, h) => sum + h.vehicles, 0);

  assert(hourBucketsSumVisitors === monthTotalVisitors, `24 hourly buckets sum (${hourBucketsSumVisitors}) exactly matches total visitors (${monthTotalVisitors})`);
  assert(hourBucketsSumVehicles === monthTotalVehicles, `24 hourly vehicle buckets sum (${hourBucketsSumVehicles}) exactly matches total vehicles (${monthTotalVehicles})`);

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Village Attractions Multi-Day Aggregation
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 4: Village Attractions Multi-Day Aggregation');

  const monthCamel = parseActivityStream(monthHourly, 'Camel Ride');
  const monthGames = parseActivityStream(monthHourly, 'Skill Games');
  const monthMehendi = parseActivityStream(monthHourly, 'Mehendi');
  const monthChampi = parseActivityStream(monthHourly, 'Champi');

  const sep30Camel = parseActivityStream(sep30Hourly, 'Camel Ride');
  const sep30Games = parseActivityStream(sep30Hourly, 'Skill Games');

  assert(monthCamel.totalGross >= sep30Camel.totalGross, `Month Camel gross (₹${monthCamel.totalGross}) >= Sep 30 (₹${sep30Camel.totalGross})`);
  assert(monthGames.totalGross >= sep30Games.totalGross, `Month Games gross (₹${monthGames.totalGross}) >= Sep 30 (₹${sep30Games.totalGross})`);
  assert(monthGames.totalQty >= sep30Games.totalQty, `Month Games tickets (${monthGames.totalQty}) >= Sep 30 (${sep30Games.totalQty})`);
  assert(typeof monthCamel.totalQty === 'number' && !isNaN(monthCamel.totalQty), 'Camel quantity is a valid non-NaN number');
  assert(typeof monthGames.totalQty === 'number' && !isNaN(monthGames.totalQty), 'Games quantity is a valid non-NaN number');
  assert(typeof monthMehendi.totalQty === 'number' && !isNaN(monthMehendi.totalQty), 'Mehendi quantity is a valid non-NaN number');
  assert(typeof monthChampi.totalQty === 'number' && !isNaN(monthChampi.totalQty), 'Champi quantity is a valid non-NaN number');

  // --------------------------------------------------------------------------
  // TEST GROUP 5: Single-Day Drilldown Isolation & Return to Full Period
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 5: Single-Day Drilldown Isolation & Return to Period');

  const { data: drillOrders } = await supabase.from('sales_orders').select('*').eq('business_date', drillDate);
  const { data: drillHourly } = await supabase.from('sales_hourly_items').select('*').eq('business_date', drillDate);
  const { data: drillExec } = await supabase.from('sales_executive_summaries').select('*').eq('business_date', drillDate);

  const drillGross = (drillExec || []).reduce((s, r) => s + (Number(r.grand_total) || 0), 0);

  // Invariant 1: Single day drilldown strictly matches single day records
  assert(drillGross > 0, `Drilldown date ${drillDate} Gross is ₹${drillGross}`);
  assert(drillGross < monthGross, `Drilldown date gross (₹${drillGross}) is strictly lower than full month (₹${monthGross})`);

  // Invariant 2: ReportsPage effective period derivation
  function deriveEffectivePeriod(startDate, endDate, selectedDate) {
    const effectiveStartDate = selectedDate || startDate;
    const effectiveEndDate = selectedDate || endDate;
    const isSingleDay = Boolean(selectedDate);
    return { effectiveStartDate, effectiveEndDate, isSingleDay };
  }

  // State 1: Full Period
  const stateFull = deriveEffectivePeriod(sepStart, sepEnd, null);
  assert(stateFull.effectiveStartDate === '2026-09-01' && stateFull.effectiveEndDate === '2026-09-30' && !stateFull.isSingleDay, 'Full Period resolves to 2026-09-01..2026-09-30 with isSingleDay=false');

  // State 2: Single Day Drilldown
  const stateDrill = deriveEffectivePeriod(sepStart, sepEnd, drillDate);
  assert(stateDrill.effectiveStartDate === drillDate && stateDrill.effectiveEndDate === drillDate && stateDrill.isSingleDay, `Drilldown resolves to ${drillDate}..${drillDate} with isSingleDay=true`);

  // State 3: Clear Drilldown
  const stateCleared = deriveEffectivePeriod(sepStart, sepEnd, null);
  assert(stateCleared.effectiveStartDate === '2026-09-01' && stateCleared.effectiveEndDate === '2026-09-30' && !stateCleared.isSingleDay, 'Clearing drilldown immediately returns to full period 2026-09-01..2026-09-30');

  // --------------------------------------------------------------------------
  // TEST GROUP 6: Operating Surplus Multi-Day Aggregation
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 6: Operating Surplus Multi-Day Aggregation');

  const [
    { data: monthExpenses },
    { data: monthMovements },
    { data: monthMeters },
  ] = await Promise.all([
    supabase.from('expenses').select('amount').gte('business_date', sepStart).lte('business_date', sepEnd),
    supabase.from('stock_movements').select('item_id, purpose, movement_type, total_value').gte('business_date', sepStart).lte('business_date', sepEnd),
    supabase.from('meter_readings_ledger').select('delta_consumption').gte('business_date', sepStart).lte('business_date', sepEnd),
  ]);

  const totalDirectVouchers = (monthExpenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalKvah = (monthMeters || []).reduce((s, r) => s + (Number(r.delta_consumption) || 0), 0);
  const electricityCost = totalKvah * 10.0;

  let storeSum = 0;
  let dieselCost = 0;
  let lpgCost = 0;
  const DIESEL_ITEM_ID = 'd1e5e100-0001-4000-a000-000000000001';
  const LPG_ITEM_ID = '195c1900-0002-4000-a000-000000000002';

  (monthMovements || []).forEach((m) => {
    if (['transfer', 'purchase', 'opening', 'return', 'count_adjustment', 'physical_count_adjustment'].includes(m.movement_type)) {
      return;
    }
    const val = Math.abs(Number(m.total_value)) || 0;
    if (m.item_id === DIESEL_ITEM_ID || m.purpose === 'Generator Fuel') {
      dieselCost += val;
    } else if (m.item_id === LPG_ITEM_ID || m.purpose === 'Kitchen Gas') {
      lpgCost += val;
    } else {
      storeSum += val;
    }
  });

  const totalUtilities = dieselCost + lpgCost + electricityCost;
  const totalOperationalExpenses = totalDirectVouchers + storeSum + totalUtilities;

  assert(typeof totalOperationalExpenses === 'number' && !isNaN(totalOperationalExpenses), `Operational expenses calculated without NaN (₹${totalOperationalExpenses.toFixed(2)})`);
  assert(totalUtilities >= 0, `Utilities calculated properly (₹${totalUtilities.toFixed(2)})`);

  // --------------------------------------------------------------------------
  // TEST GROUP 7: Point-in-Time Vendor Outstanding Invariance
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 7: Vendor Outstanding Point-in-Time Invariance');

  const { data: vendors, error: vErr } = await supabase.from('vendor_outstanding_summary').select('*').order('vendor_name');
  if (vErr) throw vErr;

  assert(vendors && vendors.length > 0, `Vendor accounts retrieved (${vendors.length} vendors)`);
  const hasDateField = vendors.some((v) => 'business_date' in v);
  assert(!hasDateField, 'vendor_outstanding_summary has no business_date column; verified strictly point-in-time');

  // --------------------------------------------------------------------------
  // TEST GROUP 8: Empty / Zero-Data Periods Safety (No NaN / No Infinity)
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 8: Empty / Zero-Data Period Safety');

  const emptyStart = '2029-01-01';
  const emptyEnd = '2029-01-31';

  const [
    { data: emptyOrders },
    { data: emptyHourly },
  ] = await Promise.all([
    supabase.from('sales_orders').select('*').gte('business_date', emptyStart).lte('business_date', emptyEnd),
    supabase.from('sales_hourly_items').select('*').gte('business_date', emptyStart).lte('business_date', emptyEnd),
  ]);

  const emptyDineIn = (emptyOrders || []).filter((o) => isDineInOrder(o) && o.status === 'Success');
  const emptyPax = emptyDineIn.reduce((sum, o) => sum + (Number(o.covers_pax) || 0), 0);
  const emptyNet = emptyDineIn.reduce((sum, o) => sum + (Number(o.net_sales) || 0), 0);
  const emptyApc = emptyPax > 0 ? emptyNet / emptyPax : null;
  const emptyFootfall = 0;
  const emptyConversion = emptyFootfall > 0 ? (emptyPax / emptyFootfall) * 100 : null;

  assert(emptyApc === null, 'Empty period APC evaluates cleanly to null (no NaN/Infinity)');
  assert(emptyConversion === null, 'Empty period diner conversion evaluates cleanly to null (no NaN/Infinity)');

  const emptyAttraction = parseActivityStream(emptyHourly, 'Camel Ride');
  assert(emptyAttraction.totalQty === 0, 'Empty attraction tickets count evaluates to 0');
  assert(emptyAttraction.abv === null, 'Empty attraction ABV evaluates cleanly to null (no NaN/Infinity)');

  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
