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
  // TEST GROUP 5: Multi-Day Period Aggregation Simulation
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 5: Multi-Day Period Aggregation');

  const { data: multiDayItems } = await supabase
    .from('sales_order_items')
    .select('business_date, net_sales, quantity, hour_of_day')
    .gte('business_date', '2026-09-01')
    .lte('business_date', '2026-09-30')
    .eq('status', 'Success');

  const multiDayNet = (multiDayItems || []).reduce((s, r) => s + Number(r.net_sales), 0);
  assert(
    multiDayNet >= totalSuccessNet,
    `Multi-day query successfully aggregates sales across period (Total Net: ₹${multiDayNet.toFixed(2)})`
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
