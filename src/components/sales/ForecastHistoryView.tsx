'use client';

import React, { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { useAppRole } from '@/components/layout/AppShell';
import {
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Users,
  Search,
  Filter,
  RefreshCw,
  TrendingUp,
  Tag,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Info,
  Edit2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { GradedSnapshotRecord } from '@/lib/forecasting/types';
import { EditBillModal, EditableBillData } from './EditBillModal';

interface DayDetailBill {
  id: string;
  sales_order_id: string;
  business_date: string;
  primary_table_no: string | null;
  bill_status: string;
  bill_class: string;
  is_group_member: boolean;
  group_type: string | null;
  group_association_tier: string | null;
  is_manually_overridden: boolean;
  manager_override_notes: string | null;
  bill_net_amount: number;
  bill_pax: number;
  bill_apc: number;
  daypart: string;
  outside_activities_net: number;
  outside_activities_qty: number;
  restaurant_food_net: number;
  restaurant_food_qty: number;
  classification_reason: string;
  manual_edit?: any;
  order?: {
    invoice_no: string;
    order_type: string;
    area: string;
    payment_type?: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    covers_pax: number;
    net_sales: number;
  };
}

export function ForecastHistoryView() {
  const { t, locale } = useI18n();
  const { role } = useAppRole();
  const isAdmin = role === 'Admin';
  const [editingBill, setEditingBill] = useState<EditableBillData | null>(null);

  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<GradedSnapshotRecord[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string>('2026-11-17');

  // Day inspection
  const [loadingDay, setLoadingDay] = useState(false);
  const [daySnapshot, setDaySnapshot] = useState<GradedSnapshotRecord | null>(null);
  const [dayBills, setDayBills] = useState<DayDetailBill[]>([]);
  const [dayContext, setDayContext] = useState<any>(null);

  // Filter bills in inspected day
  const [billFilter, setBillFilter] = useState<'all' | 'large_group' | 'high_value_anomaly' | 'data_anomaly' | 'normal' | 'cancelled'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Reclassification action state
  const [reclassifyingId, setReclassifyingId] = useState<string | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/sales/forecast/history?limit=90');
      const data = await res.json();
      if (data.success) {
        setSnapshots(data.snapshots || []);
        setSummary(data.summary || null);
        if (data.snapshots.length > 0 && !selectedDate) {
          setSelectedDate(data.snapshots[0].business_date);
        }
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDayDetails = async (dateStr: string) => {
    setLoadingDay(true);
    try {
      const res = await fetch(`/api/finance/sales/forecast/history?date=${dateStr}`);
      const data = await res.json();
      if (data.success) {
        setDaySnapshot(data.snapshot);
        setDayBills(data.bills || []);
        setDayContext(data.context);
      }
    } catch (err) {
      console.error('Failed to load day details:', err);
    } finally {
      setLoadingDay(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      fetchDayDetails(selectedDate);
    }
  }, [selectedDate]);

  const handleReclassify = async (salesOrderId: string, newClass: string) => {
    setReclassifyingId(salesOrderId);
    try {
      const res = await fetch('/api/finance/sales/forecast/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sales_order_id: salesOrderId,
          bill_class: newClass,
          manager_override_notes: `Manual reclassification to ${newClass}`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Refresh day details and history
        await fetchDayDetails(selectedDate);
        await fetchHistory();
      } else {
        alert(data.error || 'Failed to reclassify bill');
      }
    } catch (err) {
      console.error('Reclassify error:', err);
    } finally {
      setReclassifyingId(null);
    }
  };

  const formatCurrency = (amount: number) => {
    return '₹' + Math.round(amount).toLocaleString('en-IN');
  };

  const getBillClassBadge = (bClass: string) => {
    switch (bClass) {
      case 'large_group':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">{t('finance.sales.largeGroup') || 'LARGE GROUP'}</span>;
      case 'high_value_anomaly':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">{t('finance.sales.highValue') || 'HIGH VALUE'}</span>;
      case 'data_anomaly':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">{t('finance.sales.markAnomaly') || 'ANOMALY'}</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-stone-100 text-stone-500 line-through">{t('finance.sales.cancelled') || 'CANCELLED'}</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700">{t('finance.sales.normal') || 'NORMAL'}</span>;
    }
  };

  const filteredBills = dayBills.filter((b) => {
    if (billFilter !== 'all' && b.bill_class !== billFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const inv = (b.order?.invoice_no || '').toLowerCase();
      const cust = (b.order?.customer_name || '').toLowerCase();
      const phone = (b.order?.customer_phone || '').toLowerCase();
      return inv.includes(q) || cust.includes(q) || phone.includes(q);
    }
    return true;
  });

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center gap-3 text-stone-400">
        <RefreshCw className="h-6 w-6 animate-spin text-amber-600" />
        <p className="text-sm">{t('finance.sales.loadingHistory') || 'Loading historical predictions & bill classifications...'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Global Replay & Walk-Forward Metrics Banner */}
      {summary && (
        <div className="bg-gradient-to-r from-stone-900 to-stone-800 rounded-2xl p-5 text-white shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-stone-700/80">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  {t('finance.sales.walkForwardReplayDynamic', { count: summary.total_days })}
                </span>
                <span className="text-xs text-stone-400">
                  {summary.total_days} {t('finance.sales.gradedDates') || 'graded dates'} &middot;{' '}
                  {Number(summary.total_bills || 0).toLocaleString('en-IN')} {t('finance.sales.bills') || 'bills'}
                </span>
              </div>
              <h2 className="text-lg font-bold text-white mt-1">
                {t('finance.sales.historyTitle') || 'Forecast vs. Actual Intelligence & Demand Decomposition'}
              </h2>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <div className="bg-stone-800/80 px-3 py-2 rounded-xl border border-stone-700">
                <div className="text-[10px] text-stone-400 uppercase font-semibold">{t('finance.sales.revenueWape') || 'Rev WAPE'}</div>
                <div className="text-sm font-bold text-emerald-400 mt-0.5">
                  {Number(summary.average_rev_wape_pct || 0).toFixed(1)}%
                </div>
              </div>
              <div className="bg-stone-800/80 px-3 py-2 rounded-xl border border-stone-700">
                <div className="text-[10px] text-stone-400 uppercase font-semibold">{t('finance.sales.dishWape') || 'Dish WAPE'}</div>
                <div className="text-sm font-bold text-amber-400 mt-0.5">
                  {Number(summary.average_unit_wape_pct || 0).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          {/* Decomposed Sales Totals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
            <div>
              <span className="text-stone-400 text-[11px]">{t('finance.sales.normalWalkIn') || 'Normal Walk-In Sales'}</span>
              <p className="text-sm font-bold text-white mt-0.5">{formatCurrency(summary.total_normal_net)}</p>
            </div>
            <div>
              <span className="text-amber-400 text-[11px]">{t('finance.sales.largeGroups') || 'Large Groups Demand'}</span>
              <p className="text-sm font-bold text-amber-300 mt-0.5">{formatCurrency(summary.total_group_net)}</p>
            </div>
            <div>
              <span className="text-purple-400 text-[11px]">{t('finance.sales.highValueAnomalies') || 'High Value Anomalies'}</span>
              <p className="text-sm font-bold text-purple-300 mt-0.5">{formatCurrency(summary.total_high_value_net)}</p>
            </div>
            <div>
              <span className="text-stone-400 text-[11px]">{t('finance.sales.outsideActivities') || 'Outside Village Activities'}</span>
              <p className="text-sm font-bold text-stone-300 mt-0.5">{formatCurrency(summary.total_outside_net)}</p>
            </div>
          </div>
        </div>
      )}

      {/* 2. Date Selection & Day Decomposition */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left List of Days */}
        <div className="w-full lg:w-72 bg-white border border-stone-200 rounded-2xl p-3 shadow-sm h-[650px] flex flex-col">
          <div className="text-xs font-bold text-stone-700 pb-2 mb-2 border-b border-stone-100 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-amber-600" />
              {t('finance.sales.selectDate') || 'Historical Dates'}
            </span>
            <span className="text-[11px] text-stone-400">{snapshots.length} days</span>
          </div>

          <div className="overflow-y-auto flex-1 space-y-1 pr-1">
            {snapshots.map((s) => {
              const isSelected = s.business_date === selectedDate;
              const hasGroup = Number(s.decomp_group_net || 0) > 0;
              const hasAnomaly = Number(s.decomp_high_value_net || 0) > 0;

              return (
                <button
                  key={s.business_date}
                  type="button"
                  onClick={() => setSelectedDate(s.business_date)}
                  className={`w-full text-left p-2.5 rounded-xl text-xs transition-colors ${
                    isSelected
                      ? 'bg-amber-600 text-white font-semibold shadow-xs'
                      : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{s.business_date}</span>
                    <span className={`text-[11px] ${isSelected ? 'text-amber-100' : 'text-stone-500 font-medium'}`}>
                      {formatCurrency(Number(s.actual_net_revenue || 0))}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    {hasGroup && (
                      <span className={`px-1 py-0.2 rounded text-[9px] ${isSelected ? 'bg-amber-500/40 text-amber-100' : 'bg-amber-100 text-amber-800'}`}>
                        {t('finance.sales.largeGroup') || 'Group'}
                      </span>
                    )}
                    {hasAnomaly && (
                      <span className={`px-1 py-0.2 rounded text-[9px] ${isSelected ? 'bg-purple-500/40 text-purple-100' : 'bg-purple-100 text-purple-800'}`}>
                        {t('finance.sales.highValue') || 'Anomaly'}
                      </span>
                    )}
                    <span className={`text-[10px] ml-auto ${isSelected ? 'text-amber-200' : 'text-stone-400'}`}>
                      {Number(s.signed_rev_error_pct || 0) >= 0 ? '+' : ''}{Number(s.signed_rev_error_pct || 0).toFixed(1)}% &Delta;
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Detail Pane: "Why This Day Happened" */}
        <div className="flex-1 space-y-4">
          {loadingDay ? (
            <div className="py-20 flex flex-col items-center justify-center gap-2 text-stone-400">
              <RefreshCw className="h-5 w-5 animate-spin text-amber-600" />
              <p className="text-xs">{t('finance.sales.loadingDayDecomposition') || 'Loading day decomposition...'}</p>
            </div>
          ) : daySnapshot ? (
            <>
              {/* Day Header & Decomposition Stack */}
              <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-stone-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-stone-900">
                        {t('finance.sales.whyDayHappened') || 'Why This Day Happened'}: {daySnapshot.business_date}
                      </h3>
                      {daySnapshot.day_mode_at_prediction !== 'normal' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                          {daySnapshot.day_mode_at_prediction.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-500 mt-0.5">{daySnapshot.driver_summary}</p>
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-extrabold text-stone-900">
                      {formatCurrency(Number(daySnapshot.actual_net_revenue || 0))}
                    </div>
                    <div className="text-xs text-stone-500">
                      {t('finance.sales.predicted') || 'Predicted'}: {formatCurrency(Number(daySnapshot.predicted_net_revenue))}
                    </div>
                  </div>
                </div>

                {/* Stacked Decomposition Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                    <span className="text-[10px] font-semibold text-stone-500 uppercase">{t('finance.sales.normal') || 'Normal'}</span>
                    <p className="text-sm font-bold text-stone-900 mt-0.5">{formatCurrency(Number(daySnapshot.decomp_normal_net || 0))}</p>
                    <span className="text-[10px] text-stone-400">{Math.round(Number(daySnapshot.decomp_normal_units || 0))} units</span>
                  </div>

                  <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200">
                    <span className="text-[10px] font-semibold text-amber-800 uppercase">{t('finance.sales.largeGroup') || 'Large Group'}</span>
                    <p className="text-sm font-bold text-amber-900 mt-0.5">{formatCurrency(Number(daySnapshot.decomp_group_net || 0))}</p>
                    <span className="text-[10px] text-amber-700 font-medium">{Math.round(Number(daySnapshot.decomp_group_units || 0))} units</span>
                  </div>

                  <div className="p-3 bg-purple-50/70 rounded-xl border border-purple-200">
                    <span className="text-[10px] font-semibold text-purple-800 uppercase">{t('finance.sales.highValue') || 'High Value'}</span>
                    <p className="text-sm font-bold text-purple-900 mt-0.5">{formatCurrency(Number(daySnapshot.decomp_high_value_net || 0))}</p>
                    <span className="text-[10px] text-purple-700">{Math.round(Number(daySnapshot.decomp_high_value_units || 0))} units</span>
                  </div>

                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                    <span className="text-[10px] font-semibold text-stone-500 uppercase">{t('finance.sales.activities') || 'Outside Act.'}</span>
                    <p className="text-sm font-bold text-stone-800 mt-0.5">{formatCurrency(Number(daySnapshot.decomp_outside_activities_net || 0))}</p>
                    <span className="text-[10px] text-stone-400">{t('finance.sales.villageRides') || 'Village rides'}</span>
                  </div>

                  <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-200">
                    <span className="text-[10px] font-semibold text-emerald-800 uppercase">{t('finance.sales.complimentary') || 'Complimentary'}</span>
                    <p className="text-sm font-bold text-emerald-900 mt-0.5">{formatCurrency(Number(daySnapshot.decomp_complimentary_menu_value || 0))}</p>
                    <span className="text-[10px] text-emerald-700 font-medium">{t('finance.sales.zeroRealizedFoodRetained') || '₹0 realized (food retained)'}</span>
                  </div>
                </div>

                {/* What the Engine Learned Insight Panel */}
                {daySnapshot.learning_summary_json && (
                  <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-3.5 text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-stone-900 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                        {t('finance.sales.engineLearnedTitle')}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(daySnapshot.learning_summary_json.rev_outlier_dampened || daySnapshot.was_rev_outlier_dampened) && (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">
                            {t('finance.sales.revOutlierDampenedBadge')}
                          </span>
                        )}
                        {(daySnapshot.learning_summary_json.qty_outlier_dampened || daySnapshot.was_qty_outlier_dampened) && (
                          <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-semibold">
                            {t('finance.sales.qtyOutlierDampenedBadge')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] text-stone-700">
                      <div className="bg-white rounded-lg border border-stone-200/80 px-2.5 py-2">
                        <div className="text-[10px] text-stone-400 uppercase font-semibold">
                          {t('finance.sales.engineLearnedRevBaseline')}
                        </div>
                        <div className="font-semibold text-stone-900 mt-0.5">
                          {daySnapshot.learning_summary_json.rev_baseline_before != null &&
                          daySnapshot.learning_summary_json.rev_baseline_after != null
                            ? `${formatCurrency(Number(daySnapshot.learning_summary_json.rev_baseline_before))} → ${formatCurrency(Number(daySnapshot.learning_summary_json.rev_baseline_after))}`
                            : '—'}
                        </div>
                        <div className="text-[10px] text-stone-500 mt-0.5">
                          α = {Number(daySnapshot.learning_summary_json.rev_alpha ?? daySnapshot.rev_alpha_used ?? 0).toFixed(2)} ·{' '}
                          {t('finance.sales.biasLabel')}:{' '}
                          {Number(daySnapshot.learning_summary_json.rev_applied_bias_pct ?? daySnapshot.rev_bias_correction_used ?? 0) >= 0 ? '+' : ''}
                          {Number(daySnapshot.learning_summary_json.rev_applied_bias_pct ?? daySnapshot.rev_bias_correction_used ?? 0).toFixed(1)}%
                        </div>
                      </div>

                      <div className="bg-white rounded-lg border border-stone-200/80 px-2.5 py-2">
                        <div className="text-[10px] text-stone-400 uppercase font-semibold">
                          {t('finance.sales.engineLearnedQtyBaseline')}
                        </div>
                        <div className="font-semibold text-stone-900 mt-0.5">
                          {daySnapshot.learning_summary_json.qty_baseline_before != null &&
                          daySnapshot.learning_summary_json.qty_baseline_after != null
                            ? `${Math.round(Number(daySnapshot.learning_summary_json.qty_baseline_before))} → ${Math.round(Number(daySnapshot.learning_summary_json.qty_baseline_after))} ${t('finance.sales.unitsShort')}`
                            : '—'}
                        </div>
                        <div className="text-[10px] text-stone-500 mt-0.5">
                          α = {Number(daySnapshot.learning_summary_json.qty_alpha ?? daySnapshot.qty_alpha_used ?? 0).toFixed(2)} ·{' '}
                          {t('finance.sales.trackingSignalLabel')}:{' '}
                          {Number(daySnapshot.learning_summary_json.qty_tracking_signal ?? 0).toFixed(2)}
                        </div>
                      </div>

                      <div className="bg-white rounded-lg border border-stone-200/80 px-2.5 py-2">
                        <div className="text-[10px] text-stone-400 uppercase font-semibold">
                          {t('finance.sales.engineLearnedFoodReconciliation')}
                        </div>
                        <div className="font-semibold text-stone-900 mt-0.5">
                          {formatCurrency(Number(daySnapshot.actual_net_revenue || 0))} ({t('finance.sales.foodOnlyShort')})
                        </div>
                        <div className="text-[10px] text-stone-500 mt-0.5">
                          {t('finance.sales.petpoojaTotalShort')}:{' '}
                          {formatCurrency(
                            Number(
                              daySnapshot.learning_summary_json.total_petpooja_net_revenue ??
                                Number(daySnapshot.actual_net_revenue || 0) +
                                  Number(daySnapshot.decomp_outside_activities_net || 0)
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Classified Bills Table with 1-Tap Reclassification */}
              <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-amber-600" />
                    <h4 className="text-xs font-bold text-stone-900">
                      {t('finance.sales.classifiedBills') || 'Classified Transactions'} ({filteredBills.length} {t('finance.sales.bills') || 'bills'})
                    </h4>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder={t('finance.sales.searchInvoiceOrName') || 'Search invoice or name...'}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 pr-3 py-1 border border-stone-300 rounded-lg text-xs w-44"
                      />
                    </div>

                    <select
                      value={billFilter}
                      onChange={(e) => setBillFilter(e.target.value as any)}
                      className="px-2.5 py-1 border border-stone-300 rounded-lg text-xs"
                    >
                      <option value="all">{t('finance.sales.allClasses') || 'All Classes'}</option>
                      <option value="large_group">{t('finance.sales.largeGroups') || 'Large Groups'}</option>
                      <option value="high_value_anomaly">{t('finance.sales.highValue') || 'High Value'}</option>
                      <option value="data_anomaly">{t('finance.sales.markAnomaly') || 'Anomalies'}</option>
                      <option value="normal">{t('finance.sales.normal') || 'Normal'}</option>
                      <option value="cancelled">{t('finance.sales.cancelled') || 'Cancelled'}</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[420px]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-stone-50 text-stone-500 border-b border-stone-200 font-medium sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3">{t('finance.sales.invNumber') || 'Inv #'}</th>
                        <th className="py-2.5 px-3">{t('finance.sales.customerPhone') || 'Customer / Phone'}</th>
                        <th className="py-2.5 px-3 text-center">{t('finance.sales.pax') || 'PAX'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.sales.netSales') || 'Net Sales'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.sales.spendPerPax') || 'Spend/PAX'}</th>
                        <th className="py-2.5 px-3">{t('finance.sales.class') || 'Class'}</th>
                        <th className="py-2.5 px-3">{t('finance.sales.reason') || 'Reason'}</th>
                        <th className="py-2.5 px-3 text-center">{t('finance.sales.action') || 'Action'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 text-stone-800">
                      {filteredBills.map((b) => (
                        <tr key={b.id} className="hover:bg-amber-50/20 transition-colors">
                          <td className="py-2 px-3 font-mono font-semibold text-stone-900">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{b.order?.invoice_no}</span>
                              {b.manual_edit && (
                                <span
                                  className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-sans font-bold"
                                  title={b.manual_edit.reason || ''}
                                >
                                  {t('finance.sales.editBill.editedBadge')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-medium text-stone-900 truncate max-w-[130px]">
                              {b.order?.customer_name || t('finance.sales.walkInCustomer') || 'Walk-In Customer'}
                            </div>
                            {b.order?.customer_phone && (
                              <div className="text-[10px] text-stone-400 font-mono">
                                {b.order.customer_phone}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center font-semibold text-stone-700">
                            {b.bill_pax}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-stone-900">
                            {formatCurrency(b.bill_net_amount)}
                          </td>
                          <td className="py-2 px-3 text-right font-medium text-stone-600">
                            {b.bill_apc > 0 ? formatCurrency(b.bill_apc) : '—'}
                          </td>
                          <td className="py-2 px-3">
                            {getBillClassBadge(b.bill_class)}
                          </td>
                          <td className="py-2 px-3 text-stone-500 text-[11px] truncate max-w-[180px]" title={b.classification_reason}>
                            {b.classification_reason}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <div className="inline-flex items-center gap-1.5 justify-center">
                              {b.bill_class !== 'cancelled' && (
                                <select
                                  value={b.bill_class}
                                  disabled={reclassifyingId === b.sales_order_id}
                                  onChange={(e) => handleReclassify(b.sales_order_id, e.target.value)}
                                  className="px-2 py-0.5 border border-stone-200 rounded text-[11px] bg-white hover:border-amber-400 font-medium cursor-pointer"
                                >
                                  <option value="normal">{t('finance.sales.classOptionNormal')}</option>
                                  <option value="large_group">{t('finance.sales.classOptionGroup')}</option>
                                  <option value="high_value_anomaly">{t('finance.sales.classOptionHighValue')}</option>
                                  <option value="data_anomaly">{t('finance.sales.classOptionAnomaly')}</option>
                                </select>
                              )}
                              {isAdmin && b.order && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingBill({
                                      id: b.sales_order_id,
                                      business_date: b.business_date,
                                      invoice_no: b.order!.invoice_no,
                                      covers_pax: b.order!.covers_pax,
                                      status: b.bill_status,
                                      order_type: b.order!.order_type,
                                      area: b.order!.area,
                                      payment_type: b.order!.payment_type ?? null,
                                      customer_name: b.order!.customer_name,
                                      customer_phone: b.order!.customer_phone,
                                      net_sales: b.order!.net_sales,
                                      manual_edit: b.manual_edit || null,
                                    })
                                  }
                                  className="p-1 rounded border border-stone-200 text-stone-600 hover:text-amber-700 hover:border-amber-400 hover:bg-amber-50 transition-colors"
                                  title={t('finance.sales.editBill.editButton')}
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-stone-400 text-xs">
              {t('finance.sales.selectDatePrompt') || 'Select a date on the left to view historical bill decomposition.'}
            </div>
          )}
        </div>
      </div>

      {isAdmin && (
        <EditBillModal
          isOpen={Boolean(editingBill)}
          bill={editingBill}
          onClose={() => setEditingBill(null)}
          onSaved={async () => {
            await fetchDayDetails(selectedDate);
            await fetchHistory();
          }}
        />
      )}
    </div>
  );
}
