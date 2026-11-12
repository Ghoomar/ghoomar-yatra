'use client';

import React, { useState, useMemo } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { GitMerge, AlertCircle, CheckCircle2, Search, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface ManualMenuMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  allItems: Array<{
    id: string;
    name: string;
    name_hi?: string | null;
    parent_category?: string;
    category?: string;
    product_type?: string;
    needs_setup?: boolean;
    is_active?: boolean;
    price?: number;
  }>;
  initialSourceItem?: any;
}

export function ManualMenuMergeModal({
  isOpen,
  onClose,
  onSuccess,
  allItems,
  initialSourceItem,
}: ManualMenuMergeModalProps) {
  const { locale } = useI18n();

  const [targetId, setTargetId] = useState<string>('');
  const [sourceId, setSourceId] = useState<string>(initialSourceItem?.id || '');
  const [targetSearch, setTargetSearch] = useState<string>('');
  const [sourceSearch, setSourceSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialSourceItem?.id) {
      setSourceId(initialSourceItem.id);
    }
  }, [initialSourceItem]);

  const activeItems = useMemo(() => {
    return allItems.filter((i) => i.is_active);
  }, [allItems]);

  const filteredTargets = useMemo(() => {
    const term = targetSearch.toLowerCase().trim();
    return activeItems
      .filter((i) => i.id !== sourceId)
      .filter((i) => !term || i.name.toLowerCase().includes(term) || (i.category && i.category.toLowerCase().includes(term)))
      .slice(0, 30);
  }, [activeItems, sourceId, targetSearch]);

  const filteredSources = useMemo(() => {
    const term = sourceSearch.toLowerCase().trim();
    return allItems
      .filter((i) => i.id !== targetId)
      .filter((i) => !term || i.name.toLowerCase().includes(term) || (i.category && i.category.toLowerCase().includes(term)))
      .slice(0, 30);
  }, [allItems, targetId, sourceSearch]);

  const targetItem = useMemo(() => allItems.find((i) => i.id === targetId), [allItems, targetId]);
  const sourceItem = useMemo(() => allItems.find((i) => i.id === sourceId), [allItems, sourceId]);

  if (!isOpen) return null;

  const handleMerge = async () => {
    if (!targetId || !sourceId) {
      setError(locale === 'hi' ? 'कृपया लक्ष्य और स्रोत मेन्यू आइटम दोनों चुनें।' : 'Please select both Target and Source menu items.');
      return;
    }

    if (targetId === sourceId) {
      setError(locale === 'hi' ? 'लक्ष्य और स्रोत एक ही आइटम नहीं हो सकते।' : 'Target and source cannot be the same item.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/menu/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_menu_item_id: targetId,
          source_menu_item_ids: [sourceId],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to merge menu items');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-stone-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <GitMerge className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                {locale === 'hi' ? 'मैनुअल मेनू आइटम विलय (Merge)' : 'Manual Menu Item Merge'}
              </h2>
              <p className="text-xs text-stone-500">
                {locale === 'hi'
                  ? 'अतिरिक्त या डुप्लिकेट मेनू आइटम को मुख्य आइटम में मिलाएं (उपनाम और बिक्री सुरक्षित रहेंगे)'
                  : 'Safely merge duplicate or secondary menu items into a canonical target'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 rounded-lg p-1 hover:bg-stone-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2 text-xs text-blue-800">
            <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              {locale === 'hi'
                ? 'विलय के बाद: स्रोत आइटम निष्क्रिय हो जाएगा, उसके उपनाम (aliases), मैपिंग और कॉम्बो लक्ष्य आइटम को पुनः असाइन हो जाएंगे।'
                : 'Merge outcome: The source item will be deactivated. Its POS aliases, external mappings, and combo compositions will repoint to the target item.'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Source Selection */}
            <div className="space-y-2 border border-stone-200 p-3 rounded-xl bg-stone-50/40">
              <label className="text-xs font-bold text-stone-700 block">
                {locale === 'hi' ? 'स्रोत आइटम (जो निष्क्रिय होगा)' : '1. Source Item (Deactivated)'}
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  placeholder={locale === 'hi' ? 'स्रोत खोजें...' : 'Search source item...'}
                  value={sourceSearch}
                  onChange={(e) => setSourceSearch(e.target.value)}
                  className="w-full text-xs rounded-lg border border-stone-200 pl-8 pr-3 py-1.5 bg-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="max-h-44 overflow-y-auto space-y-1 divide-y divide-stone-100 border border-stone-200 rounded-lg bg-white p-1">
                {filteredSources.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSourceId(item.id)}
                    className={`w-full text-left p-2 rounded text-xs transition-colors flex items-center justify-between ${
                      sourceId === item.id ? 'bg-amber-100 font-bold text-amber-900' : 'hover:bg-stone-50 text-stone-800'
                    }`}
                  >
                    <div className="truncate pr-2">
                      <div className="truncate">{item.name}</div>
                      <div className="text-[10px] text-stone-500">{item.category || 'Uncategorized'} • {item.product_type || 'INDIVIDUAL_DISH'}</div>
                    </div>
                    {sourceId === item.id && <CheckCircle2 className="h-4 w-4 text-amber-700 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Target Selection */}
            <div className="space-y-2 border border-emerald-200 p-3 rounded-xl bg-emerald-50/20">
              <label className="text-xs font-bold text-emerald-800 block">
                {locale === 'hi' ? 'लक्ष्य आइटम (जो सक्रिय रहेगा)' : '2. Target Item (Preserved Canonical)'}
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  placeholder={locale === 'hi' ? 'लक्ष्य खोजें...' : 'Search target item...'}
                  value={targetSearch}
                  onChange={(e) => setTargetSearch(e.target.value)}
                  className="w-full text-xs rounded-lg border border-stone-200 pl-8 pr-3 py-1.5 bg-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="max-h-44 overflow-y-auto space-y-1 divide-y divide-stone-100 border border-stone-200 rounded-lg bg-white p-1">
                {filteredTargets.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTargetId(item.id)}
                    className={`w-full text-left p-2 rounded text-xs transition-colors flex items-center justify-between ${
                      targetId === item.id ? 'bg-emerald-100 font-bold text-emerald-900' : 'hover:bg-stone-50 text-stone-800'
                    }`}
                  >
                    <div className="truncate pr-2">
                      <div className="truncate">{item.name}</div>
                      <div className="text-[10px] text-stone-500">{item.category || 'Uncategorized'} • {item.product_type || 'INDIVIDUAL_DISH'}</div>
                    </div>
                    {targetId === item.id && <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Merge Preview summary */}
          {sourceItem && targetItem && (
            <div className="p-3 bg-stone-100 rounded-xl text-xs flex items-center justify-between">
              <div className="truncate">
                <span className="font-semibold text-stone-700">{sourceItem.name}</span>
                <span className="text-[10px] text-stone-500 ml-1">({sourceItem.product_type})</span>
              </div>
              <ArrowRight className="h-4 w-4 text-amber-600 shrink-0 mx-2" />
              <div className="truncate text-right">
                <span className="font-semibold text-emerald-800">{targetItem.name}</span>
                <span className="text-[10px] text-emerald-600 ml-1">({targetItem.product_type})</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-100 bg-stone-50/50 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            {locale === 'hi' ? 'रद्द करें' : 'Cancel'}
          </Button>
          <Button
            size="sm"
            onClick={handleMerge}
            disabled={loading || !targetId || !sourceId}
            className="bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center gap-1.5"
          >
            {loading ? (
              <span>{locale === 'hi' ? 'विलय हो रहा है...' : 'Merging...'}</span>
            ) : (
              <>
                <GitMerge className="h-4 w-4" />
                <span>{locale === 'hi' ? 'विलय की पुष्टि करें' : 'Confirm Merge'}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
