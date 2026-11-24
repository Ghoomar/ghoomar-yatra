'use client';

import React, { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n/context';
import {
  TrendingUp,
  Package,
  Calendar,
  Users,
  AlertCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  Info,
  ChevronRight,
  Plus,
  RefreshCw,
  Utensils,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  HelpCircle,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DayForecastResult, GradedSnapshotRecord, EventType, GroupProfile } from '@/lib/forecasting/types';

export function SalesForecastView() {
  const { t, locale } = useI18n();

  const [loading, setLoading] = useState(true);
  const [ribbon, setRibbon] = useState<DayForecastResult[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [yesterdayScorecard, setYesterdayScorecard] = useState<GradedSnapshotRecord | null>(null);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [groupProfiles, setGroupProfiles] = useState<GroupProfile[]>([]);
  const [breakdownView, setBreakdownView] = useState<'dishes' | 'categories'>('dishes');

  // Modals & Drawers
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);
  const [isConfidenceDrawerOpen, setIsConfidenceDrawerOpen] = useState(false);
  const [submittingContext, setSubmittingContext] = useState(false);

  // Context Form State
  const [formDate, setFormDate] = useState('');
  const [formDayMode, setFormDayMode] = useState<'normal' | 'special_event' | 'group_booking' | 'hybrid_event_and_group'>('normal');
  const [formEventTypeId, setFormEventTypeId] = useState('');
  const [formExpectedGuests, setFormExpectedGuests] = useState('0');
  const [formGroupType, setFormGroupType] = useState('school_group');
  const [formGroupDaypart, setFormGroupDaypart] = useState<'breakfast' | 'lunch' | 'dinner' | 'full_day'>('lunch');
  const [formGroupNotes, setFormGroupNotes] = useState('');

  const fetchForecast = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/sales/forecast');
      const data = await res.json();
      if (data.success && data.ribbon && data.ribbon.length > 0) {
        setRibbon(data.ribbon);
        setSelectedDate((prev) => prev || data.ribbon[0].business_date);
        setYesterdayScorecard(data.yesterday_scorecard || null);
        setEventTypes(data.event_types || []);
        setGroupProfiles(data.group_profiles || []);
      }
    } catch (err) {
      console.error('Failed to load sales forecast:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForecast();
  }, []);

  const activeDay = ribbon.find((r) => r.business_date === selectedDate) || ribbon[0];

  const handleSaveContext = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingContext(true);
    try {
      const res = await fetch('/api/finance/sales/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_date: formDate,
          day_mode: formDayMode,
          event_type_id: formEventTypeId || null,
          expected_guests: parseInt(formExpectedGuests, 10) || 0,
          group_type: formGroupType,
          group_daypart: formGroupDaypart,
          group_notes: formGroupNotes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsContextModalOpen(false);
        await fetchForecast();
      } else {
        alert(data.error || 'Failed to save context');
      }
    } catch (err) {
      console.error('Error saving day context:', err);
    } finally {
      setSubmittingContext(false);
    }
  };

  const openContextModalForDay = (day: DayForecastResult) => {
    setFormDate(day.business_date);
    setFormDayMode((day.day_mode as any) || 'normal');
    setFormEventTypeId(day.context?.event_type_id || '');
    setFormExpectedGuests(String(day.context?.expected_guests || 0));
    setFormGroupType(day.context?.group_type || 'school_group');
    setFormGroupDaypart((day.context?.group_daypart as any) || 'lunch');
    setFormGroupNotes(day.context?.group_notes || '');
    setIsContextModalOpen(true);
  };

  const formatCurrency = (amount: number) => {
    return '₹' + Math.round(amount).toLocaleString('en-IN');
  };

  const formatLakhs = (amount: number) => {
    if (amount >= 100000) {
      return `₹${(amount / 100000).toFixed(2)}L`;
    }
    return formatCurrency(amount);
  };

  const getConfidenceBadgeColor = (tier: string) => {
    if (tier === 'High') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (tier === 'Medium') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-rose-50 text-rose-700 border-rose-200';
  };

  const getDotColor = (tier: string) => {
    if (tier === 'High') return 'bg-emerald-500';
    if (tier === 'Medium') return 'bg-amber-500';
    return 'bg-rose-500';
  };

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-3 text-stone-400">
        <RefreshCw className="h-6 w-6 animate-spin text-amber-600" />
        <p className="text-sm">{t('finance.sales.loadingForecast') || 'Calculating dual-track sales predictions...'}</p>
      </div>
    );
  }

  if (!activeDay) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-stone-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800">
              {t('finance.sales.dualTrackEngine') || 'Dual-Track Self-Learning Engine'}
            </span>
            <span className="text-xs text-stone-500">
              {t('finance.sales.trainedOnWeeks', { count: activeDay.sample_weeks_count || 12 }) || `Trained on ${activeDay.sample_weeks_count || 12} weeks of live history`}
            </span>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            {t('finance.sales.forecastSubtitle') || 'Independent Quantity and Revenue models with dynamic bill classification & event decomposition.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsConfidenceDrawerOpen(true)}
            className="text-xs gap-1.5 border-stone-300 text-stone-700 hover:bg-stone-50"
          >
            <Info className="h-3.5 w-3.5 text-stone-500" />
            <span>{t('finance.sales.confidenceGuide') || 'Confidence Guide'}</span>
          </Button>

          <Button
            size="sm"
            onClick={() => openContextModalForDay(activeDay)}
            className="text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{t('finance.sales.planEventOrGroup') || 'Plan Event / Group'}</span>
          </Button>
        </div>
      </div>

      {/* 2. 7-Day Ribbon */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-stone-600 font-medium">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-amber-600" />
            {t('finance.sales.sevenDayOutlook') || '7-Day Rolling Sales Outlook'}
          </span>
          <span className="text-[11px] text-stone-400">
            {t('finance.sales.tapToInspect') || 'Tap any date to inspect details'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
          {ribbon.map((day, idx) => {
            const isSelected = day.business_date === selectedDate;
            const isToday = idx === 0;
            const isTomorrow = idx === 1;
            const d = new Date(day.business_date + 'T00:00:00Z');
            const dayLabel = isToday
              ? (t('finance.sales.today') || 'Today')
              : isTomorrow
              ? (t('finance.sales.tomorrow') || 'Tomorrow')
              : d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-US', { weekday: 'short' });

            const formattedDate = d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-US', {
              day: 'numeric',
              month: 'short',
            });

            return (
              <button
                key={day.business_date}
                type="button"
                onClick={() => setSelectedDate(day.business_date)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'border-amber-600 bg-amber-50/60 shadow-sm ring-1 ring-amber-500'
                    : 'border-stone-200 bg-white hover:border-amber-300 hover:bg-stone-50/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-semibold ${isSelected ? 'text-amber-900' : 'text-stone-600'}`}>
                    {dayLabel}
                  </span>
                  <div className={`h-2 w-2 rounded-full ${getDotColor(day.rev_confidence_tier)}`} />
                </div>
                <div className="text-[10px] text-stone-400 mt-0.5">{formattedDate}</div>

                <div className="mt-2.5">
                  <div className="text-sm font-bold text-stone-900 tracking-tight">
                    {formatLakhs(day.predicted_net_revenue)}
                  </div>
                  <div className="text-[11px] text-stone-500 mt-0.5 flex items-center gap-1">
                    <Package className="h-3 w-3 text-stone-400" />
                    <span>~{Math.round(day.predicted_total_units)} {t('finance.sales.units') || 'units'}</span>
                  </div>
                </div>

                {day.day_mode !== 'normal' && (
                  <div className="mt-2 pt-1.5 border-t border-amber-200/60 text-[10px] font-medium text-amber-700 truncate">
                    {day.day_mode === 'group_booking' ? '👥 Group Booking' : '✨ Special Event'}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Dual-Track Hero Card for Selected Day */}
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Banner with Context / Drivers */}
        <div className="bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {new Date(activeDay.business_date + 'T00:00:00Z').toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
                {activeDay.day_mode !== 'normal' && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {activeDay.day_mode.toUpperCase()}
                  </span>
                )}
              </div>
              <h2 className="text-base sm:text-lg font-bold mt-1 text-white flex items-center gap-2">
                {activeDay.driver_summary}
              </h2>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => openContextModalForDay(activeDay)}
              className="text-xs border-stone-600 text-stone-200 hover:bg-stone-800 self-start sm:self-auto"
            >
              {t('finance.sales.editContext') || 'Modify Day Context'}
            </Button>
          </div>
        </div>

        {/* Dual-Track Columns */}
        <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6 divide-y md:divide-y-0 md:divide-x divide-stone-200">
          {/* Left Column: Track 1 (Revenue Space) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                {t('finance.sales.track1Revenue') || 'Track 1: Revenue Space'}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${getConfidenceBadgeColor(activeDay.rev_confidence_tier)}`}>
                {Math.round(activeDay.rev_confidence_score)}% {activeDay.rev_confidence_tier} {t('finance.sales.confidence') || 'Confidence'}
              </span>
            </div>

            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-stone-900 tracking-tight">
                {formatCurrency(activeDay.predicted_net_revenue)}
              </div>
              <div className="text-xs text-stone-500 mt-1 flex items-center gap-2">
                <span>{t('finance.sales.expectedRange') || 'Expected Range'}:</span>
                <span className="font-semibold text-stone-700">
                  {formatCurrency(activeDay.predicted_net_revenue_low)} – {formatCurrency(activeDay.predicted_net_revenue_high)}
                </span>
              </div>
            </div>

            {/* Revenue Decomposition Highlights */}
            <div className="bg-stone-50 rounded-xl p-3 border border-stone-200 space-y-1.5 text-xs">
              <div className="flex justify-between text-stone-600">
                <span>{t('finance.sales.impliedGross') || 'Predicted Gross'}:</span>
                <span className="font-semibold text-stone-800">{formatCurrency(activeDay.predicted_gross_revenue)}</span>
              </div>
              <div className="flex justify-between text-stone-600">
                <span>{t('finance.sales.expectedDiscounts') || 'Expected Discounts'}:</span>
                <span className="font-semibold text-stone-800">{formatCurrency(activeDay.predicted_discount_amount)}</span>
              </div>
              {activeDay.additive_group_revenue > 0 && (
                <div className="flex justify-between text-emerald-700 font-medium pt-1 border-t border-stone-200">
                  <span>{t('finance.sales.additiveGroupRevenue') || 'Additive Group Demand'}:</span>
                  <span>+{formatCurrency(activeDay.additive_group_revenue)}</span>
                </div>
              )}
            </div>

            <div className="text-[11px] text-stone-400 flex items-center gap-3">
              <span>EWMA &alpha;: {activeDay.rev_alpha_used.toFixed(3)}</span>
              <span>Bias: {activeDay.rev_applied_bias_pct > 0 ? `+${activeDay.rev_applied_bias_pct}%` : `${activeDay.rev_applied_bias_pct}%`}</span>
            </div>
          </div>

          {/* Right Column: Track 2 (Quantity Space) */}
          <div className="space-y-4 md:pl-6 pt-6 md:pt-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                <Package className="h-4 w-4 text-amber-600" />
                {t('finance.sales.track2Quantity') || 'Track 2: Quantity Space'}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${getConfidenceBadgeColor(activeDay.qty_confidence_tier)}`}>
                {Math.round(activeDay.qty_confidence_score)}% {activeDay.qty_confidence_tier} {t('finance.sales.confidence') || 'Confidence'}
              </span>
            </div>

            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-stone-900 tracking-tight">
                ~{Math.round(activeDay.predicted_total_units).toLocaleString('en-IN')}{' '}
                <span className="text-lg font-normal text-stone-500">{t('finance.sales.dishUnits') || 'dish units'}</span>
              </div>
              <div className="text-xs text-stone-500 mt-1 flex items-center gap-2">
                <span>{t('finance.sales.expectedDemand') || 'Expected Footfall'}:</span>
                <span className="font-semibold text-stone-700">
                  ~{activeDay.predicted_pax} {t('finance.sales.covers') || 'covers'} &middot; ~{activeDay.predicted_orders} {t('finance.sales.bills') || 'bills'}
                </span>
              </div>
            </div>

            {/* Quantity Highlights */}
            <div className="bg-stone-50 rounded-xl p-3 border border-stone-200 space-y-1.5 text-xs">
              <div className="flex justify-between text-stone-600">
                <span>{t('finance.sales.topDishesVolume') || 'Volume in Mapped Recipes'}:</span>
                <span className="font-semibold text-stone-800">
                  {Math.round(activeDay.dishes.reduce((acc, d) => acc + d.predicted_quantity, 0))} units
                </span>
              </div>
              <div className="flex justify-between text-stone-600">
                <span>{t('finance.sales.bomReadiness') || 'BOM Purchasing Link'}:</span>
                <span className="font-semibold text-emerald-700">{t('finance.sales.readyForExplosion') || 'Ready for Explosion'}</span>
              </div>
              {activeDay.additive_group_units > 0 && (
                <div className="flex justify-between text-amber-700 font-medium pt-1 border-t border-stone-200">
                  <span>{t('finance.sales.additiveGroupUnits') || 'Group Units'}:</span>
                  <span>+{Math.round(activeDay.additive_group_units)} units</span>
                </div>
              )}
            </div>

            <div className="text-[11px] text-stone-400 flex items-center gap-3">
              <span>EWMA &alpha;: {activeDay.qty_alpha_used.toFixed(3)}</span>
              <span>Bias: {activeDay.qty_applied_bias_pct > 0 ? `+${activeDay.qty_applied_bias_pct}%` : `${activeDay.qty_applied_bias_pct}%`}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Yesterday's Dual Scorecard */}
      {yesterdayScorecard && (
        <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between pb-3 border-b border-stone-200/80">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-bold text-stone-800">
                {t('finance.sales.yesterdayScorecard') || "Yesterday's Graded Scorecard"} ({yesterdayScorecard.business_date})
              </span>
            </div>
            <span className="text-[11px] text-stone-500">
              {t('finance.sales.dishWape') || 'Dish WAPE'}: {(Number(yesterdayScorecard.dish_wape || 0) * 100).toFixed(1)}%
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            {/* Yesterday Revenue Accuracy */}
            <div className="bg-white p-3 rounded-xl border border-stone-200 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-stone-400 font-medium">{t('finance.sales.revenueAccuracy') || 'Revenue Realized'}</div>
                <div className="text-base font-bold text-stone-900 mt-0.5">
                  {formatCurrency(Number(yesterdayScorecard.actual_net_revenue || 0))}
                </div>
                <div className="text-[11px] text-stone-500">
                  {t('finance.sales.predicted') || 'Predicted'}: {formatCurrency(Number(yesterdayScorecard.predicted_net_revenue))}
                </div>
              </div>
              <div className="text-right">
                <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-bold ${
                  Math.abs(Number(yesterdayScorecard.signed_rev_error_pct || 0)) <= 10
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}>
                  {Number(yesterdayScorecard.signed_rev_error_pct || 0) >= 0 ? '+' : ''}
                  {Number(yesterdayScorecard.signed_rev_error_pct || 0).toFixed(1)}% &Delta;
                </span>
              </div>
            </div>

            {/* Yesterday Volume Accuracy */}
            <div className="bg-white p-3 rounded-xl border border-stone-200 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-stone-400 font-medium">{t('finance.sales.volumeAccuracy') || 'Volume Consumed'}</div>
                <div className="text-base font-bold text-stone-900 mt-0.5">
                  {Math.round(Number(yesterdayScorecard.actual_total_units || 0))} units
                </div>
                <div className="text-[11px] text-stone-500">
                  {t('finance.sales.predicted') || 'Predicted'}: {Math.round(Number(yesterdayScorecard.predicted_total_units))} units
                </div>
              </div>
              <div className="text-right">
                <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-bold ${
                  Math.abs(Number(yesterdayScorecard.signed_unit_error_pct || 0)) <= 10
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}>
                  {Number(yesterdayScorecard.signed_unit_error_pct || 0) >= 0 ? '+' : ''}
                  {Number(yesterdayScorecard.signed_unit_error_pct || 0).toFixed(1)}% &Delta;
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Top Dishes & Categories Breakdown Table */}
      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            {breakdownView === 'dishes' ? (
              <Utensils className="h-4 w-4 text-amber-600" />
            ) : (
              <Layers className="h-4 w-4 text-amber-600" />
            )}
            <h3 className="text-sm font-bold text-stone-900">
              {breakdownView === 'dishes'
                ? `${t('finance.sales.topDishesForecast') || 'Top Predicted Dishes'} (${activeDay.dishes.length})`
                : `${t('finance.sales.categoryForecastTitle') || 'Menu Category Forecast'} (${activeDay.categories.length})`}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-stone-100 p-0.5 border border-stone-200 text-xs">
              <button
                type="button"
                onClick={() => setBreakdownView('dishes')}
                className={`px-3 py-1 rounded-md font-semibold transition cursor-pointer ${
                  breakdownView === 'dishes'
                    ? 'bg-white text-stone-900 shadow-2xs font-bold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t('finance.sales.topDishesTab') || 'Top Dishes'}
              </button>
              <button
                type="button"
                onClick={() => setBreakdownView('categories')}
                className={`px-3 py-1 rounded-md font-semibold transition cursor-pointer ${
                  breakdownView === 'categories'
                    ? 'bg-white text-stone-900 shadow-2xs font-bold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t('finance.sales.categoriesTab') || 'Categories'}
              </button>
            </div>
          </div>
        </div>

        {breakdownView === 'dishes' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 text-stone-500 border-b border-stone-200 font-medium">
                <tr>
                  <th className="py-2.5 px-4 w-12 text-center">#</th>
                  <th className="py-2.5 px-4">{t('finance.sales.dishName') || 'Dish Name'}</th>
                  <th className="py-2.5 px-4">{t('finance.sales.categoryName') || 'Category'}</th>
                  <th className="py-2.5 px-4 text-right">{t('finance.sales.predictedUnits') || 'Predicted Units'}</th>
                  <th className="py-2.5 px-4 text-right">{t('finance.sales.avgPrice') || 'Avg Selling Price'}</th>
                  <th className="py-2.5 px-4 text-right">{t('finance.sales.impliedSales') || 'Implied Sales'}</th>
                  <th className="py-2.5 px-4 text-right">{t('finance.sales.volumeShare') || 'Volume Share'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-stone-800">
                {activeDay.dishes.slice(0, 20).map((dish, i) => (
                  <tr key={dish.dish_name} className="hover:bg-amber-50/30 transition-colors">
                    <td className="py-2 px-4 text-center text-stone-400 font-medium">{i + 1}</td>
                    <td className="py-2 px-4 font-semibold text-stone-900">{dish.dish_name}</td>
                    <td className="py-2 px-4 text-stone-500">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-stone-100 text-stone-700">
                        {dish.category}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right font-bold text-amber-700">
                      {Math.round(dish.predicted_quantity)}
                    </td>
                    <td className="py-2 px-4 text-right text-stone-600">
                      {formatCurrency(dish.avg_price)}
                    </td>
                    <td className="py-2 px-4 text-right font-semibold text-stone-900">
                      {formatCurrency(dish.implied_net_sales)}
                    </td>
                    <td className="py-2 px-4 text-right text-stone-500">
                      {dish.volume_share_pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 text-stone-500 border-b border-stone-200 font-medium">
                <tr>
                  <th className="py-2.5 px-4 w-12 text-center">#</th>
                  <th className="py-2.5 px-4">{t('finance.sales.categoryName') || 'Category'}</th>
                  <th className="py-2.5 px-4 text-right">{t('finance.sales.predictedUnits') || 'Predicted Units'}</th>
                  <th className="py-2.5 px-4 text-right">{t('finance.sales.volumeShare') || 'Volume Share'}</th>
                  <th className="py-2.5 px-4 text-right">{t('finance.sales.impliedSales') || 'Implied Sales'}</th>
                  <th className="py-2.5 px-4 text-right">{t('finance.sales.revenueShare') || 'Revenue Share'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-stone-800">
                {activeDay.categories.map((cat, i) => (
                  <tr key={cat.category} className="hover:bg-amber-50/30 transition-colors">
                    <td className="py-2.5 px-4 text-center text-stone-400 font-medium">{i + 1}</td>
                    <td className="py-2.5 px-4 font-bold text-stone-900">{cat.category}</td>
                    <td className="py-2.5 px-4 text-right font-bold text-amber-700">
                      {Math.round(cat.predicted_units)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-stone-500 font-medium">
                      {cat.volume_share_pct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold text-stone-900">
                      {formatCurrency(cat.predicted_net_sales)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-stone-600 font-semibold">
                      {cat.revenue_share_pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Plan Event / Group Booking Modal */}
      {isContextModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden">
            <div className="p-4 bg-stone-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                {t('finance.sales.planEventModalTitle') || 'Plan Special Event / Group Booking'}
              </h3>
              <button
                type="button"
                onClick={() => setIsContextModalOpen(false)}
                className="text-stone-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveContext} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-stone-700 font-medium mb-1">
                  {t('finance.sales.date') || 'Business Date'}
                </label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-stone-700 font-medium mb-1">
                  {t('finance.sales.dayMode') || 'Day Mode'}
                </label>
                <select
                  value={formDayMode}
                  onChange={(e) => setFormDayMode(e.target.value as any)}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
                >
                  <option value="normal">{t('finance.sales.modeNormal') || 'Normal Operations'}</option>
                  <option value="special_event">{t('finance.sales.modeSpecialEvent') || 'Special Event / Festival'}</option>
                  <option value="group_booking">{t('finance.sales.modeGroupBooking') || 'Large Group Booking'}</option>
                  <option value="hybrid_event_and_group">{t('finance.sales.modeHybrid') || 'Hybrid (Event + Group)'}</option>
                </select>
              </div>

              {(formDayMode === 'special_event' || formDayMode === 'hybrid_event_and_group') && (
                <div>
                  <label className="block text-stone-700 font-medium mb-1">
                    {t('finance.sales.eventType') || 'Event Type'}
                  </label>
                  <select
                    value={formEventTypeId}
                    onChange={(e) => setFormEventTypeId(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
                  >
                    <option value="">{t('finance.sales.selectEventType') || '-- Select Event --'}</option>
                    {eventTypes.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} ({ev.learned_revenue_multiplier}x Rev)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(formDayMode === 'group_booking' || formDayMode === 'hybrid_event_and_group') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      {t('finance.sales.expectedGuests') || 'Expected Guests (PAX)'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formExpectedGuests}
                      onChange={(e) => setFormExpectedGuests(e.target.value)}
                      className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs font-bold text-amber-900"
                      placeholder="e.g. 150"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      {t('finance.sales.groupType') || 'Group Category'}
                    </label>
                    <select
                      value={formGroupType}
                      onChange={(e) => setFormGroupType(e.target.value)}
                      className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
                    >
                      <option value="school_group">School Picnic (₹240 APC)</option>
                      <option value="standard_group">Tour / Social Group (₹280 APC)</option>
                      <option value="corporate">Corporate / Banquet (₹850 APC)</option>
                      <option value="tour_bus">Tour Bus (₹260 APC)</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-stone-700 font-medium mb-1">
                  {t('finance.sales.notes') || 'Booking Notes / Details'}
                </label>
                <textarea
                  rows={2}
                  value={formGroupNotes}
                  onChange={(e) => setFormGroupNotes(e.target.value)}
                  placeholder="e.g. Krypton Public School visit with 250 students"
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-200">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsContextModalOpen(false)}
                >
                  {t('common.cancel') || 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingContext}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {submittingContext ? 'Saving...' : (t('common.save') || 'Save Forecast Context')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confidence Guide Drawer / Modal */}
      {isConfidenceDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-stone-200 overflow-hidden">
            <div className="p-4 bg-stone-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Info className="h-4 w-4 text-amber-400" />
                {t('finance.sales.confidenceGuideTitle') || 'Understanding Dual-Track Confidence'}
              </h3>
              <button
                type="button"
                onClick={() => setIsConfidenceDrawerOpen(false)}
                className="text-stone-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-stone-600 leading-relaxed">
              <p>
                <strong>Ghoomar Yatra's Self-Learning Forecasting Engine</strong> maintains two completely independent prediction models:
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  <strong className="text-stone-900">Quantity Track:</strong> Learns physical plate, portion, and beverage volumes. Evaluates tracking signals and rolling WAPE on units. Powers kitchen prep and BOM raw material ordering.
                </li>
                <li>
                  <strong className="text-stone-900">Revenue Track:</strong> Learns financial rupee turnover, discounting elasticity, and APC (Average Per Cover). Powers financial cash-flow planning and P&amp;L closing.
                </li>
              </ul>
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-amber-900 space-y-1">
                <div className="font-bold">Confidence Tier Criteria:</div>
                <div>&bull; <span className="font-semibold text-emerald-800">High (&ge; 75%)</span>: Error &lt; 12%, stable tracking signal, &gt; 8 sample weeks.</div>
                <div>&bull; <span className="font-semibold text-amber-800">Medium (55–74%)</span>: Normal demand variance or initial post-shock adaptation.</div>
                <div>&bull; <span className="font-semibold text-rose-800">Low (&lt; 55%)</span>: Recent unmodeled macro shock or first-time festival.</div>
              </div>
            </div>

            <div className="p-3 bg-stone-50 border-t border-stone-200 flex justify-end">
              <Button size="sm" onClick={() => setIsConfidenceDrawerOpen(false)}>
                {t('common.close') || 'Close'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
