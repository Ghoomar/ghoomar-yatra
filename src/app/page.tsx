import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Server-rendered authoritative root route.
 * Strictly guarantees that unauthenticated requests never reach the dashboard.
 */
export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Authenticated user landing resolution
  const { data: profile } = await supabase
    .from('profiles')
    .select('role:roles(name)')
    .eq('id', user.id)
    .maybeSingle();

  const roleName = Array.isArray(profile?.role)
    ? (profile.role[0] as any)?.name
    : (profile?.role as any)?.name;

  if (roleName === 'Gate Staff') {
    redirect('/operations/gate');
  }

  redirect('/dashboard');
}
