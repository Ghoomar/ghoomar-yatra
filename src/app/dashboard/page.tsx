'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate, formatINR } from '@/lib/utils';
import { 
  calculateDailyProfitability, 
  calculateBreakEvenPacing, 
  calculateVisitorPacing,
  fetchMTDFinancialSummary 
} from '@/lib/finance-engine';
import { KPICards } from '@/components/dashboard/KPICards';
import { TargetPacing } from '@/components/dashboard/TargetPacing';
import { MonthlyPosition } from '@/components/dashboard/MonthlyPosition';
import { ActionRequiredFlags, ActionFlag } from '@/components/dashboard/ActionRequiredFlags';
import { BusinessHealth } from '@/components/dashboard/BusinessHealth';
import { LayoutDashboard, RefreshCw } from 'lucide-react';
import { MTDFinancialSummary } from '@/lib/types/database';
import { getMonthDateRange } from '@/lib/utils';

export default function DashboardPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [loading, setLoading] = useState(true);

  // Raw Query States
  const [salesSummary, setSalesSummary] = useState<any>(null);
  const [targetProgress, setTargetProgress] = useState<any>(null);
  const [financialSummary, setFinancialSummary] = useState<any>(null);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [visitorEvents, setVisitorEvents] = useState<any[]>([]);
  const [vehicleEvents, setVehicleEvents] = useState<any[]>([]);
  const [activeStaffCount, setActiveStaffCount] = useState<number>(0);
  const [absentStaffCount, setAbsentStaffCount] = useState<number>(0);
  const [isDayClosed, setIsDayClosed] = useState<boolean>(false);

  // Hardened Dynamic Financial States
  const [mtdSummary, setMtdSummary] = useState<MTDFinancialSummary | null>(null);
  const [monthlySalaries, setMonthlySalaries] = useState<number>(0);
  const [otherFixedCosts, setOtherFixedCosts] = useState<number>(3500);
  const [planningBreakEven, setPlanningBreakEven] = useState<number>(3000000);
  const [rentRate, setRentRate] = useState<number>(0.10);
  const [investorRate, setInvestorRate] = useState<number>(0.08);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // 1. Fetch daily_sales_summary view
      const { data: salesData } = await supabase
        .from('daily_sales_summary')
        .select('*')
        .eq('business_date', businessDate)
        .maybeSingle();
      setSalesSummary(salesData || null);

      // 2. Fetch daily_target_progress view
      const { data: targetData } = await supabase
        .from('daily_target_progress')
        .select('*')
        .eq('business_date', businessDate)
        .maybeSingle();
      setTargetProgress(targetData || null);

      // 3. Fetch daily_financial_summary view
      const { data: finData } = await supabase
        .from('daily_financial_summary')
        .select('*')
        .eq('business_date', businessDate)
        .maybeSingle();
      setFinancialSummary(finData || null);

      // 4. Fetch Visitor and Vehicle events for exact Last-Updated timestamps
      const [{ data: vEvents }, { data: cEvents }] = await Promise.all([
        supabase.from('visitor_counter_events').select('increment, timestamp').eq('business_date', businessDate).order('timestamp', { ascending: false }),
        supabase.from('vehicle_counter_events').select('increment, timestamp').eq('business_date', businessDate).order('timestamp', { ascending: false }),
      ]);
      setVisitorEvents(vEvents || []);
      setVehicleEvents(cEvents || []);

      // 5. Fetch low stock items from inventory_current_position view
      const { data: items } = await supabase
        .from('inventory_current_position')
        .select('name, current_quantity, minimum_stock, unit_symbol');
      const low = (items || []).filter((i) => Number(i.current_quantity) <= Number(i.minimum_stock) && Number(i.minimum_stock) > 0);
      setLowStockItems(low);

      // 6. Fetch attendance for date and active employee salaries
      const [{ data: activeEmps }, { data: attRecords }, { data: bDay }] = await Promise.all([
        supabase.from('employees').select('id, monthly_salary').eq('employment_status', 'Active'),
        supabase.from('attendance').select('status').eq('business_date', businessDate),
        supabase.from('business_days').select('status').eq('business_date', businessDate).maybeSingle(),
      ]);

      const activeList = activeEmps || [];
      setActiveStaffCount(activeList.length);
      const totalSal = activeList.reduce((acc: number, emp: any) => acc + (Number(emp.monthly_salary) || 0), 0);
      setMonthlySalaries(totalSal > 0 ? totalSal : activeList.length * 18000);
      setAbsentStaffCount((attRecords || []).filter((a) => a.status === 'Absent').length);
      setIsDayClosed(bDay?.status === 'closed');

      // 7. Authoritative MTD Financial RPC & Fixed Cost Rules & Targets
      const [mtdRes, { data: costRules }, { data: bepTarget }] = await Promise.all([
        fetchMTDFinancialSummary(supabase, businessDate),
        supabase.from('financial_cost_rules').select('*').eq('is_active', true),
        supabase.from('financial_targets').select('target_value').eq('target_type', 'monthly_break_even').eq('is_active', true).maybeSingle(),
      ]);

      setMtdSummary(mtdRes);

      if (costRules && costRules.length > 0) {
        const fixedRules = costRules.filter((r) => r.cost_classification === 'Fixed');
        const fixedSum = fixedRules.reduce((sum, r) => sum + (Number(r.amount_or_rate) || 0), 0);
        if (fixedSum > 0) setOtherFixedCosts(fixedSum);

        const rentRule = costRules.find((r) => r.category === 'Rent' && r.calculation_method === 'percentage_of_revenue');
        if (rentRule) setRentRate(Number(rentRule.amount_or_rate) || 0.10);

        const investorRule = costRules.find((r) => r.category === 'Finance' && r.calculation_method === 'percentage_of_revenue');
        if (investorRule) setInvestorRate(Number(investorRule.amount_or_rate) || 0.08);
      }

      if (bepTarget?.target_value) {
        setPlanningBreakEven(Number(bepTarget.target_value) || 3000000);
      }
    } catch (err: any) {
      console.error('Error loading dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [businessDate]);

  // Derived Calculations
  const revenue = Number(salesSummary?.net_sales) || 0;
  const isSalesReported = Boolean(salesSummary?.is_reported);
  const revenueUpdatedAt = salesSummary?.last_updated_at;

  const totalVisitors = visitorEvents.reduce((s, e) => s + (e.increment || 0), 0);
  const visitorsUpdatedAt = visitorEvents[0]?.timestamp;

  const totalCars = vehicleEvents.reduce((s, e) => s + (e.increment || 0), 0);
  const carsUpdatedAt = vehicleEvents[0]?.timestamp;

  const dailyTarget = Number(targetProgress?.daily_target) || 100000;
  const { actualSpendPerVisitor, remainingRevenue, requiredVisitorsAtTargetSpend, achievementPercent } = 
    calculateVisitorPacing(revenue, totalVisitors, dailyTarget);

  const { daysInMonth, daysElapsed } = getMonthDateRange(businessDate);
  const actualSalariesPool = monthlySalaries > 0 ? monthlySalaries : (activeStaffCount * 18000);

  const profitResult = calculateDailyProfitability({
    businessDate,
    isReported: isSalesReported,
    grossSales: Number(salesSummary?.gross_sales) || 0,
    discounts: Number(salesSummary?.discounts) || 0,
    netSales: revenue,
    paymentCommissions: Number(salesSummary?.total_payment_commissions) || 0,
    customerFoodConsumption: Number(financialSummary?.customer_food_consumption) || 0,
    staffFoodConsumption: Number(financialSummary?.staff_food_consumption) || 0,
    wastageCost: Number(financialSummary?.wastage_cost) || 0,
    variableExpenses: Number(financialSummary?.variable_expenses) || 0,
    revenueLinkedRates: { rentPercent: rentRate, investorSharePercent: investorRate },
    monthlyFixedAllocations: { 
      totalMonthlySalaries: actualSalariesPool, 
      otherMonthlyFixedCosts: otherFixedCosts, 
      daysInMonth 
    },
  });

  const mtdNetSales = mtdSummary ? mtdSummary.mtd_net_sales : (isSalesReported ? revenue : 0);
  const mtdContribution = mtdSummary && mtdSummary.mtd_gross_operating_surplus > 0 
    ? mtdSummary.mtd_gross_operating_surplus 
    : mtdNetSales * 0.45;

  const breakEven = calculateBreakEvenPacing({
    mtdRevenue: mtdNetSales,
    daysElapsed: mtdSummary?.days_elapsed || daysElapsed,
    daysInMonth: mtdSummary?.days_in_month || daysInMonth,
    planningBreakEven: planningBreakEven,
    totalMonthlyFixedCosts: actualSalariesPool + otherFixedCosts,
    mtdContributionMargin: mtdContribution,
  });

  // Action Required Flags
  const flags: ActionFlag[] = [];
  if (lowStockItems.length > 0) {
    const itemNames = lowStockItems.slice(0, 3).map((i) => i.name).join(', ');
    flags.push({
      id: 'low_stock',
      severity: 'critical',
      title: `${lowStockItems.length} Raw Materials Below Minimum Stock`,
      description: `Critical items: ${itemNames}. Replenishment required.`,
      linkText: 'Open Store Catalog',
      href: '/inventory',
    });
  }
  if (!isSalesReported) {
    flags.push({
      id: 'missing_sales',
      severity: 'warning',
      title: 'Petpooja Sales Report Not Entered',
      description: `Midnight day-end figures for ${businessDate} have not been submitted yet.`,
      linkText: 'Enter Petpooja Sales',
      href: '/finance/sales',
    });
  }
  if (absentStaffCount > 2) {
    flags.push({
      id: 'absent_staff',
      severity: 'warning',
      title: `${absentStaffCount} Staff Members Absent Today`,
      description: 'Manpower shortage detected in Service / Kitchen rosters.',
      linkText: 'Check Muster Roll',
      href: '/people/attendance',
    });
  }
  if (!isDayClosed) {
    flags.push({
      id: 'day_closing_open',
      severity: 'info',
      title: 'Midnight Daily Closing Pending',
      description: 'Reconcile sales, cash, expenses and footfall before locking the day.',
      linkText: 'Closing Console',
      href: '/operations/closing',
    });
  }

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs font-bold text-amber-600 uppercase tracking-wider">
            Ghoomar Yatra Operations Intelligence
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-stone-900 mt-0.5 flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-stone-800" />
            Central Command Center
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-2xs text-xs font-medium">
            <span className="text-stone-500">Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadDashboardData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 8 KPI Cards with Last Updated Timestamps */}
      <KPICards
        revenue={revenue}
        revenueUpdatedAt={revenueUpdatedAt}
        isSalesReported={isSalesReported}
        visitors={totalVisitors}
        visitorsUpdatedAt={visitorsUpdatedAt}
        cars={totalCars}
        carsUpdatedAt={carsUpdatedAt}
        spendPerVisitor={actualSpendPerVisitor}
        dailyTarget={dailyTarget}
        achievementPercent={achievementPercent}
        estimatedNetProfit={profitResult.estimatedNetProfit}
        profitMarginPercent={profitResult.netProfitMarginPercent}
        breakEvenPacingStatus={breakEven.status}
        projectedMonthEndRevenue={breakEven.projectedMonthEndRevenue}
      />

      {/* Row 2: Target Pacing and Monthly Position */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TargetPacing
          dailyTarget={dailyTarget}
          revenueAchieved={revenue}
          remainingRevenue={remainingRevenue}
          actualSpendPerVisitor={actualSpendPerVisitor}
          requiredVisitorsRemaining={requiredVisitorsAtTargetSpend}
          achievementPercent={achievementPercent}
        />

        <MonthlyPosition
          planningBreakEven={breakEven.planningBreakEven}
          calculatedBreakEven={breakEven.calculatedBreakEven}
          mtdRevenue={breakEven.mtdRevenue}
          daysElapsed={breakEven.daysElapsed}
          daysInMonth={mtdSummary?.days_in_month || daysInMonth}
          averageDailyRevenue={breakEven.averageDailyRevenue}
          requiredDailyRevenue={breakEven.requiredDailyRevenuePlanning}
          projectedMonthEndRevenue={breakEven.projectedMonthEndRevenue}
          status={breakEven.status}
        />
      </div>

      {/* Row 3: Action Required Deck and Business Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ActionRequiredFlags flags={flags} />
        <BusinessHealth
          salesHealth={isSalesReported ? 'Healthy' : 'Pending'}
          footfallHealth={totalVisitors > 0 ? 'Healthy' : 'Warning'}
          inventoryHealth={lowStockItems.length > 0 ? 'Warning' : 'Healthy'}
          attendanceHealth={absentStaffCount > 3 ? 'Warning' : 'Healthy'}
          cashHealth="Healthy"
          profitabilityHealth={breakEven.status}
        />
      </div>
    </div>
  );
}
