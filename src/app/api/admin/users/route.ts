import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function verifyAdminCaller(request: Request) {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  const serverSupabase = await createServerSupabaseClient();
  const { data: { user }, error: authErr } = await serverSupabase.auth.getUser(bearerToken);

  if (authErr || !user) {
    return { authorized: false, status: 401, error: 'Authentication required. Please log in.' };
  }

  const { data: profile, error: profErr } = await serverSupabase
    .from('profiles')
    .select('*, role:roles(id, name)')
    .eq('id', user.id)
    .single();

  if (profErr || !profile || !profile.is_active) {
    return { authorized: false, status: 403, error: 'Access denied. Account is inactive or unverified.' };
  }

  // Check if caller's role has admin.manage permission or is named Admin
  const { data: permCheck } = await serverSupabase
    .from('role_permissions')
    .select('permissions(code)')
    .eq('role_id', profile.role_id);

  const hasAdminPerm = permCheck?.some((rp: any) => rp.permissions?.code === 'admin.manage') || profile.role?.name === 'Admin';

  if (!hasAdminPerm) {
    return { authorized: false, status: 403, error: 'Access denied. System Administrator privilege required.' };
  }

  return { authorized: true, caller: profile, serverSupabase };
}

export async function POST(request: Request) {
  const auth = await verifyAdminCaller(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const { fullName, email, phone, roleId, isActive, password } = body;

    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }

    if (!roleId) {
      return NextResponse.json({ error: 'A role must be assigned.' }, { status: 400 });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ error: 'Initial password must be at least 6 characters long.' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanFullName = fullName.trim();
    const cleanPhone = phone?.trim() || null;
    const activeFlag = isActive !== false;

    // Use official server-side Supabase Auth Admin API
    const adminClient = createAdminClient();

    const { data: authUser, error: createAuthErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password: password.trim(),
      email_confirm: true,
      user_metadata: {
        full_name: cleanFullName,
      },
    });

    if (createAuthErr) {
      if (
        createAuthErr.message?.toLowerCase().includes('already registered') ||
        createAuthErr.message?.toLowerCase().includes('duplicate') ||
        createAuthErr.status === 422
      ) {
        return NextResponse.json(
          { error: `A user with email "${cleanEmail}" is already registered in the system.` },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: createAuthErr.message }, { status: 400 });
    }

    if (!authUser?.user?.id) {
      return NextResponse.json({ error: 'Failed to provision user in Supabase Auth.' }, { status: 500 });
    }

    const newUserId = authUser.user.id;

    // If initial status is inactive, ban immediately in Supabase Auth
    if (!activeFlag) {
      await adminClient.auth.admin.updateUserById(newUserId, {
        ban_duration: '876000h',
      });
    }

    // Insert into public.profiles with the exact auth.users UUID
    const { data: newProfile, error: profileErr } = await adminClient
      .from('profiles')
      .insert({
        id: newUserId,
        full_name: cleanFullName,
        email: cleanEmail,
        phone: cleanPhone,
        role_id: roleId,
        is_active: activeFlag,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('*, role:roles(id, name)')
      .single();

    if (profileErr) {
      // Rollback auth user if profile insertion failed
      await adminClient.auth.admin.deleteUser(newUserId);
      return NextResponse.json({ error: `Failed to create user profile: ${profileErr.message}` }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      action: 'CREATE',
      entity_type: 'profiles',
      entity_id: newUserId,
      user_id: auth.caller.id,
      new_values: {
        full_name: cleanFullName,
        email: cleanEmail,
        phone: cleanPhone,
        role_id: roleId,
        is_active: activeFlag,
      },
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, profile: newProfile });
  } catch (err: any) {
    console.error('Error creating user:', err);
    return NextResponse.json({ error: err.message || 'Internal server error while creating user.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await verifyAdminCaller(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const { userId, fullName, phone, roleId, isActive, newPassword } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required.' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Fetch existing profile
    const { data: existingProfile } = await adminClient
      .from('profiles')
      .select('*, role:roles(name)')
      .eq('id', userId)
      .single();

    if (!existingProfile) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }

    // Self-lockout safeguard: Do not allow deactivating or stripping Admin role from the last active Admin
    if (existingProfile.role?.name === 'Admin' && isActive === false) {
      const { count: activeAdminCount } = await adminClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role_id', existingProfile.role_id)
        .eq('is_active', true);

      if ((activeAdminCount || 0) <= 1) {
        return NextResponse.json(
          { error: 'Cannot deactivate the only remaining active System Administrator account.' },
          { status: 400 }
        );
      }
    }

    // Update password if provided
    if (newPassword) {
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return NextResponse.json({ error: 'New password must be at least 6 characters long.' }, { status: 400 });
      }
      const { error: pwdErr } = await adminClient.auth.admin.updateUserById(userId, {
        password: newPassword.trim(),
      });
      if (pwdErr) {
        return NextResponse.json({ error: `Failed to update password: ${pwdErr.message}` }, { status: 400 });
      }
    }

    // Update ban status in Supabase Auth if isActive changed
    if (isActive !== undefined && isActive !== existingProfile.is_active) {
      const banDuration = isActive ? 'none' : '876000h';
      await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: banDuration,
      });
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (fullName) updatePayload.full_name = fullName.trim();
    if (phone !== undefined) updatePayload.phone = phone?.trim() || null;
    if (roleId) updatePayload.role_id = roleId;
    if (isActive !== undefined) updatePayload.is_active = Boolean(isActive);

    const { data: updatedProfile, error: updateErr } = await adminClient
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId)
      .select('*, role:roles(id, name)')
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      action: 'UPDATE',
      entity_type: 'profiles',
      entity_id: userId,
      user_id: auth.caller.id,
      old_values: existingProfile,
      new_values: updatePayload,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, profile: updatedProfile });
  } catch (err: any) {
    console.error('Error updating user:', err);
    return NextResponse.json({ error: err.message || 'Internal server error while updating user.' }, { status: 500 });
  }
}

/**
 * Helper to audit all database tables for references to a user.
 * Prevents accidental cascade-deletion of business, accounting, or audit history.
 */
async function checkUserDependencies(
  adminClient: ReturnType<typeof createAdminClient>,
  callerId: string,
  targetUserId: string
) {
  // 1. Fetch target profile with role
  const { data: targetProfile, error: profErr } = await adminClient
    .from('profiles')
    .select('*, role:roles(id, name)')
    .eq('id', targetUserId)
    .maybeSingle();

  if (profErr || !targetProfile) {
    return {
      canDelete: false,
      isSelf: false,
      isLastAdmin: false,
      dependencies: [],
      totalRecords: 0,
      targetUser: null,
      error: 'Target user account not found.',
    };
  }

  // 2. Safeguard: Prevent deleting own account
  const isSelf = targetUserId === callerId;

  // 3. Safeguard: Prevent deleting the final active Administrator
  let isLastAdmin = false;
  if (targetProfile.role?.name === 'Admin') {
    const { count: activeAdminCount } = await adminClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', targetProfile.role_id)
      .eq('is_active', true);

    if ((activeAdminCount || 0) <= 1) {
      isLastAdmin = true;
    }
  }

  // 4. Comprehensive audit of all 22 historical business tables in parallel
  const [
    expApproved,
    expRecorded,
    salApproved,
    bdayClosed,
    bdayReopened,
    attMarked,
    stockCreated,
    consCreated,
    invCreated,
    invApproved,
    purchCreated,
    vpayCreated,
    salesEntered,
    visEntered,
    vehEntered,
    actEntered,
    tipsRecorded,
    eftRecorded,
    unifIssued,
    meterRecorded,
    lpgRecorded,
    dieselRecorded,
    actualsReconciled,
    auditLogs,
    gateDevices,
  ] = await Promise.all([
    adminClient.from('expenses').select('id', { count: 'exact', head: true }).eq('approved_by_id', targetUserId),
    adminClient.from('expenses').select('id', { count: 'exact', head: true }).eq('recorded_by', targetUserId),
    adminClient.from('employee_salary_payouts').select('id', { count: 'exact', head: true }).eq('approved_by_id', targetUserId),
    adminClient.from('business_days').select('business_date', { count: 'exact', head: true }).eq('closed_by', targetUserId),
    adminClient.from('business_days').select('business_date', { count: 'exact', head: true }).eq('reopened_by', targetUserId),
    adminClient.from('attendance').select('id', { count: 'exact', head: true }).eq('marked_by', targetUserId),
    adminClient.from('stock_movements').select('id', { count: 'exact', head: true }).eq('created_by', targetUserId),
    adminClient.from('consumption_issues').select('id', { count: 'exact', head: true }).eq('created_by', targetUserId),
    adminClient.from('inventory_counts').select('id', { count: 'exact', head: true }).eq('created_by', targetUserId),
    adminClient.from('inventory_counts').select('id', { count: 'exact', head: true }).eq('approved_by', targetUserId),
    adminClient.from('purchase_headers').select('id', { count: 'exact', head: true }).eq('created_by', targetUserId),
    adminClient.from('vendor_payments').select('id', { count: 'exact', head: true }).eq('created_by', targetUserId),
    adminClient.from('sales_reports').select('id', { count: 'exact', head: true }).eq('entered_by', targetUserId),
    adminClient.from('visitor_counter_events').select('id', { count: 'exact', head: true }).eq('entered_by', targetUserId),
    adminClient.from('vehicle_counter_events').select('id', { count: 'exact', head: true }).eq('entered_by', targetUserId),
    adminClient.from('activity_daily_records').select('id', { count: 'exact', head: true }).eq('entered_by', targetUserId),
    adminClient.from('tips').select('id', { count: 'exact', head: true }).eq('recorded_by', targetUserId),
    adminClient.from('employee_financial_transactions').select('id', { count: 'exact', head: true }).eq('recorded_by', targetUserId),
    adminClient.from('employee_uniform_issues').select('id', { count: 'exact', head: true }).eq('issued_by', targetUserId),
    adminClient.from('meter_readings').select('id', { count: 'exact', head: true }).eq('recorded_by', targetUserId),
    adminClient.from('lpg_transactions').select('id', { count: 'exact', head: true }).eq('recorded_by', targetUserId),
    adminClient.from('diesel_transactions').select('id', { count: 'exact', head: true }).eq('recorded_by', targetUserId),
    adminClient.from('financial_monthly_actuals').select('id', { count: 'exact', head: true }).eq('reconciled_by', targetUserId),
    adminClient.from('audit_logs').select('id', { count: 'exact', head: true }).eq('user_id', targetUserId),
    adminClient.from('gate_device_authorizations').select('id', { count: 'exact', head: true }).eq('user_id', targetUserId),
  ]);

  const dependencies: { table: string; label: string; count: number }[] = [];

  const expTotal = (expApproved.count || 0) + (expRecorded.count || 0);
  if (expTotal > 0) dependencies.push({ table: 'expenses', label: 'Expenses (Approved / Recorded)', count: expTotal });

  if ((salApproved.count || 0) > 0) dependencies.push({ table: 'employee_salary_payouts', label: 'Salary Payout Approvals', count: salApproved.count! });

  const bdayTotal = (bdayClosed.count || 0) + (bdayReopened.count || 0);
  if (bdayTotal > 0) dependencies.push({ table: 'business_days', label: 'Business Day Closing / Reopenings', count: bdayTotal });

  if ((attMarked.count || 0) > 0) dependencies.push({ table: 'attendance', label: 'Staff Attendance Records', count: attMarked.count! });

  if ((stockCreated.count || 0) > 0) dependencies.push({ table: 'stock_movements', label: 'Inventory Stock Movements', count: stockCreated.count! });

  if ((consCreated.count || 0) > 0) dependencies.push({ table: 'consumption_issues', label: 'Kitchen Store Issues', count: consCreated.count! });

  const invTotal = (invCreated.count || 0) + (invApproved.count || 0);
  if (invTotal > 0) dependencies.push({ table: 'inventory_counts', label: 'Physical Inventory Counts', count: invTotal });

  if ((purchCreated.count || 0) > 0) dependencies.push({ table: 'purchase_headers', label: 'Purchase Invoices', count: purchCreated.count! });

  if ((vpayCreated.count || 0) > 0) dependencies.push({ table: 'vendor_payments', label: 'Vendor Payment Records', count: vpayCreated.count! });

  if ((salesEntered.count || 0) > 0) dependencies.push({ table: 'sales_reports', label: 'Daily Sales Reports', count: salesEntered.count! });

  if ((visEntered.count || 0) > 0) dependencies.push({ table: 'visitor_counter_events', label: 'Gate Visitor Counters', count: visEntered.count! });

  if ((vehEntered.count || 0) > 0) dependencies.push({ table: 'vehicle_counter_events', label: 'Gate Vehicle Counters', count: vehEntered.count! });

  if ((actEntered.count || 0) > 0) dependencies.push({ table: 'activity_daily_records', label: 'Village Activity Records', count: actEntered.count! });

  if ((tipsRecorded.count || 0) > 0) dependencies.push({ table: 'tips', label: 'Staff Tip Collections', count: tipsRecorded.count! });

  if ((eftRecorded.count || 0) > 0) dependencies.push({ table: 'employee_financial_transactions', label: 'Staff Ledger Transactions', count: eftRecorded.count! });

  if ((unifIssued.count || 0) > 0) dependencies.push({ table: 'employee_uniform_issues', label: 'Staff Uniform Custody Records', count: unifIssued.count! });

  if ((meterRecorded.count || 0) > 0) dependencies.push({ table: 'meter_readings', label: 'Electricity Meter Readings', count: meterRecorded.count! });

  if ((lpgRecorded.count || 0) > 0) dependencies.push({ table: 'lpg_transactions', label: 'LPG Gas Cylinder Records', count: lpgRecorded.count! });

  if ((dieselRecorded.count || 0) > 0) dependencies.push({ table: 'diesel_transactions', label: 'Generator Diesel Records', count: dieselRecorded.count! });

  if ((actualsReconciled.count || 0) > 0) dependencies.push({ table: 'financial_monthly_actuals', label: 'Monthly Financial Reconciliations', count: actualsReconciled.count! });

  if ((auditLogs.count || 0) > 0) dependencies.push({ table: 'audit_logs', label: 'Administrative Audit Trail Entries', count: auditLogs.count! });

  if ((gateDevices.count || 0) > 0) dependencies.push({ table: 'gate_device_authorizations', label: 'Active Gate Device Authorizations', count: gateDevices.count! });

  const totalRecords = dependencies.reduce((acc, d) => acc + d.count, 0);
  const canDelete = !isSelf && !isLastAdmin && totalRecords === 0;

  return {
    canDelete,
    isSelf,
    isLastAdmin,
    dependencies,
    totalRecords,
    targetUser: targetProfile,
  };
}

export async function GET(request: Request) {
  const auth = await verifyAdminCaller(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const checkUserId = searchParams.get('checkDependencies');

  try {
    const adminClient = createAdminClient();

    if (checkUserId) {
      const check = await checkUserDependencies(adminClient, auth.caller.id, checkUserId);
      if (check.error) {
        return NextResponse.json({ error: check.error }, { status: 404 });
      }
      return NextResponse.json(check);
    }

    const { data: users, error: usersErr } = await adminClient
      .from('profiles')
      .select('*, role:roles(id, name)')
      .order('created_at', { ascending: true });

    if (usersErr) throw usersErr;
    return NextResponse.json({ users });
  } catch (err: any) {
    console.error('Error fetching admin users:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch users.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await verifyAdminCaller(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { searchParams } = new URL(request.url);
    const targetUserId = body.userId || body.id || searchParams.get('userId');

    if (!targetUserId) {
      return NextResponse.json({ error: 'User ID is required for deletion.' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Perform thorough dependency & safeguard checks
    const check = await checkUserDependencies(adminClient, auth.caller.id, targetUserId);

    if (check.error || !check.targetUser) {
      return NextResponse.json({ error: check.error || 'User account not found.' }, { status: 404 });
    }

    // 1. Self-delete safeguard
    if (check.isSelf) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
    }

    // 2. Final Administrator safeguard
    if (check.isLastAdmin) {
      return NextResponse.json(
        { error: 'The final active Administrator cannot be deleted. Create or activate another Administrator first.' },
        { status: 400 }
      );
    }

    // 3. Protected historical business records safeguard
    if (check.dependencies.length > 0) {
      return NextResponse.json(
        {
          error: 'This user cannot be permanently deleted because they have historical records associated with their account. Deactivate the user instead.',
          dependencies: check.dependencies,
          totalRecords: check.totalRecords,
        },
        { status: 400 }
      );
    }

    const targetUser = check.targetUser;

    // 4. Official server-side Auth user deletion via Supabase Admin API
    const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(targetUserId);
    if (deleteAuthErr) {
      console.error('Error deleting user from auth.users:', deleteAuthErr);
      return NextResponse.json(
        { error: `Failed to delete authentication user: ${deleteAuthErr.message}` },
        { status: 500 }
      );
    }

    // 5. Ensure profile is deleted (profiles_id_fkey has ON DELETE CASCADE, but ensure clean state)
    await adminClient.from('profiles').delete().eq('id', targetUserId);

    // 6. Record privileged action in audit logs
    await adminClient.from('audit_logs').insert({
      action: 'USER_DELETED',
      entity_type: 'profiles',
      entity_id: targetUserId,
      user_id: auth.caller.id,
      old_values: {
        id: targetUser.id,
        email: targetUser.email,
        full_name: targetUser.full_name,
        role: targetUser.role?.name,
      },
      new_values: null,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: `User ${targetUser.email} has been permanently deleted.`,
    });
  } catch (err: any) {
    console.error('Error during user deletion:', err);
    return NextResponse.json({ error: err.message || 'Internal server error while deleting user.' }, { status: 500 });
  }
}

