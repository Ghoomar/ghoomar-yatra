import {
  CostingStatus,
  MatrixState,
  MenuEngineeringItemMetrics,
  MenuEngineeringMatrixResult,
  MenuMatrixQuadrant,
} from './types';
import { calculateRealizedContribution } from './contribution';

export interface RawMenuItemForMatrix {
  menuItemId: string;
  name: string;
  nameHi?: string | null;
  category: string;
  parentCategory?: string;
  sellingPrice: number;
  costingStatus: CostingStatus;
  defaultVariantName?: string;
  foodCost: number | null;
  unitsSold: number;
  netRevenue: number;
}

/**
 * Calculates menu engineering matrix metrics and classifies sellable POS menu items into:
 * - STAR: High Popularity, High Contribution Margin
 * - PLOWHORSE: High Popularity, Low Contribution Margin
 * - PUZZLE: Low Popularity, High Contribution Margin
 * - DOG: Low Popularity, Low Contribution Margin
 * - UNCOSTED / COSTING_INCOMPLETE / INELIGIBLE / null (when sales data or costed sales are unavailable)
 */
export function calculateMenuEngineeringMatrix(
  items: RawMenuItemForMatrix[]
): MenuEngineeringMatrixResult {
  const totalItemsCount = items.length;
  const totalUnitsSold = items.reduce((sum, item) => sum + (Number(item.unitsSold) || 0), 0);
  const totalNetRevenue = items.reduce((sum, item) => sum + (Number(item.netRevenue) || 0), 0);

  // Popularity Threshold: (100% / N_items) * 0.70 across all active sellable items in group
  const popularityThresholdPct = totalItemsCount > 0 ? (100 / totalItemsCount) * 0.7 : 0;

  // Filter COSTED_ELIGIBLE items to compute sales-weighted contribution threshold
  const costedEligibleItems = items.filter(
    (item) => item.costingStatus === 'COSTED_ELIGIBLE' && item.foodCost !== null && item.sellingPrice > 0
  );

  let totalEligibleContribution = 0;
  let totalEligibleUnitsSold = 0;

  for (const item of costedEligibleItems) {
    const units = Number(item.unitsSold) || 0;
    if (units > 0) {
      // Use recorded transaction revenue so discounts and channel pricing are
      // reflected in the period's actual costed contribution benchmark.
      const contribution = calculateRealizedContribution(
        units,
        item.netRevenue,
        item.sellingPrice,
        item.foodCost || 0
      );
      totalEligibleContribution += contribution.unitContributionMargin * units;
      totalEligibleUnitsSold += units;
    }
  }

  // Determine matrix state and contribution threshold
  let matrixState: MatrixState = 'ACTIVE';
  let salesWeightedContributionThreshold: number | null = null;

  if (totalUnitsSold === 0) {
    matrixState = 'NO_SALES_DATA';
    salesWeightedContributionThreshold = null;
  } else if (totalEligibleUnitsSold === 0) {
    matrixState = 'NO_ELIGIBLE_COSTED_SALES';
    salesWeightedContributionThreshold = null;
  } else {
    // Strictly sales-weighted across COSTED_ELIGIBLE items with positive sales volume
    salesWeightedContributionThreshold = totalEligibleContribution / totalEligibleUnitsSold;
  }

  // Classify each item
  const classifiedItems: MenuEngineeringItemMetrics[] = items.map((item) => {
    const units = Number(item.unitsSold) || 0;
    const salesMixPct = totalUnitsSold > 0 ? (units / totalUnitsSold) * 100 : 0;

    const isCostedEligible =
      item.costingStatus === 'COSTED_ELIGIBLE' && item.foodCost !== null && item.sellingPrice > 0;

    let foodCostPct: number | null = null;
    let unitContributionMargin: number | null = null;
    let quadrant: MenuMatrixQuadrant | null = null;

    if (item.costingStatus === 'COSTING_INCOMPLETE') {
      quadrant = 'COSTING_INCOMPLETE';
    } else if (item.costingStatus === 'INELIGIBLE') {
      quadrant = 'INELIGIBLE';
    } else if (!isCostedEligible) {
      quadrant = 'UNCOSTED';
    } else {
      const contribution = calculateRealizedContribution(
        units,
        item.netRevenue,
        item.sellingPrice,
        item.foodCost!
      );
      unitContributionMargin = contribution.unitContributionMargin;
      foodCostPct = contribution.foodCostPct;

      // Assign BCG quadrants only when matrix is ACTIVE and threshold is strictly non-null
      if (matrixState === 'ACTIVE' && salesWeightedContributionThreshold !== null) {
        const isHighPopularity = salesMixPct >= popularityThresholdPct;
        const isHighContribution = unitContributionMargin >= salesWeightedContributionThreshold;

        if (isHighPopularity && isHighContribution) {
          quadrant = 'STAR';
        } else if (isHighPopularity && !isHighContribution) {
          quadrant = 'PLOWHORSE';
        } else if (!isHighPopularity && isHighContribution) {
          quadrant = 'PUZZLE';
        } else {
          quadrant = 'DOG';
        }
      } else {
        // When in NO_SALES_DATA or NO_ELIGIBLE_COSTED_SALES, assign NO BCG profitability quadrants
        quadrant = null;
      }
    }

    return {
      menuItemId: item.menuItemId,
      name: item.name,
      nameHi: item.nameHi,
      category: item.category,
      parentCategory: item.parentCategory,
      sellingPrice: item.sellingPrice,
      costingStatus: item.costingStatus,
      defaultVariantName: item.defaultVariantName,
      foodCost: isCostedEligible ? item.foodCost : null,
      foodCostPct,
      unitContributionMargin,
      unitsSold: units,
      netRevenue: Number(item.netRevenue) || 0,
      salesMixPct,
      isEligibleForMatrix: isCostedEligible && matrixState === 'ACTIVE',
      quadrant,
      popularityThresholdPct,
      contributionThreshold: salesWeightedContributionThreshold,
    };
  });

  return {
    items: classifiedItems,
    totalUnitsSold,
    totalNetRevenue,
    popularityThresholdPct,
    salesWeightedContributionThreshold,
    eligibleItemsCount: costedEligibleItems.length,
    totalItemsCount,
    state: matrixState,
  };
}
