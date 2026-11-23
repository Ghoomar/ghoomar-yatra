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
        { error: 'Forbidden. Deleting purchase invoices requires System Administrator privilege.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { purchase_id } = body;

    if (!purchase_id) {
      return NextResponse.json({ error: 'Purchase ID is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('delete_purchase_invoice', {
      p_purchase_id: purchase_id,
      p_deleted_by: auth.user.id,
    });

    if (error) {
      console.error('RPC delete_purchase_invoice error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err: any) {
    console.error('Error deleting purchase invoice:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete purchase invoice.' }, { status: 500 });
  }
}
