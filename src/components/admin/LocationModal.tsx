'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';
import { BilingualNameInput } from '@/components/admin/BilingualNameInput';
import {
  X,
  Edit2,
  Trash2,
  Power,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  MapPin,
  Search,
} from 'lucide-react';

export interface LocationStockSummary {
  total_items: number;
  positive_items: number;
  total_quantity: number;
}

export interface InventoryLocationRecord {
  id: string;
  code: string;
  name: string;
  name_hi?: string | null;
  location_type: string;
  department_id?: string | null;
  parent_location_id?: string | null;
  is_active: boolean;
  notes?: string | null;
  department?: { id: string; name: string; name_hi?: string | null; code?: string | null };
  stock_summary?: LocationStockSummary;
  has_positive_stock?: boolean;
  has_historical_records?: boolean;
  is_system_reserved?: boolean;
  can_delete?: boolean;
}

export interface DependencyCheckResponse {
  locationId: string;
  code: string;
  name: string;
  name_hi?: string | null;
  isStore: boolean;
  canDelete: boolean;
  currentStock: {
    hasPositiveStock: boolean;
    totalItemsWithStock: number;
    totalQuantity: number;
    items: Array<{
      itemId: string;
      itemName: string;
      itemNameHi?: string | null;
      itemCode: string;
      quantity: number;
      unitSymbol: string;
      unitSymbolHi?: string | null;
    }>;
  };
  historicalReferences: {
    hasReferences: boolean;
    stockMovementsCount: number;
    consumptionIssuesCount: number;
    assetLedgerCount: number;
    childLocationsCount: number;
    totalReferences: number;
  };
}

export const LOCATION_TYPES = [
  { value: 'central_store', labelEn: 'Central Store Room', labelHi: 'सेंट्रल स्टोर रूम' },
  { value: 'kitchen_section', labelEn: 'Kitchen Production Area', labelHi: 'किचन प्रोडक्शन एरिया' },
  { value: 'service_bar', labelEn: 'Beverage Counter / Bar', labelHi: 'बेवरेज काउंटर' },
  { value: 'stall_counter', labelEn: 'Snacks Stall / Counter', labelHi: 'स्नैक्स स्टॉल / काउंटर' },
  { value: 'dining_hall', labelEn: 'Dining Hall', labelHi: 'डाइनिंग हॉल' },
  { value: 'customer_fridge', labelEn: 'Customer Display Fridge', labelHi: 'कस्टमर फ्रिज' },
  { value: 'activity_area', labelEn: 'Entertainment / Activity Area', labelHi: 'एक्टिविटी / मनोरंजन क्षेत्र' },
  { value: 'restroom', labelEn: 'Restroom / Washroom', labelHi: 'शौचालय' },
  { value: 'general_storage', labelEn: 'General Storage', labelHi: 'सामान्य स्टोरेज' },
];

interface LocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  departments?: Array<{ id: string; name: string; name_hi?: string | null; code?: string | null }>;
  onUpdated?: () => void;
}

export function LocationModal({ isOpen, onClose, departments = [], onUpdated }: LocationModalProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();

  // List & Filter State
  const [locations, setLocations] = useState<InventoryLocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('ALL');

  // Form State
  const [editingLocation, setEditingLocation] = useState<InventoryLocationRecord | null>(null);
  const [name, setName] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [isCustomHindi, setIsCustomHindi] = useState(false);
  const [code, setCode] = useState('');
  const [locationType, setLocationType] = useState('kitchen_section');
  const [departmentId, setDepartmentId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Deletion Safeguard State
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState<InventoryLocationRecord | null>(null);
  const [checkingDependencies, setCheckingDependencies] = useState(false);
  const [dependencyData, setDependencyData] = useState<DependencyCheckResponse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 1. Data Fetching
  const loadLocations = async () => {
    setLoading(true);
    setFormError(null);
    try {
      const res = await fetch('/api/admin/inventory/locations');
      if (!res.ok) {
        // Fallback to direct supabase query
        const { data, error } = await supabase
          .from('inventory_locations')
          .select('*, department:departments(id, name, name_hi, code)')
          .order('code');
        if (error) throw error;
        setLocations(data || []);
      } else {
        const json = await res.json();
        setLocations(json.data || json.locations || []);
      }
    } catch (err: any) {
      setFormError(err.message || t('inventory.locations.validation.failedToSave'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLocations();
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setEditingLocation(null);
    setName('');
    setNameHi('');
    setIsCustomHindi(false);
    setCode('');
    setLocationType('kitchen_section');
    setDepartmentId('');
    setIsActive(true);
    setNotes('');
    setFormError(null);
  };

  const handleStartEdit = (loc: InventoryLocationRecord) => {
    setEditingLocation(loc);
    setName(loc.name);
    setNameHi(loc.name_hi || '');
    setIsCustomHindi(Boolean(loc.name_hi));
    setCode(loc.code);
    setLocationType(loc.location_type || 'kitchen_section');
    setDepartmentId(loc.department_id || '');
    setIsActive(loc.is_active !== false);
    setNotes(loc.notes || '');
    setFormError(null);
  };

  // 2. Active/Inactive Toggle
  const handleToggleActive = async (loc: InventoryLocationRecord) => {
    if (loc.code.toUpperCase() === 'STORE') {
      alert(t('inventory.locations.table.cannotDeleteStore'));
      return;
    }
    try {
      const res = await fetch(`/api/admin/inventory/locations/${loc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !loc.is_active }),
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || t('inventory.locations.validation.failedToDeactivate'));
      }
      await loadLocations();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // 3. Form Submit (Create / Edit)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError(t('inventory.locations.nameRequired'));
      return;
    }
    if (!code.trim()) {
      setFormError(t('inventory.locations.codeRequired'));
      return;
    }

    setSaving(true);
    setFormError(null);

    const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const isStore = editingLocation?.code.toUpperCase() === 'STORE';
    const payload = {
      name: name.trim(),
      name_hi: nameHi?.trim() || null,
      code: cleanCode,
      location_type: locationType,
      department_id: departmentId || null,
      is_active: isStore ? true : isActive,
      notes: notes.trim() || null,
    };

    try {
      let res: Response;
      if (editingLocation) {
        res = await fetch(`/api/admin/inventory/locations/${editingLocation.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/admin/inventory/locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || t('inventory.locations.validation.failedToSave'));
      }

      resetForm();
      await loadLocations();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // 4. Deletion Safeguard Initiation
  const handleOpenDeleteDialog = (loc: InventoryLocationRecord) => {
    if (loc.code.toUpperCase() === 'STORE') return;
    setLocationToDelete(loc);
    setDeleteDialogOpen(true);
    setDeleteError(null);
    setCheckingDependencies(true);
    setDependencyData(null);

    fetch(`/api/admin/inventory/locations/${loc.id}?checkDependencies=true`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to verify location dependencies.');
        setDependencyData(data);
      })
      .catch((err) => {
        setDeleteError(err.message);
      })
      .finally(() => {
        setCheckingDependencies(false);
      });
  };

  // 5. Permanent Deletion Execution
  const handleConfirmPermanentDelete = async () => {
    if (!locationToDelete) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/admin/inventory/locations/${locationToDelete.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t('inventory.locations.validation.failedToDelete'));
      }
      setDeleteDialogOpen(false);
      setLocationToDelete(null);
      await loadLocations();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  // 6. Deactivate Instead Execution
  const handleDeactivateInstead = async () => {
    if (!locationToDelete) return;
    setDeactivating(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/admin/inventory/locations/${locationToDelete.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t('inventory.locations.validation.failedToDeactivate'));
      }
      setDeleteDialogOpen(false);
      setLocationToDelete(null);
      await loadLocations();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeactivating(false);
    }
  };

  // Filtered List
  const filteredLocations = useMemo(() => {
    return locations.filter((loc) => {
      const matchesSearch =
        searchQuery === '' ||
        loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (loc.name_hi && loc.name_hi.includes(searchQuery)) ||
        loc.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        loc.location_type.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesType = selectedTypeFilter === 'ALL' || loc.location_type === selectedTypeFilter;
      return matchesSearch && matchesType;
    });
  }, [locations, searchQuery, selectedTypeFilter]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-stone-200 overflow-hidden text-xs">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                {t('inventory.locations.title')}
              </h2>
              <p className="text-stone-500 text-[11px]">
                {t('inventory.locations.subtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200/60"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{formError}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-4">
            <div className="font-semibold text-stone-800 flex items-center justify-between">
              <span className="text-sm">
                {editingLocation
                  ? t('inventory.locations.editLocation', { name: getLocalizedMasterName(editingLocation, locale) })
                  : t('inventory.locations.addNewLocation')}
              </span>
              {editingLocation && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-stone-500 hover:text-stone-800 text-[11px] underline"
                >
                  {t('inventory.locations.cancelEdit')}
                </button>
              )}
            </div>

            {/* Bilingual Name Inputs */}
            <BilingualNameInput
              englishName={name}
              onChangeEnglish={setName}
              hindiName={nameHi}
              onChangeHindi={setNameHi}
              isCustomHindi={isCustomHindi}
              onCustomHindiChange={setIsCustomHindi}
              entityType="location"
              englishLabel={t('inventory.locations.name')}
              hindiLabel={t('inventory.locations.nameHi')}
              placeholderEnglish="e.g. North Lawn Beverage Counter"
              placeholderHindi="उदा. नॉर्थ लॉन बेवरेज काउंटर"
              required
            />

            {/* Code, Type, Department, Active */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {/* Code */}
              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {t('inventory.locations.code')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={editingLocation?.code.toUpperCase() === 'STORE'}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                  placeholder={t('inventory.locations.codePlaceholder')}
                  className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 font-mono uppercase focus:outline-none focus:border-amber-500 bg-white disabled:bg-stone-100 disabled:text-stone-400"
                />
                {editingLocation?.code.toUpperCase() === 'STORE' && (
                  <span className="text-[10px] text-amber-700 mt-0.5 block">
                    {t('inventory.locations.safeguards.reservedStoreTitle')}
                  </span>
                )}
              </div>

              {/* Type */}
              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {t('inventory.locations.type')} <span className="text-rose-500">*</span>
                </label>
                <select
                  value={locationType}
                  onChange={(e) => setLocationType(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 bg-white"
                >
                  {LOCATION_TYPES.map((lt) => (
                    <option key={lt.value} value={lt.value}>
                      {locale === 'hi' ? lt.labelHi : lt.labelEn}
                    </option>
                  ))}
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {t('inventory.locations.department')}
                </label>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 bg-white"
                >
                  <option value="">
                    {locale === 'hi' ? '-- कोई नहीं / पूरे परिसर --' : '-- None / Facility Wide --'}
                  </option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {getLocalizedMasterName(dept, locale)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Active Toggle */}
              <div className="flex flex-col justify-center pt-5">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    disabled={editingLocation?.code.toUpperCase() === 'STORE'}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-stone-300 text-amber-600 focus:ring-amber-500 h-4 w-4"
                  />
                  <span className="font-medium text-stone-800">
                    {t('inventory.locations.active')}
                  </span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="submit" variant="amber" size="sm" disabled={saving}>
                {saving
                  ? t('inventory.locations.saving')
                  : editingLocation
                  ? t('inventory.locations.saveChanges')
                  : t('inventory.locations.save')}
              </Button>
            </div>
          </form>

          {/* Locations Table / List */}
          <div className="space-y-3">
            {/* Table Filter Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('inventory.locations.searchPlaceholder')}
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-stone-200 text-stone-900 focus:outline-none focus:border-amber-500 bg-white text-xs"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={selectedTypeFilter}
                  onChange={(e) => setSelectedTypeFilter(e.target.value)}
                  className="rounded-lg border border-stone-200 px-2.5 py-1.5 bg-white text-stone-700 text-xs focus:outline-none focus:border-amber-500"
                >
                  <option value="ALL">{locale === 'hi' ? 'सभी प्रकार' : 'All Types'}</option>
                  {LOCATION_TYPES.map((lt) => (
                    <option key={lt.value} value={lt.value}>
                      {locale === 'hi' ? lt.labelHi : lt.labelEn}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={loadLocations}
                  title="Refresh"
                  className="p-1.5 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Table */}
            {loading ? (
              <div className="py-12 text-center text-stone-400 flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
                <span>{t('inventory.locations.loading')}</span>
              </div>
            ) : filteredLocations.length === 0 ? (
              <div className="py-10 text-center text-stone-400 bg-stone-50 rounded-xl border border-stone-100">
                {t('inventory.locations.noLocations')}
              </div>
            ) : (
              <div className="border border-stone-200 rounded-xl overflow-hidden bg-white shadow-xs">
                <table className="w-full text-left divide-y divide-stone-200">
                  <thead className="bg-stone-50 font-semibold text-stone-600">
                    <tr>
                      <th className="px-3 py-2.5">{t('inventory.locations.table.code')}</th>
                      <th className="px-3 py-2.5">{t('inventory.locations.table.name')}</th>
                      <th className="px-3 py-2.5">{t('inventory.locations.table.type')}</th>
                      <th className="px-3 py-2.5">{t('inventory.locations.table.department')}</th>
                      <th className="px-3 py-2.5 text-center">{t('inventory.locations.table.stock')}</th>
                      <th className="px-3 py-2.5 text-center">{t('inventory.locations.table.status')}</th>
                      <th className="px-3 py-2.5 text-right">{t('inventory.locations.table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredLocations.map((loc) => {
                      const isStore = loc.code.toUpperCase() === 'STORE';
                      const posItems = loc.stock_summary?.positive_items || 0;
                      return (
                        <tr
                          key={loc.id}
                          className={`hover:bg-stone-50/80 transition-colors ${
                            !loc.is_active ? 'opacity-60 bg-stone-50/40' : ''
                          }`}
                        >
                          <td className="px-3 py-2 font-mono font-bold text-stone-900">
                            <span className="bg-stone-100 px-2 py-0.5 rounded border border-stone-200 text-[11px]">
                              {loc.code}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-medium text-stone-900 block">
                              {getLocalizedMasterName(loc, locale)}
                            </span>
                            {locale === 'hi' && loc.name && (
                              <span className="text-[10px] text-stone-400 block">{loc.name}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className="px-2 py-0.5 bg-stone-100 text-stone-700 rounded text-[10px] font-medium capitalize">
                              {loc.location_type.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-stone-600">
                            {loc.department ? getLocalizedMasterName(loc.department, locale) : '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {posItems > 0 ? (
                              <Badge variant="warning">
                                {t('inventory.locations.table.activeStockCount', { count: posItems })}
                              </Badge>
                            ) : (
                              <span className="text-stone-400 font-mono text-[10px]">
                                {t('inventory.locations.table.noStock')}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant={loc.is_active ? 'success' : 'default'}>
                              {loc.is_active
                                ? t('inventory.locations.active')
                                : t('inventory.locations.inactive')}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(loc)}
                                title={t('inventory.locations.table.edit')}
                                className="p-1 rounded text-stone-500 hover:text-amber-600 hover:bg-stone-100 cursor-pointer"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isStore}
                                onClick={() => handleToggleActive(loc)}
                                title={
                                  isStore
                                    ? t('inventory.locations.validation.cannotDeactivateStore')
                                    : loc.is_active
                                    ? t('inventory.locations.deactivate')
                                    : t('inventory.locations.activate')
                                }
                                className={`p-1 rounded cursor-pointer ${
                                  isStore
                                    ? 'opacity-30 cursor-not-allowed text-stone-400'
                                    : loc.is_active
                                    ? 'text-stone-400 hover:text-rose-600 hover:bg-rose-50'
                                    : 'text-stone-400 hover:text-emerald-600 hover:bg-emerald-50'
                                }`}
                              >
                                <Power className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isStore}
                                onClick={() => handleOpenDeleteDialog(loc)}
                                title={isStore ? t('inventory.locations.table.cannotDeleteStore') : t('inventory.locations.delete')}
                                className={`p-1 rounded cursor-pointer ${
                                  isStore
                                    ? 'opacity-30 cursor-not-allowed text-stone-300'
                                    : 'text-stone-400 hover:text-rose-600 hover:bg-rose-50'
                                }`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 flex justify-end bg-stone-50">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {locale === 'hi' ? 'पूर्ण' : 'Done'}
          </Button>
        </div>
      </div>

      {/* DELETION SAFEGUARD DIALOG */}
      {deleteDialogOpen && locationToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden text-xs border border-stone-200">
            {/* Dialog Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-rose-100 bg-rose-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-rose-100 text-rose-700 rounded-lg">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-stone-900">
                    {t('inventory.locations.safeguards.deleteModalTitle')}
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    {t('inventory.locations.safeguards.checking')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(false)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Dialog Content */}
            <div className="p-6 space-y-4">
              {/* Target Location Card */}
              <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="font-mono font-bold text-stone-900 text-xs bg-stone-200 px-2 py-0.5 rounded mr-2">
                    {locationToDelete.code}
                  </span>
                  <span className="font-bold text-stone-900 text-sm">
                    {getLocalizedMasterName(locationToDelete, locale)}
                  </span>
                </div>
                <Badge variant="outline">{locationToDelete.location_type.replace('_', ' ')}</Badge>
              </div>

              {/* Loading State */}
              {checkingDependencies && (
                <div className="py-8 flex flex-col items-center justify-center gap-2 text-stone-500">
                  <RefreshCw className="h-5 w-5 animate-spin text-amber-600" />
                  <span>{t('inventory.locations.safeguards.checking')}</span>
                </div>
              )}

              {/* Error Message */}
              {deleteError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{deleteError}</span>
                </div>
              )}

              {/* Safeguard Results */}
              {!checkingDependencies && dependencyData && (
                <>
                  {/* Scenario 1: Non-Zero Current Stock */}
                  {dependencyData.currentStock.hasPositiveStock && (
                    <div className="space-y-3">
                      <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-rose-900">
                        <div className="flex items-center gap-2 font-bold text-rose-900">
                          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                          {t('inventory.locations.safeguards.hasStockTitle')}
                        </div>
                        <p className="text-[11px] leading-relaxed">
                          {t('inventory.locations.safeguards.hasStockDesc', {
                            count: dependencyData.currentStock.totalItemsWithStock,
                          })}
                        </p>
                      </div>

                      {/* Affected Items Table */}
                      <div className="border border-stone-200 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold flex items-center justify-between text-[11px]">
                          <span>
                            {locale === 'hi' ? 'प्रभावित सामग्री और वर्तमान स्टॉक' : 'Affected Items & Balances'} (
                            {dependencyData.currentStock.items.length})
                          </span>
                        </div>
                        <div className="max-h-40 overflow-y-auto divide-y divide-stone-100">
                          {dependencyData.currentStock.items.map((item) => (
                            <div
                              key={item.itemId}
                              className="px-3 py-2 flex items-center justify-between text-[11px]"
                            >
                              <div>
                                <span className="font-mono text-stone-500 mr-1.5">[{item.itemCode}]</span>
                                <span className="text-stone-800 font-medium">
                                  {locale === 'hi' && item.itemNameHi ? item.itemNameHi : item.itemName}
                                </span>
                              </div>
                              <span className="font-mono font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                {item.quantity} {locale === 'hi' && item.unitSymbolHi ? item.unitSymbolHi : item.unitSymbol}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <p className="text-[10px] text-stone-400 italic">
                        {t('inventory.locations.safeguards.noAutoZeroNotice')}
                      </p>
                    </div>
                  )}

                  {/* Scenario 2: Zero Stock, but Historical References Exist */}
                  {!dependencyData.currentStock.hasPositiveStock &&
                    dependencyData.historicalReferences.hasReferences && (
                      <div className="space-y-3">
                        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-amber-900">
                          <div className="flex items-center gap-2 font-bold text-amber-900">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                            {t('inventory.locations.safeguards.hasHistoryTitle')}
                          </div>
                          <p className="text-[11px] leading-relaxed">
                            {t('inventory.locations.safeguards.hasHistoryDesc', {
                              total: dependencyData.historicalReferences.totalReferences,
                            })}
                          </p>
                        </div>

                        {/* Breakdown */}
                        <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100 text-[11px]">
                          <div className="px-3 py-2 bg-stone-50 text-stone-700 font-semibold">
                            {locale === 'hi' ? 'ऐतिहासिक संदर्भ सारांश' : 'Historical Reference Breakdown'}
                          </div>
                          <div className="px-3 py-1.5 flex justify-between">
                            <span className="text-stone-600">
                              {t('inventory.locations.safeguards.historyMovements', {
                                count: dependencyData.historicalReferences.stockMovementsCount,
                              })}
                            </span>
                          </div>
                          <div className="px-3 py-1.5 flex justify-between">
                            <span className="text-stone-600">
                              {t('inventory.locations.safeguards.historyIssues', {
                                count: dependencyData.historicalReferences.consumptionIssuesCount,
                              })}
                            </span>
                          </div>
                          <div className="px-3 py-1.5 flex justify-between">
                            <span className="text-stone-600">
                              {t('inventory.locations.safeguards.historyAssets', {
                                count: dependencyData.historicalReferences.assetLedgerCount,
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                  {/* Scenario 3: Pristine / Safe to Permanently Delete */}
                  {dependencyData.canDelete && (
                    <div className="space-y-3">
                      <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-rose-900">
                        <div className="flex items-center gap-2 font-bold text-rose-900">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                          {t('inventory.locations.safeguards.safeDeleteTitle')}
                        </div>
                        <p className="text-[11px] leading-relaxed">
                          {t('inventory.locations.safeguards.safeDeleteDesc', {
                            name: locationToDelete.name,
                            code: locationToDelete.code,
                          })}
                        </p>
                      </div>

                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-[11px] flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span>{t('inventory.locations.safeguards.irreversibleWarning')}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Dialog Footer Actions */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-stone-200 bg-stone-50/50">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteDialogOpen(false)}
                disabled={deleting || deactivating}
              >
                {t('inventory.locations.cancel')}
              </Button>

              <div className="flex items-center gap-2">
                {!checkingDependencies && dependencyData && (
                  <>
                    {/* Deactivate Instead button when historical references exist */}
                    {!dependencyData.currentStock.hasPositiveStock &&
                      dependencyData.historicalReferences.hasReferences && (
                        <Button
                          type="button"
                          variant="amber"
                          size="sm"
                          onClick={handleDeactivateInstead}
                          disabled={deactivating}
                          className="gap-1.5"
                        >
                          {deactivating ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                          {t('inventory.locations.safeguards.deactivateInsteadBtn')}
                        </Button>
                      )}

                    {/* Permanent Delete button when eligible */}
                    {dependencyData.canDelete && (
                      <button
                        type="button"
                        onClick={handleConfirmPermanentDelete}
                        disabled={deleting}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-lg text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {deleting ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        {t('inventory.locations.safeguards.confirmDeleteBtn')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
