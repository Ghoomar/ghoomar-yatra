'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TimePicker } from '@/components/ui/TimePicker';
import { SimpleSelect } from '@/components/ui/Select';
import { formatDisplayDate } from '@/components/ui/DatePicker';
import { createClient } from '@/lib/supabase/client';
import { formatNumber, formatINR } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import {
  Zap,
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  History,
  TrendingUp,
  Activity,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface ElectricityTabProps {
  businessDate: string;
  meters: any[];
  readings: any[];
  selectedMeterId: string;
  setSelectedMeterId: (id: string) => void;
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error' | 'warning' | 'info'; text: string }) => void;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function getCurrentTimeHHMM(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function ElectricityTab({
  businessDate,
  meters,
  readings,
  selectedMeterId,
  setSelectedMeterId,
  onRefresh,
  setMessage,
}: ElectricityTabProps) {
  const supabase = createClient();
  const { t, locale } = useI18n();

  const [newReading, setNewReading] = useState<string>('');
  const [readingTime, setReadingTime] = useState<string>(() => getCurrentTimeHHMM());
  const [isReset, setIsReset] = useState(false);
  const [notes, setNotes] = useState('');
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [costPerUnit, setCostPerUnit] = useState<number>(10.0);
  const [latestPriorReading, setLatestPriorReading] = useState<number | null>(null);
  const [latestPriorTimestamp, setLatestPriorTimestamp] = useState<string | null>(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);

  const selectedMeter = meters.find((m) => m.id === selectedMeterId) || meters[0];
  const displayUnit = !selectedMeter?.unit || selectedMeter.unit.toUpperCase() === 'KVAH' ? 'kWh' : selectedMeter.unit;

  // Auto-select first meter if not set
  useEffect(() => {
    if (meters.length > 0 && (!selectedMeterId || !meters.some((m) => m.id === selectedMeterId))) {
      setSelectedMeterId(meters[0].id);
    }
  }, [meters, selectedMeterId, setSelectedMeterId]);

  // 1. Fetch Configured Electricity Cost Rule
  useEffect(() => {
    const fetchCostRule = async () => {
      try {
        const { data } = await supabase
          .from('financial_cost_rules')
          .select('amount_or_rate')
          .eq('category', 'Utilities')
          .eq('calculation_method', 'meter_based')
          .eq('is_active', true)
          .maybeSingle();

        if (data?.amount_or_rate) {
          setCostPerUnit(Number(data.amount_or_rate));
        }
      } catch (err) {
        console.error('Failed to load electricity cost rule:', err);
      }
    };
    fetchCostRule();
  }, [supabase]);

  // 2. Fetch Continuous Chronological Baseline Reading
  useEffect(() => {
    const fetchBaseline = async () => {
      if (!selectedMeter?.id) return;
      setLoadingBaseline(true);
      try {
        const { data } = await supabase
          .from('meter_readings')
          .select('reading_value, reading_timestamp, business_date')
          .eq('meter_id', selectedMeter.id)
          .lte('business_date', businessDate)
          .order('reading_timestamp', { ascending: false })
          .limit(1);

        if (data && data.length > 0) {
          setLatestPriorReading(Number(data[0].reading_value));
          setLatestPriorTimestamp(data[0].reading_timestamp || null);
        } else {
          const { data: anyLatest } = await supabase
            .from('meter_readings')
            .select('reading_value, reading_timestamp')
            .eq('meter_id', selectedMeter.id)
            .order('reading_timestamp', { ascending: false })
            .limit(1);
          if (anyLatest && anyLatest.length > 0) {
            setLatestPriorReading(Number(anyLatest[0].reading_value));
            setLatestPriorTimestamp(anyLatest[0].reading_timestamp || null);
          } else {
            setLatestPriorReading(null);
            setLatestPriorTimestamp(null);
          }
        }
      } catch (err) {
        console.error('Failed to load meter baseline:', err);
      } finally {
        setLoadingBaseline(false);
      }
    };

    fetchBaseline();
  }, [selectedMeter?.id, businessDate, readings, supabase]);

  const meterReadings = useMemo(() => {
    if (!selectedMeter?.id) return [];
    return readings.filter((r) => r.meter_id === selectedMeter.id);
  }, [readings, selectedMeter?.id]);

  const todayConsumption = useMemo(() => {
    return meterReadings.reduce((sum, r) => sum + (Number(r.delta_consumption) || 0), 0);
  }, [meterReadings]);

  const todayEstimatedCost = todayConsumption * costPerUnit;

  const parsedNewReading = parseFloat(newReading);
  const isInputValid = !isNaN(parsedNewReading) && parsedNewReading > 0;

  let previewConsumption = 0;
  let isLowerThanPrevious = false;

  if (isInputValid && latestPriorReading !== null) {
    if (isReset) {
      previewConsumption = 0;
    } else {
      const diff = parsedNewReading - latestPriorReading;
      if (diff < 0) {
        isLowerThanPrevious = true;
      } else {
        previewConsumption = diff;
      }
    }
  }

  // Smart UX: Auto-expand reset option if lower than prior reading
  useEffect(() => {
    if (isLowerThanPrevious) {
      setShowOptionalFields(true);
    }
  }, [isLowerThanPrevious]);

  const previewCost = previewConsumption * costPerUnit;

  const scrollToHistory = () => {
    const el = document.getElementById('electricity-history-ledger');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMeter?.id || !isInputValid) return;

    if (isLowerThanPrevious && !isReset) {
      alert(
        t('finance.utilities.alertLowerWithoutReset', {
          reading: parsedNewReading,
          prior: latestPriorReading,
          unit: displayUnit,
        }) ||
          `Invalid reading: ${parsedNewReading} < ${latestPriorReading} ${displayUnit}.\n\nIf the meter rolled over or was replaced, check "Meter Replaced / Rolled Over" to establish a new baseline.`
      );
      return;
    }

    setSaving(true);

    try {
      const timePart = readingTime || getCurrentTimeHHMM();
      const localDateTimeStr = `${businessDate}T${timePart}:00`;
      const readingTimestamp = new Date(localDateTimeStr).toISOString();

      const { error } = await supabase.from('meter_readings').insert({
        meter_id: selectedMeter.id,
        business_date: businessDate,
        reading_timestamp: readingTimestamp,
        reading_value: parsedNewReading,
        is_reset: isReset,
        notes: notes.trim() || null,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text: t('finance.utilities.savedSuccess') || 'Meter reading logged successfully!',
      });

      setNewReading('');
      setIsReset(false);
      setNotes('');
      setShowOptionalFields(false);
      setReadingTime(getCurrentTimeHHMM());
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save reading.' });
    } finally {
      setSaving(false);
    }
  };

  const meterOptions = useMemo(() => {
    return meters.map((m) => {
      const u = !m.unit || m.unit.toUpperCase() === 'KVAH' ? 'kWh' : m.unit;
      return {
        value: m.id,
        label: `${m.meter_name} (${u})`,
      };
    });
  }, [meters]);

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 1. Compact 2-Column Hairline Status Strip (~60px tall) */}
      <div className="bg-white rounded-2xl border border-stone-200/90 shadow-2xs grid grid-cols-2 divide-x divide-stone-100 overflow-hidden">
        {/* Left: Today's Consumption */}
        <div className="p-3 sm:p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] sm:text-xs font-semibold text-stone-500 uppercase tracking-wide">
              {t('finance.utilities.todayConsumption') || "Today's Consumption"}
            </span>
            <div className="p-1 rounded-md bg-amber-50 text-amber-700 shrink-0">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-1 flex flex-col">
            <span className="text-lg sm:text-2xl font-black font-mono text-amber-600">
              {todayConsumption > 0 ? `${formatNumber(todayConsumption)} ${displayUnit}` : `0.0 ${displayUnit}`}
            </span>
            <span className="text-[11px] text-stone-500 font-medium">
              {formatINR(todayEstimatedCost)} · @{formatINR(costPerUnit)}/{displayUnit}
            </span>
          </div>
        </div>

        {/* Right: Previous Reading (Tappable on mobile to jump to history) */}
        <button
          type="button"
          onClick={scrollToHistory}
          className="p-3 sm:p-3.5 flex flex-col justify-between text-left hover:bg-stone-50/80 transition-colors cursor-pointer select-none"
          title={t('finance.utilities.tapViewHistory') || 'Tap to view reading history'}
        >
          <div className="flex items-center justify-between gap-1 w-full">
            <span className="text-[11px] sm:text-xs font-semibold text-stone-500 uppercase tracking-wide">
              {t('finance.utilities.previousReading') || 'Previous Reading'}
            </span>
            <div className="p-1 rounded-md bg-stone-100 text-stone-600 shrink-0">
              <Activity className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5 flex-wrap">
            {loadingBaseline ? (
              <span className="text-sm font-semibold text-stone-400">...</span>
            ) : latestPriorReading !== null ? (
              <span className="text-base sm:text-xl font-black font-mono text-stone-900">
                {`${latestPriorReading.toFixed(1)} ${displayUnit}`}
              </span>
            ) : (
              <span className="text-sm font-semibold text-stone-400">
                {t('finance.utilities.noPriorReading') || 'No prior reading'}
              </span>
            )}
            {latestPriorTimestamp && (
              <span className="text-[10px] text-stone-400 font-mono">
                {new Date(latestPriorTimestamp).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                })}
              </span>
            )}
          </div>
        </button>
      </div>

      {/* 2. Main Form & Ledger Grid (Desktop 12 cols: 5 form / 7 ledger) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Streamlined Meter Reading Form (5 cols on lg:) */}
        <div className="lg:col-span-5 bg-white p-3.5 sm:p-4 rounded-2xl border border-stone-200/90 shadow-2xs flex flex-col justify-between">
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Card Header: Title + Optional Meter Picker (only if > 1 meter) */}
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div className="flex items-center gap-1.5 font-bold text-sm text-stone-900">
                <Zap className="h-4 w-4 text-amber-600 shrink-0" />
                <span>{t('finance.utilities.meterReading') || 'Record Meter Reading'}</span>
              </div>
              {meters.length > 1 && (
                <div className="w-48">
                  <SimpleSelect
                    value={selectedMeterId}
                    onChange={setSelectedMeterId}
                    options={meterOptions}
                    triggerClassName="h-8 text-xs py-1 px-2 border-stone-200 bg-stone-50 font-medium"
                  />
                </div>
              )}
            </div>

            {/* Row 1 (2-Column Split): Current Reading (col-span-7) + Time (col-span-5) */}
            <div className="grid grid-cols-12 gap-2">
              {/* Current Reading */}
              <div className="col-span-7">
                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                  {t('finance.utilities.currentReading') || 'Current Reading'} <span className="text-rose-500">*</span>
                </label>
                <div className="relative rounded-xl">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    inputMode="decimal"
                    value={newReading}
                    onChange={(e) => setNewReading(e.target.value)}
                    placeholder={latestPriorReading !== null ? (latestPriorReading + 5).toFixed(1) : '0.0'}
                    required
                    className={`w-full h-11 rounded-xl border p-2.5 font-bold font-mono text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 pr-13 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-2xs transition-all ${
                      isLowerThanPrevious && !isReset
                        ? 'border-rose-400 bg-rose-50/30 focus:border-rose-500'
                        : 'border-stone-300 focus:border-amber-500 bg-white'
                    }`}
                  />
                  <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-stone-400 font-bold text-[11px]">
                    {displayUnit}
                  </div>
                </div>
              </div>

              {/* Time (Segmented RAC TimeField with Now button on label row) */}
              <div className="col-span-5">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-stone-700">
                    {t('finance.utilities.readingTimestamp') || 'Time'} <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setReadingTime(getCurrentTimeHHMM())}
                    className="px-2 py-0.5 text-[10px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 rounded border border-amber-200/70 transition-colors cursor-pointer select-none"
                    title={t('common.datePicker.now') || 'Set current time'}
                  >
                    {t('common.datePicker.now') || 'Now'}
                  </button>
                </div>
                <TimePicker
                  value={readingTime}
                  onChange={setReadingTime}
                  required
                  hideIcon={true}
                  hideNow={true}
                  triggerClassName="h-11 px-2.5 justify-center"
                />
              </div>
            </div>

            {/* Contextual Live Calculation Strip */}
            {isInputValid && latestPriorReading !== null && (
              <div
                className={`p-2 rounded-xl text-xs flex items-center justify-between border shadow-2xs animate-in fade-in duration-150 ${
                  isLowerThanPrevious && !isReset
                    ? 'bg-rose-50 text-rose-900 border-rose-200'
                    : 'bg-amber-50/80 text-amber-950 border-amber-200/80 font-medium'
                }`}
              >
                {isLowerThanPrevious && !isReset ? (
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-700">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
                    <span>
                      {t('finance.utilities.readingLowerWarning', { reading: latestPriorReading, unit: displayUnit }) ||
                        `Reading is lower than prior (${latestPriorReading} ${displayUnit})`}
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="font-mono font-bold text-amber-900">
                      {isReset ? `0.0 ${displayUnit} (Reset)` : `+${previewConsumption.toFixed(1)} ${displayUnit}`}
                    </span>
                    <span className="font-mono font-bold text-stone-900 text-xs">
                      Est. {formatINR(previewCost)}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Progressive Disclosure Toggle for Optional Fields */}
            <div>
              <button
                type="button"
                onClick={() => setShowOptionalFields(!showOptionalFields)}
                className={`text-[11px] font-bold flex items-center gap-1 py-1 transition-colors cursor-pointer select-none ${
                  isLowerThanPrevious && !isReset ? 'text-rose-600 font-extrabold' : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                {showOptionalFields ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                <span>
                  {showOptionalFields
                    ? (t('finance.utilities.hideOptional') || 'Hide optional fields')
                    : isLowerThanPrevious && !isReset
                    ? (t('finance.utilities.meterResetRequired') || '+ Meter Reset / Rolled Over (Required for lower reading)')
                    : (t('finance.utilities.addNoteOrReset') || '+ Add note or meter reset')}
                </span>
              </button>

              {showOptionalFields && (
                <div className="pt-2 pb-1 space-y-2.5 animate-in fade-in duration-150">
                  {/* Meter Replaced / Rolled Over Checkbox */}
                  <div
                    className={`flex items-start gap-2 p-2 rounded-xl border ${
                      isLowerThanPrevious && !isReset
                        ? 'bg-amber-50/90 border-amber-300 ring-1 ring-amber-300'
                        : 'bg-stone-50/70 border-stone-200/80'
                    }`}
                  >
                    <input
                      type="checkbox"
                      id="isReset"
                      checked={isReset}
                      onChange={(e) => setIsReset(e.target.checked)}
                      className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer h-4 w-4"
                    />
                    <label htmlFor="isReset" className="text-xs text-stone-700 cursor-pointer select-none font-medium">
                      <span className="font-bold text-stone-900 block">
                        {t('finance.utilities.meterReset') || 'Meter Replaced / Rolled Over'}
                      </span>
                      <span className="text-[10px] text-stone-500 block">
                        {t('finance.utilities.meterResetDesc') || 'Establishes this reading as the new starting baseline (delta = 0).'}
                      </span>
                    </label>
                  </div>

                  {/* Notes input */}
                  <div>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={t('finance.utilities.notesPlaceholder') || 'e.g. Evening shift closing reading'}
                      className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Primary Full-Width Save CTA */}
            <button
              type="submit"
              disabled={saving || (isLowerThanPrevious && !isReset)}
              className="w-full h-11 rounded-xl font-bold text-xs sm:text-sm text-white bg-amber-600 hover:bg-amber-700 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>{t('finance.utilities.saving') || 'Saving Reading...'}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{t('finance.utilities.saveReading') || 'Save Reading'}</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Activity Ledger (7 cols on lg:) */}
        <div
          id="electricity-history-ledger"
          className="lg:col-span-7 bg-white rounded-2xl border border-stone-200/90 shadow-2xs overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-3.5 sm:px-4 py-3 border-b border-stone-100 flex items-center justify-between">
            <div>
              <div className="font-bold text-xs sm:text-sm text-stone-900">
                {t('finance.utilities.historyTitle', { date: formatDisplayDate(businessDate, locale) }) ||
                  `Readings Log — ${formatDisplayDate(businessDate, locale)}`}
              </div>
              <div className="text-[11px] text-stone-400">
                {meterReadings.length === 1
                  ? (t('finance.utilities.entryRecorded') || '1 entry recorded')
                  : (t('finance.utilities.entriesRecorded', { count: meterReadings.length }) || `${meterReadings.length} entries recorded`)}
              </div>
            </div>
            <Badge variant={meterReadings.length > 0 ? 'success' : 'outline'} className="text-[10px]">
              {meterReadings.length}
            </Badge>
          </div>

          <div className="flex-1">
            {meterReadings.length === 0 ? (
              <div className="py-8 px-4 text-center text-stone-400 text-xs space-y-1.5">
                <History className="h-7 w-7 mx-auto text-stone-300" />
                <div className="font-semibold text-stone-600">
                  {t('finance.utilities.noReadings', { date: formatDisplayDate(businessDate, locale) }) ||
                    `No readings logged for ${formatDisplayDate(businessDate, locale)} yet.`}
                </div>
                <div className="text-[11px] text-stone-400">
                  {t('finance.utilities.noReadingsSub') || "Record your first meter reading to start today's log."}
                </div>
              </div>
            ) : (
              <>
                {/* Mobile View: Scannable Rows with hairline divide (no bulky gap cards) */}
                <div className="divide-y divide-stone-100 md:hidden">
                  {meterReadings.map((r) => {
                    const prevVal =
                      r.previous_reading_value !== null && r.previous_reading_value !== undefined
                        ? Number(r.previous_reading_value)
                        : null;
                    const readingVal = Number(r.reading_value);
                    const deltaVal = Number(r.delta_consumption || 0);
                    const costVal = deltaVal * costPerUnit;
                    const timeFormatted = new Date(r.reading_timestamp).toLocaleTimeString(
                      locale === 'hi' ? 'hi-IN' : 'en-IN',
                      { hour: 'numeric', minute: '2-digit', hour12: true }
                    );

                    return (
                      <div key={r.id} className="p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-stone-900 flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-amber-600" />
                            {timeFormatted}
                          </span>
                          <span className="font-mono font-bold text-xs text-stone-900">
                            {formatINR(costVal)}
                          </span>
                        </div>

                        <div className="flex items-baseline justify-between text-xs">
                          <div>
                            <span className="text-[11px] text-stone-400 mr-1.5">{t('finance.utilities.readingLabel') || 'Reading'}:</span>
                            <span className="font-mono font-black text-stone-900 text-sm">
                              {readingVal.toFixed(1)} {displayUnit}
                            </span>
                          </div>
                          <div>
                            {r.is_reset ? (
                              <Badge variant="info" className="text-[10px] font-semibold">
                                RESET
                              </Badge>
                            ) : (
                              <span className="font-mono font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60 text-xs">
                                +{deltaVal.toFixed(1)} {displayUnit}
                              </span>
                            )}
                          </div>
                        </div>

                        {(prevVal !== null || r.notes) && (
                          <div className="text-[10px] text-stone-400 flex items-center justify-between pt-0.5">
                            {prevVal !== null && <span>{t('finance.utilities.colPrior') || 'Prior'}: {prevVal.toFixed(1)}</span>}
                            {r.notes && (
                              <span className="italic text-stone-500 truncate max-w-[200px]">
                                {r.notes}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop View: Responsive Table */}
                <div className="hidden md:block overflow-x-auto text-xs">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                        <th className="py-2.5 px-3">{t('finance.utilities.colTime') || 'Time'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.utilities.colPrior') || 'Prior'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.utilities.readingLabel') || 'Reading'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.utilities.colDelta') || 'Delta'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.utilities.colCost') || 'Cost'}</th>
                        <th className="py-2.5 px-3">{t('finance.utilities.colNotes') || 'Notes'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {meterReadings.map((r) => {
                        const prevVal =
                          r.previous_reading_value !== null && r.previous_reading_value !== undefined
                            ? Number(r.previous_reading_value)
                            : null;
                        const readingVal = Number(r.reading_value);
                        const deltaVal = Number(r.delta_consumption || 0);
                        const costVal = deltaVal * costPerUnit;

                        return (
                          <tr key={r.id} className="hover:bg-stone-50/80 transition-colors">
                            <td className="py-2 px-3 text-stone-700 whitespace-nowrap font-medium">
                              {new Date(r.reading_timestamp).toLocaleTimeString(
                                locale === 'hi' ? 'hi-IN' : 'en-IN',
                                { hour: 'numeric', minute: '2-digit', hour12: true }
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-stone-500">
                              {prevVal !== null ? `${prevVal.toFixed(1)}` : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-stone-900">
                              {readingVal.toFixed(1)}
                              {r.is_reset && (
                                <span className="ml-1.5 text-[9px] bg-sky-100 text-sky-800 px-1 py-0.2 rounded font-sans font-semibold">
                                  RESET
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-amber-700 font-mono">
                              {r.is_reset ? (
                                <span className="text-sky-700 font-normal">{t('common.actions.reset') || 'Reset'}</span>
                              ) : deltaVal > 0 ? (
                                `+${deltaVal.toFixed(1)} ${displayUnit}`
                              ) : (
                                `0.0 ${displayUnit}`
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-stone-900 font-mono">
                              {formatINR(costVal)}
                            </td>
                            <td className="py-2 px-3 text-stone-500 max-w-xs truncate">
                              {r.notes || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
