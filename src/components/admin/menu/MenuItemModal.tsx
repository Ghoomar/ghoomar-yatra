'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

interface MenuItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  categories: Array<{ id: string; name: string; parent_category_name: string }>;
  item?: {
    id: string;
    name: string;
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
  categories,
  item,
}: MenuItemModalProps) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState<number | string>(0);
  const [isActive, setIsActive] = useState(true);
  const [aliasInput, setAliasInput] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setCategoryId(item.category_id || categories.find((c) => c.name === item.category)?.id || categories[0]?.id || '');
      setPrice(item.price !== undefined ? item.price : 0);
      setIsActive(item.is_active !== false);
      setAliases(item.aliases || []);
    } else {
      setName('');
      setCategoryId(categories[0]?.id || '');
      setPrice(0);
      setIsActive(true);
      setAliases([]);
    }
    setAliasInput('');
    setError(null);
  }, [item, categories, isOpen]);

  if (!isOpen) return null;

  const selectedCategory = categories.find((c) => c.id === categoryId);

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
      setError('Please provide an Item Name.');
      return;
    }
    if (!categoryId) {
      setError('Please select a Category.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = '/api/admin/menu/items';
      const method = item ? 'PUT' : 'POST';
      const payload: any = {
        name: name.trim(),
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
        throw new Error(json.error || 'Failed to save menu item.');
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
              {item ? 'Edit Menu Item' : 'New Menu Item'}
            </h3>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Authoritative catalogue & Petpooja mapping
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
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              Item Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dal Makhani, Ghoomar Special Thali"
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Category *
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30"
                required
              >
                <option value="">Select Category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.parent_category_name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Parent Category (Derived)
              </label>
              <input
                type="text"
                readOnly
                disabled
                value={selectedCategory?.parent_category_name || item?.parent_category || '—'}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs bg-stone-100 text-stone-600 font-semibold cursor-not-allowed"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Menu Price (₹) *
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
                GST Rate
              </label>
              <div className="rounded-xl border border-stone-200 px-3 py-2 text-xs bg-stone-100 text-stone-700 font-semibold">
                5.0% (Standard)
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Tax Type
              </label>
              <div className="rounded-xl border border-stone-200 px-3 py-2 text-xs bg-stone-100 text-stone-700 font-semibold truncate">
                Forward Tax
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              Petpooja POS Aliases
            </label>
            <p className="text-[11px] text-stone-400 mb-1.5">
              Alternate names that Petpooja POS exports for this item (e.g. &quot;Extra Bati (1)&quot;, &quot;coldrink&quot;)
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
                placeholder="Enter alias & press Add..."
                className="flex-1 rounded-xl border border-stone-200 px-3 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30"
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddAlias}>
                Add Alias
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
              <span>Active in Menu Master</span>
            </label>
          </div>

          <div className="pt-3 border-t border-stone-100 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={loading}>
              {loading ? 'Saving...' : item ? 'Update Item' : 'Create Item'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
