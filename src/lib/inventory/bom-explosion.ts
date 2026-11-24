/**
 * Hybrid BOM Purchasing Explosion & Culinary DAG Traversal
 * Ghoomar Yatra Phase 2
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { round } from '@/lib/forecasting/math';
import { EXCLUDED_NON_RESTAURANT_ITEMS } from '@/lib/forecasting/bill-classifier';

export interface DishDemandInput {
  dish_name: string;
  predicted_quantity: number;
}

export interface PurchaseSuggestionItem {
  item_id: string;
  item_code: string;
  item_name: string;
  category_name: string;
  unit_symbol: string;
  current_stock: number;
  par_level: number;
  max_stock_level: number | null;
  forecast_demand_qty: number;
  suggested_order_qty: number;
  demand_source: 'BOM_EXPLOSION' | 'STORE_HISTORY_FALLBACK' | 'HYBRID';
  qty_confidence_score: number;
  unit_cost?: number;
  line_cost?: number;
}

interface RawIngredientRow {
  formulation_id: string;
  ingredient_type: string;
  inventory_item_id: string | null;
  ingredient_group_id: string | null;
  sub_preparation_dish_id: string | null;
  sub_preparation_formulation_id: string | null;
  quantity: number;
  unit: string;
}

interface FormulationRow {
  id: string;
  canonical_dish_id: string;
  batch_yield_quantity: number;
  batch_yield_unit: string;
  is_active: boolean;
}

interface InventoryItemRow {
  id: string;
  item_code: string;
  name: string;
  unit_id: string;
  category_id: string;
  current_stock: number;
  preferred_stock: number | null;
  minimum_stock: number | null;
  max_stock_level: number | null;
  current_weighted_average_cost: number | null;
  unit?: { symbol: string };
  category?: { name: string };
}

/**
 * Traverses the 4-tier culinary DAG to explode dish demands into raw material ingredient demands.
 */
export async function explodeBomDemands(
  supabase: SupabaseClient,
  dishDemands: DishDemandInput[],
  qtyConfidenceScore: number,
  canViewCosts: boolean = false
): Promise<PurchaseSuggestionItem[]> {
  // 1. Fetch Menu Items, Canonical Dishes & Formulations
  const { data: menuItems } = await supabase
    .from('pos_menu_items')
    .select('id, name, normalized_name, canonical_dish_id')
    .not('canonical_dish_id', 'is', null);

  const { data: aliases } = await supabase
    .from('pos_menu_item_aliases')
    .select('alias, menu_item_id');

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
      id, item_code, name, category_id, current_stock, preferred_stock, minimum_stock,
      max_stock_level, current_weighted_average_cost,
      unit:units!inventory_items_unit_id_fkey(symbol),
      category:inventory_categories!inventory_items_category_id_fkey(name)
    `)
    .eq('is_active', true);

  if (!invItems || invItems.length === 0) return [];

  const invItemMap = new Map<string, any>(invItems.map((i: any) => [i.id, i]));

  // Menu mapping lookups
  const nameToCanonical = new Map<string, string>();
  for (const m of (menuItems || [])) {
    if (m.canonical_dish_id) {
      nameToCanonical.set(m.name.toLowerCase().trim(), m.canonical_dish_id);
      if (m.normalized_name) {
        nameToCanonical.set(m.normalized_name.toLowerCase().trim(), m.canonical_dish_id);
      }
    }
  }

  // Formulation map: canonical_dish_id -> formulation
  const dishToFormulation = new Map<string, FormulationRow>();
  const formulationMap = new Map<string, FormulationRow>();
  for (const f of (formulations || [])) {
    dishToFormulation.set(f.canonical_dish_id, f);
    formulationMap.set(f.id, f);
  }

  // Formulation ingredients map: formulation_id -> ingredients[]
  const formulationIngredients = new Map<string, RawIngredientRow[]>();
  for (const ing of (ingredients || [])) {
    const list = formulationIngredients.get(ing.formulation_id) || [];
    list.push(ing);
    formulationIngredients.set(ing.formulation_id, list);
  }

  // Recursive Explosion function with depth guard (max 4 tiers)
  const itemDemands = new Map<string, { qty: number; isBom: boolean }>();

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
          const cur = itemDemands.get(itemId) || { qty: 0, isBom: true };
          cur.qty += ingQty;
          cur.isBom = true;
          itemDemands.set(itemId, cur);
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

  // Process all dish demands
  const unmappedDishes: DishDemandInput[] = [];

  for (const demand of dishDemands) {
    if (EXCLUDED_NON_RESTAURANT_ITEMS.has(demand.dish_name)) continue;
    const cleanName = demand.dish_name.toLowerCase().trim();
    const canonicalId = nameToCanonical.get(cleanName);
    const form = canonicalId ? dishToFormulation.get(canonicalId) : null;

    if (form) {
      explodeFormulation(form.id, demand.predicted_quantity, 1);
    } else {
      unmappedDishes.push(demand);
    }
  }

  // 2. Hybrid Fallback: For items not covered by BOM or unmapped items,
  // evaluate inventory items where current_stock is below par level
  const suggestions: PurchaseSuggestionItem[] = [];

  for (const inv of invItems) {
    const curStock = Number(inv.current_stock || 0);
    const par = Number(inv.preferred_stock || inv.minimum_stock || 0);
    const maxStock = inv.max_stock_level ? Number(inv.max_stock_level) : null;
    const wac = Number(inv.current_weighted_average_cost || 0);

    const bomDemand = itemDemands.get(inv.id);
    let forecastDemandQty = 0;
    let demandSource: 'BOM_EXPLOSION' | 'STORE_HISTORY_FALLBACK' | 'HYBRID' = 'STORE_HISTORY_FALLBACK';

    if (bomDemand && bomDemand.qty > 0) {
      forecastDemandQty = round(bomDemand.qty, 2);
      demandSource = 'BOM_EXPLOSION';
    }

    // Purchase suggestion formula:
    // suggested = max(0, par + forecast_demand - current_stock)
    let suggestedQty = Math.max(0, par + forecastDemandQty - curStock);

    // Perishable Cap Guardrail:
    if (maxStock !== null && maxStock > 0) {
      if (curStock + suggestedQty > maxStock) {
        suggestedQty = Math.max(0, maxStock - curStock);
      }
    }

    suggestedQty = round(suggestedQty, 2);

    // Include item if suggestedQty > 0 or if it was explicitly exploded in BOM
    if (suggestedQty > 0 || forecastDemandQty > 0) {
      const item: PurchaseSuggestionItem = {
        item_id: inv.id,
        item_code: inv.item_code || '',
        item_name: inv.name,
        category_name: (Array.isArray(inv.category) ? inv.category[0]?.name : (inv.category as any)?.name) || 'Store',
        unit_symbol: (Array.isArray(inv.unit) ? inv.unit[0]?.symbol : (inv.unit as any)?.symbol) || 'pcs',
        current_stock: round(curStock, 2),
        par_level: round(par, 2),
        max_stock_level: maxStock ? round(maxStock, 2) : null,
        forecast_demand_qty: forecastDemandQty,
        suggested_order_qty: suggestedQty,
        demand_source: demandSource,
        qty_confidence_score: qtyConfidenceScore,
      };

      // Cost Stripping for RBAC
      if (canViewCosts) {
        item.unit_cost = round(wac, 2);
        item.line_cost = round(suggestedQty * wac, 2);
      }

      suggestions.push(item);
    }
  }

  // Sort: suggested_order_qty > 0 first, then by forecast demand descending
  suggestions.sort((a, b) => {
    if (a.suggested_order_qty > 0 && b.suggested_order_qty <= 0) return -1;
    if (a.suggested_order_qty <= 0 && b.suggested_order_qty > 0) return 1;
    return b.forecast_demand_qty - a.forecast_demand_qty;
  });

  return suggestions;
}
