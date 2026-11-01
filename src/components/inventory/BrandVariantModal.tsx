'use client';

import React, { useState, useMemo } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Package, X, Check, AlertTriangle, Layers } from 'lucide-react';

export interface BrandVariantModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: any;
  variants: any[];
  packagingList: any[];
  sourceLocationId: string;
  sourceLocationName: string;
  initialVariantId?: string;
  onConfirm: (selection: {
    item: any;
    baseQuantity: number;
    displayQuantity: number;
    displayUnit: string;
    packUnitName?: string;
  }) => void;
}

export function BrandVariantModal({
  isOpen,
  onClose,
  group,
  variants,
  packagingList,
  sourceLocationId,
  sourceLocationName,
  initialVariantId,
  onConfirm,
}: BrandVariantModalProps) {
  const { t, locale } = useI18n();

  const [selectedItemId, setSelectedItemId] = useState<string>(initialVariantId || '');
  const [qtyInput, setQtyInput] = useState<string>('1');
  const [selectedUnitType, setSelectedUnitType] = useState<string>('base'); // 'base', 'sub', or packaging_id

  // Ensure variants strictly match the selected group's ID
  const groupVariants = useMemo(() => {
    if (!group?.id) return variants;
    return variants.filter((v) => v.group_id === group.id);
  }, [variants, group?.id]);

  // Calculate stock for each variant at the selected source location
  const variantStockData = useMemo(() => {
    return groupVariants.map((v) => {
      const ls = (v.location_stocks || []).find((s: any) => s.location_id === sourceLocationId);
      const stock = Number(ls?.quantity || 0);
      const packs = packagingList.filter((p) => p.inventory_item_id === v.id && p.is_active);
      const defaultPack = packs.find((p) => p.is_default) || packs[0] || null;

      let packSubtitle = '';
      if (stock > 0 && defaultPack && Number(defaultPack.pack_size_in_base_units) > 0 && v.brand_name !== 'Loose') {
        const packSize = Number(defaultPack.pack_size_in_base_units);
        const packCount = Math.floor(stock / packSize);
        if (packCount > 0) {
          const packUnitName = defaultPack.pack_unit_name.toLowerCase().includes('box')
            ? `${packCount} boxes`
            : `${packCount} ${defaultPack.pack_unit_name}`;
          const baseUnitSym = getLocalizedMasterSymbol(v.unit, locale) || v.unit?.symbol || 'units';
          packSubtitle = `${packUnitName} (${stock} ${baseUnitSym})`;
        }
      }

      return {
        item: v,
        stock,
        isAvailable: stock > 0,
        packs,
        defaultPack,
        packSubtitle,
      };
    });
  }, [groupVariants, sourceLocationId, packagingList, locale]);

  // Sort: available variants first descending by available stock, then unavailable
  const sortedVariants = useMemo(() => {
    return [...variantStockData].sort((a, b) => {
      if (a.isAvailable && !b.isAvailable) return -1;
      if (!a.isAvailable && b.isAvailable) return 1;
      return b.stock - a.stock;
    });
  }, [variantStockData]);

  // Auto-select first available variant if none is selected
  const activeVariantData = useMemo(() => {
    if (selectedItemId) {
      return variantStockData.find((v) => v.item.id === selectedItemId) || null;
    }
    const firstAvail = sortedVariants.find((v) => v.isAvailable);
    return firstAvail || sortedVariants[0] || null;
  }, [selectedItemId, variantStockData, sortedVariants]);

  // Unit Options derivation
  const unitOptions = useMemo(() => {
    if (!activeVariantData) return [];
    const it = activeVariantData.item;
    const baseSym = (it.unit?.symbol || 'kg').toLowerCase();
    const options: Array<{ id: string; label: string; factorToBase: number }> = [];

    if (baseSym === 'kg') {
      options.push({ id: 'base', label: 'kg', factorToBase: 1.0 });
      options.push({ id: 'sub', label: 'g', factorToBase: 0.001 });
    } else if (baseSym === 'g') {
      options.push({ id: 'base', label: 'g', factorToBase: 1.0 });
      options.push({ id: 'sub', label: 'kg', factorToBase: 1000.0 });
    } else if (baseSym === 'l') {
      options.push({ id: 'base', label: 'L', factorToBase: 1.0 });
      options.push({ id: 'sub', label: 'ml', factorToBase: 0.001 });
    } else if (baseSym === 'ml') {
      options.push({ id: 'base', label: 'ml', factorToBase: 1.0 });
      options.push({ id: 'sub', label: 'L', factorToBase: 1000.0 });
    } else {
      options.push({
        id: 'base',
        label: getLocalizedMasterSymbol(it.unit, locale) || it.unit?.symbol || 'units',
        factorToBase: 1.0,
      });
    }

    // Add approved packaging units
    activeVariantData.packs.forEach((pkg: any) => {
      const size = Number(pkg.pack_size_in_base_units) || 1.0;
      options.push({
        id: `pkg_${pkg.id}`,
        label: pkg.pack_unit_name,
        factorToBase: size,
      });
    });

    return options;
  }, [activeVariantData, locale]);

  const currentUnitOption = useMemo(() => {
    return unitOptions.find((u) => u.id === selectedUnitType) || unitOptions[0] || { factorToBase: 1.0, label: 'units' };
  }, [unitOptions, selectedUnitType]);

  const parsedQty = parseFloat(qtyInput) || 0;
  const calculatedBaseQty = parsedQty * (currentUnitOption.factorToBase || 1.0);
  const availableStock = activeVariantData?.stock || 0;
  const isOverStock = calculatedBaseQty > availableStock;
  const isZeroStock = availableStock <= 0;
  const baseUnitSymbol = activeVariantData
    ? getLocalizedMasterSymbol(activeVariantData.item.unit, locale) || activeVariantData.item.unit?.symbol || 'units'
    : 'units';

  if (!isOpen || !group) return null;

  const handleConfirm = () => {
    if (!activeVariantData || isOverStock || calculatedBaseQty <= 0) return;
    onConfirm({
      item: activeVariantData.item,
      baseQuantity: calculatedBaseQty,
      displayQuantity: parsedQty,
      displayUnit: currentUnitOption.label,
      packUnitName: selectedUnitType.startsWith('pkg_') ? currentUnitOption.label : undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                {group.group_code || 'GROUP'}
              </span>
              <h2 className="text-base font-bold text-stone-900">
                {getLocalizedMasterName(group, locale) || group.name}
              </h2>
            </div>
            <p className="text-xs text-stone-500 mt-0.5 flex items-center gap-1.5">
              <span>{t('inventory.issues.sourceLocation')}:</span>
              <span className="font-semibold text-stone-700">{sourceLocationName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Section: Stock Variant Selection */}
          <div>
            <label className="text-xs font-bold text-stone-700 block mb-2">
              {t('inventory.issues.stockVariant')}
            </label>
            <div className="space-y-2">
              {sortedVariants.map(({ item, stock, isAvailable, packSubtitle }) => {
                const isSelected = activeVariantData?.item.id === item.id;
                const brandDisplay = item.brand_name || item.name;

                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!isAvailable}
                    onClick={() => {
                      setSelectedItemId(item.id);
                      setSelectedUnitType('base');
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-amber-500 bg-amber-50/60 shadow-xs'
                        : isAvailable
                        ? 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50/50'
                        : 'border-stone-200 bg-stone-100/60 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${
                          isSelected
                            ? 'border-amber-600 bg-amber-600 text-white'
                            : 'border-stone-300 bg-white'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                      <div>
                        <div className="font-bold text-sm text-stone-900 flex items-center gap-2">
                          <span>{brandDisplay}</span>
                          <span className="text-[10px] font-mono text-stone-400 font-normal">
                            ({item.item_code})
                          </span>
                        </div>
                        <div className="text-xs text-stone-500 mt-0.5">
                          {isAvailable ? (
                            packSubtitle ? (
                              <span className="font-medium text-emerald-800">{packSubtitle}</span>
                            ) : (
                              <span className="font-medium text-emerald-800">
                                {stock} {baseUnitSymbol}
                              </span>
                            )
                          ) : (
                            <span className="font-semibold text-rose-600">
                              0 — {t('inventory.issues.unavailable')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <Badge
                        variant={isAvailable ? 'default' : 'outline'}
                        className={`text-[10px] ${
                          isAvailable
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-stone-200 text-stone-600 border-stone-300'
                        }`}
                      >
                        {isAvailable ? `${stock} ${baseUnitSymbol}` : t('inventory.issues.unavailable')}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section: Quantity & Unit Selector */}
          {activeVariantData && (
            <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-stone-800">
                  {t('inventory.issues.issueQuantity')}
                </label>
                <span className="text-[11px] text-stone-500">
                  {t('inventory.issues.available')}:{' '}
                  <strong className="text-stone-900 font-mono">
                    {availableStock} {baseUnitSymbol}
                  </strong>
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    value={qtyInput}
                    onChange={(e) => setQtyInput(e.target.value)}
                    placeholder="0"
                    disabled={isZeroStock}
                    className="w-full p-2.5 rounded-lg border border-stone-300 font-bold text-base text-right bg-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <select
                    value={selectedUnitType}
                    onChange={(e) => setSelectedUnitType(e.target.value)}
                    disabled={isZeroStock}
                    className="w-full p-2.5 rounded-lg border border-stone-300 font-semibold text-xs bg-white text-stone-800 focus:outline-none focus:border-amber-500"
                  >
                    {unitOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Conversion Preview & Live Validation */}
              <div className="pt-2 border-t border-stone-200/60 text-xs space-y-1">
                <div className="flex items-center justify-between text-stone-600">
                  <span>{t('inventory.issues.equivalentBase')}</span>
                  <span className="font-mono font-bold text-stone-900">
                    {calculatedBaseQty.toFixed(3)} {baseUnitSymbol}
                  </span>
                </div>

                <div className="flex items-center justify-between text-stone-600">
                  <span>{t('inventory.issues.remainingStock')}</span>
                  <span
                    className={`font-mono font-bold ${
                      isOverStock ? 'text-rose-600' : 'text-emerald-700'
                    }`}
                  >
                    {(availableStock - calculatedBaseQty).toFixed(3)} {baseUnitSymbol}
                  </span>
                </div>

                {isOverStock && (
                  <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-medium text-[11px] flex items-center gap-1.5 mt-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {t('inventory.issues.cannotExceedStock', {
                        max: availableStock.toString(),
                        unit: baseUnitSymbol,
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 border-t border-stone-100 flex items-center justify-end gap-2 bg-stone-50/50">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!activeVariantData || isOverStock || calculatedBaseQty <= 0 || isZeroStock}
            className="bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
          >
            {t('inventory.issues.confirmSelection')}
          </Button>
        </div>
      </div>
    </div>
  );
}
