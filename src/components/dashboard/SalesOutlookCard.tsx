'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/context';
import { Sparkles, TrendingUp, Package, ArrowRight, RefreshCw } from 'lucide-react';
import { formatINR } from '@/lib/utils';

export function SalesOutlookCard({ businessDate }: { businessDate: string }) {
  const { t } = useI18n();
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchForecast = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/finance/sales/forecast?start_date=${businessDate}`);
        const data = await res.json();
        if (active && data.success && data.today) {
          setForecast(data.today);
        }
      } catch (err) {
        console.error('Failed to load forecast for dashboard:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchForecast();
    return () => {
      active = false;
    };
  }, [businessDate]);

  if (loading) {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm flex items-center justify-center gap-2 text-stone-400 text-xs">
        <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
        <span>{t('dashboard.salesOutlook.loading') || 'Loading sales outlook...'}</span>
      </div>
    );
  }

  if (!forecast) return null;

  const dotColor =
    forecast.rev_confidence_tier === 'High'
      ? 'bg-emerald-500'
      : forecast.rev_confidence_tier === 'Medium'
      ? 'bg-amber-500'
      : 'bg-rose-500';

  return (
    <div className="bg-white border border-amber-200/80 rounded-2xl p-4 shadow-sm bg-gradient-to-br from-amber-50/40 via-white to-white">
      <div className="flex items-center justify-between pb-2 border-b border-stone-100">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-stone-900">
              {t('dashboard.salesOutlook.title') || 'Sales Outlook & Dual-Track Pace'}
            </h4>
            <span className="text-[10px] text-stone-400">
              {forecast.business_date} &middot; {forecast.driver_summary}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${dotColor}`} />
          <span className="text-[11px] font-semibold text-stone-600">
            {forecast.rev_confidence_score}% {forecast.rev_confidence_tier}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-3">
        <div>
          <span className="text-[11px] text-stone-500 flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-emerald-600" />
            {t('dashboard.salesOutlook.predictedNet') || 'Predicted Net Sales'}
          </span>
          <div className="text-base font-extrabold text-stone-900 mt-0.5">
            {formatINR(forecast.predicted_net_revenue)}
          </div>
          <span className="text-[10px] text-stone-400">
            Range: {formatINR(forecast.predicted_net_revenue_low)} – {formatINR(forecast.predicted_net_revenue_high)}
          </span>
        </div>

        <div>
          <span className="text-[11px] text-stone-500 flex items-center gap-1">
            <Package className="h-3 w-3 text-amber-600" />
            {t('dashboard.salesOutlook.predictedUnits') || 'Predicted Plates & Volume'}
          </span>
          <div className="text-base font-extrabold text-stone-900 mt-0.5">
            ~{Math.round(forecast.predicted_total_units)}{' '}
            <span className="text-xs font-normal text-stone-500">units</span>
          </div>
          <span className="text-[10px] text-stone-400">
            ~{forecast.predicted_pax} covers &middot; ~{forecast.predicted_orders} bills
          </span>
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-stone-100 flex items-center justify-between text-xs">
        <span className="text-[11px] text-stone-500">
          {forecast.day_mode !== 'normal' ? '✨ Event or Group Multipliers Applied' : 'Standard weekly pace model'}
        </span>
        <Link
          href="/finance/sales?view=forecast"
          className="text-amber-700 font-semibold hover:text-amber-800 flex items-center gap-1 group"
        >
          <span>{t('dashboard.salesOutlook.viewRibbon') || 'View 7-Day Forecast'}</span>
          <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  );
}
