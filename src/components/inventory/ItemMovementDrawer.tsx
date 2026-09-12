'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import {
  X,
  History,
  Package,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Scale,
  Calendar,
  Layers,
  IndianRupee,
  FileText,
  MapPin,
  ArrowRightLeft,
} from 'lucide-react';

interface ItemMovementDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  item: any | null;
}

export function ItemMovementDrawer({ isOpen, onClose, item }: ItemMovementDrawerProps) {
  const supabase = createClient();
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMovements = async () => {
    if (!item?.item_id && !item?.id) return;
    const targetId = item.item_id || item.id;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('stock_movements')
        .select(`
          *,
          src:inventory_locations!stock_movements_source_location_id_fkey(name),
          dest:inventory_locations!stock_movements_destination_location_id_fkey(name),
          department:departments(name),
          staff:employees(name)
        `)
        .eq('item_id', targetId)
        .order('business_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMovements(data || []);
    } catch (err: any) {
      console.error('Error loading item stock movements:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && item) {
      loadMovements();
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const currentQty = Number(item.current_quantity ?? item.current_stock ?? 0);
  const wacCost = Number(item.wac_cost ?? item.current_weighted_average_cost ?? 0);
  const totalValue = Number(item.current_stock_value ?? (currentQty * wacCost));

  const getMovementBadge = (type: string, purpose?: string) => {
    switch (type) {
      case 'purchase':
        return <Badge variant="success" className="gap-1"><ArrowDownLeft className="h-3 w-3" /> Purchase Inward</Badge>;
      case 'opening':
        return <Badge variant="outline" className="gap-1">Opening Balance</Badge>;
      case 'transfer':
        return <Badge variant="default" className="gap-1"><ArrowRightLeft className="h-3 w-3" /> Transfer</Badge>;
      case 'issue':
        return <Badge variant="info" className="gap-1"><ArrowUpRight className="h-3 w-3" /> {purpose || 'Store Issue'}</Badge>;
      case 'sale':
        return <Badge variant="success" className="gap-1">Direct Sale</Badge>;
      case 'consumption':
        return <Badge variant="info" className="gap-1">Consumption</Badge>;
      case 'return':
        return <Badge variant="success" className="gap-1">Return Inward</Badge>;
      case 'staff_food':
        return <Badge variant="warning" className="gap-1"><ArrowUpRight className="h-3 w-3" /> Staff Food</Badge>;
      case 'wastage':
      case 'spoilage':
      case 'breakage':
      case 'loss':
        return <Badge variant="danger" className="gap-1"><ArrowUpRight className="h-3 w-3" /> {type}</Badge>;
      case 'count_adjustment':
      case 'physical_count_adjustment':
        return <Badge variant="outline" className="gap-1"><Scale className="h-3 w-3" /> Count Variance</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
      <div className="bg-white w-full max-w-xl h-full shadow-2xl flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-stone-900">{item.name}</h2>
                <Badge variant="outline" className="font-mono text-[11px] font-bold">
                  {item.item_code}
                </Badge>
              </div>
              <p className="text-stone-500 mt-0.5">
                {item.category_name || item.category?.name || 'General Inventory'} • {item.inventory_class}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stock Snapshot Cards */}
        <div className="p-6 border-b border-stone-200 bg-stone-50/50 grid grid-cols-3 gap-3">
          <div className="p-3 bg-white rounded-lg border border-stone-200">
            <div className="text-[10px] text-stone-500 uppercase tracking-wider font-semibold">Current Balance</div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">
              {currentQty.toFixed(2)} <span className="text-[10px] font-normal text-stone-500">{item.unit_symbol || item.unit?.symbol || 'units'}</span>
            </div>
          </div>
          <div className="p-3 bg-white rounded-lg border border-stone-200">
            <div className="text-[10px] text-stone-500 uppercase tracking-wider font-semibold">Weighted Cost</div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">
              {formatINR(wacCost)}
            </div>
          </div>
          <div className="p-3 bg-white rounded-lg border border-stone-200">
            <div className="text-[10px] text-stone-500 uppercase tracking-wider font-semibold">Total Stock Value</div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">
              {formatINR(totalValue)}
            </div>
          </div>
        </div>

        {/* Movements Ledger */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          <div className="flex items-center justify-between pb-1">
            <h3 className="font-bold text-stone-900 flex items-center gap-2">
              <History className="h-4 w-4 text-amber-600" /> Complete Movement History ({movements.length})
            </h3>
            <Button variant="outline" size="sm" onClick={loadMovements} disabled={loading} className="h-7 text-xs">
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-stone-400">Loading movements...</div>
          ) : movements.length === 0 ? (
            <div className="py-12 text-center text-stone-400">No stock movements recorded for this item.</div>
          ) : (
            <div className="space-y-2">
              {movements.map((m) => (
                <div key={m.id} className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-1.5 hover:bg-amber-50/20 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getMovementBadge(m.movement_type, m.purpose)}
                      <span className="font-mono text-stone-600 text-[11px] font-semibold">{m.business_date}</span>
                    </div>
                    <span className="font-mono font-bold text-sm text-stone-900">
                      {m.movement_type === 'count_adjustment' && Number(m.quantity) > 0 ? '+' : ''}
                      {m.quantity} {item.unit_symbol || item.unit?.symbol || 'units'}
                    </span>
                  </div>

                  {/* Route / Location info */}
                  <div className="flex items-center justify-between text-[11px] text-stone-600">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-stone-400" />
                      {m.movement_type === 'transfer' ? (
                        <span>
                          {m.src?.name || 'Store'} → {m.dest?.name || 'Destination'}
                        </span>
                      ) : m.dest?.name ? (
                        <span>Inward to {m.dest.name}</span>
                      ) : m.src?.name ? (
                        <span>Dispatched from {m.src.name}</span>
                      ) : (
                        <span>Central Inventory</span>
                      )}
                    </div>
                    <span className="font-mono text-stone-500">
                      Value: {formatINR(Number(m.total_value || 0))}
                    </span>
                  </div>

                  {/* Context notes */}
                  {(m.notes || m.department?.name || m.staff?.name) && (
                    <div className="text-[10px] text-stone-400 border-t border-stone-200/60 pt-1 flex items-center justify-between">
                      <span className="truncate max-w-xs">{m.notes || m.purpose || '—'}</span>
                      {m.staff?.name && <span>By: {m.staff.name}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-stone-200 bg-stone-50 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
