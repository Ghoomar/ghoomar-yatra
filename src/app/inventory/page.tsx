'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, formatNumber } from '@/lib/utils';
import { Package, ArrowRightLeft, RefreshCw, AlertTriangle, Layers, ClipboardList, ShieldAlert } from 'lucide-react';

export default function InventoryPage() {
  const supabase = createClient();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterClass, setFilterClass] = useState('ALL');
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('inventory_current_position')
        .select('*')
        .order('name');

      if (error) throw error;
      setItems(data || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredItems = items.filter((item) => {
    const matchesClass = filterClass === 'ALL' || item.inventory_class === filterClass;
    const matchesSearch =
      !search ||
      item.name?.toLowerCase().includes(search.toLowerCase()) ||
      item.item_code?.toLowerCase().includes(search.toLowerCase());
    return matchesClass && matchesSearch;
  });

  const totalStockValue = items.reduce((acc, i) => acc + (Number(i.current_stock_value) || 0), 0);
  const lowStockCount = items.filter(
    (i) => Number(i.current_quantity) <= Number(i.minimum_stock) && Number(i.minimum_stock) > 0
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Package className="h-6 w-6 text-amber-600" />
            Inventory Stock & Consumables
          </h1>
          <p className="text-sm text-stone-500">
            300+ SKU central store catalog with authoritative movement-derived balances and real-time WAC valuation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/inventory/issues">
            <Button variant="primary" size="sm" className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white">
              <ArrowRightLeft className="h-4 w-4" /> Issue Material to Kitchen
            </Button>
          </Link>
          <Link href="/inventory/count">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ClipboardList className="h-4 w-4" /> Stock Audit
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Total Central Store Valuation</CardDescription>
            <div className="text-2xl font-bold text-stone-900 mt-1">{formatINR(totalStockValue)}</div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            Weighted Average Cost (WAC) × Derived Ledger Quantity
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Low Stock Alerts</CardDescription>
            <div className={`text-2xl font-bold mt-1 ${lowStockCount > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
              {lowStockCount} Items Below Minimum
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            Requires replenishment purchase orders
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Inventory Architecture</CardDescription>
            <div className="text-base font-semibold text-stone-800 mt-1">Authoritative Movement Ledger</div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            Opening + Purchases − Issues = Current Stock
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 border border-stone-200 rounded-xl text-xs shadow-xs">
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {['ALL', 'Food Raw Material', 'Non-Food Consumable', 'Physical Asset', 'Uniform'].map((cls) => (
            <button
              key={cls}
              onClick={() => setFilterClass(cls)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer shrink-0 ${
                filterClass === cls
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              {cls}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search SKU name or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64 rounded-lg border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500"
        />
      </div>

      {/* Stock Catalog Table */}
      <Card>
        <CardHeader>
          <CardTitle>Catalog Items ({filteredItems.length})</CardTitle>
          <CardDescription>Authoritative derived quantities and current weighted average cost</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading central inventory...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-stone-400 text-xs">No inventory items found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                    <th className="py-2.5 px-3">SKU Code</th>
                    <th className="py-2.5 px-3">Item Name</th>
                    <th className="py-2.5 px-3">Category / Class</th>
                    <th className="py-2.5 px-3 text-right">Current Quantity</th>
                    <th className="py-2.5 px-3 text-right">Min Stock</th>
                    <th className="py-2.5 px-3 text-right">WAC Rate (₹)</th>
                    <th className="py-2.5 px-3 text-right">Total Value</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredItems.map((i) => {
                    const isLow = Number(i.current_quantity) <= Number(i.minimum_stock) && Number(i.minimum_stock) > 0;
                    return (
                      <tr key={i.item_id} className="hover:bg-stone-50/80 transition-colors">
                        <td className="py-3 px-3 font-mono text-stone-500">{i.item_code}</td>
                        <td className="py-3 px-3 font-semibold text-stone-900">{i.name}</td>
                        <td className="py-3 px-3 text-stone-600">
                          {i.category_name || 'General'} <span className="text-stone-400">({i.inventory_class})</span>
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-sm text-stone-900">
                          {Number(i.current_quantity || 0).toFixed(2)} {i.unit_symbol || 'units'}
                        </td>
                        <td className="py-3 px-3 text-right text-stone-500 font-mono">
                          {Number(i.minimum_stock || 0).toFixed(1)}
                        </td>
                        <td className="py-3 px-3 text-right text-stone-800 font-medium">
                          {formatINR(Number(i.wac_cost || 0))}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-stone-900">
                          {formatINR(Number(i.current_stock_value || 0))}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {isLow ? (
                            <Badge variant="danger" className="gap-1">
                              <AlertTriangle className="h-3 w-3" /> Low Stock
                            </Badge>
                          ) : (
                            <Badge variant="success">Sufficient</Badge>
                          )}
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
  );
}

