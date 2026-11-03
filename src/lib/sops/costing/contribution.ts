export interface RealizedContribution {
  unitContributionMargin: number;
  foodCostPct: number | null;
}

export function calculateRealizedContribution(
  unitsSold: number,
  netRevenue: number,
  sellingPrice: number,
  foodCost: number
): RealizedContribution {
  const units = Number(unitsSold) || 0;
  const realizedUnitRevenue = units > 0
    ? (Number(netRevenue) || 0) / units
    : Number(sellingPrice) || 0;

  return {
    unitContributionMargin: realizedUnitRevenue - foodCost,
    foodCostPct: realizedUnitRevenue > 0 ? (foodCost / realizedUnitRevenue) * 100 : null,
  };
}
