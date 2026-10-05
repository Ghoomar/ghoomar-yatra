import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { hasPermission, ROUTE_PERMISSIONS } from '../src/lib/rbac';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8')
      .split('\n')
      .forEach((l) => {
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runTests() {
  console.log('================================================================');
  console.log('🧪 PURCHASES & VENDORS CONSOLIDATION REGRESSION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  // --- Group 1: Navigation & Sidebar Invariants ---
  console.log('📌 Test Group 1: Navigation, Sidebar & RBAC Invariants');

  test('Sidebar contains Purchases under Finance and excludes standalone Vendors', () => {
    const sidebarContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/navigation/Sidebar.tsx'), 'utf8');
    assert.ok(sidebarContent.includes("href: '/finance/purchases'"), 'Purchases route missing from sidebar');
    assert.ok(!sidebarContent.includes("href: '/finance/vendors'"), 'Vendors route should be removed from sidebar');
    assert.ok(sidebarContent.includes("href: '/finance/expenses'"), 'Expenses route missing from sidebar');
    assert.ok(sidebarContent.includes("href: '/finance/utilities'"), 'Utilities route missing from sidebar');
    assert.ok(sidebarContent.includes("href: '/finance/profitability'"), 'Profitability route missing from sidebar');
  });

  test('Old Vendors page performs redirect to /finance/purchases?view=vendors', () => {
    const vendorsPageContent = fs.readFileSync(path.resolve(process.cwd(), 'src/app/finance/vendors/page.tsx'), 'utf8');
    assert.ok(vendorsPageContent.includes("redirect('/finance/purchases?view=vendors')"), 'Redirect missing in /finance/vendors/page.tsx');
  });

  test('RBAC grants access to /finance/purchases with finance.purchases or finance.vendors', () => {
    assert.equal(hasPermission('Viewer', ['finance.purchases'], 'finance.purchases'), true);
    assert.equal(hasPermission('Viewer', ['finance.vendors'], 'finance.purchases'), true);
    assert.equal(hasPermission('Viewer', ['finance.purchases'], 'finance.vendors'), true);
    assert.equal(hasPermission('Viewer', ['inventory.stock'], 'finance.purchases'), false);
    assert.equal(hasPermission('Admin', [], 'finance.purchases'), true);
  });

  // --- Group 2: Database Vendor Summaries & KPI Invariants ---
  console.log('\n📌 Test Group 2: Vendor Financial Summaries & KPI Invariants');

  await asyncTest('Vendor summary balances match purchase headers and payments', async () => {
    const { data: vSummaries, error: sErr } = await supabase.from('vendor_outstanding_summary').select('*');
    assert.ifError(sErr);
    assert.ok(vSummaries && vSummaries.length > 0, 'No vendors returned from summary');

    const { data: pHeaders, error: pErr } = await supabase.from('purchase_headers').select('vendor_id, net_amount');
    assert.ifError(pErr);

    const { data: payments, error: payErr } = await supabase.from('vendor_payments').select('vendor_id, amount');
    assert.ifError(payErr);

    for (const v of vSummaries) {
      const expectedPurchased: number = (pHeaders || [])
        .filter((p: any) => p.vendor_id === v.vendor_id)
        .reduce((sum: number, p: any) => sum + Number(p.net_amount), 0);
      const expectedPaid: number = (payments || [])
        .filter((pay: any) => pay.vendor_id === v.vendor_id)
        .reduce((sum: number, pay: any) => sum + Number(pay.amount), 0);
      const expectedBalance: number = expectedPurchased - expectedPaid;

      assert.equal(
        Math.round(Number(v.total_purchased) * 100) / 100,
        Math.round(expectedPurchased * 100) / 100,
        `Purchased mismatch for vendor ${v.vendor_name}`
      );
      assert.equal(
        Math.round(Number(v.total_paid) * 100) / 100,
        Math.round(expectedPaid * 100) / 100,
        `Paid mismatch for vendor ${v.vendor_name}`
      );
      assert.equal(
        Math.round(Number(v.outstanding_balance) * 100) / 100,
        Math.round(expectedBalance * 100) / 100,
        `Balance mismatch for vendor ${v.vendor_name}`
      );
    }
  });

  // --- Group 3: Aniket Dairy Discrepancy Invariant ---
  console.log('\n📌 Test Group 3: Aniket Dairy & Historical Vendors Consistency');

  await asyncTest('Aniket Dairy all-time totals are consistent and accurate', async () => {
    const { data: aniketList } = await supabase.from('vendors').select('*').ilike('name', '%Aniket%');
    assert.ok(aniketList && aniketList.length > 0, 'Aniket Dairy not found');
    const aniket = aniketList[0];

    const { data: aniketSummary } = await supabase.from('vendor_outstanding_summary').select('*').eq('vendor_id', aniket.id).single();
    assert.ok(aniketSummary, 'Aniket Dairy missing from summary');

    assert.equal(Number(aniketSummary.total_purchased), 1420, 'Aniket total_purchased should be 1420');
    assert.equal(Number(aniketSummary.total_paid), 0, 'Aniket total_paid should be 0');
    assert.equal(Number(aniketSummary.outstanding_balance), 1420, 'Aniket outstanding_balance should be 1420');

    // Verify vendor detail component uses totalPurchasedAllTime and totalPaidAllTime
    const vendorDetailCode = fs.readFileSync(path.resolve(process.cwd(), 'src/app/finance/vendors/[id]/page.tsx'), 'utf8');
    assert.ok(
      vendorDetailCode.includes('formatINR(summaryMetrics.totalPurchasedAllTime)'),
      'Vendor detail must render totalPurchasedAllTime'
    );
    assert.ok(
      vendorDetailCode.includes('formatINR(summaryMetrics.totalPaidAllTime)'),
      'Vendor detail must render totalPaidAllTime'
    );
    assert.ok(
      !vendorDetailCode.includes('formatINR(summaryMetrics.purchasedThisMonth)'),
      'Vendor detail must not bind KPI Card 1 to monthly figure'
    );
  });

  // --- Group 4: Purchase Invoices View Invariants ---
  console.log('\n📌 Test Group 4: Purchase Invoices View & Allocation Invariants');

  await asyncTest('Purchase invoices query returns headers with valid line counts and payment allocations', async () => {
    const { data: pData, error } = await supabase
      .from('purchase_headers')
      .select(`
        id,
        purchase_number,
        invoice_number,
        purchase_date,
        net_amount,
        vendor_id,
        vendors (
          name
        ),
        purchase_lines (
          id,
          quantity,
          rate,
          total_amount
        ),
        vendor_payment_allocations (
          amount_allocated
        )
      `);
    assert.ifError(error);
    assert.ok(pData && pData.length > 0, 'No purchase headers found');

    for (const p of pData) {
      assert.ok(p.purchase_number, 'Missing purchase_number');
      assert.ok(Number(p.net_amount) >= 0, 'Net amount must be non-negative');
      const allocated = (p.vendor_payment_allocations || []).reduce((sum: number, a: any) => sum + Number(a.amount_allocated), 0);
      assert.ok(allocated >= 0, 'Allocated payment must be non-negative');
      assert.ok(allocated <= Number(p.net_amount) + 0.01, 'Allocated payment should not exceed net amount');
    }
  });

  // --- Group 5: Breadcrumb & Deep Link Invariants ---
  console.log('\n📌 Test Group 5: Vendor Detail Breadcrumb & Navigation Invariants');

  test('Vendor Detail breadcrumbs and back buttons point to /finance/purchases?view=vendors', () => {
    const vendorDetailCode = fs.readFileSync(path.resolve(process.cwd(), 'src/app/finance/vendors/[id]/page.tsx'), 'utf8');
    assert.ok(
      vendorDetailCode.includes('href="/finance/purchases?view=vendors"'),
      'Vendor Detail back button or breadcrumb must link to /finance/purchases?view=vendors'
    );
    assert.ok(
      !vendorDetailCode.includes('href="/finance/vendors"'),
      'Vendor Detail should not link to standalone /finance/vendors'
    );
  });

  // --- Group 6: Top Summary & Layout Invariants ---
  console.log('\n📌 Test Group 6: Consolidated Purchases Page Invariants');

  test('PurchasesPage renders 4 summary cards and excludes FIFO settlement box', () => {
    const purchasesPageCode = fs.readFileSync(path.resolve(process.cwd(), 'src/app/finance/purchases/page.tsx'), 'utf8');
    assert.ok(purchasesPageCode.includes("t('purchases.bills.outstanding')"), 'Missing Outstanding KPI card');
    assert.ok(purchasesPageCode.includes("t('purchases.kpi.totalPurchased')"), 'Missing Total Purchased KPI card');
    assert.ok(purchasesPageCode.includes("t('purchases.kpi.totalPaid')"), 'Missing Total Paid KPI card');
    assert.ok(purchasesPageCode.includes("t('purchases.bills.activeVendors')"), 'Missing Active Vendors KPI card');
    assert.ok(!purchasesPageCode.includes("fifoAllocation"), 'FIFO allocation text box should be removed');
    assert.ok(purchasesPageCode.includes("<VendorsView"), 'Missing VendorsView tab component');
    assert.ok(purchasesPageCode.includes("<PurchaseInvoicesView"), 'Missing PurchaseInvoicesView tab component');
  });

  console.log('\n================================================================');
  console.log(`🏁 SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});
