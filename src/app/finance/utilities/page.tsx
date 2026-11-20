'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import {
  Zap,
  Flame,
  Fuel,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { ElectricityTab } from '@/components/utilities/ElectricityTab';
import { LpgTab } from '@/components/utilities/LpgTab';
import { DieselTab } from '@/components/utilities/DieselTab';

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function UtilitiesPage() {
  const supabase = createClient();
  const { t } = useI18n();
  const todayStr = getTodayBusinessDate();
  const [businessDate, setBusinessDate] = useState(todayStr);
  const [activeTab, setActiveTab] = useState<'electricity' | 'diesel' | 'lpg'>('electricity');

  const [meters, setMeters] = useState<any[]>([]);
  const [readings, setReadings] = useState<any[]>([]);
  const [selectedMeterId, setSelectedMeterId] = useState('');

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; text: string } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: mData } = await supabase.from('meters').select('*').order('meter_name');
      const { data: rData } = await supabase
        .from('meter_readings_ledger')
        .select('*, meter:meters(meter_name, unit)')
        .eq('business_date', businessDate)
        .order('reading_timestamp', { ascending: true });

      setMeters(mData || []);
      setReadings(rData || []);
      if (mData && mData.length > 0 && !selectedMeterId) {
        setSelectedMeterId(mData[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load utilities data:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, businessDate, selectedMeterId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Clear toast after 5s
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const isToday = businessDate === todayStr;

  return (
    <div className="space-y-3 sm:space-y-4 max-w-7xl mx-auto px-2 sm:px-4 py-2 sm:py-3">
      {/* Desktop Header & Controls (md+) */}
      <div className="hidden md:flex items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-stone-200/80 shadow-2xs">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center shrink-0 border border-amber-500/20">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-stone-900 leading-tight">
              {t('finance.utilities.title') || 'Utilities Management'}
            </h1>
            <p className="text-xs text-stone-500 font-medium">
              {t('finance.utilities.subtitle') || 'Daily meter readings, fuel transfers & stock inwarding'}
            </p>
          </div>
        </div>

        {/* Desktop Business Date Stepper & Picker */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-stone-50 rounded-xl border border-stone-200 p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setBusinessDate((d) => shiftDate(d, -1))}
              className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-200/60 transition-colors cursor-pointer"
              title="Previous Day"
              aria-label="Previous Day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="w-32">
              <DatePicker
                value={businessDate}
                onChange={(val) => val && setBusinessDate(val)}
                clearable={false}
                hideIcon={true}
                hideChevron={true}
                triggerClassName="border-0 bg-transparent py-1 px-1 shadow-none text-xs font-bold text-stone-900 focus-within:ring-0 h-8 justify-center hover:text-amber-800"
              />
            </div>

            <button
              type="button"
              onClick={() => setBusinessDate((d) => shiftDate(d, 1))}
              className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-200/60 transition-colors cursor-pointer"
              title="Next Day"
              aria-label="Next Day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {!isToday && (
            <button
              type="button"
              onClick={() => setBusinessDate(todayStr)}
              className="px-2.5 py-1.5 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-xl border border-amber-200/70 transition-all cursor-pointer whitespace-nowrap"
            >
              {t('common.datePicker.today') || 'Today'}
            </button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="rounded-xl border-stone-200 h-9 w-9 p-0 flex items-center justify-center shrink-0 cursor-pointer"
            aria-label="Refresh Data"
          >
            <RefreshCw className={`h-4 w-4 text-stone-600 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Mobile Slim 44px Control Bar (< md) */}
      <div className="flex md:hidden items-center justify-between gap-1.5 bg-white px-2.5 py-1.5 rounded-xl border border-stone-200/80 shadow-2xs">
        {/* Date Switcher Pill */}
        <div className="flex items-center gap-1 bg-stone-50 rounded-lg border border-stone-200/80 px-1 py-0.5">
          <button
            type="button"
            onClick={() => setBusinessDate((d) => shiftDate(d, -1))}
            className="p-1 rounded text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
            aria-label="Previous Day"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          <div className="min-w-[105px] max-w-[130px]">
            <DatePicker
              value={businessDate}
              onChange={(val) => val && setBusinessDate(val)}
              clearable={false}
              hideIcon={true}
              hideChevron={true}
              triggerClassName="border-0 bg-transparent py-0.5 px-1 shadow-none text-xs font-bold text-stone-900 focus-within:ring-0 h-7 justify-center hover:text-amber-800"
            />
          </div>

          <button
            type="button"
            onClick={() => setBusinessDate((d) => shiftDate(d, 1))}
            className="p-1 rounded text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
            aria-label="Next Day"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Small Today chip (only visible when viewing non-today date) */}
        {!isToday && (
          <button
            type="button"
            onClick={() => setBusinessDate(todayStr)}
            className="px-2 py-1 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200/70 transition-all cursor-pointer whitespace-nowrap"
          >
            {t('common.datePicker.today') || 'Today'}
          </button>
        )}

        {/* Subtle Icon Refresh button */}
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="h-9 w-9 rounded-lg border border-stone-200 bg-stone-50 text-stone-600 flex items-center justify-center cursor-pointer hover:bg-stone-100 transition-colors shrink-0"
          aria-label="Refresh Data"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Toast Alert */}
      {message && (
        <div
          className={`p-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-2xs animate-in fade-in duration-200 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
              : message.type === 'warning' || message.type === 'info'
              ? 'bg-amber-50 text-amber-900 border border-amber-200'
              : 'bg-rose-50 text-rose-900 border border-rose-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : message.type === 'warning' || message.type === 'info' ? (
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Row 2: Compact Segmented Tabs — Zero Truncation */}
      <div className="bg-stone-100/90 p-1 rounded-xl border border-stone-200/80 grid grid-cols-3 gap-1 shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveTab('electricity')}
          className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none ${
            activeTab === 'electricity'
              ? 'bg-white text-amber-900 shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/50'
          }`}
        >
          <Zap className={`h-4 w-4 shrink-0 ${activeTab === 'electricity' ? 'text-amber-600' : 'text-stone-400'}`} />
          <span className="whitespace-nowrap">{t('finance.utilities.electricity') || 'Electricity'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('diesel')}
          className={`py-2 px-1.5 sm:px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 sm:gap-1.5 transition-all cursor-pointer select-none ${
            activeTab === 'diesel'
              ? 'bg-white text-amber-900 shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/50'
          }`}
        >
          <Fuel className={`h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 ${activeTab === 'diesel' ? 'text-amber-600' : 'text-stone-400'}`} />
          <span className="whitespace-nowrap">{t('finance.utilities.generator') || 'Generator'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('lpg')}
          className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none ${
            activeTab === 'lpg'
              ? 'bg-white text-amber-900 shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/50'
          }`}
        >
          <Flame className={`h-4 w-4 shrink-0 ${activeTab === 'lpg' ? 'text-amber-600' : 'text-stone-400'}`} />
          <span className="whitespace-nowrap">{t('finance.utilities.lpg') || 'LPG'}</span>
        </button>
      </div>

      {/* Active Tab View */}
      <div>
        {activeTab === 'electricity' && (
          <ElectricityTab
            businessDate={businessDate}
            meters={meters}
            readings={readings}
            selectedMeterId={selectedMeterId}
            setSelectedMeterId={setSelectedMeterId}
            onRefresh={loadData}
            setMessage={setMessage}
          />
        )}

        {activeTab === 'diesel' && (
          <DieselTab
            businessDate={businessDate}
            onRefresh={loadData}
            setMessage={setMessage}
          />
        )}

        {activeTab === 'lpg' && (
          <LpgTab
            businessDate={businessDate}
            onRefresh={loadData}
            setMessage={setMessage}
          />
        )}
      </div>
    </div>
  );
}
