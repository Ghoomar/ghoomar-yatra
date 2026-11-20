'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TimePicker } from '@/components/ui/TimePicker';
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
  RotateCcw,
} from 'lucide-react';

interface ElectricityTabProps {
  businessDate: string;
  meters: any[];
  readings: any[];
  selectedMeterId: string;
  setSelectedMeterId: (id: string) => void;
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error'; text: string }) => void;
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
  const [saving, setSaving] = useState(false);
  const [costPerUnit, setCostPerUnit] = useState<number>(10.0);
  const [latestPriorReading, setLatestPriorReading] = useState<number | null>(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);

  // Default to first meter if not explicitly selected
  const selectedMeter = meters.find((m) => m.id === selectedMeterId) || meters[0];
  const unitLabel = selectedMeter?.unit || 'KVAH';
  const meterName = selectedMeter?.meter_name || 'Main Electric Meter';

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
        } else {
          const { data: anyLatest } = await supabase
            .from('meter_readings')
            .select('reading_value')
            .eq('meter_id', selectedMeter.id)
            .order('reading_timestamp', { ascending: false })
            .limit(1);
          setLatestPriorReading(anyLatest && anyLatest.length > 0 ? Number(anyLatest[0].reading_value) : null);
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

  const previewCost = previewConsumption * costPerUnit;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMeter?.id || !isInputValid) return;

    if (isLowerThanPrevious && !isReset) {
      alert(
        `Invalid reading: ${parsedNewReading} < ${latestPriorReading} ${unitLabel}.\n\nIf the meter rolled over or was replaced, check "Meter Replaced / Rolled Over" to establish a new baseline.`
      );
      return;
    }

    setSaving(true);

    try {
      // Combine business date with selected time
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
      setReadingTime(getCurrentTimeHHMM());
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save reading.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Compact KPI Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {/* KPI 1: Today's Total Consumption & Cost */}
        <div className="col-span-2 sm:col-span-1 bg-white p-3.5 rounded-2xl border border-stone-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              {t('finance.utilities.todayConsumption') || "Today's Consumption"}
            </span>
            <div className="p-1 rounded-lg bg-amber-50 text-amber-700">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-black font-mono text-amber-600">
              {todayConsumption > 0 ? `${formatNumber(todayConsumption)} ${unitLabel}` : `0.0 ${unitLabel}`}
            </div>
            <div className="text-[11px] text-stone-600 font-medium mt-0.5 flex items-center justify-between">
              <span>{t('finance.utilities.estimatedCost') || 'Estimated Cost'}:</span>
              <span className="font-mono font-bold text-stone-900">{formatINR(todayEstimatedCost)}</span>
            </div>
            <div className="text-[10px] text-stone-400 mt-0.5">
              @ {formatINR(costPerUnit)} / {unitLabel}
            </div>
          </div>
        </div>

        {/* KPI 2: Latest Recorded Baseline Reading */}
        <div className="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              {t('finance.utilities.previousReading') || 'Prior Reading'}
            </span>
            <div className="p-1 rounded-lg bg-stone-100 text-stone-600">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-lg sm:text-2xl font-black font-mono text-stone-900">
              {loadingBaseline
                ? '...'
                : latestPriorReading !== null
                ? `${latestPriorReading.toFixed(1)} ${unitLabel}`
                : t('finance.utilities.noPriorReading') || 'None'}
            </div>
            <div className="text-[11px] text-stone-500 font-medium mt-0.5 truncate">
              {meterName}
            </div>
          </div>
        </div>

        {/* KPI 3: Readings Count & Continuous Status */}
        <div className="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              {t('finance.utilities.status') || 'Day Status'}
            </span>
            <Badge variant={meterReadings.length > 0 ? 'success' : 'outline'} className="text-[10px]">
              {meterReadings.length} {t('finance.utilities.readings') || 'Readings'}
            </Badge>
          </div>
          <div className="mt-2">
            <div className="text-sm font-bold text-stone-800 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Active Logging</span>
            </div>
            <div className="text-[11px] text-stone-400 mt-0.5">
              Date: <strong className="text-stone-700">{businessDate}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Main Form & Ledger Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Action Form: Log Reading (Desktop 5 cols, Mobile full) */}
        <Card className="lg:col-span-5 rounded-2xl border-stone-200 shadow-2xs">
          <CardHeader className="pb-3 border-b border-stone-100">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2 text-stone-900">
                <Zap className="h-4 w-4 text-amber-600" />
                {t('finance.utilities.meterReading') || 'Record Meter Reading'}
              </CardTitle>
              <Badge variant="outline" className="font-mono text-[10px] border-amber-300 text-amber-800 bg-amber-50/50">
                {unitLabel}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="pt-4">
            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
              {/* 1. Meter Identity */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  {t('finance.utilities.meter') || 'Meter'}
                </label>
                {meters.length > 1 ? (
                  <select
                    value={selectedMeter?.id}
                    onChange={(e) => setSelectedMeterId(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 p-2 font-bold text-stone-900 focus:ring-2 focus:ring-amber-500 bg-white"
                  >
                    {meters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.meter_name} ({m.unit || 'KVAH'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200/80 flex items-center justify-between">
                    <span className="font-bold text-stone-900 text-xs sm:text-sm">{meterName}</span>
                    <span className="text-[11px] font-mono font-semibold text-stone-500 bg-white px-2 py-0.5 rounded border border-stone-200">
                      {unitLabel}
                    </span>
                  </div>
                )}
              </div>

              {/* 2. Reading Time (TimePicker) */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  {t('finance.utilities.readingTime') || 'Reading Time (HH:mm)'} <span className="text-rose-500">*</span>
                </label>
                <TimePicker
                  value={readingTime}
                  onChange={(val) => setReadingTime(val)}
                  required
                  triggerClassName="w-full p-1 border-stone-300 rounded-xl"
                />
              </div>

              {/* 3. Prior Reading Reference Display */}
              <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200/70 flex items-center justify-between text-stone-600">
                <span className="font-medium">{t('finance.utilities.previousReading') || 'Previous Reading'}:</span>
                <strong className="font-mono text-stone-900 text-sm">
                  {loadingBaseline ? '...' : latestPriorReading !== null ? `${latestPriorReading.toFixed(1)} ${unitLabel}` : '—'}
                </strong>
              </div>

              {/* 4. Current Reading Input */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  {t('finance.utilities.currentReading') || 'Current Meter Reading'} <span className="text-rose-500">*</span>
                </label>
                <div className="relative rounded-xl shadow-2xs">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={newReading}
                    onChange={(e) => setNewReading(e.target.value)}
                    placeholder={latestPriorReading !== null ? (latestPriorReading + 5).toFixed(1) : '0.0'}
                    required
                    className={`w-full rounded-xl border p-2.5 font-bold font-mono text-base text-stone-900 focus:ring-2 focus:outline-none pr-14 ${
                      isLowerThanPrevious && !isReset
                        ? 'border-rose-400 focus:ring-rose-500 bg-rose-50/30'
                        : 'border-stone-300 focus:ring-amber-500 bg-white'
                    }`}
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                    {unitLabel}
                  </div>
                </div>

                {isLowerThanPrevious && !isReset && (
                  <p className="text-[11px] text-rose-600 mt-1.5 flex items-center gap-1 font-semibold">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    Reading is lower than prior ({latestPriorReading} {unitLabel}). Check Reset below if replaced.
                  </p>
                )}
              </div>

              {/* 5. Live Delta & Cost Preview */}
              {isInputValid && latestPriorReading !== null && (
                <div className="p-3 bg-amber-50/70 border border-amber-200/70 rounded-xl space-y-1">
                  <div className="font-bold text-amber-900 flex items-center justify-between text-xs">
                    <span>{t('finance.utilities.previewDelta') || 'Calculated Delta'}:</span>
                    <span className="font-mono text-sm font-extrabold text-amber-800">
                      {isReset ? `0.0 ${unitLabel} (Reset)` : `+${previewConsumption.toFixed(1)} ${unitLabel}`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-stone-600 text-[11px]">
                    <span>{t('finance.utilities.previewCost') || 'Estimated Cost'}:</span>
                    <strong className="font-mono text-stone-900">{formatINR(previewCost)}</strong>
                  </div>
                </div>
              )}

              {/* 6. Meter Reset Checkbox */}
              <div className="flex items-start gap-2 pt-0.5">
                <input
                  type="checkbox"
                  id="isReset"
                  checked={isReset}
                  onChange={(e) => setIsReset(e.target.checked)}
                  className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer h-4 w-4"
                />
                <label
                  htmlFor="isReset"
                  className="text-xs text-stone-700 cursor-pointer select-none leading-tight font-medium"
                >
                  <span className="font-bold text-stone-900">
                    {t('finance.utilities.meterReset') || 'Meter Replaced / Rolled Over'}
                  </span>
                  <span className="block text-[10px] text-stone-500">
                    Establishes this reading as the new starting baseline (delta = 0).
                  </span>
                </label>
              </div>

              {/* 7. Notes */}
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  {t('finance.utilities.notes') || 'Notes (Optional)'}
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('finance.utilities.notesPlaceholder') || 'e.g. Evening shift closing reading'}
                  className="w-full rounded-xl border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              {/* 8. Save Button */}
              <Button
                type="submit"
                variant="amber"
                disabled={saving || (isLowerThanPrevious && !isReset)}
                className="w-full rounded-xl mt-2 gap-1.5 py-2.5 font-bold shadow-xs cursor-pointer"
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
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Activity Ledger: Desktop Table & Mobile Cards (Desktop 7 cols, Mobile full) */}
        <Card className="lg:col-span-7 rounded-2xl border-stone-200 shadow-2xs">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-stone-100">
            <div>
              <CardTitle className="text-sm sm:text-base font-bold text-stone-900">
                {t('finance.utilities.historyTitle', { date: businessDate }) || `Readings Log — ${businessDate}`}
              </CardTitle>
              <CardDescription className="text-xs">
                {meterReadings.length}{' '}
                {meterReadings.length === 1 ? 'entry recorded' : 'entries recorded'} for this business date
              </CardDescription>
            </div>
            <Badge variant={meterReadings.length > 0 ? 'success' : 'outline'}>
              {meterReadings.length}
            </Badge>
          </CardHeader>

          <CardContent className="pt-3">
            {meterReadings.length === 0 ? (
              <div className="py-14 text-center text-stone-400 text-xs space-y-2">
                <History className="h-8 w-8 mx-auto text-stone-300" />
                <div className="font-semibold text-stone-600">
                  {t('finance.utilities.noReadings', { date: businessDate }) || `No readings recorded on ${businessDate}`}
                </div>
                <div className="text-[11px] text-stone-400">
                  Use the form on the left to record the first meter reading.
                </div>
              </div>
            ) : (
              <>
                {/* Mobile View: Compact History Cards (Zero horizontal scroll) */}
                <div className="space-y-2.5 md:hidden">
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
                      <div
                        key={r.id}
                        className="p-3 bg-stone-50/70 rounded-xl border border-stone-200/80 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-stone-900 flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-amber-600" />
                            {timeFormatted}
                          </span>
                          <span className="font-mono font-bold text-xs text-stone-900">
                            {formatINR(costVal)}
                          </span>
                        </div>

                        <div className="flex items-baseline justify-between pt-1 border-t border-stone-200/50 text-xs">
                          <div>
                            <span className="text-[11px] text-stone-500 mr-1.5">Reading:</span>
                            <span className="font-mono font-black text-stone-900 text-sm">
                              {readingVal.toFixed(1)} {unitLabel}
                            </span>
                          </div>
                          <div>
                            {r.is_reset ? (
                              <Badge variant="info" className="text-[10px] font-semibold">
                                RESET
                              </Badge>
                            ) : (
                              <span className="font-mono font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60 text-xs">
                                +{deltaVal.toFixed(1)} {unitLabel}
                              </span>
                            )}
                          </div>
                        </div>

                        {(prevVal !== null || r.notes) && (
                          <div className="text-[11px] text-stone-500 pt-1 flex items-center justify-between border-t border-stone-200/40">
                            {prevVal !== null && <span>Prior: {prevVal.toFixed(1)}</span>}
                            {r.notes && <span className="italic text-stone-600 truncate max-w-[200px]">{r.notes}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop View: Clean Responsive Table */}
                <div className="hidden md:block overflow-x-auto text-xs">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                        <th className="py-2.5 px-3">{t('finance.utilities.colTime') || 'Time'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.utilities.previousReading') || 'Prior'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.utilities.colReading') || 'Reading'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.utilities.colDelta') || 'Consumption'}</th>
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
                            <td className="py-2.5 px-3 text-stone-700 whitespace-nowrap font-medium">
                              {new Date(r.reading_timestamp).toLocaleTimeString(
                                locale === 'hi' ? 'hi-IN' : 'en-IN',
                                { hour: 'numeric', minute: '2-digit', hour12: true }
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-stone-500">
                              {prevVal !== null ? `${prevVal.toFixed(1)}` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-stone-900">
                              {readingVal.toFixed(1)}
                              {r.is_reset && (
                                <span className="ml-1.5 text-[9px] bg-sky-100 text-sky-800 px-1 py-0.2 rounded font-sans font-semibold">
                                  RESET
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-amber-700 font-mono">
                              {r.is_reset ? (
                                <span className="text-sky-700 font-normal">Reset</span>
                              ) : deltaVal > 0 ? (
                                `+${deltaVal.toFixed(1)} ${unitLabel}`
                              ) : (
                                `0.0 ${unitLabel}`
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-stone-900 font-mono">
                              {formatINR(costVal)}
                            </td>
                            <td className="py-2.5 px-3 text-stone-500 max-w-xs truncate">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
