import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatINR } from '@/lib/utils';

interface MonthlyPositionProps {
  planningBreakEven: number;
  calculatedBreakEven: number;
  mtdRevenue: number;
  daysElapsed: number;
  daysInMonth: number;
  averageDailyRevenue: number;
  requiredDailyRevenue: number;
  projectedMonthEndRevenue: number;
  status: 'Healthy' | 'At Risk' | 'Below Break-Even';
}

export function MonthlyPosition({
  planningBreakEven,
  calculatedBreakEven,
  mtdRevenue,
  daysElapsed,
  daysInMonth,
  averageDailyRevenue,
  requiredDailyRevenue,
  projectedMonthEndRevenue,
  status,
}: MonthlyPositionProps) {
  const remainingDays = Math.max(0, daysInMonth - daysElapsed);
  const percentOfTarget = planningBreakEven > 0 ? Math.round((mtdRevenue / planningBreakEven) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Monthly Break-Even Pacing</CardTitle>
          <Badge variant={status === 'Healthy' ? 'success' : status === 'At Risk' ? 'warning' : 'danger'}>
            {status.toUpperCase()}
          </Badge>
        </div>
        <CardDescription>Month-to-date position vs break-even requirement</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-2 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">MTD Revenue</div>
            <div className="text-base sm:text-lg font-bold text-stone-900 mt-0.5">{formatINR(mtdRevenue)}</div>
            <div className="text-[10px] text-stone-400">Day {daysElapsed} of {daysInMonth}</div>
          </div>

          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Current Daily Avg</div>
            <div className="text-base sm:text-lg font-bold text-stone-900 mt-0.5">{formatINR(averageDailyRevenue)}</div>
            <div className="text-[10px] text-stone-400">Achieved pace</div>
          </div>

          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Required Avg/Day</div>
            <div className="text-base sm:text-lg font-bold text-amber-700 mt-0.5">{formatINR(requiredDailyRevenue)}</div>
            <div className="text-[10px] text-stone-400">For next {remainingDays} days</div>
          </div>

          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Projected Month-End</div>
            <div className="text-base sm:text-lg font-bold text-stone-900 mt-0.5">{formatINR(projectedMonthEndRevenue)}</div>
            <div className="text-[10px] text-stone-400">Target: {formatINR(planningBreakEven)}</div>
          </div>
        </div>

        <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 text-stone-700 text-[11px] flex items-center justify-between">
          <span><strong>Break-Even Target:</strong> {formatINR(planningBreakEven)} ({percentOfTarget}% achieved)</span>
          <span><strong>Dynamic Cost BEP:</strong> {formatINR(calculatedBreakEven)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
