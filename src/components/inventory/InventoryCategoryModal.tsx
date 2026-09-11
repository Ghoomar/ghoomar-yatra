'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { logAuditAction } from '@/lib/audit-logger';
import { X, Plus, Edit2, AlertCircle, RefreshCw, Layers } from 'lucide-react';

interface InventoryCategory {
  id: string;
  name: string;
  code?: string | null;
  inventory_class: string;
  is_active: boolean;
  created_at?: string;
}

interface InventoryCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

const INVENTORY_CLASSES = [
  'Food Raw Material',
  'Non-Food Consumable',
  'Physical Asset',
  'Uniform',
];

export function InventoryCategoryModal({
  isOpen,
  onClose,
  onUpdated,
}: InventoryCategoryModalProps) {
  const supabase = createClient();
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [inventoryClass, setInventoryClass] = useState('Food Raw Material');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCategories = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase
        .from('inventory_categories')
        .select('*')
        .order('inventory_class')
        .order('name');
      if (error) throw error;
      setCategories(data || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load inventory categories.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadCategories();
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setCode('');
    setInventoryClass('Food Raw Material');
    setIsActive(true);
    setErrorMessage(null);
  };

  const handleStartEdit = (cat: InventoryCategory) => {
    setEditingId(cat.id);
    setName(cat.name);
    setCode(cat.code || '');
    setInventoryClass(cat.inventory_class || 'Food Raw Material');
    setIsActive(cat.is_active !== false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Category name is required.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        name: name.trim(),
        code: code.trim().toUpperCase() || null,
        inventory_class: inventoryClass,
        is_active: isActive,
      };

      if (editingId) {
        const oldCat = categories.find((c) => c.id === editingId);
        const { error } = await supabase
          .from('inventory_categories')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;

        await logAuditAction({
          action: 'UPDATE',
          entityType: 'inventory_categories',
          entityId: editingId,
          oldValues: oldCat,
          newValues: payload,
        });
      } else {
        const { data, error } = await supabase
          .from('inventory_categories')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;

        await logAuditAction({
          action: 'CREATE',
          entityType: 'inventory_categories',
          entityId: data?.id,
          newValues: payload,
        });
      }

      resetForm();
      await loadCategories();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save category.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (cat: InventoryCategory) => {
    const nextStatus = !cat.is_active;
    try {
      const { error } = await supabase
        .from('inventory_categories')
        .update({ is_active: nextStatus })
        .eq('id', cat.id);
      if (error) throw error;

      await logAuditAction({
        action: 'STATUS_CHANGE',
        entityType: 'inventory_categories',
        entityId: cat.id,
        oldValues: { is_active: cat.is_active },
        newValues: { is_active: nextStatus },
      });

      await loadCategories();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update category status.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-stone-50/50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-lg">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">Inventory Category Master</h2>
              <p className="text-[11px] text-stone-500">
                Configure item categories, SKU prefixes, and inventory class classification
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSave} className="bg-stone-50 p-4 border border-stone-200 rounded-xl space-y-3">
            <div className="font-semibold text-stone-800 flex items-center justify-between">
              <span>{editingId ? 'Edit Category Details' : 'Add New Inventory Category'}</span>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-amber-600 hover:underline text-[11px] font-normal"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-stone-700 font-medium mb-1">Category Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Spices & Masala, Dairy, Crockery"
                  required
                  className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-stone-700 font-medium mb-1">SKU Prefix Code</label>
                <input
                  type="text"
                  maxLength={4}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. SPC, DAI"
                  className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white font-mono uppercase focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div>
                <label className="block text-stone-700 font-medium mb-1">Inventory Class *</label>
                <select
                  value={inventoryClass}
                  onChange={(e) => setInventoryClass(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
                >
                  {INVENTORY_CLASSES.map((cls) => (
                    <option key={cls} value={cls}>
                      {cls}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center sm:pt-5">
                <label className="flex items-center gap-2 cursor-pointer text-stone-700">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded text-amber-600 focus:ring-amber-500 border-stone-300"
                  />
                  <span className="font-medium">Active (Available for item creation)</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" variant="amber" size="sm" disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update Category' : 'Create Category'}
              </Button>
            </div>
          </form>

          {/* List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-stone-700 font-semibold px-1">
              <span>Configured Categories ({categories.length})</span>
              <button
                type="button"
                onClick={loadCategories}
                className="text-stone-400 hover:text-stone-700 flex items-center gap-1 text-[11px]"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {loading ? (
              <div className="py-8 text-center text-stone-400">Loading categories...</div>
            ) : categories.length === 0 ? (
              <div className="py-8 text-center text-stone-400">No categories found.</div>
            ) : (
              <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100 bg-white">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className={`p-3 flex items-center justify-between gap-4 transition-colors ${
                      !cat.is_active ? 'bg-stone-50/60 opacity-70' : 'hover:bg-stone-50/50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-stone-900 text-sm">{cat.name}</span>
                        {cat.code && (
                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                            {cat.code}
                          </span>
                        )}
                        <Badge variant="outline">{cat.inventory_class}</Badge>
                        {cat.is_active ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartEdit(cat)}
                        className="h-7 px-2 text-stone-600 hover:text-stone-900"
                        title="Edit category"
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant={cat.is_active ? 'secondary' : 'amber'}
                        size="sm"
                        onClick={() => handleToggleStatus(cat)}
                        className="h-7 px-2.5 text-[11px]"
                      >
                        {cat.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 bg-stone-50 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
