import {
  CostCalculationResult,
  CostingStatus,
  GroupWacResolution,
  YatraMenuItemVariant,
  YatraRecipe,
  YatraRecipeIngredient,
} from './types';
import { areUnitsCompatible, convertDirectQuantity, normalizeUnit, ExplicitConversion } from './units';

export interface PrepCostInfo {
  costPerOutputUnit: number | null;
  yieldUnit: string | null;
  status: CostingStatus;
}

export interface CalculationOptions {
  conversions?: ExplicitConversion[];
  outputConversions?: ExplicitConversion[];
}

/**
 * Calculates costing for a single recipe using pre-resolved preparation costs and group WACs.
 */
export function calculateRecipeCost(
  recipe: YatraRecipe,
  prepCostsMap: Map<string, PrepCostInfo>,
  groupWacMap: Map<string, GroupWacResolution>,
  options?: CalculationOptions
): CostCalculationResult {
  const reasons: string[] = [];
  let hasIncomplete = false;
  let hasUncosted = false;
  let totalBatchCost: number | null = 0;

  const ingredients = recipe.ingredients || [];
  const lineCosts: Array<{
    id?: string;
    lineCost: number | null;
    error: string | null;
    unitRate?: number | null;
    rateUnit?: string | null;
    status: CostingStatus;
  }> = [];

  // Structural check: 0 ingredients
  if (ingredients.length === 0) {
    hasIncomplete = true;
    reasons.push('No ingredients added to recipe');
    totalBatchCost = null;
  }

  for (const ing of ingredients) {
    if (ing.ingredient_type === 'RAW_MATERIAL') {
      const groupId = ing.ingredient_group_id || ing.ingredient_group?.id;
      const pinnedItemId = ing.inventory_item_id || ing.inventory_item?.id;

      if (!groupId) {
        hasIncomplete = true;
        const err = ing.notes && ing.notes.startsWith('UNRESOLVED_RAW_MATERIAL:')
          ? `Unresolved ingredient mapping: ${ing.notes.replace('UNRESOLVED_RAW_MATERIAL:', '').trim()}`
          : (ing.notes ? `Unresolved ingredient mapping: ${ing.notes}` : 'Recipe ingredient missing logical ingredient group mapping');
        reasons.push(err);
        lineCosts.push({ id: ing.id, lineCost: null, error: err, status: 'COSTING_INCOMPLETE' });
        totalBatchCost = null;
        continue;
      }

      let effectiveRate: number | null = null;
      let effectiveRateUnit = ing.unit;
      let isLineCosted = false;
      let lineUncostedReason = '';

      const wacRes = groupWacMap.get(groupId);

      if (pinnedItemId && ing.inventory_item) {
        const itemWac = Number(ing.inventory_item.current_weighted_average_cost || 0);
        const itemCosted = Boolean(ing.inventory_item.is_costed && itemWac > 0);
        const itemUnit = ing.inventory_item.unit?.symbol || ing.unit;

        if (itemCosted) {
          effectiveRate = itemWac;
          effectiveRateUnit = itemUnit;
          isLineCosted = true;
        } else {
          isLineCosted = false;
          lineUncostedReason = `Pinned brand variant '${ing.inventory_item.brand_name || ing.inventory_item.name}' is uncosted`;
        }
      } else {
        if (wacRes && wacRes.isCosted && wacRes.wac !== null && wacRes.wac > 0) {
          effectiveRate = wacRes.wac;
          effectiveRateUnit = wacRes.baseUnitSymbol;
          isLineCosted = true;
        } else {
          isLineCosted = false;
          lineUncostedReason = `Ingredient group '${ing.ingredient_group?.name || groupId}' is uncosted`;
          effectiveRateUnit = wacRes?.baseUnitSymbol || ing.unit;
        }
      }

      if (!isLineCosted || effectiveRate === null) {
        hasUncosted = true;
        reasons.push(lineUncostedReason);
        lineCosts.push({
          id: ing.id,
          lineCost: null,
          error: lineUncostedReason,
          unitRate: null,
          rateUnit: effectiveRateUnit,
          status: 'UNCOSTED',
        });
        totalBatchCost = null;
      } else {
        // Convert recipe usage quantity to effective rate unit using configured item/group conversion factor
        const pieceWeightGrams = ing.inventory_item?.conversion_factor
          ? Number(ing.inventory_item.conversion_factor)
          : (wacRes?.conversionFactor ? Number(wacRes.conversionFactor) : undefined);

        const conversion = convertDirectQuantity(ing.quantity, ing.unit, effectiveRateUnit, {
          inventoryItemId: pinnedItemId,
          ingredientGroupId: groupId,
          conversions: options?.conversions,
          pieceWeightGrams,
          itemName: ing.ingredient_group?.name || ing.inventory_item?.name,
        });
        if (!conversion.possible || conversion.converted === undefined) {
          hasIncomplete = true;
          const err = `Incompatible units for '${ing.ingredient_group?.name || groupId}': uses ${ing.unit}, but cost rate is per ${effectiveRateUnit}`;
          reasons.push(err);
          lineCosts.push({
            id: ing.id,
            lineCost: null,
            error: err,
            unitRate: effectiveRate,
            rateUnit: effectiveRateUnit,
            status: 'COSTING_INCOMPLETE',
          });
          totalBatchCost = null;
        } else {
          const cost = conversion.converted * effectiveRate;
          lineCosts.push({
            id: ing.id,
            lineCost: cost,
            error: null,
            unitRate: effectiveRate,
            rateUnit: effectiveRateUnit,
            status: 'COSTED_ELIGIBLE',
          });
          if (totalBatchCost !== null) {
            totalBatchCost += cost;
          }
        }
      }
    } else if (ing.ingredient_type === 'PREPARATION') {
      const subId = ing.sub_recipe_id || ing.sub_recipe?.id;
      const prepInfo = subId ? prepCostsMap.get(subId) : null;
      const prepName = ing.sub_recipe?.name || 'Sub-preparation';

      if (!subId || !prepInfo) {
        hasIncomplete = true;
        const err = `Sub-preparation '${prepName}' not found or unresolved`;
        reasons.push(err);
        lineCosts.push({ id: ing.id, lineCost: null, error: err, status: 'COSTING_INCOMPLETE' });
        totalBatchCost = null;
      } else if (prepInfo.status === 'COSTING_INCOMPLETE' || !prepInfo.yieldUnit) {
        hasIncomplete = true;
        const err = `Preparation '${prepName}' is structurally incomplete`;
        reasons.push(err);
        lineCosts.push({
          id: ing.id,
          lineCost: null,
          error: err,
          unitRate: null,
          rateUnit: prepInfo.yieldUnit ?? null,
          status: 'COSTING_INCOMPLETE',
        });
        totalBatchCost = null;
      } else if (prepInfo.status === 'UNCOSTED' || prepInfo.costPerOutputUnit === null) {
        hasUncosted = true;
        const err = `Preparation '${prepName}' is uncosted`;
        reasons.push(err);
        lineCosts.push({
          id: ing.id,
          lineCost: null,
          error: err,
          unitRate: null,
          rateUnit: prepInfo.yieldUnit,
          status: 'UNCOSTED',
        });
        totalBatchCost = null;
      } else {
        // Convert usage quantity to preparation's finished yield unit
        const conversion = convertDirectQuantity(ing.quantity, ing.unit, prepInfo.yieldUnit);
        if (!conversion.possible || conversion.converted === undefined) {
          hasIncomplete = true;
          const err = `Incompatible units for preparation '${prepName}': recipe uses '${ing.unit}', yield is in '${prepInfo.yieldUnit}'`;
          reasons.push(err);
          lineCosts.push({
            id: ing.id,
            lineCost: null,
            error: err,
            unitRate: prepInfo.costPerOutputUnit,
            rateUnit: prepInfo.yieldUnit,
            status: 'COSTING_INCOMPLETE',
          });
          totalBatchCost = null;
        } else {
          const cost = conversion.converted * prepInfo.costPerOutputUnit;
          lineCosts.push({
            id: ing.id,
            lineCost: cost,
            error: null,
            unitRate: prepInfo.costPerOutputUnit,
            rateUnit: prepInfo.yieldUnit,
            status: 'COSTED_ELIGIBLE',
          });
          if (totalBatchCost !== null) {
            totalBatchCost += cost;
          }
        }
      }
    }
  }

  // Finished Yield Validation
  if (
    recipe.batch_yield_quantity === null ||
    recipe.batch_yield_quantity === undefined ||
    Number(recipe.batch_yield_quantity) <= 0
  ) {
    hasIncomplete = true;
    reasons.push('Missing or zero finished batch yield');
  }

  if (!recipe.batch_yield_unit) {
    hasIncomplete = true;
    reasons.push('Missing finished batch yield unit');
  }

  let costPerOutputUnit: number | null = null;
  let costPerServing: number | null = null;
  let servingsPerBatch: number | null = null;

  // Finished Batch Output Rates
  const yieldQty = Number(recipe.batch_yield_quantity || 0);

  if (recipe.category === 'PREPARATION' || recipe.category === 'COMBO_PORTION' || recipe.category === 'BULK_CATERING') {
    if (!hasIncomplete && !hasUncosted && totalBatchCost !== null && yieldQty > 0) {
      costPerOutputUnit = totalBatchCost / yieldQty;
    }
  } else if (recipe.category === 'FINAL_DISH') {
    // Requires portion size
    const portionQty = Number(recipe.portion_size_quantity || 0);
    const portionUnit = recipe.portion_size_unit;

    if (portionQty <= 0) {
      hasIncomplete = true;
      reasons.push('Missing or zero portion size');
    }
    if (!portionUnit) {
      hasIncomplete = true;
      reasons.push('Missing portion size unit');
    }

    if (yieldQty > 0 && recipe.batch_yield_unit && portionQty > 0 && portionUnit) {
      const conv = convertDirectQuantity(portionQty, portionUnit, recipe.batch_yield_unit);
      if (!conv.possible || conv.converted === undefined || conv.converted <= 0) {
        hasIncomplete = true;
        reasons.push(
          `Incompatible yield and portion units: Yield is in '${recipe.batch_yield_unit}', portion is in '${portionUnit}'`
        );
      } else {
        const portionInYieldUnit = conv.converted;
        servingsPerBatch = yieldQty / portionInYieldUnit;

        if (!hasIncomplete && !hasUncosted && totalBatchCost !== null && servingsPerBatch > 0) {
          costPerServing = (totalBatchCost / yieldQty) * portionInYieldUnit;
        }
      }
    }
  }

  // Determine overall costing status
  let overallStatus: CostingStatus = 'COSTED_ELIGIBLE';
  if (hasIncomplete) {
    overallStatus = 'COSTING_INCOMPLETE';
  } else if (hasUncosted || totalBatchCost === null) {
    overallStatus = 'UNCOSTED';
  } else if (recipe.category === 'FINAL_DISH' && costPerServing === null) {
    overallStatus = 'COSTING_INCOMPLETE';
  } else if (
    (recipe.category === 'PREPARATION' || recipe.category === 'COMBO_PORTION') &&
    costPerOutputUnit === null
  ) {
    overallStatus = 'COSTING_INCOMPLETE';
  }

  const uniqueReasons = Array.from(new Set(reasons));

  const resolvedIngredients: YatraRecipeIngredient[] = (recipe.ingredients || []).map((ing) => {
    const line = lineCosts.find((l) => l.id === ing.id);
    return {
      ...ing,
      line_cost: line?.lineCost ?? null,
      unit_rate: line?.unitRate ?? null,
      rate_unit: line?.rateUnit ?? null,
      status: line?.status ?? 'UNCOSTED',
      error: line?.error ?? null,
    };
  });

  return {
    recipe: {
      ...recipe,
      total_batch_cost: totalBatchCost,
      cost_per_output_unit: costPerOutputUnit,
      cost_per_serving: costPerServing,
      servings_per_batch: servingsPerBatch,
      status: overallStatus,
      incomplete_reasons: uniqueReasons,
      ingredients: resolvedIngredients,
    },
    totalBatchCost,
    costPerOutputUnit,
    output_unit: recipe.batch_yield_unit || null,
    costPerServing,
    serving_unit: recipe.portion_size_unit || null,
    servingsPerBatch,
    status: overallStatus,
    reasons: uniqueReasons,
    ingredientLineCosts: lineCosts,
  };
}

/**
 * Calculates costing for a specific menu item variant, applying serving size overrides
 * and service channel operating/packaging allocations.
 */
export function calculateVariantCost(
  variant: YatraMenuItemVariant,
  recipeCalc: CostCalculationResult,
  channel?: 'DINE_IN' | 'TAKEAWAY'
): YatraMenuItemVariant {
  const activeChannel = channel || variant.default_service_channel || 'DINE_IN';
  const recipe = recipeCalc.recipe;
  const incompleteReasons: string[] = [...(recipe.incomplete_reasons || [])];

  let foodCost: number | null = null;

  if (recipeCalc.status === 'COSTING_INCOMPLETE') {
    incompleteReasons.push('Recipe is structurally incomplete');
  } else if (recipeCalc.status === 'UNCOSTED' || recipeCalc.totalBatchCost === null) {
    incompleteReasons.push('Recipe contains uncosted ingredients');
  } else {
    // Paired-Null Contract:
    // Case 1: Both null -> inherit recipe default
    // Case 2: Both provided -> explicit variant override
    // Case 3: Partial null -> invalid state error
    const hasVariantQty = variant.serving_quantity !== null && variant.serving_quantity !== undefined;
    const hasVariantUnit = variant.serving_unit !== null && variant.serving_unit !== undefined && String(variant.serving_unit).trim() !== '';

    let servingQty: number | null = null;
    let servingUnit: string | null = null;

    if (!hasVariantQty && !hasVariantUnit) {
      // Inherit recipe defaults
      servingQty = recipe.portion_size_quantity != null ? Number(recipe.portion_size_quantity) : null;
      servingUnit = recipe.portion_size_unit || null;
    } else if (hasVariantQty && hasVariantUnit) {
      // Explicit override
      servingQty = Number(variant.serving_quantity);
      servingUnit = String(variant.serving_unit).trim();
    } else {
      // Inconsistent partial null
      incompleteReasons.push(
        'Variant has an inconsistent partial portion specification (quantity and unit must both be provided or both omitted)'
      );
    }

    if (servingQty === null || servingQty <= 0 || !servingUnit) {
      incompleteReasons.push('Missing or invalid variant serving specification');
    } else if (recipe.batch_yield_quantity && recipe.batch_yield_unit) {
      const conv = convertDirectQuantity(servingQty, servingUnit, recipe.batch_yield_unit);
      if (!conv.possible || conv.converted === undefined) {
        incompleteReasons.push(
          `Cannot convert variant serving '${servingQty} ${servingUnit}' to recipe yield unit '${recipe.batch_yield_unit}'`
        );
      } else {
        const servingsInBatch = Number(recipe.batch_yield_quantity) / conv.converted;
        if (servingsInBatch > 0 && recipeCalc.totalBatchCost !== null) {
          foodCost = recipeCalc.totalBatchCost / servingsInBatch;
        }
      }
    } else {
      incompleteReasons.push('Missing recipe finished batch yield specs');
    }
  }

  // Operating costs: Gas allocation + other operating
  const gasCost = Number(variant.gas_cost || 0);
  const otherOpCost = Number(variant.other_operating_cost || 0);
  const operatingCost = gasCost + otherOpCost;

  // Packaging cost for active channel
  const packagingCost =
    activeChannel === 'TAKEAWAY'
      ? Number(variant.packaging_cost_takeaway || 0)
      : Number(variant.packaging_cost_dine_in || 0);

  const totalCost = foodCost !== null ? foodCost + operatingCost + packagingCost : null;

  const sellingPrice = Number(variant.menu_item?.price || 0);
  let foodCostPct: number | null = null;
  let marginAmount: number | null = null;
  let contributionAmount: number | null = null;
  let contributionPct: number | null = null;

  if (sellingPrice > 0) {
    if (foodCost !== null) {
      foodCostPct = (foodCost / sellingPrice) * 100;
      marginAmount = sellingPrice - foodCost;
    }
    if (totalCost !== null) {
      contributionAmount = sellingPrice - totalCost;
      contributionPct = (contributionAmount / sellingPrice) * 100;
    }
  }

  let costingStatus: CostingStatus = 'COSTED_ELIGIBLE';
  if (recipeCalc.status === 'COSTING_INCOMPLETE' || incompleteReasons.some((r) => r.includes('incomplete') || r.includes('Missing'))) {
    costingStatus = 'COSTING_INCOMPLETE';
  } else if (recipeCalc.status === 'UNCOSTED' || foodCost === null) {
    costingStatus = 'UNCOSTED';
  }

  return {
    ...variant,
    default_service_channel: activeChannel,
    food_cost: foodCost,
    food_cost_pct: foodCostPct,
    margin_amount: marginAmount,
    operating_cost: operatingCost,
    packaging_cost: packagingCost,
    total_cost: totalCost,
    contribution_amount: contributionAmount,
    contribution_pct: contributionPct,
    costing_status: costingStatus,
    incomplete_reasons: Array.from(new Set(incompleteReasons)),
  };
}

/**
 * Calculates all recipes in topological dependency order (handling multi-tier preparations).
 */
export function calculateAllRecipes(
  recipes: YatraRecipe[],
  groupWacMap: Map<string, GroupWacResolution>,
  options?: CalculationOptions
): Map<string, CostCalculationResult> {
  const results = new Map<string, CostCalculationResult>();
  const prepCostsMap = new Map<string, PrepCostInfo>();
  const recipeMap = new Map<string, YatraRecipe>(recipes.map((r) => [r.id, r]));

  // Build dependency graph
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>(); // prepId -> list of dependent recipeIds

  for (const r of recipes) {
    inDegree.set(r.id, 0);
    graph.set(r.id, []);
  }

  for (const r of recipes) {
    const deps = new Set<string>();
    for (const ing of r.ingredients || []) {
      if (ing.ingredient_type === 'PREPARATION' && (ing.sub_recipe_id || ing.sub_recipe?.id)) {
        const subId = (ing.sub_recipe_id || ing.sub_recipe?.id)!;
        if (recipeMap.has(subId)) {
          deps.add(subId);
        }
      }
    }

    inDegree.set(r.id, deps.size);
    for (const depId of deps) {
      if (!graph.has(depId)) graph.set(depId, []);
      graph.get(depId)!.push(r.id);
    }
  }

  // Queue of recipes with in-degree 0 (no unresolved sub-preparations)
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  let processedCount = 0;

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    processedCount++;
    const recipe = recipeMap.get(currentId)!;

    const calcResult = calculateRecipeCost(recipe, prepCostsMap, groupWacMap, options);
    results.set(currentId, calcResult);

    // If it's a preparation or combo portion, record its rate in prepCostsMap
    if (recipe.category === 'PREPARATION' || recipe.category === 'COMBO_PORTION' || recipe.category === 'BULK_CATERING') {
      prepCostsMap.set(currentId, {
        costPerOutputUnit: calcResult.costPerOutputUnit,
        yieldUnit: recipe.batch_yield_unit,
        status: calcResult.status,
      });
    }

    for (const dependentId of graph.get(currentId) || []) {
      const currentDeg = (inDegree.get(dependentId) || 1) - 1;
      inDegree.set(dependentId, currentDeg);
      if (currentDeg === 0) {
        queue.push(dependentId);
      }
    }
  }

  // If there are unprocessed recipes, a cycle exists
  if (processedCount < recipes.length) {
    for (const r of recipes) {
      if (!results.has(r.id)) {
        results.set(r.id, {
          recipe: {
            ...r,
            status: 'COSTING_INCOMPLETE',
            incomplete_reasons: ['Circular recipe dependency detected'],
          },
          totalBatchCost: null,
          costPerOutputUnit: null,
          output_unit: r.batch_yield_unit || null,
          costPerServing: null,
          serving_unit: r.portion_size_unit || null,
          servingsPerBatch: null,
          status: 'COSTING_INCOMPLETE',
          reasons: ['Circular recipe dependency detected'],
          ingredientLineCosts: [],
        });
      }
    }
  }

  return results;
}

/**
 * 4-Tier Native Culinary Serving Cost Formula:
 * Serving Cost = (Batch Cost / Usable Finished Batch Yield) * Portion Size (in yield unit)
 */
export function calculateServingConfigurationCost(
  batchCost: number | null,
  batchYieldQty: number,
  batchYieldUnit: string,
  portionQty: number,
  portionUnit: string,
  options?: CalculationOptions
): {
  servingCost: number | null;
  status: CostingStatus;
  error: string | null;
} {
  if (batchCost === null || batchCost === undefined || isNaN(batchCost)) {
    return { servingCost: null, status: 'UNCOSTED', error: 'Batch cost is uncosted' };
  }
  if (!batchYieldQty || batchYieldQty <= 0 || !batchYieldUnit) {
    return { servingCost: null, status: 'COSTING_INCOMPLETE', error: 'Missing or zero finished batch yield' };
  }
  if (!portionQty || portionQty <= 0 || !portionUnit) {
    return { servingCost: null, status: 'COSTING_INCOMPLETE', error: 'Missing or zero portion size' };
  }

  const conv = convertDirectQuantity(portionQty, portionUnit, batchYieldUnit, {
    outputConversions: options?.outputConversions,
  });

  if (!conv.possible || conv.converted === undefined || conv.converted <= 0) {
    return {
      servingCost: null,
      status: 'COSTING_INCOMPLETE',
      error: `Incompatible yield and portion units: Yield is in '${batchYieldUnit}', portion is in '${portionUnit}'`,
    };
  }

  const servingCost = (batchCost / batchYieldQty) * conv.converted;
  return { servingCost, status: 'COSTED_ELIGIBLE', error: null };
}
