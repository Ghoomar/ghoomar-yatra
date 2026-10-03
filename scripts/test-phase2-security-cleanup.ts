import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// Read environment
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
Object.assign(process.env, env);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || 'https://zklzzfsxibewekkvslzg.supabase.co';
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const anonClient = createClient(supabaseUrl, anonKey);
const adminClient = createClient(supabaseUrl, serviceKey);

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 PHASE 2 (P0) SECURITY CLEANUP VERIFICATION SUITE');
  console.log('================================================================\n');

  // Create an authenticated non-admin client (Staff)
  const staffEmail = 'test.staff.cleanup@ghoomaryatra.com';
  const staffPassword = 'TestStaffPassword123!';
  let staffId: string = '';

  // Get or create staff user
  const { data: existingUser } = await adminClient.auth.admin.listUsers();
  const foundStaff = existingUser?.users?.find((u) => u.email === staffEmail);
  if (foundStaff) {
    staffId = foundStaff.id;
  } else {
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: staffEmail,
      password: staffPassword,
      email_confirm: true,
    });
    if (createErr || !newUser.user) {
      throw new Error(`Failed to create staff user: ${createErr?.message}`);
    }
    staffId = newUser.user.id;
  }

  // Ensure staff has non-admin role (Cashier)
  const { data: cashierRole } = await adminClient
    .from('roles')
    .select('id')
    .eq('name', 'Cashier')
    .single();

  await adminClient.from('profiles').upsert({
    id: staffId,
    email: staffEmail,
    full_name: 'Test Gate Staff',
    role_id: cashierRole?.id,
    is_active: true,
  });

  const staffClient = createClient(supabaseUrl, anonKey);
  const { error: loginErr } = await staffClient.auth.signInWithPassword({
    email: staffEmail,
    password: staffPassword,
  });
  if (loginErr) {
    throw new Error(`Failed to sign in staff client: ${loginErr.message}`);
  }

  // Fetch valid location for vehicle tests
  const { data: validLocation } = await adminClient
    .from('vehicle_origin_locations')
    .select('id')
    .limit(1)
    .single();

  // ---------------------------------------------------------------------------
  // Test Group 1: Anonymous Access Denial on Phase 2 Objects
  // ---------------------------------------------------------------------------
  console.log('📌 Test Group 1: Anonymous Access Denial on Targeted Tables & Functions');

  // user_permissions
  const { error: anonUpSelect } = await anonClient.from('user_permissions').select('*').limit(1);
  assert(anonUpSelect?.code === '42501', 'Anonymous SELECT on user_permissions is BLOCKED (42501)');

  const { error: anonUpInsert } = await anonClient
    .from('user_permissions')
    .insert({ user_id: staffId, permission_id: '00000000-0000-0000-0000-000000000000', is_granted: true });
  assert(anonUpInsert?.code === '42501', 'Anonymous INSERT on user_permissions is BLOCKED (42501)');

  // sales_order_items
  const { error: anonSoiSelect } = await anonClient.from('sales_order_items').select('*').limit(1);
  assert(anonSoiSelect?.code === '42501', 'Anonymous SELECT on sales_order_items is BLOCKED (42501)');

  // vehicle_counter_events
  const { error: anonVceSelect } = await anonClient.from('vehicle_counter_events').select('*').limit(1);
  assert(anonVceSelect?.code === '42501', 'Anonymous SELECT on vehicle_counter_events is BLOCKED (42501)');

  const { error: anonVceInsert } = await anonClient
    .from('vehicle_counter_events')
    .insert({ business_date: '2026-10-03', increment: 1, location_id: validLocation?.id });
  assert(anonVceInsert?.code === '42501', 'Anonymous INSERT on vehicle_counter_events is BLOCKED (42501)');

  // visitor_counter_events
  const { error: anonVisSelect } = await anonClient.from('visitor_counter_events').select('*').limit(1);
  assert(anonVisSelect?.code === '42501', 'Anonymous SELECT on visitor_counter_events is BLOCKED (42501)');

  const { error: anonVisInsert } = await anonClient
    .from('visitor_counter_events')
    .insert({ business_date: '2026-10-03', increment: 1 });
  assert(anonVisInsert?.code === '42501', 'Anonymous INSERT on visitor_counter_events is BLOCKED (42501)');

  // vehicle_registration_prefixes
  const { error: anonVrpSelect } = await anonClient.from('vehicle_registration_prefixes').select('*').limit(1);
  assert(anonVrpSelect?.code === '42501', 'Anonymous SELECT on vehicle_registration_prefixes is BLOCKED (42501)');

  // employee_salary_payouts
  const { error: anonPayoutsSelect } = await anonClient.from('employee_salary_payouts').select('*').limit(1);
  assert(anonPayoutsSelect?.code === '42501', 'Anonymous SELECT on employee_salary_payouts is BLOCKED (42501)');

  // Functions
  const { error: anonMtdErr } = await anonClient.rpc('get_mtd_financial_summary', { p_business_date: '2026-10-03' });
  assert(
    anonMtdErr !== null && (anonMtdErr.code === '42501' || anonMtdErr.message.includes('permission denied')),
    'Anonymous EXECUTE on get_mtd_financial_summary is REJECTED'
  );

  const { error: anonTrigErr } = await anonClient.rpc('protect_profile_sensitive_fields');
  assert(
    anonTrigErr !== null &&
      (anonTrigErr.code === '42501' ||
        anonTrigErr.code === 'PGRST202' ||
        anonTrigErr.message.includes('permission denied') ||
        anonTrigErr.message.includes('schema cache')),
    'Anonymous direct EXECUTE on protect_profile_sensitive_fields is REJECTED'
  );

  // ---------------------------------------------------------------------------
  // Test Group 2: Anonymous Access Denial on All 11 Internal Views
  // ---------------------------------------------------------------------------
  console.log('\n📌 Test Group 2: Anonymous Access Denial on All 11 Internal Views');

  const views = [
    'daily_financial_summary',
    'daily_sales_reconciliation',
    'daily_sales_summary',
    'daily_target_progress',
    'employee_salary_summary',
    'inventory_current_position',
    'meter_readings_ledger',
    'vendor_outstanding_summary',
    'distinct_sales_items',
    'employee_financial_balance',
    'monthly_profitability',
  ];

  for (const v of views) {
    const { error: vErr } = await anonClient.from(v).select('*').limit(1);
    assert(vErr?.code === '42501', `Anonymous access on view '${v}' is BLOCKED (42501)`);
  }

  // ---------------------------------------------------------------------------
  // Test Group 3: Authenticated Staff Permissions & Guardrails
  // ---------------------------------------------------------------------------
  console.log('\n📌 Test Group 3: Authenticated Staff Access & RBAC Boundary Enforcement');

  // Staff can read user_permissions
  const { data: staffUpData, error: staffUpErr } = await staffClient.from('user_permissions').select('*');
  assert(!staffUpErr && Array.isArray(staffUpData), 'Staff CAN SELECT from user_permissions');

  // Staff CANNOT mutate user_permissions
  const { error: staffUpInsertErr } = await staffClient
    .from('user_permissions')
    .insert({ user_id: staffId, permission_id: '00000000-0000-0000-0000-000000000000', is_granted: true });
  assert(
    staffUpInsertErr !== null && staffUpInsertErr.code === '42501',
    'Staff CANNOT INSERT into user_permissions (Admin only: 42501)'
  );

  // Staff can execute operational actions on sales_order_items (order item query/import)
  const { data: staffSoiData, error: staffSoiErr } = await staffClient
    .from('sales_order_items')
    .select('id')
    .limit(1);
  assert(!staffSoiErr && Array.isArray(staffSoiData), 'Staff CAN query sales_order_items for operations');

  // Staff can execute RPC get_mtd_financial_summary
  const { data: mtdData, error: mtdErr } = await staffClient.rpc('get_mtd_financial_summary', {
    p_business_date: '2026-10-01',
  });
  assert(!mtdErr && typeof mtdData === 'object', 'Staff CAN execute get_mtd_financial_summary RPC');

  // Staff CANNOT directly invoke internal trigger function
  const { error: staffTrigErr } = await staffClient.rpc('protect_profile_sensitive_fields');
  assert(
    staffTrigErr !== null &&
      (staffTrigErr.code === '42501' ||
        staffTrigErr.code === 'PGRST202' ||
        staffTrigErr.message.includes('permission denied') ||
        staffTrigErr.message.includes('schema cache')),
    'Staff CANNOT directly invoke internal trigger protect_profile_sensitive_fields'
  );

  // Staff can read active client views
  const clientViews = [
    'daily_financial_summary',
    'daily_sales_reconciliation',
    'daily_sales_summary',
    'daily_target_progress',
    'employee_salary_summary',
    'inventory_current_position',
    'meter_readings_ledger',
    'vendor_outstanding_summary',
  ];

  for (const cv of clientViews) {
    const { error: cvErr } = await staffClient.from(cv).select('*').limit(1);
    assert(!cvErr, `Staff CAN SELECT from client view '${cv}'`);
  }

  // Staff CANNOT read server-only/legacy views
  const serverViews = ['distinct_sales_items', 'employee_financial_balance', 'monthly_profitability'];
  for (const sv of serverViews) {
    const { error: svErr } = await staffClient.from(sv).select('*').limit(1);
    assert(svErr?.code === '42501', `Staff is BLOCKED from server-only/unused view '${sv}' (42501)`);
  }

  // ---------------------------------------------------------------------------
  // Test Group 4: Gate Counter Flow (Online & Offline Simulation)
  // ---------------------------------------------------------------------------
  console.log('\n📌 Test Group 4: Gate Counter & Offline Sync Integrity');

  const testEventIdVisitor = '00000000-0000-4000-a000-000000000001';
  const testEventIdVehicle = '00000000-0000-4000-a000-000000000002';

  // 4a: Staff reads gate counters
  const { error: staffVisReadErr } = await staffClient.from('visitor_counter_events').select('id').limit(1);
  assert(!staffVisReadErr, 'Staff CAN SELECT visitor_counter_events');

  const { error: staffVehReadErr } = await staffClient.from('vehicle_counter_events').select('id').limit(1);
  assert(!staffVehReadErr, 'Staff CAN SELECT vehicle_counter_events');

  // 4b: Offline sync upsert simulation for visitor event
  const { error: visUpsertErr } = await staffClient.from('visitor_counter_events').upsert(
    [
      {
        id: testEventIdVisitor,
        business_date: '2026-10-03',
        timestamp: new Date().toISOString(),
        increment: 1,
        counter_type: 'entry',
        entered_by: staffId,
      },
    ],
    { onConflict: 'id', ignoreDuplicates: true }
  );
  assert(!visUpsertErr, 'Staff offline-sync upsert on visitor_counter_events SUCCEEDS');

  // 4c: Offline sync upsert simulation for vehicle event
  const { error: vehUpsertErr } = await staffClient.from('vehicle_counter_events').upsert(
    [
      {
        id: testEventIdVehicle,
        business_date: '2026-10-03',
        timestamp: new Date().toISOString(),
        location_id: validLocation?.id,
        increment: 1,
        entered_by: staffId,
      },
    ],
    { onConflict: 'id', ignoreDuplicates: true }
  );
  assert(!vehUpsertErr, 'Staff offline-sync upsert on vehicle_counter_events SUCCEEDS');

  // 4d: Staff CANNOT update or delete gate events
  const { error: staffVisUpdateErr } = await staffClient
    .from('visitor_counter_events')
    .update({ increment: 5 })
    .eq('id', testEventIdVisitor);
  const { data: checkVis } = await adminClient.from('visitor_counter_events').select('increment').eq('id', testEventIdVisitor).single();
  assert(checkVis?.increment === 1, 'Staff CANNOT mutate visitor_counter_events (Increment remains 1)');

  const { error: staffVehDeleteErr } = await staffClient
    .from('vehicle_counter_events')
    .delete()
    .eq('id', testEventIdVehicle);
  const { data: checkVeh } = await adminClient.from('vehicle_counter_events').select('id').eq('id', testEventIdVehicle).single();
  assert(checkVeh?.id === testEventIdVehicle, 'Staff CANNOT delete vehicle_counter_events (Row remains intact)');

  // 4e: Staff can read vehicle prefixes
  const { data: vrpData, error: vrpErr } = await staffClient.from('vehicle_registration_prefixes').select('*').limit(3);
  assert(!vrpErr && Array.isArray(vrpData) && vrpData.length > 0, 'Staff CAN read vehicle_registration_prefixes');

  // 4f: Staff CANNOT insert or mutate vehicle prefixes
  const { error: staffVrpInsertErr } = await staffClient.from('vehicle_registration_prefixes').insert({
    prefix: 'XX99',
    location_name: 'Invalid Test City',
    state: 'Unknown',
  });
  assert(staffVrpInsertErr !== null && staffVrpInsertErr.code === '42501', 'Staff CANNOT insert vehicle_registration_prefixes (42501)');

  // ---------------------------------------------------------------------------
  // Test Group 5: Administrator Privileged Operations
  // ---------------------------------------------------------------------------
  console.log('\n📌 Test Group 5: Administrator Privileged Operations');

  // Admin can manage vehicle_registration_prefixes
  const testPrefix = 'ZZ99';
  const { error: adminVrpInsertErr } = await adminClient.from('vehicle_registration_prefixes').insert({
    prefix: testPrefix,
    location_name: 'Admin Test City',
    state: 'TestState',
  });
  assert(!adminVrpInsertErr, 'Admin CAN INSERT vehicle_registration_prefixes');

  const { error: adminVrpDeleteErr } = await adminClient
    .from('vehicle_registration_prefixes')
    .delete()
    .eq('prefix', testPrefix);
  assert(!adminVrpDeleteErr, 'Admin CAN DELETE vehicle_registration_prefixes');

  // Admin can manage gate events (correct-prefix workflow)
  const { error: adminVehUpdateErr } = await adminClient
    .from('vehicle_counter_events')
    .update({ vehicle_prefix: 'DL' })
    .eq('id', testEventIdVehicle);
  assert(!adminVehUpdateErr, 'Admin CAN UPDATE vehicle_counter_events');

  // Admin can clean up test gate events
  const { error: adminVisDelErr } = await adminClient.from('visitor_counter_events').delete().eq('id', testEventIdVisitor);
  const { error: adminVehDelErr } = await adminClient.from('vehicle_counter_events').delete().eq('id', testEventIdVehicle);
  assert(!adminVisDelErr && !adminVehDelErr, 'Admin CAN DELETE test gate counter events');

  // Clean up test staff user
  await adminClient.auth.admin.deleteUser(staffId);

  console.log('\n================================================================');
  console.log(`🏁 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
