'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { Layers, Plus, RefreshCw, CheckCircle, AlertCircle, ShieldAlert } from 'lucide-react';

export default function PhysicalAssetsPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [assets, setAssets] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form State
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [movementType, setMovementType] = useState<'purchase' | 'broken' | 'lost' | 'disposed' | 'adjustment'>('broken');
  const [quantity, setQuantity] = useState<number>(1);
  const [notes, setNotes] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: aData, error: aError } = await supabase
        .from('inventory_items')
        .select('*, unit:units!inventory_items_unit_id_fkey(symbol), category:inventory_categories(name)')
        .eq('inventory_class', 'Physical Asset')
        .order('name');

      const { data: mData, error: mError } = await supabase
        .from('stock_movements')
        .select('*, item:inventory_items!stock_movements_item_id_fkey(name, item_code)')
        .order('created_at', { ascending: false });

      if (aError) throw aError;
      if (mError) throw mError;

      setAssets(aData || []);
      setMovements(mData || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const calculateAssetStock = (asset: any) => {
    return Number(asset.current_stock || 0);
  };

  const handleRecordMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssetId || quantity <= 0) return;
    setSaving(true);
    setMessage(null);

    try {
      const isDeduction = movementType === 'broken' || movementType === 'lost' || movementType === 'disposed';
      const qty = isDeduction ? -Math.abs(quantity) : Math.abs(quantity);
      const currentAsset = assets.find((a) => a.id === selectedAssetId);
      const wac = Number(currentAsset?.current_weighted_average_cost || 0);

      // 1. Record authoritative stock movement
      const { error: smErr } = await supabase.from('stock_movements').insert({
        item_id: selectedAssetId,
        business_date: businessDate,
        movement_type: movementType === 'purchase' ? 'purchase' : isDeduction ? 'wastage' : 'adjustment',
        purpose: movementType === 'broken' ? 'Breakage' : movementType === 'lost' ? 'Lost' : movementType === 'disposed' ? 'Disposed' : movementType === 'purchase' ? 'Purchase' : 'Asset Adjustment',
        quantity: qty,
        unit_cost: wac,
        total_value: qty * wac,
        notes,
      });

      if (smErr) throw smErr;

      // 2. Update authoritative inventory_items current_stock
      const nextStock = Math.max(0, Number(currentAsset?.current_stock || 0) + qty);
      await supabase
        .from('inventory_items')
        .update({
          current_stock: nextStock,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedAssetId);

      // 3. Optional legacy mirror
      try {
        await supabase.from('asset_movements').insert({
          asset_id: selectedAssetId,
          business_date: businessDate,
          movement_type: movementType,
          quantity,
          notes,
        });
      } catch {
        // ignore legacy mirror error if FK differs
      }

      setMessage({ type: 'success', text: `Asset movement (${movementType}: ${quantity} pcs) recorded successfully.` });
      setShowModal(false);
      setQuantity(1);
      setNotes('');
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error recording movement.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Layers className="h-6 w-6 text-amber-600" />
            Physical Assets & Equipment Ledger
          </h1>
          <p className="text-sm text-stone-500">
            Cutlery, crockery, furniture, and kitchen assets tracked via opening, purchases, breakage and loss.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setShowModal(true)} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white">
            <Plus className="h-4 w-4" /> Log Breakage / Asset Movement
          </Button>
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

      {/* Assets Table */}
      <Card>
        <CardHeader>
          <CardTitle>Physical Asset Inventory</CardTitle>
          <CardDescription>Authoritative expected quantities derived from movement history</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading asset registry...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                    <th className="py-2.5 px-3">Asset Code</th>
                    <th className="py-2.5 px-3">Item Name</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Location</th>
                    <th className="py-2.5 px-3 text-right">Current Expected Quantity</th>
                    <th className="py-2.5 px-3 text-center">Condition</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {assets.map((a) => {
                    const qty = calculateAssetStock(a);
                    return (
                      <tr key={a.id} className="hover:bg-stone-50/80">
                        <td className="py-3 px-3 font-mono text-amber-700 font-bold">{a.item_code || 'AST'}</td>
                        <td className="py-3 px-3 font-semibold text-stone-900">{a.name || a.item_name}</td>
                        <td className="py-3 px-3 text-stone-600">{a.category?.name || a.category || 'Cutlery & Equipment'}</td>
                        <td className="py-3 px-3 text-stone-600">{a.location || 'Main Ground / Kitchen'}</td>
                        <td className="py-3 px-3 text-right font-bold text-sm text-stone-900">
                          {qty > 0 ? qty : '0'} {a.unit?.symbol || 'pcs'}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <Badge variant={a.is_active !== false ? 'success' : 'outline'}>
                            {a.is_active !== false ? 'In Service' : 'Retired'}
                          </Badge>
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

      {/* Movement Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-base font-bold text-stone-900">Log Asset Movement / Breakage</h2>
              <button onClick={() => setShowModal(false)} className="text-stone-400 hover:text-stone-700 text-lg">✕</button>
            </div>

            <form onSubmit={handleRecordMovement} className="space-y-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Asset</label>
                <select
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Asset...</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.item_code ? `[${a.item_code}] ` : ''}{a.name || a.item_name} ({a.category?.name || a.category || 'Asset'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Movement Type</label>
                <select
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value as any)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="broken">Breakage (e.g. Glass / Plate dropped)</option>
                  <option value="lost">Missing / Lost in Dining Hall</option>
                  <option value="purchase">New Purchase Addition</option>
                  <option value="disposed">Disposed / Scrap Write-off</option>
                  <option value="adjustment">Count Adjustment</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Quantity (Pieces)</label>
                <input
                  type="number"
                  value={quantity || ''}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                  placeholder="1"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 font-bold text-stone-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Reason / Remarks</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Broken during rush dinner rush"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
                  {saving ? 'Recording...' : 'Record Movement'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

