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
  ChevronLeft,
  ChevronRight,
  Calendar,
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
  const { t, formatDate } = useI18n();
  const todayStr = getTodayBusinessDate();
  const [businessDate, setBusinessDate] = useState(todayStr);
  const [activeTab, setActiveTab] = useState<'electricity' | 'diesel' | 'lpg'>('electricity');

  const [meters, setMeters] = useState<any[]>([]);
  const [readings, setReadings] = useState<any[]>([]);
  const [selectedMeterId, setSelectedMeterId] = useState('');

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto px-1 sm:px-0">
      {/* Page Header & Global Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 sm:p-4 rounded-2xl border border-stone-200/80 shadow-2xs">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center shrink-0 border border-amber-500/20">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-stone-900 leading-tight">
              {t('finance.utilities.title') || 'Utilities Management'}
            </h1>
            <p className="text-[11px] sm:text-xs text-stone-500 font-medium">
              {t('finance.utilities.subtitle') || 'Daily meter readings, fuel transfers & stock inwarding'}
            </p>
          </div>
        </div>

        {/* Business Date Picker & Controls */}
        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-between sm:justify-end">
          {/* Quick Date Stepper & Picker */}
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

            <div className="w-36 sm:w-40">
              <DatePicker
                value={businessDate}
                onChange={(val) => val && setBusinessDate(val)}
                clearable={false}
                triggerClassName="border-0 bg-transparent py-1 px-1.5 shadow-none text-xs font-bold text-stone-900 focus-within:ring-0"
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

      {/* Toast Alert */}
      {message && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2.5 shadow-2xs animate-in fade-in duration-200 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
              : 'bg-rose-50 text-rose-900 border border-rose-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Segmented Sub-Module Navigation Tabs */}
      <div className="bg-stone-100/90 p-1 rounded-xl border border-stone-200/80 grid grid-cols-3 gap-1 shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveTab('electricity')}
          className={`py-2 px-2.5 sm:px-4 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer select-none ${
            activeTab === 'electricity'
              ? 'bg-white text-amber-900 shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/50'
          }`}
        >
          <Zap className={`h-4 w-4 ${activeTab === 'electricity' ? 'text-amber-600' : 'text-stone-400'}`} />
          <span className="truncate">{t('finance.utilities.electricity') || 'Electricity'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('diesel')}
          className={`py-2 px-2.5 sm:px-4 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer select-none ${
            activeTab === 'diesel'
              ? 'bg-white text-amber-900 shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/50'
          }`}
        >
          <Fuel className={`h-4 w-4 ${activeTab === 'diesel' ? 'text-amber-600' : 'text-stone-400'}`} />
          <span className="truncate">{t('finance.utilities.diesel') || 'Diesel & Gen'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('lpg')}
          className={`py-2 px-2.5 sm:px-4 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer select-none ${
            activeTab === 'lpg'
              ? 'bg-white text-amber-900 shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/50'
          }`}
        >
          <Flame className={`h-4 w-4 ${activeTab === 'lpg' ? 'text-amber-600' : 'text-stone-400'}`} />
          <span className="truncate">{t('finance.utilities.lpg') || 'LPG Gas'}</span>
        </button>
      </div>

      {/* Active Tab View */}
      <div className="transition-all">
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
