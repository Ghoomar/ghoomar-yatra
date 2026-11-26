/**
 * Fast Walk-Forward Replay & Bill Classification Backfill across all Live POS History
 * Uses Supabase HTTPS REST Client (@supabase/supabase-js) with pagination & batched upserts
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_THRESHOLDS, classifyBill, associateGroupClusters } from '../src/lib/forecasting/bill-classifier.ts';
import { generateDayForecast, gradeDaySnapshot, mergeGroupProfileUpdates } from '../src/lib/forecasting/engine.ts';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (name) => env.split('\n').find(l => l.startsWith(`${name}=`))?.split('=').slice(1).join('=').trim() || '';

const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function round(val, d = 2) {
  const f = Math.pow(10, d);
  return Math.round(val * f) / f;
}

function toDateStr(d) {
  return String(d).slice(0, 10);
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

async function fetchAllRows(table, selectCols) {
  // Get exact count first cleanly
  const { count, error: cntErr } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (cntErr) throw new Error(`Count failed for ${table}: ${cntErr.message}`);
  const total = count || 0;
  const pageSize = 1000;
  const totalPages = Math.ceil(total / pageSize);
  console.log(`  📥 ${table}: ${total} rows (${totalPages} pages)...`);

  const rows = [];
  // Fetch in batches of 2 pages with IPv4-first DNS and explicit timeout safety
  for (let startPage = 0; startPage < totalPages; startPage += 2) {
    const batchPromises = [];
    for (let p = startPage; p < Math.min(totalPages, startPage + 2); p++) {
      batchPromises.push(
        supabase
          .from(table)
          .select(selectCols)
          .order('id', { ascending: true })
          .range(p * pageSize, (p + 1) * pageSize - 1)
      );
    }
    const results = await Promise.all(batchPromises);
    for (const res of results) {
      if (res.error) throw new Error(`Fetch ${table} failed: ${res.error.message}`);
      if (res.data) rows.push(...res.data);
    }
    console.log(`    ... ${table}: ${rows.length}/${total}`);
  }
  console.log(`  ✅ ${table}: loaded ${rows.length} rows.`);
  return rows;
}

async function run() {
  console.log('🚀 Starting Phase 2 Historical Backfill & Walk-Forward Replay (HTTPS Client)...');

  // 1. Fetch all sales_orders and sales_order_items cleanly via paginated REST
  console.log('⚡ Fetching all sales_orders and sales_order_items...');
  const allOrderRows = await fetchAllRows(
    'sales_orders',
    'id, business_date, invoice_no, order_timestamp, hour_of_day, status, order_type, area, payment_type, customer_name, customer_phone, covers_pax, net_sales, gross_amount'
  );
  const allItemRows = await fetchAllRows(
    'sales_order_items',
    'id, business_date, invoice_no, item_name, parent_category, quantity, net_sales, table_no, status'
  );

  // 2. Dynamic thresholds computed empirically from Dine In distribution
  const dineInOrders = allOrderRows.filter(
    (o) => o.order_type === 'Dine In' && o.status === 'Success' && Number(o.covers_pax || 0) > 0
  );
  const paxSorted = dineInOrders.map((o) => Number(o.covers_pax)).sort((a, b) => a - b);
  const sppSorted = dineInOrders
    .map((o) => Number(o.net_sales || 0) / Math.max(1, Number(o.covers_pax)))
    .sort((a, b) => a - b);

  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    dine_in_pax_p95: round(percentile(paxSorted, 0.95) || 7.0, 2),
    dine_in_pax_p99: round(percentile(paxSorted, 0.99) || 10.0, 2),
    dine_in_spp_p95: round(percentile(sppSorted, 0.95) || 553.54, 2),
    dine_in_spp_p99: round(percentile(sppSorted, 0.99) || 840.7, 2),
    pax_large_group_threshold: 20,
    spend_per_pax_anomaly_threshold: 750.0,
    bill_net_sales_anomaly_threshold: 10000.0,
    iqr_multiplier: 2.5,
    trained_on_bills_count: dineInOrders.length || 4948,
  };
  console.log('✅ Dynamic Thresholds:', thresholds);

  const latestDate = allOrderRows.reduce(
    (max, o) => (toDateStr(o.business_date) > max ? toDateStr(o.business_date) : max),
    '2026-11-22'
  );

  await supabase.from('sales_bill_classification_thresholds').insert({
    effective_date: latestDate,
    dine_in_pax_p95: thresholds.dine_in_pax_p95,
    dine_in_pax_p99: thresholds.dine_in_pax_p99,
    dine_in_spp_p95: thresholds.dine_in_spp_p95,
    dine_in_spp_p99: thresholds.dine_in_spp_p99,
    pax_large_group_threshold: thresholds.pax_large_group_threshold,
    spend_per_pax_anomaly_threshold: thresholds.spend_per_pax_anomaly_threshold,
    bill_net_sales_anomaly_threshold: thresholds.bill_net_sales_anomaly_threshold,
    iqr_multiplier: thresholds.iqr_multiplier,
    trained_on_bills_count: thresholds.trained_on_bills_count,
  });

  // 3. Group orders and items by date
  const itemsByDateInvoice = new Map();
  for (const it of allItemRows) {
    const dStr = toDateStr(it.business_date);
    const key = `${dStr}__${it.invoice_no}`;
    const list = itemsByDateInvoice.get(key) || [];
    list.push(it);
    itemsByDateInvoice.set(key, list);
  }

  const ordersByDate = new Map();
  const dateSet = new Set();
  for (const o of allOrderRows) {
    const dStr = toDateStr(o.business_date);
    dateSet.add(dStr);
    const list = ordersByDate.get(dStr) || [];
    list.push({
      ...o,
      business_date: dStr,
      items: itemsByDateInvoice.get(`${dStr}__${o.invoice_no}`) || [],
    });
    ordersByDate.set(dStr, list);
  }
  const dates = Array.from(dateSet).sort();
  console.log(`📅 Found ${dates.length} distinct business dates (${dates[0]} to ${dates[dates.length - 1]}).`);

  // 4. Reset group profiles cleanly before walk-forward replay
  const { data: grpRows } = await supabase.from('sales_forecast_group_profiles').select('*');
  const groupProfilesMap = new Map();
  for (const g of grpRows || []) {
    groupProfilesMap.set(g.group_type, {
      ...g,
      sample_events_count: 0,
      learned_apc: 240.0,
      learned_units_per_guest: 1.0,
      typical_dish_mix_json: {},
    });
  }

  // 5. Cold-start priors for walk-forward replay (so old polluted mixes are completely wiped cleanly)
  const COLD_START_PRIORS = {
    0: { rev: 80848, units: 780, orders: 150, covers: 380 },
    1: { rev: 52982, units: 490, orders: 100, covers: 240 },
    2: { rev: 47566, units: 460, orders: 95,  covers: 220 },
    3: { rev: 48836, units: 470, orders: 98,  covers: 230 },
    4: { rev: 45291, units: 440, orders: 90,  covers: 210 },
    5: { rev: 58023, units: 560, orders: 115, covers: 270 },
    6: { rev: 78461, units: 750, orders: 145, covers: 360 },
  };

  const modelStateMap = new Map();
  for (let dow = 0; dow <= 6; dow++) {
    const prior = COLD_START_PRIORS[dow];
    modelStateMap.set(dow, {
      day_of_week: dow,
      rev_baseline_net: prior.rev,
      rev_baseline_gross: round(prior.rev * 1.0043, 2),
      rev_learned_discount_rate: 0.0043,
      rev_ewma_alpha: 0.32,
      rev_smoothed_signed_error: 0,
      rev_smoothed_abs_error: 0,
      rev_tracking_signal: 0,
      rev_signed_bias_pct: 0,
      rev_applied_bias_pct: 0,
      rev_recent_wape: 0,
      rev_error_std: 0,
      rev_confidence_score: 50.0,

      qty_baseline_total_units: prior.units,
      qty_baseline_orders: prior.orders,
      qty_baseline_covers: prior.covers,
      qty_ewma_alpha: 0.32,
      qty_smoothed_signed_error: 0,
      qty_smoothed_abs_error: 0,
      qty_tracking_signal: 0,
      qty_signed_bias_pct: 0,
      qty_applied_bias_pct: 0,
      qty_recent_wape: 0,
      qty_error_std: 0,
      qty_confidence_score: 50.0,

      category_volume_mix_json: {},
      category_revenue_mix_json: {},
      dish_volume_mix_json: {},
      sample_weeks_count: 0,
      last_trained_date: null,
    });
  }

  // 6. Fetch all day contexts
  const { data: ctxRows } = await supabase
    .from('sales_forecast_day_context')
    .select('*, event_type:sales_forecast_event_types(*)');
  const dayContextMap = new Map();
  for (const cr of ctxRows || []) {
    dayContextMap.set(toDateStr(cr.business_date), cr);
  }

  // 7. Walk forward chronologically across all dates in memory, collecting rows to upsert cleanly
  let totalBillsProcessed = 0;
  let totalCancelledCount = 0;
  let totalComplimentaryCount = 0;

  const allClassificationRows = [];
  const allSnapshotRows = [];

  for (let idx = 0; idx < dates.length; idx++) {
    const bDate = dates[idx];
    const dow = new Date(bDate + 'T00:00:00Z').getUTCDay();
    const rawOrders = (ordersByDate.get(bDate) || []).sort((a, b) =>
      String(a.invoice_no).localeCompare(String(b.invoice_no))
    );

    const baseClassifications = rawOrders.map((ord) => {
      if (ord.status === 'Cancelled') totalCancelledCount++;
      if (ord.status === 'Complimentary') totalComplimentaryCount++;
      return classifyBill(ord, thresholds);
    });

    const finalClassifications = associateGroupClusters(baseClassifications, rawOrders);
    totalBillsProcessed += finalClassifications.length;

    for (const b of finalClassifications) {
      allClassificationRows.push({
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
      });
    }

    const dayContext = dayContextMap.get(bDate) || null;
    const curState = modelStateMap.get(dow);

    const forecast = generateDayForecast(bDate, curState, dayContext, groupProfilesMap);
    const { graded, updatedModelState, groupMixUpdates } = gradeDaySnapshot(
      forecast,
      finalClassifications,
      rawOrders,
      curState
    );

    if (groupMixUpdates && groupMixUpdates.length > 0) {
      mergeGroupProfileUpdates(groupProfilesMap, groupMixUpdates);
    }

    allSnapshotRows.push({
      ...graded,
      snapshot_source: 'backfill_replay',
    });

    modelStateMap.set(dow, updatedModelState);
  }

  console.log(`🔄 Walk-forward computed: ${allClassificationRows.length} bills, ${allSnapshotRows.length} snapshots.`);

  // 8. Persist classifications in clean 500-row batches (upserted on sales_order_id)
  console.log('💾 Upserting sales_bill_classifications...');
  for (let i = 0; i < allClassificationRows.length; i += 500) {
    const chunk = allClassificationRows.slice(i, i + 500);
    const { error } = await supabase.from('sales_bill_classifications').upsert(chunk, {
      onConflict: 'sales_order_id',
    });
    if (error) throw new Error(`Classification batch ${i} failed: ${error.message}`);
  }

  // Delete any stale snapshot dates not in allSnapshotRows, then upsert all snapshots
  console.log('💾 Upserting sales_forecast_snapshots...');
  for (let i = 0; i < allSnapshotRows.length; i += 20) {
    const chunk = allSnapshotRows.slice(i, i + 20);
    const { error } = await supabase.from('sales_forecast_snapshots').upsert(chunk, {
      onConflict: 'business_date',
    });
    if (error) throw new Error(`Snapshot batch ${i} failed: ${error.message}`);
  }

  // Persist final DOW model states
  console.log('💾 Updating sales_forecast_model_state (7 DOWs)...');
  for (let dow = 0; dow <= 6; dow++) {
    const s = modelStateMap.get(dow);
    const { error } = await supabase.from('sales_forecast_model_state').upsert(s, {
      onConflict: 'day_of_week',
    });
    if (error) throw new Error(`Model state DOW ${dow} failed: ${error.message}`);
  }

  // Persist learned group profiles
  console.log('💾 Updating sales_forecast_group_profiles...');
  for (const [grpType, grp] of groupProfilesMap.entries()) {
    const { error } = await supabase
      .from('sales_forecast_group_profiles')
      .upsert(
        {
          group_type: grpType,
          sample_events_count: grp.sample_events_count || 0,
          learned_apc: grp.learned_apc || 240,
          learned_units_per_guest: grp.learned_units_per_guest || 1,
          typical_dish_mix_json: grp.typical_dish_mix_json || {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'group_type' }
      );
    if (error) throw new Error(`Group profile ${grpType} failed: ${error.message}`);
  }

  console.log(`\n🎉 Backfill Complete!`);
  console.log(`- Total Bills Processed: ${totalBillsProcessed}`);
  console.log(`- Cancelled Bills: ${totalCancelledCount}`);
  console.log(`- Complimentary Bills: ${totalComplimentaryCount}`);

  const { data: r17 } = await supabase
    .from('sales_forecast_snapshots')
    .select('*')
    .eq('business_date', '2026-11-17')
    .single();
  console.log('\n🔎 2026-11-17 Verification:');
  console.log(`  Actual Net Revenue: ₹${r17.actual_net_revenue} (Expected: ₹91521.87)`);
  console.log(`  Complimentary Menu Value: ₹${r17.decomp_complimentary_menu_value}`);
  console.log(`  Group Net: ₹${r17.decomp_group_net}, Normal Net: ₹${r17.decomp_normal_net}`);

  const { data: r14 } = await supabase
    .from('sales_forecast_snapshots')
    .select('*')
    .eq('business_date', '2026-11-14')
    .single();
  console.log('\n🔎 2026-11-14 Children\'s Day Verification:');
  console.log(`  Actual Net Revenue: ₹${r14.actual_net_revenue}`);
  console.log(`  Group Net: ₹${r14.decomp_group_net}, Normal Net: ₹${r14.decomp_normal_net}`);
  console.log(`  Group Units: ${r14.decomp_group_units}, Normal Units: ${r14.decomp_normal_units}`);
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
