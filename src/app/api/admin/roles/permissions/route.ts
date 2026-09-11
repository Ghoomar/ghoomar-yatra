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

  return { authorized: true, caller: profile };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  const serverSupabase = await createServerSupabaseClient();
  const { data: { user } } = await serverSupabase.auth.getUser(bearerToken);

  if (!user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const adminClient = createAdminClient();

    const [
      { data: roles, error: rolesErr },
      { data: permissions, error: permsErr },
      { data: rolePermissions, error: rpErr },
    ] = await Promise.all([
      adminClient.from('roles').select('*').order('name'),
      adminClient.from('permissions').select('*').order('module', { ascending: true }).order('code', { ascending: true }),
      adminClient.from('role_permissions').select('*'),
    ]);

    if (rolesErr) throw rolesErr;
    if (permsErr) throw permsErr;
    if (rpErr) throw rpErr;

    return NextResponse.json({
      roles: roles || [],
      permissions: permissions || [],
      role_permissions: rolePermissions || [],
    });
  } catch (err: any) {
    console.error('Error fetching roles & permissions:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch roles and permissions.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await verifyAdminCaller(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const { roleId, permissionIds } = body;

    if (!roleId || !Array.isArray(permissionIds)) {
      return NextResponse.json({ error: 'roleId and permissionIds (array) are required.' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Verify role exists
    const { data: targetRole, error: roleErr } = await adminClient
      .from('roles')
      .select('*')
      .eq('id', roleId)
      .single();

    if (roleErr || !targetRole) {
      return NextResponse.json({ error: 'Target role not found.' }, { status: 404 });
    }

    // Safeguard: If target role is Admin, admin.manage permission MUST NOT be removed
    if (targetRole.name === 'Admin') {
      const { data: adminManagePerm } = await adminClient
        .from('permissions')
        .select('id')
        .eq('code', 'admin.manage')
        .single();

      if (adminManagePerm && !permissionIds.includes(adminManagePerm.id)) {
        permissionIds.push(adminManagePerm.id);
      }
    }

    // Fetch existing permissions for audit log
    const { data: oldPerms } = await adminClient
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', roleId);

    // Delete existing permissions for this role
    const { error: deleteErr } = await adminClient
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId);

    if (deleteErr) throw deleteErr;

    // Insert new role_permissions if any
    if (permissionIds.length > 0) {
      const inserts = permissionIds.map((permId: string) => ({
        role_id: roleId,
        permission_id: permId,
      }));

      const { error: insertErr } = await adminClient
        .from('role_permissions')
        .insert(inserts);

      if (insertErr) throw insertErr;
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      action: 'UPDATE',
      entity_type: 'role_permissions',
      entity_id: roleId,
      user_id: auth.caller.id,
      old_values: { permission_ids: oldPerms?.map((p: any) => p.permission_id) || [] },
      new_values: { permission_ids: permissionIds },
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, count: permissionIds.length });
  } catch (err: any) {
    console.error('Error updating role permissions:', err);
    return NextResponse.json({ error: err.message || 'Failed to update role permissions.' }, { status: 500 });
  }
}
