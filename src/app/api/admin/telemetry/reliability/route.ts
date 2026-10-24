import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const serverSupabase = await createServerSupabaseClient();
    const { data: { user } } = await serverSupabase.auth.getUser();

    // Only record for authenticated users
    if (!user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.eventType) {
      return NextResponse.json({ error: 'Event type required' }, { status: 400 });
    }

    // Sanitize error message: truncate and remove potential tokens/passwords
    let sanitizedMessage = String(body.errorMessage || '').slice(0, 500);
    sanitizedMessage = sanitizedMessage.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
    sanitizedMessage = sanitizedMessage.replace(/password[:=]\s*["']?[^"'\s]+/gi, 'password=[REDACTED]');

    const adminClient = createAdminClient();

    await adminClient.from('user_reliability_events').insert({
      user_id: user.id,
      device_id: body.deviceId || null,
      event_type: body.eventType,
      error_message: sanitizedMessage || null,
      error_category: body.errorCategory || 'RUNTIME_ERROR',
      endpoint: body.endpoint ? String(body.endpoint).slice(0, 200) : null,
      status_code: body.statusCode ? Number(body.statusCode) : null,
      duration_ms: body.durationMs ? Number(body.durationMs) : null,
      connection_type: body.connectionType || null,
      effective_type: body.effectiveType || null,
      downlink_mbps: body.downlinkMbps ? Number(body.downlinkMbps) : null,
      rtt_ms: body.rttMs ? Number(body.rttMs) : null,
      is_online: body.isOnline !== false,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.warn('[telemetry-reliability] Non-blocking warning:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
