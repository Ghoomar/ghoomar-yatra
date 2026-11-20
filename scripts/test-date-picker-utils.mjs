import assert from 'node:assert/strict';
import {
  formatToDisplay,
  parseDisplayToISO,
  validateAndBuildISO,
  getDaysInMonth,
  getTodayISO,
  getYesterdayISO,
  getCalendarGrid,
  isDateDisabled,
} from '../src/lib/date/date-picker-utils.ts';

console.log('🧪 Testing date-picker-utils...');

// 1. formatToDisplay
assert.equal(formatToDisplay('2026-11-20'), '20-11-2026');
assert.equal(formatToDisplay('2026-10-31'), '31-10-2026');
assert.equal(formatToDisplay(''), '');
assert.equal(formatToDisplay(null), '');

// 2. parseDisplayToISO
assert.equal(parseDisplayToISO('20-11-2026'), '2026-11-20');
assert.equal(parseDisplayToISO('20/11/2026'), '2026-11-20');
assert.equal(parseDisplayToISO('20.11.2026'), '2026-11-20');
assert.equal(parseDisplayToISO('20112026'), '2026-11-20');
assert.equal(parseDisplayToISO('2026-11-20'), '2026-11-20');
assert.equal(parseDisplayToISO('31-02-2026'), null, 'Feb 31 must be invalid');
assert.equal(parseDisplayToISO('29-02-2024'), '2024-02-29', 'Leap year 2024 valid');
assert.equal(parseDisplayToISO('29-02-2026'), null, 'Non-leap year 2026 invalid');
assert.equal(parseDisplayToISO('invalid'), null);
assert.equal(parseDisplayToISO(''), null);

// 3. Days in month
assert.equal(getDaysInMonth(2026, 2), 28);
assert.equal(getDaysInMonth(2024, 2), 29);
assert.equal(getDaysInMonth(2026, 10), 31);
assert.equal(getDaysInMonth(2026, 11), 30);

// 4. getCalendarGrid Monday-first
// Oct 1 2026 is Thursday (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu).
// Offset in Monday-first: Mon(0), Tue(1), Wed(2), Thu(3).
// So first 3 cells must be Sept 28, 29, 30.
const gridOct2026 = getCalendarGrid(2026, 10, '2026-10-31', '2026-10-10', '2026-10-25');
assert.equal(gridOct2026.length, 42, 'Calendar grid must have exactly 42 cells');
assert.equal(gridOct2026[0].day, 28);
assert.equal(gridOct2026[0].month, 9);
assert.equal(gridOct2026[0].isCurrentMonth, false);
assert.equal(gridOct2026[3].day, 1);
assert.equal(gridOct2026[3].month, 10);
assert.equal(gridOct2026[3].isCurrentMonth, true);

// Check selection and disabled
const selectedCell = gridOct2026.find(c => c.iso === '2026-10-31');
assert.ok(selectedCell);
assert.equal(selectedCell.isSelected, true);
assert.equal(selectedCell.isDisabled, true, 'Max date was 2026-10-25, so Oct 31 must be disabled');

const inRangeCell = gridOct2026.find(c => c.iso === '2026-10-15');
assert.ok(inRangeCell);
assert.equal(inRangeCell.isDisabled, false);

console.log('✅ All date-picker-utils tests passed successfully!');
