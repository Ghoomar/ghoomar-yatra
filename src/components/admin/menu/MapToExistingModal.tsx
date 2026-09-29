'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { normalizeItemName } from '@/lib/petpooja/matcher';
import { Link2, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface MapToExistingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  sourceItem: {
    id?: string;
    name: string;
    price?: number;
  } | null;
  allItems: Array<{
    id: string;
    name: string;
    name_hi?: string | null;
    parent_category: string;
    category: string;
    needs_setup?: boolean;
    is_active?: boolean;
  }>;
}

export function MapToExistingModal({
  isOpen,
  onClose,
  onSuccess,
  sourceItem,
  allItems,
}: MapToExistingModalProps) {
  const { locale } = useI18n();

  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictData, setConflictData] = useState<{
    message: string;
    existingTarget?: any;
  } | null>(null);

  // Filter for valid canonical items (exclude unconfigured/Needs Setup items and self)
  const canonicalItems = useMemo(() => {
    return allItems.filter(
      (it) =>
        !it.needs_setup &&
        it.category &&
        it.category !== 'Uncategorized' &&
        it.id !== sourceItem?.id
    );
  }, [allItems, sourceItem]);

  // Smart pre-selection based on normalized name
  useEffect(() => {
    if (!isOpen || !sourceItem) return;

    setError(null);
    setConflictData(null);
    setSearchTerm('');

    const sourceNorm = normalizeItemName(sourceItem.name);
    const candidate = canonicalItems.find(
      (c) => normalizeItemName(c.name) === sourceNorm || c.name.toLowerCase() === sourceItem.name.toLowerCase()
    );

    if (candidate) {
      setSelectedTargetId(candidate.id);
    } else {
      setSelectedTargetId(canonicalItems[0]?.id || '');
    }
  }, [isOpen, sourceItem, canonicalItems]);

  const filteredCanonical = useMemo(() => {
    if (!searchTerm.trim()) return canonicalItems;
    const term = searchTerm.toLowerCase().trim();
    return canonicalItems.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.name_hi && c.name_hi.toLowerCase().includes(term)) ||
        c.category.toLowerCase().includes(term) ||
        c.parent_category.toLowerCase().includes(term)
    );
  }, [canonicalItems, searchTerm]);

  const selectedTarget = useMemo(() => {
    return canonicalItems.find((c) => c.id === selectedTargetId);
  }, [canonicalItems, selectedTargetId]);

  if (!isOpen || !sourceItem) return null;

  const handleMap = async (force: boolean = false) => {
    if (!selectedTargetId) {
      setError(locale === 'hi' ? 'कृपया लक्ष्य मेन्यू आइटम चुनें।' : 'Please select a canonical target item.');
      return;
    }

    setLoading(true);
    setError(null);
    if (!force) setConflictData(null);

    try {
      const res = await fetch('/api/admin/menu/map-to-existing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_item_id: sourceItem.id,
          source_item_name: sourceItem.name,
          target_menu_item_id: selectedTargetId,
          force,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.conflict) {
          setConflictData({
            message: data.error,
            existingTarget: data.existingTarget,
          });
          return;
        }
        throw new Error(data.error || 'Failed to map item');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-100/80 text-amber-700">
              <Link2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-sm">
                {locale === 'hi' ? 'मौजूदा मेन्यू आइटम से मैप करें' : 'Map to Existing Menu Item'}
              </h3>
              <p className="text-[11px] text-stone-500 mt-0.5">
                {locale === 'hi'
                  ? 'पेटपूजा के इस नाम को मौजूदा मुख्य मेन्यू आइटम के उपनाम (Alias) के रूप में जोड़ें'
                  : 'Link external Petpooja item name as an alias to a canonical Menu Master record'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 text-base font-bold p-1 rounded-md"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Conflict Warning Confirmation */}
          {conflictData && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-xs space-y-2">
              <div className="flex items-start gap-2 text-amber-900 font-semibold">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{locale === 'hi' ? 'उपनाम टकराव (Alias Conflict)' : 'Alias Mapping Conflict'}</span>
              </div>
              <p className="text-amber-800 text-[11px] leading-relaxed">
                {conflictData.message}
              </p>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleMap(true)}
                  disabled={loading}
                  className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-7"
                >
                  {locale === 'hi' ? 'पुष्टि करें और पुनः असाइन करें' : 'Confirm & Reassign'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConflictData(null)}
                  className="text-xs h-7"
                >
                  {locale === 'hi' ? 'रद्द करें' : 'Cancel'}
                </Button>
              </div>
            </div>
          )}

          {/* Source Item Card */}
          <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl space-y-1">
            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
              {locale === 'hi' ? 'पेटपूजा कच्चा नाम (स्रोत)' : 'Petpooja Item Name (Source)'}
            </span>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-stone-900">
                {sourceItem.name}
              </span>
              <span className="text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full">
                {locale === 'hi' ? 'सेटअप बाकी' : 'Needs Setup'}
              </span>
            </div>
          </div>

          {/* Mapping Arrow Indicator */}
          <div className="flex items-center justify-center text-stone-400">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-500 bg-stone-100 px-2.5 py-1 rounded-full border border-stone-200">
              <span>{locale === 'hi' ? 'मैप होगा' : 'Maps to Canonical'}</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </div>

          {/* Target Canonical Item Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-stone-700 block">
              {locale === 'hi' ? 'अधिकृत मेन्यू आइटम चुनें' : 'Select Canonical Menu Item'}
            </label>

            {/* Quick search input */}
            <input
              type="text"
              placeholder={locale === 'hi' ? 'आइटम का नाम खोजें...' : 'Search canonical item name...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-stone-200 px-3 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            />

            {/* Select element */}
            <select
              value={selectedTargetId}
              onChange={(e) => setSelectedTargetId(e.target.value)}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-white font-medium text-stone-900"
              size={5}
            >
              {filteredCanonical.map((item) => (
                <option key={item.id} value={item.id} className="py-1 px-2 cursor-pointer">
                  {item.name} {item.name_hi ? `(${item.name_hi})` : ''} — [{item.parent_category} / {item.category}]
                </option>
              ))}
            </select>
          </div>

          {/* Selected Preview Box */}
          {selectedTarget && (
            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-bold">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{locale === 'hi' ? 'चयनित अधिकृत आइटम:' : 'Selected Canonical Item:'}</span>
              </div>
              <div className="flex items-baseline justify-between pt-0.5">
                <span className="font-bold text-stone-900 text-sm">
                  {selectedTarget.name}
                </span>
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-300">
                  {selectedTarget.parent_category} → {selectedTarget.category}
                </span>
              </div>
            </div>
          )}

          {/* Explanation note */}
          <p className="text-[11px] text-stone-500 leading-relaxed italic">
            {locale === 'hi'
              ? 'मैप करने पर, यह नाम अधिकृत आइटम का Alias बन जाएगा, डुप्लीकेट रिकॉर्ड हट जाएगा, और सभी पिछली बिक्री रिपोर्टें अपने आप सही श्रेणी में वर्गीकृत हो जाएंगी।'
              : 'Mapping will record this name as an authoritative POS alias, eliminate the redundant Needs Setup item, and retroactively classify all past and future sales to this canonical category.'}
          </p>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
            <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
              {locale === 'hi' ? 'रद्द करें' : 'Cancel'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleMap(false)}
              disabled={loading || !selectedTargetId}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {loading ? (locale === 'hi' ? 'सहेज रहे हैं...' : 'Mapping...') : (locale === 'hi' ? 'मैप करें और सहेजें' : 'Map as Alias & Resolve')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
