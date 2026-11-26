import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveFinanceCallerAuth } from '@/lib/auth/finance-auth';
import { runAutoGradingForDate } from '@/lib/forecasting/auto-grade';

const ALLOWED_BILL_STATUSES = new Set(['Success', 'Complimentary', 'Cancelled']);

function sanitizeNullableString(val: unknown): string | null | undefined {
  if (val === undefined) return undefined;
  if (val === null) return null;
  const trimmed = String(val).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    if (!auth.isAdmin && auth.roleName !== 'Admin') {
      return NextResponse.json(
        { error: 'Forbidden: Only Admin users can manually edit POS bills.' },
        { status: 403 }
      );
    }

    const { id } = await context.params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid bill ID.' }, { status: 400 });
    }

    const body = await request.json();
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3) {
      return NextResponse.json(
        { error: 'Audit reason (at least 3 characters) is required.' },
        { status: 400 }
      );
    }

    if (body.covers_pax !== undefined && body.covers_pax !== null) {
      const paxNum = Number(body.covers_pax);
      if (!Number.isInteger(paxNum) || paxNum < 0 || paxNum > 2000) {
        return NextResponse.json(
          { error: 'covers_pax must be a whole number between 0 and 2000.' },
          { status: 400 }
        );
      }
    }

    if (body.status !== undefined && body.status !== null) {
      if (!ALLOWED_BILL_STATUSES.has(String(body.status))) {
        return NextResponse.json(
          { error: 'status must be Success, Complimentary, or Cancelled.' },
          { status: 400 }
        );
      }
    }

    const admin = createAdminClient();

    const [{ data: existingOrder, error: orderErr }, { data: existingEdit }] = await Promise.all([
      admin.from('sales_orders').select('*').eq('id', id).maybeSingle(),
      admin
        .from('sales_bill_manual_edits')
        .select('*')
        .eq('sales_order_id', id)
        .eq('is_active', true)
        .maybeSingle(),
    ]);

    if (orderErr) {
      return NextResponse.json({ error: orderErr.message }, { status: 500 });
    }
    if (!existingOrder) {
      return NextResponse.json({ error: 'Sales order not found.' }, { status: 404 });
    }

    const originalSnapshot =
      (existingEdit?.original_snapshot_json as Record<string, any> | null) || {
        covers_pax: existingOrder.covers_pax,
        order_type: existingOrder.order_type,
        area: existingOrder.area,
        payment_type: existingOrder.payment_type,
        customer_name: existingOrder.customer_name,
        customer_phone: existingOrder.customer_phone,
        status: existingOrder.status,
      };

    const nextCoversPax =
      body.covers_pax !== undefined && body.covers_pax !== null
        ? Number(body.covers_pax)
        : existingOrder.covers_pax;
    const nextOrderType =
      body.order_type !== undefined ? sanitizeNullableString(body.order_type) : existingOrder.order_type;
    const nextArea =
      body.area !== undefined ? sanitizeNullableString(body.area) : existingOrder.area;
    const nextPaymentType =
      body.payment_type !== undefined
        ? sanitizeNullableString(body.payment_type)
        : existingOrder.payment_type;
    const nextCustomerName =
      body.customer_name !== undefined
        ? sanitizeNullableString(body.customer_name)
        : existingOrder.customer_name;
    const nextCustomerPhone =
      body.customer_phone !== undefined
        ? sanitizeNullableString(body.customer_phone)
        : existingOrder.customer_phone;
    const nextStatus =
      body.status !== undefined && body.status !== null
        ? String(body.status)
        : existingOrder.status;
    const nextNotes = sanitizeNullableString(body.notes) ?? null;

    const overridePayload = {
      sales_order_id: id,
      business_date: existingOrder.business_date,
      invoice_no: existingOrder.invoice_no,
      override_covers_pax:
        nextCoversPax !== originalSnapshot.covers_pax ? nextCoversPax : null,
      override_order_type:
        (nextOrderType ?? null) !== (originalSnapshot.order_type ?? null) ? nextOrderType : null,
      override_area:
        (nextArea ?? null) !== (originalSnapshot.area ?? null) ? nextArea : null,
      override_payment_type:
        (nextPaymentType ?? null) !== (originalSnapshot.payment_type ?? null)
          ? nextPaymentType
          : null,
      override_customer_name:
        (nextCustomerName ?? null) !== (originalSnapshot.customer_name ?? null)
          ? nextCustomerName
          : null,
      override_customer_phone:
        (nextCustomerPhone ?? null) !== (originalSnapshot.customer_phone ?? null)
          ? nextCustomerPhone
          : null,
      override_status:
        nextStatus !== originalSnapshot.status ? nextStatus : null,
      override_notes: nextNotes,
      original_snapshot_json: originalSnapshot,
      reason,
      edited_by: auth.user.id,
      edited_at: new Date().toISOString(),
      is_active: true,
      reverted_at: null,
      reverted_by: null,
      updated_at: new Date().toISOString(),
    };

    const hasAnyOverride =
      overridePayload.override_covers_pax !== null ||
      overridePayload.override_order_type !== null ||
      overridePayload.override_area !== null ||
      overridePayload.override_payment_type !== null ||
      overridePayload.override_customer_name !== null ||
      overridePayload.override_customer_phone !== null ||
      overridePayload.override_status !== null;

    if (!hasAnyOverride && !existingEdit) {
      return NextResponse.json(
        { error: 'No changes detected compared to raw POS bill values.' },
        { status: 400 }
      );
    }

    let savedEdit: any = null;
    if (!hasAnyOverride && existingEdit) {
      const { data: revData, error: revErr } = await admin
        .from('sales_bill_manual_edits')
        .update({
          is_active: false,
          reverted_at: new Date().toISOString(),
          reverted_by: auth.user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingEdit.id)
        .select()
        .single();
      if (revErr) return NextResponse.json({ error: revErr.message }, { status: 500 });
      savedEdit = revData;
    } else if (existingEdit) {
      const { data: updData, error: updErr } = await admin
        .from('sales_bill_manual_edits')
        .update(overridePayload)
        .eq('id', existingEdit.id)
        .select()
        .single();
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      savedEdit = updData;
    } else {
      const { data: insData, error: insErr } = await admin
        .from('sales_bill_manual_edits')
        .insert(overridePayload)
        .select()
        .single();
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      savedEdit = insData;
    }

    const { data: updatedOrder, error: updOrderErr } = await admin
      .from('sales_orders')
      .update({
        covers_pax: nextCoversPax,
        order_type: nextOrderType,
        area: nextArea,
        payment_type: nextPaymentType,
        customer_name: nextCustomerName,
        customer_phone: nextCustomerPhone,
        status: nextStatus,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updOrderErr) {
      return NextResponse.json({ error: updOrderErr.message }, { status: 500 });
    }

    // Sync sales_order_items (covers + status + channel metadata) to preserve covers/status analytics & variance parity
    const itemsSyncPayload: Record<string, any> = {};
    if (nextCoversPax !== existingOrder.covers_pax) {
      itemsSyncPayload.covers = nextCoversPax;
    }
    if (nextStatus !== existingOrder.status) {
      itemsSyncPayload.status = nextStatus;
    }
    if ((nextOrderType ?? null) !== (existingOrder.order_type ?? null)) {
      itemsSyncPayload.order_type = nextOrderType;
    }
    if ((nextArea ?? null) !== (existingOrder.area ?? null)) {
      itemsSyncPayload.area = nextArea;
    }
    if ((nextPaymentType ?? null) !== (existingOrder.payment_type ?? null)) {
      itemsSyncPayload.payment_type = nextPaymentType;
    }
    if (Object.keys(itemsSyncPayload).length > 0) {
      await admin
        .from('sales_order_items')
        .update(itemsSyncPayload)
        .eq('business_date', existingOrder.business_date)
        .eq('invoice_no', existingOrder.invoice_no);
    }

    // Also clear stale manual bill_class override note unless user set explicit classification override,
    // so runAutoGradingForDate re-evaluates APC / Complimentary / Cancelled cleanly with the new pax/status!
    await admin.from('audit_logs').insert({
      user_id: auth.user.id,
      action: 'ADMIN_BILL_MANUAL_EDIT',
      entity_type: 'sales_orders',
      entity_id: id,
      old_values: {
        covers_pax: existingOrder.covers_pax,
        order_type: existingOrder.order_type,
        area: existingOrder.area,
        payment_type: existingOrder.payment_type,
        customer_name: existingOrder.customer_name,
        customer_phone: existingOrder.customer_phone,
        status: existingOrder.status,
      },
      new_values: {
        covers_pax: nextCoversPax,
        order_type: nextOrderType,
        area: nextArea,
        payment_type: nextPaymentType,
        customer_name: nextCustomerName,
        customer_phone: nextCustomerPhone,
        status: nextStatus,
        reason,
      },
    });

    await runAutoGradingForDate(admin, existingOrder.business_date);

    return NextResponse.json({
      success: true,
      bill: updatedOrder,
      manual_edit: hasAnyOverride ? savedEdit : null,
    });
  } catch (err: any) {
    console.error('PATCH /api/finance/sales/bills/[id] error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to update bill.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    if (!auth.isAdmin && auth.roleName !== 'Admin') {
      return NextResponse.json(
        { error: 'Forbidden: Only Admin users can revert POS bill edits.' },
        { status: 403 }
      );
    }

    const { id } = await context.params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid bill ID.' }, { status: 400 });
    }

    const admin = createAdminClient();

    const [{ data: existingOrder }, { data: activeEdit }] = await Promise.all([
      admin.from('sales_orders').select('*').eq('id', id).maybeSingle(),
      admin
        .from('sales_bill_manual_edits')
        .select('*')
        .eq('sales_order_id', id)
        .eq('is_active', true)
        .maybeSingle(),
    ]);

    if (!existingOrder || !activeEdit) {
      return NextResponse.json(
        { error: 'No active manual edit found for this bill.' },
        { status: 404 }
      );
    }

    const orig = (activeEdit.original_snapshot_json || {}) as Record<string, any>;
    const restoredPayload = {
      covers_pax: orig.covers_pax ?? existingOrder.covers_pax,
      order_type: orig.order_type !== undefined ? orig.order_type : existingOrder.order_type,
      area: orig.area !== undefined ? orig.area : existingOrder.area,
      payment_type:
        orig.payment_type !== undefined ? orig.payment_type : existingOrder.payment_type,
      customer_name:
        orig.customer_name !== undefined ? orig.customer_name : existingOrder.customer_name,
      customer_phone:
        orig.customer_phone !== undefined ? orig.customer_phone : existingOrder.customer_phone,
      status: orig.status ?? existingOrder.status,
    };

    const { data: revertedOrder, error: updErr } = await admin
      .from('sales_orders')
      .update(restoredPayload)
      .eq('id', id)
      .select('*')
      .single();

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    await admin
      .from('sales_order_items')
      .update({
        covers: restoredPayload.covers_pax,
        status: restoredPayload.status,
        order_type: restoredPayload.order_type,
        area: restoredPayload.area,
        payment_type: restoredPayload.payment_type,
      })
      .eq('business_date', existingOrder.business_date)
      .eq('invoice_no', existingOrder.invoice_no);

    await admin
      .from('sales_bill_manual_edits')
      .update({
        is_active: false,
        reverted_at: new Date().toISOString(),
        reverted_by: auth.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activeEdit.id);

    await admin.from('audit_logs').insert({
      user_id: auth.user.id,
      action: 'ADMIN_BILL_MANUAL_REVERT',
      entity_type: 'sales_orders',
      entity_id: id,
      old_values: {
        covers_pax: existingOrder.covers_pax,
        order_type: existingOrder.order_type,
        area: existingOrder.area,
        payment_type: existingOrder.payment_type,
        customer_name: existingOrder.customer_name,
        customer_phone: existingOrder.customer_phone,
        status: existingOrder.status,
      },
      new_values: restoredPayload,
    });

    await runAutoGradingForDate(admin, existingOrder.business_date);

    return NextResponse.json({
      success: true,
      bill: revertedOrder,
      manual_edit: null,
    });
  } catch (err: any) {
    console.error('DELETE /api/finance/sales/bills/[id] error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to revert bill edit.' },
      { status: 500 }
    );
  }
}
