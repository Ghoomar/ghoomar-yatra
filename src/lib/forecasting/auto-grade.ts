/**
 * Auto-Grading & Idempotent Bill Classification Hook for Sales Import
 * Ghoomar Yatra Phase 2
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyBill,
  associateGroupClusters,
  DEFAULT_THRESHOLDS,
  RawOrderForClassification,
} from './bill-classifier';
import { generateDayForecast, gradeDaySnapshot, mergeGroupProfileUpdates } from './engine';
import { ModelStateRow, GroupProfile } from './types';
import { loadCanonicalMenuLookup } from '@/lib/sales/canonical-menu';

export async function runAutoGradingForDate(supabase: SupabaseClient, businessDate: string): Promise<void> {
  // 1. Fetch raw sales orders for this date
  const { data: rawOrders } = await supabase
    .from('sales_orders')
    .select('id, business_date, invoice_no, order_timestamp, hour_of_day, status, order_type, area, payment_type, customer_name, customer_phone, covers_pax, net_sales, gross_amount')
    .eq('business_date', businessDate);

  if (!rawOrders || rawOrders.length === 0) return;

  // 2. Fetch order items for this date (including parent_category)
  const { data: rawItems } = await supabase
    .from('sales_order_items')
    .select('invoice_no, item_name, parent_category, quantity, net_sales, table_no, status')
    .eq('business_date', businessDate);

  const itemsByInvoice = new Map<string, any[]>();
  for (const it of (rawItems || [])) {
    const list = itemsByInvoice.get(it.invoice_no) || [];
    list.push(it);
    itemsByInvoice.set(it.invoice_no, list);
  }

  const fullOrders: RawOrderForClassification[] = rawOrders.map((o: any) => ({
    ...o,
    items: itemsByInvoice.get(o.invoice_no) || [],
  }));

  // 3. Check for existing manual overrides + latest learned classification thresholds + canonical menu
  const [{ data: existingClassifications }, { data: thresholdRow }, menuLookup] = await Promise.all([
    supabase
      .from('sales_bill_classifications')
      .select('sales_order_id, bill_class, is_manually_overridden, manager_override_notes')
      .eq('business_date', businessDate),
    supabase
      .from('sales_bill_classification_thresholds')
      .select('*')
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadCanonicalMenuLookup(supabase),
  ]);

  const activeThresholds = thresholdRow || DEFAULT_THRESHOLDS;

  const manualOverrides = new Map<string, { bill_class: any; notes: string | null }>();
  for (const c of (existingClassifications || [])) {
    if (c.is_manually_overridden) {
      manualOverrides.set(c.sales_order_id, { bill_class: c.bill_class, notes: c.manager_override_notes });
    }
  }

  // 4. Classify individual bills
  const baseClassifications = fullOrders.map((ord) => {
    const res = classifyBill(ord, activeThresholds);
    const manual = manualOverrides.get(ord.id);
    if (manual) {
      res.bill_class = manual.bill_class;
      res.is_manually_overridden = true;
      res.manager_override_notes = manual.notes;
    }
    return res;
  });

  // 5. Run Multi-Bill Group Association
  const finalClassifications = associateGroupClusters(baseClassifications, fullOrders);

  // 6. Upsert Classifications into sales_bill_classifications
  const classificationRows = finalClassifications.map((b) => ({
    sales_order_id: b.sales_order_id,
    business_date: b.business_date,
    primary_table_no: b.primary_table_no,
    bill_status: b.bill_status,
    bill_class: b.bill_class,
    is_group_member: b.is_group_member,
    group_cluster_id: b.group_cluster_id,
    group_type: b.group_type,
    group_association_tier: b.group_association_tier,
    is_manually_overridden: b.is_manually_overridden || false,
    manager_override_notes: b.manager_override_notes || null,
    bill_net_amount: b.bill_net_amount,
    bill_pax: b.bill_pax,
    bill_apc: b.bill_apc,
    daypart: b.daypart,
    outside_activities_net: b.outside_activities_net,
    outside_activities_qty: b.outside_activities_qty,
    restaurant_food_net: b.restaurant_food_net,
    restaurant_food_qty: b.restaurant_food_qty,
    classification_reason: b.classification_reason,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < classificationRows.length; i += 100) {
    const chunk = classificationRows.slice(i, i + 100);
    await supabase.from('sales_bill_classifications').upsert(chunk, {
      onConflict: 'sales_order_id',
    });
  }

  // 7. Grade Snapshot & Update Model State
  const d = new Date(businessDate + 'T00:00:00Z');
  const dow = d.getUTCDay();

  const { data: modelState } = await supabase
    .from('sales_forecast_model_state')
    .select('*')
    .eq('day_of_week', dow)
    .single();

  if (!modelState) return;

  const { data: dayContext } = await supabase
    .from('sales_forecast_day_context')
    .select('*, event_type:sales_forecast_event_types(*)')
    .eq('business_date', businessDate)
    .maybeSingle();

  const { data: grpProfiles } = await supabase
    .from('sales_forecast_group_profiles')
    .select('*');
  const groupProfileMap = new Map<string, GroupProfile>((grpProfiles || []).map((g) => [g.group_type, g]));

  const forecast = generateDayForecast(businessDate, modelState, dayContext, groupProfileMap, menuLookup);
  const { graded, updatedModelState, groupMixUpdates } = gradeDaySnapshot(
    forecast,
    finalClassifications,
    fullOrders,
    modelState,
    menuLookup
  );

  await supabase.from('sales_forecast_snapshots').upsert(
    {
      ...graded,
      snapshot_source: 'live_freeze',
    },
    { onConflict: 'business_date' }
  );

  await supabase
    .from('sales_forecast_model_state')
    .update(updatedModelState)
    .eq('day_of_week', dow);

  if (groupMixUpdates.length > 0) {
    const updatedGroups = mergeGroupProfileUpdates(groupProfileMap, groupMixUpdates);
    for (const grp of updatedGroups) {
      await supabase
        .from('sales_forecast_group_profiles')
        .upsert(
          {
            group_type: grp.group_type,
            sample_events_count: grp.sample_events_count,
            learned_apc: grp.learned_apc,
            learned_units_per_guest: grp.learned_units_per_guest,
            typical_dish_mix_json: grp.typical_dish_mix_json,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'group_type' }
        );
    }
  }
}
