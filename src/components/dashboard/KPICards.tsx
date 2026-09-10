import React from 'react';
import Link from 'next/link';
import { Card, CardDescription } from '@/components/ui/Card';
import { formatINR, formatNumber, formatPercent, formatTimeAgo } from '@/lib/utils';
import { Clock, ChevronRight } from 'lucide-react';
import { BreakEvenStatus } from '@/lib/types/database';

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
  breakEvenPacingStatus: BreakEvenStatus | string;
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
  const getBadgeClass = (status: BreakEvenStatus | string) => {
    switch (status) {
      case 'Healthy':
        return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      case 'At Risk':
        return 'bg-amber-100 text-amber-800 border border-amber-200';
      case 'Below Break-Even':
      default:
        return 'bg-rose-100 text-rose-800 border border-rose-200';
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
      {/* 1. Today's Revenue -> /finance/sales */}
      <Link
        href="/finance/sales"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 relative overflow-hidden transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-600 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              Today's Revenue
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
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
      </Link>

      {/* 2. Today's Visitors -> /operations/gate */}
      <Link
        href="/operations/gate"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 relative overflow-hidden transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-600 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              Today's Footfall
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
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
      </Link>

      {/* 3. Today's Cars -> /operations/gate */}
      <Link
        href="/operations/gate"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 relative overflow-hidden transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-600 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              Today's Vehicles
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
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
      </Link>

      {/* 4. Revenue / Visitor -> /finance/profitability */}
      <Link
        href="/finance/profitability"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 relative overflow-hidden transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-600 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              Avg Spend / Person
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
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
      </Link>

      {/* 5. Daily Target -> /admin */}
      <Link
        href="/admin"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <CardDescription className="font-medium text-stone-600 group-hover:text-amber-700 transition-colors flex items-center gap-1">
            Operational Target
            <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
          </CardDescription>
          <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
            {formatINR(dailyTarget)}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Configured for weekday</div>
        </Card>
      </Link>

      {/* 6. Target Achievement -> /finance/profitability */}
      <Link
        href="/finance/profitability"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <CardDescription className="font-medium text-stone-600 group-hover:text-amber-700 transition-colors flex items-center gap-1">
            Target Achievement
            <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
          </CardDescription>
          <div className={`text-2xl sm:text-3xl font-black mt-1.5 tracking-tight ${achievementPercent >= 100 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {formatPercent(achievementPercent)}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            {achievementPercent >= 100 ? 'Daily Goal Met' : `${formatINR(Math.max(0, dailyTarget - revenue))} remaining`}
          </div>
        </Card>
      </Link>

      {/* 7. Estimated Net Profit -> /finance/profitability */}
      <Link
        href="/finance/profitability"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-600 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              Estimated Net Profit
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
            <span className="text-[10px] text-stone-400 font-mono">Margin: {profitMarginPercent}%</span>
          </div>
          <div className={`text-2xl sm:text-3xl font-black mt-1.5 tracking-tight ${estimatedNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {isSalesReported ? formatINR(estimatedNetProfit) : 'Pending POS'}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Economic daily net</div>
        </Card>
      </Link>

      {/* 8. Monthly Position -> /reports */}
      <Link
        href="/reports"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-600 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              Monthly Position
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${getBadgeClass(breakEvenPacingStatus)}`}>
              {breakEvenPacingStatus}
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-stone-900 mt-1.5 tracking-tight">
            {formatINR(projectedMonthEndRevenue, true)} Proj.
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Vs ₹30L Break-Even</div>
        </Card>
      </Link>
    </div>
  );
}
