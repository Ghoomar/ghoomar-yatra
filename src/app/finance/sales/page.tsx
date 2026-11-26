'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/lib/i18n/context';
import {
  Receipt,
  TrendingUp,
  RefreshCw,
  Sparkles,
  History,
  UploadCloud,
} from 'lucide-react';
import { SalesImportSection } from '@/components/sales/SalesImportSection';
import { SalesForecastView } from '@/components/sales/SalesForecastView';
import { ForecastHistoryView } from '@/components/sales/ForecastHistoryView';

type SalesTab = 'forecast' | 'history' | 'import';

function SalesPageContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawTab = searchParams.get('view') || searchParams.get('tab');
  const activeTab: SalesTab = rawTab === 'history' ? 'history' : rawTab === 'import' ? 'import' : 'forecast';

  const setTab = (tab: SalesTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('view');
    params.set('tab', tab);
    router.replace(`/finance/sales?${params.toString()}`);
  };

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

      {/* Tabs Switcher */}
      <div className="flex items-center gap-1 border-b border-stone-200">
        <button
          type="button"
          onClick={() => setTab('forecast')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'forecast'
              ? 'border-amber-600 text-amber-800 bg-amber-50/50'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:border-stone-300'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-600" />
          <span>{t('finance.sales.tabs.forecast') || '7-Day Dual Forecast'}</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('history')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'history'
              ? 'border-amber-600 text-amber-800 bg-amber-50/50'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:border-stone-300'
          }`}
        >
          <History className="h-3.5 w-3.5 text-amber-600" />
          <span>{t('finance.sales.tabs.history') || 'Forecast vs. Actuals'}</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('import')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeTab === 'import'
              ? 'border-amber-600 text-amber-800 bg-amber-50/50'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:border-stone-300'
          }`}
        >
          <UploadCloud className="h-3.5 w-3.5 text-amber-600" />
          <span>{t('finance.sales.tabs.import') || 'Petpooja Import'}</span>
        </button>
      </div>

      {/* Active Tab View */}
      {activeTab === 'forecast' && <SalesForecastView />}
      {activeTab === 'history' && <ForecastHistoryView />}
      {activeTab === 'import' && <SalesImportSection />}
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
