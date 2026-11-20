import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

console.log('🧪 Verifying mobile DatePicker & DateTimePicker keyboard protection...');

const datePickerCode = fs.readFileSync(path.join(rootDir, 'src/components/ui/DatePicker.tsx'), 'utf8');
const dateTimePickerCode = fs.readFileSync(path.join(rootDir, 'src/components/ui/DateTimePicker.tsx'), 'utf8');

// 1. Verify readOnly on mobile in DatePicker
assert.ok(
  datePickerCode.includes('readOnly={isMobile}'),
  'DatePicker must set readOnly={isMobile} on the trigger input'
);
assert.ok(
  datePickerCode.includes("inputMode={isMobile ? 'none' : 'text'}"),
  'DatePicker must set inputMode={isMobile ? "none" : "text"} to prevent virtual keyboard'
);

// 2. Verify onFocus mobile blur in DatePicker
assert.ok(
  datePickerCode.includes('if (isMobile)') && datePickerCode.includes('e.target.blur()'),
  'DatePicker must blur the input on mobile onFocus to prevent virtual keyboard'
);

// 3. Verify manualMode & "Enter date manually" button in DatePicker
assert.ok(
  datePickerCode.includes('manualMode') && datePickerCode.includes('setManualMode'),
  'DatePicker must support mobile manualMode state'
);
assert.ok(
  datePickerCode.includes("t('common.datePicker.enterManually')"),
  'DatePicker must include "Enter date manually" option'
);
assert.ok(
  datePickerCode.includes("t('common.datePicker.backToCalendar')"),
  'DatePicker must include "Back to calendar" button in manual mode'
);

// 4. Verify visualViewport tracking in DatePicker
assert.ok(
  datePickerCode.includes('window.visualViewport'),
  'DatePicker must track window.visualViewport for mobile Android keyboard resilience'
);

// 5. Verify DateTimePicker has matching mobile keyboard protection
assert.ok(
  dateTimePickerCode.includes('readOnly={isMobile}'),
  'DateTimePicker must set readOnly={isMobile} on the trigger input'
);
assert.ok(
  dateTimePickerCode.includes("inputMode={isMobile ? 'none' : 'text'}"),
  'DateTimePicker must set inputMode={isMobile ? "none" : "text"}'
);
assert.ok(
  dateTimePickerCode.includes('manualMode') && dateTimePickerCode.includes('setManualMode'),
  'DateTimePicker must support mobile manualMode state'
);
assert.ok(
  dateTimePickerCode.includes("t('common.datePicker.enterDateTimeManually')"),
  'DateTimePicker must include "Enter date & time manually" option'
);
assert.ok(
  dateTimePickerCode.includes('window.visualViewport'),
  'DateTimePicker must track window.visualViewport'
);

console.log('✅ Mobile keyboard prevention & manual mode checks passed successfully!');
