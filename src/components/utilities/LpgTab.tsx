'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';

interface LpgTabProps {
  businessDate: string;
  transactions: any[];
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error'; text: string }) => void;
}

export function LpgTab({ businessDate, transactions, onRefresh, setMessage }: LpgTabProps) {
  const supabase = createClient();
  const [txType, setTxType] = useState<'purchase' | 'issue' | 'adjustment'>('issue');
  const [qty, setQty] = useState<number>(1);
  const [rate, setRate] = useState<number>(1900);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const currentStock = transactions.reduce((acc, t) => {
    if (t.transaction_type === 'purchase' || t.transaction_type === 'opening') return acc + t.quantity_cylinders;
    if (t.transaction_type === 'issue') return acc - t.quantity_cylinders;
    return acc + t.quantity_cylinders;
  }, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (qty <= 0) return;
    setSaving(true);

    try {
      const total = qty * rate;
      const { error } = await supabase.from('lpg_transactions').insert({
        business_date: businessDate,
        transaction_type: txType,
        quantity_cylinders: qty,
        rate_per_cylinder: rate,
        total_cost: total,
        notes,
      });

      if (error) throw error;
      setMessage({ type: 'success', text: `LPG ${txType} of ${qty} cylinders recorded.` });
      setNotes('');
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error recording LPG.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardDescription>Available Cylinders on Hand</CardDescription>
          <div className="text-2xl font-bold text-amber-600 mt-1">{currentStock} Cylinders</div>
          <div className="text-[11px] text-stone-500 mt-1">Authoritative derived closing stock</div>
        </Card>
        <Card>
          <CardDescription>Standard Cylinder Size</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">19.5 kg Commercial</div>
          <div className="text-[11px] text-stone-500 mt-1">Bulk kitchen red cylinders</div>
        </Card>
        <Card>
          <CardDescription>LPG Accounting Method</CardDescription>
          <div className="text-base font-semibold text-stone-800 mt-1">Transaction Ledger</div>
          <div className="text-[11px] text-stone-500 mt-1">Purchases, Issues to Kitchen, Physical Adjustments</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Log Cylinder Movement</CardTitle>
            <CardDescription>Receipts or kitchen issues</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Movement Type</label>
                <select
                  value={txType}
                  onChange={(e) => setTxType(e.target.value as any)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="issue">Issue to Kitchen (Consumed)</option>
                  <option value="purchase">Purchase Inward Receipt</option>
                  <option value="adjustment">Stock Adjustment (+ / -)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Cylinder Count</label>
                <input
                  type="number"
                  value={qty || ''}
                  onChange={(e) => setQty(parseInt(e.target.value) || 0)}
                  placeholder="1"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 font-bold text-stone-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Rate per Cylinder (₹)</label>
                <input
                  type="number"
                  step="10"
                  value={rate}
                  onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-md border border-stone-300 p-2 font-semibold text-stone-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Remarks</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Connected to Main Tandoor Bank"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <Button type="submit" variant="amber" disabled={saving} className="w-full mt-2">
                {saving ? 'Recording...' : 'Record LPG Movement'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent LPG Movements</CardTitle>
            <CardDescription>Transaction audit history</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {transactions.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">No LPG transactions recorded.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3 text-right">Cylinders</th>
                      <th className="py-2 px-3 text-right">Cost</th>
                      <th className="py-2 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {transactions.slice(0, 10).map((t) => (
                      <tr key={t.id} className="hover:bg-stone-50/80">
                        <td className="py-2.5 px-3 text-stone-700 font-medium">{t.business_date}</td>
                        <td className="py-2.5 px-3 uppercase">
                          <Badge variant={t.transaction_type === 'purchase' ? 'success' : 'warning'}>
                            {t.transaction_type}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-stone-900">
                          {t.transaction_type === 'issue' ? `-${t.quantity_cylinders}` : `+${t.quantity_cylinders}`}
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
