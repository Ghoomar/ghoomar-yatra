'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { AssetDetailModal } from '@/components/inventory/AssetDetailModal';
import {
  Layers,
  Plus,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  MapPin,
  Filter,
  Search,
  ArrowRight,
} from 'lucide-react';

export default function PhysicalAssetsPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [assets, setAssets] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssetForModal, setSelectedAssetForModal] = useState<any | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
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

      // 2. Fetch Physical Assets with unit, category, and location-level stocks
      const { data: aData, error: aError } = await supabase
        .from('inventory_items')
        .select(`
          *,
          unit:units!inventory_items_unit_id_fkey(symbol, name),
          category:inventory_categories(name),
          location_stocks:item_location_stocks(
            id, quantity, location_id,
            location:inventory_locations(id, name, code, location_type)
          )
        `)
        .eq('inventory_class', 'Physical Asset')
        .order('name');

      if (aError) throw aError;

      // 3. Fetch Asset Status Ledger (Breakage, Loss, Repair)
      const { data: statusData } = await supabase
        .from('physical_asset_status_ledger')
        .select('*');

      // Process asset summaries
      const processedAssets = (aData || []).map((asset: any) => {
        const itemStatusEvents = (statusData || []).filter((s: any) => s.item_id === asset.id);
        const brokenTotal = itemStatusEvents
          .filter((s: any) => s.event_type === 'breakage')
          .reduce((sum: number, s: any) => sum + Number(s.quantity || 0), 0);
        const repairedTotal = itemStatusEvents
          .filter((s: any) => s.event_type === 'repair')
          .reduce((sum: number, s: any) => sum + Number(s.quantity || 0), 0);
        const lostTotal = itemStatusEvents
          .filter((s: any) => s.event_type === 'loss')
          .reduce((sum: number, s: any) => sum + Number(s.quantity || 0), 0);

        const netBroken = Math.max(0, brokenTotal - repairedTotal);
        const inService = (asset.location_stocks || []).reduce(
          (sum: number, ls: any) => sum + Number(ls.quantity || 0),
          0
        );

        return {
          ...asset,
          in_service_qty: inService,
          broken_qty: netBroken,
          lost_qty: lostTotal,
          total_owned_qty: inService + netBroken + lostTotal,
        };
      });

      setAssets(processedAssets);

      // If modal is open, refresh selected asset
      if (selectedAssetForModal) {
        const updated = processedAssets.find((a: any) => a.id === selectedAssetForModal.id);
        if (updated) setSelectedAssetForModal(updated);
      }
    } catch (err: any) {
      console.error('Error loading physical assets:', err);
      setMessage({ type: 'error', text: err.message || 'Failed to load physical asset register.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      // Location filter
      if (selectedLocationId !== 'ALL') {
        const locStock = asset.location_stocks?.find((ls: any) => ls.location_id === selectedLocationId);
        if (!locStock || Number(locStock.quantity) <= 0) {
          return false;
        }
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = asset.name?.toLowerCase() || '';
        const code = asset.item_code?.toLowerCase() || '';
        const cat = asset.category?.name?.toLowerCase() || '';
        if (!name.includes(q) && !code.includes(q) && !cat.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [assets, selectedLocationId, searchQuery]);

  const totalInServiceAll = assets.reduce((sum, a) => sum + a.in_service_qty, 0);
  const totalBrokenAll = assets.reduce((sum, a) => sum + a.broken_qty, 0);
  const totalLostAll = assets.reduce((sum, a) => sum + a.lost_qty, 0);
  const totalOwnedAll = assets.reduce((sum, a) => sum + a.total_owned_qty, 0);

  const handleRowClick = (asset: any) => {
    setSelectedAssetForModal(asset);
    setDetailModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Layers className="h-6 w-6 text-amber-600" />
            Physical Assets & Equipment Ledger
          </h1>
          <p className="text-sm text-stone-500">
            Cutlery, crockery, furniture, and equipment tracked by location, in-service status, breakage, and loss.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="gap-1.5"
          >
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

      {/* KPI Highlights */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4 bg-white border-stone-200 shadow-sm">
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Total Registered</div>
          <div className="text-xl font-bold text-stone-900 mt-1">{totalOwnedAll} <span className="text-xs font-normal text-stone-500">pcs</span></div>
          <div className="text-[10px] text-stone-400 mt-0.5">{assets.length} distinct asset SKUs</div>
        </Card>

        <Card className="p-4 bg-emerald-50/50 border-emerald-200 shadow-sm">
          <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">In-Service (Active)</div>
          <div className="text-xl font-bold text-emerald-900 mt-1">{totalInServiceAll} <span className="text-xs font-normal text-emerald-600">pcs</span></div>
          <div className="text-[10px] text-emerald-600 mt-0.5">Deployed across operational rooms</div>
        </Card>

        <Card className="p-4 bg-amber-50/50 border-amber-200 shadow-sm">
          <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Broken / Damage</div>
          <div className="text-xl font-bold text-amber-900 mt-1">{totalBrokenAll} <span className="text-xs font-normal text-amber-600">pcs</span></div>
          <div className="text-[10px] text-amber-600 mt-0.5">Out of service awaiting repair</div>
        </Card>

        <Card className="p-4 bg-red-50/50 border-red-200 shadow-sm">
          <div className="text-[11px] font-semibold text-red-700 uppercase tracking-wider">Missing / Lost</div>
          <div className="text-xl font-bold text-red-900 mt-1">{totalLostAll} <span className="text-xs font-normal text-red-600">pcs</span></div>
          <div className="text-[10px] text-red-600 mt-0.5">Reported missing in facility</div>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-3 rounded-xl border border-stone-200 text-xs">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <MapPin className="h-4 w-4 text-stone-400 shrink-0" />
          <span className="font-medium text-stone-700 whitespace-nowrap">Filter Location:</span>
          <select
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
            className="w-full sm:w-64 rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none bg-white font-medium"
          >
            <option value="ALL">All Operational Locations (Consolidated)</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search asset name or code..."
            className="w-full pl-8 pr-3 py-1.5 rounded-md border border-stone-300 text-stone-900 focus:outline-none"
          />
        </div>
      </div>

      {/* Assets Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Physical Asset Register</CardTitle>
              <CardDescription>
                Click any asset row to view location allocations, transfer between rooms, or log damage.
              </CardDescription>
            </div>
            <div className="text-xs text-stone-500">
              Showing {filteredAssets.length} of {assets.length} assets
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="py-16 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-amber-600" /> Loading asset register & room balances...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                    <th className="py-2.5 px-3">Asset Code</th>
                    <th className="py-2.5 px-3">Item Name</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Location Allocations</th>
                    <th className="py-2.5 px-3 text-right">In-Service</th>
                    <th className="py-2.5 px-3 text-right">Broken</th>
                    <th className="py-2.5 px-3 text-right">Lost</th>
                    <th className="py-2.5 px-3 text-right">Total Owned</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredAssets.map((asset) => {
                    const locStocks = (asset.location_stocks || []).filter((ls: any) => Number(ls.quantity) > 0);
                    const selectedLocStock =
                      selectedLocationId !== 'ALL'
                        ? locStocks.find((ls: any) => ls.location_id === selectedLocationId)?.quantity || 0
                        : null;

                    return (
                      <tr
                        key={asset.id}
                        onClick={() => handleRowClick(asset)}
                        className="hover:bg-amber-50/40 cursor-pointer transition-colors group"
                      >
                        <td className="py-3 px-3 font-mono text-amber-700 font-bold whitespace-nowrap">
                          {asset.item_code || 'AST'}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-stone-900 group-hover:text-amber-800">
                            {asset.name}
                          </div>
                          <div className="text-[11px] text-stone-400">
                            {formatINR(Number(asset.current_weighted_average_cost || 0))} / {asset.unit?.symbol || 'pcs'}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-stone-600">
                          <Badge variant="outline" className="text-[10px] py-0">
                            {asset.category?.name || 'Equipment'}
                          </Badge>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {locStocks.map((ls: any) => (
                              <span
                                key={ls.location_id}
                                className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                                  selectedLocationId === ls.location_id
                                    ? 'bg-amber-100 text-amber-900 border-amber-300 font-bold'
                                    : 'bg-stone-50 text-stone-700 border-stone-200'
                                }`}
                              >
                                {ls.location?.name}: {ls.quantity}
                              </span>
                            ))}
                            {locStocks.length === 0 && (
                              <span className="text-[10px] text-stone-400 italic">No room allocated</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-emerald-800">
                          {selectedLocStock !== null ? selectedLocStock : asset.in_service_qty}{' '}
                          <span className="text-[10px] text-stone-500 font-normal">{asset.unit?.symbol || 'pcs'}</span>
                        </td>
                        <td className="py-3 px-3 text-right font-semibold text-amber-800">
                          {asset.broken_qty > 0 ? (
                            <span className="text-amber-700">{asset.broken_qty}</span>
                          ) : (
                            <span className="text-stone-300">0</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-semibold text-red-800">
                          {asset.lost_qty > 0 ? (
                            <span className="text-red-700">{asset.lost_qty}</span>
                          ) : (
                            <span className="text-stone-300">0</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-stone-900">
                          {asset.total_owned_qty}{' '}
                          <span className="text-[10px] text-stone-500 font-normal">{asset.unit?.symbol || 'pcs'}</span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="text-stone-400 group-hover:text-amber-600 transition-colors inline-flex items-center gap-0.5 text-[11px] font-semibold">
                            Manage <ArrowRight className="h-3 w-3" />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAssets.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-stone-400">
                        No physical assets found matching the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Asset Detail & Action Modal */}
      <AssetDetailModal
        asset={selectedAssetForModal}
        locations={locations}
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        onRefresh={loadData}
        businessDate={businessDate}
      />
    </div>
  );
}
