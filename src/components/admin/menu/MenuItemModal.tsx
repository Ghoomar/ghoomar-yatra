'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';
import { AlertCircle, Link2, UtensilsCrossed, GitMerge } from 'lucide-react';

import { BilingualNameInput } from '@/components/admin/BilingualNameInput';

interface MenuItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onMapToExisting?: (item: { id?: string; name: string; price?: number }) => void;
  onMerge?: (item: any) => void;
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
    product_type?: string;
    aliases?: string[];
    canonical_dish_id?: string | null;
    serving_configuration_id?: string | null;
  } | null;
}

export function MenuItemModal({
  isOpen,
  onClose,
  onSuccess,
  onMapToExisting,
  onMerge,
  categories,
  parents = [],
  item,
}: MenuItemModalProps) {
  const { locale } = useI18n();
  const [name, setName] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [isCustomHindi, setIsCustomHindi] = useState(false);
  const [productType, setProductType] = useState('INDIVIDUAL_DISH');
  const [selectedParent, setSelectedParent] = useState<string>('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState<number | string>(0);
  const [isActive, setIsActive] = useState(true);
  const [aliasInput, setAliasInput] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [canonicalDishes, setCanonicalDishes] = useState<any[]>([]);
  const [canonicalDishId, setCanonicalDishId] = useState<string>('');
  const [servingConfigId, setServingConfigId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictItem, setConflictItem] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/sops/dishes')
      .then((res) => (res.ok ? res.json() : { dishes: [] }))
      .then((data) => {
        if (data.dishes) {
          setCanonicalDishes(data.dishes.filter((d: any) => d.category !== 'PREPARATION'));
        }
      })
      .catch(() => {});
  }, [isOpen]);

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
      setProductType(item.product_type || 'INDIVIDUAL_DISH');
      const matchedCat = categories.find((c) => c.id === item.category_id || c.name === item.category);
      const parentCandidate = matchedCat?.parent_category_name || (item.parent_category && item.parent_category !== 'Uncategorized' ? item.parent_category : '') || parentList[0]?.name || '';
      setSelectedParent(parentCandidate);
      const initialCatId = matchedCat?.id || item.category_id || categories.find((c) => c.parent_category_name === parentCandidate)?.id || categories[0]?.id || '';
      setCategoryId(initialCatId);
      setPrice(item.price !== undefined ? item.price : 0);
      setIsActive(item.is_active !== false);
      setAliases(item.aliases || []);
      setCanonicalDishId(item.canonical_dish_id || '');
      setServingConfigId(item.serving_configuration_id || '');
    } else {
      setName('');
      setNameHi('');
      setIsCustomHindi(false);
      setProductType('INDIVIDUAL_DISH');
      const defaultParent = parentList[0]?.name || '';
      setSelectedParent(defaultParent);
      const firstCatInParent = categories.find((c) => c.parent_category_name === defaultParent) || categories[0];
      setCategoryId(firstCatInParent?.id || '');
      setPrice(0);
      setIsActive(true);
      setAliases([]);
      setCanonicalDishId('');
      setServingConfigId('');
    }
    setAliasInput('');
    setError(null);
    setConflictItem(null);
  }, [item, categories, parentList, isOpen]);

  const selectedDish = React.useMemo(() => {
    return canonicalDishes.find((d) => d.id === canonicalDishId);
  }, [canonicalDishes, canonicalDishId]);

  const availableConfigs = React.useMemo(() => {
    return selectedDish?.configurations || [];
  }, [selectedDish]);

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
        product_type: productType,
        category_id: categoryId,
        price: Number(price) || 0,
        is_active: isActive,
        aliases,
        canonical_dish_id: productType === 'INDIVIDUAL_DISH' && canonicalDishId ? canonicalDishId : null,
        serving_configuration_id: productType === 'INDIVIDUAL_DISH' && servingConfigId ? servingConfigId : null,
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

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              {locale === 'hi' ? 'उत्पाद प्रकार (Product Type)' : 'Product Type'} <span className="text-rose-500">*</span>
            </label>
            <select
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30 font-medium"
            >
              <option value="INDIVIDUAL_DISH">{locale === 'hi' ? 'एकल डिश (Individual Dish)' : 'Individual Dish'}</option>
              <option value="COMBO">{locale === 'hi' ? 'कॉम्बो (Combo)' : 'Combo'}</option>
              <option value="THALI">{locale === 'hi' ? 'थाली (Thali)' : 'Thali'}</option>
              <option value="STANDALONE_PURCHASED">{locale === 'hi' ? 'तैयार/पैकेज्ड उत्पाद (Retail/Packaged)' : 'Standalone Purchased (Retail/Packaged)'}</option>
            </select>
          </div>

          {productType === 'INDIVIDUAL_DISH' && (
            <div className="bg-[#FAF8F5] border border-[#E7E2D8] rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <UtensilsCrossed className="h-3.5 w-3.5 text-amber-600" />
                  {locale === 'hi' ? 'संबद्ध रेसिपी डिश (4-टियर)' : 'Linked 4-Tier SOP Dish'}
                </label>
                <span className="text-[10px] text-stone-400">Direct SOP link</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-stone-600 mb-1">
                    {locale === 'hi' ? 'कैनोनिकल डिश' : 'Canonical Dish'}
                  </label>
                  <select
                    value={canonicalDishId}
                    onChange={(e) => {
                      const newDishId = e.target.value;
                      setCanonicalDishId(newDishId);
                      const d = canonicalDishes.find((cd) => cd.id === newDishId);
                      setServingConfigId(d?.configurations?.[0]?.id || '');
                    }}
                    className="w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs bg-white text-stone-900 cursor-pointer"
                  >
                    <option value="">{locale === 'hi' ? '-- कोई डिश नहीं --' : '-- None / Unlinked --'}</option>
                    {canonicalDishes.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.name_hi ? `(${d.name_hi})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-600 mb-1">
                    {locale === 'hi' ? 'सर्विंग कॉन्फ़िगरेशन' : 'Serving Config'}
                  </label>
                  <select
                    value={servingConfigId}
                    onChange={(e) => setServingConfigId(e.target.value)}
                    disabled={!canonicalDishId || availableConfigs.length === 0}
                    className="w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs bg-white text-stone-900 disabled:opacity-50 cursor-pointer"
                  >
                    <option value="">{locale === 'hi' ? '-- मानक --' : '-- Standard Portion --'}</option>
                    {availableConfigs.map((cfg: any) => (
                      <option key={cfg.id} value={cfg.id}>
                        {cfg.name} ({cfg.portion_size_quantity} {cfg.portion_size_unit})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

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

          <div className="pt-3 border-t border-stone-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {item && onMerge && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onClose();
                    onMerge(item);
                  }}
                  className="text-amber-800 border-amber-300 hover:bg-amber-50 text-xs flex items-center gap-1.5 cursor-pointer"
                  title={locale === 'hi' ? 'अन्य अधिकृत आइटम में मिलाएं' : 'Merge item into target'}
                >
                  <GitMerge className="h-3.5 w-3.5 text-amber-700" />
                  <span>{locale === 'hi' ? 'आइटम मिलाएं' : 'Merge'}</span>
                </Button>
              )}
              {item && onMapToExisting && (item.needs_setup || item.category === 'Uncategorized') && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onClose();
                    onMapToExisting(item);
                  }}
                  className="text-stone-700 border-stone-300 hover:bg-stone-50 text-xs flex items-center gap-1.5 cursor-pointer"
                  title={locale === 'hi' ? 'मौजूदा आइटम से मैप करें' : 'Map to Existing'}
                >
                  <Link2 className="h-3.5 w-3.5 text-stone-600" />
                  <span>{locale === 'hi' ? 'मैप करें' : 'Map'}</span>
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
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
          </div>
        </form>
      </div>
    </div>
  );
}
