'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate, formatPercent } from '@/lib/utils';
import { calculateDailyProfitability, calculateBreakEvenPacing } from '@/lib/finance-engine';
import { TrendingUp, RefreshCw } from 'lucide-react';

export default function ProfitabilityPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [loading, setLoading] = useState(true);

  // Financial Figures
  const [salesReport, setSalesReport] = useState<any>(null);
  const [materialConsumption, setMaterialConsumption] = useState({
    customerFood: 0,
    staffFood: 0,
    wastage: 0,
  });
  const [variableExpenses, setVariableExpenses] = useState(0);
  const [totalSalaries, setTotalSalaries] = useState(300000);
  const [monthlyOtherFixed, setMonthlyOtherFixed] = useState(3500);
  const [mtdRevenue, setMtdRevenue] = useState(0);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch sales for business date
      const { data: sale } = await supabase
        .from('sales_reports')
        .select('*')
        .eq('business_date', businessDate)
        .maybeSingle();

      setSalesReport(sale || null);

      // 2. Fetch stock movements for this date
      const { data: movs } = await supabase
        .from('stock_movements')
        .select('movement_type, purpose, total_value')
        .eq('business_date', businessDate);

      let cust = 0;
      let staff = 0;
      let waste = 0;
      (movs || []).forEach((m) => {
        const val = Number(m.total_value) || 0;
        if (m.purpose === 'Customer Food') cust += val;
        else if (m.purpose === 'Staff Food' || m.movement_type === 'staff_food') staff += val;
        else if (m.purpose === 'Wastage' || m.movement_type === 'wastage' || m.movement_type === 'spoilage') waste += val;
      });
      setMaterialConsumption({ customerFood: cust, staffFood: staff, wastage: waste });

      // 3. Fetch direct expenses
      const { data: exps } = await supabase
        .from('expenses')
        .select('amount')
        .eq('business_date', businessDate);

      const expTotal = (exps || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
      setVariableExpenses(expTotal);

      // 4. Fetch Active Employees for Salary Pool
      const { data: emps } = await supabase
        .from('employees')
        .select('monthly_salary')
        .eq('employment_status', 'Active');

      const payroll = (emps || []).reduce((s, e) => s + (Number(e.monthly_salary) || 0), 0);
      setTotalSalaries(payroll > 0 ? payroll : 300000);

      // 5. Fetch MTD Revenue
      const currentYearMonth = businessDate.slice(0, 7);
      const { data: mtdSales } = await supabase
        .from('sales_reports')
        .select('net_sales')
        .gte('business_date', `${currentYearMonth}-01`)
        .lte('business_date', businessDate);

      const mtd = (mtdSales || []).reduce((s, r) => s + (Number(r.net_sales) || 0), 0);
      setMtdRevenue(mtd);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const pnl = calculateDailyProfitability({
    businessDate,
    isReported: Boolean(salesReport?.is_reported),
    grossSales: Number(salesReport?.gross_sales) || 0,
    discounts: Number(salesReport?.discounts) || 0,
    netSales: Number(salesReport?.net_sales) || 0,
    paymentCommissions: 0,
    customerFoodConsumption: materialConsumption.customerFood,
    staffFoodConsumption: materialConsumption.staffFood,
    wastageCost: materialConsumption.wastage,
    variableExpenses: variableExpenses,
    revenueLinkedRates: {
      rentPercent: 0.10,
      investorSharePercent: 0.08,
    },
    monthlyFixedAllocations: {
      totalMonthlySalaries: totalSalaries,
      otherMonthlyFixedCosts: monthlyOtherFixed,
      daysInMonth: 30,
    },
  });

  const dayOfMonth = parseInt(businessDate.slice(8, 10)) || 1;
  const breakEven = calculateBreakEvenPacing({
    mtdRevenue: mtdRevenue || pnl.revenue,
    daysElapsed: dayOfMonth,
    daysInMonth: 30,
    planningBreakEven: 3000000,
    totalMonthlyFixedCosts: totalSalaries + monthlyOtherFixed,
    mtdContributionMargin: (mtdRevenue || pnl.revenue) * 0.45,
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-amber-600" />
            Profitability & Daily P&L Waterfall
          </h1>
          <p className="text-sm text-stone-500">
            Economic profit model distinguishing actual expenditures from allocated fixed overheads and dynamic break-even pacing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-2xs text-xs font-medium">
            <span className="text-stone-500">Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Top Level Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-2 border-stone-200/80">
          <CardDescription>Daily Estimated Net Profit</CardDescription>
          <div className={`text-3xl font-black mt-1 ${pnl.estimatedNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {pnl.isReported ? formatINR(pnl.estimatedNetProfit) : 'NOT REPORTED'}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            {pnl.isReported ? `Margin: ${pnl.netProfitMarginPercent}% of net sales` : 'Petpooja sales entry missing'}
          </div>
        </Card>

        <Card>
          <CardDescription>Direct Food Cost %</CardDescription>
          <div className="text-3xl font-bold text-stone-900 mt-1">
            {pnl.foodCostPercent}%
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            Customer food consumption ÷ Net Revenue
          </div>
        </Card>

        <Card>
          <CardDescription>Monthly Break-Even Pacing</CardDescription>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={breakEven.status === 'Healthy' ? 'success' : breakEven.status === 'At Risk' ? 'warning' : 'danger'} className="text-xs py-1 px-2.5 font-bold">
              {breakEven.status.toUpperCase()}
            </Badge>
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            Projected Month-End: <strong>{formatINR(breakEven.projectedMonthEndRevenue, true)}</strong> (Target: ₹30L)
          </div>
        </Card>
      </div>

      {/* P&L Waterfall Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Daily P&L Statement for {businessDate}</CardTitle>
          <CardDescription>Separation of actual direct costs and estimated fixed allocations</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="divide-y divide-stone-100 text-xs sm:text-sm">
            {/* Revenue */}
            <div className="py-3 flex items-center justify-between font-bold text-stone-900 bg-stone-50/50 px-2 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Total Net Revenue (Petpooja)</span>
                <span className="text-[10px] text-emerald-800 font-normal bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">ACTUAL</span>
              </div>
              <span className="text-emerald-700 text-base font-extrabold">{formatINR(pnl.revenue)}</span>
            </div>

            {/* Direct Material Consumption */}
            <div className="py-3.5 space-y-2 px-2">
              <div className="flex items-center justify-between font-semibold text-stone-800">
                <span>Direct Material Consumption (WAC Valued)</span>
                <span className="text-rose-600">− {formatINR(pnl.totalDirectConsumption)}</span>
              </div>
              <div className="pl-4 space-y-1 text-xs text-stone-500">
                <div className="flex items-center justify-between">
                  <span>• Customer Food Production</span>
                  <span>{formatINR(pnl.customerFoodConsumption)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>• Staff Food (Duty Meals)</span>
                  <span>{formatINR(pnl.staffFoodConsumption)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>• Kitchen Wastage &amp; Spoilage</span>
                  <span>{formatINR(pnl.wastageCost)}</span>
                </div>
              </div>
            </div>

            {/* Variable Expenses */}
            <div className="py-3.5 space-y-2 px-2">
              <div className="flex items-center justify-between font-semibold text-stone-800">
                <span>Variable Operating Expenses</span>
                <span className="text-rose-600">− {formatINR(pnl.totalVariableExpenses)}</span>
              </div>
              <div className="pl-4 space-y-1 text-xs text-stone-500">
                <div className="flex items-center justify-between">
                  <span>• Property Rent (10% of Revenue)</span>
                  <span>{formatINR(pnl.revenue * 0.10)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>• Investor Share (8% of Revenue)</span>
                  <span>{formatINR(pnl.revenue * 0.08)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>• Direct Logged Expenses (Vouchers)</span>
                  <span>{formatINR(variableExpenses)}</span>
                </div>
              </div>
            </div>

            {/* Allocated Monthly Overheads */}
            <div className="py-3.5 space-y-2 px-2">
              <div className="flex items-center justify-between font-semibold text-stone-800">
                <div className="flex items-center gap-2">
                  <span>Allocated Monthly Overheads</span>
                  <span className="text-[10px] text-amber-800 font-normal bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">ALLOCATED ESTIMATE</span>
                </div>
                <span className="text-rose-600">− {formatINR(pnl.dailyAllocatedFixedCosts)}</span>
              </div>
              <div className="pl-4 space-y-1 text-xs text-stone-500">
                <div className="flex items-center justify-between">
                  <span>• Staff Salaries ({formatINR(totalSalaries)} ÷ 30 days)</span>
                  <span>{formatINR(totalSalaries / 30)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>• Fixed Contracts &amp; Wi-Fi ({formatINR(monthlyOtherFixed)} ÷ 30 days)</span>
                  <span>{formatINR(monthlyOtherFixed / 30)}</span>
                </div>
              </div>
            </div>

            {/* Final Bottom Line */}
            <div className="py-4 flex items-center justify-between font-extrabold text-base bg-stone-100 px-3 rounded-xl">
              <span className="text-stone-900">Daily Estimated Net Profit</span>
              <span className={pnl.estimatedNetProfit >= 0 ? 'text-emerald-700 text-lg' : 'text-rose-600 text-lg'}>
                {formatINR(pnl.estimatedNetProfit)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Break Even Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Break-Even Engine Intelligence</CardTitle>
          <CardDescription>Planning management target vs dynamic cost-derived break-even</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 text-xs space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
              <div className="text-xs font-bold text-stone-700 uppercase">1. Planning Break-Even Target</div>
              <div className="text-2xl font-black text-stone-900">₹30,00,000 / month</div>
              <p className="text-stone-500 text-[11px]">
                Fixed management objective. Requires <strong>{formatINR(breakEven.requiredDailyRevenuePlanning)}/day</strong> across the remaining {breakEven.daysRemaining} days.
              </p>
            </div>

            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
              <div className="text-xs font-bold text-stone-700 uppercase">2. Calculated Break-Even Point</div>
              <div className="text-2xl font-black text-amber-700">
                {formatINR(breakEven.calculatedBreakEven)} / month
              </div>
              <p className="text-stone-500 text-[11px]">
                Dynamically derived from actual fixed costs divided by current contribution margin ratio (CM Ratio: 45%).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
