'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate, getMonthDateRange } from '@/lib/utils';
import { calculateDailyProfitability, calculateBreakEvenPacing, fetchMTDFinancialSummary } from '@/lib/finance-engine';
import { MTDFinancialSummary } from '@/lib/types/database';
import { useI18n } from '@/lib/i18n/context';
import { isLanchoOrder } from '@/lib/sales/business-units';
import { TrendingUp, RefreshCw, Zap, Receipt, UtensilsCrossed, IndianRupee, Building2 } from 'lucide-react';

const DIESEL_ITEM_ID = 'd1e5e100-0001-4000-a000-000000000001';
const LPG_ITEM_ID = '195c1900-0002-4000-a000-000000000002';

export default function ProfitabilityPage() {
  const supabase = createClient();
  const { t } = useI18n();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [loading, setLoading] = useState(true);
  const [paymentCommissions, setPaymentCommissions] = useState(0);

  // Financial Figures
  const [salesReport, setSalesReport] = useState<any>(null);
  const [materialConsumption, setMaterialConsumption] = useState({
    customerFood: 0,
    staffFood: 0,
    wastage: 0,
    complimentaryFood: 0,
    sampling: 0,
    other: 0,
  });
  const [operationalUtilities, setOperationalUtilities] = useState({
    electricityCost: 0,
    electricityKvah: 0,
    electricityRate: 10,
    generatorDieselCost: 0,
    generatorDieselLiters: 0,
    commercialLpgCost: 0,
    commercialLpgCylinders: 0,
    totalOperationalUtilities: 0,
  });
  const [variableExpenses, setVariableExpenses] = useState(0);
  const [totalSalaries, setTotalSalaries] = useState(68000);
  const [monthlyOtherFixed, setMonthlyOtherFixed] = useState(3500);
  const [, setPlanningBreakEven] = useState(3000000);
  const [healthBufferPercent, setHealthBufferPercent] = useState(10);
  const [rentRate, setRentRate] = useState(0.10);
  const [investorRate, setInvestorRate] = useState(0.08);
  const [mtdSummary, setMtdSummary] = useState<MTDFinancialSummary | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch authoritative sales for business date (Petpooja Executive Summary / Daily Sales Summary)
      const [{ data: execSummary }, { data: salesSummary }] = await Promise.all([
        supabase.from('sales_executive_summaries').select('*').eq('business_date', businessDate).maybeSingle(),
        supabase.from('daily_sales_summary').select('*').eq('business_date', businessDate).maybeSingle(),
      ]);

      const isReported = Boolean(execSummary || salesSummary?.is_reported);
      const subTotal = Number(
        execSummary?.sub_total ??
        (salesSummary ? Number(salesSummary.net_sales || 0) + Number(salesSummary.discounts || 0) : 0)
      );
      const grossSales = Number(execSummary?.grand_total ?? salesSummary?.gross_sales ?? 0);
      const netSales = Number(execSummary?.net_sales ?? salesSummary?.net_sales ?? 0);
      const discounts = Number(execSummary?.discount ?? salesSummary?.discounts ?? 0);
      const taxAmount = Number(
        execSummary?.total_tax ??
        (execSummary?.cgst != null ? Number(execSummary.cgst) + Number(execSummary.sgst || 0) : null) ??
        salesSummary?.tax_amount ??
        0
      );
      const billCount = Number(execSummary?.successful_bills_count ?? salesSummary?.bill_count ?? 0);
      const customerCount = Number(salesSummary?.customer_count ?? 0);

      setSalesReport({
        is_reported: isReported,
        sub_total: subTotal,
        gross_sales: grossSales,
        net_sales: netSales,
        discounts: discounts,
        tax_amount: taxAmount,
        bill_count: billCount,
        customer_count: customerCount,
        source: execSummary ? 'Petpooja Executive Summary' : salesSummary ? 'Petpooja Daily Summary' : 'No Sales Data',
      });

      // 2. Fetch stock movements for this date (Material Consumption & Fuel Issues)
      const { data: movs } = await supabase
        .from('stock_movements')
        .select('item_id, movement_type, purpose, total_value, quantity')
        .eq('business_date', businessDate);

      let cust = 0;
      let staff = 0;
      let waste = 0;
      let comp = 0;
      let sample = 0;
      let other = 0;
      let dieselCost = 0;
      let dieselLiters = 0;
      let lpgCost = 0;
      let lpgCylinders = 0;

      (movs || []).forEach((m) => {
        if (['transfer', 'purchase', 'opening', 'return', 'count_adjustment', 'physical_count_adjustment'].includes(m.movement_type)) {
          return;
        }
        const val = Math.abs(Number(m.total_value)) || 0;
        const qty = Math.abs(Number(m.quantity)) || 0;

        if (m.item_id === DIESEL_ITEM_ID || m.purpose === 'Generator Fuel') {
          dieselCost += val;
          dieselLiters += qty;
        } else if (m.item_id === LPG_ITEM_ID || m.purpose === 'Kitchen Gas') {
          lpgCost += val;
          lpgCylinders += qty;
        } else if (m.purpose === 'Customer Food') {
          cust += val;
        } else if (m.purpose === 'Staff Food' || m.movement_type === 'staff_food') {
          staff += val;
        } else if (m.purpose === 'Wastage' || m.purpose === 'Spoilage' || m.movement_type === 'wastage' || m.movement_type === 'spoilage') {
          waste += val;
        } else if (m.purpose === 'Complimentary Food') {
          comp += val;
        } else if (m.purpose === 'Sampling') {
          sample += val;
        } else {
          other += val;
        }
      });

      setMaterialConsumption({
        customerFood: cust,
        staffFood: staff,
        wastage: waste,
        complimentaryFood: comp,
        sampling: sample,
        other: other,
      });

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
      setTotalSalaries(payroll > 0 ? payroll : 68000);

      // 5. Fetch Authoritative MTD Summary, Fixed Cost Rules, Electricity Ledger & Break-Even Targets
      const [mtdRes, { data: costRules }, { data: bepTarget }, { data: bufferTarget }, { data: elecReadings }] = await Promise.all([
        fetchMTDFinancialSummary(supabase, businessDate),
        supabase.from('financial_cost_rules').select('*').eq('is_active', true),
        supabase.from('financial_targets').select('target_value').eq('target_type', 'monthly_break_even').eq('is_active', true).maybeSingle(),
        supabase.from('financial_targets').select('target_value').eq('target_type', 'break_even_health_buffer_percent').eq('is_active', true).maybeSingle(),
        supabase.from('meter_readings_ledger').select('delta_consumption').eq('business_date', businessDate),
      ]);

      setMtdSummary(mtdRes);
      if (bufferTarget?.target_value) {
        setHealthBufferPercent(Number(bufferTarget.target_value) || 10);
      }

      // Calculate Electricity Cost from Continuous Ledger & Configured Rule
      const totalKvah = (elecReadings || []).reduce((sum, r) => sum + (Number(r.delta_consumption) || 0), 0);
      let elecRate = 10.00;

      if (costRules && costRules.length > 0) {
        const fixedRules = costRules.filter((r) => r.cost_classification === 'Fixed');
        const fixedSum = fixedRules.reduce((sum, r) => sum + (Number(r.amount_or_rate) || 0), 0);
        if (fixedSum > 0) setMonthlyOtherFixed(fixedSum);

        const rentRule = costRules.find((r) => r.category === 'Rent' && r.calculation_method === 'percentage_of_revenue');
        if (rentRule) setRentRate(Number(rentRule.amount_or_rate) || 0.10);

        const investorRule = costRules.find((r) => r.category === 'Finance' && r.calculation_method === 'percentage_of_revenue');
        if (investorRule) setInvestorRate(Number(investorRule.amount_or_rate) || 0.08);

        const elecCostRule = costRules.find((r) => r.category === 'Utilities' && r.calculation_method === 'meter_based');
        if (elecCostRule) elecRate = Number(elecCostRule.amount_or_rate) || 10.00;
      }

      const totalElecCost = totalKvah * elecRate;
      setOperationalUtilities({
        electricityCost: totalElecCost,
        electricityKvah: totalKvah,
        electricityRate: elecRate,
        generatorDieselCost: dieselCost,
        generatorDieselLiters: dieselLiters,
        commercialLpgCost: lpgCost,
        commercialLpgCylinders: lpgCylinders,
        totalOperationalUtilities: totalElecCost + dieselCost + lpgCost,
      });

      if (bepTarget?.target_value) {
        setPlanningBreakEven(Number(bepTarget.target_value) || 3000000);
      }

      // 6. Fetch Payment Methods & Sales Orders for Dynamic Commission Calculation (Lancho & Card MDR)
      const [
        { data: pMethods },
        { data: dayOrders },
      ] = await Promise.all([
        supabase.from('payment_methods').select('name, commission_percent').eq('is_active', true),
        supabase.from('sales_orders').select('order_type, area, payment_type, net_sales, status').eq('business_date', businessDate),
      ]);

      let totalComm = 0;
      const lanchoMethod = (pMethods || []).find((p) => p.name.toLowerCase() === 'lancho');
      const lanchoRate = lanchoMethod && lanchoMethod.commission_percent != null && !isNaN(Number(lanchoMethod.commission_percent))
        ? Number(lanchoMethod.commission_percent)
        : 18.0;

      const cardMethod = (pMethods || []).find((p) => p.name.toLowerCase() === 'card');
      const cardRate = cardMethod && cardMethod.commission_percent != null && !isNaN(Number(cardMethod.commission_percent))
        ? Number(cardMethod.commission_percent)
        : 1.5;

      if (dayOrders && dayOrders.length > 0) {
        dayOrders.forEach((o) => {
          if (o.status !== 'Success') return;
          const net = Number(o.net_sales) || 0;
          if (isLanchoOrder(o)) {
            totalComm += net * (lanchoRate / 100);
          } else if ((o.payment_type || '').toLowerCase().includes('card')) {
            totalComm += net * (cardRate / 100);
          }
        });
      } else if (execSummary?.payment_mode_breakdown) {
        const pmb = execSummary.payment_mode_breakdown as Record<string, number>;
        Object.entries(pmb).forEach(([mode, amount]) => {
          const mLower = mode.toLowerCase();
          const amt = Number(amount) || 0;
          if (mLower.includes('lancho')) {
            totalComm += amt * (lanchoRate / 100);
          } else if (mLower.includes('card')) {
            totalComm += amt * (cardRate / 100);
          }
        });
      }

      setPaymentCommissions(Math.round(totalComm * 100) / 100);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const { daysInMonth, daysElapsed } = getMonthDateRange(businessDate);

  const pnl = calculateDailyProfitability({
    businessDate,
    isReported: Boolean(salesReport?.is_reported),
    grossSales: Number(salesReport?.gross_sales) || 0,
    discounts: Number(salesReport?.discounts) || 0,
    netSales: Number(salesReport?.net_sales) || 0,
    paymentCommissions: paymentCommissions,
    customerFoodConsumption: materialConsumption.customerFood,
    staffFoodConsumption: materialConsumption.staffFood,
    wastageCost: materialConsumption.wastage,
    complimentaryFoodConsumption: materialConsumption.complimentaryFood,
    samplingConsumption: materialConsumption.sampling,
    otherConsumption: materialConsumption.other,
    operationalUtilities: operationalUtilities,
    variableExpenses: variableExpenses,
    revenueLinkedRates: {
      rentPercent: rentRate,
      investorSharePercent: investorRate,
    },
    monthlyFixedAllocations: {
      totalMonthlySalaries: totalSalaries,
      otherMonthlyFixedCosts: monthlyOtherFixed,
      daysInMonth: daysInMonth,
    },
  });

  const mtdNetSales = mtdSummary ? mtdSummary.mtd_net_sales : (salesReport?.is_reported ? pnl.revenue : 0);
  const mtdContribution = mtdSummary && mtdSummary.mtd_gross_operating_surplus > 0
    ? mtdSummary.mtd_gross_operating_surplus
    : (salesReport?.is_reported ? pnl.revenue - pnl.totalDirectConsumption - pnl.totalVariableExpenses : 0);

  const breakEven = calculateBreakEvenPacing({
    mtdRevenue: mtdNetSales,
    daysElapsed: daysElapsed,
    daysInMonth: daysInMonth,
    daysReported: mtdSummary?.days_reported,
    healthBufferPercent: healthBufferPercent,
    totalMonthlyFixedCosts: totalSalaries + monthlyOtherFixed,
    mtdContributionMargin: mtdContribution,
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-amber-600" />
            {t('finance.profitability.title')}
          </h1>
          <p className="text-xs text-stone-500 mt-0.5">
            {t('finance.profitability.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-2xs text-xs font-medium">
            <span className="text-stone-500">{t('finance.profitability.dateLabel')}</span>
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
          <CardDescription>{t('finance.profitability.ebitda')}</CardDescription>
          <div className={`text-3xl font-black mt-1 ${pnl.estimatedNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {pnl.isReported ? formatINR(pnl.estimatedNetProfit) : '—'}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            {pnl.isReported ? `Margin: ${pnl.netProfitMarginPercent}%` : t('statuses.notReported')}
          </div>
        </Card>

        <Card>
          <CardDescription>{t('finance.profitability.foodMaterialCost')}</CardDescription>
          <div className="text-3xl font-bold text-stone-900 mt-1">
            {pnl.foodCostPercent}%
          </div>
        </Card>

        <Card>
          <CardDescription>{t('finance.profitability.pacing')}</CardDescription>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={
              breakEven.status === 'HEALTHY' || breakEven.status === 'Healthy' || breakEven.status === 'ON TARGET' ? 'success' :
              breakEven.status === 'AT RISK' || breakEven.status === 'At Risk' || breakEven.status === 'BELOW TARGET' ? 'warning' :
              breakEven.status === 'BELOW BREAK-EVEN' || breakEven.status === 'Below Break-Even' ? 'danger' : 'default'
            } className="text-xs py-1 px-2.5 font-bold">
              {breakEven.status}
            </Badge>
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            Projected: <strong>{formatINR(breakEven.projectedMonthEndRevenue, true)}</strong> (BEP: {formatINR(breakEven.calculatedBreakEven, true)})
          </div>
        </Card>
      </div>

      {/* P&L Waterfall Breakdown */}
      <Card>
        <div className="divide-y divide-stone-100 text-xs sm:text-sm">
          {/* Revenue */}
          <div className="py-3.5 space-y-2.5 px-2">
            <div className="flex items-center justify-between font-bold text-stone-900">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-emerald-600" />
                <span className="tracking-wider uppercase text-xs sm:text-sm font-bold text-stone-900">
                  {t('finance.profitability.revenueBridge')}
                </span>
                {pnl.isReported ? (
                  <Badge variant="success" className="text-[10px] font-medium">
                    Petpooja
                  </Badge>
                ) : (
                  <Badge variant="danger" className="text-[10px] font-medium">
                    {t('statuses.pending')}
                  </Badge>
                )}
              </div>
              {!pnl.isReported && (
                <span className="text-stone-400 text-sm font-semibold">{t('statuses.notReported')}</span>
              )}
            </div>

            {pnl.isReported && salesReport && (
              <div className="space-y-2 pt-0.5">
                {/* Sales Before Discounts and Discounts */}
                <div className="pl-4 space-y-1 text-xs">
                  <div className="flex items-center justify-between text-stone-700">
                    <span>{t('finance.profitability.salesBeforeDiscounts')}</span>
                    <span className="font-mono font-medium text-stone-900">{formatINR(salesReport.sub_total)}</span>
                  </div>
                  <div className="flex items-center justify-between text-stone-500">
                    <span>{t('finance.profitability.lessDiscounts')}</span>
                    <span className="font-mono text-rose-600">− {formatINR(salesReport.discounts || 0)}</span>
                  </div>
                </div>

                {/* Net Sales */}
                <div className="pt-2 border-t border-stone-200 flex items-center justify-between font-bold text-stone-900 bg-stone-50/70 px-2.5 py-2 rounded-lg">
                  <span className="font-bold text-stone-900">{t('finance.profitability.netSales')}</span>
                  <span className="text-emerald-700 text-base font-extrabold font-mono">
                    {formatINR(pnl.revenue)}
                  </span>
                </div>

                {/* Informational Taxes & Billed Amount */}
                <div className="pl-4 pt-1 space-y-1 text-xs">
                  <div className="flex items-center justify-between text-stone-600">
                    <span>{t('finance.profitability.taxesCollected')}</span>
                    <span className="font-mono text-stone-800">{formatINR(salesReport.tax_amount || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-stone-700 font-medium">
                    <span>{t('finance.profitability.grossBillValue')}</span>
                    <span className="font-mono text-stone-900">{formatINR(salesReport.gross_sales)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Direct Material Consumption */}
          <div className="py-3.5 space-y-2 px-2">
            <div className="flex items-center justify-between font-semibold text-stone-800">
              <div className="flex items-center gap-2">
                <UtensilsCrossed className="h-4 w-4 text-amber-600" />
                <span>{t('finance.profitability.foodMaterialCost')}</span>
              </div>
              <span className="text-rose-600">− {formatINR(pnl.totalDirectConsumption)}</span>
            </div>
            <div className="pl-4 space-y-1 text-xs text-stone-500">
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.customerFood')}</span>
                <span className="font-mono text-stone-700">{formatINR(pnl.customerFoodConsumption)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.complimentary')}</span>
                <span className="font-mono text-stone-700">{formatINR(pnl.complimentaryFoodConsumption)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.staffFood')}</span>
                <span className="font-mono text-stone-700">{formatINR(pnl.staffFoodConsumption)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.wastageSpoilage')}</span>
                <span className="font-mono text-stone-700">{formatINR(pnl.wastageCost)}</span>
              </div>
              {pnl.otherConsumption > 0 && (
                <div className="flex items-center justify-between">
                  <span>• Operational Consumption</span>
                  <span className="font-mono text-stone-700">{formatINR(pnl.otherConsumption)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Operational Utilities & Fuel Costs */}
          <div className="py-3.5 space-y-2 px-2">
            <div className="flex items-center justify-between font-semibold text-stone-800">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-600" />
                <span>{t('finance.profitability.utilities')}</span>
              </div>
              <span className="text-rose-600">− {formatINR(pnl.operationalUtilities.totalOperationalUtilities)}</span>
            </div>
            <div className="pl-4 space-y-1 text-xs text-stone-500">
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.electricity')} ({operationalUtilities.electricityKvah.toFixed(1)} KVAH × {formatINR(operationalUtilities.electricityRate)}/KVAH)</span>
                <span className="font-mono text-stone-700">{formatINR(pnl.operationalUtilities.electricityCost)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.dieselGen')} ({operationalUtilities.generatorDieselLiters.toFixed(1)} L)</span>
                <span className="font-mono text-stone-700">{formatINR(pnl.operationalUtilities.generatorDieselCost)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.commercialLpg')} ({operationalUtilities.commercialLpgCylinders} Cyl)</span>
                <span className="font-mono text-stone-700">{formatINR(pnl.operationalUtilities.commercialLpgCost)}</span>
              </div>
            </div>
          </div>

          {/* Variable Expenses */}
          <div className="py-3.5 space-y-2 px-2">
            <div className="flex items-center justify-between font-semibold text-stone-800">
              <div className="flex items-center gap-2">
                <IndianRupee className="h-4 w-4 text-amber-600" />
                <span>{t('finance.profitability.operationalExpenses')}</span>
              </div>
              <span className="text-rose-600">− {formatINR(pnl.totalVariableExpenses)}</span>
            </div>
            <div className="pl-4 space-y-1 text-xs text-stone-500">
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.rentShare', { percent: (rentRate * 100).toFixed(0) })}</span>
                <span>{formatINR(pnl.revenue * rentRate)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.investorShare', { percent: (investorRate * 100).toFixed(0) })}</span>
                <span>{formatINR(pnl.revenue * investorRate)}</span>
              </div>
              {paymentCommissions > 0 && (
                <div className="flex items-center justify-between">
                  <span>• Gateway &amp; Channel Commissions (MDR / Lancho)</span>
                  <span className="font-mono text-stone-700">{formatINR(paymentCommissions)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.otherVariableExps')}</span>
                <span>{formatINR(variableExpenses)}</span>
              </div>
            </div>
          </div>

          {/* Allocated Monthly Overheads */}
          <div className="py-3.5 space-y-2 px-2">
            <div className="flex items-center justify-between font-semibold text-stone-800">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-amber-600" />
                <span>{t('finance.profitability.payrollFixed')}</span>
              </div>
              <span className="text-rose-600">− {formatINR(pnl.dailyAllocatedFixedCosts)}</span>
            </div>
            <div className="pl-4 space-y-1 text-xs text-stone-500">
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.staffSalaries')} ({formatINR(totalSalaries)} ÷ {daysInMonth} days)</span>
                <span>{formatINR(totalSalaries / daysInMonth)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>• {t('finance.profitability.otherFixed')} ({formatINR(monthlyOtherFixed)} ÷ {daysInMonth} days)</span>
                <span>{formatINR(monthlyOtherFixed / daysInMonth)}</span>
              </div>
            </div>
          </div>

          {/* Final Bottom Line */}
          <div className="py-4 flex items-center justify-between font-extrabold text-base bg-stone-100 px-3 rounded-xl">
            <div className="flex items-center gap-2">
              <TrendingUp className={`h-4 w-4 ${pnl.estimatedNetProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} />
              <span className="text-stone-900">{t('finance.profitability.ebitda')}</span>
            </div>
            <span className={pnl.estimatedNetProfit >= 0 ? 'text-emerald-700 text-lg' : 'text-rose-600 text-lg'}>
              {formatINR(pnl.estimatedNetProfit)}
            </span>
          </div>
        </div>
      </Card>

      {/* Break-Even Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>{t('finance.profitability.pacing')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-xs space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
              <div className="text-xs font-bold text-stone-700 uppercase">
                {t('finance.profitability.pacingTarget', { target: `${formatINR(breakEven.calculatedBreakEven)}/mo` })}
              </div>
              <p className="text-stone-500 text-[11px]">
                {breakEven.requiredDailyRevenue > 0
                  ? <>Requires <strong>{formatINR(breakEven.requiredDailyRevenue)}/day</strong> across {breakEven.daysRemaining} days remaining.</>
                  : <>Break-Even reached for the month.</>
                }
              </p>
            </div>

            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
              <div className="text-xs font-bold text-stone-700 uppercase">{t('dashboard.monthlyPosition.bepProgressPercent')}</div>
              <div className={`text-2xl font-black ${breakEven.breakEvenProgressPercent >= 100 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {breakEven.breakEvenProgressPercent}%
              </div>
              <p className="text-stone-500 text-[11px]">
                Projected: <strong>{formatINR(breakEven.projectedMonthEndRevenue, true)}</strong>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
