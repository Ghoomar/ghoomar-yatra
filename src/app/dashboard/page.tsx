'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate, formatINR } from '@/lib/utils';
import { calculateDailyProfitability, calculateBreakEvenPacing, calculateVisitorPacing } from '@/lib/finance-engine';
import { KPICards } from '@/components/dashboard/KPICards';
import { TargetPacing } from '@/components/dashboard/TargetPacing';
import { MonthlyPosition } from '@/components/dashboard/MonthlyPosition';
import { ActionRequiredFlags, ActionFlag } from '@/components/dashboard/ActionRequiredFlags';
import { BusinessHealth } from '@/components/dashboard/BusinessHealth';
import { LayoutDashboard, RefreshCw } from 'lucide-react';

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

      // 6. Fetch attendance for date
      const [{ count: activeCount }, { data: attRecords }, { data: bDay }] = await Promise.all([
        supabase.from('employees').select('*', { count: 'exact', head: true }).eq('employment_status', 'Active'),
        supabase.from('attendance').select('status').eq('business_date', businessDate),
        supabase.from('business_days').select('status').eq('business_date', businessDate).maybeSingle(),
      ]);

      setActiveStaffCount(activeCount || 0);
      setAbsentStaffCount((attRecords || []).filter((a) => a.status === 'Absent').length);
      setIsDayClosed(bDay?.status === 'closed');
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
    revenueLinkedRates: { rentPercent: 0.10, investorSharePercent: 0.08 },
    monthlyFixedAllocations: { totalMonthlySalaries: activeStaffCount * 18000, otherMonthlyFixedCosts: 3500, daysInMonth: 30 },
  });

  const dayOfMonth = parseInt(businessDate.slice(8, 10)) || 1;
  const breakEven = calculateBreakEvenPacing({
    mtdRevenue: revenue * dayOfMonth,
    daysElapsed: dayOfMonth,
    daysInMonth: 30,
    planningBreakEven: 3000000,
    totalMonthlyFixedCosts: (activeStaffCount * 18000) + 3500,
    mtdContributionMargin: (revenue * dayOfMonth) * 0.45,
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
    <div className="space-y-6">
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
          daysInMonth={30}
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
