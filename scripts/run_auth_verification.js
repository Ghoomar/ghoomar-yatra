const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load .env.local if present
try {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = value;
      }
    });
  }
} catch (e) {}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY || !SUPABASE_URL) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  process.exit(1);
}

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const anonClient = createClient(SUPABASE_URL, ANON_KEY);

async function runSuite() {
  console.log('=== STARTING GHOOMAR YATRA AUTH & RBAC VERIFICATION SUITE ===\n');

  // Fetch Roles
  const { data: roles } = await adminClient.from('roles').select('*');
  const adminRole = roles.find(r => r.name === 'Admin');
  const cashierRole = roles.find(r => r.name === 'Cashier');
  console.log('Roles loaded. Admin ID:', adminRole?.id, 'Cashier ID:', cashierRole?.id);

  // 1. Create a dedicated Admin Test Account to test Admin Login and Session
  const adminEmail = `admin_test_${Date.now()}@ghoomarthali.in`;
  const adminPassword = 'AdminPassword123!';
  console.log('\n[1] Creating temporary Admin user:', adminEmail);

  const { data: authAdminData, error: adminCreateErr } = await adminClient.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: 'Verification Admin' }
  });
  if (adminCreateErr) throw new Error('Failed to create admin user: ' + adminCreateErr.message);

  const adminUserId = authAdminData.user.id;
  console.log('  -> Admin auth.users created with UUID:', adminUserId);

  await adminClient.from('profiles').insert({
    id: adminUserId,
    full_name: 'Verification Admin',
    email: adminEmail,
    role_id: adminRole.id,
    is_active: true
  });
  console.log('  -> Admin public.profiles inserted with matching UUID and role Admin');

  // Test B: Login as Admin
  console.log('\n[Test B] Authenticating as Admin user...');
  const { data: adminSession, error: adminLoginErr } = await anonClient.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword
  });
  if (adminLoginErr) throw new Error('Admin login failed: ' + adminLoginErr.message);
  console.log('  -> Admin successfully authenticated. Access Token issued:', Boolean(adminSession.session.access_token));

  // Cookie headers for server API calls
  const cookieHeader = `sb-access-token=${adminSession.session.access_token}; sb-refresh-token=${adminSession.session.refresh_token}`;

  // Test E: Create new user via /api/admin/users (Official Server API Flow)
  const cashierEmail = `cashier_test_${Date.now()}@ghoomarthali.in`;
  const cashierPassword = 'CashierPassword123!';
  console.log('\n[Test E] Calling POST /api/admin/users to provision new user:', cashierEmail);

  const createRes = await fetch('http://localhost:3000/api/admin/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'Authorization': `Bearer ${adminSession.session.access_token}`
    },
    body: JSON.stringify({
      fullName: 'Mahesh Cashier Test',
      email: cashierEmail,
      phone: '9876543210',
      roleId: cashierRole.id,
      isActive: true,
      password: cashierPassword
    })
  });

  const createResult = await createRes.json();
  console.log('  -> POST /api/admin/users Status:', createRes.status, createResult);
  if (!createRes.ok || !createResult.success) {
    throw new Error('User creation API failed: ' + JSON.stringify(createResult));
  }
  const cashierUserId = createResult.profile.id;
  console.log('  -> PASS: Real UUID assigned in auth.users and public.profiles:', cashierUserId);

  // Test Duplicate Email Validation
  console.log('\n[Validation Test] Attempting duplicate user creation with same email:', cashierEmail);
  const dupRes = await fetch('http://localhost:3000/api/admin/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'Authorization': `Bearer ${adminSession.session.access_token}`
    },
    body: JSON.stringify({
      fullName: 'Duplicate User Test',
      email: cashierEmail,
      phone: '9876543210',
      roleId: cashierRole.id,
      isActive: true,
      password: 'AnotherPassword123!'
    })
  });
  const dupResult = await dupRes.json();
  console.log('  -> Duplicate check response Status:', dupRes.status, 'Error message:', dupResult.error);
  if (dupRes.status !== 400 || !dupResult.error?.includes('already registered')) {
    throw new Error('Duplicate email validation failed!');
  }
  console.log('  -> PASS: Duplicate email rejected gracefully with clear message.');

  // Test F: New User Login
  console.log('\n[Test F] Testing sign-in with newly provisioned Cashier credentials...');
  const cashierClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: cashierAuth, error: cashierLoginErr } = await cashierClient.auth.signInWithPassword({
    email: cashierEmail,
    password: cashierPassword
  });
  if (cashierLoginErr) throw new Error('Cashier login failed: ' + cashierLoginErr.message);
  console.log('  -> PASS: Cashier successfully logged in! User ID:', cashierAuth.user.id);

  // Test G: Deactivate User -> login & access blocked
  console.log('\n[Test G] Deactivating Cashier account via PUT /api/admin/users...');
  const deactRes = await fetch('http://localhost:3000/api/admin/users', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'Authorization': `Bearer ${adminSession.session.access_token}`
    },
    body: JSON.stringify({
      userId: cashierUserId,
      isActive: false
    })
  });
  const deactResult = await deactRes.json();
  console.log('  -> Deactivate PUT Status:', deactRes.status, deactResult);

  console.log('  -> Attempting login with deactivated Cashier credentials...');
  const { data: deactLoginData, error: deactLoginErr } = await cashierClient.auth.signInWithPassword({
    email: cashierEmail,
    password: cashierPassword
  });
  console.log('  -> Deactivated login attempt result:', {
    user: deactLoginData?.user?.id,
    error: deactLoginErr?.message
  });
  if (!deactLoginErr) {
    throw new Error('Deactivated user was incorrectly allowed to sign in!');
  }
  console.log('  -> PASS: Deactivated user is blocked from logging in with error:', deactLoginErr.message);

  // Reactivate Cashier
  console.log('\n[Reactivation] Reactivating Cashier account...');
  await fetch('http://localhost:3000/api/admin/users', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'Authorization': `Bearer ${adminSession.session.access_token}`
    },
    body: JSON.stringify({
      userId: cashierUserId,
      isActive: true
    })
  });

  // Test H, I, J: Dynamic Role & Permission Changes
  console.log('\n[Test H, I, J] Testing dynamic RBAC permissions matrix...');
  // 1. Fetch current permissions for Cashier
  const permRes = await fetch('http://localhost:3000/api/admin/roles/permissions', {
    headers: { 'Cookie': cookieHeader, 'Authorization': `Bearer ${adminSession.session.access_token}` }
  });
  const permData = await permRes.json();
  const allPerms = permData.permissions;
  const invStockPerm = allPerms.find(p => p.code === 'inventory.stock');
  const adminManagePerm = allPerms.find(p => p.code === 'admin.manage');
  const salesPerm = allPerms.find(p => p.code === 'finance.sales');

  const cashierInitialPerms = permData.role_permissions
    .filter(rp => rp.role_id === cashierRole.id)
    .map(rp => rp.permission_id);

  console.log('  -> Cashier initial permission count:', cashierInitialPerms.length);
  console.log('  -> Cashier has admin.manage?', cashierInitialPerms.includes(adminManagePerm.id), '(MUST BE FALSE)');
  console.log('  -> Cashier has inventory.stock?', cashierInitialPerms.includes(invStockPerm.id), '(MUST BE FALSE)');

  if (cashierInitialPerms.includes(adminManagePerm.id)) {
    throw new Error('Cashier should NOT have admin.manage!');
  }

  // Grant Cashier inventory.stock permission dynamically
  console.log('\n[Test J] Admin granting "inventory.stock" permission to Cashier role...');
  const updatedPermIds = [...cashierInitialPerms, invStockPerm.id];
  const grantRes = await fetch('http://localhost:3000/api/admin/roles/permissions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'Authorization': `Bearer ${adminSession.session.access_token}`
    },
    body: JSON.stringify({
      roleId: cashierRole.id,
      permissionIds: updatedPermIds
    })
  });
  const grantResult = await grantRes.json();
  console.log('  -> Save permissions response Status:', grantRes.status, grantResult);

  // Verify database reflects the change
  const { data: verifyRolePerms } = await adminClient
    .from('role_permissions')
    .select('permissions(code)')
    .eq('role_id', cashierRole.id);
  const verifyCodes = verifyRolePerms.map(rp => rp.permissions?.code);
  console.log('  -> Authoritative database role_permissions for Cashier now includes:', verifyCodes);

  if (!verifyCodes.includes('inventory.stock')) {
    throw new Error('Cashier did not receive inventory.stock in database!');
  }
  console.log('  -> PASS: Cashier role now dynamically possesses inventory.stock!');

  // Reset Cashier permissions back to baseline
  console.log('\n[Reset] Resetting Cashier permissions back to default baseline...');
  await fetch('http://localhost:3000/api/admin/roles/permissions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'Authorization': `Bearer ${adminSession.session.access_token}`
    },
    body: JSON.stringify({
      roleId: cashierRole.id,
      permissionIds: cashierInitialPerms
    })
  });

  // Self-Lockout Safeguard Test: Try removing admin.manage from Admin role
  console.log('\n[Safeguard Test] Testing Admin Self-Lockout Protection (attempting to revoke admin.manage from Admin)...');
  const adminPermsWithoutManage = allPerms.filter(p => p.code !== 'admin.manage').map(p => p.id);
  await fetch('http://localhost:3000/api/admin/roles/permissions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'Authorization': `Bearer ${adminSession.session.access_token}`
    },
    body: JSON.stringify({
      roleId: adminRole.id,
      permissionIds: adminPermsWithoutManage
    })
  });
  const { data: adminPermsCheck } = await adminClient
    .from('role_permissions')
    .select('permissions(code)')
    .eq('role_id', adminRole.id);
  const adminCodes = adminPermsCheck.map(p => p.permissions?.code);
  console.log('  -> Admin permissions after strip attempt contains admin.manage?', adminCodes.includes('admin.manage'));
  if (!adminCodes.includes('admin.manage')) {
    throw new Error('Admin self-lockout protection failed! admin.manage was removed.');
  }
  console.log('  -> PASS: Self-lockout protection enforced! admin.manage was preserved automatically.');

  // Clean up temporary test accounts
  console.log('\n[Cleanup] Removing temporary verification test accounts...');
  await adminClient.from('profiles').delete().eq('id', cashierUserId);
  await adminClient.auth.admin.deleteUser(cashierUserId);
  await adminClient.from('profiles').delete().eq('id', adminUserId);
  await adminClient.auth.admin.deleteUser(adminUserId);
  console.log('  -> Cleanup complete.');

  console.log('\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY ===');
}

runSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
