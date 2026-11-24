'use client';

import React, { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n/context';
import {
  Scale,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Search,
  Filter,
  RefreshCw,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { VarianceReport, VarianceItem } from '@/lib/inventory/variance';
import { formatINR } from '@/lib/utils';

export function InventoryVarianceView() {
  const { t, locale } = useI18n();

  // Date state
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgoStr = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(weekAgoStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [mode, setMode] = useState<'movement_based' | 'count_bounded'>('movement_based');

  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [report, setReport] = useState<VarianceReport | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unfavorable' | 'favorable' | 'aligned'>('all');

  const fetchVariance = async () => {
    setLoading(true);
    setUnauthorized(false);
    try {
      const res = await fetch(`/api/inventory/variance?start_date=${startDate}&end_date=${endDate}&mode=${mode}`);
      if (res.status === 403) {
        setUnauthorized(true);
        return;
      }
      const data = await res.json();
      if (data.success && data.report) {
        setReport(data.report);
      }
    } catch (err) {
      console.error('Failed to load inventory variance:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVariance();
  }, [startDate, endDate, mode]);

  if (unauthorized) {
    return (
      <div className="bg-white border border-rose-200 rounded-2xl p-8 text-center max-w-lg mx-auto my-12 shadow-sm space-y-3">
        <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h3 className="text-base font-bold text-stone-900">
          {t('inventory.variance.restrictedTitle') || 'Costing & Variance Access Restricted'}
        </h3>
        <p className="text-xs text-stone-500 leading-relaxed">
          {t('inventory.variance.restrictedDesc') || 'Theoretical vs. Actual Variance contains confidential recipe costing and WAC valuations. Accessible exclusively to Managers, Costing Accountants, and Administrators.'}
        </p>
      </div>
    );
  }

  const items = report?.items || [];
  const filteredItems = items.filter((item) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        item.item_name.toLowerCase().includes(q) ||
        item.item_code.toLowerCase().includes(q) ||
        item.category_name.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-stone-200">
        <div>
          <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
            <Scale className="h-5 w-5 text-amber-600" />
            {t('inventory.variance.title') || 'Theoretical vs. Actual (Theo-vs-Act) Variance Tracker'}
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            {t('inventory.variance.subtitle') || 'Recipe BOM consumption compared against recorded store movements and stock counts.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Date range picker */}
          <div className="flex items-center gap-1.5 bg-white border border-stone-300 rounded-lg px-2.5 py-1 text-xs text-stone-700">
            <Calendar className="h-3.5 w-3.5 text-stone-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-xs font-semibold focus:outline-none"
            />
            <span className="text-stone-400">&ndash;</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-xs font-semibold focus:outline-none"
            />
          </div>

          {/* Mode Switcher */}
          <div className="inline-flex rounded-lg bg-stone-100 p-0.5 border border-stone-200 text-xs">
            <button
              type="button"
              onClick={() => setMode('movement_based')}
              className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                mode === 'movement_based'
                  ? 'bg-white text-stone-900 shadow-2xs font-bold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Movement-Based
            </button>
            <button
              type="button"
              onClick={() => setMode('count_bounded')}
              className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                mode === 'count_bounded'
                  ? 'bg-white text-stone-900 shadow-2xs font-bold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Count-Bounded
            </button>
          </div>

          <Button variant="outline" size="sm" onClick={fetchVariance} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-2 text-stone-400">
          <RefreshCw className="h-6 w-6 animate-spin text-amber-600" />
          <p className="text-xs">Exploding BOM recipe demands & calculating variance...</p>
        </div>
      ) : report ? (
        <>
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs">
              <span className="text-[11px] font-semibold text-stone-500 uppercase">
                {t('inventory.variance.totalItems') || 'Evaluated Items'}
              </span>
              <div className="text-xl font-extrabold text-stone-900 mt-1">
                {report.total_theoretical_items_count}
              </div>
              <span className="text-[10px] text-stone-400">Kitchen & Bar items</span>
            </div>

            <div className="bg-rose-50/70 p-4 rounded-xl border border-rose-200 shadow-2xs">
              <span className="text-[11px] font-semibold text-rose-700 uppercase flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {t('inventory.variance.unfavorable') || 'Unfavorable Variance'}
              </span>
              <div className="text-xl font-extrabold text-rose-900 mt-1">
                {report.unfavorable_count}
              </div>
              <span className="text-[10px] text-rose-600">Over-consumption vs BOM</span>
            </div>

            <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-2xs">
              <span className="text-[11px] font-semibold text-emerald-700 uppercase flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {t('inventory.variance.favorable') || 'Favorable Variance'}
              </span>
              <div className="text-xl font-extrabold text-emerald-900 mt-1">
                {report.favorable_count}
              </div>
              <span className="text-[10px] text-emerald-600">Under-consumption / Yield save</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs">
              <span className="text-[11px] font-semibold text-stone-500 uppercase">
                {t('inventory.variance.netCostVariance') || 'Net Cost Variance'}
              </span>
              <div className={`text-xl font-extrabold mt-1 ${
                (report.total_variance_cost || 0) > 0 ? 'text-rose-700' : 'text-emerald-700'
              }`}>
                {report.total_variance_cost != null ? formatINR(report.total_variance_cost) : '—'}
              </div>
              <span className="text-[10px] text-stone-400">Valued at current WAC</span>
            </div>
          </div>

          {/* Variance Items Table */}
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search item or category..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 border border-stone-300 rounded-lg text-xs w-56"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-3 py-1.5 border border-stone-300 rounded-lg text-xs"
                >
                  <option value="all">All Variances ({items.length})</option>
                  <option value="unfavorable">Unfavorable ({report.unfavorable_count})</option>
                  <option value="favorable">Favorable ({report.favorable_count})</option>
                  <option value="aligned">Aligned ({report.aligned_count})</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 text-stone-500 border-b border-stone-200 font-medium">
                  <tr>
                    <th className="py-2.5 px-4">Item Code</th>
                    <th className="py-2.5 px-4">Item Name</th>
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-4 text-right">Theoretical (BOM)</th>
                    <th className="py-2.5 px-4 text-right">Actual Consumed</th>
                    <th className="py-2.5 px-4 text-right">Variance Qty</th>
                    <th className="py-2.5 px-4 text-right">Variance %</th>
                    <th className="py-2.5 px-4 text-right">WAC Rate</th>
                    <th className="py-2.5 px-4 text-right">Variance Cost</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-stone-800">
                  {filteredItems.map((item) => (
                    <tr key={item.item_id} className="hover:bg-stone-50/60 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-medium text-stone-500">{item.item_code}</td>
                      <td className="py-2.5 px-4 font-bold text-stone-900">{item.item_name}</td>
                      <td className="py-2.5 px-4 text-stone-500">{item.category_name}</td>
                      <td className="py-2.5 px-4 text-right font-medium text-stone-700">
                        {item.theoretical_consumption} {item.unit_symbol}
                      </td>
                      <td className="py-2.5 px-4 text-right font-medium text-stone-700">
                        {item.actual_consumption} {item.unit_symbol}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-bold ${
                        item.variance_qty > 0 ? 'text-rose-700' : item.variance_qty < 0 ? 'text-emerald-700' : 'text-stone-500'
                      }`}>
                        {item.variance_qty > 0 ? '+' : ''}{item.variance_qty} {item.unit_symbol}
                      </td>
                      <td className="py-2.5 px-4 text-right text-stone-600 font-medium">
                        {item.variance_pct > 0 ? '+' : ''}{item.variance_pct.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-4 text-right text-stone-500 font-mono">
                        {item.unit_cost != null ? formatINR(item.unit_cost) : '—'}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-bold ${
                        (item.variance_cost || 0) > 0 ? 'text-rose-700' : (item.variance_cost || 0) < 0 ? 'text-emerald-700' : 'text-stone-500'
                      }`}>
                        {item.variance_cost != null ? formatINR(item.variance_cost) : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {item.status === 'unfavorable' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                            UNFAVORABLE
                          </span>
                        )}
                        {item.status === 'favorable' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            FAVORABLE
                          </span>
                        )}
                        {item.status === 'aligned' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-stone-100 text-stone-600">
                            ALIGNED
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-stone-400 text-xs">
                        No items match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
