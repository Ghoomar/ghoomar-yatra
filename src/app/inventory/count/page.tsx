'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { calculatePhysicalCountVariance } from '@/lib/inventory-engine';
import { ClipboardCheck, Save, RefreshCw, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';

interface CountItemRow {
  item_id: string;
  name: string;
  item_code: string;
  unit_symbol: string;
  expected_qty: number;
  physical_qty: number;
  wac_cost: number;
  reason: string;
}

export default function StockCountPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [rows, setRows] = useState<CountItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: pos, error } = await supabase
        .from('inventory_current_position')
        .select('*')
        .order('name');

      if (error) throw error;

      setRows(
        (pos || []).map((p) => ({
          item_id: p.item_id,
          name: p.name,
          item_code: p.item_code,
          unit_symbol: p.unit_symbol || 'units',
          expected_qty: Number(p.current_quantity) || 0,
          physical_qty: Number(p.current_quantity) || 0, // defaults to expected
          wac_cost: Number(p.wac_cost) || 0,
          reason: '',
        }))
      );
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to load inventory for count.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveCount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      // 1. Create inventory count header
      const { data: header, error: hErr } = await supabase
        .from('inventory_counts')
        .insert({
          business_date: businessDate,
          count_type: 'Monthly Physical Verification',
          status: 'approved',
          notes: 'Physical count verified against store ledger',
        })
        .select()
        .single();

      if (hErr) throw hErr;

      // 2. Loop rows, insert count items and create adjustment movements for variances
      let adjustmentsCreated = 0;
      for (const row of rows) {
        const { varianceQuantity, varianceValue } = calculatePhysicalCountVariance(
          row.expected_qty,
          row.physical_qty,
          row.wac_cost
        );

        await supabase.from('inventory_count_items').insert({
          count_id: header.id,
          item_id: row.item_id,
          expected_quantity: row.expected_qty,
          physical_quantity: row.physical_qty,
          variance_quantity: varianceQuantity,
          variance_value: varianceValue,
          reason: row.reason || (varianceQuantity !== 0 ? 'Monthly verification variance' : 'No variance'),
        });

        // If variance exists, log an atomic count_adjustment movement
        if (varianceQuantity !== 0) {
          adjustmentsCreated++;
          await supabase.from('stock_movements').insert({
            business_date: businessDate,
            item_id: row.item_id,
            movement_type: 'count_adjustment',
            quantity: varianceQuantity,
            unit_cost: row.wac_cost,
            total_value: Math.abs(varianceValue),
            purpose: 'Monthly Physical Verification',
            reference_id: header.id,
            reference_type: 'inventory_counts',
            notes: row.reason || `Variance of ${varianceQuantity > 0 ? '+' : ''}${varianceQuantity} ${row.unit_symbol}`,
          });

          // Sync cached current stock
          await supabase
            .from('inventory_items')
            .update({
              current_stock: row.physical_qty,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.item_id);
        }
      }

      setMessage({
        type: 'success',
        text: `Physical verification saved. ${adjustmentsCreated} variance adjustments posted to movement ledger!`,
      });
      loadData();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Error posting stock verification.' });
    } finally {
      setSaving(false);
    }
  };

  const totalVarianceValue = rows.reduce((sum, r) => {
    const { varianceValue } = calculatePhysicalCountVariance(r.expected_qty, r.physical_qty, r.wac_cost);
    return sum + varianceValue;
  }, 0);

  const totalVarianceItems = rows.filter((r) => r.physical_qty !== r.expected_qty).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-amber-600" />
            Monthly Physical Stock Verification
          </h1>
          <p className="text-sm text-stone-500">
            Compare theoretical ledger stock against physical store counts and post auditable variance adjustments.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-xs text-xs font-medium">
            <span className="text-stone-500">Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
            message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
          {message.text}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Net Inventory Variance Value</CardDescription>
            <div className={`text-2xl font-bold mt-1 ${totalVarianceValue < 0 ? 'text-rose-600' : totalVarianceValue > 0 ? 'text-blue-600' : 'text-stone-900'}`}>
              {formatINR(totalVarianceValue)}
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            {totalVarianceValue < 0 ? 'Physical shortage (Loss / Wastage)' : totalVarianceValue > 0 ? 'Physical surplus' : 'Exact match to ledger'}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Items with Variances</CardDescription>
            <div className="text-2xl font-bold text-amber-600 mt-1">
              {totalVarianceItems} of {rows.length} SKUs
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            Will generate movement ledger adjustments upon save
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Audit Integrity</CardDescription>
            <div className="text-base font-semibold text-stone-800 mt-1">Permanent Adjustment Ledger</div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            Every variance records reason, expected ledger count & physical count
          </CardContent>
        </Card>
      </div>

      {/* Count Form */}
      <Card>
        <CardHeader>
          <CardTitle>Physical Count Entry</CardTitle>
          <CardDescription>Enter actual verified quantities found on physical store shelves</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading stock items for audit...
            </div>
          ) : (
            <form onSubmit={handleSaveCount} className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">SKU</th>
                      <th className="py-2.5 px-3">Item Name</th>
                      <th className="py-2.5 px-3 text-right">Expected (Ledger)</th>
                      <th className="py-2.5 px-3 text-center">Actual (Physical)</th>
                      <th className="py-2.5 px-3 text-right">Variance</th>
                      <th className="py-2.5 px-3 text-right">Value (₹)</th>
                      <th className="py-2.5 px-3">Reason / Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {rows.map((r, idx) => {
                      const { varianceQuantity, varianceValue } = calculatePhysicalCountVariance(
                        r.expected_qty,
                        r.physical_qty,
                        r.wac_cost
                      );
                      return (
                        <tr key={r.item_id} className="hover:bg-stone-50/80">
                          <td className="py-3 px-3 font-mono text-stone-500">{r.item_code}</td>
                          <td className="py-3 px-3 font-semibold text-stone-900">{r.name}</td>
                          <td className="py-3 px-3 text-right font-medium text-stone-700">
                            {r.expected_qty.toFixed(2)} {r.unit_symbol}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <input
                              type="number"
                              step="0.01"
                              value={r.physical_qty}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const next = [...rows];
                                next[idx].physical_qty = val;
                                setRows(next);
                              }}
                              className="w-24 rounded border border-stone-300 p-1.5 text-center font-bold text-stone-900 text-xs focus:outline-none focus:border-amber-500"
                            />
                          </td>
                          <td className={`py-3 px-3 text-right font-bold text-xs ${
                            varianceQuantity === 0 ? 'text-stone-400' : varianceQuantity > 0 ? 'text-blue-600' : 'text-rose-600'
                          }`}>
                            {varianceQuantity === 0 ? '0' : varianceQuantity > 0 ? `+${varianceQuantity.toFixed(2)}` : varianceQuantity.toFixed(2)}
                          </td>
                          <td className="py-3 px-3 text-right font-medium text-stone-800">
                            {formatINR(varianceValue)}
                          </td>
                          <td className="py-3 px-3">
                            <input
                              type="text"
                              value={r.reason}
                              onChange={(e) => {
                                const next = [...rows];
                                next[idx].reason = e.target.value;
                                setRows(next);
                              }}
                              placeholder={varianceQuantity !== 0 ? 'Required reason (e.g. Spoilage, Damage, Loss)' : 'Optional'}
                              className="w-full rounded border border-stone-300 p-1 text-xs focus:outline-none focus:border-amber-500"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-stone-200">
                <div className="text-xs text-stone-500">
                  Posting count creates an auditable inventory count record and synchronizes current stock.
                </div>
                <Button type="submit" variant="primary" disabled={saving} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white">
                  <Save className="h-4 w-4" /> {saving ? 'Submitting...' : 'Approve & Post Verification Adjustments'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

