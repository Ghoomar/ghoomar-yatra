import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function verifyAdminCaller(request: Request) {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  
  let user: any = null;
  let serverSupabase: any = null;

  try {
    serverSupabase = await createServerSupabaseClient();
    const { data: authData, error: authErr } = await serverSupabase.auth.getUser(bearerToken);
    if (!authErr) user = authData?.user;
  } catch {
    const admin = createAdminClient();
    if (bearerToken) {
      const { data: authData } = await admin.auth.getUser(bearerToken);
      user = authData?.user;
    }
    serverSupabase = admin;
  }

  if (!user) {
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

  const { data: permCheck } = await serverSupabase
    .from('role_permissions')
    .select('permissions(code)')
    .eq('role_id', profile.role_id);

  const hasAdminPerm =
    permCheck?.some((rp: any) => rp.permissions?.code === 'admin.manage') ||
    profile.role?.name === 'Admin';

  if (!hasAdminPerm) {
    return { authorized: false, status: 403, error: 'Access denied. System Administrator privilege required.' };
  }

  return { authorized: true, caller: profile, serverSupabase };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const auth = await verifyAdminCaller(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId } = await context.params;
  if (!userId) {
    return NextResponse.json({ error: 'Target user ID is required.' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    const adminClient = createAdminClient();

    // Fetch target user profile
    const { data: targetProfile, error: profErr } = await adminClient
      .from('profiles')
      .select('*, role:roles(name)')
      .eq('id', userId)
      .maybeSingle();

    if (profErr || !targetProfile) {
      return NextResponse.json({ error: 'Target user not found.' }, { status: 404 });
    }

    // 1. Action: Toggle Active Status
    if (action === 'toggle_status') {
      const nextStatus = Boolean(body.isActive);

      // Self-lockout safeguard: Do not allow deactivating self or the only remaining active Admin
      if (nextStatus === false) {
        if (userId === auth.caller.id) {
          return NextResponse.json(
            { error: 'Cannot deactivate your own administrator account.' },
            { status: 400 }
          );
        }

        if (targetProfile.role?.name === 'Admin') {
          const { count: activeAdminCount } = await adminClient
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('role_id', targetProfile.role_id)
            .eq('is_active', true);

          if ((activeAdminCount || 0) <= 1) {
            return NextResponse.json(
              { error: 'Cannot deactivate the only remaining active System Administrator account.' },
              { status: 400 }
            );
          }
        }
      }

      // Update Supabase Auth ban duration
      await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: nextStatus ? 'none' : '876000h',
      });

      // Update profiles table
      const { data: updatedProfile, error: updateErr } = await adminClient
        .from('profiles')
        .update({
          is_active: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select()
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      // Record administrative auth event
      await adminClient.from('user_auth_events').insert({
        user_id: userId,
        identifier: targetProfile.email,
        event_type: nextStatus ? 'account_activated' : 'account_deactivated',
        status: 'success',
        metadata: { changed_by: auth.caller.full_name, caller_id: auth.caller.id },
      });

      return NextResponse.json({ success: true, profile: updatedProfile });
    }

    // 2. Action: Force User Logout
    if (action === 'force_logout') {
      // Invalidate existing sessions in Supabase Auth by setting a 1-second ban and immediate unban
      // This immediately revokes all issued refresh tokens in GoTrue
      await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: '1s',
      });

      // Log event
      await adminClient.from('user_auth_events').insert({
        user_id: userId,
        identifier: targetProfile.email,
        event_type: 'logout',
        status: 'success',
        failure_reason: 'admin_forced_logout',
        metadata: { forced_by: auth.caller.full_name, caller_id: auth.caller.id },
      });

      return NextResponse.json({
        success: true,
        message: 'User sessions successfully invalidated.',
      });
    }

    // 3. Action: De-register / Revoke Device
    if (action === 'deregister_device') {
      const { deviceId } = body;
      if (!deviceId) {
        return NextResponse.json({ error: 'Device ID is required.' }, { status: 400 });
      }

      // Revoke in gate_device_authorizations if exists
      await adminClient
        .from('gate_device_authorizations')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
        })
        .eq('device_id', deviceId)
        .eq('user_id', userId);

      // Remove / revoke in user_devices
      await adminClient
        .from('user_devices')
        .delete()
        .eq('device_id', deviceId)
        .eq('user_id', userId);

      // Record device revoked event
      await adminClient.from('user_auth_events').insert({
        user_id: userId,
        identifier: targetProfile.email,
        event_type: 'device_revoked',
        status: 'success',
        device_id: deviceId,
        metadata: { revoked_by: auth.caller.full_name },
      });

      return NextResponse.json({ success: true, message: 'Device authorization successfully revoked.' });
    }

    return NextResponse.json({ error: 'Unsupported administrative action.' }, { status: 400 });
  } catch (err: any) {
    console.error('[user-actions] Error executing action:', err);
    return NextResponse.json({ error: err.message || 'Failed to execute administrative action.' }, { status: 500 });
  }
}
