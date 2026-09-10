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
  variableExpenses: number;
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
  foodCostPercent: number;
  revenueLinkedExpenses: number;
  totalVariableExpenses: number;
  dailyAllocatedFixedCosts: number;
  estimatedNetProfit: number;
  netProfitMarginPercent: number;
}

export function calculateDailyProfitability(input: DailyFinanceInput): DailyFinanceOutput {
  if (!input.isReported) {
    return {
      isReported: false,
      revenue: 0,
      totalDirectConsumption: 0,
      customerFoodConsumption: 0,
      staffFoodConsumption: 0,
      wastageCost: 0,
      foodCostPercent: 0,
      revenueLinkedExpenses: 0,
      totalVariableExpenses: 0,
      dailyAllocatedFixedCosts: 0,
      estimatedNetProfit: 0,
      netProfitMarginPercent: 0,
    };
  }

  const revenue = input.netSales;
  const totalDirectConsumption = 
    input.customerFoodConsumption + input.staffFoodConsumption + input.wastageCost;

  const foodCostPercent = revenue > 0 
    ? Number(((input.customerFoodConsumption / revenue) * 100).toFixed(1))
    : 0;

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
    (revenue - totalDirectConsumption - totalVariableExpenses - dailyAllocatedFixedCosts).toFixed(2)
  );

  const netProfitMarginPercent = revenue > 0
    ? Number(((estimatedNetProfit / revenue) * 100).toFixed(1))
    : 0;

  return {
    isReported: true,
    revenue,
    totalDirectConsumption,
    customerFoodConsumption: input.customerFoodConsumption,
    staffFoodConsumption: input.staffFoodConsumption,
    wastageCost: input.wastageCost,
    foodCostPercent,
    revenueLinkedExpenses,
    totalVariableExpenses,
    dailyAllocatedFixedCosts,
    estimatedNetProfit,
    netProfitMarginPercent,
  };
}

export type BreakEvenStatus = 'Healthy' | 'At Risk' | 'Below Break-Even';

export interface BreakEvenInput {
  mtdRevenue: number;
  daysElapsed: number;
  daysInMonth: number;
  planningBreakEven: number; // e.g. 30,00,000
  totalMonthlyFixedCosts: number;
  mtdContributionMargin: number;
}

export interface BreakEvenOutput {
  planningBreakEven: number;
  calculatedBreakEven: number;
  mtdRevenue: number;
  daysElapsed: number;
  daysRemaining: number;
  averageDailyRevenue: number;
  requiredDailyRevenuePlanning: number;
  requiredDailyRevenueCalculated: number;
  projectedMonthEndRevenue: number;
  planningVariance: number;
  status: BreakEvenStatus;
}

export function calculateBreakEvenPacing({
  mtdRevenue,
  daysElapsed,
  daysInMonth,
  planningBreakEven = 3000000,
  totalMonthlyFixedCosts,
  mtdContributionMargin,
}: BreakEvenInput): BreakEvenOutput {
  const elapsed = Math.max(1, daysElapsed);
  const daysRemaining = Math.max(0, daysInMonth - elapsed);
  const averageDailyRevenue = mtdRevenue / elapsed;
  const projectedMonthEndRevenue = Number((averageDailyRevenue * daysInMonth).toFixed(2));

  // Dynamic Calculated Break-Even based on actual contribution margin ratio
  const cmRatio = mtdRevenue > 0 ? mtdContributionMargin / mtdRevenue : 0.40; // fallback 40%
  const calculatedBreakEven = cmRatio > 0 
    ? Number((totalMonthlyFixedCosts / cmRatio).toFixed(2)) 
    : planningBreakEven;

  const remainingRevenuePlanning = Math.max(0, planningBreakEven - mtdRevenue);
  const requiredDailyRevenuePlanning = daysRemaining > 0 
    ? Number((remainingRevenuePlanning / daysRemaining).toFixed(2)) 
    : 0;

  const remainingRevenueCalculated = Math.max(0, calculatedBreakEven - mtdRevenue);
  const requiredDailyRevenueCalculated = daysRemaining > 0 
    ? Number((remainingRevenueCalculated / daysRemaining).toFixed(2)) 
    : 0;

  const planningVariance = Number((projectedMonthEndRevenue - planningBreakEven).toFixed(2));

  let status: BreakEvenStatus = 'Healthy';
  if (planningVariance < -0.10 * planningBreakEven) {
    status = 'Below Break-Even';
  } else if (planningVariance < 0) {
    status = 'At Risk';
  }

  return {
    planningBreakEven,
    calculatedBreakEven,
    mtdRevenue,
    daysElapsed: elapsed,
    daysRemaining,
    averageDailyRevenue: Number(averageDailyRevenue.toFixed(2)),
    requiredDailyRevenuePlanning,
    requiredDailyRevenueCalculated,
    projectedMonthEndRevenue,
    planningVariance,
    status,
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
      };
    }
  } catch (e) {
    console.warn('RPC get_mtd_financial_summary failed, using query fallback:', e);
  }

  // 2. Resilient fallback query directly from sales_reports and daily_financial_summary
  const [{ data: salesRows }, { data: finRows }] = await Promise.all([
    supabase
      .from('sales_reports')
      .select('net_sales, gross_sales, discounts, is_reported')
      .gte('business_date', monthStart)
      .lte('business_date', businessDate),
    supabase
      .from('daily_financial_summary')
      .select('customer_food_consumption, staff_food_consumption, wastage_cost, total_material_consumption, variable_expenses, payment_commissions, gross_operating_surplus')
      .gte('business_date', monthStart)
      .lte('business_date', businessDate),
  ]);

  const mtd_net_sales = (salesRows || []).reduce((s: number, r: any) => s + (Number(r.net_sales) || 0), 0);
  const mtd_gross_sales = (salesRows || []).reduce((s: number, r: any) => s + (Number(r.gross_sales) || 0), 0);
  const mtd_discounts = (salesRows || []).reduce((s: number, r: any) => s + (Number(r.discounts) || 0), 0);
  const days_reported = (salesRows || []).filter((r: any) => r.is_reported).length;

  const mtd_customer_food_cost = (finRows || []).reduce((s: number, r: any) => s + (Number(r.customer_food_consumption) || 0), 0);
  const mtd_staff_food_cost = (finRows || []).reduce((s: number, r: any) => s + (Number(r.staff_food_consumption) || 0), 0);
  const mtd_wastage_cost = (finRows || []).reduce((s: number, r: any) => s + (Number(r.wastage_cost) || 0), 0);
  const mtd_total_material_consumption = (finRows || []).reduce((s: number, r: any) => s + (Number(r.total_material_consumption) || 0), 0);
  const mtd_variable_expenses = (finRows || []).reduce((s: number, r: any) => s + (Number(r.variable_expenses) || 0), 0);
  const mtd_payment_commissions = (finRows || []).reduce((s: number, r: any) => s + (Number(r.payment_commissions) || 0), 0);
  const mtd_gross_operating_surplus = (finRows || []).reduce((s: number, r: any) => s + (Number(r.gross_operating_surplus) || 0), 0);

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
  };
}

