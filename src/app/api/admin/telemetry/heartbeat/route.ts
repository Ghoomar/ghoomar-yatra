import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
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
    const serverSupabase = await createServerSupabaseClient();
    const { data: { user } } = await serverSupabase.auth.getUser();

    // Only record heartbeats for authenticated users
    if (!user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.deviceId) {
      return NextResponse.json({ error: 'Device ID required' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const adminClient = createAdminClient();

    // Upsert into user_devices
    const devicePayload: any = {
      user_id: user.id,
      device_id: body.deviceId,
      device_label: body.deviceLabel || 'Browser Device',
      device_type: body.deviceType || 'unknown',
      os_name: body.osName || null,
      os_version: body.osVersion || null,
      browser_name: body.browserName || null,
      browser_version: body.browserVersion || null,
      screen_resolution: body.screenResolution || null,
      device_pixel_ratio: body.devicePixelRatio ? Number(body.devicePixelRatio) : null,
      timezone: body.timezone || null,
      language: body.language || null,
      pwa_supported: Boolean(body.pwaSupported),
      standalone_mode: Boolean(body.standaloneMode),
      notification_permission: body.notificationPermission || 'default',
      last_ip: ip,
      last_visibility_state: body.visibilityState || 'visible',
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await adminClient.from('user_devices').upsert(devicePayload, {
      onConflict: 'user_id,device_id',
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.warn('[telemetry-heartbeat] Non-blocking warning:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
