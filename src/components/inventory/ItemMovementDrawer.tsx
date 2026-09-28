'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
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
  const { t, locale } = useI18n();
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
          src:inventory_locations!stock_movements_source_location_id_fkey(name, name_hi),
          dest:inventory_locations!stock_movements_destination_location_id_fkey(name, name_hi),
          department:departments(name, name_hi),
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
  const unitDisplay = (locale === 'hi' && item.unit_symbol_hi)
    ? item.unit_symbol_hi
    : (item.unit_symbol || item.unit?.symbol || (locale === 'hi' ? 'इकाई' : 'units'));

  const getMovementBadge = (type: string, purpose?: string) => {
    switch (type) {
      case 'purchase':
        return <Badge variant="success" className="gap-1"><ArrowDownLeft className="h-3 w-3" /> {t('inventory.stock.movementBadges.purchase')}</Badge>;
      case 'opening':
        return <Badge variant="outline" className="gap-1">{t('inventory.stock.movementBadges.opening')}</Badge>;
      case 'transfer':
        return <Badge variant="default" className="gap-1"><ArrowRightLeft className="h-3 w-3" /> {t('inventory.stock.movementBadges.transfer')}</Badge>;
      case 'issue':
        return <Badge variant="info" className="gap-1"><ArrowUpRight className="h-3 w-3" /> {purpose || t('inventory.stock.movementBadges.issue')}</Badge>;
      case 'sale':
        return <Badge variant="success" className="gap-1">{t('inventory.stock.movementBadges.sale')}</Badge>;
      case 'consumption':
        return <Badge variant="info" className="gap-1">{t('inventory.stock.movementBadges.consumption')}</Badge>;
      case 'return':
        return <Badge variant="success" className="gap-1">{t('inventory.stock.movementBadges.return')}</Badge>;
      case 'staff_food':
        return <Badge variant="warning" className="gap-1"><ArrowUpRight className="h-3 w-3" /> {t('inventory.stock.movementBadges.staff_food')}</Badge>;
      case 'wastage':
      case 'spoilage':
      case 'breakage':
      case 'loss':
        return <Badge variant="danger" className="gap-1"><ArrowUpRight className="h-3 w-3" /> {t(`inventory.stock.movementBadges.${type}`, { defaultValue: type })}</Badge>;
      case 'count_adjustment':
      case 'physical_count_adjustment':
        return <Badge variant="outline" className="gap-1"><Scale className="h-3 w-3" /> {t('inventory.stock.movementBadges.count_adjustment')}</Badge>;
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
                <h2 className="text-base font-bold text-stone-900">{getLocalizedMasterName(item, locale) || item.name}</h2>
                <Badge variant="outline" className="font-mono text-[11px] font-bold">
                  {item.item_code}
                </Badge>
              </div>
              <p className="text-stone-500 mt-0.5">
                {(locale === 'hi' ? (item.category_name_hi || item.category?.name_hi || item.category_name || item.category?.name || 'सामान्य इन्वेंटरी') : (item.category_name || item.category?.name || 'General Inventory'))} • {t(`inventory.stock.classes.${item.inventory_class}`, { defaultValue: item.inventory_class })}
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
            <div className="text-[10px] text-stone-500 uppercase tracking-wider font-semibold">{t('inventory.drawer.stockOnHand')}</div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">
              {currentQty.toFixed(2)} <span className="text-[10px] font-normal text-stone-500">{unitDisplay}</span>
            </div>
          </div>
          <div className="p-3 bg-white rounded-lg border border-stone-200">
            <div className="text-[10px] text-stone-500 uppercase tracking-wider font-semibold">{t('inventory.drawer.wacCost')}</div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">
              {formatINR(wacCost)}
            </div>
          </div>
          <div className="p-3 bg-white rounded-lg border border-stone-200">
            <div className="text-[10px] text-stone-500 uppercase tracking-wider font-semibold">{t('inventory.drawer.totalValuation')}</div>
            <div className="text-lg font-bold text-stone-900 mt-0.5">
              {formatINR(totalValue)}
            </div>
          </div>
        </div>

        {/* Movements Ledger */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          <div className="flex items-center justify-between pb-1">
            <h3 className="font-bold text-stone-900 flex items-center gap-2">
              <History className="h-4 w-4 text-amber-600" /> {t('inventory.stock.tabs.movements', { count: movements.length })}
            </h3>
            <Button variant="outline" size="sm" onClick={loadMovements} disabled={loading} className="h-7 text-xs">
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-stone-400">{t('inventory.drawer.loading')}</div>
          ) : movements.length === 0 ? (
            <div className="py-12 text-center text-stone-400">{t('inventory.drawer.noMovements')}</div>
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
                      {m.quantity} {unitDisplay}
                    </span>
                  </div>

                  {/* Route / Location info */}
                  <div className="flex items-center justify-between text-[11px] text-stone-600">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-stone-400" />
                      {m.movement_type === 'transfer' ? (
                        <span>
                          {getLocalizedMasterName(m.src, locale) || (locale === 'hi' ? 'स्टोर' : 'Store')} → {getLocalizedMasterName(m.dest, locale) || (locale === 'hi' ? 'गंतव्य' : 'Destination')}
                        </span>
                      ) : m.dest?.name ? (
                        <span>{locale === 'hi' ? `${getLocalizedMasterName(m.dest, locale)} में आवक` : `Inward to ${m.dest.name}`}</span>
                      ) : m.src?.name ? (
                        <span>{locale === 'hi' ? `${getLocalizedMasterName(m.src, locale)} से प्रेषित` : `Dispatched from ${m.src.name}`}</span>
                      ) : (
                        <span>{locale === 'hi' ? 'केंद्रीय इन्वेंटरी' : 'Central Inventory'}</span>
                      )}
                    </div>
                    <span className="font-mono text-stone-500">
                      {locale === 'hi' ? `मूल्य: ${formatINR(Number(m.total_value || 0))}` : `Value: ${formatINR(Number(m.total_value || 0))}`}
                    </span>
                  </div>

                  {/* Context notes */}
                  {(m.notes || m.department?.name || m.staff?.name) && (
                    <div className="text-[10px] text-stone-400 border-t border-stone-200/60 pt-1 flex items-center justify-between">
                      <span className="truncate max-w-xs">{m.notes || m.purpose || '—'}</span>
                      {m.staff?.name && <span>{locale === 'hi' ? `द्वारा: ${m.staff.name}` : `By: ${m.staff.name}`}</span>}
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
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
