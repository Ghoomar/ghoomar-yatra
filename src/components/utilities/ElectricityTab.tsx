'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { formatNumber } from '@/lib/utils';

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
  const [newReading, setNewReading] = useState<number>(0);
  const [isReset, setIsReset] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const meterReadings = readings.filter((r) => r.meter_id === selectedMeterId);
  const lastReading = meterReadings.length > 0 ? Number(meterReadings[meterReadings.length - 1].reading_value) : 0;
  const firstReading = meterReadings.length > 0 ? Number(meterReadings[0].reading_value) : 0;
  const delta = meterReadings.length > 1 ? lastReading - firstReading : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMeterId || newReading <= 0) return;
    setSaving(true);

    if (lastReading > 0 && newReading < lastReading && !isReset) {
      alert(`Invalid reading: ${newReading} < ${lastReading}. If meter was replaced or reset, check 'Meter Replaced / Rolled Over'.`);
      setSaving(false);
      return;
    }

    try {
      const { error } = await supabase.from('meter_readings').insert({
        meter_id: selectedMeterId,
        business_date: businessDate,
        reading_value: newReading,
        is_reset: isReset,
        notes,
      });

      if (error) throw error;
      setMessage({ type: 'success', text: `Meter reading ${newReading} kWh saved.` });
      setNewReading(0);
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardDescription>Today's Electricity Consumption</CardDescription>
          <div className="text-2xl font-bold text-amber-600 mt-1">
            {delta > 0 ? `${formatNumber(delta)} kWh` : 'Awaiting delta readings'}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Calculated between opening and latest reading</div>
        </Card>
        <Card>
          <CardDescription>Readings Logged Today</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">{meterReadings.length}</div>
          <div className="text-[11px] text-stone-500 mt-1">Supports multiple daily time-block readings</div>
        </Card>
        <Card>
          <CardDescription>Negative Guard</CardDescription>
          <div className="text-base font-semibold text-emerald-700 mt-1">Active Validation</div>
          <div className="text-[11px] text-stone-500 mt-1">Rejects lower reading unless reset flagged</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Log Meter Reading</CardTitle>
            <CardDescription>Record kWh reading</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Meter</label>
                <select
                  value={selectedMeterId}
                  onChange={(e) => setSelectedMeterId(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  {meters.map((m) => (
                    <option key={m.id} value={m.id}>{m.meter_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Reading Value (kWh)</label>
                <input
                  type="number"
                  step="0.1"
                  value={newReading || ''}
                  onChange={(e) => setNewReading(parseFloat(e.target.value) || 0)}
                  placeholder="0.0"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 font-bold text-sm text-stone-900 focus:outline-none"
                />
                {lastReading > 0 && (
                  <div className="text-[11px] text-stone-500 mt-1">
                    Previous reading: <strong>{lastReading} kWh</strong>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isReset"
                  checked={isReset}
                  onChange={(e) => setIsReset(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500"
                />
                <label htmlFor="isReset" className="text-xs text-stone-700">
                  Meter Replaced / Rolled Over
                </label>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Shift / Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. 14:00 Lunch Shift Reading"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <Button type="submit" variant="amber" disabled={saving} className="w-full mt-2">
                {saving ? 'Saving...' : 'Record Reading'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Meter Reading Ledger ({businessDate})</CardTitle>
            <CardDescription>Consecutive readings and consumption delta</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {meterReadings.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">No readings recorded for {businessDate}.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-3">Meter</th>
                      <th className="py-2 px-3 text-right">Reading (kWh)</th>
                      <th className="py-2 px-3 text-right">Delta (kWh)</th>
                      <th className="py-2 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {meterReadings.map((r, idx) => {
                      const prev = idx > 0 ? Number(meterReadings[idx - 1].reading_value) : null;
                      const d = prev !== null ? Number(r.reading_value) - prev : 0;
                      return (
                        <tr key={r.id} className="hover:bg-stone-50/80">
                          <td className="py-2 px-3 text-stone-700">
                            {new Date(r.reading_timestamp).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
                          </td>
                          <td className="py-2 px-3 font-semibold text-stone-900">{r.meter?.meter_name || 'Main Meter'}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-stone-900">{Number(r.reading_value).toFixed(1)}</td>
                          <td className="py-2 px-3 text-right font-semibold text-amber-700">
                            {idx === 0 ? 'Opening' : `+${d.toFixed(1)} kWh`}
                          </td>
                          <td className="py-2 px-3 text-stone-500">{r.notes || '—'}</td>
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
