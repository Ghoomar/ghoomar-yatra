'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { InventoryCategory, Unit } from '@/lib/types/database';
import { X, Package, Check, AlertCircle } from 'lucide-react';

import { logAuditAction } from '@/lib/audit-logger';

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
  const supabase = createClient();
  const isEdit = Boolean(item?.id || item?.item_id);
  const itemId = item?.id || item?.item_id;

  const [itemCode, setItemCode] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [inventoryClass, setInventoryClass] = useState('Food Raw Material');
  const [unitId, setUnitId] = useState('');
  const [secondaryUnitId, setSecondaryUnitId] = useState('');
  const [conversionFactor, setConversionFactor] = useState<number>(1);
  const [storageType, setStorageType] = useState('Ambient');
  const [minimumStock, setMinimumStock] = useState<number>(0);
  const [preferredStock, setPreferredStock] = useState<number>(0);
  const [replenishmentFrequency, setReplenishmentFrequency] = useState('As Required');
  const [shelfLifeDays, setShelfLifeDays] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      setCategoryId(item.category_id || '');
      setInventoryClass(item.inventory_class || 'Food Raw Material');
      setUnitId(item.unit_id || '');
      setSecondaryUnitId(item.secondary_unit_id || '');
      setConversionFactor(Number(item.conversion_factor) || 1);
      setStorageType(item.storage_type || 'Ambient');
      setMinimumStock(Number(item.minimum_stock) || 0);
      setPreferredStock(Number(item.preferred_stock) || 0);
      setReplenishmentFrequency(item.replenishment_frequency || 'As Required');
      setShelfLifeDays(item.shelf_life_days ?? '');
      setNotes(item.notes || '');
      setIsActive(item.is_active !== false);
    } else {
      setName('');
      setCategoryId('');
      setInventoryClass('Food Raw Material');
      setUnitId('');
      setSecondaryUnitId('');
      setConversionFactor(1);
      setStorageType('Ambient');
      setMinimumStock(0);
      setPreferredStock(0);
      setReplenishmentFrequency('As Required');
      setShelfLifeDays('');
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
      setErrorMessage('Item / SKU Name is required.');
      return;
    }
    if (!unitId) {
      setErrorMessage('Base Unit is required.');
      return;
    }

    const parsedFactor = isSameUnit ? 1 : Number(conversionFactor);
    if (isNaN(parsedFactor) || parsedFactor <= 0 || !isFinite(parsedFactor)) {
      setErrorMessage('Conversion factor must be a valid positive number greater than 0.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const isFood = inventoryClass === 'Food Raw Material';
      const payload = {
        item_code: itemCode.trim() || null,
        name: name.trim(),
        category_id: categoryId || null,
        inventory_class: inventoryClass,
        unit_id: unitId || null,
        secondary_unit_id: secondaryUnitId || null,
        conversion_factor: parsedFactor,
        storage_type: isFood ? storageType : 'Ambient',
        minimum_stock: minimumStock,
        preferred_stock: preferredStock,
        replenishment_frequency: replenishmentFrequency,
        shelf_life_days: isFood && shelfLifeDays !== '' ? Number(shelfLifeDays) : null,
        notes: notes.trim() || null,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      };

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
      setErrorMessage(err.message || 'Failed to save inventory item.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  // Filter categories by selected inventory class
  const filteredCategories = categories.filter(
    (c) => c.is_active && (!c.inventory_class || c.inventory_class === inventoryClass)
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
                {isEdit ? `Edit SKU: ${item?.name}` : 'Add New Inventory SKU'}
              </h2>
              <p className="text-xs text-stone-500">
                Maintain raw materials, consumable goods, assets, and units
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Identification */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block font-medium text-stone-700 mb-1">
                  Item / SKU Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Fresh Malai Paneer, Basmati Rice"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">SKU Code</label>
                <input
                  type="text"
                  value={itemCode}
                  onChange={(e) => setItemCode(e.target.value)}
                  placeholder="e.g. RAW-001"
                  className="w-full rounded-md border border-stone-300 bg-stone-50 p-2 font-mono text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Inventory Class</label>
                <select
                  value={inventoryClass}
                  onChange={(e) => handleClassChange(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                >
                  {INVENTORY_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                >
                  <option value="">Select Category...</option>
                  {filteredCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.code ? `(${c.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Unit & Conversions */}
          <div className="space-y-3 pt-2 border-t border-stone-100">
            <h3 className="font-semibold text-stone-800">Units &amp; Packaging Conversion</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  Base Stock Unit <span className="text-rose-500">*</span>
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
                  <option value="">Select Base Unit...</option>
                  {units
                    .filter((u) => u.is_active || u.id === unitId)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.symbol})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  Purchase Unit (Optional)
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
                  <option value="">Same as Base Unit</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.symbol})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  Conversion Factor
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
                    Fixed at 1 for identical units
                  </span>
                )}
              </div>
            </div>

            {!isSameUnit && secondaryUnitId && (
              <div className="p-2.5 bg-amber-50/80 rounded-lg border border-amber-200/70 text-[11px] text-amber-800">
                <strong>Conversion Formula:</strong> 1 {units.find((u) => u.id === secondaryUnitId)?.name || 'Purchase Unit'} = {conversionFactor || 1} {units.find((u) => u.id === unitId)?.symbol || 'Base Units'}.
              </div>
            )}
          </div>

          {/* Storage & Replenishment */}
          <div className="space-y-3 pt-2 border-t border-stone-100">
            <h3 className="font-semibold text-stone-800">
              Stock Thresholds {inventoryClass === 'Food Raw Material' ? '& Food Storage' : ''}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {inventoryClass === 'Food Raw Material' && (
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Storage Condition</label>
                  <select
                    value={storageType}
                    onChange={(e) => setStorageType(e.target.value)}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  >
                    {STORAGE_TYPES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-medium text-stone-700 mb-1">Minimum Stock</label>
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
                <label className="block font-medium text-stone-700 mb-1">Preferred Stock</label>
                <input
                  type="number"
                  step="0.001"
                  value={preferredStock || ''}
                  onChange={(e) => setPreferredStock(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              {inventoryClass === 'Food Raw Material' && (
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Shelf Life (Days)</label>
                  <input
                    type="number"
                    value={shelfLifeDays}
                    onChange={(e) => setShelfLifeDays(e.target.value ? parseInt(e.target.value) : '')}
                    placeholder="e.g. 7"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block font-medium text-stone-700 mb-1">Replenishment Schedule</label>
              <select
                value={replenishmentFrequency}
                onChange={(e) => setReplenishmentFrequency(e.target.value)}
                className="w-full sm:w-1/2 rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
              >
                {REPLENISHMENT_FREQUENCIES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes & Active Status */}
          <div className="space-y-3 pt-2 border-t border-stone-100">
            <div>
              <label className="block font-medium text-stone-700 mb-1">Internal Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Preferred brands, quality checks, recipe usages..."
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-stone-50 rounded-lg border border-stone-200">
              <div>
                <div className="font-semibold text-stone-800">Item Active Status</div>
                <div className="text-[11px] text-stone-500">
                  Inactive SKUs are hidden from purchase and kitchen issue entries, while preserving all historical movements.
                </div>
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
              Cancel
            </Button>
            <Button type="submit" variant="amber" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Item SKU'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
