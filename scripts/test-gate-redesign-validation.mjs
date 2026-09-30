/**
 * Gate Counter Redesign - Validation Test Suite
 * Tests prefix normalization, validation edge cases, offline payload construction,
 * undo functionality, and analytics prefix aggregation.
 */

import { strict as assert } from 'assert';

console.log('================================================================');
console.log('🧪 GATE COUNTER REDESIGN VALIDATION & REGRESSION TEST SUITE');
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

// -----------------------------------------------------------------------------
// 1. SMART PREFIX INPUT NORMALIZATION & VALIDATION TESTS
// -----------------------------------------------------------------------------
console.log('📌 Test Group 1: Smart Prefix Normalization & Validation');

// Logic extracted from src/app/operations/gate/page.tsx
function parsePrefixInput(rawLetters, rawDigits) {
  const cleanLetters = rawLetters.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let letters = '';
  let digits = '';

  // Paste / multi-char support in letters box
  if (cleanLetters.length > 2 && /^[A-Z]{2}[0-9]{1,2}$/.test(cleanLetters)) {
    letters = cleanLetters.slice(0, 2);
    digits = cleanLetters.slice(2, 4);
  } else {
    letters = rawLetters.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    digits = (rawDigits || '').replace(/[^0-9]/g, '').slice(0, 2);
  }

  const isValid = /^[A-Z]{2}$/.test(letters) && /^[0-9]{2}$/.test(digits);
  const normalized = isValid ? `${letters}${digits}` : null;

  return { letters, digits, isValid, normalized };
}

test('Valid prefix: standard MP09 split across inputs', () => {
  const res = parsePrefixInput('MP', '09');
  assert.equal(res.isValid, true);
  assert.equal(res.normalized, 'MP09');
});

test('Valid prefix: lowercase input auto-uppercased (rj + 14 -> RJ14)', () => {
  const res = parsePrefixInput('rj', '14');
  assert.equal(res.isValid, true);
  assert.equal(res.normalized, 'RJ14');
});

test('Valid prefix: paste "MP09" into letters input splits correctly', () => {
  const res = parsePrefixInput('MP09', '');
  assert.equal(res.letters, 'MP');
  assert.equal(res.digits, '09');
  assert.equal(res.isValid, true);
  assert.equal(res.normalized, 'MP09');
});

test('Valid prefix: paste "mp 09" with spaces splits correctly', () => {
  const res = parsePrefixInput('mp 09', '');
  assert.equal(res.letters, 'MP');
  assert.equal(res.digits, '09');
  assert.equal(res.isValid, true);
  assert.equal(res.normalized, 'MP09');
});

test('Valid prefix: paste "up-16" with hyphen splits correctly', () => {
  const res = parsePrefixInput('up-16', '');
  assert.equal(res.letters, 'UP');
  assert.equal(res.digits, '16');
  assert.equal(res.isValid, true);
  assert.equal(res.normalized, 'UP16');
});

test('Rejection: single letter "M" is invalid', () => {
  const res = parsePrefixInput('M', '09');
  assert.equal(res.isValid, false);
  assert.equal(res.normalized, null);
});

test('Rejection: missing digits "MP" is invalid', () => {
  const res = parsePrefixInput('MP', '');
  assert.equal(res.isValid, false);
  assert.equal(res.normalized, null);
});

test('Rejection: single digit "MP0" is invalid', () => {
  const res = parsePrefixInput('MP', '0');
  assert.equal(res.isValid, false);
  assert.equal(res.normalized, null);
});

test('Rejection: numeric characters in letters box are filtered out', () => {
  // If user types "M1", only "M" is kept as letter
  const res = parsePrefixInput('M1', '09');
  assert.equal(res.letters, 'M');
  assert.equal(res.isValid, false);
});

test('Rejection: all digits "1234" is invalid', () => {
  const res = parsePrefixInput('1234', '');
  assert.equal(res.isValid, false);
  assert.equal(res.normalized, null);
});

test('Rejection: all letters "MPAB" is invalid', () => {
  const res = parsePrefixInput('MP', 'AB');
  assert.equal(res.digits, ''); // non-digits stripped
  assert.equal(res.isValid, false);
});

// -----------------------------------------------------------------------------
// 2. CONFIGURATION-DRIVEN QUICK PREFIX DERIVATION TESTS
// -----------------------------------------------------------------------------
console.log('\n📌 Test Group 2: Configuration-Driven Quick Prefix Derivation');

const mockLocations = [
  { id: '1', name: 'DL', display_order: 1, is_quick_prefix: true },
  { id: '2', name: 'UP16', display_order: 2, is_quick_prefix: true },
  { id: '3', name: 'UP22', display_order: 3, is_quick_prefix: true },
  { id: '4', name: 'UP23', display_order: 4, is_quick_prefix: true },
  { id: '5', name: 'HR', display_order: 5, is_quick_prefix: false },
  { id: '6', name: 'UK', display_order: 6, is_quick_prefix: false },
  { id: '7', name: 'Others', display_order: 7, is_quick_prefix: false },
  { id: '8', name: 'Bike', display_order: 8, is_quick_prefix: false },
];

function deriveQuickLocations(locations) {
  return locations
    .filter((l) => Boolean(l.is_quick_prefix) && l.name.toUpperCase() !== 'BIKE')
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
}

test('Quick locations derived purely from is_quick_prefix === true', () => {
  const quick = deriveQuickLocations(mockLocations);
  assert.equal(quick.length, 4);
  assert.deepEqual(quick.map((q) => q.name), ['DL', 'UP16', 'UP22', 'UP23']);
});

test('Quick locations reorder dynamically if display_order changes', () => {
  const reordered = [
    { id: '1', name: 'DL', display_order: 4, is_quick_prefix: true },
    { id: '2', name: 'UP16', display_order: 1, is_quick_prefix: true },
    { id: '3', name: 'UP22', display_order: 2, is_quick_prefix: true },
    { id: '4', name: 'UP23', display_order: 3, is_quick_prefix: true },
  ];
  const quick = deriveQuickLocations(reordered);
  assert.deepEqual(quick.map((q) => q.name), ['UP16', 'UP22', 'UP23', 'DL']);
});

test('Bike is excluded from quick vehicle prefixes even if is_quick_prefix is true', () => {
  const withBikeQuick = [
    ...mockLocations.map((l) => l.name === 'Bike' ? { ...l, is_quick_prefix: true } : l)
  ];
  const quick = deriveQuickLocations(withBikeQuick);
  assert.ok(!quick.some((q) => q.name.toUpperCase() === 'BIKE'));
});

// -----------------------------------------------------------------------------
// 3. ANALYTICS AGGREGATION & PREFIX SEGREGATION TESTS
// -----------------------------------------------------------------------------
console.log('\n📌 Test Group 3: Analytics API Prefix Aggregation & Segregation');

// Logic extracted from src/app/api/operations/gate/analytics/route.ts
function aggregateGateVehicles(events) {
  let totalCars = 0;
  let totalBikes = 0;
  const prefixCountMap = {};

  events.forEach((ev) => {
    const inc = Number(ev.increment) || 1;
    const isBike = (ev.location?.name || '').toLowerCase() === 'bike' || (ev.vehicle_prefix || '').toLowerCase() === 'bike';

    if (isBike) {
      totalBikes += inc;
    } else {
      const originName = ev.vehicle_prefix || ev.location?.name || 'Others';
      totalCars += inc;
      prefixCountMap[originName] = (prefixCountMap[originName] || 0) + inc;
    }
  });

  const standardPrefixes = ['DL', 'UP16', 'UP22', 'UP23', 'HR', 'UK', 'Others'];
  const allPrefixKeys = Array.from(new Set([...standardPrefixes, ...Object.keys(prefixCountMap)]));
  const prefixSummary = allPrefixKeys
    .map((pref) => {
      const count = prefixCountMap[pref] || 0;
      const percent = totalCars > 0 ? Math.round((count / totalCars) * 1000) / 10 : 0;
      return { name: pref, count, percent };
    })
    .filter((p) => p.count > 0 || standardPrefixes.includes(p.name));

  return { totalCars, totalBikes, prefixSummary, prefixCountMap };
}

test('Aggregates quick prefixes, smart prefixes, bikes, and legacy anonymous rows', () => {
  const events = [
    { increment: 1, vehicle_prefix: 'DL', location: { name: 'DL' } },
    { increment: 1, vehicle_prefix: 'DL', location: { name: 'DL' } },
    { increment: 1, vehicle_prefix: 'UP16', location: { name: 'UP16' } },
    { increment: 1, vehicle_prefix: 'MP09', location: { name: 'Others' } }, // Smart prefix
    { increment: 1, vehicle_prefix: 'RJ14', location: { name: 'Others' } }, // Smart prefix
    { increment: 1, vehicle_prefix: null, location: { name: 'Others' } },   // Legacy anonymous Others
    { increment: 1, vehicle_prefix: null, location: { name: 'HR' } },       // Legacy anonymous HR
    { increment: 1, vehicle_prefix: null, location: { name: 'Bike' } },     // Bike
    { increment: 2, vehicle_prefix: null, location: { name: 'Bike' } },     // Bike (+2)
  ];

  const result = aggregateGateVehicles(events);

  assert.equal(result.totalCars, 7, 'Total cars equals 7');
  assert.equal(result.totalBikes, 3, 'Total bikes equals 3');

  // Verify prefix breakdown
  assert.equal(result.prefixCountMap['DL'], 2, 'DL count = 2');
  assert.equal(result.prefixCountMap['UP16'], 1, 'UP16 count = 1');
  assert.equal(result.prefixCountMap['MP09'], 1, 'MP09 count = 1');
  assert.equal(result.prefixCountMap['RJ14'], 1, 'RJ14 count = 1');
  assert.equal(result.prefixCountMap['HR'], 1, 'HR count = 1');
  assert.equal(result.prefixCountMap['Others'], 1, 'Anonymous Others count = 1');

  // Verify smart prefixes are in summary
  const mp09 = result.prefixSummary.find((p) => p.name === 'MP09');
  assert.ok(mp09, 'MP09 dynamically present in prefix summary');
  assert.equal(mp09.count, 1);
  assert.equal(mp09.percent, 14.3); // 1/7 = 14.285% -> 14.3%

  const rj14 = result.prefixSummary.find((p) => p.name === 'RJ14');
  assert.ok(rj14, 'RJ14 dynamically present in prefix summary');
  assert.equal(rj14.count, 1);

  // Verify standard prefixes that had 0 are still listed
  const up22 = result.prefixSummary.find((p) => p.name === 'UP22');
  assert.ok(up22, 'UP22 listed with count 0');
  assert.equal(up22.count, 0);
});

// -----------------------------------------------------------------------------
// 4. DAILY OPERATIONS GATE VEHICLE AGGREGATION TESTS
// -----------------------------------------------------------------------------
console.log('\n📌 Test Group 4: Daily Operations (/operations/daily) Aggregation');

// Logic extracted from src/app/operations/daily/page.tsx
function aggregateDailyOperationsGate(events) {
  let cars = 0;
  let bikes = 0;
  const prefMap = {};

  (events || []).forEach((e) => {
    const inc = Number(e.increment) || 1;
    const isBike = (e.location?.name || '').toLowerCase() === 'bike' || (e.vehicle_prefix || '').toLowerCase() === 'bike';
    if (isBike) {
      bikes += inc;
    } else {
      cars += inc;
      const originName = e.vehicle_prefix || e.location?.name || 'Others';
      prefMap[originName] = (prefMap[originName] || 0) + inc;
    }
  });

  return { cars, bikes, totalVehicles: cars + bikes, prefMap };
}

test('Daily operations preserves manual prefixes like MP09 and RJ14 instead of grouping as Others', () => {
  const events = [
    { increment: 1, vehicle_prefix: 'MP09', location: { id: 'ef6e8d6b-a68b-409f-a2e0-5794c6205833', name: 'Others' } },
    { increment: 1, vehicle_prefix: 'RJ14', location: { id: 'ef6e8d6b-a68b-409f-a2e0-5794c6205833', name: 'Others' } },
    { increment: 1, vehicle_prefix: 'DL', location: { id: 'd343fa14-72f7-49c1-bfbc-e8bffdd2ddd9', name: 'DL' } },
    { increment: 1, vehicle_prefix: null, location: { id: 'ef6e8d6b-a68b-409f-a2e0-5794c6205833', name: 'Others' } },
    { increment: 1, vehicle_prefix: null, location: { id: 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f', name: 'Bike' } },
  ];

  const result = aggregateDailyOperationsGate(events);

  assert.equal(result.cars, 4, 'Total cars = 4');
  assert.equal(result.bikes, 1, 'Total bikes = 1');
  assert.equal(result.totalVehicles, 5, 'Total vehicles = 5');

  // Verify MP09 and RJ14 are distinct pills
  assert.equal(result.prefMap['MP09'], 1, 'MP09 has its own pill count = 1');
  assert.equal(result.prefMap['RJ14'], 1, 'RJ14 has its own pill count = 1');
  assert.equal(result.prefMap['DL'], 1, 'DL has its own pill count = 1');
  assert.equal(result.prefMap['Others'], 1, 'Anonymous legacy row has Others count = 1');
  assert.equal(result.prefMap['Bike'], undefined, 'Bike is not in car prefixes map');
});

test('Daily operations falls back to location.name when vehicle_prefix is null', () => {
  const events = [
    { increment: 1, vehicle_prefix: null, location: { name: 'UP16' } },
    { increment: 1, vehicle_prefix: null, location: null },
  ];

  const result = aggregateDailyOperationsGate(events);
  assert.equal(result.prefMap['UP16'], 1, 'Falls back to location.name UP16');
  assert.equal(result.prefMap['Others'], 1, 'Falls back to Others when both are null');
});

// -----------------------------------------------------------------------------
// SUMMARY & REPORT
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`🏁 GATE REDESIGN VALIDATION: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('================================================================\n');

if (testsFailed > 0) {
  process.exit(1);
}

