import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || '127.0.0.1';
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.event_type || !body.identifier) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const userAgent = request.headers.get('user-agent') || 'Unknown';
    const adminClient = createAdminClient();

    let targetUserId = body.user_id || null;

    // If targetUserId is not provided, attempt to look up by email or phone
    if (!targetUserId && body.identifier) {
      const cleanIdent = body.identifier.trim();
      if (cleanIdent.includes('@')) {
        const { data: prof } = await adminClient
          .from('profiles')
          .select('id')
          .eq('email', cleanIdent.toLowerCase())
          .maybeSingle();
        if (prof?.id) targetUserId = prof.id;
      } else {
        const cleanPhone = cleanIdent.replace(/[\s\-()]/g, '').slice(-10);
        const { data: prof } = await adminClient
          .from('profiles')
          .select('id')
          .eq('phone', cleanPhone)
          .maybeSingle();
        if (prof?.id) targetUserId = prof.id;
      }
    }

    // Insert into user_auth_events
    await adminClient.from('user_auth_events').insert({
      user_id: targetUserId,
      identifier: body.identifier.trim(),
      event_type: body.event_type,
      status: body.status || 'success',
      failure_reason: body.failure_reason || null,
      ip_address: ip,
      user_agent: userAgent,
      device_id: body.device_id || null,
      metadata: body.metadata || {},
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.warn('[record-event] Non-blocking telemetry warning:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
