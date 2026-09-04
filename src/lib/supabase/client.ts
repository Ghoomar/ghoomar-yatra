import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zklzzfsxibewekkvslzg.supabase.co';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprbHp6ZnN4aWJld2Vra3ZzbHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNzMxMDAsImV4cCI6MjEwMTk0OTEwMH0.ONCDNeDbmvLNhR97LFxucqYAOd6ByiNPpC7UDKgp9pg';

  return createBrowserClient(supabaseUrl, supabaseKey);
}
