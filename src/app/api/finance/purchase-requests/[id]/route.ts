import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveFinanceCallerAuth } from '@/lib/auth/finance-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: req, error } = await admin
      .from('purchase_requests')
      .select(`
        *,
        lines:purchase_request_lines(
          *,
          item:inventory_items(
            id, item_code, name, name_hi, brand_name, minimum_stock, max_stock_level, shelf_life_days, abc_class, last_counted_at,
            unit:units!inventory_items_unit_id_fkey(id, symbol, name)
          ),
          preferred_vendor:vendors(id, name, name_hi, vendor_code)
        )
      `)
      .eq('id', id)
      .single();

    if (error || !req) {
      return NextResponse.json({ error: 'Purchase request not found' }, { status: 404 });
    }

    return NextResponse.json({ request: req });
  } catch (err: any) {
    console.error('Error in GET /api/finance/purchase-requests/[id]:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    if (!auth.canApprovePurchases) {
      return NextResponse.json({ error: 'Forbidden. You do not have permission to delete requests.' }, { status: 403 });
    }

    const admin = createAdminClient();
    const { error } = await admin.from('purchase_requests').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error in DELETE /api/finance/purchase-requests/[id]:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
