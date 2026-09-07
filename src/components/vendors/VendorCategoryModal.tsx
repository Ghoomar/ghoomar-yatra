'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { VendorCategory } from '@/lib/types/database';
import { X, Plus, Edit2, Check, Power, AlertCircle, RefreshCw, Tag } from 'lucide-react';

interface VendorCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

export function VendorCategoryModal({ isOpen, onClose, onUpdated }: VendorCategoryModalProps) {
  const supabase = createClient();
  const [categories, setCategories] = useState<VendorCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCat, setEditingCat] = useState<VendorCategory | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCategories = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase
        .from('vendor_categories')
        .select('*')
        .order('name');
      if (error) throw error;
      setCategories(data || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load categories.');
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
    setEditingCat(null);
    setName('');
    setDescription('');
    setErrorMessage(null);
  };

  const handleStartEdit = (cat: VendorCategory) => {
    setEditingCat(cat);
    setName(cat.name);
    setDescription(cat.description || '');
    setErrorMessage(null);
  };

  const handleToggleActive = async (cat: VendorCategory) => {
    try {
      const { error } = await supabase
        .from('vendor_categories')
        .update({ is_active: !cat.is_active, updated_at: new Date().toISOString() })
        .eq('id', cat.id);
      if (error) throw error;
      loadCategories();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update category status.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Category name is required.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      if (editingCat) {
        // Edit category
        const { error } = await supabase
          .from('vendor_categories')
          .update({
            name: name.trim(),
            description: description.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingCat.id);
        if (error) throw error;
      } else {
        // Create category
        const { error } = await supabase.from('vendor_categories').insert({
          name: name.trim(),
          description: description.trim() || null,
          is_active: true,
        });
        if (error) throw error;
      }

      resetForm();
      loadCategories();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save vendor category.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-stone-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <Tag className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">Manage Vendor Categories</h2>
              <p className="text-xs text-stone-500">
                Add, rename, and activate/deactivate supply categories for vendor classification
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-4 bg-stone-50 rounded-lg border border-stone-200 space-y-3">
            <div className="font-semibold text-stone-800 flex items-center justify-between">
              <span>{editingCat ? `Edit Category: ${editingCat.name}` : 'Add New Category'}</span>
              {editingCat && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-stone-500 hover:text-stone-800 text-[11px] underline"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  Category Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Seafood & Poultry"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 bg-white"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description / details"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 bg-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="submit" variant="amber" size="sm" disabled={saving}>
                {saving ? 'Saving...' : editingCat ? 'Save Changes' : '+ Add Category'}
              </Button>
            </div>
          </form>

          {/* Category List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-stone-700 font-semibold border-b pb-1">
              <span>Configured Categories ({categories.length})</span>
              <button onClick={loadCategories} className="text-stone-400 hover:text-stone-600 p-1">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

            {loading ? (
              <div className="py-8 text-center text-stone-400 flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading categories...
              </div>
            ) : categories.length === 0 ? (
              <div className="py-8 text-center text-stone-500">No categories found.</div>
            ) : (
              <div className="divide-y divide-stone-100 border rounded-lg overflow-hidden bg-white">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className={`p-3 flex items-center justify-between hover:bg-stone-50/80 transition-colors ${
                      !cat.is_active ? 'opacity-60 bg-stone-50/50' : ''
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-stone-900 flex items-center gap-2">
                        {cat.name}
                        <Badge variant={cat.is_active ? 'success' : 'default'}>
                          {cat.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      {cat.description && (
                        <div className="text-stone-500 text-[11px] mt-0.5">{cat.description}</div>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(cat)}
                        title="Edit Category"
                        className="p-1.5 rounded text-stone-500 hover:text-amber-600 hover:bg-stone-100"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(cat)}
                        title={cat.is_active ? 'Deactivate' : 'Activate'}
                        className={`p-1.5 rounded ${
                          cat.is_active
                            ? 'text-stone-400 hover:text-rose-600 hover:bg-rose-50'
                            : 'text-stone-400 hover:text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 flex justify-end bg-stone-50">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
