'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

interface ParentCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  parentCategory?: {
    id: string;
    name: string;
    display_order: number;
    is_active: boolean;
  } | null;
}

export function ParentCategoryModal({
  isOpen,
  onClose,
  onSuccess,
  parentCategory,
}: ParentCategoryModalProps) {
  const [name, setName] = useState('');
  const [displayOrder, setDisplayOrder] = useState<number>(0);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (parentCategory) {
      setName(parentCategory.name);
      setDisplayOrder(parentCategory.display_order || 0);
      setIsActive(parentCategory.is_active !== false);
    } else {
      setName('');
      setDisplayOrder(0);
      setIsActive(true);
    }
    setError(null);
  }, [parentCategory, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a Parent Category name.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = '/api/admin/menu/parents';
      const method = parentCategory ? 'PUT' : 'POST';
      const payload: any = {
        name: name.trim(),
        display_order: Number(displayOrder) || 0,
        is_active: isActive,
      };
      if (parentCategory) {
        payload.id = parentCategory.id;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save Parent Category.');
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
              {parentCategory ? 'Edit Parent Category' : 'New Parent Category'}
            </h3>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Top-level reporting & operational group
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
              Parent Category Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rajasthani, Beverages, Indian"
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/30"
              required
            />
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
              {loading ? 'Saving...' : parentCategory ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
