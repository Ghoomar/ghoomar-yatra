'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import { logAuditAction } from '@/lib/audit-logger';
import { X, Plus, Edit2, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';

interface Activity {
  id: string;
  name: string;
  description: string | null;
  default_price: number;
  is_active: boolean;
  created_at?: string;
}

interface ActivityMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

export function ActivityMasterModal({ isOpen, onClose, onUpdated }: ActivityMasterModalProps) {
  const supabase = createClient();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultPrice, setDefaultPrice] = useState<number>(50);
  const [isActive, setIsActive] = useState(true);

  const loadActivities = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase
        .from('activities')
        .select('*')
        .order('name');
      if (error) throw error;
      setActivities(data || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load activities.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadActivities();
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setDefaultPrice(50);
    setIsActive(true);
    setErrorMessage(null);
  };

  const handleEdit = (act: Activity) => {
    setEditingId(act.id);
    setName(act.name);
    setDescription(act.description || '');
    setDefaultPrice(Number(act.default_price) || 0);
    setIsActive(act.is_active !== false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Activity name is required.');
      return;
    }
    if (defaultPrice < 0) {
      setErrorMessage('Price cannot be negative.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        default_price: defaultPrice,
        is_active: isActive,
      };

      if (editingId) {
        const oldAct = activities.find((a) => a.id === editingId);
        const { error } = await supabase
          .from('activities')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;

        await logAuditAction({
          action: 'UPDATE',
          entityType: 'activities',
          entityId: editingId,
          oldValues: oldAct,
          newValues: payload,
        });
      } else {
        const { data, error } = await supabase
          .from('activities')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;

        await logAuditAction({
          action: 'CREATE',
          entityType: 'activities',
          entityId: data?.id,
          newValues: payload,
        });
      }

      resetForm();
      await loadActivities();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save activity.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (act: Activity) => {
    const nextStatus = !act.is_active;
    try {
      const { error } = await supabase
        .from('activities')
        .update({ is_active: nextStatus })
        .eq('id', act.id);
      if (error) throw error;

      await logAuditAction({
        action: 'STATUS_CHANGE',
        entityType: 'activities',
        entityId: act.id,
        oldValues: { is_active: act.is_active },
        newValues: { is_active: nextStatus },
      });

      await loadActivities();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update activity status.');
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
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">Activity Master Configuration</h2>
              <p className="text-[11px] text-stone-500">Configure guest experience activities, pricing, and active status</p>
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
              <span>{editingId ? 'Edit Activity Details' : 'Add New Guest Activity'}</span>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-stone-700 font-medium mb-1">Activity Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Pottery Workshop, Puppet Show"
                  required
                  className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-stone-700 font-medium mb-1">Default Ticket / Ride Price (₹) *</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={defaultPrice}
                  onChange={(e) => setDefaultPrice(Number(e.target.value))}
                  required
                  className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white font-semibold focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-stone-700 font-medium mb-1">Description / Guidelines</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Operational notes, location, or performer details"
                className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-stone-700">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded text-amber-600 focus:ring-amber-500 border-stone-300"
                />
                <span className="font-medium">Active (Available for daily reporting)</span>
              </label>

              <Button type="submit" variant="amber" size="sm" disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update Activity' : 'Create Activity'}
              </Button>
            </div>
          </form>

          {/* Activities List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-stone-700 font-semibold px-1">
              <span>Configured Activities ({activities.length})</span>
              <button
                type="button"
                onClick={loadActivities}
                className="text-stone-400 hover:text-stone-700 flex items-center gap-1 text-[11px]"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {loading ? (
              <div className="py-8 text-center text-stone-400">Loading activities...</div>
            ) : activities.length === 0 ? (
              <div className="py-8 text-center text-stone-400">No activities configured yet.</div>
            ) : (
              <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100 bg-white">
                {activities.map((act) => (
                  <div
                    key={act.id}
                    className={`p-3 flex items-center justify-between gap-4 transition-colors ${
                      !act.is_active ? 'bg-stone-50/60 opacity-70' : 'hover:bg-stone-50/50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-stone-900 text-sm">{act.name}</span>
                        {act.is_active ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="outline">Archived / Inactive</Badge>
                        )}
                        <span className="font-mono font-bold text-amber-700 ml-auto sm:ml-0">
                          {formatINR(act.default_price)}
                        </span>
                      </div>
                      {act.description && (
                        <p className="text-stone-500 text-[11px] mt-0.5 truncate">{act.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(act)}
                        className="h-7 px-2 text-stone-600 hover:text-stone-900"
                        title="Edit activity"
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant={act.is_active ? 'secondary' : 'amber'}
                        size="sm"
                        onClick={() => handleToggleActive(act)}
                        className="h-7 px-2.5 text-[11px]"
                      >
                        {act.is_active ? 'Deactivate' : 'Activate'}
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
