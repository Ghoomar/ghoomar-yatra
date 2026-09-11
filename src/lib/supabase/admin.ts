import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase administrative client.
 * Uses SUPABASE_SERVICE_ROLE_KEY to perform privileged operations (e.g. auth.admin.createUser).
 * This module MUST NEVER be imported or executed in client components.
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient must only be called on the server side.');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zklzzfsxibewekkvslzg.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required for admin operations.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
