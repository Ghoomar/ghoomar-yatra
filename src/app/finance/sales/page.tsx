'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/lib/i18n/context';
import {
  Receipt,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { SalesImportSection } from '@/components/sales/SalesImportSection';

function SalesPageContent() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      {/* Top Header & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Receipt className="h-6 w-6 text-amber-600" />
            {t('finance.sales.title')}
          </h1>
          <p className="text-xs sm:text-sm text-stone-500 mt-0.5">
            {t('finance.sales.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/reports">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs text-amber-900 border-amber-300 hover:bg-amber-50">
              <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
              <span>{t('finance.sales.viewAnalyticsInReports')}</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Authoritative Petpooja Import & Reconciliation */}
      <SalesImportSection />
    </div>
  );
}

export default function SalesPage() {
  const { t } = useI18n();

  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
          {t('finance.sales.loadingSalesModule')}
        </div>
      }
    >
      <SalesPageContent />
    </Suspense>
  );
}
