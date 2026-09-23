export interface DailyFinanceInput {
  businessDate: string;
  isReported: boolean;
  grossSales: number;
  discounts: number;
  netSales: number;
  paymentCommissions: number;
  customerFoodConsumption: number;
  staffFoodConsumption: number;
  wastageCost: number;
  complimentaryFoodConsumption?: number;
  samplingConsumption?: number;
  otherConsumption?: number;
  variableExpenses: number;
  operationalUtilities?: {
    electricityCost: number;
    generatorDieselCost: number;
    commercialLpgCost: number;
  };
  revenueLinkedRates: {
    rentPercent: number; // e.g. 0.10 for 10%
    investorSharePercent: number; // e.g. 0.08 for 8%
  };
  monthlyFixedAllocations: {
    totalMonthlySalaries: number;
    otherMonthlyFixedCosts: number;
    daysInMonth: number;
  };
}

export interface DailyFinanceOutput {
  isReported: boolean;
  revenue: number;
  totalDirectConsumption: number;
  customerFoodConsumption: number;
  staffFoodConsumption: number;
  wastageCost: number;
  complimentaryFoodConsumption: number;
  samplingConsumption: number;
  otherConsumption: number;
  operationalUtilities: {
    electricityCost: number;
    generatorDieselCost: number;
    commercialLpgCost: number;
    totalOperationalUtilities: number;
  };
  foodCostPercent: number;
  revenueLinkedExpenses: number;
  totalVariableExpenses: number;
  dailyAllocatedFixedCosts: number;
  estimatedNetProfit: number;
  netProfitMarginPercent: number;
}

export function calculateDailyProfitability(input: DailyFinanceInput): DailyFinanceOutput {
  const isReported = Boolean(input.isReported);
  const revenue = isReported ? (input.netSales || 0) : 0;
  const comp = input.complimentaryFoodConsumption || 0;
  const sample = input.samplingConsumption || 0;
  const other = input.otherConsumption || 0;

  const totalDirectConsumption = 
    input.customerFoodConsumption + input.staffFoodConsumption + input.wastageCost + comp + sample + other;

  // Food cost percent based on total food produced (customer + complimentary + sampling)
  const totalFoodProduction = input.customerFoodConsumption + comp + sample;
  const foodCostPercent = revenue > 0 
    ? Number(((totalFoodProduction / revenue) * 100).toFixed(1))
    : 0;

  // Operational Utilities (Electricity + Diesel + Commercial LPG)
  const elec = input.operationalUtilities?.electricityCost || 0;
  const diesel = input.operationalUtilities?.generatorDieselCost || 0;
  const lpg = input.operationalUtilities?.commercialLpgCost || 0;
  const totalOperationalUtilities = Number((elec + diesel + lpg).toFixed(2));

  const rentExpense = revenue * (input.revenueLinkedRates.rentPercent || 0);
  const investorExpense = revenue * (input.revenueLinkedRates.investorSharePercent || 0);
  const revenueLinkedExpenses = rentExpense + investorExpense;

  const totalVariableExpenses = 
    input.variableExpenses + input.paymentCommissions + revenueLinkedExpenses;

  const daysInMonth = input.monthlyFixedAllocations.daysInMonth || 30;
  const dailySalaries = input.monthlyFixedAllocations.totalMonthlySalaries / daysInMonth;
  const dailyOtherFixed = input.monthlyFixedAllocations.otherMonthlyFixedCosts / daysInMonth;
  const dailyAllocatedFixedCosts = Number((dailySalaries + dailyOtherFixed).toFixed(2));

  const estimatedNetProfit = Number(
    (revenue - totalDirectConsumption - totalOperationalUtilities - totalVariableExpenses - dailyAllocatedFixedCosts).toFixed(2)
  );

  const netProfitMarginPercent = revenue > 0
    ? Number(((estimatedNetProfit / revenue) * 100).toFixed(1))
    : 0;

  return {
    isReported,
    revenue,
    totalDirectConsumption,
    customerFoodConsumption: input.customerFoodConsumption,
    staffFoodConsumption: input.staffFoodConsumption,
    wastageCost: input.wastageCost,
    complimentaryFoodConsumption: comp,
    samplingConsumption: sample,
    otherConsumption: other,
    operationalUtilities: {
      electricityCost: elec,
      generatorDieselCost: diesel,
      commercialLpgCost: lpg,
      totalOperationalUtilities,
    },
    foodCostPercent,
    revenueLinkedExpenses,
    totalVariableExpenses,
    dailyAllocatedFixedCosts,
    estimatedNetProfit,
    netProfitMarginPercent,
  };
}



export type MonthlyPerformanceStatus =
  | 'HEALTHY'
  | 'AT RISK'
  | 'BELOW BREAK-EVEN'
  | 'NOT REPORTED'
  | 'Healthy'
  | 'At Risk'
  | 'Below Break-Even'
  | 'ON TARGET'
  | 'BELOW TARGET';

export type BreakEvenStatus = MonthlyPerformanceStatus;

export interface BreakEvenInput {
  mtdRevenue: number;
  daysElapsed: number;
  daysInMonth: number;
  healthBufferPercent?: number; // default 10% (i.e. >= 110% of BEP for Healthy)
  monthlyRevenueTarget?: number; // backwards compatibility alias
  planningBreakEven?: number; // backwards compatibility alias
  totalMonthlyFixedCosts: number;
  mtdContributionMargin: number;
  daysReported?: number;
}

export interface BreakEvenOutput {
  calculatedBreakEven: number;
  mtdRevenue: number;
  daysElapsed: number;
  daysRemaining: number;
  daysReported: number;
  averageDailyRevenue: number;
  requiredDailyRevenue: number;
  projectedMonthEndRevenue: number;
  breakEvenProgressPercent: number; // (projectedMonthEndRevenue / calculatedBreakEven) * 100
  healthBufferPercent: number;
  healthyThresholdRevenue: number; // calculatedBreakEven * (1 + healthBufferPercent / 100)
  status: MonthlyPerformanceStatus;
  // Aliases for backwards compatibility
  monthlyRevenueTarget: number;
  planningBreakEven: number;
  requiredDailyRevenuePlanning: number;
  requiredDailyRevenueCalculated: number;
  targetVariance: number;
  planningVariance: number;
}

export function calculateBreakEvenPacing({
  mtdRevenue,
  daysElapsed,
  daysInMonth,
  healthBufferPercent = 10,
  monthlyRevenueTarget,
  planningBreakEven,
  totalMonthlyFixedCosts,
  mtdContributionMargin,
  daysReported,
}: BreakEvenInput): BreakEvenOutput {
  const elapsed = Math.max(1, daysElapsed);
  const daysRemaining = Math.max(0, daysInMonth - elapsed);

  // Average daily revenue is calculated strictly over days with reported Petpooja sales
  const divisor = (daysReported !== undefined && daysReported > 0) ? daysReported : elapsed;
  const averageDailyRevenue = (daysReported === 0 || mtdRevenue === 0)
    ? 0
    : Number((mtdRevenue / divisor).toFixed(2));
  const projectedMonthEndRevenue = Number((averageDailyRevenue * daysInMonth).toFixed(2));

  // Calculated Break-Even Point = Total Monthly Fixed Costs / Contribution Margin Ratio
  // Contribution Margin Ratio = Total Contribution Margin / Total Sales Revenue
  const cmRatio = mtdRevenue > 0 ? mtdContributionMargin / mtdRevenue : 0.40; // baseline 40%
  const calculatedBreakEven = cmRatio > 0
    ? Number((totalMonthlyFixedCosts / cmRatio).toFixed(2))
    : 0;

  // Single benchmark: Calculated Break-Even Point
  // Required daily revenue across remaining days to achieve Break-Even
  const remainingRevenueToBreakEven = Math.max(0, calculatedBreakEven - mtdRevenue);
  const requiredDailyRevenue = daysRemaining > 0
    ? Number((remainingRevenueToBreakEven / daysRemaining).toFixed(2))
    : 0;

  // % Break-Even Progress = (Projected Month-End Revenue ÷ Calculated BEP) × 100
  const breakEvenProgressPercent = calculatedBreakEven > 0
    ? Number(((projectedMonthEndRevenue / calculatedBreakEven) * 100).toFixed(1))
    : 0;

  const buffer = Number(healthBufferPercent) || 10;
  const healthyThresholdRevenue = Number((calculatedBreakEven * (1 + buffer / 100)).toFixed(2));

  // Status badges based solely on Calculated BEP:
  // - "NOT REPORTED": No Petpooja sales days reported
  // - "BELOW BREAK-EVEN": Projected Revenue < 100% of BEP
  // - "HEALTHY": Projected Revenue >= (100% + buffer) of BEP (e.g. >= 110%)
  // - "AT RISK": Projected Revenue >= 100% of BEP but < Healthy threshold
  let status: MonthlyPerformanceStatus = 'HEALTHY';
  if (daysReported === 0 || mtdRevenue === 0) {
    status = 'NOT REPORTED';
  } else if (projectedMonthEndRevenue < calculatedBreakEven) {
    status = 'BELOW BREAK-EVEN';
  } else if (projectedMonthEndRevenue >= healthyThresholdRevenue) {
    status = 'HEALTHY';
  } else {
    status = 'AT RISK';
  }

  const targetVariance = Number((projectedMonthEndRevenue - calculatedBreakEven).toFixed(2));

  return {
    calculatedBreakEven,
    mtdRevenue,
    daysElapsed: elapsed,
    daysRemaining,
    daysReported: daysReported ?? 0,
    averageDailyRevenue,
    requiredDailyRevenue,
    projectedMonthEndRevenue,
    breakEvenProgressPercent,
    healthBufferPercent: buffer,
    healthyThresholdRevenue,
    status,
    // Backwards compatibility aliases
    monthlyRevenueTarget: calculatedBreakEven,
    planningBreakEven: calculatedBreakEven,
    requiredDailyRevenuePlanning: requiredDailyRevenue,
    requiredDailyRevenueCalculated: requiredDailyRevenue,
    targetVariance,
    planningVariance: targetVariance,
  };
}

export function calculateVisitorPacing(revenue: number, visitors: number, dailyTarget: number, targetSpendPerVisitor = 300) {
  const actualSpendPerVisitor = visitors > 0 ? Number((revenue / visitors).toFixed(2)) : 0;
  const remainingRevenue = Math.max(0, dailyTarget - revenue);
  const requiredVisitorsAtTargetSpend = remainingRevenue > 0 
    ? Math.ceil(remainingRevenue / targetSpendPerVisitor)
    : 0;
  
  const requiredVisitorsAtCurrentSpend = (remainingRevenue > 0 && actualSpendPerVisitor > 0)
    ? Math.ceil(remainingRevenue / actualSpendPerVisitor)
    : requiredVisitorsAtTargetSpend;

  const achievementPercent = dailyTarget > 0 ? Number(((revenue / dailyTarget) * 100).toFixed(1)) : 0;

  return {
    actualSpendPerVisitor,
    remainingRevenue,
    requiredVisitorsAtTargetSpend,
    requiredVisitorsAtCurrentSpend,
    achievementPercent,
  };
}

import { MTDFinancialSummary } from './types/database';
import { getMonthDateRange } from './utils';

export async function fetchMTDFinancialSummary(
  supabase: any,
  businessDate: string
): Promise<MTDFinancialSummary> {
  const { monthStart, daysInMonth, daysElapsed, daysRemaining } = getMonthDateRange(businessDate);

  try {
    // 1. Try authoritative RPC
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('get_mtd_financial_summary', { p_business_date: businessDate });

    if (!rpcError && rpcData && rpcData.length > 0) {
      const row = rpcData[0];
      return {
        month_start_date: row.month_start_date || monthStart,
        selected_date: row.selected_date || businessDate,
        days_in_month: Number(row.days_in_month) || daysInMonth,
        day_of_month: Number(row.day_of_month) || daysElapsed,
        days_elapsed: Number(row.days_elapsed) || daysElapsed,
        days_remaining: Number(row.days_remaining) || daysRemaining,
        mtd_net_sales: Number(row.mtd_net_sales) || 0,
        mtd_gross_sales: Number(row.mtd_gross_sales) || 0,
        mtd_discounts: Number(row.mtd_discounts) || 0,
        mtd_customer_food_cost: Number(row.mtd_customer_food_cost) || 0,
        mtd_staff_food_cost: Number(row.mtd_staff_food_cost) || 0,
        mtd_wastage_cost: Number(row.mtd_wastage_cost) || 0,
        mtd_total_material_consumption: Number(row.mtd_total_material_consumption) || 0,
        mtd_variable_expenses: Number(row.mtd_variable_expenses) || 0,
        mtd_payment_commissions: Number(row.mtd_payment_commissions) || 0,
        mtd_gross_operating_surplus: Number(row.mtd_gross_operating_surplus) || 0,
        days_reported: Number(row.days_reported) || 0,
        mtd_property_rent: Number(((Number(row.mtd_net_sales) || 0) * 0.10).toFixed(2)),
        mtd_investor_share: Number(((Number(row.mtd_net_sales) || 0) * 0.10).toFixed(2)),
      };
    }
  } catch (e) {
    console.warn('RPC get_mtd_financial_summary failed, using query fallback:', e);
  }

  // 2. Resilient fallback query directly from daily_sales_summary and daily_financial_summary
  const [{ data: salesSummaryRows }, { data: finRows }] = await Promise.all([
    supabase
      .from('daily_sales_summary')
      .select('net_sales, gross_sales, discounts, is_reported')
      .gte('business_date', monthStart)
      .lte('business_date', businessDate),
    supabase
      .from('daily_financial_summary')
      .select('customer_food_consumption, staff_food_consumption, wastage_cost, total_material_consumption, variable_expenses, payment_commissions, gross_operating_surplus')
      .gte('business_date', monthStart)
      .lte('business_date', businessDate),
  ]);

  const salesRows = salesSummaryRows || [];

  const mtd_net_sales = salesRows.reduce((s: number, r: any) => s + (Number(r.net_sales) || 0), 0);
  const mtd_gross_sales = salesRows.reduce((s: number, r: any) => s + (Number(r.gross_sales) || 0), 0);
  const mtd_discounts = salesRows.reduce((s: number, r: any) => s + (Number(r.discounts) || 0), 0);
  const days_reported = salesRows.filter((r: any) => r.is_reported).length;

  const mtd_customer_food_cost = (finRows || []).reduce((s: number, r: any) => s + (Number(r.customer_food_consumption) || 0), 0);
  const mtd_staff_food_cost = (finRows || []).reduce((s: number, r: any) => s + (Number(r.staff_food_consumption) || 0), 0);
  const mtd_wastage_cost = (finRows || []).reduce((s: number, r: any) => s + (Number(r.wastage_cost) || 0), 0);
  const mtd_total_material_consumption = (finRows || []).reduce((s: number, r: any) => s + (Number(r.total_material_consumption) || 0), 0);
  const mtd_variable_expenses = (finRows || []).reduce((s: number, r: any) => s + (Number(r.variable_expenses) || 0), 0);
  const mtd_payment_commissions = (finRows || []).reduce((s: number, r: any) => s + (Number(r.payment_commissions) || 0), 0);
  const mtd_gross_operating_surplus = (finRows || []).reduce((s: number, r: any) => s + (Number(r.gross_operating_surplus) || 0), 0);
  const mtd_property_rent = Number((mtd_net_sales * 0.10).toFixed(2));
  const mtd_investor_share = Number((mtd_net_sales * 0.10).toFixed(2));

  return {
    month_start_date: monthStart,
    selected_date: businessDate,
    days_in_month: daysInMonth,
    day_of_month: daysElapsed,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    mtd_net_sales,
    mtd_gross_sales,
    mtd_discounts,
    mtd_customer_food_cost,
    mtd_staff_food_cost,
    mtd_wastage_cost,
    mtd_total_material_consumption,
    mtd_variable_expenses,
    mtd_payment_commissions,
    mtd_gross_operating_surplus,
    days_reported,
    mtd_property_rent,
    mtd_investor_share,
  };
}

