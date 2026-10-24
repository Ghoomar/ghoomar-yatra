import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@supabase/supabase-js';

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || '127.0.0.1';
}

async function recordAuthEvent(adminClient: any, payload: any) {
  try {
    await adminClient.from('user_auth_events').insert(payload);
  } catch (err: any) {
    console.warn('[auth-telemetry] Non-blocking record error:', err?.message);
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent') || 'Unknown';

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.phone !== 'string') {
      return NextResponse.json(
        { error: 'Phone number is required.' },
        { status: 400 }
      );
    }

    // 1. Normalize phone: strip spaces, dashes, parentheses, leading +91 or 0
    let cleanPhone = body.phone.trim().replace(/[\s\-()]/g, '');
    if (cleanPhone.startsWith('+91')) {
      cleanPhone = cleanPhone.substring(3);
    } else if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
      cleanPhone = cleanPhone.substring(2);
    } else if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
      cleanPhone = cleanPhone.substring(1);
    }

    // 2. Validate standard 10-digit Indian mobile number format
    if (!/^\d{10}$/.test(cleanPhone)) {
      return NextResponse.json(
        { error: 'Invalid login credentials.' },
        { status: 400 }
      );
    }

    // 3. Database lookup via service-role admin client (NO hardcoded aliases)
    const adminClient = createAdminClient();
    const { data: profile, error: dbErr } = await adminClient
      .from('profiles')
      .select('id, email, is_active')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (dbErr) {
      console.error('[resolve-phone] Database query error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to resolve login identifier.' },
        { status: 500 }
      );
    }

    // Unknown phone number -> generic error without leaking account existence
    if (!profile || !profile.email) {
      recordAuthEvent(adminClient, {
        identifier: cleanPhone,
        event_type: 'login_failure',
        status: 'failure',
        failure_reason: 'unknown_phone_identifier',
        ip_address: ip,
        user_agent: userAgent,
        metadata: { auth_method: 'phone' },
      });

      return NextResponse.json(
        { error: 'Invalid login credentials.' },
        { status: 401 }
      );
    }

    // Deactivated account enforcement
    if (profile.is_active === false) {
      recordAuthEvent(adminClient, {
        user_id: profile.id,
        identifier: cleanPhone,
        event_type: 'login_failure',
        status: 'failure',
        failure_reason: 'account_inactive',
        ip_address: ip,
        user_agent: userAgent,
        metadata: { auth_method: 'phone' },
      });

      return NextResponse.json(
        { error: 'This account has been deactivated. Please contact your system administrator.' },
        { status: 403 }
      );
    }

    // 4. If password is provided: authenticate against Supabase Auth directly
    // This establishes authentication securely without exposing the user's email to the client
    if (typeof body.password === 'string' && body.password.trim()) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zklzzfsxibewekkvslzg.supabase.co';
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: authData, error: authErr } = await authClient.auth.signInWithPassword({
        email: profile.email,
        password: body.password.trim(),
      });

      if (authErr) {
        recordAuthEvent(adminClient, {
          user_id: profile.id,
          identifier: cleanPhone,
          event_type: 'login_failure',
          status: 'failure',
          failure_reason: authErr.message || 'invalid_password',
          ip_address: ip,
          user_agent: userAgent,
          metadata: { auth_method: 'phone' },
        });

        if (authErr.message?.toLowerCase().includes('banned') || authErr.message?.toLowerCase().includes('disabled')) {
          return NextResponse.json(
            { error: 'This account has been deactivated. Please contact your system administrator.' },
            { status: 403 }
          );
        }

        return NextResponse.json(
          { error: 'Invalid login credentials.' },
          { status: 401 }
        );
      }

      // Record successful login event
      recordAuthEvent(adminClient, {
        user_id: profile.id,
        identifier: cleanPhone,
        event_type: 'login_success',
        status: 'success',
        ip_address: ip,
        user_agent: userAgent,
        device_id: body.deviceId || null,
        metadata: { auth_method: 'phone' },
      });

      // Return session directly to browser
      return NextResponse.json({
        success: true,
        session: authData.session,
        user: authData.user,
      });
    }

    // If password was omitted, require password for security
    return NextResponse.json(
      { error: 'Password is required.' },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('[resolve-phone] Unexpected error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}
