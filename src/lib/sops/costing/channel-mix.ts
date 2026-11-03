import type { CostingStatus, YatraMenuItemVariant } from './types';

const WEIGHTED_COST_FIELDS = [
  'food_cost',
  'food_cost_pct',
  'margin_amount',
  'operating_cost',
  'packaging_cost',
  'total_cost',
  'contribution_amount',
  'contribution_pct',
] as const;

export interface WeightedVariantCost {
  units: number;
  variant: YatraMenuItemVariant;
}

/**
 * Blends existing per-service-channel variant costs using the actual sold units.
 * Missing or incomplete cost in any channel with sales keeps the blended item
 * out of the profitability benchmark.
 */
export function calculateSalesWeightedVariantCost(
  candidates: WeightedVariantCost[],
  fallback: YatraMenuItemVariant
): YatraMenuItemVariant {
  const active = candidates.filter(({ units }) => Number.isFinite(units) && units > 0);
  if (active.length === 0) return fallback;

  const totalUnits = active.reduce((sum, candidate) => sum + candidate.units, 0);
  const statusOrder: CostingStatus[] = ['COSTING_INCOMPLETE', 'UNCOSTED', 'INELIGIBLE'];
  const costingStatus =
    statusOrder.find((status) => active.some(({ variant }) => variant.costing_status === status)) ||
    (active.every(({ variant }) => variant.costing_status === 'COSTED_ELIGIBLE')
      ? 'COSTED_ELIGIBLE'
      : fallback.costing_status || 'INELIGIBLE');

  const blended: Record<string, unknown> = { ...fallback, costing_status: costingStatus };
  for (const field of WEIGHTED_COST_FIELDS) {
    const values = active.map(({ units, variant }) => ({ units, value: variant[field] }));
    blended[field] = values.every(({ value }) => typeof value === 'number' && Number.isFinite(value))
      ? values.reduce((sum, entry) => sum + entry.value! * entry.units, 0) / totalUnits
      : null;
  }

  blended.incomplete_reasons = Array.from(
    new Set(active.flatMap(({ variant }) => variant.incomplete_reasons || []))
  );
  return blended as unknown as YatraMenuItemVariant;
}
