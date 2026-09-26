'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { X, Plus, Edit2, Check, Power, AlertCircle, RefreshCw, CreditCard } from 'lucide-react';

interface PaymentMethod {
  id: string;
  name: string;
  name_hi?: string | null;
  commission_percent: number | string;
  is_active: boolean;
}

interface PaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

export function PaymentMethodModal({ isOpen, onClose, onUpdated }: PaymentMethodModalProps) {
  const supabase = createClient();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [commissionPercent, setCommissionPercent] = useState<number | string>('0.00');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMethods = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('*')
        .order('name');
      if (error) throw error;
      setMethods(data || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load payment methods.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadMethods();
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setEditingMethod(null);
    setName('');
    setNameHi('');
    setCommissionPercent('0.00');
    setIsActive(true);
    setErrorMessage(null);
  };

  const handleStartEdit = (pm: PaymentMethod) => {
    setEditingMethod(pm);
    setName(pm.name);
    setNameHi(pm.name_hi || '');
    setCommissionPercent(pm.commission_percent || '0.00');
    setIsActive(pm.is_active);
    setErrorMessage(null);
  };

  const handleToggleStatus = async (pm: PaymentMethod) => {
    try {
      const { error } = await supabase
        .from('payment_methods')
        .update({ is_active: !pm.is_active })
        .eq('id', pm.id);
      if (error) throw error;
      await loadMethods();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to toggle status.');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Payment method name is required.');
      return;
    }

    const commVal = Number(commissionPercent);
    if (isNaN(commVal) || commVal < 0 || commVal > 100) {
      setErrorMessage('Commission / MDR must be between 0% and 100%.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      if (editingMethod) {
        const { error } = await supabase
          .from('payment_methods')
          .update({
            name: name.trim(),
            name_hi: nameHi.trim() || null,
            commission_percent: commVal.toFixed(2),
            is_active: isActive,
          })
          .eq('id', editingMethod.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('payment_methods')
          .insert({
            name: name.trim(),
            name_hi: nameHi.trim() || null,
            commission_percent: commVal.toFixed(2),
            is_active: isActive,
          });
        if (error) throw error;
      }

      resetForm();
      await loadMethods();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save payment method.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 bg-stone-50/50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">Payment Methods &amp; Channel Commission</h2>
              <p className="text-xs text-stone-500">Configure MDR, delivery commission (Lancho 15–20%), and payment gateways</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSave} className="p-4 bg-stone-50 border border-stone-200 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-stone-700">
                {editingMethod ? `Edit Method: ${editingMethod.name}` : 'Add New Payment Method / Channel'}
              </h3>
              {editingMethod && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-amber-700 hover:underline font-semibold"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Method Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Lancho, Card, UPI"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-amber-500 bg-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Hindi Name</label>
                <input
                  type="text"
                  placeholder="e.g. लांचो, कार्ड"
                  value={nameHi}
                  onChange={(e) => setNameHi(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-amber-500 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Commission / MDR % *</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="e.g. 18.00"
                    value={commissionPercent}
                    onChange={(e) => setCommissionPercent(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-amber-500 bg-white font-mono"
                    required
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-bold">%</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-stone-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500 h-4 w-4"
                />
                <span>Active Status</span>
              </label>

              <Button type="submit" variant="primary" size="sm" disabled={saving}>
                {saving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : editingMethod ? (
                  <Check className="w-3.5 h-3.5 mr-1.5" />
                ) : (
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                )}
                {editingMethod ? 'Save Changes' : 'Add Method'}
              </Button>
            </div>
          </form>

          {/* List */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-700">Existing Methods</h3>
            {loading ? (
              <div className="py-8 text-center text-xs text-stone-400">Loading payment methods...</div>
            ) : methods.length === 0 ? (
              <div className="py-8 text-center text-xs text-stone-400">No payment methods configured.</div>
            ) : (
              <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
                {methods.map((pm) => (
                  <div key={pm.id} className="p-3 flex items-center justify-between bg-white hover:bg-stone-50/50">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-stone-900">{pm.name}</span>
                        {pm.name_hi && (
                          <span className="text-[11px] text-stone-500 font-medium">({pm.name_hi})</span>
                        )}
                        <Badge
                          variant={pm.is_active ? 'success' : 'outline'}
                          className="text-[9px] px-1.5 py-0"
                        >
                          {pm.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="text-[11px] font-mono text-stone-600">
                        Commission / MDR: <span className="font-bold text-amber-800">{pm.commission_percent}%</span>
                        {pm.name.toLowerCase() === 'lancho' && (
                          <span className="ml-2 text-[10px] text-stone-400 font-sans">(Variable operating cost applied to Lancho sales)</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartEdit(pm)}
                        title="Edit method"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-stone-600" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleStatus(pm)}
                        title={pm.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <Power
                          className={`w-3.5 h-3.5 ${
                            pm.is_active ? 'text-emerald-600 hover:text-red-600' : 'text-stone-400 hover:text-emerald-600'
                          }`}
                        />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-100 bg-stone-50/50 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
