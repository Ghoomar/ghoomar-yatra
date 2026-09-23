'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatINR } from '@/lib/utils';
import { MonthlyPerformanceStatus } from '@/lib/finance-engine';

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

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Monthly Performance</CardTitle>
          <Badge variant={getBadgeVariant(status)}>
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {/* 1. Month-to-Date Revenue */}
          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Month-to-Date Revenue</div>
            <div className="text-base sm:text-lg font-bold text-stone-900 mt-0.5">{formatINR(mtdRevenue)}</div>
            <div className="text-[10px] text-stone-400">Day {daysElapsed} of {daysInMonth}</div>
          </div>

          {/* 2. Average Daily Revenue */}
          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Average Daily Revenue</div>
            <div className="text-base sm:text-lg font-bold text-stone-900 mt-0.5">{formatINR(averageDailyRevenue)}</div>
            <div className="text-[10px] text-stone-400">
              {daysReported > 0 ? `Based on ${daysReported} reported days` : 'No reported days'}
            </div>
          </div>

          {/* 3. Required Daily Revenue */}
          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Required Daily Revenue</div>
            <div className="text-base sm:text-lg font-bold text-amber-700 mt-0.5">{formatINR(requiredDailyRevenue)}</div>
            <div className="text-[10px] text-stone-400">
              {remainingDays > 0 ? `Required over the next ${remainingDays} days` : 'Month completed'}
            </div>
          </div>

          {/* 4. Projected Month-End Revenue */}
          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Projected Month-End Revenue</div>
            <div className="text-base sm:text-lg font-bold text-stone-900 mt-0.5">{formatINR(projectedMonthEndRevenue)}</div>
            <div className="text-[10px] text-stone-400">At current average daily revenue</div>
          </div>
        </div>

        {/* Bottom Summary Strip: Single Benchmark = Calculated Break-Even Point */}
        <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-stone-700 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <span className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider block">
              Calculated Break-Even Point
            </span>
            <div className="font-extrabold text-stone-900 text-base mt-0.5">
              {formatINR(calculatedBreakEven)}
            </div>
          </div>

          <div className="sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-stone-200">
            <span className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider block">
              % Break-Even Progress
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
