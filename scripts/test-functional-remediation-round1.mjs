import test from 'node:test';
import assert from 'node:assert/strict';
import { getBusinessDateRange } from '../src/lib/business-date-ranges.ts';
import { isMandatoryInventoryLocation, isNonZeroStockBalance } from '../src/lib/inventory/location-rules.ts';
import { formatNullablePrice } from '../src/lib/utils.ts';
import { compareNullableNumbers } from '../src/lib/sops/menu-sort.ts';
import { classifyMenuSalesChannel, menuSalesCostChannel, parseMenuSalesChannel } from '../src/lib/sales/menu-channels.ts';
import { calculateSalesWeightedVariantCost } from '../src/lib/sops/costing/channel-mix.ts';
import { calculateRealizedContribution } from '../src/lib/sops/costing/contribution.ts';

const at = (iso) => new Date(iso);

test('Menu Master and Menu Item Detail share exact inclusive IST date ranges', () => {
  const now = at('2026-11-01T12:00:00+05:30');
  assert.deepEqual(getBusinessDateRange('yesterday', now), {
    from: '2026-10-31', to: '2026-10-31', status: 'ready',
  });
  assert.deepEqual(getBusinessDateRange('7d', now), {
    from: '2026-10-25', to: '2026-10-31', status: 'ready',
  });
  assert.deepEqual(getBusinessDateRange('30d', now), {
    from: '2026-10-02', to: '2026-10-31', status: 'ready',
  });
  assert.deepEqual(getBusinessDateRange('this_month', now), {
    from: '2026-11-01', to: '2026-10-31', status: 'empty',
  });
  assert.deepEqual(getBusinessDateRange('all', now), {
    from: null, to: null, status: 'ready',
  });
});

test('January 1 has an empty current month and completed ranges cross the year correctly', () => {
  const now = at('2027-01-01T00:15:00+05:30');
  assert.deepEqual(getBusinessDateRange('this_month', now), {
    from: '2027-01-01', to: '2026-12-31', status: 'empty',
  });
  assert.deepEqual(getBusinessDateRange('7d', now), {
    from: '2026-12-25', to: '2026-12-31', status: 'ready',
  });
  assert.deepEqual(getBusinessDateRange('30d', now), {
    from: '2026-12-02', to: '2026-12-31', status: 'ready',
  });
});

test('IST date remains correct at midnight, before 05:30 IST, and on either side of UTC midnight', () => {
  assert.equal(getBusinessDateRange('today', at('2026-10-31T18:29:59Z')).from, '2026-10-31');
  assert.equal(getBusinessDateRange('today', at('2026-10-31T18:30:00Z')).from, '2026-11-01');
  assert.equal(getBusinessDateRange('today', at('2026-11-01T00:00:00+05:30')).from, '2026-11-01');
  assert.equal(getBusinessDateRange('today', at('2026-11-01T05:29:00+05:30')).from, '2026-11-01');
  assert.equal(getBusinessDateRange('today', at('2026-11-01T05:30:00+05:30')).from, '2026-11-01');
});

test('month-end and custom ranges preserve inclusive calendar-day boundaries', () => {
  assert.deepEqual(getBusinessDateRange('this_month', at('2026-12-01T00:01:00+05:30')), {
    from: '2026-12-01', to: '2026-11-30', status: 'empty',
  });
  assert.deepEqual(getBusinessDateRange('this_month', at('2026-11-30T23:59:00+05:30')), {
    from: '2026-11-01', to: '2026-11-29', status: 'ready',
  });
  assert.deepEqual(getBusinessDateRange('custom', at('2026-11-01T12:00:00+05:30'), '2026-01-01', '2026-01-31'), {
    from: '2026-01-01', to: '2026-01-31', status: 'ready',
  });
  assert.equal(getBusinessDateRange('custom', at('2026-11-01T12:00:00+05:30'), '', '').status, 'needs-range');
  assert.equal(getBusinessDateRange('custom', at('2026-11-01T12:00:00+05:30'), '2026-02-30', '2026-03-01').status, 'invalid');
  assert.equal(getBusinessDateRange('custom', at('2026-11-01T12:00:00+05:30'), '2026-03-02', '2026-03-01').status, 'invalid');
});

test('mandatory locations and non-zero balances match deletion policy', () => {
  assert.equal(isMandatoryInventoryLocation('store'), true);
  assert.equal(isMandatoryInventoryLocation(' KITCHEN-MAIN '), true);
  assert.equal(isMandatoryInventoryLocation('KITCHEN-01'), false);
  assert.equal([0, '0.0000', null].some(isNonZeroStockBalance), false);
  assert.equal([0, '0.0001'].some(isNonZeroStockBalance), true);
  assert.equal([-0.25].some(isNonZeroStockBalance), true);
});

test('zero selling price is visible while missing and invalid prices remain blank', () => {
  assert.equal(formatNullablePrice(0), '₹0');
  assert.equal(formatNullablePrice('0'), '₹0');
  assert.equal(formatNullablePrice(25), '₹25');
  assert.equal(formatNullablePrice(null), '—');
  assert.equal(formatNullablePrice(undefined), '—');
  assert.equal(formatNullablePrice('not-a-price'), '—');
});

test('menu price sorting remains numeric and keeps missing prices last', () => {
  const prices = [100, 2, null, 0];
  assert.deepEqual([...prices].sort((a, b) => compareNullableNumbers(a, b, 'asc')), [0, 2, 100, null]);
  assert.deepEqual([...prices].sort((a, b) => compareNullableNumbers(a, b, 'desc')), [100, 2, 0, null]);
});

test('imported Petpooja source patterns map exclusively, with Lancho precedence', () => {
  assert.equal(classifyMenuSalesChannel({ order_type: 'Dine In', payment_type: 'UPI' }), 'DINE_IN');
  assert.equal(classifyMenuSalesChannel({ order_type: 'Pick Up', area: 'Parcel', payment_type: 'Cash' }), 'TAKEAWAY');
  assert.equal(classifyMenuSalesChannel({ order_type: 'Delivery(Parcel)', area: 'Home Delivery', payment_type: 'UPI' }), 'HOME_DELIVERY');
  assert.equal(classifyMenuSalesChannel({ order_type: 'Delivery(Parcel)', area: 'LANCHO', payment_type: 'Online' }), 'LANCHO');
  assert.equal(classifyMenuSalesChannel({ order_type: 'Dine In', payment_type: 'Other [Lancho]' }), 'LANCHO');
  assert.equal(classifyMenuSalesChannel({ order_type: 'Pick Up', area: 'Parcel', payment_type: 'Other [Lancho]' }), 'LANCHO');
  assert.equal(classifyMenuSalesChannel({ order_type: 'Future Channel', area: null, payment_type: 'Cash' }), 'UNKNOWN');
  assert.equal(parseMenuSalesChannel('home_delivery'), 'HOME_DELIVERY');
  assert.equal(parseMenuSalesChannel('not-a-channel'), null);
});

test('menu cost channel mapping preserves the existing Dine In and Takeaway cost models', () => {
  assert.equal(menuSalesCostChannel('DINE_IN'), 'DINE_IN');
  assert.equal(menuSalesCostChannel('TAKEAWAY'), 'TAKEAWAY');
  assert.equal(menuSalesCostChannel('HOME_DELIVERY'), 'TAKEAWAY');
  assert.equal(menuSalesCostChannel('ALL'), undefined);
  assert.equal(menuSalesCostChannel('LANCHO'), undefined);
  assert.equal(menuSalesCostChannel('UNKNOWN'), undefined);
});

test('All Channels costs use sold-channel mix and incomplete sold channels are excluded from profitability', () => {
  const variant = (foodCost, channel, costingStatus = 'COSTED_ELIGIBLE') => ({
    variant_name: 'Regular',
    default_service_channel: channel,
    food_cost: foodCost,
    food_cost_pct: foodCost,
    margin_amount: 100 - foodCost,
    operating_cost: 1,
    packaging_cost: 1,
    total_cost: foodCost + 2,
    contribution_amount: 98 - foodCost,
    contribution_pct: 98 - foodCost,
    costing_status: costingStatus,
  });
  const blended = calculateSalesWeightedVariantCost([
    { units: 60, variant: variant(10, 'DINE_IN') },
    { units: 30, variant: variant(12, 'TAKEAWAY') },
    { units: 10, variant: variant(14, 'DINE_IN') },
  ], variant(14, 'DINE_IN'));
  assert.equal(blended.food_cost, 11);
  assert.equal(blended.total_cost, 13);
  assert.equal(blended.costing_status, 'COSTED_ELIGIBLE');

  const incomplete = calculateSalesWeightedVariantCost([
    { units: 1, variant: variant(10, 'DINE_IN') },
    { units: 1, variant: variant(null, 'TAKEAWAY', 'COSTING_INCOMPLETE') },
  ], variant(10, 'DINE_IN'));
  assert.equal(incomplete.food_cost, null);
  assert.equal(incomplete.costing_status, 'COSTING_INCOMPLETE');
});

test('BCG contribution uses realized transaction revenue rather than current list price', () => {
  const discounted = calculateRealizedContribution(10, 700, 100, 20);
  assert.equal(discounted.unitContributionMargin, 50);
  assert.ok(Math.abs(discounted.foodCostPct - (200 / 7)) < 1e-10);
  const regular = calculateRealizedContribution(10, 1000, 100, 20);
  assert.equal(regular.unitContributionMargin, 80);
  assert.equal((discounted.unitContributionMargin + regular.unitContributionMargin) / 2, 65);
});
