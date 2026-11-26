import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveFinanceCallerAuth } from '@/lib/auth/finance-auth';
import { hasPermission } from '@/lib/rbac';
import { gradeDaySnapshot, generateDayForecast } from '@/lib/forecasting/engine';
import { GroupProfile } from '@/lib/forecasting/types';
import { loadCanonicalMenuLookup } from '@/lib/sales/canonical-menu';

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const canViewHistory =
      auth.isAdmin ||
      hasPermission(auth.roleName, auth.permissionCodes, 'finance.sales') ||
      hasPermission(auth.roleName, auth.permissionCodes, 'reports.view');

    if (!canViewHistory) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const admin = createAdminClient();
    const searchParams = request.nextUrl.searchParams;
    const requestedDate = searchParams.get('date');
    const limit = parseInt(searchParams.get('limit') || '90', 10);

    // If specific date requested -> return snapshot + all classified bills for that date ("Why This Day Happened")
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      const { data: snapshot } = await admin
        .from('sales_forecast_snapshots')
        .select('*')
        .eq('business_date', requestedDate)
        .maybeSingle();

      const { data: bills, error: billsErr } = await admin
        .from('sales_bill_classifications')
        .select(`
          id, sales_order_id, business_date, primary_table_no, bill_status, bill_class,
          is_group_member, group_cluster_id, group_type, group_association_tier,
          is_manually_overridden, manager_override_notes,
          bill_net_amount, bill_pax, bill_apc, daypart,
          outside_activities_net, outside_activities_qty,
          restaurant_food_net, restaurant_food_qty,
          classification_reason, created_at,
          order:sales_orders!sales_bill_classifications_sales_order_id_fkey(
            invoice_no, order_type, area, payment_type, customer_name, customer_phone, covers_pax, net_sales, gross_amount, hour_of_day, order_timestamp
          )
        `)
        .eq('business_date', requestedDate)
        .order('bill_net_amount', { ascending: false });

      if (billsErr) {
        return NextResponse.json({ error: billsErr.message }, { status: 500 });
      }

      const [{ data: context }, { data: manualEdits }] = await Promise.all([
        admin
          .from('sales_forecast_day_context')
          .select('*, event_type:sales_forecast_event_types(*)')
          .eq('business_date', requestedDate)
          .maybeSingle(),
        admin
          .from('sales_bill_manual_edits')
          .select('sales_order_id, override_covers_pax, override_order_type, override_area, override_payment_type, override_customer_name, override_customer_phone, override_status, override_notes, reason, edited_at, edited_by, original_snapshot_json')
          .eq('business_date', requestedDate)
          .eq('is_active', true),
      ]);

      const manualEditByOrderId = new Map<string, any>(
        (manualEdits || []).map((e: any) => [e.sales_order_id, e])
      );
      const hydratedBills = (bills || []).map((b: any) => ({
        ...b,
        manual_edit: manualEditByOrderId.get(b.sales_order_id) || null,
      }));

      return NextResponse.json({
        success: true,
        business_date: requestedDate,
        snapshot: snapshot || null,
        context: context || null,
        bills: hydratedBills,
      });
    }

    // Otherwise return historical snapshots list
    const { data: snapshots, error: snapErr } = await admin
      .from('sales_forecast_snapshots')
      .select('*')
      .order('business_date', { ascending: false })
      .limit(limit);

    if (snapErr) {
      return NextResponse.json({ error: snapErr.message }, { status: 500 });
    }

    // Summary statistics over the returned window
    let totalNetRevenue = 0;
    let sumAbsRevError = 0;
    let sumAbsUnitError = 0;
    let totalUnits = 0;
    let totalBills = 0;
    let totalNormalNet = 0;
    let totalGroupNet = 0;
    let totalHighValueNet = 0;
    let totalOutsideNet = 0;

    for (const s of (snapshots || [])) {
      if (s.actual_net_revenue != null) {
        totalNetRevenue += Number(s.actual_net_revenue);
        sumAbsRevError += Math.abs(Number(s.signed_rev_error || 0));
        totalUnits += Number(s.actual_total_units || 0);
        sumAbsUnitError += Math.abs(Number(s.signed_unit_error || 0));
        totalBills += Number(s.actual_orders || 0);
        totalNormalNet += Number(s.decomp_normal_net || 0);
        totalGroupNet += Number(s.decomp_group_net || 0);
        totalHighValueNet += Number(s.decomp_high_value_net || 0);
        totalOutsideNet += Number(s.decomp_outside_activities_net || 0);
      }
    }

    const avgRevWape = totalNetRevenue > 0 ? (sumAbsRevError / totalNetRevenue) * 100 : 0;
    const avgUnitWape = totalUnits > 0 ? (sumAbsUnitError / totalUnits) * 100 : 0;

    return NextResponse.json({
      success: true,
      count: snapshots?.length || 0,
      summary: {
        total_days: snapshots?.length || 0,
        total_bills: totalBills,
        total_net_revenue: Math.round(totalNetRevenue * 100) / 100,
        average_rev_wape_pct: Math.round(avgRevWape * 100) / 100,
        average_unit_wape_pct: Math.round(avgUnitWape * 100) / 100,
        total_normal_net: Math.round(totalNormalNet * 100) / 100,
        total_group_net: Math.round(totalGroupNet * 100) / 100,
        total_high_value_net: Math.round(totalHighValueNet * 100) / 100,
        total_outside_net: Math.round(totalOutsideNet * 100) / 100,
      },
      snapshots: snapshots || [],
    });
  } catch (err: any) {
    console.error('History API error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch history' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    if (!auth.isAdmin && !hasPermission(auth.roleName, auth.permissionCodes, 'finance.sales')) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions to reclassify bills' }, { status: 403 });
    }

    const admin = createAdminClient();
    const body = await request.json();
    const { sales_order_id, bill_class, manager_override_notes } = body;

    if (!sales_order_id || !bill_class) {
      return NextResponse.json({ error: 'Missing sales_order_id or bill_class' }, { status: 400 });
    }

    const validClasses = ['normal', 'large_group', 'high_value_anomaly', 'data_anomaly', 'cancelled', 'excluded'];
    if (!validClasses.includes(bill_class)) {
      return NextResponse.json({ error: `Invalid bill_class. Must be one of: ${validClasses.join(', ')}` }, { status: 400 });
    }

    // 1. Update bill classification
    const { data: updatedBill, error: updateErr } = await admin
      .from('sales_bill_classifications')
      .update({
        bill_class,
        is_manually_overridden: true,
        manager_override_notes: manager_override_notes || 'Manually confirmed / reclassified by manager',
        updated_at: new Date().toISOString(),
      })
      .eq('sales_order_id', sales_order_id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    const businessDate = updatedBill.business_date;

    // 2. Retrospectively re-grade snapshot for that business date
    const { data: allDateBills } = await admin
      .from('sales_bill_classifications')
      .select('*')
      .eq('business_date', businessDate);

    // Fetch raw orders with items for this date
    const { data: rawOrders } = await admin
      .from('sales_orders')
      .select('id, business_date, invoice_no, order_timestamp, hour_of_day, status, order_type, area, payment_type, customer_name, customer_phone, covers_pax, net_sales, gross_amount')
      .eq('business_date', businessDate);

    const { data: rawItems } = await admin
      .from('sales_order_items')
      .select('invoice_no, item_name, parent_category, quantity, net_sales, table_no, status')
      .eq('business_date', businessDate);

    const itemsByInvoice = new Map<string, any[]>();
    for (const it of (rawItems || [])) {
      const list = itemsByInvoice.get(it.invoice_no) || [];
      list.push(it);
      itemsByInvoice.set(it.invoice_no, list);
    }

    const fullRawOrders = (rawOrders || []).map((o: any) => ({
      ...o,
      items: itemsByInvoice.get(o.invoice_no) || [],
    }));

    // Fetch model state for that day of week
    const d = new Date(businessDate + 'T00:00:00Z');
    const dow = d.getUTCDay();

    const { data: modelState } = await admin
      .from('sales_forecast_model_state')
      .select('*')
      .eq('day_of_week', dow)
      .single();

    const { data: dayContext } = await admin
      .from('sales_forecast_day_context')
      .select('*, event_type:sales_forecast_event_types(*)')
      .eq('business_date', businessDate)
      .maybeSingle();

    const [{ data: grpProfiles }, menuLookup] = await Promise.all([
      admin.from('sales_forecast_group_profiles').select('*'),
      loadCanonicalMenuLookup(admin),
    ]);
    const groupProfileMap = new Map<string, GroupProfile>((grpProfiles || []).map((g) => [g.group_type, g]));

    if (modelState) {
      const forecast = generateDayForecast(businessDate, modelState, dayContext, groupProfileMap, menuLookup);
      const { graded, updatedModelState } = gradeDaySnapshot(
        forecast,
        allDateBills || [],
        fullRawOrders,
        modelState,
        menuLookup
      );

      await admin
        .from('sales_forecast_snapshots')
        .upsert({
          ...graded,
          snapshot_source: 'live_freeze',
        }, { onConflict: 'business_date' });

      await admin
        .from('sales_forecast_model_state')
        .update(updatedModelState)
        .eq('day_of_week', dow);
    }

    return NextResponse.json({
      success: true,
      message: `Bill ${sales_order_id} successfully reclassified as ${bill_class} and ${businessDate} snapshot recalculated.`,
      updatedBill,
    });
  } catch (err: any) {
    console.error('Reclassify error:', err);
    return NextResponse.json({ error: err.message || 'Failed to reclassify bill' }, { status: 500 });
  }
}
