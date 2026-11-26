/**
 * Hybrid BOM Purchasing Explosion & Culinary DAG Traversal
 * Ghoomar Yatra Phase 2
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { round } from '@/lib/forecasting/math';
import { EXCLUDED_NON_RESTAURANT_ITEMS } from '@/lib/forecasting/bill-classifier';
import { convertDirectQuantity, ExplicitConversion, normalizeUnit } from '@/lib/sops/costing/units';
import {
  isNonFoodOrTestDishName,
  loadCanonicalMenuLookup,
  resolveCanonicalMenuItem,
} from '@/lib/sales/canonical-menu';

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

export interface BomExplosionContext {
  rawDemands: Map<string, number>;
  invItems: any[];
  invItemMap: Map<string, any>;
  mappedDishNames: Set<string>;
}

/**
 * Resolves a menu item's primary inventory item for a logical ingredient group.
 */
function pickPrimaryItemForGroup(groupItems: any[]): any | null {
  if (!groupItems || groupItems.length === 0) return null;
  if (groupItems.length === 1) return groupItems[0];

  const sorted = [...groupItems].sort((a, b) => {
    const aHasStock = Number(a.current_stock || 0) > 0 ? 1 : 0;
    const bHasStock = Number(b.current_stock || 0) > 0 ? 1 : 0;
    if (aHasStock !== bHasStock) return bHasStock - aHasStock;

    const aCosted = a.is_costed && Number(a.current_weighted_average_cost || 0) > 0 ? 1 : 0;
    const bCosted = b.is_costed && Number(b.current_weighted_average_cost || 0) > 0 ? 1 : 0;
    if (aCosted !== bCosted) return bCosted - aCosted;

    const aStock = Number(a.current_stock || 0);
    const bStock = Number(b.current_stock || 0);
    if (aStock !== bStock) return bStock - aStock;

    const aBranded = a.brand_name && a.brand_name !== 'Generic' ? 1 : 0;
    const bBranded = b.brand_name && b.brand_name !== 'Generic' ? 1 : 0;
    if (aBranded !== bBranded) return bBranded - aBranded;

    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return sorted[0];
}

function normalizeLookupKey(str: string | null | undefined): string {
  return (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function safeConvert(
  qty: number,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
  options?: {
    inventoryItemId?: string | null;
    ingredientGroupId?: string | null;
    conversions?: ExplicitConversion[];
    pieceWeightGrams?: number;
    conversionFactor?: number;
    secondaryUnit?: string;
    baseUnit?: string;
    itemName?: string;
  }
): number | null {
  if (qty <= 0) return 0;
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);
  if (!normFrom || !normTo || normFrom === normTo) return qty;

  const conv = convertDirectQuantity(qty, fromUnit || '', toUnit || '', options);
  if (conv.possible && conv.converted !== undefined) {
    return conv.converted;
  }
  return null;
}

/**
 * Shared 4-tier Culinary DAG explosion engine used by BOTH Purchase Forecasting and Theo-vs-Act Variance.
 * Resolves POS dishes via direct names & pos_menu_item_aliases -> variants/combos/canonical recipes ->
 * recursive sub-preparations -> logical_ingredient_groups -> primary inventory_items in base unit.
 */
export async function explodeDishDemandsToRawMaterials(
  supabase: SupabaseClient,
  dishDemands: DishDemandInput[]
): Promise<BomExplosionContext> {
  const [
    canonicalLookup,
    variantRes,
    comboRes,
    recipeRes,
    ingRes,
    convRes,
    invRes,
  ] = await Promise.all([
    loadCanonicalMenuLookup(supabase),
    supabase
      .from('yatra_menu_item_variants')
      .select('id, menu_item_id, recipe_id, serving_quantity, serving_unit, is_default, is_active')
      .eq('is_active', true),
    supabase
      .from('yatra_combos_thalis')
      .select(`
        id, menu_item_id, name, is_active,
        components:yatra_combo_components(recipe_id, portion_quantity, portion_unit)
      `)
      .eq('is_active', true),
    supabase
      .from('yatra_recipes')
      .select('id, name, category, batch_yield_quantity, batch_yield_unit, portion_size_quantity, portion_size_unit, is_active')
      .eq('is_active', true),
    supabase
      .from('yatra_recipe_ingredients')
      .select('recipe_id, ingredient_type, ingredient_group_id, inventory_item_id, sub_recipe_id, quantity, unit'),
    supabase
      .from('yatra_ingredient_unit_conversions')
      .select('inventory_item_id, ingredient_group_id, from_unit, to_unit, multiplier'),
    supabase
      .from('inventory_items')
      .select(`
        id, item_code, name, brand_name, group_id, category_id, current_stock,
        preferred_stock, minimum_stock, max_stock_level, current_weighted_average_cost,
        is_costed, is_active, conversion_factor,
        unit:units!inventory_items_unit_id_fkey(symbol),
        secondary_unit:units!inventory_items_secondary_unit_id_fkey(symbol),
        category:inventory_categories!inventory_items_category_id_fkey(name)
      `)
      .eq('is_active', true),
  ]);

  const invItems = invRes.data || [];
  const invItemMap = new Map<string, any>(invItems.map((i: any) => [i.id, i]));
  const explicitConversions = (convRes.data || []) as ExplicitConversion[];

  // Build logical_ingredient_group -> primary active inventory item
  const itemsByGroup = new Map<string, any[]>();
  for (const item of invItems) {
    if (item.group_id) {
      const arr = itemsByGroup.get(item.group_id) || [];
      arr.push(item);
      itemsByGroup.set(item.group_id, arr);
    }
  }
  const primaryItemByGroup = new Map<string, any>();
  for (const [grpId, grpItems] of itemsByGroup.entries()) {
    const primary = pickPrimaryItemForGroup(grpItems);
    if (primary) primaryItemByGroup.set(grpId, primary);
  }

  // POS menu lookup comes from canonical active items + aliases + transitive merge logs
  const variantByMenuId = new Map<string, any>();
  for (const v of (variantRes.data || [])) {
    const existing = variantByMenuId.get(v.menu_item_id);
    if (!existing || v.is_default) {
      variantByMenuId.set(v.menu_item_id, v);
    }
  }

  // Combo map (menu_item_id -> combo)
  const comboByMenuId = new Map<string, any>();
  for (const c of (comboRes.data || [])) {
    if (c.menu_item_id) {
      comboByMenuId.set(c.menu_item_id, c);
    }
  }

  // Recipes & ingredients maps
  const recipeMap = new Map<string, any>((recipeRes.data || []).map((r: any) => [r.id, r]));
  const recipeIngredients = new Map<string, any[]>();
  for (const ing of (ingRes.data || [])) {
    const arr = recipeIngredients.get(ing.recipe_id) || [];
    arr.push(ing);
    recipeIngredients.set(ing.recipe_id, arr);
  }

  // Canonical dish fallback (name -> recipe) in case variant row is missing
  const recipeByName = new Map<string, any>();
  for (const r of (recipeRes.data || [])) {
    recipeByName.set(normalizeLookupKey(r.name), r);
  }

  const rawDemands = new Map<string, number>();
  const mappedDishNames = new Set<string>();

  function explodeRecipeBatches(recipeId: string, batches: number, depth: number = 0) {
    if (depth > 5 || batches <= 0) return;
    const ings = recipeIngredients.get(recipeId) || [];

    for (const ing of ings) {
      const scaledQty = Number(ing.quantity || 0) * batches;
      if (scaledQty <= 0) continue;

      if (ing.ingredient_type === 'RAW_MATERIAL') {
        const inv =
          (ing.inventory_item_id ? invItemMap.get(ing.inventory_item_id) : null) ||
          (ing.ingredient_group_id ? primaryItemByGroup.get(ing.ingredient_group_id) : null);

        if (!inv) continue;

        const invUnit =
          (Array.isArray(inv.unit) ? inv.unit[0]?.symbol : inv.unit?.symbol) || 'g';
        const secUnit = Array.isArray(inv.secondary_unit)
          ? inv.secondary_unit[0]?.symbol
          : inv.secondary_unit?.symbol;

        const converted = safeConvert(scaledQty, ing.unit, invUnit, {
          inventoryItemId: inv.id,
          ingredientGroupId: ing.ingredient_group_id,
          conversions: explicitConversions,
          pieceWeightGrams: inv.conversion_factor ? Number(inv.conversion_factor) : undefined,
          conversionFactor: inv.conversion_factor ? Number(inv.conversion_factor) : undefined,
          secondaryUnit: secUnit || undefined,
          baseUnit: invUnit,
          itemName: inv.name,
        });

        if (converted !== null && converted > 0) {
          rawDemands.set(inv.id, (rawDemands.get(inv.id) || 0) + converted);
        }
      } else if (ing.ingredient_type === 'PREPARATION' && ing.sub_recipe_id) {
        const subRec = recipeMap.get(ing.sub_recipe_id);
        if (!subRec) continue;

        const subYieldQty = Number(subRec.batch_yield_quantity || 0);
        if (subYieldQty <= 0) continue;

        const convertedToSubYield = safeConvert(scaledQty, ing.unit, subRec.batch_yield_unit);
        if (convertedToSubYield !== null && convertedToSubYield > 0) {
          const subBatches = convertedToSubYield / subYieldQty;
          explodeRecipeBatches(subRec.id, subBatches, depth + 1);
        }
      }
    }
  }

  function explodeRecipePortions(
    recipe: any,
    dishQty: number,
    overridePortionQty?: number | null,
    overridePortionUnit?: string | null
  ) {
    const yieldQty = Number(recipe.batch_yield_quantity || 0);
    if (yieldQty <= 0) return;

    const pQty = Number(
      overridePortionQty ?? recipe.portion_size_quantity ?? recipe.batch_yield_quantity ?? 1
    );
    const pUnit =
      overridePortionUnit || recipe.portion_size_unit || recipe.batch_yield_unit || 'pcs';

    // Handle discrete serving labels like 'portion' or 'serving' when recipe yields a single serving
    const normP = normalizeUnit(pUnit);
    const normY = normalizeUnit(recipe.batch_yield_unit);

    let batchesPerUnit = 0;
    if (
      ['pcs', 'serving', 'portion'].includes(normP) &&
      !['pcs', 'serving', 'portion'].includes(normY) &&
      recipe.portion_size_quantity &&
      Number(recipe.portion_size_quantity) > 0 &&
      recipe.portion_size_unit
    ) {
      // Serving measured via recipe portion_size_quantity * pQty portions
      const conv = safeConvert(
        pQty * Number(recipe.portion_size_quantity),
        recipe.portion_size_unit,
        recipe.batch_yield_unit
      );
      batchesPerUnit = conv !== null ? conv / yieldQty : 0;
    } else {
      const conv = safeConvert(pQty, pUnit, recipe.batch_yield_unit);
      batchesPerUnit = conv !== null ? conv / yieldQty : 0;
    }

    if (batchesPerUnit > 0) {
      explodeRecipeBatches(recipe.id, dishQty * batchesPerUnit, 1);
    }
  }

  for (const demand of dishDemands) {
    if (isNonFoodOrTestDishName(demand.dish_name, EXCLUDED_NON_RESTAURANT_ITEMS)) continue;
    const qty = Number(demand.predicted_quantity || 0);
    if (qty <= 0) continue;

    const menuItem = resolveCanonicalMenuItem(demand.dish_name, canonicalLookup);
    const resolvedDishName = menuItem?.name || demand.dish_name;
    const key = normalizeLookupKey(resolvedDishName);

    if (menuItem) {
      const combo = comboByMenuId.get(menuItem.id);
      if (combo && Array.isArray(combo.components) && combo.components.length > 0) {
        mappedDishNames.add(demand.dish_name);
        for (const comp of combo.components) {
          const rec = comp.recipe_id ? recipeMap.get(comp.recipe_id) : null;
          if (rec) {
            explodeRecipePortions(rec, qty, comp.portion_quantity, comp.portion_unit);
          }
        }
        continue;
      }

      const variant = variantByMenuId.get(menuItem.id);
      if (variant && variant.recipe_id) {
        const rec = recipeMap.get(variant.recipe_id);
        if (rec) {
          mappedDishNames.add(demand.dish_name);
          explodeRecipePortions(rec, qty, variant.serving_quantity, variant.serving_unit);
          continue;
        }
      }
    }

    // Fallback: direct recipe name match
    const directRecipe = recipeByName.get(key);
    if (directRecipe) {
      mappedDishNames.add(demand.dish_name);
      explodeRecipePortions(directRecipe, qty);
    }
  }

  return {
    rawDemands,
    invItems,
    invItemMap,
    mappedDishNames,
  };
}

/**
 * Traverses the 4-tier culinary DAG to explode dish demands into raw material purchase suggestions.
 */
export async function explodeBomDemands(
  supabase: SupabaseClient,
  dishDemands: DishDemandInput[],
  qtyConfidenceScore: number,
  canViewCosts: boolean = false
): Promise<PurchaseSuggestionItem[]> {
  const { rawDemands, invItems } = await explodeDishDemandsToRawMaterials(supabase, dishDemands);
  if (!invItems || invItems.length === 0) return [];

  const suggestions: PurchaseSuggestionItem[] = [];

  for (const inv of invItems) {
    const curStock = Number(inv.current_stock || 0);
    const par = Number(inv.preferred_stock || inv.minimum_stock || 0);
    const maxStock = inv.max_stock_level ? Number(inv.max_stock_level) : null;
    const wac = Number(inv.current_weighted_average_cost || 0);

    const bomQty = rawDemands.get(inv.id) || 0;
    let forecastDemandQty = 0;
    let demandSource: 'BOM_EXPLOSION' | 'STORE_HISTORY_FALLBACK' | 'HYBRID' = 'STORE_HISTORY_FALLBACK';

    if (bomQty > 0) {
      forecastDemandQty = round(bomQty, 2);
      demandSource = 'BOM_EXPLOSION';
    }

    // Purchase suggestion formula:
    // If confidence < 65% and item is perishable (has maxStock), bias conservatively toward min stock
    const effectiveTargetPar =
      qtyConfidenceScore < 65 && maxStock !== null
        ? Number(inv.minimum_stock || par)
        : par;

    let suggestedQty = Math.max(0, effectiveTargetPar + forecastDemandQty - curStock);

    // Perishable Cap Guardrail:
    if (maxStock !== null && maxStock > 0) {
      if (curStock + suggestedQty > maxStock) {
        suggestedQty = Math.max(0, maxStock - curStock);
      }
    }

    suggestedQty = round(suggestedQty, 2);

    if (suggestedQty > 0 || forecastDemandQty > 0) {
      const item: PurchaseSuggestionItem = {
        item_id: inv.id,
        item_code: inv.item_code || '',
        item_name: inv.name,
        category_name:
          (Array.isArray(inv.category) ? inv.category[0]?.name : inv.category?.name) || 'Store',
        unit_symbol: (Array.isArray(inv.unit) ? inv.unit[0]?.symbol : inv.unit?.symbol) || 'pcs',
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

  suggestions.sort((a, b) => {
    if (a.suggested_order_qty > 0 && b.suggested_order_qty <= 0) return -1;
    if (a.suggested_order_qty <= 0 && b.suggested_order_qty > 0) return 1;
    return b.forecast_demand_qty - a.forecast_demand_qty;
  });

  return suggestions;
}
