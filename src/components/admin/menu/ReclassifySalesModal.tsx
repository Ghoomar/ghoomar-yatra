'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { formatINR } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, RefreshCw, Calendar } from 'lucide-react';

interface ReclassifySalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReclassifySalesModal({
  isOpen,
  onClose,
  onSuccess,
}: ReclassifySalesModalProps) {
  const [selectedDatesStr, setSelectedDatesStr] = useState('2026-09-20, 2026-09-21, 2026-09-22');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any> | null>(null);

  if (!isOpen) return null;

  const handleRunReclassify = async () => {
    const dates = selectedDatesStr
      .split(',')
      .map((d) => d.trim())
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

    if (dates.length === 0) {
      setError('Please enter at least one valid date in YYYY-MM-DD format.');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch('/api/admin/menu/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDates: dates }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to reclassify sales.');
      }

      setResults(json.results);
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              <RefreshCw className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-sm">
                Reclassify Historical Sales
              </h3>
              <p className="text-[11px] text-stone-500">
                Apply current Menu Master hierarchy & aliases to specific historical dates
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 text-base font-bold p-1 rounded-md"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-xl text-xs text-amber-900 space-y-1">
            <p className="font-semibold flex items-center gap-1.5 text-amber-950">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              Audited Administrative Action
            </p>
            <p className="text-[11px] text-amber-800 leading-relaxed">
              Standard category edits in Settings do NOT rewrite historical records automatically.
              Use this tool when you intentionally want selected past dates to adopt updated category definitions or newly assigned parent categories (such as moving Rajasthani Specialities under Rajasthani). Total sales and item quantities are strictly conserved.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              Business Dates to Reclassify (comma-separated YYYY-MM-DD)
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Calendar className="absolute left-3 top-2.5 h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  value={selectedDatesStr}
                  onChange={(e) => setSelectedDatesStr(e.target.value)}
                  placeholder="e.g. 2026-09-20, 2026-09-21, 2026-09-22"
                  className="w-full rounded-xl border border-stone-200 pl-9 pr-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30 font-mono"
                />
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleRunReclassify}
                disabled={loading}
              >
                {loading ? 'Reclassifying...' : 'Run Reclassification'}
              </Button>
            </div>
            <div className="flex gap-2 mt-2">
              {['2026-09-20', '2026-09-21', '2026-09-22'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelectedDatesStr(d)}
                  className="text-[10px] text-stone-500 hover:text-amber-700 underline font-mono"
                >
                  Quick: {d}
                </button>
              ))}
            </div>
          </div>

          {results && (
            <div className="space-y-4 pt-3 border-t border-stone-100">
              <h4 className="text-xs font-bold text-stone-900">Reclassification Results</h4>
              {Object.entries(results).map(([date, data]: [string, any]) => (
                <div
                  key={date}
                  className="bg-stone-50 border border-stone-200 rounded-xl p-3.5 space-y-2.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-stone-900">{date}</span>
                    {data.isConserved ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" />
                        Sales & Qty 100% Conserved
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                        <AlertTriangle className="h-3 w-3" />
                        Discrepancy Detected
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[11px] bg-white p-2.5 rounded-lg border border-stone-200">
                    <div>
                      <span className="text-stone-400 block text-[10px]">Total Records</span>
                      <span className="font-semibold text-stone-800">{data.recordCount} items</span>
                    </div>
                    <div>
                      <span className="text-stone-400 block text-[10px]">Total Net Sales</span>
                      <span className="font-semibold text-stone-800">{formatINR(data.afterTotalSales)}</span>
                    </div>
                    <div>
                      <span className="text-stone-400 block text-[10px]">Total Quantity</span>
                      <span className="font-semibold text-stone-800">{data.afterTotalQty} units</span>
                    </div>
                  </div>

                  {data.afterDistribution && (
                    <div>
                      <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block mb-1">
                        Updated Parent Category Breakdown
                      </span>
                      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                        {Object.entries(data.afterDistribution).map(([p, amt]: [string, any]) => (
                          <div
                            key={p}
                            className="flex items-center justify-between bg-white px-2.5 py-1 rounded border border-stone-150"
                          >
                            <span className="font-medium text-stone-700 truncate pr-2">{p}</span>
                            <span className="font-mono font-semibold text-stone-900">{formatINR(amt)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {data.unmatchedItems && Object.keys(data.unmatchedItems).length > 0 && (
                    <div className="p-2 bg-amber-50/70 border border-amber-200 rounded-lg text-[11px]">
                      <span className="font-bold text-amber-900 block mb-1">
                        Remaining Unmatched Items:
                      </span>
                      {Object.entries(data.unmatchedItems).map(([name, stats]: [string, any]) => (
                        <div key={name} className="flex justify-between text-amber-800">
                          <span>{name} (qty: {stats.qty})</span>
                          <span className="font-mono">{formatINR(stats.sales)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-stone-100 flex items-center justify-end bg-stone-50/50">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
