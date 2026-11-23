import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveFinanceCallerAuth } from '@/lib/auth/finance-auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    // Strictly Admin Only
    if (!auth.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden. Deleting vendor payments requires System Administrator privilege.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { payment_id } = body;

    if (!payment_id) {
      return NextResponse.json({ error: 'Payment ID is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('delete_vendor_payment', {
      p_payment_id: payment_id,
      p_deleted_by: auth.user.id,
    });

    if (error) {
      console.error('RPC delete_vendor_payment error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err: any) {
    console.error('Error deleting vendor payment:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete vendor payment.' }, { status: 500 });
  }
}
