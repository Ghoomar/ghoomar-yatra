export interface InsightItem {
  id: string;
  category: 'Sales' | 'Footfall Economics' | 'Target' | 'Inventory' | 'Staffing' | 'Utilities' | 'Profitability';
  type: 'Fact' | 'Estimate' | 'Projection' | 'Anomaly';
  statement: string;
  detail: string;
  severity: 'positive' | 'neutral' | 'warning' | 'critical';
}

export interface InsightInput {
  netSales: number;
  dailyTarget: number;
  visitors: number;
  targetSpendPerVisitor: number;
  spendPerVisitor: number;
  breakEvenProjected: number;
  planningBreakEven: number;
  lowStockItemsCount: number;
  absentStaffCount: number;
  foodCostPercent: number;
  dayElectricityConsumption: number;
}

export function generateManagementInsights(input: InsightInput): InsightItem[] {
  const insights: InsightItem[] = [];

  // 1. Target Insight
  if (input.dailyTarget > 0) {
    const diff = input.netSales - input.dailyTarget;
    const pct = Math.abs(Math.round((diff / input.dailyTarget) * 100));
    if (diff >= 0) {
      insights.push({
        id: 'tgt-ahead',
        category: 'Target',
        type: 'Fact',
        statement: `Today's revenue is ${pct}% ahead of the operational weekday target.`,
        detail: `Achieved ₹${input.netSales.toLocaleString('en-IN')} against target of ₹${input.dailyTarget.toLocaleString('en-IN')}.`,
        severity: 'positive',
      });
    } else {
      insights.push({
        id: 'tgt-behind',
        category: 'Target',
        type: 'Fact',
        statement: `Today's revenue is ${pct}% behind the operational weekday target.`,
        detail: `Shortfall of ₹${Math.abs(diff).toLocaleString('en-IN')} remains to achieve target.`,
        severity: pct > 25 ? 'warning' : 'neutral',
      });
    }
  }

  // 2. Visitor Economics Insight
  if (input.visitors > 0) {
    if (input.spendPerVisitor < input.targetSpendPerVisitor) {
      const diff = Math.round(input.targetSpendPerVisitor - input.spendPerVisitor);
      insights.push({
        id: 'vis-below-target',
        category: 'Footfall Economics',
        type: 'Fact',
        statement: `Average revenue per visitor is ₹${Math.round(input.spendPerVisitor)}, which is ₹${diff} below the planning assumption of ₹${input.targetSpendPerVisitor}.`,
        detail: 'Increasing food stall conversions or activity participation can close this unit gap.',
        severity: 'warning',
      });
    } else {
      insights.push({
        id: 'vis-healthy',
        category: 'Footfall Economics',
        type: 'Fact',
        statement: `Average spend per visitor is healthy at ₹${Math.round(input.spendPerVisitor)}, exceeding the ₹${input.targetSpendPerVisitor} planning assumption.`,
        detail: 'Strong multi-dish guest orders and snack stall participation.',
        severity: 'positive',
      });
    }
  }

  // 3. Profitability & Break-Even Insight
  if (input.planningBreakEven > 0) {
    if (input.breakEvenProjected < input.planningBreakEven) {
      const gap = Math.round((input.planningBreakEven - input.breakEvenProjected) / 100000);
      insights.push({
        id: 'be-below',
        category: 'Profitability',
        type: 'Projection',
        statement: `At current month-to-date pace, projected month-end revenue is ₹${gap}L below the ₹30 Lakhs break-even point.`,
        detail: 'Management intervention required on highway visibility and weekend dinner footfall.',
        severity: 'critical',
      });
    } else {
      const projLakhs = (input.breakEvenProjected / 100000).toFixed(1);
      insights.push({
        id: 'be-on-track',
        category: 'Profitability',
        type: 'Projection',
        statement: 'Current monthly revenue pace is on track to achieve and exceed the ₹30 Lakhs break-even objective.',
        detail: `Projected month-end: ₹${projLakhs}L.`,
        severity: 'positive',
      });
    }
  }

  // 4. Inventory Insight
  if (input.lowStockItemsCount > 0) {
    insights.push({
      id: 'inv-shortage',
      category: 'Inventory',
      type: 'Anomaly',
      statement: `${input.lowStockItemsCount} critical inventory SKUs have fallen below minimum safety stock levels.`,
      detail: 'Storekeeper purchase orders required immediately to prevent kitchen stockout.',
      severity: 'warning',
    });
  }

  // 5. Staffing Insight
  if (input.absentStaffCount > 2) {
    insights.push({
      id: 'staff-absent',
      category: 'Staffing',
      type: 'Anomaly',
      statement: `${input.absentStaffCount} operational staff members are absent today.`,
      detail: 'Service captain should reallocate dining floor stations for dinner highway rush.',
      severity: 'warning',
    });
  }

  return insights;
}

