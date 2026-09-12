'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate, formatNumber } from '@/lib/utils';
import { BarChart3, Download, RefreshCw, FileSpreadsheet, Layers, ArrowRightLeft, TrendingUp } from 'lucide-react';
import { DailySalesLineGraph } from '@/components/reports/DailySalesLineGraph';

export default function ReportsPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [activeTab, setActiveTab] = useState<'daily' | 'inventory' | 'vendors'>('daily');

  const [dailyData, setDailyData] = useState<any>(null);
  const [inventoryMovements, setInventoryMovements] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: dFin } = await supabase
        .from('daily_financial_summary')
        .select('*')
        .eq('business_date', businessDate)
        .maybeSingle();

      const { data: vSum } = await supabase
        .from('vendor_outstanding_summary')
        .select('*')
        .order('vendor_name');

      const { data: movs } = await supabase
        .from('stock_movements')
        .select(`
          id, created_at, movement_type, purpose, quantity, unit_cost, total_value,
          item:inventory_items(name, item_code, unit:units!inventory_items_unit_id_fkey(symbol)),
          department:departments(name),
          responsible_person:employees(name)
        `)
        .eq('business_date', businessDate)
        .order('created_at', { ascending: false });

      setDailyData(dFin || null);
      setVendors(vSum || []);
      setInventoryMovements(movs || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessDate]);

  const exportCSV = (data: any[], filename: string) => {
    if (!data || data.length === 0) {
      alert('No data available to export.');
      return;
    }
    const keys = Object.keys(data[0]);
    const csvContent = [
      keys.join(','),
      ...data.map((row) => keys.map((k) => JSON.stringify(row[k] ?? '')).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}-${businessDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-amber-600" />
            Management Reports &amp; Intelligence
          </h1>
          <p className="text-sm text-stone-500">
            Comprehensive operational reports replacing manual Google Sheets with single-source-of-truth exportable ledgers.
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

      {/* Tabs */}
      <div className="flex border-b border-stone-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('daily')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'daily'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Daily Operations Summary
        </button>
        <button
          onClick={() => setActiveTab('inventory')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'inventory'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Store Consumption Ledger
        </button>
        <button
          onClick={() => setActiveTab('vendors')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'vendors'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Vendor Outstanding Ledger
        </button>
      </div>

      {/* TAB 1: DAILY OPS */}
      {activeTab === 'daily' && (
        <div className="space-y-6">
          {/* Section A: Daily Sales Trend Line Graph with Month & Custom Range Filtering */}
          <DailySalesLineGraph
            selectedDate={businessDate}
            onSelectDate={(date) => setBusinessDate(date)}
          />

          {/* Section B: Daily Operations Flash Report */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Daily Operations Flash Report</CardTitle>
                <CardDescription>Snapshot of financial closing for {businessDate}</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportCSV([dailyData || {}], 'daily-operations-report')}
                className="gap-1.5 text-xs"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </CardHeader>
            <CardContent className="pt-0 text-xs sm:text-sm space-y-3">
              {loading ? (
                <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading daily summary...
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/60">
                    <div className="text-[11px] text-stone-500 font-medium">Net Sales</div>
                    <div className="text-lg font-bold text-stone-900 mt-0.5">
                      {formatINR(Number(dailyData?.revenue || 0))}
                    </div>
                  </div>

                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/60">
                    <div className="text-[11px] text-stone-500 font-medium">Material Consumed</div>
                    <div className="text-lg font-bold text-rose-600 mt-0.5">
                      {formatINR(Number(dailyData?.total_material_consumption || 0))}
                    </div>
                  </div>

                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/60">
                    <div className="text-[11px] text-stone-500 font-medium">Variable Expenses</div>
                    <div className="text-lg font-bold text-rose-600 mt-0.5">
                      {formatINR(Number(dailyData?.variable_expenses || 0))}
                    </div>
                  </div>

                  <div className="p-3 bg-stone-50 rounded-lg border border-stone-200/60">
                    <div className="text-[11px] text-stone-500 font-medium">Operating Surplus</div>
                    <div className="text-lg font-bold text-emerald-700 mt-0.5">
                      {formatINR(Number(dailyData?.gross_operating_surplus || 0))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: INVENTORY CONSUMPTION */}
      {activeTab === 'inventory' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Kitchen Store Issue Movements ({businessDate})</CardTitle>
              <CardDescription>Line-by-line consumption attributed to kitchen &amp; chef</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCSV(inventoryMovements, 'store-consumption')}
              className="gap-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading store consumption...
              </div>
            ) : inventoryMovements.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">No inventory movements logged for {businessDate}.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Item SKU</th>
                      <th className="py-2.5 px-3">Kitchen / Section</th>
                      <th className="py-2.5 px-3">Chef</th>
                      <th className="py-2.5 px-3">Purpose</th>
                      <th className="py-2.5 px-3 text-right">Quantity</th>
                      <th className="py-2.5 px-3 text-right">WAC Rate</th>
                      <th className="py-2.5 px-3 text-right">Valuation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {inventoryMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-stone-50/80">
                        <td className="py-2 px-3 text-stone-500 font-mono">
                          {new Date(m.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </td>
                        <td className="py-2 px-3 font-semibold text-stone-900">{m.item?.name}</td>
                        <td className="py-2 px-3 text-stone-600">{m.department?.name || 'Central Store'}</td>
                        <td className="py-2 px-3 text-stone-600">{m.chef?.name || '—'}</td>
                        <td className="py-2 px-3">
                          <Badge variant={m.purpose === 'Customer Food' ? 'success' : m.purpose === 'Staff Food' ? 'info' : 'warning'}>
                            {m.purpose}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-stone-900">
                          {m.quantity} {m.item?.unit?.symbol}
                        </td>
                        <td className="py-2 px-3 text-right text-stone-700">{formatINR(Number(m.unit_cost || 0))}</td>
                        <td className="py-2 px-3 text-right font-bold text-stone-900">{formatINR(Number(m.total_value || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 3: VENDORS */}
      {activeTab === 'vendors' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Vendor Accounts Summary</CardTitle>
              <CardDescription>Authoritative balances derived from invoices and payment allocations</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCSV(vendors, 'vendor-ledger')}
              className="gap-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading vendor accounts...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Supplier</th>
                      <th className="py-2.5 px-3">Contact</th>
                      <th className="py-2.5 px-3 text-right">Total Invoiced</th>
                      <th className="py-2.5 px-3 text-right">Total Settled</th>
                      <th className="py-2.5 px-3 text-right">Net Due</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {vendors.map((v) => {
                      const out = Number(v.outstanding_balance) || 0;
                      return (
                        <tr key={v.vendor_id} className="hover:bg-stone-50/80">
                          <td className="py-3 px-3 font-semibold text-stone-900">{v.vendor_name}</td>
                          <td className="py-3 px-3 text-stone-600">
                            {v.contact_person} {v.phone && `(${v.phone})`}
                          </td>
                          <td className="py-3 px-3 text-right font-medium text-stone-800">{formatINR(Number(v.total_purchased || 0))}</td>
                          <td className="py-3 px-3 text-right font-medium text-emerald-700">{formatINR(Number(v.total_paid || 0))}</td>
                          <td className="py-3 px-3 text-right font-bold text-rose-600">{formatINR(out)}</td>
                          <td className="py-3 px-3 text-center">
                            {out <= 0 ? <Badge variant="success">Settled</Badge> : <Badge variant="danger">Due</Badge>}
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
      )}
    </div>
  );
}

