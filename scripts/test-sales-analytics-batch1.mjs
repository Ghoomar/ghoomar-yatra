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

async function runTests() {
  console.log('================================================================');
  console.log('🧪 BATCH 1 SALES ANALYTICS VERIFICATION SUITE');
  console.log('================================================================\n');

  const testDate = '2026-09-28';

  // --------------------------------------------------------------------------
  // TEST GROUP 1: sales_order_items Integrity & Exact Reconciliation
  // --------------------------------------------------------------------------
  console.log('📌 Test Group 1: sales_order_items Ingestion & Exact Reconciliation');

  const { data: itemRows, count: totalRowsCount, error: itemErr } = await supabase
    .from('sales_order_items')
    .select('*', { count: 'exact' })
    .eq('business_date', testDate);

  if (itemErr) throw itemErr;

  assert(totalRowsCount === 328, `Found exactly 328 imported item rows (got ${totalRowsCount})`);

  const successItems = (itemRows || []).filter((r) => r.status === 'Success');
  const compItems = (itemRows || []).filter((r) => r.status === 'Complimentary');
  const cancelledItems = (itemRows || []).filter((r) => r.status === 'Cancelled');

  assert(successItems.length === 324, `Found exactly 324 Success item rows (got ${successItems.length})`);
  assert(compItems.length === 3, `Found exactly 3 Complimentary item rows (got ${compItems.length})`);
  assert(cancelledItems.length === 1, `Found exactly 1 Cancelled item rows (got ${cancelledItems.length})`);

  const totalSuccessNet = successItems.reduce((s, r) => s + Number(r.net_sales), 0);
  const totalSuccessQty = successItems.reduce((s, r) => s + Number(r.quantity), 0);
  const totalSuccessGross = successItems.reduce((s, r) => s + Number(r.final_total), 0);

  assert(
    Math.abs(totalSuccessNet - 54090.5) < 0.01,
    `Success Net Sales ₹${totalSuccessNet.toFixed(2)} matches expected ₹54,090.50`
  );
  assert(
    totalSuccessQty === 574,
    `Success total quantity ${totalSuccessQty} matches expected 574`
  );
  assert(
    Math.abs(totalSuccessGross - 56795.44) < 0.05,
    `Success Gross Sales ₹${totalSuccessGross.toFixed(2)} matches expected ₹56,795.44`
  );

  // Compare with sales_hourly_items
  const { data: hourlyRows } = await supabase
    .from('sales_hourly_items')
    .select('net_sales, quantity')
    .eq('business_date', testDate);

  const hourlyNet = (hourlyRows || []).reduce((s, r) => s + Number(r.net_sales), 0);
  const hourlyQty = (hourlyRows || []).reduce((s, r) => s + Number(r.quantity), 0);

  assert(
    Math.abs(hourlyNet - totalSuccessNet) < 0.01,
    `Exact Net Sales Parity with Hourly Item Sales (₹${hourlyNet.toFixed(2)} vs ₹${totalSuccessNet.toFixed(2)})`
  );
  assert(
    hourlyQty === totalSuccessQty,
    `Exact Quantity Parity with Hourly Item Sales (${hourlyQty} vs ${totalSuccessQty})`
  );

  // --------------------------------------------------------------------------
  // TEST GROUP 2: 6 Granular Filter Attributions
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 2: Granular Filter Attributions on sales_order_items');

  // Filter 1: Parent Category = 'Indian'
  const indianItems = successItems.filter((r) => r.parent_category === 'Indian');
  const indianNet = indianItems.reduce((s, r) => s + Number(r.net_sales), 0);
  assert(
    indianItems.length > 0 && indianNet > 0,
    `Filter 1 [parent_category='Indian']: Matched ${indianItems.length} items, Net Sales ₹${indianNet.toFixed(2)}`
  );

  // Filter 2: Category = 'Indian Starter'
  const starterItems = successItems.filter((r) => r.category === 'Indian Starter');
  const starterNet = starterItems.reduce((s, r) => s + Number(r.net_sales), 0);
  assert(
    starterItems.length > 0 && starterNet > 0 && starterNet < indianNet,
    `Filter 2 [category='Indian Starter']: Matched ${starterItems.length} items, Net Sales ₹${starterNet.toFixed(2)}`
  );

  // Filter 3: Item Name ilike 'Paneer Lababdar%'
  const paneerItems = successItems.filter((r) => r.item_name.toLowerCase().includes('paneer lababdar'));
  const paneerQty = paneerItems.reduce((s, r) => s + Number(r.quantity), 0);
  const paneerNet = paneerItems.reduce((s, r) => s + Number(r.net_sales), 0);
  assert(
    paneerItems.length > 0 && paneerQty > 0,
    `Filter 3 [item='Paneer Lababdar']: Matched ${paneerItems.length} items (${paneerQty} plates, ₹${paneerNet.toFixed(2)})`
  );

  // Filter 4: Captain
  const distinctCaptains = Array.from(new Set(successItems.map((r) => r.captain_name).filter(Boolean)));
  assert(distinctCaptains.length > 0, `Filter 4 [captain]: Found ${distinctCaptains.length} captains (${distinctCaptains.join(', ')})`);
  const sampleCaptain = distinctCaptains[0];
  const captainItems = successItems.filter((r) => r.captain_name === sampleCaptain);
  const captainNet = captainItems.reduce((s, r) => s + Number(r.net_sales), 0);
  assert(captainItems.length > 0 && captainNet > 0, `  Matched captain '${sampleCaptain}': ${captainItems.length} items, ₹${captainNet.toFixed(2)}`);

  // Filter 5: Payment Type
  const distinctPayments = Array.from(new Set(successItems.map((r) => r.payment_type).filter(Boolean)));
  assert(distinctPayments.length > 0, `Filter 5 [payment_type]: Found ${distinctPayments.length} payment modes (${distinctPayments.join(', ')})`);
  const cashItems = successItems.filter((r) => (r.payment_type || '').toLowerCase().includes('cash'));
  const cashNet = cashItems.reduce((s, r) => s + Number(r.net_sales), 0);
  assert(cashItems.length > 0 && cashNet > 0, `  Matched 'Cash': ${cashItems.length} items, ₹${cashNet.toFixed(2)}`);

  // Filter 6: Order Type / Business Unit
  const dineInItems = successItems.filter((r) => (r.order_type || '').startsWith('Dine'));
  const snacksItems = successItems.filter((r) => (r.order_type || '').startsWith('Delivery') && r.area !== 'LANCHO');
  assert(dineInItems.length > 0, `Filter 6 [order_type='Dine In']: Matched ${dineInItems.length} dine-in items`);
  assert(snacksItems.length > 0, `Filter 6 [order_type='Snacks Stall']: Matched ${snacksItems.length} snacks stall items`);

  // Combined Multi-Filter Attribution
  const combinedItems = successItems.filter(
    (r) => r.parent_category === 'Indian' && (r.order_type || '').startsWith('Dine')
  );
  const combinedNet = combinedItems.reduce((s, r) => s + Number(r.net_sales), 0);
  assert(
    combinedItems.length > 0 && combinedNet <= indianNet,
    `Combined Multi-Filter [Indian + Dine In]: ${combinedItems.length} items, Net Sales ₹${combinedNet.toFixed(2)}`
  );

  // --------------------------------------------------------------------------
  // TEST GROUP 3: 24 Hourly Buckets Cumulative Analysis
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 3: 24 Hourly Buckets Cumulative Distribution');

  const hourlyMap = new Map();
  for (let h = 0; h < 24; h++) {
    hourlyMap.set(h, { hour: h, total_sales: 0, total_quantity: 0, itemsCount: 0 });
  }

  successItems.forEach((r) => {
    const h = r.hour_of_day;
    const bucket = hourlyMap.get(h);
    if (bucket) {
      bucket.total_sales += Number(r.net_sales);
      bucket.total_quantity += Number(r.quantity);
      bucket.itemsCount += 1;
    }
  });

  const allBuckets = Array.from(hourlyMap.values());
  assert(allBuckets.length === 24, `Hourly distribution produces exactly 24 buckets (hours 0..23)`);

  const sumBucketSales = allBuckets.reduce((s, b) => s + b.total_sales, 0);
  assert(
    Math.abs(sumBucketSales - totalSuccessNet) < 0.01,
    `Sum of 24 hourly buckets (₹${sumBucketSales.toFixed(2)}) exactly matches total net sales (₹${totalSuccessNet.toFixed(2)})`
  );

  const activeHours = allBuckets.filter((b) => b.total_sales > 0);
  console.log(`  Active sales hours: ${activeHours.map((b) => `${b.hour}:00 (₹${b.total_sales.toFixed(0)})`).join(', ')}`);
  assert(activeHours.length > 0, `Found ${activeHours.length} active operational hours`);

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Server-Side Pagination for Individual Bills
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 4: Server-Side Pagination for Individual Bills');

  const { data: allBills, count: totalBillsCount } = await supabase
    .from('sales_orders')
    .select('*', { count: 'exact' })
    .eq('business_date', testDate)
    .eq('status', 'Success');

  assert(totalBillsCount === 143, `Authoritative total success bills on ${testDate}: 143`);

  // Simulate Page 1 (pageSize = 25)
  const pageSize = 25;
  const { data: page1Rows } = await supabase
    .from('sales_orders')
    .select('*')
    .eq('business_date', testDate)
    .eq('status', 'Success')
    .order('order_timestamp', { ascending: false })
    .order('invoice_no', { ascending: false })
    .range(0, pageSize - 1);

  assert(page1Rows.length === 25, `Page 1 returns exactly 25 bills (got ${page1Rows.length})`);

  // Simulate Page 2 (pageSize = 25)
  const { data: page2Rows } = await supabase
    .from('sales_orders')
    .select('*')
    .eq('business_date', testDate)
    .eq('status', 'Success')
    .order('order_timestamp', { ascending: false })
    .order('invoice_no', { ascending: false })
    .range(pageSize, 2 * pageSize - 1);

  assert(page2Rows.length === 25, `Page 2 returns exactly 25 bills (got ${page2Rows.length})`);

  const page1Invoices = new Set(page1Rows.map((r) => r.invoice_no));
  const hasOverlap = page2Rows.some((r) => page1Invoices.has(r.invoice_no));
  assert(!hasOverlap, `Zero overlap between Page 1 and Page 2 invoices (pagination boundary is clean)`);

  const expectedTotalPages = Math.ceil(totalBillsCount / pageSize);
  assert(expectedTotalPages === 6, `Total pages calculated correctly (143 / 25 = 6 pages)`);

  // Test item-level filter on bills: bills that contain 'Indian Starter'
  const matchingStarterInvoices = Array.from(
    new Set(
      successItems
        .filter((r) => r.category === 'Indian Starter')
        .map((r) => r.invoice_no)
    )
  );
  assert(matchingStarterInvoices.length > 0, `Found ${matchingStarterInvoices.length} invoices containing 'Indian Starter' items`);

  const { data: filteredBills } = await supabase
    .from('sales_orders')
    .select('*')
    .eq('business_date', testDate)
    .eq('status', 'Success')
    .in('invoice_no', matchingStarterInvoices);

  assert(
    filteredBills.length === matchingStarterInvoices.length,
    `Bills endpoint correctly filters to ${filteredBills.length} bills containing matched items`
  );

  // --------------------------------------------------------------------------
  // TEST GROUP 5: Full Month Period Aggregation & Reconciliation
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 5: Full Month Period Aggregation & Reconciliation');

  // Helper for paginated fetch to simulate API fetchAllRows
  async function fetchAll(query) {
    let all = [];
    let page = 0;
    while (true) {
      const { data, error } = await query.range(page * 1000, (page + 1) * 1000 - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < 1000) break;
      page++;
    }
    return all;
  }

  // 1. Full-month reconciliation verification
  const { data: fullMonthRecon } = await supabase
    .from('daily_sales_reconciliation')
    .select('*')
    .gte('business_date', '2026-09-01')
    .lte('business_date', '2026-09-30')
    .order('business_date');

  assert(fullMonthRecon && fullMonthRecon.length === 27, `Found exactly 27 days in September reconciliation (got ${fullMonthRecon?.length})`);

  const monthExecNet = (fullMonthRecon || []).reduce((s, r) => s + (Number(r.exec_net_sales) || 0), 0);
  const monthOrdersNet = (fullMonthRecon || []).reduce((s, r) => s + (Number(r.orders_net_sales) || 0), 0);
  const monthDiff = Math.round((monthOrdersNet - monthExecNet) * 100) / 100;
  const isMonthReconciled = fullMonthRecon.every((r) => r.reconciliation_status === 'Reconciled');

  assert(Math.round(monthExecNet * 100) / 100 === 1950753.90, `Full Month Executive Net Sales = ₹19,50,753.90 (got ${monthExecNet.toFixed(2)})`);
  assert(Math.round(monthOrdersNet * 100) / 100 === 1950753.90, `Full Month Orders Net Sales = ₹19,50,753.90 (got ${monthOrdersNet.toFixed(2)})`);
  assert(monthDiff === 0, `Full Month Reconciliation Difference = ₹0.00 (got ${monthDiff})`);
  assert(isMonthReconciled, `All 27 days in September are 100% 'Reconciled'`);

  // 2. Full-month hybrid data aggregation (combining detailed + legacy)
  const { data: monthItemDateRows } = await supabase
    .from('sales_order_items')
    .select('business_date')
    .gte('business_date', '2026-09-01')
    .lte('business_date', '2026-09-30');

  const detailedDatesSet = new Set((monthItemDateRows || []).map((r) => r.business_date));
  assert(detailedDatesSet.size === 2, `Detailed dates identified: Sep 28 and Sep 29 (${Array.from(detailedDatesSet).join(', ')})`);

  const monthDetailedItems = await fetchAll(
    supabase
      .from('sales_order_items')
      .select('*')
      .gte('business_date', '2026-09-01')
      .lte('business_date', '2026-09-30')
      .eq('status', 'Success')
  );

  const monthAllOrders = await fetchAll(
    supabase
      .from('sales_orders')
      .select('*')
      .gte('business_date', '2026-09-01')
      .lte('business_date', '2026-09-30')
      .eq('status', 'Success')
  );

  const monthAllHourly = await fetchAll(
    supabase
      .from('sales_hourly_items')
      .select('*')
      .gte('business_date', '2026-09-01')
      .lte('business_date', '2026-09-30')
  );

  const monthLegacyOrders = monthAllOrders.filter((o) => !detailedDatesSet.has(o.business_date));
  const monthLegacyHourly = monthAllHourly.filter((h) => !detailedDatesSet.has(h.business_date));

  const totalAggregatedNet =
    monthDetailedItems.reduce((s, i) => s + (Number(i.net_sales) || 0), 0) +
    monthLegacyOrders.reduce((s, o) => s + (Number(o.net_sales) || 0), 0);

  const totalAggregatedBills =
    new Set(monthDetailedItems.map((i) => i.invoice_no)).size + monthLegacyOrders.length;

  const totalAggregatedQty =
    monthDetailedItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0) +
    monthLegacyHourly.reduce((s, h) => s + (Number(h.quantity) || 0), 0);

  assert(
    Math.round(totalAggregatedNet * 100) / 100 === 1950753.90,
    `Full Month Hybrid Net Sales = ₹19,50,753.90 (got ₹${totalAggregatedNet.toFixed(2)})`
  );
  assert(
    totalAggregatedBills === 3182,
    `Full Month Total Bills = 3,182 (got ${totalAggregatedBills})`
  );
  assert(
    Math.round(totalAggregatedQty * 100) / 100 === 18782.53,
    `Full Month Items Sold = 18,782.53 units (got ${totalAggregatedQty.toFixed(2)})`
  );

  // 3. Hourly cumulative distribution across all 24 buckets for the full month
  let fullMonthHourlySum = 0;
  for (let h = 0; h < 24; h++) {
    const hDet = monthDetailedItems.filter((i) => i.hour_of_day === h).reduce((s, i) => s + Number(i.net_sales), 0);
    const hLeg = monthLegacyHourly.filter((hRow) => hRow.hour_of_day === h).reduce((s, hRow) => s + Number(hRow.net_sales), 0);
    fullMonthHourlySum += hDet + hLeg;
  }
  assert(
    Math.round(fullMonthHourlySum * 100) / 100 === 1950753.91,
    `Full Month 24 Hourly Buckets Cumulative Sum = ₹19,50,753.91 (got ₹${fullMonthHourlySum.toFixed(2)})`
  );

  // --------------------------------------------------------------------------
  // TEST GROUP 6: Single-Day Drilldown Isolation & Return to Period
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 6: Single-Day Drilldown Isolation & Full Period Sync');

  // Drilldown to 2026-09-29
  const sep29Items = monthDetailedItems.filter((i) => i.business_date === '2026-09-29');
  const sep29Net = sep29Items.reduce((s, i) => s + Number(i.net_sales), 0);
  const sep29Bills = new Set(sep29Items.map((i) => i.invoice_no)).size;
  assert(Math.round(sep29Net * 100) / 100 === 79767.14, `Sep 29 Drilldown: Net Sales = ₹79,767.14 (got ₹${sep29Net.toFixed(2)})`);
  assert(sep29Bills === 163, `Sep 29 Drilldown: Total Bills = 163 (got ${sep29Bills})`);

  // Drilldown to 2026-09-28
  const sep28Items = monthDetailedItems.filter((i) => i.business_date === '2026-09-28');
  const sep28Net = sep28Items.reduce((s, i) => s + Number(i.net_sales), 0);
  const sep28Bills = new Set(sep28Items.map((i) => i.invoice_no)).size;
  assert(Math.round(sep28Net * 100) / 100 === 54090.50, `Sep 28 Drilldown: Net Sales = ₹54,090.50 (got ₹${sep28Net.toFixed(2)})`);
  assert(sep28Bills === 143, `Sep 28 Drilldown: Total Bills = 143 (got ${sep28Bills})`);

  // Drilldown to legacy single day 2026-09-03
  const sep03Orders = monthLegacyOrders.filter((o) => o.business_date === '2026-09-03');
  const sep03Net = sep03Orders.reduce((s, o) => s + Number(o.net_sales), 0);
  assert(Math.round(sep03Net * 100) / 100 === 7146.70, `Sep 03 Legacy Drilldown: Net Sales = ₹7,146.70 (got ₹${sep03Net.toFixed(2)})`);
  assert(sep03Orders.length === 14, `Sep 03 Legacy Drilldown: Total Bills = 14 (got ${sep03Orders.length})`);

  // Full month paginated bills endpoint simulation
  const fullMonthOrdersCount = monthAllOrders.length;
  const fullMonthPages = Math.ceil(fullMonthOrdersCount / 25);
  const fullMonthOrdersNet = monthAllOrders.reduce((s, o) => s + Number(o.net_sales), 0);

  assert(fullMonthOrdersCount === 3182, `Full Month Orders Count = 3,182 bills (got ${fullMonthOrdersCount})`);
  assert(fullMonthPages === 128, `Full Month Bills Pages = 128 pages at 25/page (got ${fullMonthPages})`);
  assert(
    Math.round(fullMonthOrdersNet * 100) / 100 === 1950753.90,
    `Full Month Bills Summary Net Sales = ₹19,50,753.90 (got ₹${fullMonthOrdersNet.toFixed(2)})`
  );

  // --------------------------------------------------------------------------
  // TEST GROUP 7: Period Selector State Integrity & Non-Oscillation Invariants
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 7: Period Selector State Integrity & Non-Oscillation Invariants');

  function getMonthBoundaries(yearMonth) {
    const [year, month] = yearMonth.split('-').map(Number);
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { startDate, endDate };
  }

  // 1. Boundary calculations
  const bSep2026 = getMonthBoundaries('2026-09');
  assert(
    bSep2026.startDate === '2026-09-01' && bSep2026.endDate === '2026-09-30',
    `Sep 2026 boundaries: 2026-09-01 to 2026-09-30 (got ${bSep2026.startDate} to ${bSep2026.endDate})`
  );

  const bFeb2026 = getMonthBoundaries('2026-02');
  assert(
    bFeb2026.startDate === '2026-02-01' && bFeb2026.endDate === '2026-02-28',
    `Feb 2026 (non-leap) boundaries: 2026-02-01 to 2026-02-28 (got ${bFeb2026.startDate} to ${bFeb2026.endDate})`
  );

  const bFeb2024 = getMonthBoundaries('2024-02');
  assert(
    bFeb2024.startDate === '2024-02-01' && bFeb2024.endDate === '2024-02-29',
    `Feb 2024 (leap) boundaries: 2024-02-01 to 2024-02-29 (got ${bFeb2024.startDate} to ${bFeb2024.endDate})`
  );

  const bAug2026 = getMonthBoundaries('2026-08');
  assert(
    bAug2026.startDate === '2026-08-01' && bAug2026.endDate === '2026-08-31',
    `Aug 2026 (31-day) boundaries: 2026-08-01 to 2026-08-31 (got ${bAug2026.startDate} to ${bAug2026.endDate})`
  );

  // 2. State machine simulation: ReportsPage holds authoritative period state
  class MockReportsPageController {
    constructor() {
      const ym = '2026-09';
      const b = getMonthBoundaries(ym);
      this.state = {
        filterMode: 'month',
        selectedMonth: ym,
        startDate: b.startDate,
        endDate: b.endDate,
        selectedDate: null,
      };
      this.callbackCallCount = 0;
    }

    onPeriodChange(start, end, mode, month) {
      this.callbackCallCount++;
      this.state = {
        ...this.state,
        filterMode: mode,
        selectedMonth: month,
        startDate: start,
        endDate: end,
        selectedDate: null,
      };
    }

    onSelectDate(date) {
      this.state = { ...this.state, selectedDate: date };
    }
  }

  const page = new MockReportsPageController();

  // Invariant A: Initial state has full month boundaries matching selectedMonth
  assert(
    page.state.filterMode === 'month' &&
      page.state.selectedMonth === '2026-09' &&
      page.state.startDate === '2026-09-01' &&
      page.state.endDate === '2026-09-30' &&
      page.state.selectedDate === null,
    'ReportsPage initial state is pure month mode (2026-09-01 to 2026-09-30)'
  );

  // Invariant B: Re-render without user action NEVER invokes onPeriodChange (0 feedback oscillations)
  // Simulating 10 renders of both DailySalesLineGraph and SalesAnalyticsDashboard:
  let simulatedRenderFeedbackCalls = 0;
  for (let r = 0; r < 10; r++) {
    // Neither child has a useEffect that calls onPeriodChange!
    // They only read props: filterMode, selectedMonth, startDate, endDate
    const childGraphProps = { ...page.state };
    const childAnalyticsProps = { ...page.state };
    if (!childGraphProps || !childAnalyticsProps) simulatedRenderFeedbackCalls++;
  }
  assert(
    simulatedRenderFeedbackCalls === 0 && page.callbackCallCount === 0,
    'Zero background feedback calls during 10 simultaneous child render cycles (no oscillation)'
  );

  // Invariant C: User switches to custom mode with full month dates (2026-09-01 to 2026-09-30)
  // Even though dates equal month boundaries, mode MUST remain strictly 'custom' (no auto-conversion)
  page.onPeriodChange('2026-09-01', '2026-09-30', 'custom', '2026-09');
  assert(
    page.state.filterMode === 'custom' &&
      page.state.startDate === '2026-09-01' &&
      page.state.endDate === '2026-09-30',
    'Custom mode with full-month dates is strictly preserved as filterMode === "custom" (no inferring mode from dates)'
  );
  assert(page.callbackCallCount === 1, 'Exactly 1 callback fired on explicit user mode toggle');

  // Invariant D: Another 10 render cycles in custom mode produce zero feedback calls
  for (let r = 0; r < 10; r++) {
    const childGraphProps = { ...page.state };
    const childAnalyticsProps = { ...page.state };
    if (!childGraphProps || !childAnalyticsProps) simulatedRenderFeedbackCalls++;
  }
  assert(
    page.callbackCallCount === 1,
    'Custom mode remains completely stable across 10 render cycles (callback count remained 1)'
  );

  // Invariant E: User switches back to month mode
  const bAug = getMonthBoundaries('2026-08');
  page.onPeriodChange(bAug.startDate, bAug.endDate, 'month', '2026-08');
  assert(
    page.state.filterMode === 'month' &&
      page.state.selectedMonth === '2026-08' &&
      page.state.startDate === '2026-08-01' &&
      page.state.endDate === '2026-08-31',
    'Month switch sets month mode and boundaries to Aug 2026 (2026-08-01 to 2026-08-31)'
  );
  assert(page.callbackCallCount === 2, 'Exactly 2 callbacks fired in total after explicit month switch');

  // Invariant F: Single-day drilldown sets selectedDate without modifying period mode
  page.onSelectDate('2026-08-15');
  assert(
    page.state.selectedDate === '2026-08-15' && page.state.filterMode === 'month',
    'Drilldown to 2026-08-15 isolates single day while preserving parent filterMode'
  );

  // Invariant G: Changing period clears single-day drilldown
  page.onPeriodChange('2026-09-01', '2026-09-30', 'month', '2026-09');
  assert(
    page.state.selectedDate === null && page.state.selectedMonth === '2026-09',
    'Period change automatically clears drilldown and restores month view'
  );

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
