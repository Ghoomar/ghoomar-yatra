'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';
import { formatINR, formatNumber, getTodayBusinessDate } from '@/lib/utils';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
import { filterInventoryItems } from '@/lib/inventory/search';
import {
  X,
  Plus,
  Trash2,
  Search,
  Package,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Sparkles,
} from 'lucide-react';

interface StagedRequestLine {
  item_id: string;
  item_name: string;
  item_code: string;
  brand_name: string;
  preferred_vendor_id?: string | null;
  preferred_vendor_name?: string | null;
  requested_quantity: number;
  pack_unit_snapshot?: string | null;
  pack_quantity?: number | null;
  conversion_factor_snapshot?: number;
  base_unit_symbol: string;
  estimated_unit_rate: number;
  estimated_total: number;
  current_stock: number;
  max_par?: number | null;
  min_par?: number | null;
  abc_class: string;
  usage_30d: number;
  is_eligible_auto: boolean;
  routing_reasons: string[];
}

interface CreatePurchaseRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: any[];
  groups: any[];
  packagingUnits: any[];
  vendors: any[];
  aliases: any[];
  policySettings: any;
  usage30dMap?: Record<string, number>;
  onSubmitted: () => void;
}

const MANDI_EXEMPT_CATEGORIES = ['Dairy Products', 'Vegetables', 'Fruits'];

export function CreatePurchaseRequestModal({
  isOpen,
  onClose,
  items,
  groups,
  packagingUnits,
  vendors,
  aliases,
  policySettings,
  usage30dMap = {},
  onSubmitted,
}: CreatePurchaseRequestModalProps) {
  const { t, locale } = useI18n();

  const [targetDate, setTargetDate] = useState(getTodayBusinessDate());
  const [notes, setNotes] = useState('');
  const [stagedLines, setStagedLines] = useState<StagedRequestLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Line creation picker state
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string>('Generic');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [usePack, setUsePack] = useState(false);
  const [selectedPackUnit, setSelectedPackUnit] = useState<any | null>(null);
  const [inputQuantity, setInputQuantity] = useState<string>('1');

  // Filter items matching search query using alias-aware search
  const aliasesMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (Array.isArray(aliases)) {
      aliases.forEach((a: any) => {
        if (a.item_id) {
          if (!map[a.item_id]) map[a.item_id] = [];
          if (a.alias && !map[a.item_id].includes(a.alias)) map[a.item_id].push(a.alias);
        }
        if (a.group_id) {
          if (!map[a.group_id]) map[a.group_id] = [];
          if (a.alias && !map[a.group_id].includes(a.alias)) map[a.group_id].push(a.alias);
        }
      });
    }
    return map;
  }, [aliases]);

  const filteredCandidates = useMemo(() => {
    if (!itemSearchQuery.trim()) return [];
    return filterInventoryItems(items, itemSearchQuery, aliasesMap).slice(0, 8);
  }, [items, itemSearchQuery, aliasesMap]);

  // Brands and packaging units available for selected item
  const availablePackagings = useMemo(() => {
    if (!selectedItem) return [];
    return (packagingUnits || []).filter(
      (pu: any) => pu.inventory_item_id === selectedItem.id
    );
  }, [selectedItem, packagingUnits]);

  const availableBrands = useMemo(() => {
    if (!selectedItem) return ['Generic'];
    const brandSet = new Set<string>();
    if (selectedItem.brand_name) brandSet.add(selectedItem.brand_name);
    availablePackagings.forEach((p: any) => {
      if (p.brand_name) brandSet.add(p.brand_name);
    });
    if (brandSet.size === 0) brandSet.add('Generic');
    return Array.from(brandSet);
  }, [selectedItem, availablePackagings]);

  // Live evaluation of current staged item
  const currentEvaluation = useMemo(() => {
    if (!selectedItem) return null;

    const qty = Number(inputQuantity);
    if (isNaN(qty) || qty <= 0) return null;

    const conv = usePack && selectedPackUnit ? Number(selectedPackUnit.pack_size_in_base_units) || 1 : 1;
    const baseQty = usePack ? qty * conv : qty;

    // Rate resolution
    const rate = Number(selectedItem.current_weighted_average_cost) || 0;
    const estimatedTotal = Math.round(baseQty * rate * 100) / 100;

    const reasons: string[] = [];
    const autoEnabled = policySettings?.auto_approve_enabled !== false;
    const lineLimit = Number(policySettings?.line_auto_approve_limit) || 1500;
    const maxPar = selectedItem.max_stock_level != null ? Number(selectedItem.max_stock_level) : null;
    const currentStock = Number(selectedItem.current_quantity) || 0;

    const itemId = selectedItem.id || selectedItem.item_id;
    const stagedQtyForThisItem = stagedLines
      .filter((l) => l.item_id === itemId)
      .reduce((sum, l) => sum + (Number(l.requested_quantity) || 0), 0);

    if (!autoEnabled) reasons.push(t('purchases.reasonPills.autoApproveDisabled'));
    if (rate <= 0) reasons.push(t('purchases.reasonPills.priceUnknown'));

    // Par check
    if (maxPar == null) {
      reasons.push(t('purchases.reasonPills.maxParNotSet'));
    } else if (currentStock + stagedQtyForThisItem + baseQty > maxPar) {
      reasons.push(t('purchases.reasonPills.exceedsMaxPar'));
    }

    // Line limit
    if (estimatedTotal > lineLimit) {
      reasons.push(t('purchases.reasonPills.overLineLimit'));
    }

    // Class A check
    if (selectedItem.abc_class === 'high_control') {
      if (!selectedItem.last_counted_at) {
        reasons.push(t('purchases.reasonPills.countOverdue'));
      } else {
        const diffDays = (Date.now() - new Date(selectedItem.last_counted_at).getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > (Number(policySettings?.high_control_count_interval_days) || 7)) {
          reasons.push(t('purchases.reasonPills.countOverdue'));
        }
      }
    }

    return {
      baseQty,
      rate,
      estimatedTotal,
      isAuto: reasons.length === 0,
      reasons,
    };
  }, [selectedItem, inputQuantity, usePack, selectedPackUnit, stagedLines, policySettings, t]);

  const handleSelectItem = (item: any) => {
    setSelectedItem(item);
    setItemSearchQuery('');
    setSelectedBrand(item.brand_name || 'Generic');
    setUsePack(false);
    setSelectedPackUnit(null);
    setInputQuantity('1');

    // Default vendor if linked
    const linkedPkgs = (packagingUnits || []).filter((p: any) => p.inventory_item_id === item.id && p.vendor_id);
    if (linkedPkgs.length > 0 && linkedPkgs[0].vendor_id) {
      setSelectedVendorId(linkedPkgs[0].vendor_id);
    } else {
      setSelectedVendorId('');
    }
  };

  const handleAddLine = () => {
    if (!selectedItem || !currentEvaluation) return;

    const baseUnitSym =
      getLocalizedMasterSymbol(selectedItem.unit, locale) ||
      selectedItem.unit_symbol ||
      (locale === 'hi' ? 'इकाई' : 'units');

    const vendorObj = vendors.find((v) => v.vendor_id === selectedVendorId || v.id === selectedVendorId);

    const newLine: StagedRequestLine = {
      item_id: selectedItem.id || selectedItem.item_id,
      item_name: (locale === 'hi' && selectedItem.name_hi) ? selectedItem.name_hi : selectedItem.name,
      item_code: selectedItem.item_code,
      brand_name: selectedBrand,
      preferred_vendor_id: selectedVendorId || null,
      preferred_vendor_name: vendorObj ? (getLocalizedMasterName(vendorObj, locale) || vendorObj.vendor_name || vendorObj.name) : null,
      requested_quantity: currentEvaluation.baseQty,
      pack_unit_snapshot: usePack && selectedPackUnit ? selectedPackUnit.pack_unit_name : null,
      pack_quantity: usePack ? Number(inputQuantity) : null,
      conversion_factor_snapshot: usePack && selectedPackUnit ? Number(selectedPackUnit.pack_size_in_base_units) : 1,
      base_unit_symbol: baseUnitSym,
      estimated_unit_rate: currentEvaluation.rate,
      estimated_total: currentEvaluation.estimatedTotal,
      current_stock: Number(selectedItem.current_quantity) || 0,
      max_par: selectedItem.max_stock_level != null ? Number(selectedItem.max_stock_level) : null,
      min_par: selectedItem.minimum_stock != null ? Number(selectedItem.minimum_stock) : null,
      abc_class: selectedItem.abc_class || 'routine_monitoring',
      usage_30d: (usage30dMap && (usage30dMap[selectedItem.id] || usage30dMap[selectedItem.item_id])) || 0,
      is_eligible_auto: currentEvaluation.isAuto,
      routing_reasons: currentEvaluation.reasons,
    };

    setStagedLines((prev) => [...prev, newLine]);

    // Reset picker
    setSelectedItem(null);
    setInputQuantity('1');
    setUsePack(false);
    setSelectedPackUnit(null);
    setSelectedVendorId('');
  };

  const handleRemoveLine = (index: number) => {
    setStagedLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stagedLines.length === 0) {
      setErrorMessage(t('purchases.createRequest.emptyLines'));
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        target_purchase_date: targetDate,
        notes: notes.trim() || null,
        lines: stagedLines.map((l) => ({
          item_id: l.item_id,
          preferred_vendor_id: l.preferred_vendor_id,
          requested_quantity: l.requested_quantity,
          pack_unit_snapshot: l.pack_unit_snapshot,
          pack_quantity: l.pack_quantity,
          conversion_factor_snapshot: l.conversion_factor_snapshot,
          stock_at_request: l.current_stock,
        })),
      };

      const res = await fetch('/api/finance/purchase-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to submit purchase request');
      }

      onSubmitted();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error submitting purchase request');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl max-w-3xl w-full shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <Package className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-stone-900">
                {t('purchases.createRequest.modalTitle')}
              </h2>
              <p className="text-xs text-stone-500">
                {t('purchases.createRequest.modalSubtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Target Date & Notes Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-stone-800 mb-1">
                {t('purchases.createRequest.targetDate')}
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full rounded-lg border border-stone-300 p-2 text-xs text-stone-900 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block font-bold text-stone-800 mb-1">
                {t('purchases.createRequest.notes')}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('purchases.createRequest.notesPlaceholder')}
                className="w-full rounded-lg border border-stone-300 p-2 text-xs text-stone-900 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Add Item Section */}
          <div className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/70 space-y-3">
            <span className="font-bold text-stone-900 text-xs block flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5 text-amber-600" />
              {t('purchases.createRequest.addItem')}
            </span>

            {/* Item Search Input */}
            {!selectedItem ? (
              <div className="space-y-1.5 relative">
                <div className="relative">
                  <Search className="h-4 w-4 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={itemSearchQuery}
                    onChange={(e) => setItemSearchQuery(e.target.value)}
                    placeholder={t('purchases.createRequest.searchItemPlaceholder')}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 bg-white text-xs text-stone-900 focus:outline-none focus:border-amber-500 shadow-2xs"
                  />
                </div>

                {/* Candidate Dropdown */}
                {filteredCandidates.length > 0 && (
                  <div className="border border-stone-200 rounded-lg bg-white shadow-lg overflow-hidden divide-y divide-stone-100 max-h-48 overflow-y-auto">
                    {filteredCandidates.map((cand: any) => (
                      <button
                        key={cand.id || cand.item_id}
                        type="button"
                        onClick={() => handleSelectItem(cand)}
                        className="w-full text-left px-3 py-2 hover:bg-amber-50/70 transition-colors flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-stone-900">
                            {locale === 'hi' && cand.name_hi ? cand.name_hi : cand.name}
                          </span>
                          <span className="text-[10px] text-stone-400 ml-2 font-mono">
                            {cand.item_code}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant={
                              cand.abc_class === 'high_control'
                                ? 'danger'
                                : cand.abc_class === 'frequent_monitoring'
                                ? 'warning'
                                : 'outline'
                            }
                            className="text-[9px]"
                          >
                            {cand.abc_class === 'high_control'
                              ? t('inventory.abc.highControlShort')
                              : cand.abc_class === 'frequent_monitoring'
                              ? t('inventory.abc.frequentShort')
                              : t('inventory.abc.routineShort')}
                          </Badge>
                          <span className="text-[10px] text-stone-500 font-mono">
                            Stock: {formatNumber(Number(cand.current_quantity) || 0)} {cand.unit_symbol}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Selected Item Details & Staging Controls */
              <div className="space-y-3 bg-white p-3 rounded-lg border border-stone-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-stone-900">
                      {locale === 'hi' && selectedItem.name_hi ? selectedItem.name_hi : selectedItem.name}
                    </h3>
                    <span className="text-[10px] text-stone-500 font-mono">
                      {selectedItem.item_code} • {selectedItem.category?.name || 'Category'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedItem(null)}
                    className="text-stone-400 hover:text-stone-700 text-xs px-2 py-0.5 rounded border border-stone-200 hover:bg-stone-100"
                  >
                    Change Item
                  </button>
                </div>

                {/* Context Strip: Stock / Par / ABC / 30d */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-200/70 text-[11px]">
                  <div>
                    <span className="text-stone-400 block text-[10px]">{t('purchases.createRequest.currentStock')}</span>
                    <span className="font-bold font-mono text-stone-800">
                      {formatNumber(Number(selectedItem.current_quantity) || 0)} {selectedItem.unit_symbol}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-400 block text-[10px]">{t('purchases.createRequest.maxPar')}</span>
                    <span className="font-bold font-mono text-stone-800">
                      {selectedItem.max_stock_level != null ? `${formatNumber(Number(selectedItem.max_stock_level))} ${selectedItem.unit_symbol}` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-400 block text-[10px]">{t('purchases.createRequest.abcClass')}</span>
                    <Badge
                      variant={
                        selectedItem.abc_class === 'high_control'
                          ? 'danger'
                          : selectedItem.abc_class === 'frequent_monitoring'
                          ? 'warning'
                          : 'outline'
                      }
                      className="text-[9px] mt-0.5"
                    >
                      {selectedItem.abc_class === 'high_control'
                        ? t('inventory.abc.highControlShort')
                        : selectedItem.abc_class === 'frequent_monitoring'
                        ? t('inventory.abc.frequentShort')
                        : t('inventory.abc.routineShort')}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-stone-400 block text-[10px]">{t('purchases.createRequest.thirtyDayUsage')}</span>
                    <span className="font-bold font-mono text-stone-800">
                      {formatNumber((usage30dMap && (usage30dMap[selectedItem.id] || usage30dMap[selectedItem.item_id])) || 0)} {selectedItem.unit_symbol || selectedItem.unit?.symbol || ''}
                    </span>
                  </div>
                </div>

                {/* Brand Selection Chips */}
                {availableBrands.length > 1 && (
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      {t('purchases.createRequest.selectBrand')}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {availableBrands.map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setSelectedBrand(b)}
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                            selectedBrand === b
                              ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                              : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                          }`}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unit & Quantity Input */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      {t('purchases.createRequest.unitMode')}
                    </label>
                    {availablePackagings.length > 0 ? (
                      <select
                        value={usePack ? (selectedPackUnit?.id || '') : 'base'}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'base') {
                            setUsePack(false);
                            setSelectedPackUnit(null);
                          } else {
                            const found = availablePackagings.find((p: any) => p.id === val);
                            setUsePack(true);
                            setSelectedPackUnit(found);
                          }
                        }}
                        className="w-full rounded-lg border border-stone-300 p-2 text-xs text-stone-900 bg-white"
                      >
                        <option value="base">{selectedItem.unit_symbol} (Base)</option>
                        {availablePackagings.map((pkg: any) => (
                          <option key={pkg.id} value={pkg.id}>
                            {pkg.pack_unit_name} ({pkg.pack_size_in_base_units} {selectedItem.unit_symbol})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="p-2 border border-stone-200 rounded-lg bg-stone-50 font-bold text-stone-800">
                        {selectedItem.unit_symbol}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      {usePack ? t('purchases.createRequest.packQty') : t('purchases.createRequest.baseQty')}
                    </label>
                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      value={inputQuantity}
                      onChange={(e) => setInputQuantity(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 p-2 text-xs text-stone-900 focus:outline-none focus:border-amber-500 font-mono font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      {t('purchases.createRequest.preferredVendor')}
                    </label>
                    <select
                      value={selectedVendorId}
                      onChange={(e) => setSelectedVendorId(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 p-2 text-xs text-stone-900 bg-white"
                    >
                      <option value="">{t('purchases.createRequest.selectVendorPlaceholder')}</option>
                      {vendors.map((v: any) => (
                        <option key={v.vendor_id || v.id} value={v.vendor_id || v.id}>
                          {getLocalizedMasterName(v, locale) || v.vendor_name || v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Pre-submit Auto-Approval Indicator */}
                {currentEvaluation && (
                  <div
                    className={`p-3 rounded-lg border flex items-start justify-between gap-3 ${
                      currentEvaluation.isAuto
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {currentEvaluation.isAuto ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      )}
                      <div>
                        <span className="font-bold text-xs block">
                          {currentEvaluation.isAuto
                            ? t('purchases.createRequest.eligibleAutoApproved')
                            : t('purchases.createRequest.willRequireApproval')}
                        </span>
                        {!currentEvaluation.isAuto && currentEvaluation.reasons.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {currentEvaluation.reasons.map((r, i) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        )}
                        <span className="text-[11px] text-stone-500 block mt-1">
                          Est. Total: {formatINR(currentEvaluation.estimatedTotal)} ({formatNumber(currentEvaluation.baseQty)} {selectedItem.unit_symbol})
                        </span>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={handleAddLine}
                      className="bg-amber-700 hover:bg-amber-800 text-white shrink-0"
                    >
                      {t('purchases.createRequest.addItem')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Staged Lines List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-stone-800 text-xs">
                {t('purchases.createRequest.linesCount', { count: stagedLines.length })}
              </span>
              <span className="font-mono font-bold text-stone-900">
                Total: {formatINR(stagedLines.reduce((acc, l) => acc + l.estimated_total, 0))}
              </span>
            </div>

            {stagedLines.length === 0 ? (
              <div className="p-6 text-center text-stone-400 border border-dashed border-stone-200 rounded-xl bg-stone-50/50">
                <Layers className="h-6 w-6 mx-auto mb-1 text-stone-300" />
                <p>{t('purchases.createRequest.emptyLines')}</p>
              </div>
            ) : (
              <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
                {stagedLines.map((line, idx) => (
                  <div key={idx} className="p-3 bg-white flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-stone-900">{line.item_name}</span>
                        {line.brand_name && line.brand_name !== 'Generic' && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-stone-100 text-stone-700 border">
                            {line.brand_name}
                          </span>
                        )}
                        <Badge
                          variant={line.is_eligible_auto ? 'success' : 'warning'}
                          className="text-[9px]"
                        >
                          {line.is_eligible_auto ? 'Queue 2 (Auto)' : 'Queue 1 (Pending)'}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-stone-500 font-mono">
                        {line.pack_quantity
                          ? `${line.pack_quantity} ${line.pack_unit_snapshot} (${formatNumber(line.requested_quantity)} ${line.base_unit_symbol})`
                          : `${formatNumber(line.requested_quantity)} ${line.base_unit_symbol}`}
                        {line.preferred_vendor_name && ` • Vendor: ${line.preferred_vendor_name}`}
                      </div>
                      {!line.is_eligible_auto && line.routing_reasons.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {line.routing_reasons.map((r, ri) => (
                            <span key={ri} className="text-[9px] px-1 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono font-bold text-stone-900 text-xs">
                        {formatINR(line.estimated_total)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-200 bg-stone-50 flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            disabled={submitting || stagedLines.length === 0}
            className="bg-amber-700 hover:bg-amber-800 text-white gap-1.5"
          >
            {submitting ? t('purchases.createRequest.submitting') : t('purchases.createRequest.submitRequest')}
          </Button>
        </div>
      </div>
    </div>
  );
}
