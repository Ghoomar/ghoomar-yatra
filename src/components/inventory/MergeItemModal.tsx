'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';
import { filterInventoryItems } from '@/lib/inventory/search';
import { formatINR } from '@/lib/utils';
import { X, GitMerge, AlertTriangle, ArrowRight, CheckCircle2, Search, Loader2 } from 'lucide-react';

interface MergeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceItem: any;
  items: any[];
  aliases?: any[];
  onMerged?: (result: any) => void;
}

export function MergeItemModal({
  isOpen,
  onClose,
  sourceItem,
  items,
  aliases = [],
  onMerged,
}: MergeItemModalProps) {
  const { t, locale } = useI18n();

  const [targetSearch, setTargetSearch] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [merging, setMerging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Build aliases map for search
  const aliasesMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    aliases.forEach((a) => {
      if (a.item_id) {
        if (!map[a.item_id]) map[a.item_id] = [];
        if (a.alias && !map[a.item_id].includes(a.alias)) map[a.item_id].push(a.alias);
      }
      if (a.group_id) {
        if (!map[a.group_id]) map[a.group_id] = [];
        if (a.alias && !map[a.group_id].includes(a.alias)) map[a.group_id].push(a.alias);
      }
    });
    return map;
  }, [aliases]);

  // Filter possible target items (exclude source item itself)
  const candidateItems = useMemo(() => {
    if (!sourceItem) return [];
    const sourceId = sourceItem.id || sourceItem.item_id;
    const filtered = items.filter((it) => {
      const itId = it.id || it.item_id;
      return itId !== sourceId && it.is_active !== false;
    });

    if (!targetSearch.trim()) return filtered.slice(0, 15);
    return filterInventoryItems(filtered, targetSearch, aliasesMap).slice(0, 20);
  }, [items, sourceItem, targetSearch, aliasesMap]);

  const selectedTarget = useMemo(() => {
    if (!selectedTargetId) return null;
    return items.find((it) => (it.id || it.item_id) === selectedTargetId) || null;
  }, [items, selectedTargetId]);

  // Preview calculations
  const preview = useMemo(() => {
    if (!sourceItem || !selectedTarget) return null;

    const srcStock = Number(sourceItem.current_stock ?? sourceItem.current_quantity ?? 0);
    const srcWac = Number(sourceItem.current_weighted_average_cost ?? sourceItem.weighted_average_cost ?? 0);

    const tgtStock = Number(selectedTarget.current_stock ?? selectedTarget.current_quantity ?? 0);
    const tgtWac = Number(selectedTarget.current_weighted_average_cost ?? selectedTarget.weighted_average_cost ?? 0);

    const consolidatedStock = srcStock + tgtStock;
    let consolidatedWac = tgtWac;

    if (consolidatedStock > 0) {
      if (tgtStock <= 0 || tgtWac <= 0) {
        consolidatedWac = srcWac;
      } else {
        consolidatedWac = ((tgtStock * tgtWac) + (srcStock * srcWac)) / consolidatedStock;
      }
    }

    return {
      srcStock,
      srcWac,
      tgtStock,
      tgtWac,
      consolidatedStock,
      consolidatedWac,
    };
  }, [sourceItem, selectedTarget]);

  if (!isOpen || !sourceItem) return null;

  const handleExecuteMerge = async () => {
    if (!selectedTargetId) {
      alert(t('inventory.merge.selectTargetWarning'));
      return;
    }

    const sourceId = sourceItem.id || sourceItem.item_id;
    const confirmText = t('inventory.merge.confirmPrompt', {
      source: `${sourceItem.name} (${sourceItem.item_code})`,
      target: `${selectedTarget.name} (${selectedTarget.item_code})`,
    });

    if (!window.confirm(confirmText)) return;

    setMerging(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/inventory/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_item_id: sourceId,
          target_item_id: selectedTargetId,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || t('inventory.merge.failed'));
      }

      alert(t('inventory.merge.successNotice', {
        source: sourceItem.item_code,
        target: selectedTarget.item_code,
      }));

      if (onMerged) {
        onMerged(json.result);
      }
      onClose();
    } catch (err: any) {
      console.error('Merge error:', err);
      setErrorMessage(err.message || t('inventory.merge.failed'));
    } finally {
      setMerging(false);
    }
  };

  const srcCode = sourceItem.item_code || 'ITEM';
  const srcName = (locale === 'hi' && sourceItem.name_hi) ? sourceItem.name_hi : sourceItem.name;
  const srcUnit = sourceItem.unit_symbol || sourceItem.unit?.symbol || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-xl rounded-xl bg-white shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-100 text-amber-800">
              <GitMerge className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                {t('inventory.merge.modalTitle')}
              </h2>
              <p className="text-xs text-stone-500">
                {t('inventory.merge.modalSubtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/60"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Warning Notice */}
          <div className="p-3 bg-amber-50/80 rounded-lg border border-amber-200/70 text-amber-900 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold">{t('inventory.merge.permanentNoticeTitle')}</div>
              <p className="text-stone-600 leading-relaxed">
                {t('inventory.merge.permanentNoticeDesc')}
              </p>
            </div>
          </div>

          {/* Source Item Card */}
          <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">
                {t('inventory.merge.sourceItemHeader')} ({t('inventory.merge.willBeDeactivated')})
              </span>
              <Badge variant="outline" className="font-mono">{srcCode}</Badge>
            </div>
            <div className="text-sm font-bold text-stone-900">{srcName}</div>
            <div className="grid grid-cols-2 gap-2 text-stone-600 text-[11px]">
              <div>
                {t('inventory.merge.currentStock')}: <span className="font-semibold text-stone-900">{sourceItem.current_stock ?? sourceItem.current_quantity ?? 0} {srcUnit}</span>
              </div>
              <div>
                {t('inventory.merge.currentWac')}: <span className="font-semibold text-stone-900">{formatINR(Number(sourceItem.current_weighted_average_cost ?? sourceItem.weighted_average_cost ?? 0))}/{srcUnit}</span>
              </div>
            </div>
          </div>

          {/* Target Selector */}
          <div className="space-y-2">
            <label className="block font-semibold text-stone-800">
              {t('inventory.merge.selectTargetLabel')}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
              <input
                type="text"
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
                placeholder={t('inventory.merge.searchTargetPlaceholder')}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-xs text-stone-900 focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Candidate List */}
            <div className="max-h-40 overflow-y-auto border border-stone-200 rounded-lg divide-y divide-stone-100 bg-white">
              {candidateItems.length === 0 ? (
                <div className="p-3 text-center text-stone-400">
                  {t('inventory.merge.noCandidatesFound')}
                </div>
              ) : (
                candidateItems.map((c) => {
                  const cId = c.id || c.item_id;
                  const isSelected = selectedTargetId === cId;
                  const cName = (locale === 'hi' && c.name_hi) ? c.name_hi : c.name;
                  const cUnit = c.unit_symbol || c.unit?.symbol || '';
                  const cStock = c.current_stock ?? c.current_quantity ?? 0;
                  const cWac = Number(c.current_weighted_average_cost ?? c.weighted_average_cost ?? 0);

                  return (
                    <button
                      key={cId}
                      type="button"
                      onClick={() => setSelectedTargetId(cId)}
                      className={`w-full p-2.5 text-left flex items-center justify-between hover:bg-stone-50 transition-colors ${
                        isSelected ? 'bg-amber-50/80 border-l-4 border-amber-600' : ''
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-stone-500">{c.item_code}</span>
                          <span className="font-semibold text-stone-900">{cName}</span>
                          {c.brand_name && c.brand_name !== 'Generic' && (
                            <span className="text-[10px] text-amber-700 bg-amber-50 px-1 rounded">({c.brand_name})</span>
                          )}
                        </div>
                        <div className="text-[10px] text-stone-500 mt-0.5">
                          {t('inventory.merge.stock')}: {cStock} {cUnit} • {formatINR(cWac)}/{cUnit}
                        </div>
                      </div>
                      {isSelected && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Merge Result Preview */}
          {selectedTarget && preview && (
            <div className="p-3.5 bg-emerald-50/70 rounded-xl border border-emerald-200 space-y-2">
              <div className="flex items-center gap-1.5 text-emerald-800 font-bold">
                <ArrowRight className="h-4 w-4" />
                <span>{t('inventory.merge.previewHeader')}</span>
              </div>
              <div className="text-xs text-emerald-950 font-semibold">
                {selectedTarget.name} ({selectedTarget.item_code})
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-emerald-200/60">
                <div>
                  <span className="text-stone-600">{t('inventory.merge.consolidatedStock')}:</span>{' '}
                  <strong className="text-emerald-900">{preview.consolidatedStock.toFixed(3)} {srcUnit}</strong>
                  <div className="text-[10px] text-stone-500">
                    ({preview.tgtStock} tgt + {preview.srcStock} src)
                  </div>
                </div>
                <div>
                  <span className="text-stone-600">{t('inventory.merge.newMovingWac')}:</span>{' '}
                  <strong className="text-emerald-900">{formatINR(preview.consolidatedWac)}/{srcUnit}</strong>
                </div>
              </div>
              <div className="text-[10px] text-stone-500 pt-1">
                ↳ {t('inventory.merge.autoAliasExplanation', { name: srcName })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-6 py-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={merging}>
            {t('inventory.merge.cancel')}
          </Button>
          <Button
            type="button"
            variant="amber"
            onClick={handleExecuteMerge}
            disabled={!selectedTargetId || merging}
            className="gap-1.5"
          >
            {merging ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t('inventory.merge.merging')}</span>
              </>
            ) : (
              <>
                <GitMerge className="h-3.5 w-3.5" />
                <span>{t('inventory.merge.executeMergeBtn')}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
