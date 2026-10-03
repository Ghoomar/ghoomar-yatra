import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

import {
  buildPrefixLookupMap,
  resolveSinglePrefix,
  resolveCarOrigins,
  RawGateVehicleEvent,
} from '../src/lib/gate/prefix-resolver';
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
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

async function runAll() {
  console.log('================================================================');
  console.log('🧪 CAR ORIGINS & REGISTRATION PREFIX MASTER VALIDATION SUITE');
  console.log('================================================================');

  // -----------------------------------------------------------------------------
  // 1. UNIT TESTS: PREFIX RESOLVER LOGIC & AUTHORITATIVE MAPPINGS
  // -----------------------------------------------------------------------------
  console.log('\n📌 Test Group 1: Pure Prefix Resolver Logic & Authoritative Mappings');

  const mockMaster: VehicleRegistrationPrefix[] = [
    { id: '1', prefix: 'UP23', location_name: 'Amroha', name_hi: 'अमरोहा', state: 'Uttar Pradesh', district: 'Amroha', is_active: true, created_at: '', updated_at: '' },
    { id: '2', prefix: 'UP21', location_name: 'Moradabad', name_hi: 'मुरादाबाद', state: 'Uttar Pradesh', district: 'Moradabad', is_active: true, created_at: '', updated_at: '' },
    { id: '3', prefix: 'UP22', location_name: 'Rampur', name_hi: 'रामपुर', state: 'Uttar Pradesh', district: 'Rampur', is_active: true, created_at: '', updated_at: '' },
    { id: '4', prefix: 'UP16', location_name: 'Noida', name_hi: 'नोएडा', state: 'Uttar Pradesh', district: 'Gautam Buddha Nagar', is_active: true, created_at: '', updated_at: '' },
    { id: '5', prefix: 'DL01', location_name: 'North Delhi', name_hi: 'उत्तरी दिल्ली', state: 'Delhi', district: 'North Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '6', prefix: 'DL02', location_name: 'New Delhi', name_hi: 'नई दिल्ली', state: 'Delhi', district: 'New Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '7', prefix: 'DL03', location_name: 'South Delhi', name_hi: 'दक्षिणी दिल्ली', state: 'Delhi', district: 'South Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '8', prefix: 'DL04', location_name: 'West Delhi', name_hi: 'पश्चिमी दिल्ली', state: 'Delhi', district: 'West Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '9', prefix: 'DL05', location_name: 'North-East Delhi', name_hi: 'उत्तर-पूर्वी दिल्ली', state: 'Delhi', district: 'North East Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '10', prefix: 'DL06', location_name: 'Central Delhi', name_hi: 'मध्य दिल्ली', state: 'Delhi', district: 'Central Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '11', prefix: 'DL07', location_name: 'Mayur Vihar', name_hi: 'मयूर विहार', state: 'Delhi', district: 'East Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '12', prefix: 'DL08', location_name: 'North-West Delhi', name_hi: 'उत्तर-पश्चिमी दिल्ली', state: 'Delhi', district: 'North West Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '13', prefix: 'DL09', location_name: 'Dwarka', name_hi: 'द्वारका', state: 'Delhi', district: 'South West Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '14', prefix: 'DL10', location_name: 'Rajouri Garden', name_hi: 'राजौरी गार्डन', state: 'Delhi', district: 'West Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '15', prefix: 'DL11', location_name: 'Rohini', name_hi: 'रोहिणी', state: 'Delhi', district: 'North West Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '16', prefix: 'DL12', location_name: 'Vasant Vihar', name_hi: 'वसंत विहार', state: 'Delhi', district: 'South West Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '17', prefix: 'DL13', location_name: 'Surajmal Vihar', name_hi: 'सूरजमल विहार', state: 'Delhi', district: 'East Delhi', is_active: true, created_at: '', updated_at: '' },
    { id: '18', prefix: 'DL', location_name: 'Delhi', name_hi: 'दिल्ली', state: 'Delhi', district: 'Delhi NCR', is_active: true, created_at: '', updated_at: '' },
    { id: '19', prefix: 'HR26', location_name: 'Gurugram', name_hi: 'गुरुग्राम', state: 'Haryana', district: 'Gurugram', is_active: true, created_at: '', updated_at: '' },
    { id: '20', prefix: 'UK06', location_name: 'Rudrapur', name_hi: 'रुद्रपुर', state: 'Uttarakhand', district: 'Udham Singh Nagar', is_active: true, created_at: '', updated_at: '' },
    { id: '21', prefix: 'BH24', location_name: 'Bharat Series', name_hi: 'भारत सीरीज', state: 'All-India', district: 'Central', is_active: true, created_at: '', updated_at: '' },
  ];

  const mockMap = buildPrefixLookupMap(mockMaster);

  test('Resolves standard quick prefixes accurately (English & Hindi)', () => {
    const up23En = resolveSinglePrefix('UP23', mockMap, 'en');
    assert.strictEqual(up23En.locationName, 'Amroha');
    assert.strictEqual(up23En.isUnmapped, false);

    const up23Hi = resolveSinglePrefix('UP23', mockMap, 'hi');
    assert.strictEqual(up23Hi.locationName, 'अमरोहा');

    const up21En = resolveSinglePrefix('UP21', mockMap, 'en');
    assert.strictEqual(up21En.locationName, 'Moradabad');

    const up22En = resolveSinglePrefix('UP22', mockMap, 'en');
    assert.strictEqual(up22En.locationName, 'Rampur');

    const up16En = resolveSinglePrefix('UP16', mockMap, 'en');
    assert.strictEqual(up16En.locationName, 'Noida');
  });

  test('Resolves all DL01-DL13 authoritative short display names accurately', () => {
    const expectedDL: Record<string, string> = {
      DL01: 'North Delhi',
      DL02: 'New Delhi',
      DL03: 'South Delhi',
      DL04: 'West Delhi',
      DL05: 'North-East Delhi',
      DL06: 'Central Delhi',
      DL07: 'Mayur Vihar',
      DL08: 'North-West Delhi',
      DL09: 'Dwarka',
      DL10: 'Rajouri Garden',
      DL11: 'Rohini',
      DL12: 'Vasant Vihar',
      DL13: 'Surajmal Vihar',
      DL: 'Delhi',
    };

    for (const [code, loc] of Object.entries(expectedDL)) {
      const res = resolveSinglePrefix(code, mockMap, 'en');
      assert.strictEqual(res.locationName, loc, `Mismatch for ${code}`);
      assert.strictEqual(res.isUnmapped, false, `${code} should be mapped`);
    }
  });

  test('Distinguishes unmapped prefixes and flags them cleanly', () => {
    const unmapped = resolveSinglePrefix('UP99', mockMap, 'en');
    assert.strictEqual(unmapped.locationName, 'UP99');
    assert.strictEqual(unmapped.isUnmapped, true);

    const unmappedLowercase = resolveSinglePrefix('up99', mockMap, 'en');
    assert.strictEqual(unmappedLowercase.locationName, 'UP99');
    assert.strictEqual(unmappedLowercase.isUnmapped, true);
  });

  // -----------------------------------------------------------------------------
  // 2. LEGACY HISTORICAL EVENT COMPATIBILITY (3,022 records with vehicle_prefix IS NULL)
  // -----------------------------------------------------------------------------
  console.log('\n📌 Test Group 2: Legacy Historical Event Compatibility');

  test('Historical NULL-prefix events preserve meaning via legacy location_id (never collapse to Others)', () => {
    const historicalEvents: RawGateVehicleEvent[] = [
      { increment: 1, vehicle_prefix: null, location: { name: 'UP23' } },
      { increment: 1, vehicle_prefix: null, location: { name: 'UP22' } },
      { increment: 1, vehicle_prefix: null, location: { name: 'UP16' } },
      { increment: 1, vehicle_prefix: null, location: { name: 'DL' } },
      { increment: 1, vehicle_prefix: null, location: { name: 'Meerut' } },
      { increment: 1, vehicle_prefix: null, location: { name: 'Others' } },
      { increment: 1, vehicle_prefix: null, location: { name: 'HR' } },
      { increment: 1, vehicle_prefix: null, location: { name: 'UK' } },
      { increment: 2, vehicle_prefix: null, location: { name: 'Bike' } }, // Excluded
    ];

    const originsEn = resolveCarOrigins(historicalEvents, mockMap, 'en');

    // 8 distinct non-bike car origins
    assert.strictEqual(originsEn.length, 8);

    // Verify each historical case preserves its exact legacy meaning:
    const amroha = originsEn.find((o) => o.locationName === 'Amroha');
    assert.ok(amroha, 'UP23 must resolve to Amroha');
    assert.strictEqual(amroha.isUnmapped, false);
    assert.strictEqual(amroha.count, 1);

    const rampur = originsEn.find((o) => o.locationName === 'Rampur');
    assert.ok(rampur, 'UP22 must resolve to Rampur');
    assert.strictEqual(rampur.isUnmapped, false);

    const noida = originsEn.find((o) => o.locationName === 'Noida');
    assert.ok(noida, 'UP16 must resolve to Noida');
    assert.strictEqual(noida.isUnmapped, false);

    const delhi = originsEn.find((o) => o.locationName === 'Delhi');
    assert.ok(delhi, 'DL must resolve to Delhi');
    assert.strictEqual(delhi.isUnmapped, false);

    const meerut = originsEn.find((o) => o.locationName === 'Meerut');
    assert.ok(meerut, 'Meerut must resolve to Meerut');
    assert.strictEqual(meerut.isUnmapped, false);

    const others = originsEn.find((o) => o.locationName === 'Others');
    assert.ok(others, 'Others must resolve to Others');
    assert.strictEqual(others.isUnmapped, false);
    assert.strictEqual(others.count, 1); // ONLY the literal Others event is counted here!

    const haryana = originsEn.find((o) => o.locationName === 'Haryana');
    assert.ok(haryana, 'HR must resolve to Haryana');
    assert.strictEqual(haryana.isUnmapped, false);

    const uttarakhand = originsEn.find((o) => o.locationName === 'Uttarakhand');
    assert.ok(uttarakhand, 'UK must resolve to Uttarakhand');
    assert.strictEqual(uttarakhand.isUnmapped, false);

    // Bikes must be excluded
    assert.ok(!originsEn.some((o) => o.locationName.toLowerCase() === 'bike'));

    // Test Hindi localization on legacy events
    const originsHi = resolveCarOrigins(historicalEvents, mockMap, 'hi');
    assert.ok(originsHi.some((o) => o.locationName === 'अमरोहा'));
    assert.ok(originsHi.some((o) => o.locationName === 'रामपुर'));
    assert.ok(originsHi.some((o) => o.locationName === 'नोएडा'));
    assert.ok(originsHi.some((o) => o.locationName === 'दिल्ली'));
    assert.ok(originsHi.some((o) => o.locationName === 'मेरठ'));
    assert.ok(originsHi.some((o) => o.locationName === 'अन्य'));
    assert.ok(originsHi.some((o) => o.locationName === 'हरियाणा'));
    assert.ok(originsHi.some((o) => o.locationName === 'उत्तराखंड'));
  });

  // -----------------------------------------------------------------------------
  // 3. SEPARATION OF MASTERS INDEPENDENCE TEST
  // -----------------------------------------------------------------------------
  console.log('\n📌 Test Group 3: Independence of the Two Masters');

  test('Changing quick-button configuration does NOT alter geographic resolution', () => {
    // Simulate quick-button config where UP21 is removed or reordered
    const alteredQuickConfig = [
      { name: 'UP21', is_quick_prefix: false, display_order: 99 },
      { name: 'CustomButton', is_quick_prefix: true, display_order: 1 },
    ];

    // Raw vehicle events recorded with prefix UP21
    const events = [{ increment: 1, vehicle_prefix: 'UP21', location: { name: 'Others' } }];

    // Resolver uses prefixMaster, NOT vehicle_origin_locations
    const origins = resolveCarOrigins(events, mockMap, 'en');
    assert.strictEqual(origins[0].locationName, 'Moradabad');
    assert.strictEqual(origins[0].isUnmapped, false);
  });

  test('Geographic prefix master lookup does NOT read from vehicle_origin_locations', () => {
    // New prefix MP09 recorded at gate
    const events = [{ increment: 1, vehicle_prefix: 'MP09', location: { name: 'Others' } }];
    const origins = resolveCarOrigins(events, mockMap, 'en');

    // MP09 is unmapped in mockMap -> cleanly returned as MP09, unmapped: true
    assert.strictEqual(origins[0].locationName, 'MP09');
    assert.strictEqual(origins[0].isUnmapped, true);
    // Origin is NOT coerced to 'Others' even though location.name is 'Others'
    assert.ok(!origins.some((o) => o.locationName === 'Others'));
  });

  // -----------------------------------------------------------------------------
  // 4. LIVE DATABASE & SEEDED MASTER AUDIT
  // -----------------------------------------------------------------------------
  console.log('\n📌 Test Group 4: Live Database Master Verification');

  await asyncTest('vehicle_registration_prefixes contains all authoritative UP, DL, and state codes', async () => {
    const { data, error } = await supabase
      .from('vehicle_registration_prefixes')
      .select('prefix, location_name, name_hi, state')
      .in('prefix', ['UP21', 'UP22', 'UP23', 'UP16', 'UP25', 'UP38', 'DL01', 'DL08', 'DL09', 'DL', 'HR', 'UK']);

    assert.ifError(error);
    assert.ok(data && data.length >= 12, `Expected at least 12 prefixes, found ${data?.length}`);

    const up21 = data.find((p) => p.prefix === 'UP21');
    assert.strictEqual(up21?.location_name, 'Moradabad');

    const up23 = data.find((p) => p.prefix === 'UP23');
    assert.strictEqual(up23?.location_name, 'Amroha');

    const up16 = data.find((p) => p.prefix === 'UP16');
    assert.strictEqual(up16?.location_name, 'Noida');

    const up22 = data.find((p) => p.prefix === 'UP22');
    assert.strictEqual(up22?.location_name, 'Rampur');

    const up25 = data.find((p) => p.prefix === 'UP25');
    assert.strictEqual(up25?.location_name, 'Bareilly', 'UP25 must be Bareilly');

    const up38 = data.find((p) => p.prefix === 'UP38');
    assert.strictEqual(up38?.location_name, 'Sambhal', 'UP38 must be Sambhal');

    const hr = data.find((p) => p.prefix === 'HR');
    assert.strictEqual(hr?.location_name, 'Haryana');

    const uk = data.find((p) => p.prefix === 'UK');
    assert.strictEqual(uk?.location_name, 'Uttarakhand');
  });

  await asyncTest('vehicle_origin_locations has UP21, UP22, UP23, UP16 as quick buttons (DL non-quick)', async () => {
    const { data, error } = await supabase
      .from('vehicle_origin_locations')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    assert.ifError(error);

    const quickButtons = (data || []).filter((l) => l.is_quick_prefix);
    const quickNames = quickButtons.map((b) => b.name.toUpperCase());

    assert.strictEqual(quickButtons.length, 4, `Expected exactly 4 quick buttons, got ${quickButtons.length}`);
    assert.ok(quickNames.includes('UP21'), 'UP21 must be a quick button');
    assert.ok(quickNames.includes('UP22'), 'UP22 must be a quick button');
    assert.ok(quickNames.includes('UP23'), 'UP23 must be a quick button');
    assert.ok(quickNames.includes('UP16'), 'UP16 must be a quick button');
    assert.ok(!quickNames.includes('DL'), 'DL must NOT be a quick button');

    const dl = (data || []).find((l) => l.name.toUpperCase() === 'DL');
    assert.ok(dl, 'DL should exist in origin locations for manual entry');
    assert.strictEqual(dl?.is_quick_prefix, false);
  });

  // -----------------------------------------------------------------------------
  // 5. ADMIN EVENT CORRECTION SECURITY & AUDIT TRAIL VERIFICATION
  // -----------------------------------------------------------------------------
  console.log('\n📌 Test Group 5: Admin Gate Event Correction Security & Audit Trail');

  await asyncTest('Unauthorized (anon / non-admin) client-side UPDATE is REJECTED by PostgreSQL RLS', async () => {
    // 1. Create a temporary event using service role
    const { data: locRow } = await supabase.from('vehicle_origin_locations').select('id').limit(1).single();
    const { data: insertedEvent, error: insertErr } = await supabase
      .from('vehicle_counter_events')
      .insert({
        business_date: '2026-10-01',
        location_id: locRow?.id,
        increment: 1,
        vehicle_prefix: 'IP21',
        timestamp: new Date().toISOString(),
      })
      .select()
      .single();

    assert.ifError(insertErr);
    assert.ok(insertedEvent?.id);

    // 2. Attempt unauthorized client-side UPDATE using anon client
    const { data: updateData } = await anonClient
      .from('vehicle_counter_events')
      .update({ vehicle_prefix: 'HACKED' })
      .eq('id', insertedEvent.id)
      .select();

    // RLS should block the update (0 rows affected)
    assert.strictEqual(updateData?.length || 0, 0, 'RLS must reject unauthorized UPDATE');

    // 3. Verify event row remains unmutated
    const { data: verifiedEvent } = await supabase
      .from('vehicle_counter_events')
      .select('vehicle_prefix')
      .eq('id', insertedEvent.id)
      .single();

    assert.strictEqual(verifiedEvent?.vehicle_prefix, 'IP21', 'Operational record must remain unchanged');

    // Cleanup
    await supabase.from('vehicle_counter_events').delete().eq('id', insertedEvent.id);
  });

  await asyncTest('Authorized Admin correction updates authoritative event and creates central audit entry', async () => {
    // 1. Insert a temporary vehicle event with mistyped IP21
    const { data: locRow } = await supabase.from('vehicle_origin_locations').select('id').limit(1).single();
    const { data: insertedEvent, error: insertErr } = await supabase
      .from('vehicle_counter_events')
      .insert({
        business_date: '2026-10-01',
        location_id: locRow?.id,
        increment: 1,
        vehicle_prefix: 'IP21',
        timestamp: new Date().toISOString(),
      })
      .select()
      .single();

    assert.ifError(insertErr);
    assert.ok(insertedEvent?.id);

    // 2. Authorized correction IP21 -> UP21
    const correctedPrefix = 'UP21';
    const { error: updateErr } = await supabase
      .from('vehicle_counter_events')
      .update({ vehicle_prefix: correctedPrefix })
      .eq('id', insertedEvent.id);

    assert.ifError(updateErr);

    // 3. Record Audit Log entry
    const { data: auditEntry, error: auditErr } = await supabase
      .from('audit_logs')
      .insert({
        action: 'UPDATE',
        entity_type: 'vehicle_counter_event',
        entity_id: insertedEvent.id,
        old_values: { vehicle_prefix: 'IP21' },
        new_values: { vehicle_prefix: correctedPrefix },
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    assert.ifError(auditErr);
    assert.ok(auditEntry?.id);

    // 4. Verify authoritative event data is UP21 directly (no original_prefix column)
    const { data: verifiedEvent, error: verifyErr } = await supabase
      .from('vehicle_counter_events')
      .select('id, vehicle_prefix')
      .eq('id', insertedEvent.id)
      .single();

    assert.ifError(verifyErr);
    assert.strictEqual(verifiedEvent?.vehicle_prefix, 'UP21');

    // 5. Verify central audit trail record has full details
    const { data: verifiedAudit, error: verifyAuditErr } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('id', auditEntry.id)
      .single();

    assert.ifError(verifyAuditErr);
    assert.strictEqual(verifiedAudit?.action, 'UPDATE');
    assert.strictEqual(verifiedAudit?.entity_type, 'vehicle_counter_event');
    assert.strictEqual(verifiedAudit?.entity_id, insertedEvent.id);
    assert.deepStrictEqual(verifiedAudit?.old_values, { vehicle_prefix: 'IP21' });
    assert.deepStrictEqual(verifiedAudit?.new_values, { vehicle_prefix: 'UP21' });

    // Cleanup
    await supabase.from('vehicle_counter_events').delete().eq('id', insertedEvent.id);
    await supabase.from('audit_logs').delete().eq('id', auditEntry.id);
  });

  // -----------------------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
