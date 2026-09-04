import React from 'react';
import { Card, CardDescription } from '@/components/ui/Card';
import { formatINR, formatNumber, formatPercent, formatTimeAgo } from '@/lib/utils';
import { Clock } from 'lucide-react';

interface KPICardsProps {
  revenue: number;
  revenueUpdatedAt?: string;
  isSalesReported: boolean;
  visitors: number;
  visitorsUpdatedAt?: string;
  cars: number;
  carsUpdatedAt?: string;
  spendPerVisitor: number;
  dailyTarget: number;
  achievementPercent: number;
  estimatedNetProfit: number;
  profitMarginPercent: number;
  breakEvenPacingStatus: string;
  projectedMonthEndRevenue: number;
}

export function KPICards({
  revenue,
  revenueUpdatedAt,
  isSalesReported,
  visitors,
  visitorsUpdatedAt,
  cars,
  carsUpdatedAt,
  spendPerVisitor,
  dailyTarget,
  achievementPercent,
  estimatedNetProfit,
  profitMarginPercent,
  breakEvenPacingStatus,
  projectedMonthEndRevenue,
}: KPICardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
      {/* 1. Today's Revenue */}
      <Card className="p-4 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <CardDescription className="font-medium text-stone-600">Today's Revenue</CardDescription>
          <span className="flex items-center gap-1 text-[10px] text-stone-400 font-mono">
            <Clock className="h-3 w-3" /> {formatTimeAgo(revenueUpdatedAt)}
          </span>
        </div>
        <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
          {isSalesReported ? formatINR(revenue) : 'Pending POS'}
        </div>
        <div className="text-[11px] text-stone-500 mt-1 flex items-center justify-between">
          <span>Net Petpooja Sales</span>
          <span className={isSalesReported ? 'text-emerald-700 font-semibold' : 'text-amber-600'}>
            {isSalesReported ? 'Reported' : 'Not entered'}
          </span>
        </div>
      </Card>

      {/* 2. Today's Visitors */}
      <Card className="p-4 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <CardDescription className="font-medium text-stone-600">Today's Footfall</CardDescription>
          <span className="flex items-center gap-1 text-[10px] text-stone-400 font-mono">
            <Clock className="h-3 w-3" /> {formatTimeAgo(visitorsUpdatedAt)}
          </span>
        </div>
        <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
          {formatNumber(visitors)}
        </div>
        <div className="text-[11px] text-stone-500 mt-1 flex items-center justify-between">
          <span>Gate Touch Counter</span>
          <span className="text-stone-700 font-medium">Highway Visitors</span>
        </div>
      </Card>

      {/* 3. Today's Cars */}
      <Card className="p-4 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <CardDescription className="font-medium text-stone-600">Today's Vehicles</CardDescription>
          <span className="flex items-center gap-1 text-[10px] text-stone-400 font-mono">
            <Clock className="h-3 w-3" /> {formatTimeAgo(carsUpdatedAt)}
          </span>
        </div>
        <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
          {formatNumber(cars)}
        </div>
        <div className="text-[11px] text-stone-500 mt-1 flex items-center justify-between">
          <span>Origin Counters</span>
          <span className="text-stone-700 font-medium">Cars Parked</span>
        </div>
      </Card>

      {/* 4. Revenue / Visitor */}
      <Card className="p-4 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <CardDescription className="font-medium text-stone-600">Avg Spend / Person</CardDescription>
          <span className="text-[10px] text-stone-400 font-mono">Target: ₹300</span>
        </div>
        <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
          {formatINR(spendPerVisitor)}
        </div>
        <div className="text-[11px] text-stone-500 mt-1 flex items-center justify-between">
          <span>Revenue ÷ Footfall</span>
          <span className={spendPerVisitor >= 300 ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
            {spendPerVisitor >= 300 ? 'Above ₹300' : 'Below ₹300'}
          </span>
        </div>
      </Card>

      {/* 5. Daily Target */}
      <Card className="p-4">
        <CardDescription className="font-medium text-stone-600">Operational Target</CardDescription>
        <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
          {formatINR(dailyTarget)}
        </div>
        <div className="text-[11px] text-stone-500 mt-1">Configured for weekday</div>
      </Card>

      {/* 6. Target Achievement */}
      <Card className="p-4">
        <CardDescription className="font-medium text-stone-600">Target Achievement</CardDescription>
        <div className={`text-2xl sm:text-3xl font-black mt-1.5 tracking-tight ${achievementPercent >= 100 ? 'text-emerald-700' : 'text-amber-700'}`}>
          {formatPercent(achievementPercent)}
        </div>
        <div className="text-[11px] text-stone-500 mt-1">
          {achievementPercent >= 100 ? 'Daily Goal Met' : `${formatINR(Math.max(0, dailyTarget - revenue))} remaining`}
        </div>
      </Card>

      {/* 7. Estimated Net Profit */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <CardDescription className="font-medium text-stone-600">Estimated Net Profit</CardDescription>
          <span className="text-[10px] text-stone-400 font-mono">Margin: {profitMarginPercent}%</span>
        </div>
        <div className={`text-2xl sm:text-3xl font-black mt-1.5 tracking-tight ${estimatedNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {isSalesReported ? formatINR(estimatedNetProfit) : 'Pending POS'}
        </div>
        <div className="text-[11px] text-stone-500 mt-1">Economic daily net</div>
      </Card>

      {/* 8. Monthly Position */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <CardDescription className="font-medium text-stone-600">Monthly Position</CardDescription>
          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
            breakEvenPacingStatus === 'SAFE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
          }`}>
            {breakEvenPacingStatus}
          </span>
        </div>
        <div className="text-xl sm:text-2xl font-black text-stone-900 mt-1.5 tracking-tight">
          {formatINR(projectedMonthEndRevenue, true)} Proj.
        </div>
        <div className="text-[11px] text-stone-500 mt-1">Vs ₹30L Break-Even</div>
      </Card>
    </div>
  );
}
