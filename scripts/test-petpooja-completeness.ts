/**
 * Petpooja Shared Completeness & Due-Date Rule Test Suite
 *
 * Covers the 11 mandatory validation scenarios:
 * 1. All 4 reports present -> complete/uploaded
 * 2. 3 of 4 present -> incomplete, with the missing report identified
 * 3. 0 of 4 present before the due date -> not yet due (pending / upcoming)
 * 4. Missing reports after the due date -> overdue
 * 5. Future report date -> upcoming (N/A)
 * 6. Exactly the due-date boundary -> dueToday (Due Today / Pending)
 * 7. MENU_MASTER present but four required reports absent -> incomplete (0/4)
 * 8. MENU_MASTER present alongside all four required reports -> complete (4/4)
 * 9. Daily Operations date conversion: Oct 2 operational date -> Oct 1 Petpooja report date
 * 10. Daily Operations date conversion: Oct 1 operational date -> Sep 30 Petpooja report date
 * 11. Month/calendar denominator behavior: future dates must not be counted as expected reports
 */

import { strict as assert } from 'assert';
import {
  REQUIRED_PETPOOJA_DAILY_REPORTS,
  DAILY_REPORT_CONFIG,
  getPetpoojaDueDate,
  getPreviousPetpoojaReportDate,
  evaluatePetpoojaReportStatus,
} from '../src/lib/sales/petpooja-completeness';

console.log('================================================================');
console.log('🧪 PETPOOJA SHARED BUSINESS-RULE & COMPLETENESS TEST SUITE');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function it(desc: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${desc}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${desc}:`, err.message);
    failed++;
  }
}

// -------------------------------------------------------------
// Scenario 1: All 4 reports present -> complete/uploaded
// -------------------------------------------------------------
it('Scenario 1: All 4 reports present -> complete / uploaded', () => {
  const result = evaluatePetpoojaReportStatus(
    '2026-09-30',
    ['ITEM_ORDER_DETAILS', 'HOURLY_ITEM_SALES', 'ORDERS_MASTER', 'EXECUTIVE_SUMMARY'],
    '2026-10-01'
  );

  assert.equal(result.isComplete, true);
  assert.equal(result.importedCount, 4);
  assert.equal(result.missingReportTypes.length, 0);
  assert.equal(result.status, 'uploaded');
  assert.equal(result.reports['ITEM_ORDER_DETAILS'].status, 'imported');
  assert.equal(result.reports['HOURLY_ITEM_SALES'].status, 'imported');
  assert.equal(result.reports['ORDERS_MASTER'].status, 'imported');
  assert.equal(result.reports['EXECUTIVE_SUMMARY'].status, 'imported');
});

// -------------------------------------------------------------
// Scenario 2: 3 of 4 present -> incomplete, missing identified
// -------------------------------------------------------------
it('Scenario 2: 3 of 4 present -> incomplete with missing report identified', () => {
  const result = evaluatePetpoojaReportStatus(
    '2026-09-30',
    ['ITEM_ORDER_DETAILS', 'HOURLY_ITEM_SALES', 'EXECUTIVE_SUMMARY'], // missing ORDERS_MASTER
    '2026-10-01'
  );

  assert.equal(result.isComplete, false);
  assert.equal(result.importedCount, 3);
  assert.deepEqual(result.missingReportTypes, ['ORDERS_MASTER']);
  assert.equal(result.reports['ORDERS_MASTER'].isImported, false);
  assert.equal(result.reports['ORDERS_MASTER'].status, 'pending');
  assert.equal(result.reports['EXECUTIVE_SUMMARY'].status, 'imported');
});

// -------------------------------------------------------------
// Scenario 3: 0 of 4 present before the due date -> not-yet-due
// -------------------------------------------------------------
it('Scenario 3: 0 of 4 present before the due date (referenceDate < dueDate) -> upcoming / pending', () => {
  // Report date: 2026-10-01. Due date is 2026-10-02.
  // Evaluation on 2026-10-01 (before due date):
  const result = evaluatePetpoojaReportStatus('2026-10-01', [], '2026-10-01');

  assert.equal(result.dueDate, '2026-10-02');
  assert.equal(result.isComplete, false);
  assert.equal(result.isBeforeDue, true);
  assert.equal(result.isDueToday, false);
  assert.equal(result.isOverdue, false);
  assert.equal(result.status, 'upcoming');
  // Report items are pending since date is not strictly future
  assert.equal(result.reports['EXECUTIVE_SUMMARY'].status, 'pending');
});

// -------------------------------------------------------------
// Scenario 4: Missing reports after the due date -> overdue
// -------------------------------------------------------------
it('Scenario 4: Missing reports after the due date (referenceDate > dueDate) -> overdue', () => {
  // Report date: 2026-09-30. Due date is 2026-10-01.
  // Evaluation on 2026-10-02 (past due date):
  const result = evaluatePetpoojaReportStatus('2026-09-30', ['ITEM_ORDER_DETAILS'], '2026-10-02');

  assert.equal(result.dueDate, '2026-10-01');
  assert.equal(result.isComplete, false);
  assert.equal(result.isOverdue, true);
  assert.equal(result.isDueToday, false);
  assert.equal(result.status, 'overdue');
});

// -------------------------------------------------------------
// Scenario 5: Future report date -> upcoming (N/A)
// -------------------------------------------------------------
it('Scenario 5: Future report date (reportDate > referenceDate) -> upcoming', () => {
  // Reference date: 2026-10-01. Report date: 2026-10-05.
  const result = evaluatePetpoojaReportStatus('2026-10-05', [], '2026-10-01');

  assert.equal(result.isFuture, true);
  assert.equal(result.isComplete, false);
  assert.equal(result.status, 'upcoming');
  assert.equal(result.reports['EXECUTIVE_SUMMARY'].status, 'future');
  assert.equal(result.reports['ORDERS_MASTER'].status, 'future');
});

// -------------------------------------------------------------
// Scenario 6: Exactly the due-date boundary -> dueToday
// -------------------------------------------------------------
it('Scenario 6: Exactly the due-date boundary (referenceDate === dueDate) -> dueToday', () => {
  // Report date: 2026-09-30. Due date is 2026-10-01.
  // Evaluation on 2026-10-01:
  const result = evaluatePetpoojaReportStatus('2026-09-30', [], '2026-10-01');

  assert.equal(result.dueDate, '2026-10-01');
  assert.equal(result.referenceDate, '2026-10-01');
  assert.equal(result.isDueToday, true);
  assert.equal(result.isOverdue, false);
  assert.equal(result.status, 'dueToday');
});

// -------------------------------------------------------------
// Scenario 7: MENU_MASTER present but the four required reports absent -> incomplete
// -------------------------------------------------------------
it('Scenario 7: MENU_MASTER present but 4 daily reports absent -> incomplete (0/4)', () => {
  const result = evaluatePetpoojaReportStatus('2026-09-30', ['MENU_MASTER'], '2026-10-01');

  assert.equal(result.isComplete, false);
  assert.equal(result.importedCount, 0);
  assert.equal(result.missingReportTypes.length, 4);
});

// -------------------------------------------------------------
// Scenario 8: MENU_MASTER present alongside all four required reports -> complete
// -------------------------------------------------------------
it('Scenario 8: MENU_MASTER present alongside all four required reports -> complete (4/4)', () => {
  const result = evaluatePetpoojaReportStatus(
    '2026-09-30',
    ['MENU_MASTER', 'ITEM_ORDER_DETAILS', 'HOURLY_ITEM_SALES', 'ORDERS_MASTER', 'EXECUTIVE_SUMMARY'],
    '2026-10-01'
  );

  assert.equal(result.isComplete, true);
  assert.equal(result.importedCount, 4);
  assert.equal(result.status, 'uploaded');
});

// -------------------------------------------------------------
// Scenario 9: Daily Operations date conversion: Oct 2 operational -> Oct 1 report date
// -------------------------------------------------------------
it('Scenario 9: Daily Operations date conversion: Oct 2 operational date -> Oct 1 Petpooja report date', () => {
  const operationalDate = '2026-10-02';
  const reportDate = getPreviousPetpoojaReportDate(operationalDate);
  assert.equal(reportDate, '2026-10-01');
  assert.equal(getPetpoojaDueDate(reportDate), '2026-10-02');
});

// -------------------------------------------------------------
// Scenario 10: Daily Operations date conversion: Oct 1 operational -> Sep 30 report date
// -------------------------------------------------------------
it('Scenario 10: Daily Operations date conversion: Oct 1 operational date -> Sep 30 Petpooja report date', () => {
  const operationalDate = '2026-10-01';
  const reportDate = getPreviousPetpoojaReportDate(operationalDate);
  assert.equal(reportDate, '2026-09-30');
  assert.equal(getPetpoojaDueDate(reportDate), '2026-10-01');
});

// -------------------------------------------------------------
// Scenario 11: Month/calendar denominator behavior: future dates excluded from expected reports
// -------------------------------------------------------------
it('Scenario 11: Month/calendar denominator behavior: future dates excluded from expected reports', () => {
  // Simulate an October 2026 calendar where today is Oct 1, and Oct 1 has all 4 reports
  const todayStr = '2026-10-01';
  const daysInMonth = 31;
  let expectedDays = 0;
  let completeDays = 0;
  let totalImported = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `2026-10-${String(d).padStart(2, '0')}`;
    const importedForDay = dateStr === '2026-10-01'
      ? ['ITEM_ORDER_DETAILS', 'HOURLY_ITEM_SALES', 'ORDERS_MASTER', 'EXECUTIVE_SUMMARY']
      : [];

    const evalResult = evaluatePetpoojaReportStatus(dateStr, importedForDay, todayStr);

    if (!evalResult.isFuture) {
      expectedDays += 1;
    }
    totalImported += evalResult.importedCount;
    if (evalResult.isComplete && !evalResult.isFuture) {
      completeDays += 1;
    }
  }

  const expectedReports = expectedDays * 4;

  // On Oct 1: exactly 1 expected day (Oct 1), 30 future days excluded
  assert.equal(expectedDays, 1, 'Expected days should be 1');
  assert.equal(expectedReports, 4, 'Expected reports should be 4 (1 * 4), NOT 124 (31 * 4)');
  assert.equal(totalImported, 4, 'Total imported should be 4');
  assert.equal(completeDays, 1, 'Complete days should be 1');
});

console.log('\n================================================================');
console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
