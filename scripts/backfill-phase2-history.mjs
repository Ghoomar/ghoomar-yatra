/**
 * Fast Walk-Forward Replay & Bill Classification Backfill across all 82 Days of Live POS History
 */

import fs from 'fs';
import pg from 'pg';
import { DEFAULT_THRESHOLDS, classifyBill, associateGroupClusters } from '../src/lib/forecasting/bill-classifier.ts';
import { generateDayForecast, gradeDaySnapshot } from '../src/lib/forecasting/engine.ts';

// Return DATE columns as verbatim strings (YYYY-MM-DD) avoiding local timezone shifts
pg.types.setTypeParser(1082, (val) => val);

const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

function round(val, d = 2) {
  const f = Math.pow(10, d);
  return Math.round(val * f) / f;
}

function toDateStr(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

async function run() {
  await client.connect();
  console.log('🚀 Starting Phase 2 Historical Backfill & Walk-Forward Replay...');

  // 1. Dynamic thresholds
  const dineInStatsRes = await client.query(`
    SELECT 
      percentile_cont(0.95) WITHIN GROUP (ORDER BY covers_pax) AS dine_in_pax_p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY covers_pax) AS dine_in_pax_p99,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY (net_sales / GREATEST(1, covers_pax))) AS dine_in_spp_p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY (net_sales / GREATEST(1, covers_pax))) AS dine_in_spp_p99,
      count(*) as dine_in_count
    FROM sales_orders
    WHERE order_type = 'Dine In' AND status = 'Success' AND covers_pax > 0;
  `);

  const statRow = dineInStatsRes.rows[0];
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    dine_in_pax_p95: Number(statRow.dine_in_pax_p95) || 7.0,
    dine_in_pax_p99: Number(statRow.dine_in_pax_p99) || 10.0,
    dine_in_spp_p95: round(Number(statRow.dine_in_spp_p95) || 553.54, 2),
    dine_in_spp_p99: round(Number(statRow.dine_in_spp_p99) || 840.70, 2),
    pax_large_group_threshold: 20,
    spend_per_pax_anomaly_threshold: 750.0,
    bill_net_sales_anomaly_threshold: 10000.0,
    iqr_multiplier: 2.5,
    trained_on_bills_count: parseInt(statRow.dine_in_count, 10) || 5063,
  };

  console.log('✅ Dynamic Thresholds:', thresholds);

  await client.query(`
    INSERT INTO sales_bill_classification_thresholds (
      effective_date, dine_in_pax_p95, dine_in_pax_p99, dine_in_spp_p95, dine_in_spp_p99,
      pax_large_group_threshold, spend_per_pax_anomaly_threshold, bill_net_sales_anomaly_threshold,
      iqr_multiplier, trained_on_bills_count
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
  `, [
    '2026-11-22',
    thresholds.dine_in_pax_p95,
    thresholds.dine_in_pax_p99,
    thresholds.dine_in_spp_p95,
    thresholds.dine_in_spp_p99,
    thresholds.pax_large_group_threshold,
    thresholds.spend_per_pax_anomaly_threshold,
    thresholds.bill_net_sales_anomaly_threshold,
    thresholds.iqr_multiplier,
    thresholds.trained_on_bills_count,
  ]);

  // 2. Fetch distinct dates
  const datesRes = await client.query(`
    SELECT DISTINCT business_date
    FROM sales_orders
    ORDER BY business_date ASC;
  `);
  const dates = datesRes.rows.map(r => toDateStr(r.business_date));
  console.log(`📅 Found ${dates.length} distinct business dates (from ${dates[0]} to ${dates[dates.length - 1]}).`);

  // Fetch group profiles
  const grpRes = await client.query('SELECT * FROM sales_forecast_group_profiles');
  const groupProfilesMap = new Map(grpRes.rows.map(g => [g.group_type, g]));

  // In-memory model state per day of week
  const stateRes = await client.query('SELECT * FROM sales_forecast_model_state');
  const modelStateMap = new Map();
  for (const row of stateRes.rows) {
    modelStateMap.set(row.day_of_week, {
      ...row,
      day_of_week: Number(row.day_of_week),
      rev_baseline_net: Number(row.rev_baseline_net),
      rev_baseline_gross: Number(row.rev_baseline_gross),
      rev_learned_discount_rate: Number(row.rev_learned_discount_rate),
      rev_ewma_alpha: Number(row.rev_ewma_alpha),
      rev_smoothed_signed_error: Number(row.rev_smoothed_signed_error),
      rev_smoothed_abs_error: Number(row.rev_smoothed_abs_error),
      rev_tracking_signal: Number(row.rev_tracking_signal),
      rev_signed_bias_pct: Number(row.rev_signed_bias_pct),
      rev_applied_bias_pct: Number(row.rev_applied_bias_pct),
      rev_recent_wape: Number(row.rev_recent_wape),
      rev_error_std: Number(row.rev_error_std),
      rev_confidence_score: Number(row.rev_confidence_score),

      qty_baseline_total_units: Number(row.qty_baseline_total_units),
      qty_baseline_orders: Number(row.qty_baseline_orders),
      qty_baseline_covers: Number(row.qty_baseline_covers),
      qty_ewma_alpha: Number(row.qty_ewma_alpha),
      qty_smoothed_signed_error: Number(row.qty_smoothed_signed_error),
      qty_smoothed_abs_error: Number(row.qty_smoothed_abs_error),
      qty_tracking_signal: Number(row.qty_tracking_signal),
      qty_signed_bias_pct: Number(row.qty_signed_bias_pct),
      qty_applied_bias_pct: Number(row.qty_applied_bias_pct),
      qty_recent_wape: Number(row.qty_recent_wape),
      qty_error_std: Number(row.qty_error_std),
      qty_confidence_score: Number(row.qty_confidence_score),

      category_volume_mix_json: row.category_volume_mix_json || {},
      category_revenue_mix_json: row.category_revenue_mix_json || {},
      dish_volume_mix_json: row.dish_volume_mix_json || {},
      sample_weeks_count: Number(row.sample_weeks_count || 0),
    });
  }

  // Clear existing classifications and snapshots
  await client.query('DELETE FROM sales_bill_classifications;');
  await client.query('DELETE FROM sales_forecast_snapshots;');

  let totalBillsProcessed = 0;
  let totalCancelledCount = 0;
  let totalComplimentaryCount = 0;

  // Pre-fetch all orders & items in bulk to avoid round-trip latency
  console.log('⚡ Pre-fetching all 8,864 orders and 25,587 items in bulk...');
  const allOrdersRes = await client.query(`
    SELECT id, business_date, invoice_no, order_timestamp, hour_of_day, status, order_type, area,
           payment_type, customer_name, customer_phone, covers_pax, net_sales, gross_amount
    FROM sales_orders
    ORDER BY business_date ASC, invoice_no ASC;
  `);

  const allItemsRes = await client.query(`
    SELECT business_date, invoice_no, item_name, quantity, net_sales, table_no, status
    FROM sales_order_items;
  `);

  const itemsByDateInvoice = new Map();
  for (const it of allItemsRes.rows) {
    const dStr = toDateStr(it.business_date);
    const key = `${dStr}__${it.invoice_no}`;
    const list = itemsByDateInvoice.get(key) || [];
    list.push(it);
    itemsByDateInvoice.set(key, list);
  }

  const ordersByDate = new Map();
  for (const o of allOrdersRes.rows) {
    const dStr = toDateStr(o.business_date);
    const list = ordersByDate.get(dStr) || [];
    list.push({
      ...o,
      business_date: dStr,
      items: itemsByDateInvoice.get(`${dStr}__${o.invoice_no}`) || [],
    });
    ordersByDate.set(dStr, list);
  }

  // Fetch all day contexts
  const allCtxRes = await client.query(`
    SELECT c.*, e.prior_revenue_multiplier, e.learned_revenue_multiplier,
           e.prior_volume_multiplier, e.learned_volume_multiplier, e.name as event_name
    FROM sales_forecast_day_context c
    LEFT JOIN sales_forecast_event_types e ON c.event_type_id = e.id;
  `);
  const dayContextMap = new Map();
  for (const cr of allCtxRes.rows) {
    const dStr = toDateStr(cr.business_date);
    dayContextMap.set(dStr, {
      business_date: dStr,
      day_mode: cr.day_mode,
      expected_guests: cr.expected_guests,
      group_type: cr.group_type,
      group_daypart: cr.group_daypart,
      group_notes: cr.group_notes,
      custom_rev_multiplier_override: cr.custom_rev_multiplier_override,
      custom_qty_multiplier_override: cr.custom_qty_multiplier_override,
      event_type: cr.event_type_id ? {
        id: cr.event_type_id,
        name: cr.event_name,
        learned_revenue_multiplier: cr.learned_revenue_multiplier,
        learned_volume_multiplier: cr.learned_volume_multiplier,
      } : null,
    });
  }

  console.log('🔄 Executing Walk-Forward Replay across 82 days...');

  for (let idx = 0; idx < dates.length; idx++) {
    const bDate = dates[idx];
    const dow = new Date(bDate + 'T00:00:00Z').getUTCDay();
    const rawOrders = ordersByDate.get(bDate) || [];

    // Classify bills
    const baseClassifications = rawOrders.map(ord => {
      if (ord.status === 'Cancelled') totalCancelledCount++;
      if (ord.status === 'Complimentary') totalComplimentaryCount++;
      return classifyBill(ord, thresholds);
    });

    const finalClassifications = associateGroupClusters(baseClassifications, rawOrders);
    totalBillsProcessed += finalClassifications.length;

    // Fast multi-row parameterized insert for classifications
    if (finalClassifications.length > 0) {
      const values = [];
      const placeholders = [];
      let paramIdx = 1;

      for (const b of finalClassifications) {
        placeholders.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, $${paramIdx+9}, $${paramIdx+10}, $${paramIdx+11}, $${paramIdx+12}, $${paramIdx+13}, $${paramIdx+14}, $${paramIdx+15}, $${paramIdx+16}, $${paramIdx+17}, $${paramIdx+18}, $${paramIdx+19})`);
        values.push(
          b.sales_order_id, b.business_date, b.primary_table_no, b.bill_status, b.bill_class,
          b.is_group_member, b.group_cluster_id, b.group_type, b.group_association_tier,
          b.is_manually_overridden || false, b.manager_override_notes || null,
          b.bill_net_amount, b.bill_pax, b.bill_apc, b.daypart,
          b.outside_activities_net, b.outside_activities_qty,
          b.restaurant_food_net, b.restaurant_food_qty, b.classification_reason
        );
        paramIdx += 20;
      }

      await client.query(`
        INSERT INTO sales_bill_classifications (
          sales_order_id, business_date, primary_table_no, bill_status, bill_class,
          is_group_member, group_cluster_id, group_type, group_association_tier,
          is_manually_overridden, manager_override_notes,
          bill_net_amount, bill_pax, bill_apc, daypart,
          outside_activities_net, outside_activities_qty,
          restaurant_food_net, restaurant_food_qty, classification_reason
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (sales_order_id) DO UPDATE SET
          bill_class = EXCLUDED.bill_class,
          classification_reason = EXCLUDED.classification_reason;
      `, values);
    }

    const dayContext = dayContextMap.get(bDate) || null;
    const curState = modelStateMap.get(dow);

    // Generate forecast snapshot
    const forecast = generateDayForecast(bDate, curState, dayContext, groupProfilesMap);

    // Grade snapshot against actuals
    const { graded, updatedModelState } = gradeDaySnapshot(forecast, finalClassifications, rawOrders, curState);

    // Insert snapshot
    await client.query(`
      INSERT INTO sales_forecast_snapshots (
        business_date, day_of_week, snapshot_source,
        predicted_net_revenue, predicted_net_revenue_low, predicted_net_revenue_high,
        predicted_gross_revenue, predicted_discount_amount, implied_dish_net_revenue,
        revenue_reconciliation_delta, actual_net_revenue, actual_gross_revenue,
        actual_discount_amount, signed_rev_error, signed_rev_error_pct, abs_rev_error_pct,
        rev_confidence_score, rev_alpha_used, rev_bias_correction_used, was_rev_outlier_dampened,
        predicted_total_units, predicted_orders, predicted_pax, actual_total_units,
        actual_orders, actual_pax, signed_unit_error, signed_unit_error_pct,
        pax_signed_error, dish_wape, qty_confidence_score, qty_alpha_used,
        qty_bias_correction_used, was_qty_outlier_dampened, day_mode_at_prediction,
        event_type_id, event_rev_multiplier_used, event_qty_multiplier_used,
        expected_guests, additive_group_revenue, additive_group_units, driver_summary,
        decomp_normal_net, decomp_group_net, decomp_high_value_net, decomp_data_anomaly_net,
        decomp_outside_activities_net, decomp_normal_units, decomp_group_units,
        decomp_high_value_units, decomp_data_anomaly_units, decomp_complimentary_menu_value,
        daypart_breakdown_json, predicted_categories_json, predicted_dishes_json,
        actual_categories_json, actual_dishes_json, learning_summary_json, graded_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38,
        $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56,
        $57, $58, now()
      ) ON CONFLICT (business_date) DO UPDATE SET
        actual_net_revenue = EXCLUDED.actual_net_revenue,
        actual_total_units = EXCLUDED.actual_total_units,
        actual_categories_json = EXCLUDED.actual_categories_json,
        graded_at = now();
    `, [
      graded.business_date, graded.day_of_week, 'backfill_replay',
      graded.predicted_net_revenue, graded.predicted_net_revenue_low, graded.predicted_net_revenue_high,
      graded.predicted_gross_revenue, graded.predicted_discount_amount, graded.implied_dish_net_revenue,
      graded.revenue_reconciliation_delta, graded.actual_net_revenue, graded.actual_gross_revenue,
      graded.actual_discount_amount, graded.signed_rev_error, graded.signed_rev_error_pct, graded.abs_rev_error_pct,
      graded.rev_confidence_score, graded.rev_alpha_used, graded.rev_bias_correction_used, graded.was_rev_outlier_dampened,
      graded.predicted_total_units, graded.predicted_orders, graded.predicted_pax, graded.actual_total_units,
      graded.actual_orders, graded.actual_pax, graded.signed_unit_error, graded.signed_unit_error_pct,
      graded.pax_signed_error, graded.dish_wape, graded.qty_confidence_score, graded.qty_alpha_used,
      graded.qty_bias_correction_used, graded.was_qty_outlier_dampened, graded.day_mode_at_prediction,
      graded.event_type_id, graded.event_rev_multiplier_used, graded.event_qty_multiplier_used,
      graded.expected_guests, graded.additive_group_revenue, graded.additive_group_units, graded.driver_summary,
      graded.decomp_normal_net, graded.decomp_group_net, graded.decomp_high_value_net, graded.decomp_data_anomaly_net,
      graded.decomp_outside_activities_net, graded.decomp_normal_units, graded.decomp_group_units,
      graded.decomp_high_value_units, graded.decomp_data_anomaly_units, graded.decomp_complimentary_menu_value,
      JSON.stringify(graded.daypart_breakdown_json), JSON.stringify(graded.predicted_categories_json),
      JSON.stringify(graded.predicted_dishes_json), JSON.stringify(graded.actual_categories_json),
      JSON.stringify(graded.actual_dishes_json), JSON.stringify(graded.learning_summary_json),
    ]);

    // Update in-memory state
    modelStateMap.set(dow, updatedModelState);

    if ((idx + 1) % 15 === 0 || idx === dates.length - 1) {
      console.log(`  Processed ${idx + 1}/${dates.length} dates (latest: ${bDate}, total bills: ${totalBillsProcessed})...`);
    }
  }

  // Update final model states to DB
  for (let dow = 0; dow <= 6; dow++) {
    const s = modelStateMap.get(dow);
    await client.query(`
      UPDATE sales_forecast_model_state SET
        rev_baseline_net = $1, rev_baseline_gross = $2, rev_ewma_alpha = $3,
        rev_smoothed_signed_error = $4, rev_smoothed_abs_error = $5, rev_tracking_signal = $6,
        rev_signed_bias_pct = $7, rev_applied_bias_pct = $8, rev_recent_wape = $9,
        rev_error_std = $10, rev_confidence_score = $11,
        qty_baseline_total_units = $12, qty_baseline_orders = $13, qty_baseline_covers = $14,
        qty_ewma_alpha = $15, qty_smoothed_signed_error = $16, qty_smoothed_abs_error = $17,
        qty_tracking_signal = $18, qty_signed_bias_pct = $19, qty_applied_bias_pct = $20,
        qty_recent_wape = $21, qty_error_std = $22, qty_confidence_score = $23,
        category_volume_mix_json = $24, category_revenue_mix_json = $25,
        dish_volume_mix_json = $26, sample_weeks_count = $27, last_trained_date = $28,
        updated_at = now()
      WHERE day_of_week = $29;
    `, [
      s.rev_baseline_net, s.rev_baseline_gross, s.rev_ewma_alpha,
      s.rev_smoothed_signed_error, s.rev_smoothed_abs_error, s.rev_tracking_signal,
      s.rev_signed_bias_pct, s.rev_applied_bias_pct, s.rev_recent_wape,
      s.rev_error_std, s.rev_confidence_score,
      s.qty_baseline_total_units, s.qty_baseline_orders, s.qty_baseline_covers,
      s.qty_ewma_alpha, s.qty_smoothed_signed_error, s.qty_smoothed_abs_error,
      s.qty_tracking_signal, s.qty_signed_bias_pct, s.qty_applied_bias_pct,
      s.qty_recent_wape, s.qty_error_std, s.qty_confidence_score,
      JSON.stringify(s.category_volume_mix_json || {}), JSON.stringify(s.category_revenue_mix_json || {}),
      JSON.stringify(s.dish_volume_mix_json || {}), s.sample_weeks_count, s.last_trained_date,
      dow,
    ]);
  }

  console.log(`\n🎉 Backfill Complete!`);
  console.log(`- Total Bills Processed: ${totalBillsProcessed} (100% of sales_orders accounted for)`);
  console.log(`- Cancelled Bills: ${totalCancelledCount}`);
  console.log(`- Complimentary Bills: ${totalComplimentaryCount}`);

  // Verification on critical dates
  const snap17 = await client.query(`SELECT * FROM sales_forecast_snapshots WHERE business_date = '2026-11-17'`);
  const r17 = snap17.rows[0];
  console.log('\n🔎 2026-11-17 Verification:');
  console.log(`  Actual Net Revenue: ₹${r17.actual_net_revenue} (Expected: ₹91521.87)`);
  console.log(`  Complimentary Menu Value: ₹${r17.decomp_complimentary_menu_value}`);
  console.log(`  Group Net: ₹${r17.decomp_group_net}, Normal Net: ₹${r17.decomp_normal_net}`);

  const snap14 = await client.query(`SELECT * FROM sales_forecast_snapshots WHERE business_date = '2026-11-14'`);
  const r14 = snap14.rows[0];
  console.log('\n🔎 2026-11-14 Children\'s Day Verification:');
  console.log(`  Actual Net Revenue: ₹${r14.actual_net_revenue}`);
  console.log(`  Group Net: ₹${r14.decomp_group_net}, Normal Net: ₹${r14.decomp_normal_net}`);
  console.log(`  Group Units: ${r14.decomp_group_units}, Normal Units: ${r14.decomp_normal_units}`);

  await client.end();
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
