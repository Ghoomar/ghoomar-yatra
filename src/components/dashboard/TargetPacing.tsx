import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { formatINR, formatNumber } from '@/lib/utils';

interface TargetPacingProps {
  dailyTarget: number;
  revenueAchieved: number;
  remainingRevenue: number;
  actualSpendPerVisitor: number;
  requiredVisitorsRemaining: number;
  achievementPercent: number;
}

export function TargetPacing({
  dailyTarget,
  revenueAchieved,
  remainingRevenue,
  actualSpendPerVisitor,
  requiredVisitorsRemaining,
  achievementPercent,
}: TargetPacingProps) {
  const spendBase = actualSpendPerVisitor > 0 ? actualSpendPerVisitor : 300;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Daily Target Pacing Intelligence</CardTitle>
          <span className="text-xs font-semibold text-stone-500">
            Goal: {formatINR(dailyTarget)}
          </span>
        </div>
        <CardDescription>Real-time revenue pace vs required footfall economics</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-2 text-xs">
        <div className="w-full bg-stone-100 rounded-full h-3 overflow-hidden">
          <div
            className="bg-amber-500 h-full rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, achievementPercent)}%` }}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Achieved</div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">{formatINR(revenueAchieved)}</div>
          </div>

          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Remaining Gap</div>
            <div className="text-lg font-bold text-amber-700 mt-0.5">{formatINR(remainingRevenue)}</div>
          </div>

          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Current Spend Pace</div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">{formatINR(spendBase)}/person</div>
          </div>

          <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/60">
            <div className="text-[11px] text-stone-500 font-medium">Visitors Needed</div>
            <div className="text-lg font-bold text-sky-700 mt-0.5">
              {remainingRevenue > 0 ? `+${formatNumber(requiredVisitorsRemaining)}` : 'Target Met'}
            </div>
          </div>
        </div>

        <div className="p-3 bg-amber-50/60 border border-amber-200/70 rounded-lg text-amber-900 text-[11px]">
          <strong>Operating Guidance:</strong> At the current pace of {formatINR(spendBase)} per person, Ghoomar Yatra requires <strong>{formatNumber(requiredVisitorsRemaining)} more visitors</strong> before midnight to hit today's {formatINR(dailyTarget)} revenue target.
        </div>
      </CardContent>
    </Card>
  );
}
