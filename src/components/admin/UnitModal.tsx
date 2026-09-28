'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { Unit } from '@/lib/types/database';
import { X, Plus, Edit2, Check, Power, AlertCircle, RefreshCw, Scale } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
import { BilingualNameInput } from '@/components/admin/BilingualNameInput';

interface UnitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

export function UnitModal({ isOpen, onClose, onUpdated }: UnitModalProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);

  // Form
  const [name, setName] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [symbol, setSymbol] = useState('');
  const [symbolHi, setSymbolHi] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadUnits = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.from('units').select('*').order('name');
      if (error) throw error;
      setUnits(data || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load units.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadUnits();
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setEditingUnit(null);
    setName('');
    setNameHi('');
    setSymbol('');
    setSymbolHi('');
    setErrorMessage(null);
  };

  const handleStartEdit = (u: Unit) => {
    setEditingUnit(u);
    setName(u.name);
    setNameHi(u.name_hi || '');
    setSymbol(u.symbol);
    setSymbolHi(u.symbol_hi || '');
    setErrorMessage(null);
  };

  const handleToggleActive = async (u: Unit) => {
    try {
      const { error } = await supabase
        .from('units')
        .update({ is_active: !u.is_active })
        .eq('id', u.id);
      if (error) throw error;
      loadUnits();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update unit status.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !symbol.trim()) {
      setErrorMessage('Unit Name and Symbol are required.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const payload: any = {
        name: name.trim(),
        name_hi: nameHi && nameHi.trim() ? nameHi.trim() : null,
        symbol: symbol.trim(),
        symbol_hi: symbolHi && symbolHi.trim() ? symbolHi.trim() : null,
      };

      if (editingUnit) {
        const { error } = await supabase
          .from('units')
          .update(payload)
          .eq('id', editingUnit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('units').insert({
          ...payload,
          is_active: true,
        });
        if (error) throw error;
      }

      resetForm();
      loadUnits();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save unit.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-stone-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">Unit of Measure Master</h2>
              <p className="text-xs text-stone-500">
                Standard units for inventory procurement, recipes, and kitchen consumption
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
              <span>
                {editingUnit
                  ? `${locale === 'hi' ? 'इकाई बदलें:' : 'Edit Unit:'} ${getLocalizedMasterName(editingUnit, locale)}`
                  : locale === 'hi'
                  ? 'नई माप इकाई जोड़ें'
                  : 'Add New Unit'}
              </span>
              {editingUnit && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-stone-500 hover:text-stone-800 text-[11px] underline"
                >
                  {locale === 'hi' ? 'रद्द करें' : 'Cancel Edit'}
                </button>
              )}
            </div>

            <BilingualNameInput
              englishName={name}
              onChangeEnglish={(val) => {
                setName(val);
                if (!symbol && val) {
                  const lower = val.toLowerCase().trim();
                  if (lower.includes('kilo')) setSymbol('kg');
                  else if (lower.includes('gram')) setSymbol('g');
                  else if (lower.includes('liter') || lower.includes('litre')) setSymbol('L');
                  else if (lower.includes('piece')) setSymbol('pcs');
                }
              }}
              hindiName={nameHi}
              onChangeHindi={(val) => {
                setNameHi(val);
                if (!symbolHi && val) {
                  if (val.includes('किलो')) setSymbolHi('किग्रा');
                  else if (val.includes('ग्राम')) setSymbolHi('ग्रा');
                  else if (val.includes('लीटर')) setSymbolHi('ली');
                  else if (val.includes('पीस')) setSymbolHi('पीस');
                }
              }}
              entityType="unit"
              englishLabel={locale === 'hi' ? 'इकाई का नाम (अंग्रेज़ी)' : 'Unit Name (English)'}
              hindiLabel={locale === 'hi' ? 'इकाई का नाम (हिंदी)' : 'Unit Name (Hindi)'}
              placeholderEnglish="e.g. Kilogram, Piece, Liter"
              placeholderHindi="उदा. किलोग्राम, पीस, लीटर"
              required
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {locale === 'hi' ? 'प्रतीक / कोड (अंग्रेज़ी)' : 'Symbol / Code (English)'} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="e.g. kg, pcs, L, g"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 font-mono focus:outline-none focus:border-amber-500 bg-white"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {locale === 'hi' ? 'प्रतीक (हिंदी)' : 'Symbol (Hindi)'}
                </label>
                <input
                  type="text"
                  value={symbolHi}
                  onChange={(e) => setSymbolHi(e.target.value)}
                  placeholder="उदा. किग्रा, पीस, ली, ग्रा"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 font-mono focus:outline-none focus:border-amber-500 bg-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="submit" variant="amber" size="sm" disabled={saving}>
                {saving
                  ? locale === 'hi'
                    ? 'सेव हो रहा है...'
                    : 'Saving...'
                  : editingUnit
                  ? locale === 'hi'
                    ? 'बदलाव सेव करें'
                    : 'Save Changes'
                  : locale === 'hi'
                  ? '+ इकाई जोड़ें'
                  : '+ Add Unit'}
              </Button>
            </div>
          </form>

          {/* List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-stone-700 font-semibold border-b pb-1">
              <span>
                {locale === 'hi' ? `माप इकाइयाँ (${units.length})` : `Defined Units (${units.length})`}
              </span>
              <button onClick={loadUnits} className="text-stone-400 hover:text-stone-600 p-1">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

            {loading ? (
              <div className="py-8 text-center text-stone-400 flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />{' '}
                {locale === 'hi' ? 'इकाइयाँ लोड हो रही हैं...' : 'Loading units...'}
              </div>
            ) : (
              <div className="divide-y divide-stone-100 border rounded-lg overflow-hidden bg-white">
                {units.map((u) => (
                  <div
                    key={u.id}
                    className={`p-3 flex items-center justify-between hover:bg-stone-50/80 transition-colors ${
                      !u.is_active ? 'opacity-60 bg-stone-50/50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-stone-800 bg-stone-100 px-2 py-0.5 rounded text-xs">
                        {getLocalizedMasterSymbol(u, locale)}
                      </span>
                      <span className="font-medium text-stone-900">{getLocalizedMasterName(u, locale)}</span>
                      <Badge variant={u.is_active ? 'success' : 'default'}>
                        {u.is_active ? (locale === 'hi' ? 'चालू' : 'Active') : (locale === 'hi' ? 'बंद' : 'Inactive')}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(u)}
                        title="Edit Unit"
                        className="p-1.5 rounded text-stone-500 hover:text-amber-600 hover:bg-stone-100"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(u)}
                        title={u.is_active ? 'Deactivate' : 'Activate'}
                        className={`p-1.5 rounded ${
                          u.is_active
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
