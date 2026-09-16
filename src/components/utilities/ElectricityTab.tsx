'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatNumber, formatINR } from '@/lib/utils';
import { Zap, Calculator, RefreshCw, AlertCircle, CheckCircle2, History, RotateCcw } from 'lucide-react';

interface ElectricityTabProps {
  businessDate: string;
  meters: any[];
  readings: any[];
  selectedMeterId: string;
  setSelectedMeterId: (id: string) => void;
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error'; text: string }) => void;
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
  const [newReading, setNewReading] = useState<string>('');
  const [isReset, setIsReset] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [costPerUnit, setCostPerUnit] = useState<number>(10.00);
  const [latestPriorReading, setLatestPriorReading] = useState<number | null>(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);

  const selectedMeter = meters.find((m) => m.id === selectedMeterId) || meters[0];
  const unitLabel = selectedMeter?.unit || 'KVAH';

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
  // Finds the latest reading strictly prior to or on the current business date
  useEffect(() => {
    const fetchBaseline = async () => {
      if (!selectedMeterId) return;
      setLoadingBaseline(true);
      try {
        // Find latest reading chronologically
        const { data } = await supabase
          .from('meter_readings')
          .select('reading_value, reading_timestamp, business_date')
          .eq('meter_id', selectedMeterId)
          .lte('business_date', businessDate)
          .order('reading_timestamp', { ascending: false })
          .limit(1);

        if (data && data.length > 0) {
          setLatestPriorReading(Number(data[0].reading_value));
        } else {
          // Fallback to any latest reading
          const { data: anyLatest } = await supabase
            .from('meter_readings')
            .select('reading_value')
            .eq('meter_id', selectedMeterId)
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
  }, [selectedMeterId, businessDate, readings, supabase]);

  // Filter readings for current selected meter from props
  const meterReadings = readings.filter((r) => r.meter_id === selectedMeterId);

  // Total consumption for selected business date = sum of delta_consumption for readings on that date
  const todayConsumption = meterReadings.reduce((sum, r) => sum + (Number(r.delta_consumption) || 0), 0);
  const todayEstimatedCost = todayConsumption * costPerUnit;

  // Real-time calculation for input
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
    if (!selectedMeterId || !isInputValid) return;

    if (isLowerThanPrevious && !isReset) {
      alert(
        `Invalid reading: ${parsedNewReading} < ${latestPriorReading} ${unitLabel}.\n\nIf the meter rolled over or was replaced, check "Meter Replaced / Rolled Over" to establish a new baseline.`
      );
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase.from('meter_readings').insert({
        meter_id: selectedMeterId,
        business_date: businessDate,
        reading_timestamp: new Date().toISOString(),
        reading_value: parsedNewReading,
        is_reset: isReset,
        notes: notes.trim() || null,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text: `Meter reading ${parsedNewReading.toFixed(1)} ${unitLabel} logged successfully. Consumption: +${previewConsumption.toFixed(1)} ${unitLabel} (${formatINR(previewCost)}).`,
      });

      setNewReading('');
      setIsReset(false);
      setNotes('');
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save reading.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardDescription>Today's Consumption</CardDescription>
          <div className="text-2xl font-bold text-amber-600 mt-1">
            {todayConsumption > 0 ? `${formatNumber(todayConsumption)} ${unitLabel}` : `0.0 ${unitLabel}`}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            Estimated Cost: <strong className="text-stone-900 font-mono">{formatINR(todayEstimatedCost)}</strong>
            <span className="text-[10px] text-stone-400 ml-1">(@ {formatINR(costPerUnit)}/{unitLabel})</span>
          </div>
        </Card>

        <Card>
          <CardDescription>Meter Reading</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1 font-mono">
            {latestPriorReading !== null ? `${latestPriorReading.toFixed(1)} ${unitLabel}` : 'No Prior Reading'}
          </div>
        </Card>

        <Card>
          <CardDescription>Cost Rate</CardDescription>
          <div className="text-base font-semibold text-stone-800 mt-1 flex items-center gap-1.5">
            <Calculator className="h-4 w-4 text-amber-600" />
            <span>{formatINR(costPerUnit)} / {unitLabel}</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Log Reading Form */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-600" />
              Meter Reading
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Select Meter</label>
                <select
                  value={selectedMeterId}
                  onChange={(e) => setSelectedMeterId(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 p-2.5 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none bg-white font-medium"
                >
                  {meters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.meter_name} ({m.unit || 'KVAH'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/80 space-y-1">
                <div className="flex items-center justify-between text-stone-600">
                  <span>Previous Reading:</span>
                  <strong className="font-mono text-stone-900 text-sm">
                    {loadingBaseline ? 'Loading...' : latestPriorReading !== null ? `${latestPriorReading.toFixed(1)} ${unitLabel}` : '—'}
                  </strong>
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  Current Reading <span className="text-rose-500">*</span>
                </label>
                <div className="relative rounded-lg shadow-2xs">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={newReading}
                    onChange={(e) => setNewReading(e.target.value)}
                    placeholder={latestPriorReading !== null ? (latestPriorReading + 5).toFixed(1) : '0.0'}
                    required
                    className={`w-full rounded-lg border p-2.5 font-bold text-base text-stone-900 focus:ring-2 focus:outline-none pr-14 ${
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
                  <p className="text-[11px] text-rose-600 mt-1.5 flex items-center gap-1 font-medium">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    Reading is lower than previous ({latestPriorReading} {unitLabel}). Check replacement/reset below if applicable.
                  </p>
                )}
              </div>

              {/* Dynamic Calculation Live Preview */}
              {isInputValid && latestPriorReading !== null && (
                <div className="p-3 bg-amber-50/70 border border-amber-200/70 rounded-lg space-y-1.5">
                  <div className="font-bold text-amber-900 flex items-center justify-between text-xs">
                    <span>Calculated Consumption:</span>
                    <span className="font-mono text-sm font-extrabold text-amber-800">
                      {isReset ? `0.0 ${unitLabel} (Reset)` : `+${previewConsumption.toFixed(1)} ${unitLabel}`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-stone-600 text-[11px]">
                    <span>Estimated Cost:</span>
                    <strong className="font-mono text-stone-900">{formatINR(previewCost)}</strong>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isReset"
                  checked={isReset}
                  onChange={(e) => setIsReset(e.target.checked)}
                  className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
                <label htmlFor="isReset" className="text-xs text-stone-700 cursor-pointer select-none leading-tight font-semibold text-stone-900">
                  Meter Replaced / Rolled Over
                </label>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Lunch rush closing reading"
                  className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <Button
                type="submit"
                variant="amber"
                disabled={saving || (isLowerThanPrevious && !isReset)}
                className="w-full mt-2 gap-1.5"
              >
                {saving ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> Saving Reading...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Record Reading
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Readings Ledger Table */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-bold">Meter Readings</CardTitle>
            </div>
            <Badge variant={meterReadings.length > 0 ? 'success' : 'outline'}>
              {meterReadings.length} {meterReadings.length === 1 ? 'Reading' : 'Readings'} Today
            </Badge>
          </CardHeader>
          <CardContent className="pt-0">
            {meterReadings.length === 0 ? (
              <div className="py-16 text-center text-stone-400 text-xs space-y-2">
                <History className="h-8 w-8 mx-auto text-stone-300" />
                <div>No readings logged for {businessDate}.</div>
                <div className="text-[11px] text-stone-400">
                  {latestPriorReading !== null
                    ? `Next reading will chain from prior baseline (${latestPriorReading.toFixed(1)} ${unitLabel}).`
                    : 'Log the opening reading to start the continuous ledger.'}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3 text-right">Previous</th>
                      <th className="py-2.5 px-3 text-right">Reading ({unitLabel})</th>
                      <th className="py-2.5 px-3 text-right">Consumption</th>
                      <th className="py-2.5 px-3 text-right">Estimated Cost</th>
                      <th className="py-2.5 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {meterReadings.map((r) => {
                      const prevVal = r.previous_reading_value !== null && r.previous_reading_value !== undefined
                        ? Number(r.previous_reading_value)
                        : null;
                      const readingVal = Number(r.reading_value);
                      const deltaVal = Number(r.delta_consumption || 0);
                      const costVal = deltaVal * costPerUnit;

                      return (
                        <tr key={r.id} className="hover:bg-stone-50/80">
                          <td className="py-2.5 px-3 text-stone-700 whitespace-nowrap">
                            {new Date(r.reading_timestamp).toLocaleTimeString('en-IN', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            })}
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
                          <td className="py-2.5 px-3 text-right font-semibold text-amber-700 font-mono">
                            {r.is_reset ? (
                              <span className="text-sky-700 font-normal">Baseline Reset</span>
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
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
