'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/i18n/context';
import {
  Scale,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Search,
  RefreshCw,
  ShieldAlert,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { VarianceReport } from '@/lib/inventory/variance';
import { formatINR } from '@/lib/utils';

function getIstDateOffset(daysOffset: number = 0): string {
  const istNowStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const base = new Date(istNowStr + 'T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + daysOffset);
  return base.toISOString().slice(0, 10);
}

export function InventoryVarianceView() {
  const { t } = useI18n();

  const [startDate, setStartDate] = useState(() => getIstDateOffset(-7));
  const [endDate, setEndDate] = useState(() => getIstDateOffset(0));
  const [mode, setMode] = useState<'movement_based' | 'count_bounded'>('movement_based');

  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [report, setReport] = useState<VarianceReport | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unfavorable' | 'favorable' | 'aligned'>('all');

  const fetchVariance = useCallback(async () => {
    setLoading(true);
    setUnauthorized(false);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/inventory/variance?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&mode=${encodeURIComponent(mode)}`,
        { credentials: 'include' }
      );
      if (res.status === 403) {
        setUnauthorized(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.report) {
        setErrorMessage(data.error || `HTTP ${res.status}: Unable to load variance report`);
        return;
      }
      setReport(data.report);
    } catch (err: any) {
      console.error('Failed to load inventory variance:', err);
      setErrorMessage(err?.message || 'Network error while fetching inventory variance');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, mode]);

  useEffect(() => {
    fetchVariance();
  }, [fetchVariance]);

  if (unauthorized) {
    return (
      <div className="bg-white border border-rose-200 rounded-2xl p-8 text-center max-w-lg mx-auto my-12 shadow-sm space-y-3">
        <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h3 className="text-base font-bold text-stone-900">
          {t('inventory.variance.restrictedTitle')}
        </h3>
        <p className="text-xs text-stone-500 leading-relaxed">
          {t('inventory.variance.restrictedDesc')}
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
            {t('inventory.variance.title')}
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            {t('inventory.variance.subtitle')}
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
              {t('inventory.variance.modeMovementBased')}
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
              {t('inventory.variance.modeCountBounded')}
            </button>
          </div>

          <Button variant="outline" size="sm" onClick={fetchVariance} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {errorMessage ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-xs font-bold text-rose-900">{t('inventory.variance.errorTitle')}</h3>
              <p className="text-xs text-rose-700 mt-0.5">{errorMessage}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchVariance} className="shrink-0 border-rose-300 text-rose-800 hover:bg-rose-100">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            {t('inventory.variance.retry')}
          </Button>
        </div>
      ) : loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-2 text-stone-400">
          <RefreshCw className="h-6 w-6 animate-spin text-amber-600" />
          <p className="text-xs">{t('inventory.variance.loadingVariance')}</p>
        </div>
      ) : report ? (
        <>
          {report.count_pending_count > 0 && (
            <div className="bg-amber-50/90 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-900 flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600 shrink-0" />
              <span>{t('inventory.variance.countPendingNotice', { count: report.count_pending_count })}</span>
            </div>
          )}

          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs">
              <span className="text-[11px] font-semibold text-stone-500 uppercase">
                {t('inventory.variance.totalItems')}
              </span>
              <div className="text-xl font-extrabold text-stone-900 mt-1">
                {report.total_theoretical_items_count}
              </div>
              <span className="text-[10px] text-stone-400">{t('inventory.variance.kitchenBarItems')}</span>
            </div>

            <div className="bg-rose-50/70 p-4 rounded-xl border border-rose-200 shadow-2xs">
              <span className="text-[11px] font-semibold text-rose-700 uppercase flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {t('inventory.variance.unfavorable')}
              </span>
              <div className="text-xl font-extrabold text-rose-900 mt-1">
                {report.unfavorable_count}
              </div>
              <span className="text-[10px] text-rose-600">{t('inventory.variance.overConsumption')}</span>
            </div>

            <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-2xs">
              <span className="text-[11px] font-semibold text-emerald-700 uppercase flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {t('inventory.variance.favorable')}
              </span>
              <div className="text-xl font-extrabold text-emerald-900 mt-1">
                {report.favorable_count}
              </div>
              <span className="text-[10px] text-emerald-600">{t('inventory.variance.underConsumption')}</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs">
              <span className="text-[11px] font-semibold text-stone-500 uppercase">
                {t('inventory.variance.netCostVariance')}
              </span>
              <div className={`text-xl font-extrabold mt-1 ${
                (report.total_variance_cost || 0) > 0 ? 'text-rose-700' : 'text-emerald-700'
              }`}>
                {report.total_variance_cost != null ? formatINR(report.total_variance_cost) : '—'}
              </div>
              <span className="text-[10px] text-stone-400">{t('inventory.variance.valuedAtWac')}</span>
            </div>
          </div>

          {/* Variance Items Table */}
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={t('inventory.variance.searchItemOrCategory')}
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
                  <option value="all">{t('inventory.variance.filterAll', { count: items.length })}</option>
                  <option value="unfavorable">{t('inventory.variance.filterUnfavorable', { count: report.unfavorable_count })}</option>
                  <option value="favorable">{t('inventory.variance.filterFavorable', { count: report.favorable_count })}</option>
                  <option value="aligned">{t('inventory.variance.filterAligned', { count: report.aligned_count })}</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 text-stone-500 border-b border-stone-200 font-medium">
                  <tr>
                    <th className="py-2.5 px-4">{t('inventory.variance.colItemCode')}</th>
                    <th className="py-2.5 px-4">{t('inventory.variance.colItemName')}</th>
                    <th className="py-2.5 px-4">{t('inventory.variance.colCategory')}</th>
                    <th className="py-2.5 px-4 text-right">{t('inventory.variance.colTheoreticalBom')}</th>
                    <th className="py-2.5 px-4 text-right">{t('inventory.variance.colActualConsumed')}</th>
                    <th className="py-2.5 px-4 text-right">{t('inventory.variance.colVarianceQty')}</th>
                    <th className="py-2.5 px-4 text-right">{t('inventory.variance.colVariancePct')}</th>
                    <th className="py-2.5 px-4 text-right">{t('inventory.variance.colWacRate')}</th>
                    <th className="py-2.5 px-4 text-right">{t('inventory.variance.colVarianceCost')}</th>
                    <th className="py-2.5 px-4 text-center">{t('inventory.variance.colStatus')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-stone-800">
                  {filteredItems.map((item) => (
                    <tr key={item.item_id} className="hover:bg-stone-50/60 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-medium text-stone-500">{item.item_code}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-stone-900">{item.item_name}</div>
                        <span className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.2 rounded font-medium ${
                          item.count_status === 'verified'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : item.count_status === 'movement_logged'
                            ? 'bg-sky-50 text-sky-700 border border-sky-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}>
                          {item.count_status === 'verified'
                            ? t('inventory.variance.verifiedCountBadge')
                            : item.count_status === 'movement_logged'
                            ? t('inventory.variance.movementLoggedBadge')
                            : t('inventory.variance.countPendingBadge')}
                        </span>
                      </td>
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
                            {t('inventory.variance.statusUnfavorable')}
                          </span>
                        )}
                        {item.status === 'favorable' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            {t('inventory.variance.statusFavorable')}
                          </span>
                        )}
                        {item.status === 'aligned' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-stone-100 text-stone-600">
                            {t('inventory.variance.statusAligned')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-stone-400 text-xs">
                        {t('inventory.variance.noItemsMatch')}
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
