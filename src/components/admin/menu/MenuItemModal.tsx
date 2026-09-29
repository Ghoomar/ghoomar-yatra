'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';
import { AlertCircle, Link2 } from 'lucide-react';

import { BilingualNameInput } from '@/components/admin/BilingualNameInput';

interface MenuItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onMapToExisting?: (item: { id?: string; name: string; price?: number }) => void;
  categories: Array<{
    id: string;
    name: string;
    name_hi?: string | null;
    parent_category_id?: string;
    parent_category_name: string;
    parent_category_name_hi?: string | null;
  }>;
  parents?: Array<{ id: string; name: string; name_hi?: string | null; color?: string | null }>;
  item?: {
    id: string;
    name: string;
    name_hi?: string | null;
    name_hi_is_custom?: boolean;
    needs_setup?: boolean;
    category_id: string;
    category: string;
    parent_category: string;
    price: number;
    gst_percent: number;
    tax_type: string;
    is_active: boolean;
    aliases?: string[];
  } | null;
}

export function MenuItemModal({
  isOpen,
  onClose,
  onSuccess,
  onMapToExisting,
  categories,
  parents = [],
  item,
}: MenuItemModalProps) {
  const { locale } = useI18n();
  const [name, setName] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [isCustomHindi, setIsCustomHindi] = useState(false);
  const [selectedParent, setSelectedParent] = useState<string>('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState<number | string>(0);
  const [isActive, setIsActive] = useState(true);
  const [aliasInput, setAliasInput] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictItem, setConflictItem] = useState<{ id: string; name: string } | null>(null);

  // Compute parent items with localization
  const parentList = React.useMemo(() => {
    if (parents.length > 0) {
      return parents.map((p) => ({ name: p.name, name_hi: p.name_hi }));
    }
    const map = new Map<string, { name: string; name_hi?: string | null }>();
    categories.forEach((c) => {
      if (c.parent_category_name && !map.has(c.parent_category_name)) {
        map.set(c.parent_category_name, {
          name: c.parent_category_name,
          name_hi: c.parent_category_name_hi,
        });
      }
    });
    return Array.from(map.values());
  }, [parents, categories]);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setNameHi(item.name_hi || '');
      setIsCustomHindi(Boolean(item.name_hi_is_custom));
      const matchedCat = categories.find((c) => c.id === item.category_id || c.name === item.category);
      const parentCandidate = matchedCat?.parent_category_name || (item.parent_category && item.parent_category !== 'Uncategorized' ? item.parent_category : '') || parentList[0]?.name || '';
      setSelectedParent(parentCandidate);
      const initialCatId = matchedCat?.id || item.category_id || categories.find((c) => c.parent_category_name === parentCandidate)?.id || categories[0]?.id || '';
      setCategoryId(initialCatId);
      setPrice(item.price !== undefined ? item.price : 0);
      setIsActive(item.is_active !== false);
      setAliases(item.aliases || []);
    } else {
      setName('');
      setNameHi('');
      setIsCustomHindi(false);
      const defaultParent = parentList[0]?.name || '';
      setSelectedParent(defaultParent);
      const firstCatInParent = categories.find((c) => c.parent_category_name === defaultParent) || categories[0];
      setCategoryId(firstCatInParent?.id || '');
      setPrice(0);
      setIsActive(true);
      setAliases([]);
    }
    setAliasInput('');
    setError(null);
    setConflictItem(null);
  }, [item, categories, parentList, isOpen]);

  const availableCategories = React.useMemo(() => {
    if (!selectedParent) return categories;
    return categories.filter((c) => c.parent_category_name === selectedParent);
  }, [categories, selectedParent]);

  const handleParentChange = (newParent: string) => {
    setSelectedParent(newParent);
    const matching = categories.filter((c) => c.parent_category_name === newParent);
    if (matching.length > 0 && !matching.some((c) => c.id === categoryId)) {
      setCategoryId(matching[0].id);
    }
  };

  const handleCategoryChange = (newCatId: string) => {
    setCategoryId(newCatId);
    const matched = categories.find((c) => c.id === newCatId);
    if (matched?.parent_category_name) {
      setSelectedParent(matched.parent_category_name);
    }
  };

  if (!isOpen) return null;

  const handleAddAlias = () => {
    if (aliasInput.trim() && !aliases.includes(aliasInput.trim())) {
      setAliases([...aliases, aliasInput.trim()]);
      setAliasInput('');
    }
  };

  const handleRemoveAlias = (aliasToRemove: string) => {
    setAliases(aliases.filter((a) => a !== aliasToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(locale === 'hi' ? 'कृपया आइटम का नाम भरें।' : 'Please provide an Item Name.');
      return;
    }
    if (!categoryId) {
      setError(locale === 'hi' ? 'कृपया श्रेणी चुनें।' : 'Please select a Category.');
      return;
    }

    setLoading(true);
    setError(null);
    setConflictItem(null);

    try {
      const url = '/api/admin/menu/items';
      const method = item ? 'PUT' : 'POST';
      const payload: any = {
        name: name.trim(),
        name_hi: nameHi && nameHi.trim() ? nameHi.trim() : null,
        name_hi_is_custom: isCustomHindi,
        category_id: categoryId,
        price: Number(price) || 0,
        is_active: isActive,
        aliases,
      };
      if (item) {
        payload.id = item.id;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        if (res.status === 409 && json.existingItem) {
          setConflictItem(json.existingItem);
          setError(json.error);
          return;
        }
        throw new Error(json.error || (locale === 'hi' ? 'आइटम सहेजने में विफल।' : 'Failed to save menu item.'));
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
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div>
            <h3 className="font-bold text-stone-900 text-sm">
              {item
                ? locale === 'hi' ? 'मेन्यू आइटम संपादित करें' : 'Edit Menu Item'
                : locale === 'hi' ? 'नया मेन्यू आइटम' : 'New Menu Item'}
            </h3>
            <p className="text-[11px] text-stone-500 mt-0.5">
              {locale === 'hi' ? 'अधिकृत मेन्यू सूची एवं पेटपूजा मैपिंग' : 'Authoritative catalogue & Petpooja mapping'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 text-base font-bold p-1 rounded-md"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">{error}</p>
                  {conflictItem && onMapToExisting && (
                    <p className="text-[11px] text-amber-800">
                      {locale === 'hi'
                        ? 'क्या आप इसे अलग आइटम बनाने के बजाय मौजूदा अधिकृत आइटम से जोड़ना चाहते हैं?'
                        : 'Would you like to map this item as an alias to the existing canonical item instead of creating a duplicate?'}
                    </p>
                  )}
                </div>
              </div>
              {conflictItem && onMapToExisting && (
                <div className="pt-1 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const src = item || { name: name.trim(), price: Number(price) || 0 };
                      onClose();
                      onMapToExisting(src);
                    }}
                    className="text-amber-800 border-amber-300 hover:bg-amber-100/80 text-xs flex items-center gap-1.5"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    <span>
                      {locale === 'hi'
                        ? `"${conflictItem.name}" से मैप करें`
                        : `Map to "${conflictItem.name}"`}
                    </span>
                  </Button>
                </div>
              )}
            </div>
          )}

          <BilingualNameInput
            englishName={name}
            onChangeEnglish={setName}
            hindiName={nameHi}
            onChangeHindi={(val, custom) => {
              setNameHi(val);
              if (custom !== undefined) setIsCustomHindi(custom);
            }}
            isCustomHindi={isCustomHindi}
            onCustomHindiChange={setIsCustomHindi}
            entityType="menu_item"
            englishLabel={locale === 'hi' ? 'आइटम का नाम (अंग्रेज़ी)' : 'Item Name (English)'}
            hindiLabel={locale === 'hi' ? 'आइटम का नाम (हिंदी / देवनागरी)' : 'Item Name (Hindi)'}
            placeholderEnglish="e.g. Punjabi Special Thali, Dal Makhani"
            placeholderHindi="उदा. पंजाबी स्पेशल थाली, दाल मखनी"
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                {locale === 'hi' ? 'मूल श्रेणी' : 'Parent Category'} <span className="text-rose-500">*</span>
              </label>
              <select
                value={selectedParent}
                onChange={(e) => handleParentChange(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30 font-medium"
                required
              >
                <option value="">{locale === 'hi' ? 'मूल श्रेणी चुनें' : 'Select Parent'}</option>
                {parentList.map((p) => (
                  <option key={p.name} value={p.name}>
                    {getLocalizedMasterName(p, locale)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                {locale === 'hi' ? 'उप-श्रेणी' : 'Category'} <span className="text-rose-500">*</span>
              </label>
              <select
                value={categoryId}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30 font-medium"
                required
              >
                <option value="">{locale === 'hi' ? 'श्रेणी चुनें' : 'Select Category'}</option>
                {availableCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {getLocalizedMasterName(c, locale)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                {locale === 'hi' ? 'मेन्यू मूल्य (₹)' : 'Menu Price (₹)'} <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30 font-mono font-semibold"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                {locale === 'hi' ? 'जीएसटी दर' : 'GST Rate'}
              </label>
              <div className="rounded-xl border border-stone-200 px-3 py-2 text-xs bg-stone-100 text-stone-700 font-semibold">
                {locale === 'hi' ? '5.0% (मानक)' : '5.0% (Standard)'}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                {locale === 'hi' ? 'टैक्स प्रकार' : 'Tax Type'}
              </label>
              <div className="rounded-xl border border-stone-200 px-3 py-2 text-xs bg-stone-100 text-stone-700 font-semibold truncate">
                {locale === 'hi' ? 'फॉरवर्ड टैक्स' : 'Forward Tax'}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              {locale === 'hi' ? 'पेटपूजा पीओएस अन्य नाम' : 'Petpooja POS Aliases'}
            </label>
            <p className="text-[11px] text-stone-400 mb-1.5">
              {locale === 'hi'
                ? 'पेटपूजा पीओएस में इस आइटम के वैकल्पिक नाम (उदा. "Extra Bati (1)", "coldrink")'
                : 'Alternate names that Petpooja POS exports for this item (e.g. "Extra Bati (1)", "coldrink")'}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddAlias();
                  }
                }}
                placeholder={locale === 'hi' ? 'उपनाम दर्ज करें और जोड़ें दबाएं...' : 'Enter alias & press Add...'}
                className="flex-1 rounded-xl border border-stone-200 px-3 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30"
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddAlias}>
                {locale === 'hi' ? 'उपनाम जोड़ें' : 'Add Alias'}
              </Button>
            </div>

            {aliases.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {aliases.map((al) => (
                  <span
                    key={al}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium"
                  >
                    <span>{al}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAlias(al)}
                      className="text-amber-500 hover:text-amber-800 font-bold ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded text-amber-600 focus:ring-amber-500 h-4 w-4"
              />
              <span>{locale === 'hi' ? 'मेन्यू मास्टर में सक्रिय' : 'Active in Menu Master'}</span>
            </label>
          </div>

          <div className="pt-3 border-t border-stone-100 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading}>
              {locale === 'hi' ? 'रद्द करें' : 'Cancel'}
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={loading}>
              {loading
                ? locale === 'hi' ? 'सहेजा जा रहा है...' : 'Saving...'
                : item
                ? locale === 'hi' ? 'आइटम अपडेट करें' : 'Update Item'
                : locale === 'hi' ? 'आइटम बनाएं' : 'Create Item'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
