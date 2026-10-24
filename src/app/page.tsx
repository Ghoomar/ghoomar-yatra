import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveLandingPage } from '@/lib/rbac';
import { NoAccessNotice } from '@/components/auth/NoAccessNotice';

/**
 * Server-rendered authoritative root route.
 * Resolves each authenticated user's destination according to their configured
 * default landing page and verified RBAC permissions.
 */
export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // 1. Fetch user profile with assigned role and configured landing page
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, is_active, role:roles(id, name, landing_page)')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || profile.is_active === false) {
    redirect('/login?error=deactivated');
  }

  const roleObj = Array.isArray(profile.role) ? profile.role[0] : profile.role;
  const roleName = roleObj?.name || 'Viewer';
  const configuredLandingPage = roleObj?.landing_page || null;

  // 2. Fetch assigned permission codes for this role
  let rolePermCodes: string[] = [];
  if (roleObj?.id) {
    const { data: rpData } = await supabase
      .from('role_permissions')
      .select('permissions(code)')
      .eq('role_id', roleObj.id);

    rolePermCodes = (rpData || [])
      .map((rp: any) => rp.permissions?.code)
      .filter(Boolean);
  }

  // 3. Resolve destination using canonical hierarchy:
  //    (a) configured landing page (if valid & authorized)
  //    (b) initial role default (if authorized)
  //    (c) first authorized application landing page
  const destination = resolveLandingPage(roleName, rolePermCodes, configuredLandingPage);

  if (destination) {
    redirect(destination);
  }

  // 4. Safe fallback: render clean notice without redirect looping
  return <NoAccessNotice roleName={roleName} />;
}
