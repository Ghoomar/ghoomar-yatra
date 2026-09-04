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
  status: 'Healthy' | 'At Risk' | 'Below Break-Even';
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

  let status: 'Healthy' | 'At Risk' | 'Below Break-Even' = 'Healthy';
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
