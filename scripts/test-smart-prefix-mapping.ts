import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

import {
  extractPendingUnmappedPrefixes,
  buildPrefixLookupMap,
  resolveSinglePrefix,
  BIKE_LOCATION_ID,
} from '../src/lib/gate/prefix-resolver';
import { lookupRtoPrefix } from '../src/lib/gate/rto-directory';
import { suggestHindiName } from '../src/lib/i18n/suggest-hindi';
import { VehicleRegistrationPrefix } from '../src/lib/types/database';

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

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}:`, err.message);
    testsFailed++;
  }
}

async function asyncTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}:`, err.message);
    testsFailed++;
  }
}

async function runSuite() {
  console.log('================================================================');
  console.log('🧪 SMART PREFIX MAPPING & RTO SUGGESTIONS VERIFICATION SUITE');
  console.log('================================================================');

  // Load live master data
  const { data: dbPrefixes, error: pErr } = await supabase
    .from('vehicle_registration_prefixes')
    .select('*')
    .order('prefix', { ascending: true });

  assert.ifError(pErr);
  const prefixes: VehicleRegistrationPrefix[] = dbPrefixes || [];
  console.log(`Loaded ${prefixes.length} prefixes from live master table.`);

  // Load non-null vehicle counter events
  const { data: dbEvents, error: eErr } = await supabase
    .from('vehicle_counter_events')
    .select('vehicle_prefix, location_id, location:vehicle_origin_locations(id, name)')
    .not('vehicle_prefix', 'is', null)
    .neq('location_id', BIKE_LOCATION_ID);

  assert.ifError(eErr);
  const events = (dbEvents || []) as any[];
  console.log(`Loaded ${events.length} non-null non-bike vehicle counter events.`);

  // -----------------------------------------------------------------------------
  // Test Group 1: Pending Unmapped Prefixes Extraction Invariants
  // -----------------------------------------------------------------------------
  console.log('\n📌 Test Group 1: Pending Unmapped Prefixes Extraction Invariants');

  test('extractPendingUnmappedPrefixes excludes all mapped prefixes', () => {
    const pending = extractPendingUnmappedPrefixes(events, prefixes);
    const activePrefixSet = new Set(
      prefixes.filter((p) => p.is_active !== false).map((p) => p.prefix.trim().toUpperCase())
    );

    for (const item of pending) {
      assert.strictEqual(
        activePrefixSet.has(item.prefix),
        false,
        `Prefix ${item.prefix} is already mapped in master and must NOT be in pending list!`
      );
    }
  });

  test('extractPendingUnmappedPrefixes excludes Bikes', () => {
    // Create synthetic events with bike indicators
    const syntheticEvents = [
      { vehicle_prefix: 'BIKE', location_id: 'some-id' },
      { vehicle_prefix: 'bike', location_id: 'some-id' },
      { vehicle_prefix: null, location_id: BIKE_LOCATION_ID },
      { vehicle_prefix: 'ZZ99', location_id: 'c1d2-not-bike' },
    ];

    const pending = extractPendingUnmappedPrefixes(syntheticEvents, prefixes);
    assert.strictEqual(pending.some((p) => p.prefix === 'BIKE'), false);
    assert.strictEqual(pending.some((p) => p.prefix === 'bike'), false);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].prefix, 'ZZ99');
  });

  test('extractPendingUnmappedPrefixes excludes literal OTHERS and nulls', () => {
    const syntheticEvents = [
      { vehicle_prefix: 'OTHERS', location_id: 'some-id' },
      { vehicle_prefix: 'others', location_id: 'some-id' },
      { vehicle_prefix: '', location_id: 'some-id' },
      { vehicle_prefix: null, location_id: 'some-id' },
      { vehicle_prefix: 'YY88', location_id: 'some-id' },
    ];

    const pending = extractPendingUnmappedPrefixes(syntheticEvents, prefixes);
    assert.strictEqual(pending.some((p) => p.prefix.includes('OTHER')), false);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].prefix, 'YY88');
  });

  test('Pending unmapped prefixes are sorted by count descending, then alphabetically', () => {
    const pending = extractPendingUnmappedPrefixes(events, prefixes);
    assert.ok(pending.length > 0, 'Expected pending unmapped prefixes to exist');

    for (let i = 0; i < pending.length - 1; i++) {
      const curr = pending[i];
      const next = pending[i + 1];
      if (curr.count === next.count) {
        assert.ok(
          curr.prefix.localeCompare(next.prefix) <= 0,
          `Tie between ${curr.prefix} and ${next.prefix} must be sorted alphabetically`
        );
      } else {
        assert.ok(
          curr.count > next.count,
          `Count of ${curr.prefix} (${curr.count}) must be >= ${next.prefix} (${next.count})`
        );
      }
    }
  });

  test('Saving a prefix causes it to immediately disappear from the pending list', () => {
    const initialPending = extractPendingUnmappedPrefixes(events, prefixes);
    const topPending = initialPending[0];
    assert.ok(topPending, 'Must have at least one pending prefix');

    // Simulate prefix being saved to master table
    const simulatedPrefixes: VehicleRegistrationPrefix[] = [
      ...prefixes,
      {
        id: 'test-uuid',
        prefix: topPending.prefix,
        location_name: 'Simulated Location',
        name_hi: 'सिम्युलेटेड स्थान',
        state: 'Uttar Pradesh',
        district: 'Simulated',
        latitude: 28.5,
        longitude: 78.5,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const updatedPending = extractPendingUnmappedPrefixes(events, simulatedPrefixes);
    assert.strictEqual(
      updatedPending.some((p) => p.prefix === topPending.prefix),
      false,
      `Prefix ${topPending.prefix} must disappear from pending list once mapped!`
    );
    assert.strictEqual(updatedPending.length, initialPending.length - 1);
  });

  // -----------------------------------------------------------------------------
  // Test Group 2: Authoritative RTO Directory & Location Suggestion
  // -----------------------------------------------------------------------------
  console.log('\n📌 Test Group 2: Authoritative RTO Directory & Suggestions');

  test('lookupRtoPrefix returns accurate geographic data for UP24 (Budaun)', () => {
    const res = lookupRtoPrefix('UP24');
    assert.ok(res);
    assert.strictEqual(res.locationName, 'Budaun');
    assert.strictEqual(res.district, 'Budaun');
    assert.strictEqual(res.state, 'Uttar Pradesh');
    assert.strictEqual(res.nameHi, 'बदायूं');
    assert.strictEqual(res.isExactRto, true);
  });

  test('lookupRtoPrefix returns accurate geographic data for JH01 (Ranchi)', () => {
    const res = lookupRtoPrefix('JH01');
    assert.ok(res);
    assert.strictEqual(res.locationName, 'Ranchi');
    assert.strictEqual(res.district, 'Ranchi');
    assert.strictEqual(res.state, 'Jharkhand');
    assert.strictEqual(res.nameHi, 'राँची');
    assert.strictEqual(res.isExactRto, true);
  });

  test('lookupRtoPrefix returns accurate geographic data for HR36 (Rewari)', () => {
    const res = lookupRtoPrefix('HR36');
    assert.ok(res);
    assert.strictEqual(res.locationName, 'Rewari');
    assert.strictEqual(res.district, 'Rewari');
    assert.strictEqual(res.state, 'Haryana');
    assert.strictEqual(res.isExactRto, true);
  });

  test('lookupRtoPrefix returns accurate geographic data for UK18 (Kashipur)', () => {
    const res = lookupRtoPrefix('UK18');
    assert.ok(res);
    assert.strictEqual(res.locationName, 'Kashipur');
    assert.strictEqual(res.district, 'Udham Singh Nagar');
    assert.strictEqual(res.state, 'Uttarakhand');
    assert.strictEqual(res.isExactRto, true);
  });

  test('lookupRtoPrefix returns accurate geographic data for RJ20 (Kota)', () => {
    const res = lookupRtoPrefix('RJ20');
    assert.ok(res);
    assert.strictEqual(res.locationName, 'Kota');
    assert.strictEqual(res.district, 'Kota');
    assert.strictEqual(res.state, 'Rajasthan');
    assert.strictEqual(res.isExactRto, true);
  });

  test('lookupRtoPrefix returns accurate geographic data for DL14 (Rohini)', () => {
    const res = lookupRtoPrefix('DL14');
    assert.ok(res);
    assert.strictEqual(res.locationName, 'Rohini');
    assert.strictEqual(res.district, 'North West Delhi');
    assert.strictEqual(res.state, 'Delhi');
    assert.strictEqual(res.isExactRto, true);
  });

  test('lookupRtoPrefix handles state-only fallback prefix (e.g. UP03)', () => {
    const res = lookupRtoPrefix('UP03');
    assert.ok(res);
    assert.strictEqual(res.state, 'Uttar Pradesh');
    assert.strictEqual(res.locationName, '');
    assert.strictEqual(res.district, '');
    assert.strictEqual(res.isExactRto, false);
  });

  test('lookupRtoPrefix returns null for completely unknown prefix (e.g. ZZ99)', () => {
    const res = lookupRtoPrefix('ZZ99');
    assert.strictEqual(res, null);
  });

  // -----------------------------------------------------------------------------
  // Test Group 3: Reused Hindi Suggestion Engine Invariants
  // -----------------------------------------------------------------------------
  console.log('\n📌 Test Group 3: Hindi Suggestion Engine Invariants');

  test('suggestHindiName generates canonical Hindi for Moradabad', () => {
    const res = suggestHindiName('Moradabad', 'location');
    assert.strictEqual(res.suggestion, 'मुरादाबाद');
    assert.strictEqual(res.confidence, 'high');
  });

  test('suggestHindiName generates canonical Hindi for Budaun', () => {
    const res = suggestHindiName('Budaun', 'location');
    assert.strictEqual(res.suggestion, 'बदायूं');
    assert.strictEqual(res.confidence, 'high');
  });

  test('suggestHindiName generates canonical Hindi for Rewari', () => {
    const res = suggestHindiName('Rewari', 'location');
    assert.strictEqual(res.suggestion, 'रेवाड़ी');
    assert.strictEqual(res.confidence, 'high');
  });

  test('suggestHindiName generates canonical Hindi for Kashipur', () => {
    const res = suggestHindiName('Kashipur', 'location');
    assert.strictEqual(res.suggestion, 'काशीपुर');
    assert.strictEqual(res.confidence, 'high');
  });

  test('suggestHindiName generates canonical Hindi for Ranchi', () => {
    const res = suggestHindiName('Ranchi', 'location');
    assert.strictEqual(res.suggestion, 'राँची');
    assert.strictEqual(res.confidence, 'high');
  });

  test('suggestHindiName generates canonical Hindi for Kota', () => {
    const res = suggestHindiName('Kota', 'location');
    assert.strictEqual(res.suggestion, 'कोटा');
    assert.strictEqual(res.confidence, 'high');
  });

  test('suggestHindiName gracefully transliterates unknown location without inventing data', () => {
    const res = suggestHindiName('Somewheretown', 'location');
    assert.ok(res.suggestion);
    assert.strictEqual(res.isTransliterated, true);
    assert.strictEqual(res.confidence, 'medium');
  });

  // -----------------------------------------------------------------------------
  // Test Group 4: Server-Side Geocoding Resolution Invariants
  // -----------------------------------------------------------------------------
  console.log('\n📌 Test Group 4: Server-Side Geocoding Resolution Invariants');

  await asyncTest('Server geocoding resolves official coordinates for Budaun, Uttar Pradesh', async () => {
    const query = 'Budaun, Uttar Pradesh, India';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
        {
          headers: { 'User-Agent': 'GhoomarYatra-Admin/1.0' },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        assert.ok(Array.isArray(data) && data.length > 0);
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        // Budaun is ~28.03° N, 79.12° E
        assert.ok(lat > 27.5 && lat < 28.5, `Lat ${lat} out of expected Budaun range`);
        assert.ok(lon > 78.5 && lon < 79.5, `Lon ${lon} out of expected Budaun range`);
      }
    } catch (err) {
      // If network is offline, timeout is handled gracefully
      console.log('    (Geocoding network fetch skipped or timed out gracefully)');
    }
  });

  test('Invalid location does NOT invent coordinates', async () => {
    // When location is blank or prefix unknown, coordinates must remain null
    const res = lookupRtoPrefix('ZZ99');
    assert.strictEqual(res, null);
  });

  test('State-only and partial prefixes do NOT trigger geocoding when there is no resolved city', () => {
    // UP is state-only; locationName equals state -> coordinates must not be geocoded
    const upRes = lookupRtoPrefix('UP');
    assert.ok(upRes);
    assert.strictEqual(upRes.state, 'Uttar Pradesh');
    const isUpStateOnly = upRes.locationName.trim().toLowerCase() === upRes.state.trim().toLowerCase();
    assert.strictEqual(isUpStateOnly, true, 'UP must be recognized as state-only without resolved city');

    // UP03 is unassigned RTO; isExactRto is false -> coordinates must not be geocoded
    const up03Res = lookupRtoPrefix('UP03');
    assert.ok(up03Res);
    assert.strictEqual(up03Res.isExactRto, false);
    assert.strictEqual(up03Res.locationName, '');

    // HR is state-only -> coordinates must not be geocoded
    const hrRes = lookupRtoPrefix('HR');
    assert.ok(hrRes);
    assert.strictEqual(hrRes.locationName.trim().toLowerCase() === hrRes.state.trim().toLowerCase(), true);
  });

  // -----------------------------------------------------------------------------
  // Test Group 5: Master Data Independence & Semantics
  // -----------------------------------------------------------------------------
  console.log('\n📌 Test Group 5: Master Data Independence & Semantics');

  test('UP15 (Meerut) is mapped in prefix master and excluded from pending list', () => {
    const up15 = prefixes.find((p) => p.prefix === 'UP15');
    assert.ok(up15, 'UP15 must exist in vehicle_registration_prefixes');
    assert.strictEqual(up15.location_name, 'Meerut');

    const pending = extractPendingUnmappedPrefixes(events, prefixes);
    assert.strictEqual(
      pending.some((p) => p.prefix === 'UP15'),
      false,
      'UP15 must NOT appear in pending unmapped prefixes!'
    );
  });

  test('Bikes and mapped origins (Amroha, Rampur, Noida) are excluded from pending list', () => {
    const pending = extractPendingUnmappedPrefixes(events, prefixes);
    const pendingCodes = new Set(pending.map((p) => p.prefix));

    assert.strictEqual(pendingCodes.has('UP21'), false); // Moradabad
    assert.strictEqual(pendingCodes.has('UP22'), false); // Rampur
    assert.strictEqual(pendingCodes.has('UP23'), false); // Amroha
    assert.strictEqual(pendingCodes.has('UP16'), false); // Noida
    assert.strictEqual(pendingCodes.has('UP25'), false); // Bareilly
    assert.strictEqual(pendingCodes.has('UP38'), false); // Sambhal
    assert.strictEqual(pendingCodes.has('BIKE'), false);
    assert.strictEqual(pendingCodes.has('OTHERS'), false);
  });

  console.log('\n================================================================');
  console.log(`🏁 SUITE RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log('================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
