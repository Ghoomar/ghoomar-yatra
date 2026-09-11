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
  FileText
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
        .select('*')
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
        return <Badge variant="success" className="gap-1"><ArrowDownLeft className="h-3 w-3" /> Purchase</Badge>;
      case 'issue':
        return <Badge variant="info" className="gap-1"><ArrowUpRight className="h-3 w-3" /> {purpose || 'Store Issue'}</Badge>;
      case 'staff_food':
        return <Badge variant="warning" className="gap-1"><ArrowUpRight className="h-3 w-3" /> Staff Food</Badge>;
      case 'wastage':
      case 'spoilage':
        return <Badge variant="danger" className="gap-1"><ArrowUpRight className="h-3 w-3" /> Wastage</Badge>;
      case 'adjustment':
        return <Badge variant="outline" className="gap-1"><Scale className="h-3 w-3" /> Adjustment</Badge>;
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
              <p className="text-[11px] text-stone-500">
                {item.inventory_class} • {item.category_name || item.category || 'General'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Master Details KPI Cards */}
        <div className="p-6 bg-stone-50/50 border-b border-stone-200 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white p-3 rounded-xl border border-stone-200 shadow-2xs">
              <div className="text-[10px] text-stone-500 uppercase font-semibold">Available Stock</div>
              <div className="text-lg font-bold text-stone-900 mt-0.5">
                {currentQty.toFixed(2)}{' '}
                <span className="text-xs font-normal text-stone-500">{item.unit_symbol || 'units'}</span>
              </div>
            </div>

            <div className="bg-white p-3 rounded-xl border border-stone-200 shadow-2xs">
              <div className="text-[10px] text-stone-500 uppercase font-semibold">WAC Valuation Rate</div>
              <div className="text-lg font-bold text-stone-900 mt-0.5">
                {formatINR(wacCost)}
              </div>
            </div>

            <div className="bg-white p-3 rounded-xl border border-stone-200 shadow-2xs">
              <div className="text-[10px] text-stone-500 uppercase font-semibold">Holding Value</div>
              <div className="text-lg font-bold text-amber-700 mt-0.5">
                {formatINR(totalValue)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] text-stone-600 px-1 pt-1">
            {item.storage_type && (
              <span><strong>Storage:</strong> {item.storage_type}</span>
            )}
            {item.minimum_stock > 0 && (
              <span><strong>Min Reorder:</strong> {Number(item.minimum_stock).toFixed(1)} {item.unit_symbol}</span>
            )}
            {item.conversion_factor > 1 && (
              <span><strong>Pack Factor:</strong> {item.conversion_factor} {item.unit_symbol}/pack</span>
            )}
          </div>
        </div>

        {/* Movement Ledger */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-stone-800 flex items-center gap-1.5">
              <History className="h-4 w-4 text-amber-600" />
              Chronological Stock Movement Ledger ({movements.length})
            </h3>
            <Button
              variant="outline"
              size="sm"
              onClick={loadMovements}
              className="h-7 text-[11px] gap-1 text-stone-600"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>

          {loading ? (
            <div className="py-16 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading transaction history...
            </div>
          ) : movements.length === 0 ? (
            <div className="py-16 text-center text-stone-400 text-xs border border-dashed border-stone-200 rounded-xl">
              No stock movements recorded for this SKU yet.
            </div>
          ) : (
            <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100 bg-white">
              {movements.map((m) => {
                const isPositive = Number(m.quantity) > 0;
                return (
                  <div key={m.id} className="p-3 hover:bg-stone-50/60 transition-colors space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getMovementBadge(m.movement_type, m.purpose)}
                        <span className="font-mono text-stone-500 font-medium">
                          {m.business_date}
                        </span>
                      </div>
                      <span className={`font-mono font-bold text-sm ${isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {isPositive ? `+${Number(m.quantity).toFixed(2)}` : Number(m.quantity).toFixed(2)}{' '}
                        <span className="text-[11px] font-normal text-stone-500">{item.unit_symbol || 'units'}</span>
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-stone-500">
                      <div>
                        {m.reference_type && (
                          <span>Ref: <strong className="font-mono text-stone-700">{m.reference_type}</strong></span>
                        )}
                        {m.notes && <span> • {m.notes}</span>}
                      </div>
                      <div className="text-stone-700 font-medium font-mono">
                        {formatINR(Number(m.total_value) || 0)} (@ {formatINR(Number(m.unit_cost) || 0)})
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 bg-stone-50 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
