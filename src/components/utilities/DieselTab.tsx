'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';

interface DieselTabProps {
  businessDate: string;
  transactions: any[];
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error'; text: string }) => void;
}

export function DieselTab({ businessDate, transactions, onRefresh, setMessage }: DieselTabProps) {
  const supabase = createClient();
  const [txType, setTxType] = useState<'purchase' | 'issue' | 'adjustment'>('issue');
  const [liters, setLiters] = useState<number>(20);
  const [rate, setRate] = useState<number>(88);
  const [genHours, setGenHours] = useState<number>(2.5);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const currentStock = transactions.reduce((acc, t) => {
    if (t.transaction_type === 'purchase' || t.transaction_type === 'opening') return acc + Number(t.quantity_liters);
    if (t.transaction_type === 'issue') return acc - Number(t.quantity_liters);
    return acc + Number(t.quantity_liters);
  }, 0);

  const dayGenHours = transactions
    .filter((t) => t.business_date === businessDate && t.transaction_type === 'issue')
    .reduce((sum, t) => sum + (Number(t.generator_hours) || 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (liters <= 0) return;
    setSaving(true);

    try {
      const total = liters * rate;
      const { error } = await supabase.from('diesel_transactions').insert({
        business_date: businessDate,
        transaction_type: txType,
        quantity_liters: liters,
        rate_per_liter: rate,
        total_cost: total,
        generator_hours: txType === 'issue' ? genHours : 0,
        notes,
      });

      if (error) throw error;
      setMessage({ type: 'success', text: `Diesel ${txType} of ${liters}L recorded.` });
      setNotes('');
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error recording diesel.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardDescription>Diesel Stock in Tank</CardDescription>
          <div className="text-2xl font-bold text-sky-600 mt-1">{currentStock.toFixed(1)} Liters</div>
          <div className="text-[11px] text-stone-500 mt-1">Derived from purchase & generator issue ledger</div>
        </Card>
        <Card>
          <CardDescription>Generator Running Hours Today</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">{dayGenHours.toFixed(1)} hrs</div>
          <div className="text-[11px] text-stone-500 mt-1">Backup power run-time</div>
        </Card>
        <Card>
          <CardDescription>Generator Efficiency</CardDescription>
          <div className="text-base font-semibold text-stone-800 mt-1">Litres / Operating Hour</div>
          <div className="text-[11px] text-stone-500 mt-1">Monitored for fuel economy</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Log Diesel Transaction</CardTitle>
            <CardDescription>Inward purchase or generator run</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Type</label>
                <select
                  value={txType}
                  onChange={(e) => setTxType(e.target.value as any)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="issue">Generator Consumption (Used)</option>
                  <option value="purchase">Diesel Purchase Receipt</option>
                  <option value="adjustment">Tank Dip Adjustment (+ / -)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Quantity (Liters)</label>
                <input
                  type="number"
                  step="0.5"
                  value={liters || ''}
                  onChange={(e) => setLiters(parseFloat(e.target.value) || 0)}
                  required
                  placeholder="20"
                  className="w-full rounded-md border border-stone-300 p-2 font-bold text-stone-900 focus:outline-none"
                />
              </div>

              {txType === 'issue' && (
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Gen Running Hours</label>
                  <input
                    type="number"
                    step="0.1"
                    value={genHours || ''}
                    onChange={(e) => setGenHours(parseFloat(e.target.value) || 0)}
                    placeholder="2.5"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block font-medium text-stone-700 mb-1">Rate per Liter (₹)</label>
                <input
                  type="number"
                  step="0.1"
                  value={rate}
                  onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Remarks</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Highway Grid Power Cut 18:00 - 20:30"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <Button type="submit" variant="amber" disabled={saving} className="w-full mt-2">
                {saving ? 'Recording...' : 'Record Diesel Transaction'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Diesel Movements</CardTitle>
            <CardDescription>Transaction audit history</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {transactions.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">No diesel transactions recorded.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3 text-right">Liters</th>
                      <th className="py-2 px-3 text-right">Hours</th>
                      <th className="py-2 px-3 text-right">Cost</th>
                      <th className="py-2 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {transactions.slice(0, 10).map((t) => (
                      <tr key={t.id} className="hover:bg-stone-50/80">
                        <td className="py-2.5 px-3 text-stone-700 font-medium">{t.business_date}</td>
                        <td className="py-2.5 px-3 uppercase">
                          <Badge variant={t.transaction_type === 'purchase' ? 'success' : 'info'}>
                            {t.transaction_type}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-stone-900">
                          {t.transaction_type === 'issue' ? `-${t.quantity_liters}L` : `+${t.quantity_liters}L`}
                        </td>
                        <td className="py-2.5 px-3 text-right text-stone-700">
                          {t.generator_hours ? `${t.generator_hours}h` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-stone-700">
                          {formatINR(Number(t.total_cost))}
                        </td>
                        <td className="py-2.5 px-3 text-stone-500">{t.notes || '—'}</td>
                      </tr>
                    ))}
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
