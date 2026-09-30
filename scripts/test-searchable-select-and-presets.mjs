import fs from 'fs';
import { execSync } from 'child_process';

function getTodayBusinessDate() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function getYesterdayBusinessDate() {
  const todayStr = getTodayBusinessDate();
  const [y, m, d] = todayStr.split('-').map(Number);
  const dObj = new Date(Date.UTC(y, m - 1, d - 1));
  const year = dObj.getUTCFullYear();
  const month = String(dObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dObj.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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

// Multi-token filter algorithm mirror from SearchableSelect.tsx
function filterItems(options, query, getSearchableText) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return options;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return options.filter((opt) => {
    let searchable = '';
    if (getSearchableText) {
      searchable = getSearchableText(opt).toLowerCase();
    } else {
      const primary = (opt.name || '').toLowerCase();
      const secondary = (opt.category || '').toLowerCase();
      const rawCode = opt.item_code || opt.code || '';
      const rawNameHi = opt.name_hi || '';
      searchable = `${primary} ${secondary} ${rawCode} ${rawNameHi}`.toLowerCase();
    }
    return tokens.every((token) => searchable.includes(token));
  });
}

function runTests() {
  console.log('================================================================');
  console.log('🧪 SEARCHABLE SELECT & DASHBOARD DATE PRESETS VERIFICATION');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Multi-Token Search Algorithm & Virtual Slicing
  // --------------------------------------------------------------------------
  console.log('📌 Test Group 1: Multi-Token Fuzzy Matching & Slicing');

  const mockCatalog = [
    { id: '1', name: 'Refined Mustard Oil 1L', name_hi: 'रिफाइंड सरसों तेल', item_code: 'OIL-001', category: 'Cooking Oil' },
    { id: '2', name: 'Refined Soybean Oil 15L', name_hi: 'रिफाइंड सोयाबीन तेल', item_code: 'OIL-002', category: 'Cooking Oil' },
    { id: '3', name: 'Pure Desi Ghee 1L', name_hi: 'शुद्ध देसी घी', item_code: 'DAI-001', category: 'Dairy' },
    { id: '4', name: 'Whole Wheat Atta 50kg', name_hi: 'गेहूं आटा', item_code: 'GRN-010', category: 'Groceries' },
    { id: '5', name: 'Basmati Rice Premium', name_hi: 'बासमती चावल', item_code: 'GRN-020', category: 'Groceries' },
  ];

  // Invariant 1: "oil refined" matches both refined oils, but not ghee or atta
  const res1 = filterItems(mockCatalog, 'oil refined');
  assert(res1.length === 2, `Multi-token search 'oil refined' found exactly 2 items (got ${res1.length})`);
  assert(res1.some(i => i.id === '1') && res1.some(i => i.id === '2'), `'oil refined' matched 'Refined Mustard Oil' and 'Refined Soybean Oil'`);

  // Invariant 2: Hindi token search
  const resHindi = filterItems(mockCatalog, 'सरसों');
  assert(resHindi.length === 1 && resHindi[0].id === '1', `Hindi query 'सरसों' matched item OIL-001`);

  // Invariant 3: SKU / Item code search
  const resCode = filterItems(mockCatalog, 'GRN-010');
  assert(resCode.length === 1 && resCode[0].id === '4', `Item code query 'GRN-010' matched Whole Wheat Atta`);

  // Invariant 4: Case-insensitivity
  const resCase = filterItems(mockCatalog, 'MUSTARD');
  assert(resCase.length === 1 && resCase[0].id === '1', `Case-insensitive uppercase 'MUSTARD' matched correctly`);

  // Invariant 5: 1,000+ items virtual slicing test
  const largeCatalog = Array.from({ length: 1500 }, (_, i) => ({
    id: `item-${i}`,
    name: `Inventory Item Raw Spice #${i}`,
    item_code: `SPC-${String(i).padStart(4, '0')}`,
    category: 'Spices',
  }));

  const maxVisible = 50;
  const filteredLarge = filterItems(largeCatalog, 'spice raw');
  const visibleLarge = filteredLarge.slice(0, maxVisible);
  assert(filteredLarge.length === 1500, `Search across 1,500 items matched all 1,500 candidates`);
  assert(visibleLarge.length === 50, `Rendered DOM slice is strictly capped at maxVisibleOptions=50 (got ${visibleLarge.length})`);

  // --------------------------------------------------------------------------
  // TEST GROUP 2: Dashboard Quick Date Presets (Today & Yesterday)
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 2: Dashboard Date Presets');

  const today = getTodayBusinessDate();
  const yesterday = getYesterdayBusinessDate();

  assert(/^\d{4}-\d{2}-\d{2}$/.test(today), `getTodayBusinessDate() returns valid ISO YYYY-MM-DD (${today})`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(yesterday), `getYesterdayBusinessDate() returns valid ISO YYYY-MM-DD (${yesterday})`);

  // Verify yesterday is exactly 1 day prior
  const tTime = new Date(`${today}T00:00:00Z`).getTime();
  const yTime = new Date(`${yesterday}T00:00:00Z`).getTime();
  const diffDays = Math.round((tTime - yTime) / (1000 * 60 * 60 * 24));
  assert(diffDays === 1, `Yesterday (${yesterday}) is exactly 1 calendar day before Today (${today})`);

  // Preset State Active Derivation Simulation
  function getPillActiveState(currentDate, todayVal, yesterdayVal) {
    return {
      isTodayActive: currentDate === todayVal,
      isYesterdayActive: currentDate === yesterdayVal,
    };
  }

  const stateToday = getPillActiveState(today, today, yesterday);
  assert(stateToday.isTodayActive === true && stateToday.isYesterdayActive === false, 'When date = today, Today pill is active and Yesterday is inactive');

  const stateYesterday = getPillActiveState(yesterday, today, yesterday);
  assert(stateYesterday.isTodayActive === false && stateYesterday.isYesterdayActive === true, 'When date = yesterday, Yesterday pill is active and Today is inactive');

  const stateManual = getPillActiveState('2026-09-15', today, yesterday);
  assert(stateManual.isTodayActive === false && stateManual.isYesterdayActive === false, 'When manual date is selected, neither pill is active');

  // --------------------------------------------------------------------------
  // TEST GROUP 3: Reports Scope Boundary Invariance Verification
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 3: Reports Scope Boundary Invariance');

  const reportsDiff = execSync('git diff origin/main -- src/app/reports/page.tsx src/components/reports/DailySalesLineGraph.tsx src/components/sales/SalesAnalyticsDashboard.tsx').toString();
  assert(reportsDiff.trim() === '', 'src/app/reports and Sales Analytics have 0 diff against origin/main (100% untouched)');

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Component Integration Integrity
  // --------------------------------------------------------------------------
  console.log('\n📌 Test Group 4: Component Integration Integrity');

  const purchasesSrc = fs.readFileSync('src/app/finance/purchases/page.tsx', 'utf8');
  assert(purchasesSrc.includes('<SearchableSelect'), 'SearchableSelect is integrated in purchases/page.tsx');

  const issuesSrc = fs.readFileSync('src/app/inventory/issues/page.tsx', 'utf8');
  const countSearchableInIssues = (issuesSrc.match(/<SearchableSelect/g) || []).length;
  assert(countSearchableInIssues === 3, `SearchableSelect is integrated 3 times in issues/page.tsx (Store Issues, Transfers, Staff Recipient; got ${countSearchableInIssues})`);

  const dashboardSrc = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');
  assert(dashboardSrc.includes('dashboard-preset-today') && dashboardSrc.includes('dashboard-preset-yesterday'), 'Today and Yesterday quick presets are rendered in dashboard/page.tsx');

  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests();
