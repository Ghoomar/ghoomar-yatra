/**
 * Theoretical vs. Actual (Theo-vs-Act) Inventory Variance Tracker
 * Ghoomar Yatra Phase 2
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { round } from '@/lib/forecasting/math';
import { EXCLUDED_NON_RESTAURANT_ITEMS } from '@/lib/forecasting/bill-classifier';
import { explodeDishDemandsToRawMaterials } from './bom-explosion';

export interface VarianceItem {
  item_id: string;
  item_code: string;
  item_name: string;
  unit_symbol: string;
  category_name: string;
  theoretical_consumption: number;
  actual_consumption: number;
  variance_qty: number;
  variance_pct: number;
  status: 'favorable' | 'unfavorable' | 'aligned';
  count_status: 'verified' | 'count_pending' | 'movement_logged';
  unit_cost?: number;
  variance_cost?: number;
}

export interface VarianceReport {
  start_date: string;
  end_date: string;
  mode: 'movement_based' | 'count_bounded';
  total_theoretical_items_count: number;
  unfavorable_count: number;
  favorable_count: number;
  aligned_count: number;
  count_pending_count: number;
  total_variance_cost?: number;
  items: VarianceItem[];
}

/**
 * Computes Theo-vs-Act Variance for an IST date range.
 */
export async function calculateInventoryVariance(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
  mode: 'movement_based' | 'count_bounded' = 'movement_based',
  canViewCosts: boolean = false
): Promise<VarianceReport> {
  // 1. Fetch Sales Items sold during the date range (exclude Cancelled, preserve Success & Complimentary)
  // Note: handle pagination if large range (>1000 rows) cleanly in chunks or single high-limit read
  let soldLines: any[] = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('sales_order_items')
      .select('item_name, quantity, status')
      .gte('business_date', startDate)
      .lte('business_date', endDate)
      .neq('status', 'Cancelled')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    soldLines = soldLines.concat(data);
    if (data.length < pageSize) break;
    page++;
  }

  // Aggregate dish quantities
  const dishQuantities = new Map<string, number>();
  for (const line of soldLines) {
    if (EXCLUDED_NON_RESTAURANT_ITEMS.has(line.item_name)) continue;
    const cleanName = (line.item_name || '').trim();
    if (!cleanName) continue;
    dishQuantities.set(cleanName, (dishQuantities.get(cleanName) || 0) + Number(line.quantity || 0));
  }

  const dishDemands = Array.from(dishQuantities.entries()).map(([dish_name, predicted_quantity]) => ({
    dish_name,
    predicted_quantity,
  }));

  // 2. Explode Dish Quantities through shared 4-tier DAG engine
  const { rawDemands: theoreticalDemandMap, invItemMap } = await explodeDishDemandsToRawMaterials(
    supabase,
    dishDemands
  );

  // 3. Fetch logged issues & wastage (used in movement_based AND as honest fallback when count_bounded lacks closing count)
  const loggedUsageMap = new Map<string, number>();

  const [{ data: issues }, { data: usageMovements }] = await Promise.all([
    supabase
      .from('consumption_issues')
      .select('business_date, items:consumption_issue_items(item_id, quantity)')
      .gte('business_date', startDate)
      .lte('business_date', endDate),
    supabase
      .from('stock_movements')
      .select('item_id, movement_type, quantity')
      .gte('business_date', startDate)
      .lte('business_date', endDate)
      .in('movement_type', ['issue', 'consumption', 'consumption_issue', 'wastage', 'spoilage', 'breakage', 'loss']),
  ]);

  for (const issue of (issues || [])) {
    for (const iss of (issue.items || [])) {
      const q = Math.abs(Number(iss.quantity || 0));
      loggedUsageMap.set(iss.item_id, (loggedUsageMap.get(iss.item_id) || 0) + q);
    }
  }

  for (const mov of (usageMovements || [])) {
    const q = Math.abs(Number(mov.quantity || 0));
    loggedUsageMap.set(mov.item_id, (loggedUsageMap.get(mov.item_id) || 0) + q);
  }

  // 4. Compute Actual Consumption & Count Status
  const actualConsumptionMap = new Map<string, number>();
  const countStatusMap = new Map<string, 'verified' | 'count_pending' | 'movement_logged'>();

  if (mode === 'count_bounded') {
    // True Count-Bounded Mode: Read physical balances from inventory_count_items joined to approved inventory_counts
    const [{ data: approvedCounts }, { data: purchaseMovements }] = await Promise.all([
      supabase
        .from('inventory_counts')
        .select('id, business_date, status, items:inventory_count_items(item_id, physical_quantity)')
        .eq('status', 'approved')
        .lte('business_date', endDate)
        .order('business_date', { ascending: true }),
      supabase
        .from('stock_movements')
        .select('item_id, quantity, business_date')
        .eq('movement_type', 'purchase')
        .lte('business_date', endDate),
    ]);

    // Map item_id -> ordered count snapshots [{ business_date, physical_quantity }]
    const itemCountHistory = new Map<string, Array<{ date: string; qty: number }>>();
    for (const cnt of (approvedCounts || [])) {
      const cntDate = String(cnt.business_date).slice(0, 10);
      for (const ci of (cnt.items || [])) {
        const list = itemCountHistory.get(ci.item_id) || [];
        list.push({ date: cntDate, qty: Number(ci.physical_quantity || 0) });
        itemCountHistory.set(ci.item_id, list);
      }
    }

    // Map item_id -> purchase movements [{ date, qty }]
    const itemPurchases = new Map<string, Array<{ date: string; qty: number }>>();
    for (const p of (purchaseMovements || [])) {
      const pDate = String(p.business_date).slice(0, 10);
      const list = itemPurchases.get(p.item_id) || [];
      list.push({ date: pDate, qty: Number(p.quantity || 0) });
      itemPurchases.set(p.item_id, list);
    }

    const allCandidateIds = new Set<string>([
      ...theoreticalDemandMap.keys(),
      ...loggedUsageMap.keys(),
    ]);

    for (const itemId of allCandidateIds) {
      const history = itemCountHistory.get(itemId) || [];
      // Opening count: latest approved count on or before startDate (or earliest count in [startDate, endDate])
      const beforeOrAtStart = history.filter((h) => h.date <= startDate);
      const opening =
        beforeOrAtStart.length > 0
          ? beforeOrAtStart[beforeOrAtStart.length - 1]
          : history.find((h) => h.date >= startDate && h.date <= endDate) || null;

      // Closing count: latest approved count strictly after opening date and <= endDate
      const closingCandidates = opening
        ? history.filter((h) => h.date > opening.date && h.date <= endDate)
        : [];
      const closing = closingCandidates.length > 0 ? closingCandidates[closingCandidates.length - 1] : null;

      if (opening && closing) {
        const purchasesBetween = (itemPurchases.get(itemId) || [])
          .filter((p) => p.date > opening.date && p.date <= closing.date)
          .reduce((sum, p) => sum + p.qty, 0);

        const consumed = Math.max(0, opening.qty + purchasesBetween - closing.qty);
        actualConsumptionMap.set(itemId, consumed);
        countStatusMap.set(itemId, 'verified');
      } else {
        // Missing either opening or closing count -> NEVER fabricate via Math.min(theo, p)
        const logged = loggedUsageMap.get(itemId) || 0;
        actualConsumptionMap.set(itemId, logged);
        countStatusMap.set(itemId, 'count_pending');
      }
    }
  } else {
    // Movement-Based Mode: Strictly logged store issues & wastage (0 if none logged)
    for (const [itemId, q] of loggedUsageMap.entries()) {
      actualConsumptionMap.set(itemId, q);
      countStatusMap.set(itemId, q > 0 ? 'movement_logged' : 'count_pending');
    }
  }

  // 5. Assemble Variance Items
  const items: VarianceItem[] = [];
  let unfavorableCount = 0;
  let favorableCount = 0;
  let alignedCount = 0;
  let countPendingCount = 0;
  let totalVarianceCost = 0;

  const evaluatedItemIds = new Set<string>([
    ...theoreticalDemandMap.keys(),
    ...actualConsumptionMap.keys(),
  ]);

  for (const itemId of evaluatedItemIds) {
    const inv = invItemMap.get(itemId);
    if (!inv) continue;

    const theo = round(theoreticalDemandMap.get(itemId) || 0, 2);
    const act = round(actualConsumptionMap.get(itemId) || 0, 2);
    const varQty = round(act - theo, 2);
    const countStatus = countStatusMap.get(itemId) || 'count_pending';

    if (countStatus === 'count_pending') {
      countPendingCount++;
    }

    let varPct = 0;
    if (theo > 0) {
      varPct = round((varQty / theo) * 100, 1);
    } else if (act > 0) {
      varPct = 100.0;
    }

    let status: 'favorable' | 'unfavorable' | 'aligned' = 'aligned';
    if (varQty > 0.05) {
      status = 'unfavorable';
      unfavorableCount++;
    } else if (varQty < -0.05) {
      status = 'favorable';
      favorableCount++;
    } else {
      alignedCount++;
    }

    const wac = Number(inv.current_weighted_average_cost || 0);
    const varCost = round(varQty * wac, 2);
    totalVarianceCost += varCost;

    const item: VarianceItem = {
      item_id: inv.id,
      item_code: inv.item_code || '',
      item_name: inv.name,
      unit_symbol: (Array.isArray(inv.unit) ? inv.unit[0]?.symbol : inv.unit?.symbol) || 'pcs',
      category_name:
        (Array.isArray(inv.category) ? inv.category[0]?.name : inv.category?.name) || 'Kitchen',
      theoretical_consumption: theo,
      actual_consumption: act,
      variance_qty: varQty,
      variance_pct: varPct,
      status,
      count_status: countStatus,
    };

    if (canViewCosts) {
      item.unit_cost = round(wac, 2);
      item.variance_cost = varCost;
    }

    items.push(item);
  }

  // Sort by theoretical consumption descending (so highest impact kitchen items surface first)
  items.sort((a, b) => Math.abs(b.variance_qty) - Math.abs(a.variance_qty));

  const report: VarianceReport = {
    start_date: startDate,
    end_date: endDate,
    mode,
    total_theoretical_items_count: items.length,
    unfavorable_count: unfavorableCount,
    favorable_count: favorableCount,
    aligned_count: alignedCount,
    count_pending_count: countPendingCount,
    items,
  };

  if (canViewCosts) {
    report.total_variance_cost = round(totalVarianceCost, 2);
  }

  return report;
}
