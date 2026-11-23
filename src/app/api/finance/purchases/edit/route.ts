import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveFinanceCallerAuth } from '@/lib/auth/finance-auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    if (!auth.canEditPurchases) {
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to edit purchase invoices.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      purchase_id,
      vendor_id,
      purchase_date,
      invoice_number,
      notes,
      lines,
    } = body;

    if (!purchase_id) {
      return NextResponse.json({ error: 'Purchase ID is required' }, { status: 400 });
    }

    if (!vendor_id) {
      return NextResponse.json({ error: 'Vendor is required' }, { status: 400 });
    }

    if (!purchase_date) {
      return NextResponse.json({ error: 'Purchase date is required' }, { status: 400 });
    }

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'Purchase must have at least one line item' }, { status: 400 });
    }

    // Format lines for RPC
    const formattedLines = lines.map((l: any) => ({
      item_id: l.item_id,
      quantity: Number(l.quantity),
      rate: Number(l.rate),
      total_amount: Number(l.total_amount),
      packaging_unit_id: l.packaging_unit_id || null,
      brand_name_snapshot: l.brand_name_snapshot || null,
      pack_unit_snapshot: l.pack_unit_snapshot || null,
      pack_quantity: l.pack_quantity ? Number(l.pack_quantity) : null,
      pack_rate: l.pack_rate ? Number(l.pack_rate) : null,
      conversion_factor_snapshot: l.conversion_factor_snapshot ? Number(l.conversion_factor_snapshot) : null,
    }));

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('edit_purchase_invoice', {
      p_purchase_id: purchase_id,
      p_vendor_id: vendor_id,
      p_purchase_date: purchase_date,
      p_invoice_number: invoice_number || null,
      p_notes: notes || null,
      p_lines: formattedLines,
      p_edited_by: auth.user.id,
    });

    if (error) {
      console.error('RPC edit_purchase_invoice error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err: any) {
    console.error('API POST /api/finance/purchases/edit error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
