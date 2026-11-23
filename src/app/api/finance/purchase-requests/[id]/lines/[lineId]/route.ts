import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveFinanceCallerAuth } from '@/lib/auth/finance-auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    const { id: requestId, lineId } = await params;
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    if (!auth.canApprovePurchases) {
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to review purchase requests.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, approved_quantity, new_max_par, review_note } = body;

    if (!['approve', 'adjust_and_approve', 'set_max_par_and_approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Invalid approver action' }, { status: 400 });
    }

    const admin = createAdminClient();

    // 1. Fetch current line
    const { data: line, error: lineFetchErr } = await admin
      .from('purchase_request_lines')
      .select('*, item:inventory_items(id, name, unit_id)')
      .eq('id', lineId)
      .eq('request_id', requestId)
      .single();

    if (lineFetchErr || !line) {
      return NextResponse.json({ error: 'Purchase request line not found' }, { status: 404 });
    }

    if (['purchased', 'rejected'].includes(line.approval_status)) {
      return NextResponse.json(
        { error: `Cannot modify line with status '${line.approval_status}'` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const lineUpdates: any = {
      reviewed_by: auth.user.id,
      reviewed_at: now,
      review_note: review_note?.trim() || null,
      updated_at: now,
    };

    if (action === 'approve') {
      lineUpdates.approval_status = 'approved';
      lineUpdates.approved_quantity = line.requested_quantity;
    } else if (action === 'adjust_and_approve') {
      const parsedQty = Number(approved_quantity);
      if (isNaN(parsedQty) || parsedQty <= 0) {
        return NextResponse.json({ error: 'Adjusted approved quantity must be greater than zero' }, { status: 400 });
      }
      lineUpdates.approval_status = 'approved';
      lineUpdates.approved_quantity = parsedQty;
    } else if (action === 'set_max_par_and_approve') {
      const parsedMaxPar = Number(new_max_par);
      if (isNaN(parsedMaxPar) || parsedMaxPar <= 0) {
        return NextResponse.json({ error: 'New Max-Par must be greater than zero' }, { status: 400 });
      }

      // Update item master max_stock_level
      const { error: itemUpdateErr } = await admin
        .from('inventory_items')
        .update({ max_stock_level: parsedMaxPar, updated_at: now })
        .eq('id', line.item_id);

      if (itemUpdateErr) {
        console.error('Error updating item max par:', itemUpdateErr);
        return NextResponse.json({ error: itemUpdateErr.message }, { status: 500 });
      }

      lineUpdates.approval_status = 'approved';
      lineUpdates.approved_quantity = approved_quantity != null ? Number(approved_quantity) : line.requested_quantity;
    } else if (action === 'reject') {
      lineUpdates.approval_status = 'rejected';
      lineUpdates.approved_quantity = null;
    }

    // 2. Update line
    const { data: updatedLine, error: lineUpdateErr } = await admin
      .from('purchase_request_lines')
      .update(lineUpdates)
      .eq('id', lineId)
      .select()
      .single();

    if (lineUpdateErr) {
      console.error('Error updating request line:', lineUpdateErr);
      return NextResponse.json({ error: lineUpdateErr.message }, { status: 500 });
    }

    // 3. Check if all lines for this request are in ('purchased', 'rejected')
    const { data: allRequestLines } = await admin
      .from('purchase_request_lines')
      .select('id, approval_status')
      .eq('request_id', requestId);

    const allFinished = (allRequestLines || []).every((l: any) =>
      ['purchased', 'rejected'].includes(l.approval_status)
    );

    if (allFinished && (allRequestLines || []).length > 0) {
      await admin
        .from('purchase_requests')
        .update({ status: 'completed', updated_at: now })
        .eq('id', requestId);
    }

    return NextResponse.json({
      success: true,
      line: updatedLine,
      requestCompleted: allFinished,
    });
  } catch (err: any) {
    console.error('Error in PATCH /api/finance/purchase-requests/[id]/lines/[lineId]:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
