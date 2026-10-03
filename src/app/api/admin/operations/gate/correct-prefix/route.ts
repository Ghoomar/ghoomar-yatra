import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function verifyAdminCaller(request: Request) {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  const serverSupabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await serverSupabase.auth.getUser(bearerToken);

  if (authErr || !user) {
    return {
      authorized: false as const,
      status: 401,
      error: 'Authentication required. Please log in.',
    };
  }

  const { data: profile, error: profErr } = await serverSupabase
    .from('profiles')
    .select('*, role:roles(id, name)')
    .eq('id', user.id)
    .single();

  if (profErr || !profile || !profile.is_active) {
    return {
      authorized: false as const,
      status: 403,
      error: 'Access denied. Account is inactive or unverified.',
    };
  }

  // Check if caller's role has admin.manage permission or is named Admin
  const { data: permCheck } = await serverSupabase
    .from('role_permissions')
    .select('permissions(code)')
    .eq('role_id', profile.role_id);

  const hasAdminPerm =
    permCheck?.some((rp: any) => rp.permissions?.code === 'admin.manage') ||
    profile.role?.name === 'Admin';

  if (!hasAdminPerm) {
    return {
      authorized: false as const,
      status: 403,
      error: 'Access denied. System Administrator privilege required.',
    };
  }

  return { authorized: true as const, caller: profile, serverSupabase };
}

export async function POST(request: Request) {
  const auth = await verifyAdminCaller(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const { eventId, newPrefix } = body;

    if (!eventId || typeof eventId !== 'string') {
      return NextResponse.json({ error: 'Valid eventId is required.' }, { status: 400 });
    }

    if (!newPrefix || typeof newPrefix !== 'string' || !newPrefix.trim()) {
      return NextResponse.json({ error: 'Valid newPrefix is required.' }, { status: 400 });
    }

    const cleanNewPrefix = newPrefix.trim().toUpperCase();
    const adminClient = createAdminClient();

    // 1. Fetch current event to verify existence and capture old value
    const { data: existingEvent, error: fetchErr } = await adminClient
      .from('vehicle_counter_events')
      .select('id, business_date, vehicle_prefix, increment')
      .eq('id', eventId)
      .single();

    if (fetchErr || !existingEvent) {
      return NextResponse.json({ error: 'Gate vehicle event not found.' }, { status: 404 });
    }

    const oldPrefix = existingEvent.vehicle_prefix;

    // 2. Authoritative update of the gate event itself
    const { error: updateErr } = await adminClient
      .from('vehicle_counter_events')
      .update({ vehicle_prefix: cleanNewPrefix })
      .eq('id', eventId);

    if (updateErr) {
      throw updateErr;
    }

    // 3. Central System Audit Trail Entry
    await adminClient.from('audit_logs').insert({
      user_id: auth.caller.id,
      action: 'UPDATE',
      entity_type: 'vehicle_counter_event',
      entity_id: eventId,
      old_values: { vehicle_prefix: oldPrefix },
      new_values: { vehicle_prefix: cleanNewPrefix },
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      eventId,
      previousPrefix: oldPrefix,
      correctedPrefix: cleanNewPrefix,
    });
  } catch (err: any) {
    console.error('Error in correct-prefix route:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to correct vehicle prefix.' },
      { status: 500 }
    );
  }
}
