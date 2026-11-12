import { CostCalculationResult, CostingStatus, ServiceChannel, YatraComboComponent, YatraComboThali } from './types';
import { convertDirectQuantity, normalizeUnit } from './units';

/**
 * Calculates costing and profitability metrics for a single Combo or Thali.
 * Strictly separates Food Cost from Operating Cost (Gas) and Packaging (Dine-in vs. Takeaway).
 */
export function calculateComboThaliCost(
  combo: YatraComboThali,
  recipeCostsMap: Map<string, CostCalculationResult>,
  channel?: ServiceChannel
): YatraComboThali {
  const activeChannel: ServiceChannel = channel || combo.default_service_channel || 'DINE_IN';
  const incompleteReasons: string[] = [];
  let hasIncomplete = false;
  let hasUncosted = false;

  const components = combo.components || [];
  if (components.length === 0) {
    hasIncomplete = true;
    incompleteReasons.push('No components added to combo/thali');
  }

  let totalFoodCost: number | null = 0;

  const resolvedComponents: YatraComboComponent[] = components.map((comp) => {
    if (!comp.recipe_id) {
      hasIncomplete = true;
      const err = `Component '${comp.component_name}' has no linked recipe`;
      incompleteReasons.push(err);
      return {
        ...comp,
        recipe: null,
        food_cost: null,
        unit_rate: null,
        rate_unit: null,
        error: err,
      };
    }

    const recipeCalc = recipeCostsMap.get(comp.recipe_id);
    if (!recipeCalc) {
      hasIncomplete = true;
      const err = `Component '${comp.component_name}': linked recipe not found`;
      incompleteReasons.push(err);
      return {
        ...comp,
        recipe: null,
        food_cost: null,
        unit_rate: null,
        rate_unit: null,
        error: err,
      };
    }

    const recipe = recipeCalc.recipe;

    // Validate that variant belongs to this recipe if variant_id is specified
    if (comp.variant_id && comp.variant) {
      if (comp.variant.recipe_id !== comp.recipe_id) {
        hasIncomplete = true;
        const err = `Component '${comp.component_name}': variant does not belong to recipe '${recipe.name}'`;
        incompleteReasons.push(err);
        return {
          ...comp,
          recipe,
          food_cost: null,
          unit_rate: null,
          rate_unit: null,
          error: err,
        };
      }
    }

    if (recipeCalc.status === 'COSTING_INCOMPLETE') {
      hasIncomplete = true;
      const msg = recipeCalc.reasons.length > 0 ? recipeCalc.reasons.join(', ') : 'Recipe incomplete';
      const err = `Component '${comp.component_name}': recipe '${recipe.name}' is incomplete (${msg})`;
      incompleteReasons.push(err);
      return {
        ...comp,
        recipe,
        food_cost: null,
        unit_rate: null,
        rate_unit: recipe.batch_yield_unit,
        error: err,
      };
    }

    if (recipeCalc.status === 'UNCOSTED' || recipeCalc.totalBatchCost === null) {
      hasUncosted = true;
      const err = `Component '${comp.component_name}': recipe '${recipe.name}' contains uncosted ingredients`;
      incompleteReasons.push(err);
      return {
        ...comp,
        recipe,
        food_cost: null,
        unit_rate: null,
        rate_unit: recipe.batch_yield_unit,
        error: err,
      };
    }

    // Recipe is costed. Calculate portion cost.
    let compCost: number | null = null;
    let unitRate: number | null = null;
    let rateUnit: string | null = null;
    let error: string | null = null;

    if (recipe.category === 'PREPARATION' || recipe.category === 'COMBO_PORTION' || recipe.category === 'BULK_CATERING') {
      unitRate = recipeCalc.costPerOutputUnit;
      rateUnit = recipe.batch_yield_unit;

      if (unitRate === null || !rateUnit) {
        hasIncomplete = true;
        error = `Recipe '${recipe.name}' missing output unit rate`;
        incompleteReasons.push(error);
      } else {
        const conv = convertDirectQuantity(comp.portion_quantity, comp.portion_unit, rateUnit);
        if (!conv.possible || conv.converted === undefined) {
          hasIncomplete = true;
          error = `Incompatible units for component '${comp.component_name}': uses '${comp.portion_unit}', but recipe yield is in '${rateUnit}'`;
          incompleteReasons.push(error);
        } else {
          compCost = conv.converted * unitRate;
        }
      }
    } else if (recipe.category === 'FINAL_DISH') {
      const portionNorm = normalizeUnit(comp.portion_unit);
      if (['portion', 'serving', 'pcs', 'unit'].includes(portionNorm)) {
        unitRate = recipeCalc.costPerServing;
        rateUnit = 'serving';
        if (unitRate === null) {
          hasIncomplete = true;
          error = `Dish '${recipe.name}' missing cost per serving`;
          incompleteReasons.push(error);
        } else {
          compCost = comp.portion_quantity * unitRate;
        }
      } else if (recipe.portion_size_quantity && recipe.portion_size_unit) {
        const conv = convertDirectQuantity(comp.portion_quantity, comp.portion_unit, recipe.portion_size_unit);
        if (conv.possible && conv.converted !== undefined && recipeCalc.costPerServing !== null) {
          const ratio = conv.converted / Number(recipe.portion_size_quantity);
          compCost = ratio * recipeCalc.costPerServing;
          unitRate = recipeCalc.costPerServing;
          rateUnit = `${recipe.portion_size_quantity} ${recipe.portion_size_unit}`;
        } else {
          hasIncomplete = true;
          error = `Cannot convert portion '${comp.portion_quantity} ${comp.portion_unit}' to dish portion '${recipe.portion_size_quantity} ${recipe.portion_size_unit}'`;
          incompleteReasons.push(error);
        }
      } else {
        hasIncomplete = true;
        error = `Dish '${recipe.name}' has no portion size configured`;
        incompleteReasons.push(error);
      }
    }

    if (compCost === null) {
      totalFoodCost = null;
    } else if (totalFoodCost !== null) {
      totalFoodCost += compCost;
    }

    return {
      ...comp,
      recipe,
      food_cost: compCost,
      unit_rate: unitRate,
      rate_unit: rateUnit,
      error,
    };
  });

  const effectiveSellingPrice = Number(combo.menu_item?.price ?? combo.selling_price ?? 0);

  // Operational costs: Gas allocation + other operating
  const gasCost = Number(combo.gas_cost || 0);
  const otherOpCost = Number(combo.other_operating_cost || 0);
  const operatingCost = gasCost + otherOpCost;

  // Packaging cost for active channel
  const packagingCost =
    activeChannel === 'TAKEAWAY'
      ? Number(combo.packaging_cost_takeaway || 0)
      : Number(combo.packaging_cost_dine_in || 0);

  const totalCost = totalFoodCost !== null ? totalFoodCost + operatingCost + packagingCost : null;

  let foodCostPct: number | null = null;
  let marginAmount: number | null = null;
  let contributionAmount: number | null = null;
  let contributionPct: number | null = null;

  if (effectiveSellingPrice > 0) {
    if (totalFoodCost !== null) {
      foodCostPct = (totalFoodCost / effectiveSellingPrice) * 100;
      marginAmount = effectiveSellingPrice - totalFoodCost;
    }
    if (totalCost !== null) {
      contributionAmount = effectiveSellingPrice - totalCost;
      contributionPct = (contributionAmount / effectiveSellingPrice) * 100;
    }
  }

  let status: CostingStatus = 'COSTED_ELIGIBLE';
  if (hasIncomplete || components.length === 0) {
    status = 'COSTING_INCOMPLETE';
  } else if (hasUncosted || totalFoodCost === null) {
    status = 'UNCOSTED';
  }

  return {
    ...combo,
    default_service_channel: activeChannel,
    components: resolvedComponents,
    total_food_cost: totalFoodCost,
    food_cost: totalFoodCost,
    operating_cost: operatingCost,
    packaging_cost: packagingCost,
    total_cost: totalCost,
    food_cost_pct: foodCostPct,
    margin_amount: marginAmount,
    contribution_amount: contributionAmount,
    contribution_pct: contributionPct,
    status,
    costing_status: status,
    incomplete_reasons: Array.from(new Set(incompleteReasons)),
  };
}

/**
 * 4-Tier Native Culinary Combo & Thali Costing:
 * Total Composition Food Cost = SUM ( Serving Cost of Default Formulation for Config_i * Component Quantity_i )
 * Total Commercial Product Cost = Total Composition Food Cost + Gas Cost + Other Operating Cost + Packaging Cost
 * Contribution Margin = Selling Price - Total Commercial Product Cost
 */
export interface CompositionInput {
  component_dish_id: string;
  serving_configuration_id: string;
  quantity: number;
  serving_cost: number | null;
  status: CostingStatus;
  dish_name?: string;
  configuration_name?: string;
}

export function calculateMenuItemCompositionCost(
  compositions: CompositionInput[],
  commercialParams: {
    price: number;
    gas_cost?: number;
    other_operating_cost?: number;
    packaging_cost?: number;
  }
): {
  totalFoodCost: number | null;
  operatingCost: number;
  packagingCost: number;
  totalCost: number | null;
  foodCostPct: number | null;
  marginAmount: number | null;
  contributionAmount: number | null;
  contributionPct: number | null;
  status: CostingStatus;
  incompleteReasons: string[];
} {
  const reasons: string[] = [];
  let hasIncomplete = false;
  let hasUncosted = false;

  if (!compositions || compositions.length === 0) {
    return {
      totalFoodCost: null,
      operatingCost: (commercialParams.gas_cost || 0) + (commercialParams.other_operating_cost || 0),
      packagingCost: commercialParams.packaging_cost || 0,
      totalCost: null,
      foodCostPct: null,
      marginAmount: null,
      contributionAmount: null,
      contributionPct: null,
      status: 'COSTING_INCOMPLETE',
      incompleteReasons: ['No compositions linked to combo/thali'],
    };
  }

  let totalFoodCost: number | null = 0;

  for (const comp of compositions) {
    if (comp.status === 'COSTING_INCOMPLETE' || comp.serving_cost === null && comp.status !== 'UNCOSTED') {
      hasIncomplete = true;
      reasons.push(`Component '${comp.dish_name || comp.component_dish_id}' configuration is incomplete`);
      totalFoodCost = null;
    } else if (comp.status === 'UNCOSTED' || comp.serving_cost === null) {
      hasUncosted = true;
      reasons.push(`Component '${comp.dish_name || comp.component_dish_id}' is uncosted`);
      totalFoodCost = null;
    } else if (totalFoodCost !== null) {
      totalFoodCost += comp.serving_cost * (comp.quantity || 1);
    }
  }

  const gasCost = Number(commercialParams.gas_cost || 0);
  const otherOpCost = Number(commercialParams.other_operating_cost || 0);
  const operatingCost = gasCost + otherOpCost;
  const packagingCost = Number(commercialParams.packaging_cost || 0);

  const totalCost = totalFoodCost !== null ? totalFoodCost + operatingCost + packagingCost : null;
  const price = Number(commercialParams.price || 0);

  let foodCostPct: number | null = null;
  let marginAmount: number | null = null;
  let contributionAmount: number | null = null;
  let contributionPct: number | null = null;

  if (price > 0) {
    if (totalFoodCost !== null) {
      foodCostPct = (totalFoodCost / price) * 100;
      marginAmount = price - totalFoodCost;
    }
    if (totalCost !== null) {
      contributionAmount = price - totalCost;
      contributionPct = (contributionAmount / price) * 100;
    }
  }

  let status: CostingStatus = 'COSTED_ELIGIBLE';
  if (hasIncomplete) {
    status = 'COSTING_INCOMPLETE';
  } else if (hasUncosted || totalFoodCost === null) {
    status = 'UNCOSTED';
  }

  return {
    totalFoodCost,
    operatingCost,
    packagingCost,
    totalCost,
    foodCostPct,
    marginAmount,
    contributionAmount,
    contributionPct,
    status,
    incompleteReasons: Array.from(new Set(reasons)),
  };
}
