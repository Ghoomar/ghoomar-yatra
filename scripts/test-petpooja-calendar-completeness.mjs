/**
 * Petpooja Completeness Calendar - Regression & Validation Test Suite
 * Tests month calculation, status matrix derivation, summary counters,
 * business_date vs upload timestamp handling, and live September 2026 data.
 */

import { strict as assert } from 'assert';
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

console.log('================================================================');
console.log('🧪 PETPOOJA REPORT COMPLETENESS CALENDAR VALIDATION SUITE');
console.log('================================================================\n');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    testsFailed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    testsFailed++;
  }
}

// -----------------------------------------------------------------------------
// 1. MONTH CALCULATION & WEEKDAY POSITIONING TESTS
// -----------------------------------------------------------------------------
console.log('📌 Test Group 1: Month Calculation & Weekday Positioning');

function getMonthCoordinates(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDayJs = new Date(y, m - 1, 1).getDay(); // 0 is Sun, 1 is Mon...
  const startOffset = firstDayJs === 0 ? 6 : firstDayJs - 1; // Mon = 0 ... Sun = 6
  return { year: y, month: m, daysInMonth, startOffset };
}

function getPrevMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
}

function getNextMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const nextDate = new Date(y, m, 1);
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
}

test('September 2026 has exactly 30 days and starts on Tuesday (offset = 1)', () => {
  const coords = getMonthCoordinates('2026-09');
  assert.equal(coords.daysInMonth, 30);
  assert.equal(coords.startOffset, 1); // 1st is Tuesday -> offset 1 from Monday
});

test('October 2026 has exactly 31 days and starts on Thursday (offset = 3)', () => {
  const coords = getMonthCoordinates('2026-10');
  assert.equal(coords.daysInMonth, 31);
  assert.equal(coords.startOffset, 3); // 1st is Thursday -> offset 3 from Monday
});

test('February 2024 leap year has 29 days vs February 2025 has 28 days', () => {
  assert.equal(getMonthCoordinates('2024-02').daysInMonth, 29);
  assert.equal(getMonthCoordinates('2025-02').daysInMonth, 28);
});

test('Previous month navigation: 2026-09 -> 2026-08', () => {
  assert.equal(getPrevMonth('2026-09'), '2026-08');
});

test('Next month navigation: 2026-09 -> 2026-10', () => {
  assert.equal(getNextMonth('2026-09'), '2026-10');
});

test('Year boundary backward navigation: 2026-01 -> 2025-12', () => {
  assert.equal(getPrevMonth('2026-01'), '2025-12');
});

test('Year boundary forward navigation: 2025-12 -> 2026-01', () => {
  assert.equal(getNextMonth('2025-12'), '2026-01');
});

// -----------------------------------------------------------------------------
// 2. REPORT STATUS & SUMMARY METRICS CALCULATION
// -----------------------------------------------------------------------------
console.log('\n📌 Test Group 2: Report Status Matrix & Summary Counters');

const DAILY_REPORTS = [
  'ITEM_ORDER_DETAILS',
  'HOURLY_ITEM_SALES',
  'ORDERS_MASTER',
  'EXECUTIVE_SUMMARY',
];

function deriveCalendarMatrix(monthStr, batches, todayDateStr) {
  const { year, month, daysInMonth } = getMonthCoordinates(monthStr);

  const batchMap = new Map();
  batches.forEach((b) => {
    if (b.business_date && b.report_type) {
      batchMap.set(`${b.business_date}|${b.report_type}`, b);
    }
  });

  const days = [];
  let totalImported = 0;
  let completeDays = 0;
  let expectedDays = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isFuture = dateStr > todayDateStr;
    const isToday = dateStr === todayDateStr;

    if (!isFuture) {
      expectedDays += 1;
    }

    let dayImported = 0;
    const reports = {};

    DAILY_REPORTS.forEach((type) => {
      const exists = batchMap.has(`${dateStr}|${type}`);
      if (exists) {
        dayImported += 1;
        totalImported += 1;
      }

      let status = 'pending';
      if (isFuture) {
        status = 'future';
      } else if (exists) {
        status = 'imported';
      } else {
        status = 'pending';
      }
      reports[type] = status;
    });

    const isComplete = dayImported === 4;
    if (isComplete && !isFuture) {
      completeDays += 1;
    }

    days.push({
      dateStr,
      isFuture,
      isToday,
      isComplete,
      dayImported,
      reports,
    });
  }

  return {
    days,
    totalImported,
    totalExpected: expectedDays * 4,
    completeDays,
    expectedDays,
    daysInMonth,
  };
}

test('Status states: imported (green), missing (red pending), future (neutral grey)', () => {
  const mockBatches = [
    { business_date: '2026-10-01', report_type: 'ITEM_ORDER_DETAILS' },
    { business_date: '2026-10-01', report_type: 'HOURLY_ITEM_SALES' },
  ];
  // Pretend today is 2026-10-02
  const matrix = deriveCalendarMatrix('2026-10', mockBatches, '2026-10-02');

  // Oct 1 (past date)
  const oct1 = matrix.days.find((d) => d.dateStr === '2026-10-01');
  assert.equal(oct1.reports['ITEM_ORDER_DETAILS'], 'imported');
  assert.equal(oct1.reports['HOURLY_ITEM_SALES'], 'imported');
  assert.equal(oct1.reports['ORDERS_MASTER'], 'pending');
  assert.equal(oct1.reports['EXECUTIVE_SUMMARY'], 'pending');
  assert.equal(oct1.isComplete, false); // Partial: only 2/4

  // Oct 2 (today, missing all)
  const oct2 = matrix.days.find((d) => d.dateStr === '2026-10-02');
  assert.equal(oct2.reports['ORDERS_MASTER'], 'pending');

  // Oct 3 (future date)
  const oct3 = matrix.days.find((d) => d.dateStr === '2026-10-03');
  assert.equal(oct3.reports['ITEM_ORDER_DETAILS'], 'future');
  assert.equal(oct3.reports['HOURLY_ITEM_SALES'], 'future');
  assert.equal(oct3.reports['ORDERS_MASTER'], 'future');
  assert.equal(oct3.reports['EXECUTIVE_SUMMARY'], 'future');
  assert.equal(oct3.isFuture, true);
});

test('Duplicates in batches table do not inflate imported count', () => {
  const duplicateBatches = [
    { business_date: '2026-09-15', report_type: 'ITEM_ORDER_DETAILS', id: '1' },
    { business_date: '2026-09-15', report_type: 'ITEM_ORDER_DETAILS', id: '2' }, // duplicate upload
    { business_date: '2026-09-15', report_type: 'HOURLY_ITEM_SALES', id: '3' },
    { business_date: '2026-09-15', report_type: 'ORDERS_MASTER', id: '4' },
    { business_date: '2026-09-15', report_type: 'EXECUTIVE_SUMMARY', id: '5' },
  ];
  const matrix = deriveCalendarMatrix('2026-09', duplicateBatches, '2026-10-01');
  assert.equal(matrix.totalImported, 4, 'Total imported is 4 (duplicate excluded)');
  assert.equal(matrix.completeDays, 1, 'Sep 15 is 1 complete day');
});

test('Business date places report in calendar, not created_at timestamp', () => {
  const uploadedLateBatches = [
    {
      business_date: '2026-09-30',
      report_type: 'ORDERS_MASTER',
      created_at: '2026-10-01T10:00:00Z', // uploaded in October for September date
    },
  ];
  const matrix = deriveCalendarMatrix('2026-09', uploadedLateBatches, '2026-10-01');
  const sep30 = matrix.days.find((d) => d.dateStr === '2026-09-30');
  assert.equal(sep30.reports['ORDERS_MASTER'], 'imported');

  // Should NOT be in October matrix
  const octMatrix = deriveCalendarMatrix('2026-10', uploadedLateBatches, '2026-10-01');
  const oct1 = octMatrix.days.find((d) => d.dateStr === '2026-10-01');
  assert.equal(oct1.reports['ORDERS_MASTER'], 'pending');
});

test('Current month denominator on October 1 excludes future dates (4/4 reports and 1/1 days)', () => {
  // On October 1, if all 4 reports for Oct 1 are uploaded
  const oct1Batches = [
    { business_date: '2026-10-01', report_type: 'ITEM_ORDER_DETAILS' },
    { business_date: '2026-10-01', report_type: 'HOURLY_ITEM_SALES' },
    { business_date: '2026-10-01', report_type: 'ORDERS_MASTER' },
    { business_date: '2026-10-01', report_type: 'EXECUTIVE_SUMMARY' },
  ];
  const matrix = deriveCalendarMatrix('2026-10', oct1Batches, '2026-10-01');

  // Days 2..31 are future, so expectedDays is 1, totalExpected is 4
  assert.equal(matrix.expectedDays, 1, 'Expected days is 1 on Oct 1');
  assert.equal(matrix.totalExpected, 4, 'Expected reports is 4 on Oct 1');
  assert.equal(matrix.totalImported, 4, 'Imported reports is 4');
  assert.equal(matrix.completeDays, 1, 'Complete days is 1');
});

test('Future month has 0 expected reports and 0 expected days', () => {
  // If viewing November 2026 when today is 2026-10-01
  const matrix = deriveCalendarMatrix('2026-11', [], '2026-10-01');
  assert.equal(matrix.expectedDays, 0, 'Future month has 0 expected days');
  assert.equal(matrix.totalExpected, 0, 'Future month has 0 expected reports');
  assert.equal(matrix.totalImported, 0);
  assert.equal(matrix.completeDays, 0);
});

test('MonthlyReportCalendar component delegates day evaluation strictly to shared helper', () => {
  const calContent = fs.readFileSync('src/components/sales/MonthlyReportCalendar.tsx', 'utf8');
  assert.ok(
    calContent.includes('evaluatePetpoojaReportStatus'),
    'MonthlyReportCalendar must import evaluatePetpoojaReportStatus'
  );
  assert.ok(
    calContent.includes('evaluatePetpoojaReportStatus(dateStr, importedTypes, todayStr)'),
    'MonthlyReportCalendar must evaluate days using evaluatePetpoojaReportStatus'
  );
});

// -----------------------------------------------------------------------------
// 3. LIVE DATABASE AUDIT FOR SEPTEMBER 2026
// -----------------------------------------------------------------------------
console.log('\n📌 Test Group 3: Live Database Completeness Verification (September 2026)');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log('  ⚠️ Supabase environment variables missing; skipping live DB test');
} else {
  const supabase = createClient(supabaseUrl, supabaseKey);

  await asyncTest('Live DB: September 2026 batches fetch produces exactly 112 reports across 28 days', async () => {
    const { data: batches, error } = await supabase
      .from('sales_import_batches')
      .select('*')
      .gte('business_date', '2026-09-01')
      .lte('business_date', '2026-09-30');

    assert.ifError(error);
    assert.ok(batches && batches.length >= 112, `Found ${batches?.length} batches in Sep 2026 (expected at least 112)`);

    const matrix = deriveCalendarMatrix('2026-09', batches, '2026-10-01');

    assert.equal(matrix.totalExpected, 120, 'September expected 120 total reports (30 days * 4)');
    assert.equal(matrix.totalImported, 112, 'September actual imported reports equals 112');
    assert.equal(matrix.completeDays, 28, 'September complete days equals 28 (Sep 3 to Sep 30)');
    assert.equal(matrix.daysInMonth, 30, 'September total calendar days equals 30');

    // Verify Sep 1 and Sep 2 are missing
    const sep1 = matrix.days.find((d) => d.dateStr === '2026-09-01');
    assert.equal(sep1.isComplete, false);
    assert.equal(sep1.dayImported, 0);
    assert.equal(sep1.reports['ITEM_ORDER_DETAILS'], 'pending');

    const sep2 = matrix.days.find((d) => d.dateStr === '2026-09-02');
    assert.equal(sep2.isComplete, false);
    assert.equal(sep2.dayImported, 0);

    // Verify Sep 3 through Sep 30 are 100% complete
    for (let d = 3; d <= 30; d++) {
      const dateStr = `2026-09-${String(d).padStart(2, '0')}`;
      const day = matrix.days.find((x) => x.dateStr === dateStr);
      assert.ok(day, `Day ${dateStr} exists in matrix`);
      assert.equal(day.isComplete, true, `Day ${dateStr} is complete`);
      assert.equal(day.dayImported, 4, `Day ${dateStr} has 4 imported reports`);
      assert.equal(day.reports['ITEM_ORDER_DETAILS'], 'imported');
      assert.equal(day.reports['HOURLY_ITEM_SALES'], 'imported');
      assert.equal(day.reports['ORDERS_MASTER'], 'imported');
      assert.equal(day.reports['EXECUTIVE_SUMMARY'], 'imported');
    }
  });

  await asyncTest('Live DB: Menu Master export is never included in calendar completeness counts', async () => {
    const { data: menuBatches } = await supabase
      .from('sales_import_batches')
      .select('*')
      .eq('report_type', 'MENU_MASTER');

    // Menu master batches (if any) have business_date null or ignored
    const matrix = deriveCalendarMatrix('2026-09', menuBatches || [], '2026-10-01');
    assert.equal(matrix.totalImported, 0, 'Menu master does not contribute to daily report calendar');
  });
}

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`🏁 PETPOOJA CALENDAR RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('================================================================\n');

if (testsFailed > 0) {
  process.exit(1);
}
