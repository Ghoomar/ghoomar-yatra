'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

interface CategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  parents: Array<{ id: string; name: string }>;
  category?: {
    id: string;
    name: string;
    parent_category_id: string;
    parent_category_name: string;
    display_order: number;
    is_active: boolean;
  } | null;
}

export function CategoryModal({
  isOpen,
  onClose,
  onSuccess,
  parents,
  category,
}: CategoryModalProps) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [displayOrder, setDisplayOrder] = useState<number>(0);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (category) {
      setName(category.name);
      setParentId(category.parent_category_id || (parents[0]?.id || ''));
      setDisplayOrder(category.display_order || 0);
      setIsActive(category.is_active !== false);
    } else {
      setName('');
      setParentId(parents[0]?.id || '');
      setDisplayOrder(0);
      setIsActive(true);
    }
    setError(null);
  }, [category, parents, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a Category name.');
      return;
    }
    if (!parentId) {
      setError('Please select a Parent Category.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = '/api/admin/menu/categories';
      const method = category ? 'PUT' : 'POST';
      const payload: any = {
        name: name.trim(),
        parent_category_id: parentId,
        display_order: Number(displayOrder) || 0,
        is_active: isActive,
      };
      if (category) {
        payload.id = category.id;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save Category.');
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
      <div className="bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div>
            <h3 className="font-bold text-stone-900 text-sm">
              {category ? 'Edit Category' : 'New Category'}
            </h3>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Subcategory grouping menu items
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
              Category Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rajasthani Specialities, Dal, Pizza"
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              Parent Category *
            </label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30"
              required
            >
              <option value="">Select Parent Category</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Display Order
              </label>
              <input
                type="number"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30"
              />
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 text-xs font-semibold text-stone-700 cursor-pointer py-2">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500 h-4 w-4"
                />
                <span>Active Status</span>
              </label>
            </div>
          </div>

          <div className="pt-3 border-t border-stone-100 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={loading}>
              {loading ? 'Saving...' : category ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
