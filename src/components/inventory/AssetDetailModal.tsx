'use client';

import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import {
  Layers,
  ArrowRightLeft,
  AlertTriangle,
  Wrench,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Clock,
  MapPin,
  History,
  X,
} from 'lucide-react';

interface AssetDetailModalProps {
  asset: any | null;
  locations: any[];
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
  businessDate: string;
}

export function AssetDetailModal({
  asset,
  locations,
  isOpen,
  onClose,
  onRefresh,
  businessDate,
}: AssetDetailModalProps) {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'transfer' | 'breakage' | 'history'>('overview');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Transfer State
  const [transferFromLoc, setTransferFromLoc] = useState('');
  const [transferToLoc, setTransferToLoc] = useState('');
  const [transferQty, setTransferQty] = useState<number>(1);
  const [transferNotes, setTransferNotes] = useState('');

  // Breakage / Loss State
  const [actionType, setActionType] = useState<'breakage' | 'loss' | 'repair'>('breakage');
  const [actionLoc, setActionLoc] = useState('');
  const [actionQty, setActionQty] = useState<number>(1);
  const [actionNotes, setActionNotes] = useState('');

  // History State
  const [historyMovements, setHistoryMovements] = useState<any[]>([]);
  const [historyStatus, setHistoryStatus] = useState<any[]>([]);

  useEffect(() => {
    if (asset && isOpen) {
      loadAssetHistory();
      setMessage(null);
      setActiveTab('overview');
    }
  }, [asset, isOpen]);

  const loadAssetHistory = async () => {
    if (!asset) return;
    setLoading(true);
    try {
      const [{ data: mData }, { data: sData }] = await Promise.all([
        supabase
          .from('stock_movements')
          .select('*, src:inventory_locations!stock_movements_source_location_id_fkey(name), dest:inventory_locations!stock_movements_destination_location_id_fkey(name)')
          .eq('item_id', asset.id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('physical_asset_status_ledger')
          .select('*, loc:inventory_locations(name)')
          .eq('item_id', asset.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      setHistoryMovements(mData || []);
      setHistoryStatus(sData || []);
    } catch (err: any) {
      console.error('Error loading asset history:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !asset) return null;

  // Compute location stocks for this asset
  const locationAllocations = (asset.location_stocks || []).filter((ls: any) => Number(ls.quantity) > 0);
  const totalInService = locationAllocations.reduce((sum: number, ls: any) => sum + Number(ls.quantity || 0), 0);
  const brokenQty = Number(asset.broken_qty || 0);
  const lostQty = Number(asset.lost_qty || 0);
  const totalOwned = totalInService + brokenQty + lostQty;

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferFromLoc || !transferToLoc || transferQty <= 0) return;
    if (transferFromLoc === transferToLoc) {
      setMessage({ type: 'error', text: 'Source and destination locations cannot be identical.' });
      return;
    }

    const srcStock = asset.location_stocks?.find((ls: any) => ls.location_id === transferFromLoc)?.quantity || 0;
    if (Number(srcStock) < transferQty) {
      setMessage({ type: 'error', text: `Insufficient stock in source location! Only ${srcStock} available.` });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const wac = Number(asset.current_weighted_average_cost || 0);
      const { error } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: asset.id,
        p_business_date: businessDate,
        p_movement_type: 'transfer',
        p_quantity: transferQty,
        p_unit_cost: wac,
        p_source_location_id: transferFromLoc,
        p_destination_location_id: transferToLoc,
        p_purpose: 'Inter-Location Asset Transfer',
        p_notes: transferNotes || `Transferred from ${locations.find((l) => l.id === transferFromLoc)?.name} to ${locations.find((l) => l.id === transferToLoc)?.name}`,
      });

      if (error) throw error;

      setMessage({ type: 'success', text: `Successfully transferred ${transferQty} pcs.` });
      setTransferQty(1);
      setTransferNotes('');
      onRefresh();
      loadAssetHistory();
      setActiveTab('overview');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error executing transfer.' });
    } finally {
      setSaving(false);
    }
  };

  const handleExecuteStatusAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actionQty <= 0) return;

    if (actionType !== 'repair' && !actionLoc) {
      setMessage({ type: 'error', text: 'Please select the location of the affected asset.' });
      return;
    }

    if (actionType === 'repair' && !actionLoc) {
      setMessage({ type: 'error', text: 'Please select destination location where repaired asset is being placed.' });
      return;
    }

    if (actionType !== 'repair') {
      const srcStock = asset.location_stocks?.find((ls: any) => ls.location_id === actionLoc)?.quantity || 0;
      if (Number(srcStock) < actionQty) {
        setMessage({ type: 'error', text: `Insufficient stock in selected location! Only ${srcStock} available.` });
        return;
      }
    } else {
      if (brokenQty < actionQty) {
        setMessage({ type: 'error', text: `Cannot repair ${actionQty} pcs! Only ${brokenQty} pcs currently marked broken.` });
        return;
      }
    }

    setSaving(true);
    setMessage(null);

    try {
      const wac = Number(asset.current_weighted_average_cost || 0);

      if (actionType === 'repair') {
        // Return repaired asset to in-service destination location
        const { error } = await supabase.rpc('execute_inventory_transaction', {
          p_item_id: asset.id,
          p_business_date: businessDate,
          p_movement_type: 'return',
          p_quantity: actionQty,
          p_unit_cost: wac,
          p_destination_location_id: actionLoc,
          p_purpose: 'Asset Restored to Service',
          p_notes: actionNotes || 'Repaired and restored back to active service',
        });
        if (error) throw error;

        await supabase.from('physical_asset_status_ledger').insert({
          item_id: asset.id,
          business_date: businessDate,
          event_type: 'repair',
          quantity: actionQty,
          location_id: actionLoc,
          notes: actionNotes || 'Repaired and placed in service',
        });
      } else {
        // Breakage or Loss: deduct from location and record in status ledger
        const movType = actionType === 'breakage' ? 'breakage' : 'loss';
        const { error } = await supabase.rpc('execute_inventory_transaction', {
          p_item_id: asset.id,
          p_business_date: businessDate,
          p_movement_type: movType,
          p_quantity: actionQty,
          p_unit_cost: wac,
          p_source_location_id: actionLoc,
          p_purpose: actionType === 'breakage' ? 'Asset Breakage' : 'Asset Missing / Lost',
          p_notes: actionNotes || `Logged ${actionType} at ${locations.find((l) => l.id === actionLoc)?.name}`,
        });
        if (error) throw error;

        await supabase.from('physical_asset_status_ledger').insert({
          item_id: asset.id,
          business_date: businessDate,
          event_type: actionType,
          quantity: actionQty,
          location_id: actionLoc,
          notes: actionNotes || `Logged ${actionType}`,
        });
      }

      setMessage({
        type: 'success',
        text: `Successfully recorded ${actionType} (${actionQty} pcs).`,
      });
      setActionQty(1);
      setActionNotes('');
      onRefresh();
      loadAssetHistory();
      setActiveTab('overview');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error recording asset status.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-2xl text-xs max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between border-b pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                {asset.item_code || 'AST'}
              </span>
              <h2 className="text-lg font-bold text-stone-900">{asset.name}</h2>
              <Badge variant="outline">{asset.category?.name || 'Equipment'}</Badge>
            </div>
            <p className="text-stone-500 mt-1">
              Rate: {formatINR(Number(asset.current_weighted_average_cost || 0))} / {asset.unit?.symbol || 'pcs'} •
              Unit: {asset.unit?.symbol || 'pcs'}
            </p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            className={`p-3 rounded-lg font-medium flex items-center gap-2 ${
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

        {/* KPI Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="p-3 bg-stone-50 rounded-lg border border-stone-200">
            <div className="text-[10px] text-stone-500 uppercase tracking-wider font-semibold">Total Owned</div>
            <div className="text-base font-bold text-stone-900 mt-0.5">
              {totalOwned} <span className="text-[10px] text-stone-500 font-normal">{asset.unit?.symbol || 'pcs'}</span>
            </div>
          </div>
          <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-200">
            <div className="text-[10px] text-emerald-700 uppercase tracking-wider font-semibold">In-Service (Active)</div>
            <div className="text-base font-bold text-emerald-900 mt-0.5">
              {totalInService} <span className="text-[10px] text-emerald-600 font-normal">{asset.unit?.symbol || 'pcs'}</span>
            </div>
          </div>
          <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-200">
            <div className="text-[10px] text-amber-700 uppercase tracking-wider font-semibold">Broken / Repairs</div>
            <div className="text-base font-bold text-amber-900 mt-0.5">
              {brokenQty} <span className="text-[10px] text-amber-600 font-normal">{asset.unit?.symbol || 'pcs'}</span>
            </div>
          </div>
          <div className="p-3 bg-red-50/50 rounded-lg border border-red-200">
            <div className="text-[10px] text-red-700 uppercase tracking-wider font-semibold">Missing / Lost</div>
            <div className="text-base font-bold text-red-900 mt-0.5">
              {lostQty} <span className="text-[10px] text-red-600 font-normal">{asset.unit?.symbol || 'pcs'}</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-stone-200 gap-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'overview'
                ? 'border-b-2 border-amber-600 text-amber-700'
                : 'text-stone-500 hover:text-stone-800'
            }`}
          >
            <MapPin className="h-3.5 w-3.5" /> Location Allocation
          </button>
          <button
            onClick={() => setActiveTab('transfer')}
            className={`pb-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'transfer'
                ? 'border-b-2 border-amber-600 text-amber-700'
                : 'text-stone-500 hover:text-stone-800'
            }`}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" /> Inter-Location Transfer
          </button>
          <button
            onClick={() => setActiveTab('breakage')}
            className={`pb-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'breakage'
                ? 'border-b-2 border-amber-600 text-amber-700'
                : 'text-stone-500 hover:text-stone-800'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" /> Log Damage / Restoration
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`pb-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'border-b-2 border-amber-600 text-amber-700'
                : 'text-stone-500 hover:text-stone-800'
            }`}
          >
            <History className="h-3.5 w-3.5" /> Movement Ledger
          </button>
        </div>

        {/* Tab 1: Location Allocation */}
        {activeTab === 'overview' && (
          <div className="space-y-3">
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 font-semibold">
                    <th className="py-2.5 px-3">Location</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-right">In-Service Quantity</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {locationAllocations.map((la: any) => (
                    <tr key={la.location_id} className="hover:bg-stone-50/50">
                      <td className="py-2.5 px-3 font-medium text-stone-900 flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-stone-400" />
                        {la.location?.name || 'Unknown Location'}
                      </td>
                      <td className="py-2.5 px-3 text-stone-500 capitalize">
                        {la.location?.location_type?.replace('_', ' ') || 'Zone'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-stone-900">
                        {la.quantity} {asset.unit?.symbol || 'pcs'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => {
                            setTransferFromLoc(la.location_id);
                            setActiveTab('transfer');
                          }}
                          className="text-amber-700 hover:text-amber-900 font-semibold underline text-[11px]"
                        >
                          Transfer Out
                        </button>
                      </td>
                    </tr>
                  ))}
                  {locationAllocations.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-stone-400">
                        No in-service stock allocated to any room yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveTab('transfer')}
                className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer Between Locations
              </Button>
            </div>
          </div>
        )}

        {/* Tab 2: Inter-Location Transfer */}
        {activeTab === 'transfer' && (
          <form onSubmit={handleExecuteTransfer} className="space-y-3 bg-stone-50/50 p-4 rounded-lg border border-stone-200">
            <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
              <ArrowRightLeft className="h-4 w-4 text-amber-600" /> Move Asset Between Locations
            </h3>
            <p className="text-[11px] text-stone-500">
              Moving assets between rooms does not change total business inventory. It updates room allocations with full ledger tracking.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block font-medium text-stone-700 mb-1">From Location <span className="text-red-500">*</span></label>
                <select
                  value={transferFromLoc}
                  onChange={(e) => setTransferFromLoc(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none bg-white"
                >
                  <option value="">Select Source Location...</option>
                  {locations.map((loc) => {
                    const avail = asset.location_stocks?.find((ls: any) => ls.location_id === loc.id)?.quantity || 0;
                    return (
                      <option key={loc.id} value={loc.id} disabled={Number(avail) <= 0}>
                        {loc.name} ({avail} {asset.unit?.symbol || 'pcs'} available)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">To Location <span className="text-red-500">*</span></label>
                <select
                  value={transferToLoc}
                  onChange={(e) => setTransferToLoc(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none bg-white"
                >
                  <option value="">Select Destination Location...</option>
                  {locations
                    .filter((l) => l.id !== transferFromLoc)
                    .map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Quantity ({asset.unit?.symbol || 'pcs'}) <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min="1"
                  max={asset.location_stocks?.find((ls: any) => ls.location_id === transferFromLoc)?.quantity || 9999}
                  value={transferQty || ''}
                  onChange={(e) => setTransferQty(parseInt(e.target.value) || 0)}
                  placeholder="1"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 font-bold text-stone-900 focus:outline-none bg-white"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Transfer Notes / Reason</label>
                <input
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="e.g. Reallocated for special event setup"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none bg-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
              <Button type="button" variant="outline" onClick={() => setActiveTab('overview')}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
                {saving ? 'Executing Transfer...' : 'Confirm Transfer'}
              </Button>
            </div>
          </form>
        )}

        {/* Tab 3: Damage, Loss & Restoration */}
        {activeTab === 'breakage' && (
          <form onSubmit={handleExecuteStatusAction} className="space-y-3 bg-stone-50/50 p-4 rounded-lg border border-stone-200">
            <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Log Damage, Loss, or Return to Service
            </h3>

            <div>
              <label className="block font-medium text-stone-700 mb-1">Event Type <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setActionType('breakage')}
                  className={`p-2 rounded-md border text-center font-medium transition-colors ${
                    actionType === 'breakage'
                      ? 'bg-amber-100 border-amber-400 text-amber-900'
                      : 'bg-white border-stone-300 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  Broken / Damaged
                </button>
                <button
                  type="button"
                  onClick={() => setActionType('loss')}
                  className={`p-2 rounded-md border text-center font-medium transition-colors ${
                    actionType === 'loss'
                      ? 'bg-red-100 border-red-400 text-red-900'
                      : 'bg-white border-stone-300 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  Missing / Lost
                </button>
                <button
                  type="button"
                  onClick={() => setActionType('repair')}
                  className={`p-2 rounded-md border text-center font-medium transition-colors ${
                    actionType === 'repair'
                      ? 'bg-emerald-100 border-emerald-400 text-emerald-900'
                      : 'bg-white border-stone-300 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  Repaired & Restored
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {actionType === 'repair' ? 'Restore Into Location' : 'Affected Location'}{' '}
                  <span className="text-red-500">*</span>
                </label>
                <select
                  value={actionLoc}
                  onChange={(e) => setActionLoc(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none bg-white"
                >
                  <option value="">Select Location...</option>
                  {locations.map((loc) => {
                    const avail = asset.location_stocks?.find((ls: any) => ls.location_id === loc.id)?.quantity || 0;
                    return (
                      <option key={loc.id} value={loc.id} disabled={actionType !== 'repair' && Number(avail) <= 0}>
                        {loc.name} {actionType !== 'repair' ? `(${avail} available)` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Quantity ({asset.unit?.symbol || 'pcs'}) <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min="1"
                  value={actionQty || ''}
                  onChange={(e) => setActionQty(parseInt(e.target.value) || 0)}
                  placeholder="1"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 font-bold text-stone-900 focus:outline-none bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-stone-700 mb-1">Incident Notes / Cause</label>
              <input
                type="text"
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="e.g. Dropped during dinner cleanup, missing from table setup"
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none bg-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
              <Button type="button" variant="outline" onClick={() => setActiveTab('overview')}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
                {saving ? 'Saving...' : 'Record Incident'}
              </Button>
            </div>
          </form>
        )}

        {/* Tab 4: Movement History Ledger */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 font-semibold">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Quantity</th>
                    <th className="py-2.5 px-3">Route / Details</th>
                    <th className="py-2.5 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {historyMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-stone-50/50">
                      <td className="py-2.5 px-3 font-mono text-stone-600 whitespace-nowrap">{m.business_date}</td>
                      <td className="py-2.5 px-3">
                        <Badge
                          variant={
                            m.movement_type === 'purchase' || m.movement_type === 'opening' || m.movement_type === 'return'
                              ? 'success'
                              : m.movement_type === 'transfer'
                              ? 'info'
                              : 'danger'
                          }
                          className="capitalize text-[10px]"
                        >
                          {m.movement_type}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold">
                        {m.quantity} {asset.unit?.symbol || 'pcs'}
                      </td>
                      <td className="py-2.5 px-3 text-stone-600">
                        {m.movement_type === 'transfer' ? (
                          <span>
                            {m.src?.name || 'Store'} → {m.dest?.name || 'Room'}
                          </span>
                        ) : m.dest?.name ? (
                          <span>Inward to {m.dest.name}</span>
                        ) : m.src?.name ? (
                          <span>Deducted from {m.src.name}</span>
                        ) : (
                          m.purpose || '—'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-stone-500 truncate max-w-xs">{m.notes || '—'}</td>
                    </tr>
                  ))}
                  {historyMovements.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-stone-400">
                        No movement history recorded for this asset yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-3 border-t">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
