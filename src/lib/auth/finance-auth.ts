import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  canEditPurchases,
  canEditVendors,
  canEditPayments,
  canDeleteFinancials,
} from '@/lib/rbac';

export interface FinanceCallerAuth {
  user: any;
  roleName: string | null;
  permissionCodes: string[];
  isAdmin: boolean;
  canEditPurchases: boolean;
  canEditVendors: boolean;
  canEditPayments: boolean;
  canDelete: boolean;
}

export async function resolveFinanceCallerAuth(
  request: Request | NextRequest
): Promise<FinanceCallerAuth | null> {
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

  if (!user) return null;

  let roleName: string | null = null;
  let permissionCodes: string[] = [];

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select(`
      id,
      is_active,
      role:roles!profiles_role_id_fkey(
        name,
        role_permissions:role_permissions!role_permissions_role_id_fkey(
          permissions:permissions!role_permissions_permission_id_fkey(code)
        )
      )
    `)
    .eq('id', user.id)
    .maybeSingle();

  if (profile && profile.is_active !== false) {
    const role = Array.isArray(profile.role) ? profile.role[0] : profile.role;
    roleName = role?.name || null;
    permissionCodes = (role?.role_permissions || [])
      .map((rp: any) => rp.permissions?.code)
      .filter(Boolean);
  }

  const isAdmin = roleName === 'Admin';

  return {
    user,
    roleName,
    permissionCodes,
    isAdmin,
    canEditPurchases: canEditPurchases(roleName, permissionCodes),
    canEditVendors: canEditVendors(roleName, permissionCodes),
    canEditPayments: canEditPayments(roleName, permissionCodes),
    canDelete: canDeleteFinancials(roleName),
  };
}
