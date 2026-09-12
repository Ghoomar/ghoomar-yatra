'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { logAuditAction } from '@/lib/audit-logger';
import {
  X,
  Layers,
  Check,
  AlertCircle,
  RefreshCw,
  Building2,
  CheckSquare,
  Square,
} from 'lucide-react';

interface DepartmentCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

export function DepartmentCategoryModal({
  isOpen,
  onClose,
  onUpdated,
}: DepartmentCategoryModalProps) {
  const supabase = createClient();

  const [departments, setDepartments] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [selectedCatIds, setSelectedCatIds] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [
        { data: dData, error: dErr },
        { data: cData, error: cErr },
        { data: mData, error: mErr },
      ] = await Promise.all([
        supabase.from('departments').select('*').eq('is_active', true).order('name'),
        supabase.from('inventory_categories').select('*').order('inventory_class').order('name'),
        supabase.from('department_inventory_categories').select('*'),
      ]);

      if (dErr) throw dErr;
      if (cErr) throw cErr;
      if (mErr) throw mErr;

      setDepartments(dData || []);
      setCategories(cData || []);
      setMappings(mData || []);

      if (dData && dData.length > 0 && !selectedDeptId) {
        setSelectedDeptId(dData[0].id);
      }
    } catch (err: any) {
      console.error('Error loading category mappings:', err);
      setMessage({ type: 'error', text: err.message || 'Failed to load department mappings.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  // Sync selected categories when department selection changes
  useEffect(() => {
    if (!selectedDeptId) {
      setSelectedCatIds(new Set());
      return;
    }
    const currentMapped = mappings
      .filter((m) => m.department_id === selectedDeptId)
      .map((m) => m.category_id);
    setSelectedCatIds(new Set(currentMapped));
    setMessage(null);
  }, [selectedDeptId, mappings]);

  if (!isOpen) return null;

  const currentDept = departments.find((d) => d.id === selectedDeptId);

  const toggleCategory = (catId: string) => {
    const next = new Set(selectedCatIds);
    if (next.has(catId)) {
      next.delete(catId);
    } else {
      next.add(catId);
    }
    setSelectedCatIds(next);
  };

  const handleSelectAll = () => {
    const next = new Set(categories.map((c) => c.id));
    setSelectedCatIds(next);
  };

  const handleClearAll = () => {
    setSelectedCatIds(new Set());
  };

  const handleSave = async () => {
    if (!selectedDeptId) return;
    setSaving(true);
    setMessage(null);

    try {
      const existing = mappings
        .filter((m) => m.department_id === selectedDeptId)
        .map((m) => m.category_id);

      const toAdd = Array.from(selectedCatIds).filter((id) => !existing.includes(id));
      const toRemove = existing.filter((id) => !selectedCatIds.has(id));

      // 1. Delete removed
      if (toRemove.length > 0) {
        const { error: delErr } = await supabase
          .from('department_inventory_categories')
          .delete()
          .eq('department_id', selectedDeptId)
          .in('category_id', toRemove);
        if (delErr) throw delErr;
      }

      // 2. Insert added
      if (toAdd.length > 0) {
        const payload = toAdd.map((catId) => ({
          department_id: selectedDeptId,
          category_id: catId,
        }));
        const { error: insErr } = await supabase
          .from('department_inventory_categories')
          .insert(payload);
        if (insErr) throw insErr;
      }

      // 3. Central Audit Log
      await logAuditAction({
        action: 'UPDATE',
        entityType: 'department_inventory_categories',
        entityId: selectedDeptId,
        oldValues: { mapped_count: existing.length, category_ids: existing },
        newValues: { mapped_count: selectedCatIds.size, category_ids: Array.from(selectedCatIds) },
        details: {
          department_name: currentDept?.name,
          added: toAdd.length,
          removed: toRemove.length,
        },
      });

      // Reload mappings
      const { data: refreshed } = await supabase.from('department_inventory_categories').select('*');
      setMappings(refreshed || []);

      setMessage({
        type: 'success',
        text: `Successfully updated category mappings for ${currentDept?.name} (${selectedCatIds.size} categories active).`,
      });

      if (onUpdated) onUpdated();
    } catch (err: any) {
      console.error('Failed to save mappings:', err);
      setMessage({ type: 'error', text: err.message || 'Failed to save mappings.' });
    } finally {
      setSaving(false);
    }
  };

  // Group categories by inventory_class
  const groupedCategories: Record<string, any[]> = {};
  categories.forEach((cat) => {
    const cls = cat.inventory_class || 'Other';
    if (!groupedCategories[cls]) groupedCategories[cls] = [];
    groupedCategories[cls].push(cat);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-stone-200 overflow-hidden text-xs">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                Department ↔ Inventory Category Mapping
              </h2>
              <p className="text-xs text-stone-500">
                Configure which inventory categories each operational department is eligible to requisition and receive
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
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Department Selector Sidebar */}
          <div className="w-full md:w-64 border-r border-stone-200 bg-stone-50/50 p-4 overflow-y-auto space-y-1">
            <div className="text-[11px] font-bold text-stone-500 uppercase tracking-wider mb-2">
              Select Department
            </div>
            {departments.map((dept) => {
              const mappedCount = mappings.filter((m) => m.department_id === dept.id).length;
              const isSelected = dept.id === selectedDeptId;
              return (
                <button
                  key={dept.id}
                  onClick={() => setSelectedDeptId(dept.id)}
                  className={`w-full text-left p-2.5 rounded-lg font-medium transition-colors flex items-center justify-between ${
                    isSelected
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-stone-700 hover:bg-stone-200/60'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Building2 className={`h-4 w-4 shrink-0 ${isSelected ? 'text-white' : 'text-stone-400'}`} />
                    <span className="truncate">{dept.name}</span>
                  </div>
                  <Badge
                    variant={isSelected ? 'default' : 'outline'}
                    className={`ml-1 text-[10px] shrink-0 ${isSelected ? 'bg-amber-700 text-white border-transparent' : ''}`}
                  >
                    {mappedCount}
                  </Badge>
                </button>
              );
            })}
          </div>

          {/* Categories Checkbox Matrix */}
          <div className="flex-1 p-6 overflow-y-auto space-y-5">
            {message && (
              <div
                className={`p-3 rounded-lg flex items-center gap-2 ${
                  message.type === 'success'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border border-rose-200 text-rose-800'
                }`}
              >
                {message.type === 'success' ? (
                  <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                )}
                <span>{message.text}</span>
              </div>
            )}

            {currentDept && (
              <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                <div>
                  <h3 className="text-sm font-bold text-stone-900">
                    Categories for {currentDept.name}
                  </h3>
                  <p className="text-stone-500 text-[11px]">
                    {selectedCatIds.size} of {categories.length} categories enabled for store issues
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-amber-700 hover:text-amber-800 font-semibold hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <CheckSquare className="h-3 w-3" /> Select All
                  </button>
                  <span className="text-stone-300">|</span>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-stone-500 hover:text-stone-700 font-semibold hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <Square className="h-3 w-3" /> Clear All
                  </button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="py-12 text-center text-stone-400 flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading category matrix...
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedCategories).map(([clsName, catList]) => (
                  <div key={clsName} className="space-y-2">
                    <div className="font-bold text-stone-800 uppercase tracking-wider text-[10px] bg-stone-100 px-2 py-1 rounded">
                      {clsName} ({catList.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {catList.map((cat) => {
                        const isChecked = selectedCatIds.has(cat.id);
                        return (
                          <label
                            key={cat.id}
                            onClick={() => toggleCategory(cat.id)}
                            className={`p-2.5 rounded-lg border cursor-pointer transition-all flex items-center justify-between select-none ${
                              isChecked
                                ? 'bg-amber-50/80 border-amber-300 shadow-xs'
                                : 'bg-white border-stone-200 hover:bg-stone-50'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <div
                                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                  isChecked
                                    ? 'bg-amber-600 border-amber-600 text-white'
                                    : 'border-stone-300 bg-white'
                                }`}
                              >
                                {isChecked && <Check className="h-3 w-3" />}
                              </div>
                              <div className="truncate">
                                <span className={`font-medium ${isChecked ? 'text-amber-950 font-bold' : 'text-stone-800'}`}>
                                  {cat.name}
                                </span>
                                {cat.code && (
                                  <span className="ml-1 text-[10px] text-stone-400 font-mono">
                                    ({cat.code})
                                  </span>
                                )}
                              </div>
                            </div>
                            {!cat.is_active && (
                              <Badge variant="default" className="text-[9px] py-0 px-1 text-stone-400">
                                Inactive
                              </Badge>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="text-stone-500 text-[11px]">
            Changes immediately update context-aware item dropdowns on the Store Issues screen.
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving || !selectedDeptId}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save Mappings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
