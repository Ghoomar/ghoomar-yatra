import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canViewCosting, hasPermission } from '@/lib/rbac';

export interface CallerAuth {
  user: any;
  roleName: string | null;
  permissionCodes: string[];
  hasCostAccess: boolean;
  canViewRecipes: boolean;
  canManageRecipes: boolean;
  canViewMenu: boolean;
}

export async function resolveCallerAuth(request: NextRequest): Promise<CallerAuth> {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

  let user: any = null;
  let serverSupabase: any = null;

  const testUserId =
    process.env.NODE_ENV !== 'production' && process.env.ENABLE_TEST_AUTH_OVERRIDE === 'true'
      ? request.headers.get('x-test-user-id')
      : null;

  if (testUserId) {
    user = { id: testUserId };
    serverSupabase = createAdminClient();
  } else {
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
  }

  let roleName: string | null = null;
  let permissionCodes: string[] = [];

  if (user) {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('*, role:roles(id, name)')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      roleName = profile.role?.name || null;
      const { data: rolePerms } = await admin
        .from('role_permissions')
        .select('permissions(code)')
        .eq('role_id', profile.role_id);

      permissionCodes = (rolePerms || [])
        .map((rp: any) => rp.permissions?.code)
        .filter(Boolean);
    }
  }

  const hasCostAccess = canViewCosting(roleName, permissionCodes);
  const canViewRecipes = hasPermission(roleName, permissionCodes, 'sops.recipes.view');
  const canManageRecipes = hasPermission(roleName, permissionCodes, 'sops.recipes.manage');
  const canViewMenu = hasPermission(roleName, permissionCodes, 'sops.menu.view');

  return {
    user,
    roleName,
    permissionCodes,
    hasCostAccess,
    canViewRecipes,
    canManageRecipes,
    canViewMenu,
  };
}
