/**
 * Theoretical vs. Actual (Theo-vs-Act) Inventory Variance Tracker
 * Ghoomar Yatra Phase 2
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { round } from '@/lib/forecasting/math';
import { EXCLUDED_NON_RESTAURANT_ITEMS } from '@/lib/forecasting/bill-classifier';

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
  // 1. Fetch Sales Items sold during the date range
  // Exclude Cancelled, preserve Success and Complimentary
  const { data: soldLines } = await supabase
    .from('sales_order_items')
    .select('item_name, quantity, status')
    .gte('business_date', startDate)
    .lte('business_date', endDate)
    .neq('status', 'Cancelled');

  // Aggregate dish quantities
  const dishQuantities = new Map<string, number>();
  for (const line of (soldLines || [])) {
    if (EXCLUDED_NON_RESTAURANT_ITEMS.has(line.item_name)) continue;
    const cleanName = line.item_name.trim();
    dishQuantities.set(cleanName, (dishQuantities.get(cleanName) || 0) + Number(line.quantity || 0));
  }

  // 2. Explode Dish Quantities into Theoretical Raw Material Demand
  const { data: menuItems } = await supabase
    .from('pos_menu_items')
    .select('id, name, normalized_name, canonical_dish_id')
    .not('canonical_dish_id', 'is', null);

  const { data: formulations } = await supabase
    .from('yatra_recipe_formulations')
    .select('id, canonical_dish_id, batch_yield_quantity, batch_yield_unit, is_active')
    .eq('is_active', true);

  const { data: ingredients } = await supabase
    .from('yatra_recipe_formulation_ingredients')
    .select('*');

  const { data: invItems } = await supabase
    .from('inventory_items')
    .select(`
      id, item_code, name, category_id, current_stock, current_weighted_average_cost,
      unit:units!inventory_items_unit_id_fkey(symbol),
      category:inventory_categories!inventory_items_category_id_fkey(name)
    `)
    .eq('is_active', true);

  const invItemMap = new Map<string, any>((invItems || []).map((i: any) => [i.id, i]));

  const nameToCanonical = new Map<string, string>();
  for (const m of (menuItems || [])) {
    if (m.canonical_dish_id) {
      nameToCanonical.set(m.name.toLowerCase().trim(), m.canonical_dish_id);
      if (m.normalized_name) {
        nameToCanonical.set(m.normalized_name.toLowerCase().trim(), m.canonical_dish_id);
      }
    }
  }

  const dishToFormulation = new Map<string, any>();
  const formulationMap = new Map<string, any>();
  for (const f of (formulations || [])) {
    dishToFormulation.set(f.canonical_dish_id, f);
    formulationMap.set(f.id, f);
  }

  const formulationIngredients = new Map<string, any[]>();
  for (const ing of (ingredients || [])) {
    const list = formulationIngredients.get(ing.formulation_id) || [];
    list.push(ing);
    formulationIngredients.set(ing.formulation_id, list);
  }

  const theoreticalDemandMap = new Map<string, number>();

  function explodeFormulation(formulationId: string, requiredUnits: number, depth: number = 0) {
    if (depth > 4) return;
    const f = formulationMap.get(formulationId);
    if (!f) return;

    const yieldQty = Math.max(1, f.batch_yield_quantity || 1);
    const scale = requiredUnits / yieldQty;

    const ings = formulationIngredients.get(formulationId) || [];
    for (const ing of ings) {
      const ingQty = Number(ing.quantity || 0) * scale;
      if (ing.ingredient_type === 'RAW_MATERIAL') {
        const itemId = ing.inventory_item_id;
        if (itemId) {
          theoreticalDemandMap.set(itemId, (theoreticalDemandMap.get(itemId) || 0) + ingQty);
        }
      } else if (ing.ingredient_type === 'PREPARATION') {
        const subFormId = ing.sub_preparation_formulation_id ||
          (ing.sub_preparation_dish_id ? dishToFormulation.get(ing.sub_preparation_dish_id)?.id : null);
        if (subFormId) {
          explodeFormulation(subFormId, ingQty, depth + 1);
        }
      }
    }
  }

  for (const [dishName, qty] of dishQuantities.entries()) {
    const clean = dishName.toLowerCase().trim();
    const canId = nameToCanonical.get(clean);
    const form = canId ? dishToFormulation.get(canId) : null;
    if (form) {
      explodeFormulation(form.id, qty, 1);
    }
  }

  // 3. Fetch Actual Consumption based on mode
  const actualConsumptionMap = new Map<string, number>();

  if (mode === 'count_bounded') {
    // Mode A: Count-Bounded mode
    // Actual Consumption = Opening Stock + Inward Purchases - Closing Stock
    const { data: movements } = await supabase
      .from('stock_movements')
      .select('item_id, movement_type, quantity, business_date')
      .gte('business_date', startDate)
      .lte('business_date', endDate);

    const purchaseMap = new Map<string, number>();
    const countMap = new Map<string, { earliest: number; latest: number }>();

    for (const mov of (movements || [])) {
      const q = Number(mov.quantity || 0);
      if (mov.movement_type === 'purchase') {
        purchaseMap.set(mov.item_id, (purchaseMap.get(mov.item_id) || 0) + q);
      } else if (mov.movement_type === 'count_adjustment') {
        const cur = countMap.get(mov.item_id) || { earliest: q, latest: q };
        cur.latest = q;
        countMap.set(mov.item_id, cur);
      }
    }

    for (const itemId of theoreticalDemandMap.keys()) {
      const p = purchaseMap.get(itemId) || 0;
      const c = countMap.get(itemId);
      if (c) {
        // Consumption = Opening + Purchases - Closing
        const consumed = Math.max(0, c.earliest + p - c.latest);
        actualConsumptionMap.set(itemId, consumed);
      } else if (p > 0) {
        // If purchases occurred without counts, consumption matches theoretical capped by purchases
        const theo = theoreticalDemandMap.get(itemId) || 0;
        actualConsumptionMap.set(itemId, Math.min(theo, p));
      }
    }
  } else {
    // Mode B: Movement-Based mode
    // Actual Consumption = Store Issues + Kitchen Wastage + Direct Usage Movements
    // Note: 'purchase' is strictly INWARD receipt, NEVER consumption!
    const { data: issues } = await supabase
      .from('consumption_issue_items')
      .select('item_id, quantity, issue:consumption_issues!consumption_issue_items_issue_id_fkey(business_date)')
      .gte('issue.business_date', startDate)
      .lte('issue.business_date', endDate);

    for (const iss of (issues || [])) {
      const q = Number(iss.quantity || 0);
      actualConsumptionMap.set(iss.item_id, (actualConsumptionMap.get(iss.item_id) || 0) + q);
    }

    const { data: movements } = await supabase
      .from('stock_movements')
      .select('item_id, movement_type, quantity')
      .gte('business_date', startDate)
      .lte('business_date', endDate)
      .in('movement_type', ['issue', 'consumption', 'wastage']);

    for (const mov of (movements || [])) {
      const q = Number(mov.quantity || 0);
      actualConsumptionMap.set(mov.item_id, (actualConsumptionMap.get(mov.item_id) || 0) + q);
    }
  }

  // 4. Assemble Variance Items
  const items: VarianceItem[] = [];
  let unfavorableCount = 0;
  let favorableCount = 0;
  let alignedCount = 0;
  let totalVarianceCost = 0;

  // Evaluate items that have either theoretical demand or actual consumption
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
      unit_symbol: (Array.isArray(inv.unit) ? inv.unit[0]?.symbol : (inv.unit as any)?.symbol) || 'pcs',
      category_name: (Array.isArray(inv.category) ? inv.category[0]?.name : (inv.category as any)?.name) || 'Kitchen',
      theoretical_consumption: theo,
      actual_consumption: act,
      variance_qty: varQty,
      variance_pct: varPct,
      status,
    };

    if (canViewCosts) {
      item.unit_cost = round(wac, 2);
      item.variance_cost = varCost;
    }

    items.push(item);
  }

  // Sort by unfavorable variance cost descending (or variance qty descending)
  items.sort((a, b) => b.variance_qty - a.variance_qty);

  const report: VarianceReport = {
    start_date: startDate,
    end_date: endDate,
    mode,
    total_theoretical_items_count: items.length,
    unfavorable_count: unfavorableCount,
    favorable_count: favorableCount,
    aligned_count: alignedCount,
    items,
  };

  if (canViewCosts) {
    report.total_variance_cost = round(totalVarianceCost, 2);
  }

  return report;
}
