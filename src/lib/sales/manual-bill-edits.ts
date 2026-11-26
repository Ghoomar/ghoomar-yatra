import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Re-applies active Admin manual bill edits onto raw Petpooja sales_orders & sales_order_items
 * after a CSV re-import overwrites raw rows, preserving raw values inside original_snapshot_json.
 */
export async function reapplyManualBillEditsForDate(businessDate: string): Promise<number> {
  const admin = createAdminClient();
  const { data: activeEdits, error } = await admin
    .from('sales_bill_manual_edits')
    .select('*')
    .eq('business_date', businessDate)
    .eq('is_active', true);

  if (error || !activeEdits || activeEdits.length === 0) return 0;

  let applied = 0;
  for (const edit of activeEdits) {
    const { data: currentOrder } = await admin
      .from('sales_orders')
      .select('id, invoice_no, covers_pax, order_type, area, payment_type, customer_name, customer_phone, status')
      .eq('business_date', businessDate)
      .eq('invoice_no', edit.invoice_no)
      .maybeSingle();

    if (!currentOrder) continue;

    const freshSnapshot = {
      covers_pax: currentOrder.covers_pax,
      order_type: currentOrder.order_type,
      area: currentOrder.area,
      payment_type: currentOrder.payment_type,
      customer_name: currentOrder.customer_name,
      customer_phone: currentOrder.customer_phone,
      status: currentOrder.status,
    };

    const orderUpdate: Record<string, any> = {};
    const itemUpdate: Record<string, any> = {};

    if (edit.override_covers_pax !== null && edit.override_covers_pax !== undefined) {
      orderUpdate.covers_pax = edit.override_covers_pax;
      itemUpdate.covers = edit.override_covers_pax;
    }
    if (edit.override_order_type !== null && edit.override_order_type !== undefined) {
      orderUpdate.order_type = edit.override_order_type;
      itemUpdate.order_type = edit.override_order_type;
    }
    if (edit.override_area !== null && edit.override_area !== undefined) {
      orderUpdate.area = edit.override_area;
      itemUpdate.area = edit.override_area;
    }
    if (edit.override_payment_type !== null && edit.override_payment_type !== undefined) {
      orderUpdate.payment_type = edit.override_payment_type;
      itemUpdate.payment_type = edit.override_payment_type;
    }
    if (edit.override_customer_name !== null && edit.override_customer_name !== undefined) {
      orderUpdate.customer_name = edit.override_customer_name;
    }
    if (edit.override_customer_phone !== null && edit.override_customer_phone !== undefined) {
      orderUpdate.customer_phone = edit.override_customer_phone;
    }
    if (edit.override_status !== null && edit.override_status !== undefined) {
      orderUpdate.status = edit.override_status;
      itemUpdate.status = edit.override_status;
    }

    if (Object.keys(orderUpdate).length > 0) {
      await admin.from('sales_orders').update(orderUpdate).eq('id', currentOrder.id);
    }
    if (Object.keys(itemUpdate).length > 0) {
      await admin
        .from('sales_order_items')
        .update(itemUpdate)
        .eq('business_date', businessDate)
        .eq('invoice_no', edit.invoice_no);
    }

    await admin
      .from('sales_bill_manual_edits')
      .update({
        sales_order_id: currentOrder.id,
        original_snapshot_json: freshSnapshot,
        updated_at: new Date().toISOString(),
      })
      .eq('id', edit.id);

    applied++;
  }

  return applied;
}
