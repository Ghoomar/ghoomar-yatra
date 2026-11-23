'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { InventoryCategory, Unit } from '@/lib/types/database';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
import { X, Package, Check, AlertCircle, Tag, ArrowLeftRight, Trash2, Plus, Loader2 } from 'lucide-react';

import { logAuditAction } from '@/lib/audit-logger';
import { BilingualNameInput } from '@/components/admin/BilingualNameInput';

interface ItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  item?: any | null; // existing item if editing
  onSaved?: (item: any) => void;
}

const INVENTORY_CLASSES = [
  'Food Raw Material',
  'Non-Food Consumable',
  'Physical Asset',
  'Uniform',
];

const STORAGE_TYPES = [
  'Ambient',
  'Refrigerated',
  'Frozen',
  'Fresh',
  'Other',
];

const REPLENISHMENT_FREQUENCIES = [
  'Daily',
  'Periodic',
  'Monthly',
  'As Required',
];

export function ItemModal({ isOpen, onClose, item, onSaved }: ItemModalProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();
  const isEdit = Boolean(item?.id || item?.item_id);
  const itemId = item?.id || item?.item_id;

  const [itemCode, setItemCode] = useState('');
  const [name, setName] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [isCustomHindi, setIsCustomHindi] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [inventoryClass, setInventoryClass] = useState('Food Raw Material');
  const [unitId, setUnitId] = useState('');
  const [secondaryUnitId, setSecondaryUnitId] = useState('');
  const [conversionFactor, setConversionFactor] = useState<number>(1);
  const [storageType, setStorageType] = useState('Ambient');
  const [minimumStock, setMinimumStock] = useState<number>(0);
  const [preferredStock, setPreferredStock] = useState<number>(0);
  const [replenishmentFrequency, setReplenishmentFrequency] = useState('As Required');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Aliases state
  const [aliasesList, setAliasesList] = useState<any[]>([]);
  const [loadingAliases, setLoadingAliases] = useState(false);
  const [newAliasText, setNewAliasText] = useState('');
  const [newAliasType, setNewAliasType] = useState('colloquial');
  const [addingAlias, setAddingAlias] = useState(false);

  // Conversions state
  const [conversionsList, setConversionsList] = useState<any[]>([]);
  const [loadingConversions, setLoadingConversions] = useState(false);
  const [convMultiplier, setConvMultiplier] = useState<string>('');
  const [convToUnit, setConvToUnit] = useState<string>('');
  const [convNotes, setConvNotes] = useState<string>('');
  const [addingConversion, setAddingConversion] = useState(false);

  const fetchAliases = async () => {
    if (!itemId) return;
    setLoadingAliases(true);
    try {
      const res = await fetch(`/api/inventory/aliases?item_id=${itemId}${item?.group_id ? `&group_id=${item.group_id}` : ''}`);
      const data = await res.json();
      if (data.aliases) {
        setAliasesList(data.aliases);
      }
    } catch (e) {
      console.error('Error fetching aliases:', e);
    } finally {
      setLoadingAliases(false);
    }
  };

  const fetchConversions = async () => {
    if (!itemId) return;
    setLoadingConversions(true);
    try {
      const res = await fetch(`/api/sops/conversions?item_id=${itemId}${item?.group_id ? `&group_id=${item.group_id}` : ''}`);
      const data = await res.json();
      if (data.conversions) {
        setConversionsList(data.conversions);
      }
    } catch (e) {
      console.error('Error fetching conversions:', e);
    } finally {
      setLoadingConversions(false);
    }
  };

  useEffect(() => {
    if (isOpen && itemId) {
      fetchAliases();
      fetchConversions();
    } else {
      setAliasesList([]);
      setConversionsList([]);
      setNewAliasText('');
      setConvMultiplier('');
      setConvToUnit('');
      setConvNotes('');
    }
  }, [isOpen, itemId, item?.group_id]);

  const handleAddAlias = async () => {
    if (!newAliasText.trim() || !itemId) return;
    setAddingAlias(true);
    try {
      const res = await fetch('/api/inventory/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          alias: newAliasText.trim(),
          alias_type: newAliasType || 'colloquial',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add alias');
      setNewAliasText('');
      fetchAliases();
    } catch (err: any) {
      alert(err.message || 'Failed to add alias');
    } finally {
      setAddingAlias(false);
    }
  };

  const handleDeleteAlias = async (aliasId: string) => {
    if (!window.confirm(t('inventory.modal.confirmDeleteAlias'))) return;
    try {
      const res = await fetch(`/api/inventory/aliases?id=${aliasId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete alias');
      fetchAliases();
    } catch (err: any) {
      alert(err.message || 'Failed to delete alias');
    }
  };

  const handleAddConversion = async () => {
    if (!convMultiplier || isNaN(Number(convMultiplier)) || Number(convMultiplier) <= 0 || !convToUnit.trim() || !itemId) {
      alert(t('inventory.modal.conversionInputsRequired'));
      return;
    }
    const currentBaseUnit = units.find((u) => u.id === unitId);
    const baseSymbol = currentBaseUnit ? (currentBaseUnit.symbol || currentBaseUnit.name) : 'pkt';

    setAddingConversion(true);
    try {
      const res = await fetch('/api/sops/conversions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventory_item_id: itemId,
          from_unit: baseSymbol.toLowerCase(),
          to_unit: convToUnit.trim().toLowerCase(),
          conversion_factor: Number(convMultiplier),
          notes: convNotes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add conversion');
      setConvMultiplier('');
      setConvToUnit('');
      setConvNotes('');
      fetchConversions();
    } catch (err: any) {
      alert(err.message || 'Failed to add conversion');
    } finally {
      setAddingConversion(false);
    }
  };

  const handleDeleteConversion = async (convId: string) => {
    if (!window.confirm(t('inventory.modal.confirmDeleteConversion'))) return;
    try {
      const res = await fetch(`/api/sops/conversions?id=${convId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete conversion');
      fetchConversions();
    } catch (err: any) {
      alert(err.message || 'Failed to delete conversion');
    }
  };

  const generateNextItemCode = async (
    targetClass?: string,
    targetCategoryId?: string,
    loadedCategories?: any[]
  ) => {
    try {
      const cls = targetClass || inventoryClass;
      const catId = targetCategoryId || categoryId;
      const catsList = loadedCategories || categories;

      const selectedCat = catsList.find((c) => c.id === catId);
      let prefix = 'RAW';
      if (selectedCat && selectedCat.code) {
        prefix = selectedCat.code.toUpperCase();
      } else if (cls === 'Food Raw Material') {
        prefix = 'RAW';
      } else if (cls === 'Non-Food Consumable') {
        prefix = 'CON';
      } else if (cls === 'Physical Asset') {
        prefix = 'AST';
      } else if (cls === 'Uniform') {
        prefix = 'UNI';
      } else {
        prefix = 'SKU';
      }

      const { data } = await supabase
        .from('inventory_items')
        .select('item_code')
        .like('item_code', `${prefix}-%`);

      let maxNum = 0;
      const regex = new RegExp(`^${prefix}-(\\d+)`);
      if (data) {
        for (const row of data) {
          if (!row.item_code) continue;
          const match = row.item_code.match(regex);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
          }
        }
      }
      setItemCode(`${prefix}-${String(maxNum + 1).padStart(3, '0')}`);
    } catch {
      setItemCode('SKU-001');
    }
  };

  useEffect(() => {
    async function fetchMasters() {
      const [{ data: cData }, { data: uData }] = await Promise.all([
        supabase.from('inventory_categories').select('*').order('name'),
        supabase.from('units').select('*').order('name'),
      ]);
      const cats = cData || [];
      setCategories(cats);
      setUnits(uData || []);

      if (!item) {
        generateNextItemCode(inventoryClass, categoryId, cats);
      }
    }
    if (isOpen) {
      fetchMasters();
    }
  }, [isOpen, supabase]);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage(null);

    if (item) {
      setItemCode(item.item_code || '');
      setName(item.name || '');
      setNameHi(item.name_hi || '');
      setIsCustomHindi(Boolean(item.name_hi_is_custom));
      setCategoryId(item.category_id || '');
      setInventoryClass(item.inventory_class || 'Food Raw Material');
      setUnitId(item.unit_id || '');
      setSecondaryUnitId(item.secondary_unit_id || '');
      setConversionFactor(Number(item.conversion_factor) || 1);
      setStorageType(item.storage_type || 'Ambient');
      setMinimumStock(Number(item.minimum_stock) || 0);
      setPreferredStock(Number(item.preferred_stock) || 0);
      setReplenishmentFrequency(item.replenishment_frequency || 'As Required');
      setNotes(item.notes || '');
      setIsActive(item.is_active !== false);
    } else {
      setName('');
      setNameHi('');
      setIsCustomHindi(false);
      setCategoryId('');
      setInventoryClass('Food Raw Material');
      setUnitId('');
      setSecondaryUnitId('');
      setConversionFactor(1);
      setStorageType('Ambient');
      setMinimumStock(0);
      setPreferredStock(0);
      setReplenishmentFrequency('As Required');
      setNotes('');
      setIsActive(true);

      generateNextItemCode('Food Raw Material', '');
    }
  }, [isOpen, item]);

  const handleClassChange = (newClass: string) => {
    setInventoryClass(newClass);
    setCategoryId('');
    if (!isEdit) {
      generateNextItemCode(newClass, '');
    }
  };

  const handleCategoryChange = (newCatId: string) => {
    setCategoryId(newCatId);
    if (!isEdit) {
      generateNextItemCode(inventoryClass, newCatId);
    }
  };

  const isSameUnit = !secondaryUnitId || secondaryUnitId === unitId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage(t('inventory.modal.nameRequired'));
      return;
    }
    if (!unitId) {
      setErrorMessage(t('inventory.modal.unitRequired'));
      return;
    }

    const parsedFactor = isSameUnit ? 1 : Number(conversionFactor);
    if (isNaN(parsedFactor) || parsedFactor <= 0 || !isFinite(parsedFactor)) {
      setErrorMessage(t('inventory.modal.factorInvalid'));
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const isFood = inventoryClass === 'Food Raw Material';

      // Auto-link or create logical ingredient group for Food Raw Material
      let assignedGroupId = item?.group_id || null;
      if (isFood && (!isEdit || !assignedGroupId)) {
        // Look for existing group by exact name
        const { data: existingGroup } = await supabase
          .from('logical_ingredient_groups')
          .select('id')
          .ilike('name', name.trim())
          .maybeSingle();

        if (existingGroup?.id) {
          assignedGroupId = existingGroup.id;
        } else {
          // Generate clean group code
          const rawCode = itemCode.trim() || name.trim().slice(0, 6).toUpperCase();
          const groupCode = rawCode.startsWith('GRP-') ? rawCode : `GRP-${rawCode}`;

          const { data: codeConflict } = await supabase
            .from('logical_ingredient_groups')
            .select('id')
            .eq('group_code', groupCode)
            .maybeSingle();

          const finalCode = codeConflict?.id ? `${groupCode}-${Date.now().toString().slice(-4)}` : groupCode;

          const { data: newGroup, error: groupErr } = await supabase
            .from('logical_ingredient_groups')
            .insert({
              group_code: finalCode,
              name: name.trim(),
              name_hi: nameHi && nameHi.trim() ? nameHi.trim() : null,
              category_id: categoryId || null,
              base_unit_id: unitId || null,
              inventory_class: 'Food Raw Material',
              is_active: isActive,
            })
            .select('id')
            .single();

          if (!groupErr && newGroup?.id) {
            assignedGroupId = newGroup.id;
          }
        }
      }

      const payload: any = {
        item_code: itemCode.trim() || null,
        name: name.trim(),
        name_hi: nameHi && nameHi.trim() ? nameHi.trim() : null,
        name_hi_is_custom: isCustomHindi,
        category_id: categoryId || null,
        inventory_class: inventoryClass,
        unit_id: unitId || null,
        secondary_unit_id: secondaryUnitId || null,
        conversion_factor: parsedFactor,
        storage_type: isFood ? storageType : 'Ambient',
        minimum_stock: minimumStock,
        preferred_stock: preferredStock,
        replenishment_frequency: replenishmentFrequency,
        notes: notes.trim() || null,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      };

      if (assignedGroupId) {
        payload.group_id = assignedGroupId;
      }

      let savedResult;
      if (isEdit && itemId) {
        const { data, error } = await supabase
          .from('inventory_items')
          .update(payload)
          .eq('id', itemId)
          .select()
          .single();
        if (error) throw error;
        savedResult = data;

        await logAuditAction({
          action: 'UPDATE',
          entityType: 'inventory_items',
          entityId: itemId,
          oldValues: item,
          newValues: payload,
        });
      } else {
        const { data, error } = await supabase
          .from('inventory_items')
          .insert({
            ...payload,
            current_stock: 0,
            current_weighted_average_cost: 0,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (error) throw error;
        savedResult = data;

        await logAuditAction({
          action: 'CREATE',
          entityType: 'inventory_items',
          entityId: data?.id,
          newValues: payload,
        });
      }

      if (onSaved) onSaved(savedResult);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || t('inventory.modal.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  // Filter categories by selected inventory class (active for new, or existing if editing)
  const filteredCategories = categories.filter(
    (c) => (c.is_active || c.id === categoryId) && (!c.inventory_class || c.inventory_class === inventoryClass || c.id === categoryId)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-xl max-w-2xl w-full my-8 shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                {isEdit ? t('inventory.modal.editTitle', { name: item?.name }) : t('inventory.modal.addTitle')}
              </h2>
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Identification */}
          <div className="space-y-3">
            <BilingualNameInput
              englishName={name}
              onChangeEnglish={setName}
              hindiName={nameHi}
              onChangeHindi={(val, isCustom) => {
                setNameHi(val);
                if (isCustom !== undefined) setIsCustomHindi(isCustom);
              }}
              entityType="inventory_item"
              englishLabel={locale === 'hi' ? 'आइटम का नाम (अंग्रेज़ी)' : 'Item Name (English)'}
              hindiLabel={locale === 'hi' ? 'आइटम का नाम (हिंदी)' : 'Item Name (Hindi)'}
              placeholderEnglish="e.g. Sunflower Oil, Basmati Rice"
              placeholderHindi="उदा. सनफ्लावर ऑयल, बासमती चावल"
              required
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">{t('inventory.modal.code')}</label>
                <input
                  type="text"
                  value={itemCode}
                  onChange={(e) => setItemCode(e.target.value)}
                  placeholder={t('inventory.modal.codePlaceholder')}
                  className="w-full rounded-md border border-stone-300 bg-stone-50 p-2 font-mono text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">{t('inventory.modal.class')}</label>
                <select
                  value={inventoryClass}
                  onChange={(e) => handleClassChange(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                >
                  {INVENTORY_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {t(`inventory.stock.classes.${c}`, { defaultValue: c })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">{t('inventory.modal.category')}</label>
                <select
                  value={categoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                >
                  <option value="">{t('inventory.modal.selectCategory')}</option>
                  {filteredCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {getLocalizedMasterName(c, locale)} {c.code ? `(${c.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Unit & Conversions */}
          <div className="space-y-3 pt-2 border-t border-stone-100">
            <h3 className="font-semibold text-stone-800">{t('inventory.modal.unitsPackaging')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {t('inventory.modal.unit')}
                </label>
                <select
                  required
                  value={unitId}
                  onChange={(e) => {
                    const newUnit = e.target.value;
                    setUnitId(newUnit);
                    if (!secondaryUnitId || secondaryUnitId === newUnit) {
                      setConversionFactor(1);
                    }
                  }}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                >
                  <option value="">{t('inventory.modal.selectUnit')}</option>
                  {units
                    .filter((u) => u.is_active || u.id === unitId)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {getLocalizedMasterName(u, locale)} ({getLocalizedMasterSymbol(u, locale)})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {t('inventory.modal.purchaseUnit')}
                </label>
                <select
                  value={secondaryUnitId}
                  onChange={(e) => {
                    const newSec = e.target.value;
                    setSecondaryUnitId(newSec);
                    if (!newSec || newSec === unitId) {
                      setConversionFactor(1);
                    }
                  }}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                >
                  <option value="">{t('inventory.modal.sameAsBase')}</option>
                  {units
                    .filter((u) => u.is_active || u.id === secondaryUnitId)
                    .map((u) => (
                    <option key={u.id} value={u.id}>
                      {getLocalizedMasterName(u, locale)} ({getLocalizedMasterSymbol(u, locale)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {t('inventory.modal.conversionFactor')}
                </label>
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={isSameUnit ? 1 : conversionFactor}
                  disabled={isSameUnit}
                  onChange={(e) => {
                    const val = e.target.value;
                    setConversionFactor(val === '' ? ('' as any) : parseFloat(val));
                  }}
                  placeholder="1.0"
                  className={`w-full rounded-md border p-2 text-stone-900 focus:outline-none ${
                    isSameUnit 
                       ? 'bg-stone-100 border-stone-200 text-stone-500 cursor-not-allowed' 
                      : 'border-stone-300 focus:border-amber-500 bg-white'
                  }`}
                />
                {isSameUnit && (
                  <span className="text-[10px] text-stone-400 mt-0.5 block">
                    {t('inventory.modal.fixedAtOne')}
                  </span>
                )}
              </div>
            </div>

            {!isSameUnit && secondaryUnitId && (
              <div className="p-2.5 bg-amber-50/80 rounded-lg border border-amber-200/70 text-[11px] text-amber-800">
                {t('inventory.modal.conversionFormula', {
                  purchaseUnit: getLocalizedMasterName(units.find((u) => u.id === secondaryUnitId), locale) || 'Purchase Unit',
                  factor: conversionFactor || 1,
                  baseUnit: getLocalizedMasterSymbol(units.find((u) => u.id === unitId), locale) || 'Base Units',
                })}
              </div>
            )}
          </div>

          {/* Aliases & Search Synonyms Section */}
          <div className="space-y-3 pt-3 border-t border-stone-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-stone-800">
                <Tag className="h-4 w-4 text-amber-600" />
                <span>{t('inventory.modal.aliasesTitle')}</span>
                {aliasesList.length > 0 && (
                  <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded-full">
                    {aliasesList.length}
                  </span>
                )}
              </div>
            </div>
            <p className="text-[11px] text-stone-500 leading-snug">
              {t('inventory.modal.aliasesSubtitle')}
            </p>

            {isEdit ? (
              <div className="space-y-2 bg-stone-50/70 p-3 rounded-lg border border-stone-200">
                {/* Existing Aliases Chips */}
                {loadingAliases ? (
                  <div className="flex items-center gap-1.5 text-stone-400 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>{t('inventory.modal.loadingAliases')}</span>
                  </div>
                ) : aliasesList.length === 0 ? (
                  <div className="text-stone-400 italic text-[11px] py-1">
                    {t('inventory.modal.noAliases')}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {aliasesList.map((al) => (
                      <span
                        key={al.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-stone-200 text-stone-800 text-[11px] shadow-2xs"
                      >
                        <span className="font-medium">{al.alias}</span>
                        <span className="text-[9px] text-stone-400 bg-stone-100 px-1 rounded">
                          {t(`inventory.modal.aliasTypes.${al.alias_type}`, { defaultValue: al.alias_type })}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteAlias(al.id)}
                          className="text-stone-400 hover:text-rose-600 p-0.5 rounded transition-colors cursor-pointer"
                          title={t('inventory.modal.deleteAlias')}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Add Alias Form */}
                <div className="flex items-center gap-2 pt-2 border-t border-stone-200/60">
                  <input
                    type="text"
                    value={newAliasText}
                    onChange={(e) => setNewAliasText(e.target.value)}
                    placeholder={t('inventory.modal.aliasPlaceholder')}
                    className="flex-1 rounded-md border border-stone-300 bg-white p-1.5 text-stone-900 focus:outline-none focus:border-amber-500 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddAlias();
                      }
                    }}
                  />
                  <select
                    value={newAliasType}
                    onChange={(e) => setNewAliasType(e.target.value)}
                    className="rounded-md border border-stone-300 bg-white p-1.5 text-stone-800 focus:outline-none focus:border-amber-500 text-xs shrink-0"
                  >
                    <option value="colloquial">{t('inventory.modal.aliasTypes.colloquial')}</option>
                    <option value="hindi">{t('inventory.modal.aliasTypes.hindi')}</option>
                    <option value="brand">{t('inventory.modal.aliasTypes.brand')}</option>
                    <option value="transliteration">{t('inventory.modal.aliasTypes.transliteration')}</option>
                    <option value="common">{t('inventory.modal.aliasTypes.common')}</option>
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddAlias}
                    disabled={!newAliasText.trim() || addingAlias}
                    className="h-8 text-xs shrink-0 cursor-pointer"
                  >
                    {addingAlias ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3 mr-1" />
                    )}
                    {t('inventory.modal.addAlias')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-2.5 bg-stone-50 rounded-lg border border-dashed border-stone-300 text-stone-500 text-[11px]">
                {t('inventory.modal.saveItemFirstForExtra')}
              </div>
            )}
          </div>

          {/* Unit Conversions Section (for Recipes & Packaging) */}
          <div className="space-y-3 pt-3 border-t border-stone-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-stone-800">
                <ArrowLeftRight className="h-4 w-4 text-amber-600" />
                <span>{t('inventory.modal.conversionsTitle')}</span>
                {conversionsList.length > 0 && (
                  <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded-full">
                    {conversionsList.length}
                  </span>
                )}
              </div>
            </div>
            <p className="text-[11px] text-stone-500 leading-snug">
              {t('inventory.modal.conversionsSubtitle')}
            </p>

            {isEdit ? (
              <div className="space-y-2 bg-stone-50/70 p-3 rounded-lg border border-stone-200">
                {/* Existing Conversions List */}
                {loadingConversions ? (
                  <div className="flex items-center gap-1.5 text-stone-400 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>{t('inventory.modal.loadingConversions')}</span>
                  </div>
                ) : conversionsList.length === 0 ? (
                  <div className="text-stone-400 italic text-[11px] py-1">
                    {t('inventory.modal.noConversions')}
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {conversionsList.map((conv) => {
                      const isItemTarget = Boolean(conv.inventory_item_id);
                      return (
                        <div
                          key={conv.id}
                          className="flex items-center justify-between p-2 rounded-md bg-white border border-stone-200 text-xs shadow-2xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              1 {conv.from_unit} = {conv.multiplier ?? conv.conversion_factor} {conv.to_unit}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider font-semibold text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                              {isItemTarget ? t('inventory.modal.itemLevel') : t('inventory.modal.groupLevel')}
                            </span>
                            {conv.notes && (
                              <span className="text-[10px] text-stone-500 italic max-w-xs truncate">
                                ({conv.notes})
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteConversion(conv.id)}
                            className="text-stone-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                            title={t('inventory.modal.deleteConversion')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add Conversion Form */}
                <div className="pt-2 border-t border-stone-200/60 space-y-2">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-3 flex items-center bg-stone-100 rounded-md border border-stone-300 px-2 py-1.5 font-mono text-stone-700 text-xs">
                      <span className="font-semibold mr-1">1</span>
                      <span className="truncate">{units.find((u) => u.id === unitId)?.symbol || 'pkt'} =</span>
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        min="0.000001"
                        step="any"
                        value={convMultiplier}
                        onChange={(e) => setConvMultiplier(e.target.value)}
                        placeholder={t('inventory.modal.multiplierPlaceholder')}
                        className="w-full rounded-md border border-stone-300 bg-white p-1.5 text-stone-900 focus:outline-none focus:border-amber-500 text-xs"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text"
                        value={convToUnit}
                        onChange={(e) => setConvToUnit(e.target.value)}
                        placeholder={t('inventory.modal.toUnitPlaceholder')}
                        className="w-full rounded-md border border-stone-300 bg-white p-1.5 text-stone-900 focus:outline-none focus:border-amber-500 text-xs"
                      />
                    </div>
                    <div className="col-span-3 flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAddConversion}
                        disabled={!convMultiplier || !convToUnit.trim() || addingConversion}
                        className="w-full h-8 text-xs cursor-pointer"
                      >
                        {addingConversion ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3 mr-1" />
                        )}
                        {t('inventory.modal.addConversion')}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <input
                      type="text"
                      value={convNotes}
                      onChange={(e) => setConvNotes(e.target.value)}
                      placeholder={t('inventory.modal.conversionNotesPlaceholder')}
                      className="w-full rounded-md border border-stone-300 bg-white p-1.5 text-stone-700 focus:outline-none focus:border-amber-500 text-[11px]"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-2.5 bg-stone-50 rounded-lg border border-dashed border-stone-300 text-stone-500 text-[11px]">
                {t('inventory.modal.saveItemFirstForExtra')}
              </div>
            )}
          </div>

          {/* Storage & Replenishment */}
          <div className="space-y-3 pt-2 border-t border-stone-100">
            <h3 className="font-semibold text-stone-800">{t('inventory.modal.stockStorage')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {inventoryClass === 'Food Raw Material' && (
                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t('inventory.modal.storage')}</label>
                  <select
                    value={storageType}
                    onChange={(e) => setStorageType(e.target.value)}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  >
                    {STORAGE_TYPES.map((s) => (
                      <option key={s} value={s}>
                        {t(`inventory.modal.storageTypes.${s}`, { defaultValue: s })}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-medium text-stone-700 mb-1">{t('inventory.modal.minStock')}</label>
                <input
                  type="number"
                  step="0.001"
                  value={minimumStock || ''}
                  onChange={(e) => setMinimumStock(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">{t('inventory.modal.preferredStock')}</label>
                <input
                  type="number"
                  step="0.001"
                  value={preferredStock || ''}
                  onChange={(e) => setPreferredStock(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-stone-700 mb-1">{t('inventory.modal.replenishment')}</label>
              <select
                value={replenishmentFrequency}
                onChange={(e) => setReplenishmentFrequency(e.target.value)}
                className="w-full sm:w-1/2 rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
              >
                {REPLENISHMENT_FREQUENCIES.map((r) => (
                  <option key={r} value={r}>
                    {t(`inventory.modal.replenishmentFrequencies.${r}`, { defaultValue: r })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes & Active Status */}
          <div className="space-y-3 pt-2 border-t border-stone-100">
            <div>
              <label className="block font-medium text-stone-700 mb-1">{t('inventory.modal.notes')}</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('inventory.modal.notesPlaceholder')}
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-stone-50 rounded-lg border border-stone-200">
              <div>
                <div className="font-semibold text-stone-800">{t('inventory.modal.active')}</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              {t('inventory.modal.cancel')}
            </Button>
            <Button type="submit" variant="amber" disabled={saving}>
              {saving ? t('inventory.modal.saving') : isEdit ? t('inventory.modal.saveChanges') : t('inventory.modal.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
