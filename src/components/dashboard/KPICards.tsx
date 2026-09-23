'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardDescription } from '@/components/ui/Card';
import { formatINR, formatNumber, formatPercent, formatTimeAgo } from '@/lib/utils';
import { Clock, ChevronRight } from 'lucide-react';
import { BreakEvenStatus } from '@/lib/types/database';
import { useI18n } from '@/lib/i18n/context';

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
  calculatedBreakEven?: number;
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
  calculatedBreakEven,
}: KPICardsProps) {
  const { t } = useI18n();

  const getBadgeClass = (status: BreakEvenStatus | string) => {
    const norm = (status || '').toUpperCase();
    switch (norm) {
      case 'HEALTHY':
      case 'ON TARGET':
        return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      case 'AT RISK':
      case 'BELOW TARGET':
        return 'bg-amber-100 text-amber-800 border border-amber-200';
      case 'BELOW BREAK-EVEN':
        return 'bg-rose-100 text-rose-800 border border-rose-200';
      case 'NOT REPORTED':
      default:
        return 'bg-stone-100 text-stone-700 border border-stone-200';
    }
  };

  const getLocalizedPacingStatus = (status: BreakEvenStatus | string) => {
    const norm = (status || '').toUpperCase();
    switch (norm) {
      case 'HEALTHY':
        return t('dashboard.health.statusHealthy');
      case 'ON TARGET':
        return t('dashboard.health.statusOnTarget');
      case 'AT RISK':
        return t('dashboard.health.statusAtRisk');
      case 'BELOW TARGET':
        return t('dashboard.health.statusBelowTarget');
      case 'BELOW BREAK-EVEN':
        return t('dashboard.health.statusBelowBreakEven');
      case 'NOT REPORTED':
        return t('dashboard.health.statusNotReported');
      default:
        return status;
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
      {/* 1. Today's Sales -> /finance/sales */}
      <Link
        href="/finance/sales"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 relative overflow-hidden transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-500 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              {t('dashboard.kpis.todaysSales')}
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
            <span className="flex items-center gap-1 text-[10px] text-stone-400 font-mono">
              <Clock className="h-3 w-3" /> {formatTimeAgo(revenueUpdatedAt)}
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
            {isSalesReported ? formatINR(revenue) : t('dashboard.kpis.pendingPos')}
          </div>
          <div className="text-[11px] mt-1">
            <span className={isSalesReported ? 'text-emerald-700 font-medium' : 'text-amber-600 font-medium'}>
              {isSalesReported ? t('dashboard.kpis.reported') : t('dashboard.kpis.notEntered')}
            </span>
          </div>
        </Card>
      </Link>

      {/* 2. Footfall -> /operations/gate */}
      <Link
        href="/operations/gate"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 relative overflow-hidden transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-500 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              {t('dashboard.kpis.visitors')}
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
            <span className="flex items-center gap-1 text-[10px] text-stone-400 font-mono">
              <Clock className="h-3 w-3" /> {formatTimeAgo(visitorsUpdatedAt)}
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
            {formatNumber(visitors)}
          </div>
        </Card>
      </Link>

      {/* 3. Vehicles -> /operations/gate */}
      <Link
        href="/operations/gate"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 relative overflow-hidden transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-500 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              {t('dashboard.kpis.vehicles')}
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
            <span className="flex items-center gap-1 text-[10px] text-stone-400 font-mono">
              <Clock className="h-3 w-3" /> {formatTimeAgo(carsUpdatedAt)}
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
            {formatNumber(cars)}
          </div>
        </Card>
      </Link>

      {/* 4. Spend / Guest -> /finance/profitability */}
      <Link
        href="/finance/profitability"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 relative overflow-hidden transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-500 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              {t('dashboard.kpis.spendPerVisitor')}
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
            <span className="text-[10px] text-stone-400 font-mono">{t('dashboard.kpis.targetSpend', { target: 300 })}</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
            {formatINR(spendPerVisitor)}
          </div>
          <div className="text-[11px] mt-1">
            <span className={spendPerVisitor >= 300 ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
              {spendPerVisitor >= 300 ? t('dashboard.kpis.aboveTarget') : t('dashboard.kpis.belowTarget')}
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
          <CardDescription className="font-medium text-stone-500 group-hover:text-amber-700 transition-colors flex items-center gap-1">
            {t('dashboard.kpis.dailyTarget')}
            <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
          </CardDescription>
          <div className="text-2xl sm:text-3xl font-black text-stone-900 mt-1.5 tracking-tight">
            {formatINR(dailyTarget)}
          </div>
        </Card>
      </Link>

      {/* 6. Target Progress -> /finance/profitability */}
      <Link
        href="/finance/profitability"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <CardDescription className="font-medium text-stone-500 group-hover:text-amber-700 transition-colors flex items-center gap-1">
            {t('dashboard.kpis.targetProgress')}
            <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
          </CardDescription>
          <div className={`text-2xl sm:text-3xl font-black mt-1.5 tracking-tight ${achievementPercent >= 100 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {formatPercent(achievementPercent)}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            {achievementPercent >= 100 ? t('dashboard.kpis.goalMet') : t('dashboard.kpis.remaining', { amount: formatINR(Math.max(0, dailyTarget - revenue)) })}
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
            <CardDescription className="font-medium text-stone-500 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              {t('dashboard.kpis.estimatedNetProfit')}
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
            <span className="text-[10px] text-stone-400 font-mono">{t('dashboard.kpis.profitMargin', { percent: profitMarginPercent })}</span>
          </div>
          <div className={`text-2xl sm:text-3xl font-black mt-1.5 tracking-tight ${estimatedNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {isSalesReported ? formatINR(estimatedNetProfit) : t('dashboard.kpis.pendingPos')}
          </div>
        </Card>
      </Link>

      {/* 8. Monthly Performance -> /reports */}
      <Link
        href="/reports"
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xl touch-manipulation"
      >
        <Card className="p-4 transition-all group-hover:border-amber-400/80 group-hover:shadow-md active:scale-[0.99] h-full">
          <div className="flex items-center justify-between">
            <CardDescription className="font-medium text-stone-500 group-hover:text-amber-700 transition-colors flex items-center gap-1">
              {t('dashboard.kpis.monthlyPerformance')}
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
            </CardDescription>
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${getBadgeClass(breakEvenPacingStatus)}`}>
              {getLocalizedPacingStatus(breakEvenPacingStatus)}
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-stone-900 mt-1.5 tracking-tight">
            {formatINR(projectedMonthEndRevenue, true)} {t('dashboard.kpis.projectedSuffix')}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            {calculatedBreakEven ? t('dashboard.kpis.bepLabel', { amount: formatINR(calculatedBreakEven, true) }) : t('dashboard.kpis.calcBreakEven')}
          </div>
        </Card>
      </Link>
    </div>
  );
}
