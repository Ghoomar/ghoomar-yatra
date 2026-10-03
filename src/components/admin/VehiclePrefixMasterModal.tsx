'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { VehicleRegistrationPrefix } from '@/lib/types/database';
import { buildPrefixLookupMap, resolveSinglePrefix } from '@/lib/gate/prefix-resolver';
import { logAuditAction } from '@/lib/audit-logger';
import { useI18n } from '@/lib/i18n/context';
import {
  X,
  Plus,
  Edit2,
  Check,
  Power,
  AlertCircle,
  RefreshCw,
  Car,
  Search,
  CheckCircle2,
  Calendar,
  History,
  ArrowRight,
} from 'lucide-react';

interface VehiclePrefixMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

interface GateVehicleEventRow {
  id: string;
  business_date: string;
  timestamp: string;
  increment: number;
  vehicle_prefix: string | null;
  location: {
    id: string;
    name: string;
  } | null;
}

export function VehiclePrefixMasterModal({
  isOpen,
  onClose,
  onUpdated,
}: VehiclePrefixMasterModalProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();

  const [activeTab, setActiveTab] = useState<'prefixes' | 'corrections'>('prefixes');

  // Master Prefixes state
  const [prefixes, setPrefixes] = useState<VehicleRegistrationPrefix[]>([]);
  const [loadingPrefixes, setLoadingPrefixes] = useState(true);
  const [prefixSearch, setPrefixSearch] = useState('');
  const [editingPrefix, setEditingPrefix] = useState<VehicleRegistrationPrefix | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  // Prefix Form state
  const [formPrefix, setFormPrefix] = useState('');
  const [formLocationName, setFormLocationName] = useState('');
  const [formNameHi, setFormNameHi] = useState('');
  const [formState, setFormState] = useState('');
  const [formDistrict, setFormDistrict] = useState('');
  const [formLatitude, setFormLatitude] = useState('');
  const [formLongitude, setFormLongitude] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [savingPrefix, setSavingPrefix] = useState(false);
  const [prefixError, setPrefixError] = useState<string | null>(null);

  // Gate Events Corrections state
  const [events, setEvents] = useState<GateVehicleEventRow[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [filterDate, setFilterDate] = useState<string>('');
  const [filterQuery, setFilterQuery] = useState('');
  const [eventToCorrect, setEventToCorrect] = useState<GateVehicleEventRow | null>(null);
  const [newPrefixInput, setNewPrefixInput] = useState('');
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionSuccessMsg, setCorrectionSuccessMsg] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  // Load Prefixes
  const loadPrefixes = async () => {
    setLoadingPrefixes(true);
    setPrefixError(null);
    try {
      const { data, error } = await supabase
        .from('vehicle_registration_prefixes')
        .select('*')
        .order('prefix', { ascending: true });

      if (error) throw error;
      setPrefixes(data || []);
    } catch (err: any) {
      setPrefixError(err.message || 'Failed to load registration prefixes.');
    } finally {
      setLoadingPrefixes(false);
    }
  };

  // Lookup map for live resolution preview
  const prefixMap = useMemo(() => {
    return buildPrefixLookupMap(prefixes);
  }, [prefixes]);

  // Load Gate Events for Correction
  const loadEvents = async () => {
    setLoadingEvents(true);
    setCorrectionError(null);
    try {
      let query = supabase
        .from('vehicle_counter_events')
        .select('id, business_date, timestamp, increment, vehicle_prefix, location:vehicle_origin_locations(id, name)')
        .order('timestamp', { ascending: false })
        .limit(50);

      if (filterDate) {
        query = query.eq('business_date', filterDate);
      }

      if (filterQuery.trim()) {
        query = query.ilike('vehicle_prefix', `%${filterQuery.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setEvents((data as any) || []);
    } catch (err: any) {
      setCorrectionError(err.message || 'Failed to load gate events.');
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadPrefixes();
      loadEvents();
      resetPrefixForm();
    }
  }, [isOpen]);

  // Reset Form
  const resetPrefixForm = () => {
    setEditingPrefix(null);
    setIsAddingNew(false);
    setFormPrefix('');
    setFormLocationName('');
    setFormNameHi('');
    setFormState('');
    setFormDistrict('');
    setFormLatitude('');
    setFormLongitude('');
    setFormIsActive(true);
    setPrefixError(null);
  };

  const handleStartEdit = (p: VehicleRegistrationPrefix) => {
    setIsAddingNew(true);
    setEditingPrefix(p);
    setFormPrefix(p.prefix);
    setFormLocationName(p.location_name);
    setFormNameHi(p.name_hi || '');
    setFormState(p.state);
    setFormDistrict(p.district || '');
    setFormLatitude(p.latitude != null ? String(p.latitude) : '');
    setFormLongitude(p.longitude != null ? String(p.longitude) : '');
    setFormIsActive(p.is_active !== false);
    setPrefixError(null);
  };

  const handleToggleActive = async (p: VehicleRegistrationPrefix) => {
    try {
      const updatedStatus = !p.is_active;
      const { error } = await supabase
        .from('vehicle_registration_prefixes')
        .update({ is_active: updatedStatus })
        .eq('id', p.id);

      if (error) throw error;

      await logAuditAction({
        action: 'UPDATE',
        entityType: 'vehicle_registration_prefix',
        entityId: p.id,
        oldValues: { is_active: p.is_active },
        newValues: { is_active: updatedStatus },
        details: { prefix: p.prefix, location_name: p.location_name },
      });

      loadPrefixes();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setPrefixError(err.message || 'Failed to update prefix status.');
    }
  };

  const handleSavePrefix = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPrefix = formPrefix.trim().toUpperCase();
    const cleanLocName = formLocationName.trim();
    const cleanState = formState.trim();

    if (!cleanPrefix || !cleanLocName || !cleanState) {
      setPrefixError('Prefix, Location Name, and State are required.');
      return;
    }

    setSavingPrefix(true);
    setPrefixError(null);

    try {
      const payload: any = {
        prefix: cleanPrefix,
        location_name: cleanLocName,
        name_hi: formNameHi.trim() || null,
        state: cleanState,
        district: formDistrict.trim() || null,
        latitude: formLatitude.trim() ? parseFloat(formLatitude.trim()) : null,
        longitude: formLongitude.trim() ? parseFloat(formLongitude.trim()) : null,
        is_active: formIsActive,
      };

      if (editingPrefix) {
        const { error } = await supabase
          .from('vehicle_registration_prefixes')
          .update(payload)
          .eq('id', editingPrefix.id);
        if (error) throw error;

        await logAuditAction({
          action: 'UPDATE',
          entityType: 'vehicle_registration_prefix',
          entityId: editingPrefix.id,
          oldValues: editingPrefix,
          newValues: payload,
          details: { prefix: cleanPrefix },
        });
      } else {
        const { data: newRow, error } = await supabase
          .from('vehicle_registration_prefixes')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;

        await logAuditAction({
          action: 'CREATE',
          entityType: 'vehicle_registration_prefix',
          entityId: newRow?.id,
          newValues: payload,
          details: { prefix: cleanPrefix },
        });
      }

      resetPrefixForm();
      loadPrefixes();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setPrefixError(err.message || 'Failed to save prefix mapping.');
    } finally {
      setSavingPrefix(false);
    }
  };

  // Submit Gate Event Correction
  const handleSaveCorrection = async () => {
    if (!eventToCorrect) return;
    const cleanNewPrefix = newPrefixInput.trim().toUpperCase();
    if (!cleanNewPrefix) {
      setCorrectionError('Please enter a valid prefix (e.g. UP21).');
      return;
    }

    setSavingCorrection(true);
    setCorrectionError(null);
    setCorrectionSuccessMsg(null);

    try {
      const oldPrefix = eventToCorrect.vehicle_prefix;

      // 1. Invoke protected server-side admin API endpoint (verifies admin privilege and writes to audit_logs)
      const res = await fetch('/api/admin/operations/gate/correct-prefix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventId: eventToCorrect.id,
          newPrefix: cleanNewPrefix,
        }),
      });

      const resJson = await res.json();
      if (!res.ok) {
        throw new Error(resJson.error || 'Failed to correct gate event.');
      }

      setCorrectionSuccessMsg(
        locale === 'hi'
          ? `गेट इवेंट अपडेट हो गया: ${oldPrefix || '(खाली)'} ➔ ${cleanNewPrefix}`
          : `Gate event corrected: ${oldPrefix || '(empty)'} ➔ ${cleanNewPrefix}`
      );

      setEventToCorrect(null);
      setNewPrefixInput('');
      loadEvents();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setCorrectionError(err.message || 'Failed to correct gate event.');
    } finally {
      setSavingCorrection(false);
    }
  };

  // Filtered prefix list
  const filteredPrefixes = useMemo(() => {
    if (!prefixSearch.trim()) return prefixes;
    const q = prefixSearch.toLowerCase().trim();
    return prefixes.filter(
      (p) =>
        p.prefix.toLowerCase().includes(q) ||
        p.location_name.toLowerCase().includes(q) ||
        (p.name_hi && p.name_hi.toLowerCase().includes(q)) ||
        (p.district && p.district.toLowerCase().includes(q)) ||
        p.state.toLowerCase().includes(q)
    );
  }, [prefixes, prefixSearch]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-stone-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-100 text-amber-800">
              <Car className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                {locale === 'hi'
                  ? 'कार ऑरिजिन व रजिस्ट्रेशन प्रीफिक्स मास्टर'
                  : 'Car Origins & Vehicle Prefix Master'}
              </h2>
              <p className="text-xs text-stone-500">
                {locale === 'hi'
                  ? 'रजिस्ट्रेशन प्रीफिक्स मैपिंग और गेट इवेंट्स में नंबर-प्लेट सुधार'
                  : 'Registration prefix geographical mapping & admin correction tool'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-200/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-stone-200 px-6 bg-stone-50/50">
          <button
            onClick={() => {
              setActiveTab('prefixes');
              setCorrectionSuccessMsg(null);
            }}
            className={`py-3 px-4 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
              activeTab === 'prefixes'
                ? 'border-amber-600 text-amber-700 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            {locale === 'hi'
              ? `प्रीफिक्स मैपिंग (${prefixes.length})`
              : `Prefix Mappings (${prefixes.length})`}
          </button>
          <button
            onClick={() => {
              setActiveTab('corrections');
              setCorrectionSuccessMsg(null);
            }}
            className={`py-3 px-4 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
              activeTab === 'corrections'
                ? 'border-amber-600 text-amber-700 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            {locale === 'hi' ? 'गेट इवेंट सुधार (Admin Tool)' : 'Gate Event Corrections (Admin)'}
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* TAB 1: PREFIX MAPPINGS */}
          {activeTab === 'prefixes' && (
            <div className="space-y-4">
              {prefixError && (
                <div className="p-3 bg-red-50 text-red-700 rounded-xl text-xs flex items-center gap-2 border border-red-200">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{prefixError}</span>
                </div>
              )}

              {/* Form / Actions */}
              {isAddingNew ? (
                <form
                  onSubmit={handleSavePrefix}
                  className="p-4 bg-amber-50/40 rounded-xl border border-amber-200/70 space-y-3"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-amber-200/60">
                    <span className="text-xs font-bold text-stone-800">
                      {editingPrefix
                        ? locale === 'hi'
                          ? `प्रीफिक्स संपादित करें: ${editingPrefix.prefix}`
                          : `Edit Prefix: ${editingPrefix.prefix}`
                        : locale === 'hi'
                        ? 'नया प्रीफिक्स जोड़ें'
                        : 'Add New Prefix Mapping'}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={resetPrefixForm}
                      className="h-6 text-xs text-stone-500"
                    >
                      {locale === 'hi' ? 'रद्द करें' : 'Cancel'}
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">
                        Prefix Code * (e.g. UP21, DL08)
                      </label>
                      <input
                        type="text"
                        value={formPrefix}
                        onChange={(e) => setFormPrefix(e.target.value.toUpperCase())}
                        maxLength={6}
                        placeholder="UP21"
                        required
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 font-mono uppercase focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">
                        Location Name (English) *
                      </label>
                      <input
                        type="text"
                        value={formLocationName}
                        onChange={(e) => setFormLocationName(e.target.value)}
                        placeholder="Moradabad"
                        required
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">
                        स्थान नाम (हिंदी)
                      </label>
                      <input
                        type="text"
                        value={formNameHi}
                        onChange={(e) => setFormNameHi(e.target.value)}
                        placeholder="मुरादाबाद"
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">
                        District (जि़ला)
                      </label>
                      <input
                        type="text"
                        value={formDistrict}
                        onChange={(e) => setFormDistrict(e.target.value)}
                        placeholder="Moradabad"
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">State *</label>
                      <input
                        type="text"
                        value={formState}
                        onChange={(e) => setFormState(e.target.value)}
                        placeholder="Uttar Pradesh"
                        required
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="block font-semibold text-stone-700 mb-1">Latitude</label>
                        <input
                          type="number"
                          step="any"
                          value={formLatitude}
                          onChange={(e) => setFormLatitude(e.target.value)}
                          placeholder="28.838"
                          className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-mono"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block font-semibold text-stone-700 mb-1">Longitude</label>
                        <input
                          type="number"
                          step="any"
                          value={formLongitude}
                          onChange={(e) => setFormLongitude(e.target.value)}
                          placeholder="78.776"
                          className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-stone-700">
                      <input
                        type="checkbox"
                        checked={formIsActive}
                        onChange={(e) => setFormIsActive(e.target.checked)}
                        className="rounded text-amber-600 focus:ring-amber-500"
                      />
                      <span>Active for resolution</span>
                    </label>

                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={savingPrefix}
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      {savingPrefix ? (
                        <>
                          <RefreshCw className="h-3 w-3 animate-spin mr-1.5" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Check className="h-3.5 w-3.5 mr-1.5" />
                          {editingPrefix ? 'Update Prefix' : 'Save Prefix'}
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-stone-400" />
                    <input
                      type="text"
                      value={prefixSearch}
                      onChange={(e) => setPrefixSearch(e.target.value)}
                      placeholder={
                        locale === 'hi'
                          ? 'प्रीफिक्स या शहर खोजें...'
                          : 'Search prefix, city, state...'
                      }
                      className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-stone-200 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                    />
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      resetPrefixForm();
                      setIsAddingNew(true);
                    }}
                    className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shadow-2xs text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {locale === 'hi' ? 'नया प्रीफिक्स जोड़ें' : 'Add Prefix Mapping'}
                  </Button>
                </div>
              )}

              {/* Prefixes Table */}
              <div className="border border-stone-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Prefix</th>
                      <th className="py-2.5 px-3">Location (English / Hindi)</th>
                      <th className="py-2.5 px-3">District / State</th>
                      <th className="py-2.5 px-3">Coordinates</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 font-normal">
                    {loadingPrefixes ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-stone-400">
                          <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1.5 text-amber-600" />
                          Loading prefix master...
                        </td>
                      </tr>
                    ) : filteredPrefixes.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-stone-400">
                          No registration prefixes found matching query.
                        </td>
                      </tr>
                    ) : (
                      filteredPrefixes.map((p) => (
                        <tr
                          key={p.id}
                          className={`hover:bg-amber-50/20 transition-colors ${
                            p.is_active === false ? 'opacity-50 bg-stone-50/50' : ''
                          }`}
                        >
                          <td className="py-2.5 px-3 font-mono font-bold text-stone-900">
                            {p.prefix}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-semibold text-stone-800">{p.location_name}</span>
                            {p.name_hi && (
                              <span className="text-stone-500 block text-[11px]">{p.name_hi}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-stone-600">
                            {p.district ? `${p.district}, ` : ''}
                            {p.state}
                          </td>
                          <td className="py-2.5 px-3 text-stone-400 font-mono text-[11px]">
                            {p.latitude && p.longitude
                              ? `${p.latitude.toFixed(2)}, ${p.longitude.toFixed(2)}`
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <Badge
                              variant={p.is_active !== false ? 'success' : 'outline'}
                              className="text-[10px]"
                            >
                              {p.is_active !== false ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleStartEdit(p)}
                                title="Edit"
                                className="p-1 rounded hover:bg-stone-200 text-stone-500 transition-colors"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleToggleActive(p)}
                                title={p.is_active !== false ? 'Deactivate' : 'Activate'}
                                className="p-1 rounded hover:bg-stone-200 text-stone-500 transition-colors"
                              >
                                <Power className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: GATE EVENT CORRECTIONS */}
          {activeTab === 'corrections' && (
            <div className="space-y-4">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-600 space-y-1">
                <span className="font-bold text-stone-800 flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-amber-600" />
                  {locale === 'hi'
                    ? 'एडमिन गेट इवेंट सुधार टूल (Audit Trail Verified)'
                    : 'Admin Gate Event Correction Tool (Central Audit Trail)'}
                </span>
                <p>
                  {locale === 'hi'
                    ? 'गार्ड द्वारा गलत दर्ज किए गए प्रीफिक्स (जैसे IP21 को UP21, DL80 को DL08) को सीधे सही करें। सभी बदलाव सिस्टम ऑडिट ट्रेल में हमेशा के लिए दर्ज होते हैं।'
                    : 'Correct human typing mistakes from guard entry (e.g. IP21 ➔ UP21, DL80 ➔ DL08). Authoritative event data is updated directly, and full mutation history is preserved in the Central Audit Trail.'}
                </p>
              </div>

              {correctionSuccessMsg && (
                <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs flex items-center gap-2 border border-emerald-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{correctionSuccessMsg}</span>
                </div>
              )}

              {correctionError && (
                <div className="p-3 bg-red-50 text-red-700 rounded-xl text-xs flex items-center gap-2 border border-red-200">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{correctionError}</span>
                </div>
              )}

              {/* Correction Form Modal / Prompt if event selected */}
              {eventToCorrect && (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-300 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-amber-200">
                    <span className="text-xs font-bold text-amber-900">
                      Correct Gate Event Prefix:
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEventToCorrect(null)}
                      className="h-6 text-xs text-stone-500"
                    >
                      Cancel
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-stone-500 block mb-1">Current Event Details:</span>
                      <div className="p-2.5 bg-white rounded-lg border border-stone-200 font-mono text-[11px] space-y-1">
                        <div>
                          <strong>Date:</strong> {eventToCorrect.business_date}
                        </div>
                        <div>
                          <strong>Current Prefix:</strong>{' '}
                          <span className="text-red-600 font-bold">
                            {eventToCorrect.vehicle_prefix || '(None)'}
                          </span>
                        </div>
                        <div>
                          <strong>Location:</strong> {eventToCorrect.location?.name || 'Car'}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block font-semibold text-stone-800">
                        New Corrected Prefix *
                      </label>
                      <input
                        type="text"
                        value={newPrefixInput}
                        onChange={(e) => setNewPrefixInput(e.target.value.toUpperCase())}
                        maxLength={6}
                        placeholder="UP21"
                        autoFocus
                        className="w-full px-3 py-1.5 rounded-lg border border-amber-400 font-mono font-bold text-stone-900 uppercase focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
                      />

                      {/* Live Resolution Preview */}
                      {newPrefixInput.trim() && (
                        <div className="p-2 bg-white rounded-lg border border-stone-200 text-[11px] flex items-center gap-1.5">
                          <span className="text-stone-400">Resolves to:</span>
                          {(() => {
                            const res = resolveSinglePrefix(newPrefixInput, prefixMap, locale);
                            return res.isUnmapped ? (
                              <span className="text-amber-700 font-semibold">
                                {res.locationName} (Unmapped)
                              </span>
                            ) : (
                              <span className="text-emerald-700 font-bold">
                                {res.locationName}
                              </span>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEventToCorrect(null)}
                      className="text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleSaveCorrection}
                      disabled={savingCorrection || !newPrefixInput.trim()}
                      className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5"
                    >
                      {savingCorrection ? (
                        <>
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Save Correction &amp; Audit Log
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Event Search Filters */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs">
                  <Calendar className="h-3.5 w-3.5 text-stone-400" />
                  <input
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-stone-200 text-xs bg-white focus:ring-1 focus:ring-amber-500"
                  />
                  {filterDate && (
                    <button
                      onClick={() => setFilterDate('')}
                      className="text-[11px] text-stone-400 hover:text-stone-600"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-stone-400" />
                  <input
                    type="text"
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    placeholder="Search prefix (e.g. IP21, DL80)..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-stone-200 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                  />
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadEvents}
                  disabled={loadingEvents}
                  className="gap-1.5 text-xs h-8"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingEvents ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>

              {/* Events Table */}
              <div className="border border-stone-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Date &amp; Time (IST)</th>
                      <th className="py-2.5 px-3 text-center">Inc</th>
                      <th className="py-2.5 px-3">Gate Type</th>
                      <th className="py-2.5 px-3">Recorded Prefix</th>
                      <th className="py-2.5 px-3">Current Resolved Origin</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 font-normal">
                    {loadingEvents ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-stone-400">
                          <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1.5 text-amber-600" />
                          Searching gate vehicle events...
                        </td>
                      </tr>
                    ) : events.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-stone-400">
                          No vehicle events found matching criteria.
                        </td>
                      </tr>
                    ) : (
                      events.map((ev) => {
                        const rawKey = ev.vehicle_prefix || ev.location?.name || 'Others';
                        const resolved = resolveSinglePrefix(rawKey, prefixMap, locale);
                        const isMistypedLikely =
                          ev.vehicle_prefix &&
                          (resolved.isUnmapped ||
                            ev.vehicle_prefix.startsWith('IP') ||
                            (ev.vehicle_prefix.startsWith('DL') &&
                              parseInt(ev.vehicle_prefix.replace('DL', ''), 10) > 13));

                        return (
                          <tr
                            key={ev.id}
                            className={`hover:bg-amber-50/20 transition-colors ${
                              isMistypedLikely ? 'bg-amber-50/30' : ''
                            }`}
                          >
                            <td className="py-2.5 px-3 text-stone-700">
                              <span className="font-semibold">{ev.business_date}</span>
                              <span className="text-[10px] text-stone-400 block font-mono">
                                {ev.timestamp
                                  ? new Date(ev.timestamp).toLocaleTimeString('en-IN', {
                                      timeZone: 'Asia/Kolkata',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center font-bold text-stone-900">
                              +{ev.increment}
                            </td>
                            <td className="py-2.5 px-3 text-stone-600">
                              {ev.location?.name || 'Car'}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-stone-900">
                              {ev.vehicle_prefix ? (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[11px] ${
                                    isMistypedLikely
                                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                      : 'bg-stone-100 text-stone-800'
                                  }`}
                                >
                                  {ev.vehicle_prefix}
                                </span>
                              ) : (
                                <span className="text-stone-400 italic">None</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                                  resolved.isUnmapped
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                }`}
                              >
                                {resolved.locationName}
                                {resolved.isUnmapped && (
                                  <span className="text-[9px] uppercase tracking-wider font-bold text-amber-900">
                                    (Unmapped)
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEventToCorrect(ev);
                                  setNewPrefixInput(ev.vehicle_prefix || '');
                                }}
                                className="h-6 text-[11px] px-2 text-stone-700 hover:text-amber-700"
                              >
                                <Edit2 className="h-3 w-3 mr-1" />
                                Correct
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 bg-stone-50 flex items-center justify-between text-xs text-stone-500">
          <span>
            {prefixes.length} total prefixes mapped • Active offline-safe gate synchronization
          </span>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            {locale === 'hi' ? 'बंद करें' : 'Close'}
          </Button>
        </div>
      </div>
    </div>
  );
}
