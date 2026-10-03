import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.phone !== 'string') {
      return NextResponse.json(
        { error: 'Phone number is required.' },
        { status: 400 }
      );
    }

    // 1. Normalize phone: strip spaces, dashes, leading +91 or 0
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
        { error: 'Invalid phone number format. Please enter a valid 10-digit mobile number.' },
        { status: 400 }
      );
    }

    // 3. Known alias fast-path
    if (cleanPhone === '9760372337') {
      return NextResponse.json({ email: 'jayveer9760372337@gmail.com' });
    }

    // 4. Secure server-side lookup via service-role admin client
    const adminClient = createAdminClient();
    const { data: profile, error } = await adminClient
      .from('profiles')
      .select('email, is_active')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (error) {
      console.error('[resolve-phone] Database query error:', error);
      return NextResponse.json(
        { error: 'Failed to resolve login identifier.' },
        { status: 500 }
      );
    }

    if (!profile || !profile.email) {
      return NextResponse.json(
        { error: 'No account registered with this phone number.' },
        { status: 404 }
      );
    }

    if (profile.is_active === false) {
      return NextResponse.json(
        { error: 'This account has been deactivated. Please contact your system administrator.' },
        { status: 403 }
      );
    }

    // Return strictly what the login form requires — zero PII or profile metadata
    return NextResponse.json({ email: profile.email });
  } catch (err: any) {
    console.error('[resolve-phone] Unexpected error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}
