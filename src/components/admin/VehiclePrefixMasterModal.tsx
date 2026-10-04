'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { VehicleRegistrationPrefix } from '@/lib/types/database';
import {
  buildPrefixLookupMap,
  resolveSinglePrefix,
  extractPendingUnmappedPrefixes,
  PendingUnmappedPrefix,
} from '@/lib/gate/prefix-resolver';
import { lookupRtoPrefix } from '@/lib/gate/rto-directory';
import { suggestHindiName } from '@/lib/i18n/suggest-hindi';
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
  ChevronDown,
  Sparkles,
  RotateCcw,
  MapPin,
  Loader2,
} from 'lucide-react';

interface VehiclePrefixMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

const PAGE_SIZE = 50;
const BIKE_LOCATION_ID = 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f';

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

  // Smart Prefix & Suggestion State
  const [pendingPrefixes, setPendingPrefixes] = useState<PendingUnmappedPrefix[]>([]);
  const [isPrefixDropdownOpen, setIsPrefixDropdownOpen] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null);
  const [isCustomHindi, setIsCustomHindi] = useState(false);
  const prefixComboboxRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        prefixComboboxRef.current &&
        !prefixComboboxRef.current.contains(e.target as Node)
      ) {
        setIsPrefixDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Gate Events Corrections state
  const [events, setEvents] = useState<GateVehicleEventRow[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'unmapped'>('all');
  const [filterDate, setFilterDate] = useState<string>('');
  const [filterQuery, setFilterQuery] = useState('');
  const [page, setPage] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [unmappedTotalCount, setUnmappedTotalCount] = useState<number | null>(null);
  const [eventToCorrect, setEventToCorrect] = useState<GateVehicleEventRow | null>(null);
  const [newPrefixInput, setNewPrefixInput] = useState('');
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionSuccessMsg, setCorrectionSuccessMsg] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  // Count unmapped cars across all dates
  const countUnmapped = async (prefixList?: VehicleRegistrationPrefix[]) => {
    try {
      const list = prefixList || prefixes;
      const activeList = list
        .filter((p) => p.is_active !== false)
        .map((p) => p.prefix.trim().toUpperCase());
      if (activeList.length === 0) return;

      const { count, error } = await supabase
        .from('vehicle_counter_events')
        .select('*', { count: 'exact', head: true })
        .not('vehicle_prefix', 'is', null)
        .neq('location_id', BIKE_LOCATION_ID)
        .not('vehicle_prefix', 'in', `(${activeList.join(',')})`);

      if (!error && count !== null) {
        setUnmappedTotalCount(count);
      }
    } catch (err) {
      console.error('Failed to count unmapped cars:', err);
    }
  };

  // Load Pending Unmapped Prefixes from Gate Events
  const loadPendingPrefixes = async (prefixList?: VehicleRegistrationPrefix[]) => {
    try {
      const list = prefixList || prefixes;
      const { data: eventData, error } = await supabase
        .from('vehicle_counter_events')
        .select('vehicle_prefix, location_id')
        .not('vehicle_prefix', 'is', null)
        .neq('location_id', BIKE_LOCATION_ID);

      if (!error && eventData) {
        const pending = extractPendingUnmappedPrefixes(eventData, list);
        setPendingPrefixes(pending);
      }
    } catch (err) {
      console.error('Failed to load pending unmapped prefixes:', err);
    }
  };

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
      const loaded = data || [];
      setPrefixes(loaded);
      countUnmapped(loaded);
      loadPendingPrefixes(loaded);
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
  const loadEvents = async (
    targetPage: number = page,
    mode: 'all' | 'unmapped' = filterMode,
    searchQuery: string = filterQuery,
    dateFilter: string = filterDate,
    overridePrefixes?: VehicleRegistrationPrefix[]
  ) => {
    setLoadingEvents(true);
    setCorrectionError(null);
    try {
      let currentPrefixes = overridePrefixes || prefixes;
      if (currentPrefixes.length === 0) {
        const { data: pData } = await supabase
          .from('vehicle_registration_prefixes')
          .select('*')
          .order('prefix', { ascending: true });
        if (pData) {
          currentPrefixes = pData;
          setPrefixes(pData);
        }
      }

      const activeMappedPrefixes = currentPrefixes
        .filter((p) => p.is_active !== false)
        .map((p) => p.prefix.trim().toUpperCase());

      let query = supabase
        .from('vehicle_counter_events')
        .select(
          'id, business_date, timestamp, increment, vehicle_prefix, location:vehicle_origin_locations(id, name)',
          { count: 'exact' }
        );

      if (mode === 'unmapped') {
        // Query unmapped CAR gate events across ALL dates:
        // - Recorded registration prefix is present (not null)
        // - Non-Bike vehicle event (exclude bike by location_id)
        // - Prefix has no geographic mapping in active prefix master
        query = query
          .not('vehicle_prefix', 'is', null)
          .neq('location_id', BIKE_LOCATION_ID);

        if (activeMappedPrefixes.length > 0) {
          query = query.not('vehicle_prefix', 'in', `(${activeMappedPrefixes.join(',')})`);
        }

        // Search prefix box remains usable
        if (searchQuery.trim()) {
          query = query.ilike('vehicle_prefix', `%${searchQuery.trim()}%`);
        }
        // Note: date picker is neutralized/ignored for unmapped cars across all dates!
      } else {
        // All entries mode: apply date filter and prefix search
        if (dateFilter) {
          query = query.eq('business_date', dateFilter);
        }

        if (searchQuery.trim()) {
          query = query.ilike('vehicle_prefix', `%${searchQuery.trim()}%`);
        }
      }

      query = query.order('timestamp', { ascending: false });

      // Pagination in batches of 50
      const from = (targetPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      const eventList = (data as any) || [];
      setEvents(eventList);
      setTotalCount(count ?? eventList.length);
      if (mode === 'unmapped' && !searchQuery.trim()) {
        setUnmappedTotalCount(count ?? eventList.length);
      }
    } catch (err: any) {
      setCorrectionError(err.message || 'Failed to load gate events.');
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadPrefixes();
      loadEvents(1, 'all', '', '');
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
    setSuggestionNotice(null);
    setIsPrefixDropdownOpen(false);
    setIsCustomHindi(false);
    setIsSuggesting(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
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
    setSuggestionNotice(null);
    setIsPrefixDropdownOpen(false);
    setIsCustomHindi(Boolean(p.name_hi));
    setIsSuggesting(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  // Suggestion Fetcher for selected / entered prefix
  const fetchSuggestion = async (prefixCode: string) => {
    const clean = prefixCode.trim().toUpperCase();
    if (!clean || clean.length < 2) return;

    setIsSuggesting(true);
    setSuggestionNotice(null);

    try {
      // 1. Fast local client-side match from RTO directory + Hindi dictionary
      const localMatch = lookupRtoPrefix(clean);
      if (localMatch && localMatch.locationName) {
        setFormLocationName(localMatch.locationName);
        setFormDistrict(localMatch.district || localMatch.locationName);
        setFormState(localMatch.state);
        const hindiResult = suggestHindiName(localMatch.locationName, 'location');
        setFormNameHi(localMatch.nameHi || hindiResult.suggestion || '');
        setIsCustomHindi(false);
        setSuggestionNotice(
          locale === 'hi'
            ? `सुझाव: ${localMatch.locationName}, ${localMatch.state}`
            : `Suggested: ${localMatch.locationName}, ${localMatch.state}`
        );
      } else if (localMatch && localMatch.state) {
        setFormState(localMatch.state);
        setSuggestionNotice(
          locale === 'hi'
            ? `राज्य सुझाव: ${localMatch.state} (स्थान नाम स्वयं भरें)`
            : `State suggested: ${localMatch.state} (enter location manually)`
        );
      }

      // 2. Fetch server-side API for official geocoding
      const res = await fetch(
        `/api/admin/operations/gate/suggest-prefix?prefix=${encodeURIComponent(clean)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.locationName) {
          setFormLocationName(data.locationName);
          if (!isCustomHindi) {
            setFormNameHi(data.nameHi || '');
          }
          setFormDistrict(data.district || '');
          setFormState(data.state || '');
          if (data.latitude != null) setFormLatitude(String(data.latitude));
          if (data.longitude != null) setFormLongitude(String(data.longitude));
          setSuggestionNotice(
            locale === 'hi'
              ? `सुझाव प्राप्त: ${data.locationName}, ${data.state}${data.latitude ? ' • निर्देशांक सहित' : ''}`
              : `Suggested: ${data.locationName}, ${data.state}${data.latitude ? ' • with coordinates' : ''}`
          );
        } else if (data.state) {
          setFormState(data.state);
        }
      }
    } catch (err) {
      console.error('Error fetching prefix suggestion:', err);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleLocationNameChange = (val: string) => {
    setFormLocationName(val);
    if (!isCustomHindi) {
      if (!val.trim()) {
        setFormNameHi('');
      } else {
        const res = suggestHindiName(val, 'location');
        setFormNameHi(res.suggestion);
      }
    }
  };

  const handleForceSuggestHindi = () => {
    if (!formLocationName.trim()) return;
    const res = suggestHindiName(formLocationName, 'location');
    setFormNameHi(res.suggestion);
    setIsCustomHindi(false);
  };

  const handleHindiNameChange = (val: string) => {
    setFormNameHi(val);
    setIsCustomHindi(true);
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
      loadEvents(page, filterMode);
      countUnmapped();
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

  // Filtered pending unmapped prefixes
  const filteredPending = useMemo(() => {
    if (!formPrefix.trim()) return pendingPrefixes;
    const q = formPrefix.trim().toUpperCase();
    return pendingPrefixes.filter((p) => {
      const rto = lookupRtoPrefix(p.prefix);
      return (
        p.prefix.includes(q) ||
        (rto?.locationName && rto.locationName.toUpperCase().includes(q)) ||
        (rto?.state && rto.state.toUpperCase().includes(q))
      );
    });
  }, [pendingPrefixes, formPrefix]);

  // Check if current formPrefix is already mapped in Master
  const mappedExisting = useMemo(() => {
    if (editingPrefix || !formPrefix.trim()) return null;
    return (
      prefixes.find((p) => p.prefix.toUpperCase() === formPrefix.trim().toUpperCase()) ||
      null
    );
  }, [prefixes, formPrefix, editingPrefix]);

  const handleFilterModeChange = (newMode: 'all' | 'unmapped') => {
    setFilterMode(newMode);
    setPage(1);
    loadEvents(1, newMode, filterQuery, filterDate);
  };

  const handleDateChange = (newDate: string) => {
    setFilterDate(newDate);
    setPage(1);
    loadEvents(1, filterMode, filterQuery, newDate);
  };

  const handleClearDate = () => {
    setFilterDate('');
    setPage(1);
    loadEvents(1, filterMode, filterQuery, '');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setPage(1);
      loadEvents(1, filterMode, filterQuery, filterDate);
    }
  };

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

                  {/* Row 1: Prefix Code Combobox & Pending Dropdown */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-stone-700">
                        {locale === 'hi'
                          ? 'प्रीफिक्स कोड * (उदा. UP24, DL14)'
                          : 'Prefix Code * (e.g. UP24, DL14)'}
                      </label>
                      {pendingPrefixes.length > 0 && !editingPrefix && (
                        <span className="text-[11px] font-medium text-amber-700 flex items-center gap-1">
                          <Car className="h-3 w-3" />
                          {locale === 'hi'
                            ? `गेट से ${pendingPrefixes.length} अनमैप्ड प्रीफिक्स लंबित`
                            : `${pendingPrefixes.length} unmapped prefixes pending from Gate`}
                        </span>
                      )}
                    </div>

                    <div className="relative" ref={prefixComboboxRef}>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <input
                            type="text"
                            value={formPrefix}
                            onChange={(e) => {
                              const val = e.target.value.toUpperCase().slice(0, 6);
                              setFormPrefix(val);
                              setIsPrefixDropdownOpen(true);
                              if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                              if (!editingPrefix && val.trim().length >= 4) {
                                typingTimeoutRef.current = setTimeout(() => {
                                  fetchSuggestion(val.trim());
                                }, 450);
                              }
                            }}
                            onFocus={() => {
                              if (!editingPrefix) setIsPrefixDropdownOpen(true);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setIsPrefixDropdownOpen(false);
                            }}
                            maxLength={6}
                            placeholder="UP24"
                            required
                            disabled={Boolean(editingPrefix)}
                            className="w-full px-3 py-1.5 pr-8 rounded-lg border border-stone-300 font-mono text-xs uppercase focus:ring-1 focus:ring-amber-500 focus:outline-hidden disabled:bg-stone-100 disabled:text-stone-500"
                          />

                          {!editingPrefix && (
                            <button
                              type="button"
                              onClick={() => setIsPrefixDropdownOpen((prev) => !prev)}
                              className="absolute right-2 top-2 text-stone-400 hover:text-stone-600 p-0.5 rounded transition-colors"
                              title={locale === 'hi' ? 'लंबित प्रीफिक्स सूची' : 'Pending prefixes list'}
                            >
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isPrefixDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                        </div>

                        {!editingPrefix && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fetchSuggestion(formPrefix)}
                            disabled={isSuggesting || formPrefix.trim().length < 2}
                            className="h-8 text-xs text-amber-800 border-amber-300 hover:bg-amber-100/70 shrink-0 flex items-center gap-1.5"
                            title={locale === 'hi' ? 'स्थान व निर्देशांक सुझाव खोजें' : 'Suggest location & coordinates'}
                          >
                            {isSuggesting ? (
                              <>
                                <RefreshCw className="h-3 w-3 animate-spin text-amber-700" />
                                <span>{locale === 'hi' ? 'खोज रहे...' : 'Suggesting...'}</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="h-3 w-3 text-amber-700" />
                                <span>{locale === 'hi' ? 'सुझाव खोजें' : 'Suggest'}</span>
                              </>
                            )}
                          </Button>
                        )}
                      </div>

                      {/* Dropdown Menu for Pending Unmapped Prefixes */}
                      {isPrefixDropdownOpen && !editingPrefix && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-stone-200 rounded-xl shadow-xl z-40 max-h-60 overflow-y-auto divide-y divide-stone-100">
                          <div className="p-2.5 bg-stone-50/80 sticky top-0 z-10 border-b border-stone-100">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-stone-800 flex items-center gap-1.5">
                                <Car className="h-3.5 w-3.5 text-amber-700" />
                                {locale === 'hi'
                                  ? 'गेट काउंटर से लंबित अनमैप्ड प्रीफिक्स'
                                  : 'Pending unmapped prefixes from Gate Counter'}
                              </span>
                              <Badge variant="warning" className="text-[10px] py-0 px-1.5">
                                {pendingPrefixes.length} {locale === 'hi' ? 'लंबित' : 'pending'}
                              </Badge>
                            </div>
                            <p className="text-[10px] text-stone-500 mt-0.5">
                              {locale === 'hi'
                                ? 'गेट पर दर्ज कारें जो वर्तमान में किसी शहर से मैप नहीं हैं'
                                : 'Cars recorded at gate currently awaiting geographical mapping'}
                            </p>
                          </div>

                          {filteredPending.length > 0 ? (
                            <div className="p-1 space-y-0.5">
                              {filteredPending.map((p) => {
                                const rto = lookupRtoPrefix(p.prefix);
                                const isSelected = formPrefix === p.prefix;
                                return (
                                  <button
                                    key={p.prefix}
                                    type="button"
                                    onClick={() => {
                                      setFormPrefix(p.prefix);
                                      setIsPrefixDropdownOpen(false);
                                      fetchSuggestion(p.prefix);
                                    }}
                                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
                                      isSelected
                                        ? 'bg-amber-100/80 text-amber-950 font-semibold'
                                        : 'hover:bg-amber-50 text-stone-800'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono font-bold tracking-wide text-amber-900 bg-amber-100/70 px-1.5 py-0.5 rounded text-[11px]">
                                        {p.prefix}
                                      </span>
                                      {rto?.locationName && (
                                        <span className="text-[11px] text-stone-600">
                                          {rto.locationName}, {rto.state}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-medium text-amber-800 bg-amber-50 border border-amber-200/60 px-1.5 py-0.5 rounded-full">
                                        {p.count} {locale === 'hi' ? (p.count === 1 ? 'इवेंट' : 'इवेंट्स') : (p.count === 1 ? 'occurrence' : 'occurrences')}
                                      </span>
                                      <ArrowRight className="h-3 w-3 text-stone-400" />
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="p-4 text-center text-xs text-stone-500">
                              {formPrefix.trim()
                                ? locale === 'hi'
                                  ? `"${formPrefix}" से मेल खाता कोई लंबित प्रीफिक्स नहीं मिला। मैन्युअल प्रविष्टि जारी रखें।`
                                  : `No pending prefix matching "${formPrefix}". Manual entry active.`
                                : locale === 'hi'
                                ? 'गेट काउंटर से कोई लंबित अनमैप्ड प्रीफिक्स नहीं है।'
                                : 'No pending unmapped prefixes from gate events.'}
                            </div>
                          )}

                          <div className="p-2 bg-stone-50 text-[10px] text-stone-500 text-center">
                            {locale === 'hi'
                              ? 'आप ऊपर कोई भी नया प्रीफिक्स टाइप करके मैन्युअल रूप से जोड़ सकते हैं'
                              : 'You can also type any custom prefix above for manual entry'}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Warning if prefix is already mapped */}
                    {mappedExisting && (
                      <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] flex items-center gap-2">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                        <span>
                          {locale === 'hi'
                            ? `प्रीफिक्स "${mappedExisting.prefix}" पहले से मास्टर में "${mappedExisting.location_name}" (${mappedExisting.state}) से मैप है।`
                            : `Prefix "${mappedExisting.prefix}" is already mapped in Master to "${mappedExisting.location_name}" (${mappedExisting.state}).`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Suggestion Notice */}
                  {suggestionNotice && (
                    <div className="p-2 bg-emerald-50 border border-emerald-200/80 rounded-lg text-xs text-emerald-900 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span>{suggestionNotice}</span>
                      </div>
                      <span className="text-[10px] text-emerald-700 font-medium shrink-0 ml-2">
                        {locale === 'hi' ? 'सभी फ़ील्ड्स संपादन योग्य' : 'Editable autofill'}
                      </span>
                    </div>
                  )}

                  {/* Row 2: Location Name (English) & स्थान नाम (हिंदी) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">
                        {locale === 'hi' ? 'स्थान नाम (अंग्रेज़ी) *' : 'Location Name (English) *'}
                      </label>
                      <input
                        type="text"
                        value={formLocationName}
                        onChange={(e) => handleLocationNameChange(e.target.value)}
                        placeholder="Budaun"
                        required
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-stone-700">
                          स्थान नाम (हिंदी)
                        </label>
                        <button
                          type="button"
                          onClick={handleForceSuggestHindi}
                          disabled={!formLocationName.trim()}
                          title={locale === 'hi' ? 'हिंदी सुझाव बनाएं' : 'Suggest Hindi display name'}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:text-amber-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>{locale === 'hi' ? 'सुझाव बनाएं' : 'Suggest'}</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={formNameHi}
                        onChange={(e) => handleHindiNameChange(e.target.value)}
                        placeholder="बदायूं"
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                      />
                      {isCustomHindi && (
                        <div className="flex items-center justify-between mt-1 text-[10px] text-stone-500">
                          <span>{locale === 'hi' ? 'हाथ से बदला गया' : 'Manually edited'}</span>
                          <button
                            type="button"
                            onClick={handleForceSuggestHindi}
                            className="text-amber-700 hover:underline flex items-center gap-0.5"
                          >
                            <RotateCcw className="h-2.5 w-2.5" />
                            <span>{locale === 'hi' ? 'सुझाव पर रीसेट करें' : 'Reset to suggestion'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 3: District & State */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">
                        {locale === 'hi' ? 'ज़िला (District)' : 'District (ज़िला)'}
                      </label>
                      <input
                        type="text"
                        value={formDistrict}
                        onChange={(e) => setFormDistrict(e.target.value)}
                        placeholder="Budaun"
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">
                        {locale === 'hi' ? 'राज्य (State) *' : 'State *'}
                      </label>
                      <input
                        type="text"
                        value={formState}
                        onChange={(e) => setFormState(e.target.value)}
                        placeholder="Uttar Pradesh"
                        required
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 focus:ring-1 focus:ring-amber-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Row 4: Latitude & Longitude */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-stone-700">Latitude</label>
                        <span className="text-[10px] text-stone-400 font-mono">28.xxxx</span>
                      </div>
                      <input
                        type="number"
                        step="any"
                        value={formLatitude}
                        onChange={(e) => setFormLatitude(e.target.value)}
                        placeholder="28.0367"
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-mono"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-stone-700">Longitude</label>
                        <span className="text-[10px] text-stone-400 font-mono">79.xxxx</span>
                      </div>
                      <input
                        type="number"
                        step="any"
                        value={formLongitude}
                        onChange={(e) => setFormLongitude(e.target.value)}
                        placeholder="79.1234"
                        className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-mono"
                      />
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
              <div className="flex flex-wrap items-center gap-2.5">
                {/* 1. Date Picker or All Dates indicator */}
                {filterMode === 'unmapped' ? (
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-stone-200 bg-stone-100 text-stone-600 text-xs select-none"
                    title={
                      locale === 'hi'
                        ? 'अनमैप्ड कारों के लिए सभी तारीखें खोजी जा रही हैं'
                        : 'Searching all dates for unmapped cars'
                    }
                  >
                    <Calendar className="h-3.5 w-3.5 text-stone-400" />
                    <span className="font-medium">
                      {locale === 'hi' ? 'सभी तारीखें' : 'All dates'}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs">
                    <Calendar className="h-3.5 w-3.5 text-stone-400" />
                    <input
                      type="date"
                      value={filterDate}
                      onChange={(e) => handleDateChange(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-stone-200 text-xs bg-white focus:ring-1 focus:ring-amber-500"
                    />
                    {filterDate && (
                      <button
                        onClick={handleClearDate}
                        className="text-[11px] text-stone-400 hover:text-stone-600 cursor-pointer"
                      >
                        {locale === 'hi' ? 'हटाएं' : 'Clear'}
                      </button>
                    )}
                  </div>
                )}

                {/* 2. Show Filter: All entries / Unmapped cars */}
                <div className="flex items-center bg-stone-100 p-0.5 rounded-xl border border-stone-200 text-xs">
                  <button
                    type="button"
                    onClick={() => handleFilterModeChange('all')}
                    className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                      filterMode === 'all'
                        ? 'bg-white text-stone-900 shadow-xs'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    {locale === 'hi' ? 'सभी एंट्रीज' : 'All entries'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFilterModeChange('unmapped')}
                    className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                      filterMode === 'unmapped'
                        ? 'bg-amber-600 text-white shadow-xs font-semibold'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    <span>{locale === 'hi' ? 'अनमैप्ड कारें' : 'Unmapped cars'}</span>
                    {unmappedTotalCount !== null && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                          filterMode === 'unmapped'
                            ? 'bg-amber-700 text-amber-100'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {unmappedTotalCount}
                      </span>
                    )}
                  </button>
                </div>

                {/* 3. Search prefix */}
                <div className="relative flex-1 max-w-xs min-w-[160px]">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-stone-400" />
                  <input
                    type="text"
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={
                      filterMode === 'unmapped'
                        ? locale === 'hi'
                          ? 'अनमैप्ड प्रीफिक्स खोजें...'
                          : 'Search unmapped prefix...'
                        : locale === 'hi'
                        ? 'प्रीफिक्स खोजें (उदा. IP21)...'
                        : 'Search prefix (e.g. IP21)...'
                    }
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-stone-200 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-hidden bg-white"
                  />
                </div>

                {/* 4. Refresh Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadEvents(page, filterMode, filterQuery, filterDate)}
                  disabled={loadingEvents}
                  className="gap-1.5 text-xs h-8 ml-auto sm:ml-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingEvents ? 'animate-spin' : ''}`} />
                  {locale === 'hi' ? 'ताज़ा करें' : 'Refresh'}
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
                          {locale === 'hi'
                            ? 'गेट वाहन इवेंट्स लोड हो रहे हैं...'
                            : 'Searching gate vehicle events...'}
                        </td>
                      </tr>
                    ) : events.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-stone-400">
                          {filterMode === 'unmapped'
                            ? locale === 'hi'
                              ? 'कोई अनमैप्ड कार नहीं मिली।'
                              : 'No unmapped cars found matching criteria.'
                            : locale === 'hi'
                            ? 'कोई वाहन इवेंट नहीं मिला।'
                            : 'No vehicle events found matching criteria.'}
                        </td>
                      </tr>
                    ) : (
                      events.map((ev) => {
                        const isBike =
                          ev.location?.name?.toLowerCase() === 'bike' ||
                          (ev.vehicle_prefix || '').toLowerCase() === 'bike' ||
                          ev.location?.id === BIKE_LOCATION_ID;

                        const rawKey = ev.vehicle_prefix || ev.location?.name || 'Others';
                        const resolved = resolveSinglePrefix(rawKey, prefixMap, locale);
                        const isMistypedLikely =
                          !isBike &&
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
                              {ev.location?.name ||
                                (isBike ? (locale === 'hi' ? 'बाइक' : 'Bike') : 'Car')}
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
                              {isBike ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200">
                                  {locale === 'hi' ? 'बाइक' : 'BIKE'}
                                </span>
                              ) : resolved.isUnmapped ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                                  <span>{resolved.locationName}</span>
                                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-amber-800 bg-amber-200/90 px-1 py-0.2 rounded">
                                    {locale === 'hi' ? 'अनमैप्ड' : 'UNMAPPED'}
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  {resolved.locationName}
                                </span>
                              )}
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
                                {locale === 'hi' ? 'सुधारें' : 'Correct'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>

                {/* Pagination Bar */}
                {totalCount !== null && totalCount > 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between px-3 py-2 bg-stone-50 border-t border-stone-200 text-xs text-stone-600 gap-2">
                    <div>
                      {filterMode === 'unmapped' ? (
                        <span>
                          {locale === 'hi'
                            ? `कुल ${totalCount} अनमैप्ड कारें (दिखा रहे हैं ${Math.min(
                                (page - 1) * PAGE_SIZE + 1,
                                totalCount
                              )}–${Math.min(page * PAGE_SIZE, totalCount)})`
                            : `Showing ${Math.min(
                                (page - 1) * PAGE_SIZE + 1,
                                totalCount
                              )}–${Math.min(page * PAGE_SIZE, totalCount)} of ${totalCount} unmapped cars`}
                        </span>
                      ) : (
                        <span>
                          {locale === 'hi'
                            ? `कुल ${totalCount} इवेंट्स (दिखा रहे हैं ${Math.min(
                                (page - 1) * PAGE_SIZE + 1,
                                totalCount
                              )}–${Math.min(page * PAGE_SIZE, totalCount)})`
                            : `Showing ${Math.min(
                                (page - 1) * PAGE_SIZE + 1,
                                totalCount
                              )}–${Math.min(page * PAGE_SIZE, totalCount)} of ${totalCount} events`}
                        </span>
                      )}
                    </div>
                    {totalCount > PAGE_SIZE && (
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const newPage = Math.max(1, page - 1);
                            setPage(newPage);
                            loadEvents(newPage, filterMode, filterQuery, filterDate);
                          }}
                          disabled={page <= 1 || loadingEvents}
                          className="h-7 text-xs px-2.5"
                        >
                          {locale === 'hi' ? 'पिछला' : 'Previous'}
                        </Button>
                        <span className="text-[11px] font-semibold text-stone-700 px-1">
                          {page} / {Math.ceil(totalCount / PAGE_SIZE)}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const newPage = page + 1;
                            setPage(newPage);
                            loadEvents(newPage, filterMode, filterQuery, filterDate);
                          }}
                          disabled={page >= Math.ceil(totalCount / PAGE_SIZE) || loadingEvents}
                          className="h-7 text-xs px-2.5"
                        >
                          {locale === 'hi' ? 'अगला' : 'Next'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
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
