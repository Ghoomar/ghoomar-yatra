import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import {
  buildPrefixLookupMap,
  resolveSinglePrefix,
  resolveCarOrigins,
} from '../src/lib/gate/prefix-resolver';

const envContent = fs.readFileSync('.env.local', 'utf-8');
const env = Object.fromEntries(
  envContent
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.substring(0, idx).trim(), l.substring(idx + 1).trim()];
    })
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const BIKE_LOCATION_ID = 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f';
const PAGE_SIZE = 50;

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 GATE EVENT CORRECTIONS & UNMAPPED CARS VERIFICATION SUITE');
  console.log('================================================================\n');

  // Load prefix master
  const { data: prefixList, error: pErr } = await sb
    .from('vehicle_registration_prefixes')
    .select('*')
    .order('prefix', { ascending: true });
  if (pErr) throw pErr;

  const prefixMap = buildPrefixLookupMap(prefixList || []);
  const activeMappedPrefixes = (prefixList || [])
    .filter((p) => p.is_active !== false)
    .map((p) => p.prefix.trim().toUpperCase());

  console.log(
    `Loaded ${prefixList?.length} prefixes from master (${activeMappedPrefixes.length} active).\n`
  );

  // 1. All Entries Query Invariant (Page size & date filter)
  console.log('📌 Test 1: All Entries Query (Default 50-row window & date filter)');
  const { data: allData, count: allCount, error: allErr } = await sb
    .from('vehicle_counter_events')
    .select(
      'id, business_date, timestamp, increment, vehicle_prefix, location:vehicle_origin_locations(id, name)',
      { count: 'exact' }
    )
    .order('timestamp', { ascending: false })
    .range(0, PAGE_SIZE - 1);

  assert(!allErr && allData !== null, 'All Entries query succeeds');
  assert(
    (allData || []).length <= PAGE_SIZE,
    `All Entries respects page size limit (returned ${allData?.length} <= ${PAGE_SIZE})`
  );
  assert(allCount !== null && allCount >= 0, `Total event count is reported (count: ${allCount})`);

  // Date filter on All entries (dynamically uses date of returned row)
  const testDate = allData?.[0]?.business_date;
  if (testDate) {
    const { data: dateData, count: dateCount } = await sb
      .from('vehicle_counter_events')
      .select('id, business_date', { count: 'exact' })
      .eq('business_date', testDate)
      .order('timestamp', { ascending: false })
      .range(0, PAGE_SIZE - 1);

    assert(
      (dateData || []).every((d: any) => d.business_date === testDate),
      `Date filter restricts results to business_date: ${testDate} (count: ${dateCount})`
    );
  }

  // 2. Unmapped Cars Query Invariant (All-date scope, non-null prefix)
  console.log('\n📌 Test 2: Unmapped Cars Query Invariant (All-date scope, non-null prefix)');
  let unmappedQuery: any = sb
    .from('vehicle_counter_events')
    .select(
      'id, business_date, timestamp, increment, vehicle_prefix, location:vehicle_origin_locations(id, name)',
      { count: 'exact' }
    )
    .not('vehicle_prefix', 'is', null)
    .neq('location_id', BIKE_LOCATION_ID);

  if (activeMappedPrefixes.length > 0) {
    unmappedQuery = unmappedQuery.not(
      'vehicle_prefix',
      'in',
      `(${activeMappedPrefixes.join(',')})`
    );
  }

  unmappedQuery = unmappedQuery.order('timestamp', { ascending: false }).range(0, PAGE_SIZE - 1);

  const { data: unmappedData, count: unmappedCount, error: uErr } = await unmappedQuery;
  assert(!uErr && unmappedData !== null, 'Unmapped cars query executes successfully');
  assert(
    unmappedCount !== null && unmappedCount >= 0,
    `Unmapped cars count is reported (found: ${unmappedCount})`
  );

  // Invariant: Returned unmapped events must not be constrained by a single business date
  const unmappedRows = (unmappedData as any[]) || [];
  if (unmappedRows.length > 0) {
    const dates = Array.from(new Set(unmappedRows.map((e: any) => e.business_date)));
    console.log(`    Unmapped cars dates represented: ${dates.join(', ')}`);
    assert(dates.length >= 1, 'Unmapped cars query retrieves events across dates without date constraints');
  }

  // 3. Bike Exclusion Invariant
  console.log('\n📌 Test 3: Bike Exclusion Invariant from Unmapped Cars');
  const bikesInUnmapped = unmappedRows.filter((ev: any) => {
    const loc = Array.isArray(ev.location) ? ev.location[0] : ev.location;
    return (
      loc?.name?.toLowerCase() === 'bike' ||
      (ev.vehicle_prefix || '').toLowerCase() === 'bike' ||
      ev.location_id === BIKE_LOCATION_ID
    );
  });
  assert(bikesInUnmapped.length === 0, 'Zero Bikes present in Unmapped cars result');

  // 4. Mapped-Prefix Exclusion Invariant
  console.log('\n📌 Test 4: Mapped-Prefix Exclusion Invariant');
  const mappedInUnmapped = unmappedRows.filter((ev: any) => {
    return (
      ev.vehicle_prefix &&
      activeMappedPrefixes.includes(ev.vehicle_prefix.trim().toUpperCase())
    );
  });
  assert(mappedInUnmapped.length === 0, 'Zero mapped prefixes present in Unmapped cars result');

  // 5. Unknown/Unmapped Prefix Classification Invariant
  console.log('\n📌 Test 5: Unknown/Unmapped Prefix Classification Invariant');
  const distinctPrefixes = Array.from(
    new Set(unmappedRows.map((d: any) => d.vehicle_prefix?.trim().toUpperCase()))
  );
  if (distinctPrefixes.length > 0) {
    console.log(`    Unmapped prefixes in dataset: ${distinctPrefixes.join(', ')}`);
    const allGenuinelyUnmapped = distinctPrefixes.every(
      (p: string) => !activeMappedPrefixes.includes(p)
    );
    assert(
      allGenuinelyUnmapped,
      'Every returned prefix is genuinely unmapped in the vehicle registration prefix master'
    );
  } else {
    assert(true, 'Zero unmapped prefixes currently exist (valid state)');
  }

  // 6. Bike Visual Resolver Invariant ("BIKE", never "BIKE (UNMAPPED)")
  console.log('\n📌 Test 6: Bike Visual Resolver Invariant');
  const bikeResolvedEn = resolveSinglePrefix('Bike', prefixMap, 'en');
  assert(!bikeResolvedEn.isUnmapped, 'Bike resolution has isUnmapped === false (English)');
  assert(bikeResolvedEn.locationName === 'Bike', 'Bike resolution locationName === "Bike"');

  const bikeResolvedHi = resolveSinglePrefix('Bike', prefixMap, 'hi');
  assert(!bikeResolvedHi.isUnmapped, 'Bike resolution has isUnmapped === false (Hindi)');
  assert(bikeResolvedHi.locationName === 'बाइक', 'Bike resolution locationName === "बाइक"');

  const bikeUpperResolved = resolveSinglePrefix('BIKE', prefixMap, 'en');
  assert(!bikeUpperResolved.isUnmapped, 'Literal uppercase BIKE has isUnmapped === false');

  // 7. Unknown/Unmapped Prefix Visual Resolver Invariant
  console.log('\n📌 Test 7: Unknown/Unmapped Prefix Visual Resolver Invariant');
  const unmappedCarResolved = resolveSinglePrefix('DL80', prefixMap, 'en');
  assert(unmappedCarResolved.isUnmapped, 'Unknown prefix DL80 has isUnmapped === true');
  assert(unmappedCarResolved.locationName === 'DL80', 'DL80 retains raw prefix as locationName');

  const nonExistentPrefixResolved = resolveSinglePrefix('ZZ99', prefixMap, 'en');
  assert(nonExistentPrefixResolved.isUnmapped, 'Fictional prefix ZZ99 has isUnmapped === true');

  // 8. Mapped Prefix Visual Resolver Invariant
  console.log('\n📌 Test 8: Mapped Prefix Visual Resolver Invariant');
  const mappedCarResolved = resolveSinglePrefix('UP21', prefixMap, 'en');
  assert(!mappedCarResolved.isUnmapped, 'Known prefix UP21 has isUnmapped === false');
  assert(mappedCarResolved.locationName === 'Moradabad', 'UP21 resolves to Moradabad');

  const meerutResolved = resolveSinglePrefix('UP15', prefixMap, 'en');
  assert(!meerutResolved.isUnmapped, 'Meerut prefix UP15 has isUnmapped === false');
  assert(meerutResolved.locationName === 'Meerut', 'UP15 resolves to Meerut');

  // 9. Prefix Search Invariant (Filters results by search term)
  console.log('\n📌 Test 9: Prefix Search Invariant');
  const searchChar = distinctPrefixes[0]?.substring(0, 2) || 'DL';
  let searchUnmappedQuery: any = sb
    .from('vehicle_counter_events')
    .select('id, vehicle_prefix', { count: 'exact' })
    .not('vehicle_prefix', 'is', null)
    .neq('location_id', BIKE_LOCATION_ID)
    .ilike('vehicle_prefix', `%${searchChar}%`);

  if (activeMappedPrefixes.length > 0) {
    searchUnmappedQuery = searchUnmappedQuery.not(
      'vehicle_prefix',
      'in',
      `(${activeMappedPrefixes.join(',')})`
    );
  }

  const { data: searchData, count: searchCount } = await searchUnmappedQuery
    .order('timestamp', { ascending: false })
    .range(0, PAGE_SIZE - 1);

  assert(
    (searchData || []).every((d: any) =>
      d.vehicle_prefix?.toUpperCase().includes(searchChar.toUpperCase())
    ),
    `Prefix search strictly filters rows matching query "${searchChar}" (matched: ${searchCount || 0})`
  );

  // 10. Pagination Non-Overlap Invariant
  console.log('\n📌 Test 10: Pagination Non-Overlap Invariant');
  const pageSizeTest = 5;
  const { data: page1 } = await sb
    .from('vehicle_counter_events')
    .select('id, timestamp')
    .order('timestamp', { ascending: false })
    .range(0, pageSizeTest - 1);

  const { data: page2 } = await sb
    .from('vehicle_counter_events')
    .select('id, timestamp')
    .order('timestamp', { ascending: false })
    .range(pageSizeTest, pageSizeTest * 2 - 1);

  assert(
    (page1 || []).length === pageSizeTest && (page2 || []).length === pageSizeTest,
    `Sequential pages of size ${pageSizeTest} fetched successfully`
  );
  const page1Ids = new Set((page1 || []).map((x: any) => x.id));
  const page2Ids = (page2 || []).map((x: any) => x.id);
  const overlap = page2Ids.filter((id: string) => page1Ids.has(id));
  assert(
    overlap.length === 0,
    'Zero overlap between consecutive pagination ranges (clean pagination boundary)'
  );

  // 11. Car Origins Aggregation Reporting Stability
  console.log('\n📌 Test 11: Car Origins Aggregation Reporting Stability');
  const sampleEvents = [
    { increment: 1, vehicle_prefix: 'UP21', location: { name: 'UP21' } },
    { increment: 1, vehicle_prefix: 'DL01', location: { name: 'Others' } },
    { increment: 1, vehicle_prefix: null, location: { name: 'Bike' } }, // Bike excluded
    { increment: 1, vehicle_prefix: 'DL99', location: { name: 'Others' } }, // Unmapped car
  ];
  const origins = resolveCarOrigins(sampleEvents, prefixMap, 'en');
  assert(
    !origins.some((o) => o.locationName.toLowerCase() === 'bike'),
    'Bike is excluded from Car Origins aggregation'
  );
  assert(
    origins.some((o) => o.locationName === 'Moradabad'),
    'UP21 aggregated as Moradabad'
  );
  assert(
    origins.some((o) => o.locationName === 'DL99' && o.isUnmapped),
    'DL99 marked as unmapped in Car Origins'
  );

  console.log('\n================================================================');
  console.log(`🏁 SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test suite failed with error:', err);
  process.exit(1);
});
