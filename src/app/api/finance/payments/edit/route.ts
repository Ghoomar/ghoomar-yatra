import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveFinanceCallerAuth } from '@/lib/auth/finance-auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    if (!auth.canEditPayments) {
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to edit vendor payments.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      payment_id,
      payment_date,
      amount,
      payment_method_id,
      reference_number,
      notes,
    } = body;

    if (!payment_id) {
      return NextResponse.json({ error: 'Payment ID is required' }, { status: 400 });
    }

    if (!payment_date) {
      return NextResponse.json({ error: 'Payment date is required' }, { status: 400 });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ error: 'Payment amount must be greater than zero' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('edit_vendor_payment', {
      p_payment_id: payment_id,
      p_payment_date: payment_date,
      p_amount: numAmount,
      p_payment_method_id: payment_method_id || null,
      p_reference_number: reference_number ? String(reference_number).trim() : null,
      p_notes: notes ? String(notes).trim() : null,
      p_edited_by: auth.user.id,
    });

    if (error) {
      console.error('RPC edit_vendor_payment error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err: any) {
    console.error('Error editing vendor payment:', err);
    return NextResponse.json({ error: err.message || 'Failed to edit vendor payment.' }, { status: 500 });
  }
}
