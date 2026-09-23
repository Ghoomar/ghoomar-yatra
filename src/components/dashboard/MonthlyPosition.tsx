'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatINR } from '@/lib/utils';
import { MonthlyPerformanceStatus } from '@/lib/finance-engine';
import { useI18n } from '@/lib/i18n/context';

export interface MonthlyPerformanceProps {
  calculatedBreakEven: number;
  mtdRevenue: number;
  daysElapsed: number;
  daysInMonth: number;
  daysReported?: number;
  averageDailyRevenue: number;
  requiredDailyRevenue: number;
  projectedMonthEndRevenue: number;
  breakEvenProgressPercent?: number;
  status: MonthlyPerformanceStatus | string;
  // Deprecated backwards-compatibility props
  monthlyRevenueTarget?: number;
  planningBreakEven?: number;
}

export function MonthlyPerformance({
  calculatedBreakEven,
  mtdRevenue,
  daysElapsed,
  daysInMonth,
  daysReported = 0,
  averageDailyRevenue,
  requiredDailyRevenue,
  projectedMonthEndRevenue,
  breakEvenProgressPercent,
  status,
}: MonthlyPerformanceProps) {
  const { t } = useI18n();
  const remainingDays = Math.max(0, daysInMonth - daysElapsed);
  const progress = breakEvenProgressPercent ?? (calculatedBreakEven > 0 ? Math.round((projectedMonthEndRevenue / calculatedBreakEven) * 100) : 0);

  const getBadgeVariant = (s: string): 'success' | 'warning' | 'danger' | 'info' | 'default' => {
    const norm = (s || '').toUpperCase();
    switch (norm) {
      case 'HEALTHY':
      case 'ON TARGET':
        return 'success';
      case 'AT RISK':
      case 'BELOW TARGET':
        return 'warning';
      case 'BELOW BREAK-EVEN':
        return 'danger';
      case 'NOT REPORTED':
      default:
        return 'default';
    }
  };

  const getLocalizedStatus = (s: string) => {
    const norm = (s || '').toUpperCase();
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
        return s;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>{t('dashboard.monthlyPosition.performanceTitle')}</CardTitle>
          <Badge variant={getBadgeVariant(status)}>
            {getLocalizedStatus(status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {/* 1. Month-to-Date Revenue */}
          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">{t('dashboard.monthlyPosition.mtdRevenue')}</div>
            <div className="text-base sm:text-lg font-bold text-stone-900 mt-0.5">{formatINR(mtdRevenue)}</div>
            <div className="text-[10px] text-stone-400">
              {t('dashboard.monthlyPosition.dayProgress', { days: daysElapsed, total: daysInMonth })}
            </div>
          </div>

          {/* 2. Average Daily Revenue */}
          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">{t('dashboard.monthlyPosition.averageDaily')}</div>
            <div className="text-base sm:text-lg font-bold text-stone-900 mt-0.5">{formatINR(averageDailyRevenue)}</div>
            <div className="text-[10px] text-stone-400">
              {daysReported > 0 ? t('dashboard.monthlyPosition.basedOnReported', { count: daysReported }) : t('dashboard.monthlyPosition.noReportedDays')}
            </div>
          </div>

          {/* 3. Required Daily Revenue */}
          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">{t('dashboard.monthlyPosition.requiredDaily')}</div>
            <div className="text-base sm:text-lg font-bold text-amber-700 mt-0.5">{formatINR(requiredDailyRevenue)}</div>
            <div className="text-[10px] text-stone-400">
              {remainingDays > 0 ? t('dashboard.monthlyPosition.requiredRemaining', { days: remainingDays }) : t('dashboard.monthlyPosition.monthCompleted')}
            </div>
          </div>

          {/* 4. Projected Month-End Revenue */}
          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">{t('dashboard.monthlyPosition.projectedMonthEnd')}</div>
            <div className="text-base sm:text-lg font-bold text-stone-900 mt-0.5">{formatINR(projectedMonthEndRevenue)}</div>
            <div className="text-[10px] text-stone-400">{t('dashboard.monthlyPosition.atCurrentAvg')}</div>
          </div>
        </div>

        {/* Bottom Summary Strip: Single Benchmark = Calculated Break-Even Point */}
        <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-stone-700 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <span className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider block">
              {t('dashboard.monthlyPosition.calcBreakEvenPoint')}
            </span>
            <div className="font-extrabold text-stone-900 text-base mt-0.5">
              {formatINR(calculatedBreakEven)}
            </div>
          </div>

          <div className="sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-stone-200">
            <span className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider block">
              {t('dashboard.monthlyPosition.bepProgressPercent')}
            </span>
            <div className="font-extrabold text-stone-900 text-base mt-0.5">
              <span className={progress >= 100 ? 'text-emerald-700' : 'text-rose-700'}>
                {progress}%
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Backwards compatibility alias
export const MonthlyPosition = MonthlyPerformance;
