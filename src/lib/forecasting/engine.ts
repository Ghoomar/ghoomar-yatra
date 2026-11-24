/**
 * Dual-Track Independent Forecasting Engine
 * Ghoomar Yatra Phase 2
 */

import {
  ModelStateRow,
  DayContext,
  GroupProfile,
  DayForecastResult,
  DishPredictionItem,
  CategoryPredictionItem,
  BillClassificationResult,
  GradedSnapshotRecord,
} from './types';
import {
  computeTrackUpdate,
  computeDishWape,
  calculatePredictionBounds,
  getConfidenceTier,
  round,
  clamp,
} from './math';
import { classifyBill, associateGroupClusters, RawOrderForClassification, EXCLUDED_NON_RESTAURANT_ITEMS } from './bill-classifier';

/**
 * Generates next-day or future-day dual-track forecast.
 */
export function generateDayForecast(
  targetDate: string,
  modelState: ModelStateRow,
  context?: DayContext | null,
  groupProfiles?: Map<string, GroupProfile>
): DayForecastResult {
  const d = new Date(targetDate + 'T00:00:00Z');
  const dow = d.getUTCDay();

  // 1. Determine Day Mode and Multipliers
  const dayMode = context?.day_mode || 'normal';
  let revMultiplier = 1.0;
  let qtyMultiplier = 1.0;
  let additiveGroupRev = 0.0;
  let additiveGroupUnits = 0.0;
  let driverSummary = 'Normal weekday demand baseline';

  if (dayMode === 'special_event' || dayMode === 'hybrid_event_and_group') {
    const eventType = context?.event_type;
    const priorRevMult = Number(eventType?.learned_revenue_multiplier || eventType?.prior_revenue_multiplier || 1.0);
    const priorQtyMult = Number(eventType?.learned_volume_multiplier || eventType?.prior_volume_multiplier || 1.0);
    revMultiplier = Number(context?.custom_rev_multiplier_override ?? priorRevMult);
    qtyMultiplier = Number(context?.custom_qty_multiplier_override ?? priorQtyMult);
    driverSummary = `Special Event: ${eventType?.name || 'Event'} (Rev x${revMultiplier.toFixed(2)}, Qty x${qtyMultiplier.toFixed(2)})`;
  }

  if (dayMode === 'group_booking' || dayMode === 'hybrid_event_and_group') {
    const guests = Math.max(0, context?.expected_guests || 0);
    const grpType = context?.group_type || 'standard_group';
    const profile = groupProfiles?.get(grpType);
    const apc = profile?.learned_apc || 240.0;
    const upg = profile?.learned_units_per_guest || 1.0;

    additiveGroupRev = round(guests * apc, 2);
    additiveGroupUnits = round(guests * upg, 2);

    const grpLabel = `Group Booking: ${guests} guests (${grpType}) +₹${additiveGroupRev.toLocaleString('en-IN')}`;
    driverSummary = dayMode === 'hybrid_event_and_group' ? `${driverSummary} + ${grpLabel}` : grpLabel;
  }

  // 2. Track 1: Revenue Track Prediction
  const revBase = modelState.rev_baseline_net;
  const revBiasFactor = 1 + (modelState.rev_applied_bias_pct || 0) / 100;
  const normalNetRev = revBase * revMultiplier * revBiasFactor;
  const predicted_net_revenue = round(normalNetRev + additiveGroupRev, 2);

  // Revenue Bounds
  const { low: predicted_net_revenue_low, high: predicted_net_revenue_high } = calculatePredictionBounds(
    predicted_net_revenue,
    modelState.rev_confidence_score,
    modelState.rev_recent_wape
  );

  // Gross and Discount expectations
  const discountRate = modelState.rev_learned_discount_rate || 0.0043;
  const predicted_gross_revenue = round(predicted_net_revenue / (1 - discountRate), 2);
  const predicted_discount_amount = round(predicted_gross_revenue - predicted_net_revenue, 2);

  // 3. Track 2: Quantity Track Prediction
  const qtyBase = modelState.qty_baseline_total_units;
  const qtyBiasFactor = 1 + (modelState.qty_applied_bias_pct || 0) / 100;
  const normalUnits = qtyBase * qtyMultiplier * qtyBiasFactor;
  const predicted_total_units = round(normalUnits + additiveGroupUnits, 2);

  const predicted_orders = Math.round(
    (modelState.qty_baseline_orders * qtyMultiplier * qtyBiasFactor) +
      (additiveGroupUnits > 0 ? Math.max(1, Math.round(additiveGroupUnits / 20)) : 0)
  );

  const predicted_pax = Math.round(
    (modelState.qty_baseline_covers * qtyMultiplier * qtyBiasFactor) +
      (context?.expected_guests || 0)
  );

  // 4. Per-Dish and Category Forecast Explosion
  const dishMix = modelState.dish_volume_mix_json || {};
  const catMix = modelState.category_volume_mix_json || {};
  const catRevMix = modelState.category_revenue_mix_json || {};

  const dishes: DishPredictionItem[] = [];
  let implied_dish_net_revenue = 0;

  for (const [dishName, meta] of Object.entries(dishMix)) {
    if (EXCLUDED_NON_RESTAURANT_ITEMS.has(dishName)) continue;
    const share = meta.share || 0;
    const avgPrice = meta.avg_price || 0;
    const pQty = round(predicted_total_units * share, 1);
    const dishNet = round(pQty * avgPrice, 2);
    implied_dish_net_revenue += dishNet;

    dishes.push({
      dish_name: dishName,
      category: 'Main Course',
      predicted_quantity: pQty,
      avg_price: round(avgPrice, 2),
      implied_net_sales: dishNet,
      volume_share_pct: round(share * 100, 2),
      qty_confidence_score: modelState.qty_confidence_score,
    });
  }

  // Sort dishes by volume descending
  dishes.sort((a, b) => b.predicted_quantity - a.predicted_quantity);
  implied_dish_net_revenue = round(implied_dish_net_revenue, 2);
  const revenue_reconciliation_delta = round(predicted_net_revenue - implied_dish_net_revenue, 2);

  // Categories
  const categories: CategoryPredictionItem[] = [];
  for (const [catName, volShare] of Object.entries(catMix)) {
    const pUnits = round(predicted_total_units * volShare, 1);
    const rShare = catRevMix[catName] || volShare;
    const pRev = round(predicted_net_revenue * rShare, 2);
    categories.push({
      category: catName,
      predicted_units: pUnits,
      predicted_net_sales: pRev,
      volume_share_pct: round(volShare * 100, 2),
      revenue_share_pct: round(rShare * 100, 2),
    });
  }
  categories.sort((a, b) => b.predicted_net_sales - a.predicted_net_sales);

  return {
    business_date: targetDate,
    day_of_week: dow,
    day_mode: dayMode,
    context,
    predicted_net_revenue,
    predicted_net_revenue_low,
    predicted_net_revenue_high,
    predicted_gross_revenue,
    predicted_discount_amount,
    rev_confidence_score: modelState.rev_confidence_score,
    rev_confidence_tier: getConfidenceTier(modelState.rev_confidence_score),
    rev_alpha_used: modelState.rev_ewma_alpha,
    rev_applied_bias_pct: modelState.rev_applied_bias_pct,
    predicted_total_units,
    predicted_orders,
    predicted_pax,
    qty_confidence_score: modelState.qty_confidence_score,
    qty_confidence_tier: getConfidenceTier(modelState.qty_confidence_score),
    qty_alpha_used: modelState.qty_ewma_alpha,
    qty_applied_bias_pct: modelState.qty_applied_bias_pct,
    additive_group_revenue: additiveGroupRev,
    additive_group_units: additiveGroupUnits,
    implied_dish_net_revenue,
    revenue_reconciliation_delta,
    driver_summary: driverSummary,
    dishes,
    categories,
    sample_weeks_count: modelState.sample_weeks_count,
  };
}

/**
 * Grades a frozen forecast snapshot against real actuals for a date and updates model state.
 */
export function gradeDaySnapshot(
  snapshot: DayForecastResult,
  classifications: BillClassificationResult[],
  rawOrders: RawOrderForClassification[],
  priorModelState: ModelStateRow
): { graded: GradedSnapshotRecord; updatedModelState: ModelStateRow } {
  // 1. Decompose Actuals from Classifications
  let decomp_normal_net = 0;
  let decomp_group_net = 0;
  let decomp_high_value_net = 0;
  let decomp_data_anomaly_net = 0;
  let decomp_outside_activities_net = 0;

  let decomp_normal_units = 0;
  let decomp_group_units = 0;
  let decomp_high_value_units = 0;
  let decomp_data_anomaly_units = 0;
  let decomp_complimentary_menu_value = 0;

  let actual_net_revenue = 0;
  let actual_gross_revenue = 0;
  let actual_orders = 0;
  let actual_pax = 0;

  const dayparts: Record<string, { net: number; units: number; orders: number; pax: number }> = {
    breakfast: { net: 0, units: 0, orders: 0, pax: 0 },
    lunch: { net: 0, units: 0, orders: 0, pax: 0 },
    dinner: { net: 0, units: 0, orders: 0, pax: 0 },
    late_night: { net: 0, units: 0, orders: 0, pax: 0 },
  };

  const actualDishesMap = new Map<string, { qty: number; net: number }>();
  const actualCategoriesMap = new Map<string, { qty: number; net: number }>();

  const orderMap = new Map<string, RawOrderForClassification>(rawOrders.map((o) => [o.id, o]));

  for (const b of classifications) {
    if (b.bill_class === 'cancelled') {
      // Excluded completely from all actuals
      continue;
    }

    const raw = orderMap.get(b.sales_order_id);
    const isComplimentary = b.bill_status === 'Complimentary';

    actual_orders += 1;
    actual_pax += b.bill_pax;

    // Realized Net Revenue:
    // Complimentary orders contribute ₹0.00 realized revenue to match daily summary to the exact rupee
    const realizedBillNet = isComplimentary ? 0 : b.bill_net_amount;
    const foodNet = isComplimentary ? 0 : b.restaurant_food_net;
    const foodQty = b.restaurant_food_qty;

    actual_net_revenue += realizedBillNet;
    actual_gross_revenue += isComplimentary ? 0 : Number(raw?.gross_amount || realizedBillNet);

    if (isComplimentary) {
      decomp_complimentary_menu_value += b.bill_net_amount;
    }

    // Decomposition breakdown
    decomp_outside_activities_net += isComplimentary ? 0 : b.outside_activities_net;

    if (b.bill_class === 'normal') {
      decomp_normal_net += foodNet;
      decomp_normal_units += foodQty;
    } else if (b.bill_class === 'large_group') {
      decomp_group_net += foodNet;
      decomp_group_units += foodQty;
    } else if (b.bill_class === 'high_value_anomaly') {
      decomp_high_value_net += foodNet;
      decomp_high_value_units += foodQty;
    } else if (b.bill_class === 'data_anomaly') {
      decomp_data_anomaly_net += foodNet;
      decomp_data_anomaly_units += foodQty;
    }

    // Daypart breakdown
    const dp = b.daypart || 'lunch';
    if (dayparts[dp]) {
      dayparts[dp].net += realizedBillNet;
      dayparts[dp].units += b.restaurant_food_qty + b.outside_activities_qty;
      dayparts[dp].orders += 1;
      dayparts[dp].pax += b.bill_pax;
    }

    // Collect dish and category units (complimentary dishes ARE preserved in volume!)
    if (raw?.items && raw.items.length > 0) {
      for (const it of raw.items) {
        const q = Number(it.quantity || 0);
        const ns = isComplimentary ? 0 : Number(it.net_sales || 0);

        const curD = actualDishesMap.get(it.item_name) || { qty: 0, net: 0 };
        curD.qty += q;
        curD.net += ns;
        actualDishesMap.set(it.item_name, curD);
      }
    }
  }

  // Round metrics
  actual_net_revenue = round(actual_net_revenue, 2);
  actual_gross_revenue = round(actual_gross_revenue, 2);
  const actual_discount_amount = round(Math.max(0, actual_gross_revenue - actual_net_revenue), 2);
  decomp_normal_net = round(decomp_normal_net, 2);
  decomp_group_net = round(decomp_group_net, 2);
  decomp_high_value_net = round(decomp_high_value_net, 2);
  decomp_data_anomaly_net = round(decomp_data_anomaly_net, 2);
  decomp_outside_activities_net = round(decomp_outside_activities_net, 2);
  decomp_complimentary_menu_value = round(decomp_complimentary_menu_value, 2);

  const actual_total_units = round(
    decomp_normal_units + decomp_group_units + decomp_high_value_units + decomp_data_anomaly_units,
    2
  );

  // 2. Compute Independent Track Errors
  // Revenue Track Update
  const revUpdate = computeTrackUpdate({
    baseline: priorModelState.rev_baseline_net,
    predicted: snapshot.predicted_net_revenue,
    actual_normal: decomp_normal_net,
    actual_total: actual_net_revenue,
    prior_smoothed_signed_error: priorModelState.rev_smoothed_signed_error,
    prior_smoothed_abs_error: priorModelState.rev_smoothed_abs_error,
    prior_wape: priorModelState.rev_recent_wape,
    prior_error_std: priorModelState.rev_error_std,
  });

  // Quantity Track Update
  const qtyUpdate = computeTrackUpdate({
    baseline: priorModelState.qty_baseline_total_units,
    predicted: snapshot.predicted_total_units,
    actual_normal: decomp_normal_units,
    actual_total: actual_total_units,
    prior_smoothed_signed_error: priorModelState.qty_smoothed_signed_error,
    prior_smoothed_abs_error: priorModelState.qty_smoothed_abs_error,
    prior_wape: priorModelState.qty_recent_wape,
    prior_error_std: priorModelState.qty_error_std,
  });

  // Dish WAPE calculation
  const actualDishesList = Array.from(actualDishesMap.entries()).map(([name, d]) => ({
    dish_name: name,
    quantity: round(d.qty, 1),
    net_sales: round(d.net, 2),
  }));
  const dish_wape = computeDishWape(snapshot.dishes, actualDishesList);

  // Signed Pax error
  const pax_signed_error = actual_pax - snapshot.predicted_pax;

  // 3. Assemble Graded Snapshot Record
  const graded: GradedSnapshotRecord = {
    id: crypto.randomUUID(),
    business_date: snapshot.business_date,
    day_of_week: snapshot.day_of_week,
    frozen_at: new Date().toISOString(),
    snapshot_source: 'live_freeze',
    predicted_net_revenue: snapshot.predicted_net_revenue,
    predicted_net_revenue_low: snapshot.predicted_net_revenue_low,
    predicted_net_revenue_high: snapshot.predicted_net_revenue_high,
    predicted_gross_revenue: snapshot.predicted_gross_revenue,
    predicted_discount_amount: snapshot.predicted_discount_amount,
    implied_dish_net_revenue: snapshot.implied_dish_net_revenue,
    revenue_reconciliation_delta: snapshot.revenue_reconciliation_delta,
    actual_net_revenue,
    actual_gross_revenue,
    actual_discount_amount,
    signed_rev_error: revUpdate.error,
    signed_rev_error_pct: revUpdate.signed_error_pct,
    abs_rev_error_pct: revUpdate.abs_error_pct,
    rev_confidence_score: revUpdate.confidence_score,
    rev_alpha_used: revUpdate.adaptive_alpha,
    rev_bias_correction_used: revUpdate.applied_bias_pct,
    was_rev_outlier_dampened: revUpdate.was_outlier_dampened,

    predicted_total_units: snapshot.predicted_total_units,
    predicted_orders: snapshot.predicted_orders,
    predicted_pax: snapshot.predicted_pax,
    actual_total_units,
    actual_orders,
    actual_pax,
    signed_unit_error: qtyUpdate.error,
    signed_unit_error_pct: qtyUpdate.signed_error_pct,
    pax_signed_error,
    dish_wape,
    qty_confidence_score: qtyUpdate.confidence_score,
    qty_alpha_used: qtyUpdate.adaptive_alpha,
    qty_bias_correction_used: qtyUpdate.applied_bias_pct,
    was_qty_outlier_dampened: qtyUpdate.was_outlier_dampened,

    day_mode_at_prediction: snapshot.day_mode,
    event_type_id: snapshot.context?.event_type_id || null,
    event_rev_multiplier_used: 1.0,
    event_qty_multiplier_used: 1.0,
    expected_guests: snapshot.context?.expected_guests || 0,
    additive_group_revenue: snapshot.additive_group_revenue,
    additive_group_units: snapshot.additive_group_units,
    driver_summary: snapshot.driver_summary,

    decomp_normal_net,
    decomp_group_net,
    decomp_high_value_net,
    decomp_data_anomaly_net,
    decomp_outside_activities_net,
    decomp_normal_units: round(decomp_normal_units, 2),
    decomp_group_units: round(decomp_group_units, 2),
    decomp_high_value_units: round(decomp_high_value_units, 2),
    decomp_data_anomaly_units: round(decomp_data_anomaly_units, 2),
    decomp_complimentary_menu_value,
    daypart_breakdown_json: dayparts,

    predicted_categories_json: snapshot.categories,
    predicted_dishes_json: snapshot.dishes.slice(0, 50),
    actual_categories_json: null,
    actual_dishes_json: actualDishesList.slice(0, 50),
    learning_summary_json: {
      rev_tracking_signal: revUpdate.tracking_signal,
      qty_tracking_signal: qtyUpdate.tracking_signal,
      rev_alpha: revUpdate.adaptive_alpha,
      qty_alpha: qtyUpdate.adaptive_alpha,
      rev_applied_bias_pct: revUpdate.applied_bias_pct,
      qty_applied_bias_pct: qtyUpdate.applied_bias_pct,
    },
    graded_at: new Date().toISOString(),
  };

  // 4. Update Model State for this day of week
  // Update mix with EWMA (0.15 fresh / 0.85 persistent)
  const updatedDishMix = { ...(priorModelState.dish_volume_mix_json || {}) };
  if (actual_total_units > 0) {
    for (const d of actualDishesList) {
      if (EXCLUDED_NON_RESTAURANT_ITEMS.has(d.dish_name)) continue;
      const observedShare = d.quantity / actual_total_units;
      const priorShare = updatedDishMix[d.dish_name]?.share || 0;
      const newShare = 0.15 * observedShare + 0.85 * priorShare;
      const avgPrice = d.quantity > 0 ? d.net_sales / d.quantity : (updatedDishMix[d.dish_name]?.avg_price || 150);
      updatedDishMix[d.dish_name] = {
        share: round(newShare, 4),
        avg_price: round(avgPrice, 2),
      };
    }
  }

  const updatedModelState: ModelStateRow = {
    ...priorModelState,
    rev_baseline_net: revUpdate.updated_baseline,
    rev_baseline_gross: round(revUpdate.updated_baseline * 1.0043, 2),
    rev_ewma_alpha: revUpdate.adaptive_alpha,
    rev_smoothed_signed_error: revUpdate.smoothed_signed_error,
    rev_smoothed_abs_error: revUpdate.smoothed_abs_error,
    rev_tracking_signal: revUpdate.tracking_signal,
    rev_signed_bias_pct: revUpdate.signed_bias_pct,
    rev_applied_bias_pct: revUpdate.applied_bias_pct,
    rev_recent_wape: revUpdate.recent_wape,
    rev_error_std: revUpdate.error_std,
    rev_confidence_score: revUpdate.confidence_score,

    qty_baseline_total_units: qtyUpdate.updated_baseline,
    qty_baseline_orders: round(0.85 * priorModelState.qty_baseline_orders + 0.15 * actual_orders, 1),
    qty_baseline_covers: round(0.85 * priorModelState.qty_baseline_covers + 0.15 * actual_pax, 1),
    qty_ewma_alpha: qtyUpdate.adaptive_alpha,
    qty_smoothed_signed_error: qtyUpdate.smoothed_signed_error,
    qty_smoothed_abs_error: qtyUpdate.smoothed_abs_error,
    qty_tracking_signal: qtyUpdate.tracking_signal,
    qty_signed_bias_pct: qtyUpdate.signed_bias_pct,
    qty_applied_bias_pct: qtyUpdate.applied_bias_pct,
    qty_recent_wape: qtyUpdate.recent_wape,
    qty_error_std: qtyUpdate.error_std,
    qty_confidence_score: qtyUpdate.confidence_score,

    dish_volume_mix_json: updatedDishMix,
    sample_weeks_count: (priorModelState.sample_weeks_count || 0) + 1,
    last_trained_date: snapshot.business_date,
    updated_at: new Date().toISOString(),
  };

  return { graded, updatedModelState };
}
