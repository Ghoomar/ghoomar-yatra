'use client';

import React from 'react';
import { DailySalesReconciliationRow } from '@/lib/types/sales';
import { formatINR } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, HelpCircle, ArrowRightLeft } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

interface SalesReconciliationBannerProps {
  reconciliation: DailySalesReconciliationRow | null;
  businessDate: string;
}

export function SalesReconciliationBanner({
  reconciliation,
  businessDate,
}: SalesReconciliationBannerProps) {
  if (!reconciliation) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-stone-500">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-stone-400 shrink-0" />
          <span>No Petpooja Executive Summary uploaded for {businessDate} yet. Upload it to verify financial totals.</span>
        </div>
      </div>
    );
  }

  const isReconciled = reconciliation.reconciliation_status === 'Reconciled';
  const execNet = reconciliation.exec_net_sales !== null ? Number(reconciliation.exec_net_sales) : null;
  const ordersNet = reconciliation.orders_net_sales !== null ? Number(reconciliation.orders_net_sales) : null;
  const hourlyNet = reconciliation.hourly_net_sales !== null ? Number(reconciliation.hourly_net_sales) : null;
  const granularNet = ordersNet !== null ? ordersNet : hourlyNet;

  const diff = granularNet !== null && execNet !== null ? Math.round((granularNet - execNet) * 100) / 100 : null;

  return (
    <div
      className={`rounded-2xl border p-4 transition shadow-xs ${
        isReconciled
          ? 'border-emerald-200 bg-emerald-50/30'
          : 'border-amber-300 bg-amber-50/40'
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Title & Status */}
        <div className="flex items-start sm:items-center gap-3">
          <div
            className={`p-2 rounded-xl shrink-0 ${
              isReconciled ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {isReconciled ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <AlertTriangle className="h-5 w-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-stone-900 text-sm">
                Executive Sales Reconciliation ({businessDate})
              </h3>
              <Badge variant={isReconciled ? 'success' : 'warning'} className="text-[10px]">
                {reconciliation.reconciliation_status}
              </Badge>
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              {isReconciled
                ? 'Authoritative verification: Petpooja Executive Summary matches granular item sales exactly.'
                : 'Variance detected between Executive Sales Summary and imported transactions.'}
            </p>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-3 text-xs bg-white/80 border border-stone-200/80 rounded-xl p-3 shrink-0">
          <div>
            <span className="text-[10px] text-stone-500 block uppercase font-semibold">Executive Net</span>
            <span className="font-bold text-stone-900 text-sm">
              {execNet !== null ? formatINR(execNet) : '—'}
            </span>
          </div>

          <div>
            <span className="text-[10px] text-stone-500 block uppercase font-semibold">Granular Net</span>
            <span className="font-bold text-stone-900 text-sm">
              {granularNet !== null ? formatINR(granularNet) : '—'}
            </span>
          </div>

          <div>
            <span className="text-[10px] text-stone-500 block uppercase font-semibold">Difference</span>
            <span
              className={`font-mono font-bold text-sm ${
                diff === 0 || (diff !== null && Math.abs(diff) < 1)
                  ? 'text-emerald-700'
                  : 'text-amber-800'
              }`}
            >
              {diff !== null ? formatINR(diff) : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
