'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { calculatePhysicalCountVariance } from '@/lib/inventory-engine';
import { logAuditAction } from '@/lib/audit-logger';
import {
  ClipboardCheck,
  Save,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  MapPin,
  Filter,
  Search,
  Scale,
} from 'lucide-react';

interface CountItemRow {
  item_id: string;
  name: string;
  item_code: string;
  inventory_class: string;
  category_name: string;
  unit_symbol: string;
  expected_qty: number;
  physical_qty: number;
  wac_cost: number;
  reason: string;
}

export default function StockCountPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [itemsMaster, setItemsMaster] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('ALL');
  const [selectedClass, setSelectedClass] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState<CountItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Locations
      const { data: locData } = await supabase
        .from('inventory_locations')
        .select('*')
        .eq('is_active', true)
        .order('name');
      setLocations(locData || []);

      // 2. Fetch inventory items with units, categories, position and location stocks
      const [{ data: posData }, { data: locStocksData }] = await Promise.all([
        supabase
          .from('inventory_current_position')
          .select('*')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('item_location_stocks')
          .select('item_id, location_id, quantity'),
      ]);

      const merged = (posData || []).map((p: any) => ({
        ...p,
        location_stocks: (locStocksData || []).filter((ls: any) => ls.item_id === p.item_id),
      }));

      setItemsMaster(merged);
    } catch (err: any) {
      console.error('Error loading inventory count data:', err);
      setMessage({ type: 'error', text: 'Failed to load inventory for verification.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Re-build count rows whenever selectedLocationId or itemsMaster changes
  useEffect(() => {
    if (itemsMaster.length === 0) return;

    const newRows: CountItemRow[] = itemsMaster.map((p) => {
      let expected = 0;
      if (selectedLocationId === 'ALL') {
        expected = Number(p.current_quantity) || 0;
      } else {
        const locStock = p.location_stocks?.find((ls: any) => ls.location_id === selectedLocationId);
        expected = Number(locStock?.quantity) || 0;
      }

      return {
        item_id: p.item_id,
        name: p.name,
        item_code: p.item_code,
        inventory_class: p.inventory_class || 'Food Raw Material',
        category_name: p.category_name || 'General',
        unit_symbol: p.unit_symbol || 'units',
        expected_qty: expected,
        physical_qty: expected, // defaults to expected
        wac_cost: Number(p.wac_cost) || 0,
        reason: '',
      };
    });

    setRows(newRows);
  }, [itemsMaster, selectedLocationId]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (selectedClass !== 'All' && r.inventory_class !== selectedClass) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = r.name.toLowerCase();
        const code = (r.item_code || '').toLowerCase();
        const cat = r.category_name.toLowerCase();
        if (!name.includes(q) && !code.includes(q) && !cat.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [rows, selectedClass, searchQuery]);

  const handlePhysicalQtyChange = (itemId: string, val: number) => {
    setRows((prev) =>
      prev.map((r) => (r.item_id === itemId ? { ...r, physical_qty: val } : r))
    );
  };

  const handleReasonChange = (itemId: string, val: string) => {
    setRows((prev) =>
      prev.map((r) => (r.item_id === itemId ? { ...r, reason: val } : r))
    );
  };

  // Metrics
  const variances = filteredRows
    .map((r) => calculatePhysicalCountVariance(r.expected_qty, r.physical_qty, r.wac_cost))
    .filter((v) => v.varianceQuantity !== 0);

  const totalVarianceCost = variances.reduce((sum, v) => sum + v.varianceValue, 0);
  const shortagesCount = variances.filter((v) => v.isShortage).length;
  const surplusCount = variances.filter((v) => v.isSurplus).length;

  const handleSaveCount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const locName =
        selectedLocationId === 'ALL'
          ? 'Consolidated (All Locations)'
          : locations.find((l) => l.id === selectedLocationId)?.name || 'Store';

      // 1. Create inventory count header
      const { data: header, error: hErr } = await supabase
        .from('inventory_counts')
        .insert({
          business_date: businessDate,
          count_type: `Physical Verification — ${locName}`,
          status: 'approved',
          notes: `Physical verification for ${locName} (${selectedClass} filter)`,
        })
        .select()
        .single();

      if (hErr) throw hErr;

      let adjustmentsCreated = 0;
      let totalVarianceVal = 0;

      // 2. Loop filtered rows and record variances
      for (const row of filteredRows) {
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
          reason: row.reason || (varianceQuantity !== 0 ? `Variance in ${locName}` : 'No variance'),
        });

        // If variance exists, log atomic count adjustment
        if (varianceQuantity !== 0) {
          adjustmentsCreated++;
          totalVarianceVal += varianceValue;

          // Determine location target
          const targetLocId = selectedLocationId !== 'ALL' ? selectedLocationId : 'a89335e9-01b4-4edd-bee5-a894053d798d';

          const { error: rpcErr } = await supabase.rpc('execute_inventory_transaction', {
            p_item_id: row.item_id,
            p_business_date: businessDate,
            p_movement_type: 'count_adjustment',
            p_quantity: varianceQuantity,
            p_unit_cost: row.wac_cost,
            p_destination_location_id: targetLocId,
            p_purpose: 'Monthly Physical Verification',
            p_reference_id: header.id,
            p_reference_type: 'inventory_counts',
            p_notes: row.reason || `Count variance of ${varianceQuantity > 0 ? '+' : ''}${varianceQuantity} ${row.unit_symbol} at ${locName}`,
          });

          if (rpcErr) throw rpcErr;
        }
      }

      await logAuditAction({
        action: 'CREATE',
        entity: 'Physical Count Verification',
        entityId: header.id,
        details: {
          business_date: businessDate,
          location: locName,
          adjustments_count: adjustmentsCreated,
          total_variance_value: totalVarianceVal,
        },
      });

      setMessage({
        type: 'success',
        text: `Physical count verification saved for ${locName}. ${adjustmentsCreated} variance adjustments reconciled.`,
      });
      loadData();
    } catch (err: any) {
      console.error('Error saving physical count:', err);
      setMessage({ type: 'error', text: err.message || 'Failed to save physical verification.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-amber-600" />
            Physical Stock Verification & Count Reconciliation
          </h1>
          <p className="text-sm text-stone-500">
            Reconcile physical stock in Store, Fridges, and Halls against the inventory ledger.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            className="px-3 py-1.5 border border-stone-300 rounded-lg text-xs font-mono bg-white text-stone-900"
          />
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-amber-600' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          )}
          {message.text}
        </div>
      )}

      {/* Variance Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4 bg-white border-stone-200 shadow-sm">
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Items in Verification</div>
          <div className="text-xl font-bold text-stone-900 mt-1">{filteredRows.length}</div>
          <div className="text-[10px] text-stone-400 mt-0.5">Under selected filters</div>
        </Card>

        <Card className="p-4 bg-white border-stone-200 shadow-sm">
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Variances Detected</div>
          <div className="text-xl font-bold text-amber-700 mt-1">{variances.length}</div>
          <div className="text-[10px] text-stone-400 mt-0.5">
            {shortagesCount} Shortages • {surplusCount} Excesses
          </div>
        </Card>

        <Card className="p-4 bg-amber-50/50 border-amber-200 shadow-sm">
          <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Net Variance Value</div>
          <div className={`text-xl font-bold mt-1 ${totalVarianceCost < 0 ? 'text-red-700' : totalVarianceCost > 0 ? 'text-emerald-700' : 'text-stone-900'}`}>
            {formatINR(totalVarianceCost)}
          </div>
          <div className="text-[10px] text-amber-600 mt-0.5">At weighted average cost</div>
        </Card>

        <Card className="p-4 bg-stone-50 border-stone-200 shadow-sm">
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Count Target</div>
          <div className="text-base font-bold text-stone-800 mt-1 truncate">
            {selectedLocationId === 'ALL'
              ? 'Consolidated'
              : locations.find((l) => l.id === selectedLocationId)?.name || 'Store'}
          </div>
          <div className="text-[10px] text-stone-500 mt-0.5">Class: {selectedClass}</div>
        </Card>
      </div>

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-3 rounded-xl border border-stone-200 text-xs items-center">
        {/* Location Filter */}
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-stone-400 shrink-0" />
          <span className="font-semibold text-stone-700 whitespace-nowrap">Location:</span>
          <select
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
            className="w-full rounded-md border border-stone-300 p-1.5 text-stone-900 bg-white font-medium focus:outline-none"
          >
            <option value="ALL">All Operational Locations (Consolidated)</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name} ({loc.location_type})
              </option>
            ))}
          </select>
        </div>

        {/* Class Filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-stone-400 shrink-0" />
          <span className="font-semibold text-stone-700 whitespace-nowrap">Class:</span>
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="w-full rounded-md border border-stone-300 p-1.5 text-stone-900 bg-white focus:outline-none"
          >
            <option value="All">All Inventory Classes</option>
            <option value="Food Raw Material">Food Raw Material</option>
            <option value="Physical Asset">Physical Asset</option>
            <option value="Uniform">Uniform</option>
            <option value="Non-Food Consumable">Non-Food Consumable</option>
          </select>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search SKU or item name..."
            className="w-full pl-8 pr-3 py-1.5 rounded-md border border-stone-300 text-stone-900 focus:outline-none"
          />
        </div>
      </div>

      {/* Verification Form Table */}
      <form onSubmit={handleSaveCount}>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Physical Verification Audit Sheet</CardTitle>
                <CardDescription>
                  Enter physically verified stock. Discrepancies between expected and physical counts are highlighted and reconciled.
                </CardDescription>
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={saving || loading || filteredRows.length === 0}
                className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
              >
                <Save className="h-4 w-4" /> {saving ? 'Reconciling...' : 'Save & Reconcile Verification'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-16 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-5 w-5 animate-spin text-amber-600" /> Loading stock balances...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Item SKU</th>
                      <th className="py-2.5 px-3">Item Name</th>
                      <th className="py-2.5 px-3">Class</th>
                      <th className="py-2.5 px-3 text-right">Expected Stock</th>
                      <th className="py-2.5 px-3 text-right">Physical Count</th>
                      <th className="py-2.5 px-3 text-right">Variance</th>
                      <th className="py-2.5 px-3 text-right">Variance Value</th>
                      <th className="py-2.5 px-3">Reason / Audit Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredRows.map((row) => {
                      const { varianceQuantity, varianceValue, isShortage, isSurplus } =
                        calculatePhysicalCountVariance(row.expected_qty, row.physical_qty, row.wac_cost);

                      return (
                        <tr
                          key={row.item_id}
                          className={`hover:bg-stone-50/80 transition-colors ${
                            varianceQuantity !== 0 ? 'bg-amber-50/20' : ''
                          }`}
                        >
                          <td className="py-2.5 px-3 font-mono text-amber-800 font-bold whitespace-nowrap">
                            {row.item_code || 'SKU'}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-stone-900">
                            {row.name}
                          </td>
                          <td className="py-2.5 px-3 text-stone-500">
                            <Badge variant="outline" className="text-[10px] py-0">
                              {row.inventory_class}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-stone-600">
                            {row.expected_qty} <span className="text-[10px] text-stone-400 font-normal">{row.unit_symbol}</span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <input
                              type="number"
                              step="any"
                              value={row.physical_qty}
                              onChange={(e) =>
                                handlePhysicalQtyChange(row.item_id, parseFloat(e.target.value) || 0)
                              }
                              required
                              className="w-24 px-2 py-1 border border-stone-300 rounded font-mono font-bold text-right text-stone-900 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            {varianceQuantity === 0 ? (
                              <span className="text-emerald-600">0.000</span>
                            ) : isShortage ? (
                              <span className="text-red-600 flex items-center justify-end gap-0.5">
                                <AlertTriangle className="h-3 w-3" /> {varianceQuantity.toFixed(3)}
                              </span>
                            ) : (
                              <span className="text-emerald-700">+{varianceQuantity.toFixed(3)}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-stone-700 font-semibold">
                            {formatINR(varianceValue)}
                          </td>
                          <td className="py-2.5 px-3">
                            <input
                              type="text"
                              value={row.reason}
                              onChange={(e) => handleReasonChange(row.item_id, e.target.value)}
                              placeholder={
                                varianceQuantity !== 0
                                  ? 'Reason required for variance...'
                                  : 'Optional notes'
                              }
                              className={`w-full px-2 py-1 border rounded text-xs text-stone-900 bg-white focus:outline-none ${
                                varianceQuantity !== 0 && !row.reason
                                  ? 'border-amber-300 bg-amber-50/30'
                                  : 'border-stone-300'
                              }`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-stone-400">
                          No items match the selected verification filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
