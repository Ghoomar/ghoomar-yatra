'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate, formatTimeAgo } from '@/lib/utils';
import { Receipt, CheckCircle, AlertCircle, Clock, Save, RefreshCw } from 'lucide-react';

interface PaymentModeState {
  id: string;
  name: string;
  commission_percent: number;
  amount: number;
}

interface CategoryState {
  id: string;
  name: string;
  amount: number;
}

interface FocusItemState {
  id: string;
  name: string;
  units_sold: number;
  revenue: number;
}

export default function SalesPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sales Form State
  const [isReported, setIsReported] = useState(false);
  const [grossSales, setGrossSales] = useState<number>(0);
  const [discounts, setDiscounts] = useState<number>(0);
  const [complimentary, setComplimentary] = useState<number>(0);
  const [taxAmount, setTaxAmount] = useState<number>(0);
  const [billCount, setBillCount] = useState<number>(0);
  const [customerCount, setCustomerCount] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Sub-breakdowns
  const [paymentModes, setPaymentModes] = useState<PaymentModeState[]>([]);
  const [categories, setCategories] = useState<CategoryState[]>([]);
  const [focusItems, setFocusItems] = useState<FocusItemState[]>([]);

  const netSales = Math.max(0, grossSales - discounts);
  const totalPaymentsEntered = paymentModes.reduce((acc, p) => acc + (p.amount || 0), 0);
  const totalCommissions = paymentModes.reduce((acc, p) => {
    const comm = ((p.amount || 0) * (p.commission_percent || 0)) / 100;
    return acc + comm;
  }, 0);

  const loadData = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const { data: pmData } = await supabase.from('payment_methods').select('*').order('name');
      const { data: catData } = await supabase.from('sales_categories').select('*').order('display_order');
      const { data: focusData } = await supabase.from('focus_items').select('*').order('display_order');

      const { data: report } = await supabase
        .from('sales_reports')
        .select('*')
        .eq('business_date', businessDate)
        .maybeSingle();

      if (report) {
        setIsReported(report.is_reported);
        setGrossSales(Number(report.gross_sales) || 0);
        setDiscounts(Number(report.discounts) || 0);
        setComplimentary(Number(report.complimentary) || 0);
        setTaxAmount(Number(report.tax_amount) || 0);
        setBillCount(Number(report.bill_count) || 0);
        setCustomerCount(Number(report.customer_count) || 0);
        setNotes(report.notes || '');
        setLastUpdated(report.updated_at);

        const { data: pms } = await supabase
          .from('payment_mode_summaries')
          .select('*')
          .eq('sales_report_id', report.id);

        setPaymentModes(
          (pmData || []).map((pm) => {
            const found = (pms || []).find((p) => p.payment_method_id === pm.id);
            return {
              id: pm.id,
              name: pm.name,
              commission_percent: Number(pm.commission_percent) || 0,
              amount: found ? Number(found.amount) : 0,
            };
          })
        );

        const { data: scs } = await supabase
          .from('sales_category_summaries')
          .select('*')
          .eq('sales_report_id', report.id);

        setCategories(
          (catData || []).map((cat) => {
            const found = (scs || []).find((c) => c.sales_category_id === cat.id);
            return {
              id: cat.id,
              name: cat.name,
              amount: found ? Number(found.amount) : 0,
            };
          })
        );
      } else {
        setIsReported(false);
        setGrossSales(0);
        setDiscounts(0);
        setComplimentary(0);
        setTaxAmount(0);
        setBillCount(0);
        setCustomerCount(0);
        setNotes('');
        setLastUpdated(null);

        setPaymentModes(
          (pmData || []).map((pm) => ({
            id: pm.id,
            name: pm.name,
            commission_percent: Number(pm.commission_percent) || 0,
            amount: 0,
          }))
        );

        setCategories(
          (catData || []).map((cat) => ({
            id: cat.id,
            name: cat.name,
            amount: 0,
          }))
        );
      }

      const { data: fis } = await supabase
        .from('focus_item_sales')
        .select('*')
        .eq('business_date', businessDate);

      setFocusItems(
        (focusData || []).map((fi) => {
          const found = (fis || []).find((f) => f.focus_item_id === fi.id);
          return {
            id: fi.id,
            name: fi.name,
            units_sold: found ? Number(found.units_sold) : 0,
            revenue: found ? Number(found.revenue) : 0,
          };
        })
      );
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to load sales data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const { data: report, error: reportErr } = await supabase
        .from('sales_reports')
        .upsert(
          {
            business_date: businessDate,
            is_reported: true,
            gross_sales: grossSales,
            discounts: discounts,
            complimentary: complimentary,
            tax_amount: taxAmount,
            net_sales: netSales,
            bill_count: billCount,
            customer_count: customerCount,
            notes: notes,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'business_date' }
        )
        .select()
        .single();

      if (reportErr) throw reportErr;

      const reportId = report.id;

      await supabase.from('payment_mode_summaries').delete().eq('sales_report_id', reportId);
      const pmsToInsert = paymentModes.map((pm) => {
        const comm = Number((((pm.amount || 0) * pm.commission_percent) / 100).toFixed(2));
        return {
          sales_report_id: reportId,
          payment_method_id: pm.id,
          amount: pm.amount || 0,
          commission_rate: pm.commission_percent,
          commission_amount: comm,
          net_received: (pm.amount || 0) - comm,
        };
      });
      await supabase.from('payment_mode_summaries').insert(pmsToInsert);

      await supabase.from('sales_category_summaries').delete().eq('sales_report_id', reportId);
      const catsToInsert = categories.map((cat) => ({
        sales_report_id: reportId,
        sales_category_id: cat.id,
        amount: cat.amount || 0,
      }));
      await supabase.from('sales_category_summaries').insert(catsToInsert);

      for (const item of focusItems) {
        await supabase.from('focus_item_sales').upsert(
          {
            business_date: businessDate,
            focus_item_id: item.id,
            units_sold: item.units_sold || 0,
            revenue: item.revenue || 0,
          },
          { onConflict: 'business_date,focus_item_id' }
        );
      }

      setIsReported(true);
      setLastUpdated(new Date().toISOString());
      setMessage({ type: 'success', text: 'Daily sales recorded successfully.' });
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Error saving sales record.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Receipt className="h-6 w-6 text-amber-600" />
            Petpooja Daily Sales Entry
          </h1>
          <p className="text-sm text-stone-500">
            Official midnight POS closing figures for financial reconciliation & profit intelligence.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5 shadow-2xs text-xs font-medium">
            <span className="text-stone-500">Date:</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white border border-stone-200/80 rounded-xl text-xs shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="text-stone-500 font-medium">Reporting Status:</span>
          {isReported ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle className="h-3 w-3" /> REPORTED
            </Badge>
          ) : (
            <Badge variant="danger" className="gap-1">
              <AlertCircle className="h-3 w-3" /> NOT REPORTED
            </Badge>
          )}
        </div>

        {lastUpdated && (
          <div className="flex items-center gap-1.5 text-stone-500">
            <Clock className="h-3.5 w-3.5 text-stone-400" />
            <span>Last Updated: <strong className="text-stone-700">{formatTimeAgo(lastUpdated)}</strong></span>
          </div>
        )}
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
          message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-stone-400 text-sm">Loading sales data...</div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardDescription>Net Sales (Petpooja)</CardDescription>
              <div className="text-2xl font-bold text-stone-900 mt-1">{formatINR(netSales)}</div>
              <div className="text-[11px] text-stone-500 mt-1">Gross − Discounts</div>
            </Card>

            <Card>
              <CardDescription>Customer Bills</CardDescription>
              <div className="text-2xl font-bold text-stone-900 mt-1">{billCount || 0}</div>
              <div className="text-[11px] text-stone-500 mt-1">
                {customerCount ? `${customerCount} Guests` : 'Total transactions'}
              </div>
            </Card>

            <Card>
              <CardDescription>Payment Commissions</CardDescription>
              <div className="text-2xl font-bold text-rose-600 mt-1">{formatINR(totalCommissions)}</div>
              <div className="text-[11px] text-stone-500 mt-1">Card & Gateway Charges</div>
            </Card>

            <Card>
              <CardDescription>Average Bill / Spend</CardDescription>
              <div className="text-2xl font-bold text-stone-900 mt-1">
                {formatINR(billCount > 0 ? netSales / billCount : 0)}
              </div>
              <div className="text-[11px] text-stone-500 mt-1">
                {customerCount > 0 ? `${formatINR(netSales / customerCount)} / guest` : 'Per bill'}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>1. Sales Summary</CardTitle>
                <CardDescription>Direct figures from Petpooja Day-End Report</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-600 font-medium mb-1">Gross Sales (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={grossSales || ''}
                      onChange={(e) => setGrossSales(parseFloat(e.target.value) || 0)}
                      className="w-full rounded-lg border border-stone-300 p-2.5 font-semibold text-stone-900 text-sm focus:border-amber-500 focus:outline-none"
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-stone-600 font-medium mb-1">Discounts (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={discounts || ''}
                      onChange={(e) => setDiscounts(parseFloat(e.target.value) || 0)}
                      className="w-full rounded-lg border border-stone-300 p-2.5 text-stone-900 text-sm focus:border-amber-500 focus:outline-none"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-600 font-medium mb-1">Complimentary / Void (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={complimentary || ''}
                      onChange={(e) => setComplimentary(parseFloat(e.target.value) || 0)}
                      className="w-full rounded-lg border border-stone-300 p-2.5 text-stone-900 text-sm focus:border-amber-500 focus:outline-none"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-600 font-medium mb-1">Taxes (GST Included) (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={taxAmount || ''}
                      onChange={(e) => setTaxAmount(parseFloat(e.target.value) || 0)}
                      className="w-full rounded-lg border border-stone-300 p-2.5 text-stone-900 text-sm focus:border-amber-500 focus:outline-none"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-600 font-medium mb-1">Total Bills (Count)</label>
                    <input
                      type="number"
                      value={billCount || ''}
                      onChange={(e) => setBillCount(parseInt(e.target.value) || 0)}
                      className="w-full rounded-lg border border-stone-300 p-2.5 text-stone-900 text-sm focus:border-amber-500 focus:outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-600 font-medium mb-1">Customer Count (Guests)</label>
                    <input
                      type="number"
                      value={customerCount || ''}
                      onChange={(e) => setCustomerCount(parseInt(e.target.value) || 0)}
                      className="w-full rounded-lg border border-stone-300 p-2.5 text-stone-900 text-sm focus:border-amber-500 focus:outline-none"
                      placeholder="0"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2. Payment Modes Reconciliation</CardTitle>
                <CardDescription>Collection breakdown & automatic commission derivation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {paymentModes.map((pm, idx) => (
                  <div key={pm.id} className="flex items-center justify-between gap-3 p-2 bg-stone-50 rounded-lg border border-stone-200/80">
                    <div className="flex-1">
                      <div className="font-medium text-stone-900">{pm.name}</div>
                      <div className="text-[11px] text-stone-500">Commission: {pm.commission_percent}%</div>
                    </div>
                    <div className="w-36">
                      <input
                        type="number"
                        step="0.01"
                        value={pm.amount || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const next = [...paymentModes];
                          next[idx].amount = val;
                          setPaymentModes(next);
                        }}
                        className="w-full rounded-md border border-stone-300 bg-white p-2 text-right font-medium text-stone-900 text-sm focus:border-amber-500 focus:outline-none"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                ))}

                <div className="pt-2 border-t border-stone-200 flex items-center justify-between text-xs font-semibold">
                  <span>Total Payments Reconciled:</span>
                  <span className={Math.abs(totalPaymentsEntered - netSales) > 1 ? 'text-amber-600' : 'text-emerald-700'}>
                    {formatINR(totalPaymentsEntered)} {Math.abs(totalPaymentsEntered - netSales) > 1 && `(Diff: ${formatINR(netSales - totalPaymentsEntered)})`}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>3. Sales Categories Split</CardTitle>
                <CardDescription>Departmental revenue contribution</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {categories.map((cat, idx) => (
                  <div key={cat.id} className="flex items-center justify-between gap-3 p-2 bg-stone-50 rounded-lg border border-stone-200/80">
                    <span className="font-medium text-stone-800">{cat.name}</span>
                    <div className="w-36">
                      <input
                        type="number"
                        step="0.01"
                        value={cat.amount || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const next = [...categories];
                          next[idx].amount = val;
                          setCategories(next);
                        }}
                        className="w-full rounded-md border border-stone-300 bg-white p-2 text-right font-medium text-stone-900 text-sm focus:border-amber-500 focus:outline-none"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>4. Key Menu Focus Items</CardTitle>
                <CardDescription>Top high-volume highway dishes tracking</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {focusItems.map((fi, idx) => (
                  <div key={fi.id} className="flex items-center justify-between gap-2 p-2 bg-stone-50 rounded-lg border border-stone-200/80">
                    <span className="font-medium text-stone-800 w-36 truncate">{fi.name}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={fi.units_sold || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          const next = [...focusItems];
                          next[idx].units_sold = val;
                          setFocusItems(next);
                        }}
                        className="w-18 rounded-md border border-stone-300 bg-white p-1.5 text-center text-xs text-stone-900 focus:border-amber-500 focus:outline-none"
                        placeholder="Qty"
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={fi.revenue || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const next = [...focusItems];
                          next[idx].revenue = val;
                          setFocusItems(next);
                        }}
                        className="w-24 rounded-md border border-stone-300 bg-white p-1.5 text-right text-xs font-medium text-stone-900 focus:border-amber-500 focus:outline-none"
                        placeholder="₹ Revenue"
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center justify-between bg-white border border-stone-200 p-4 rounded-xl shadow-2xs">
            <div className="text-xs text-stone-500">
              All saves create an auditable timestamp for business date {businessDate}.
            </div>
            <Button variant="amber" size="lg" type="submit" disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? 'Recording Sales...' : 'Save Petpooja Day-End Report'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
