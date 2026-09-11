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
