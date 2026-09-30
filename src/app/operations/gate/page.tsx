'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate, formatNumber } from '@/lib/utils';
import {
  recordVisitorEvent,
  recordVehicleEvent,
  undoLastLocalEvent,
  getCachedLocations,
  saveCachedLocations,
  getDeviceEnrollment,
  getLocalDayEvents,
  getPendingCount,
  subscribeToStoreChanges,
  DeviceEnrollment,
} from '@/lib/gate/offline-store';
import {
  startSyncEngine,
  syncPendingEvents,
  subscribeToSyncState,
  SyncState,
} from '@/lib/gate/sync-engine';
import {
  Users,
  Car,
  Undo2,
  RefreshCw,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  ShieldCheck,
  Smartphone,
  Bike,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

interface VehicleLocation {
  id: string;
  name: string;
  count: number;
  display_order?: number;
  is_quick_prefix?: boolean;
}

const BIKE_LOCATION_ID = 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f';

const DEFAULT_LOCATIONS: VehicleLocation[] = [
  { id: 'd343fa14-72f7-49c1-bfbc-e8bffdd2ddd9', name: 'DL', count: 0, display_order: 1, is_quick_prefix: true },
  { id: 'c59f0429-9ed0-47f4-8cbb-8542ca4ec5d7', name: 'UP16', count: 0, display_order: 2, is_quick_prefix: true },
  { id: 'b1c52c0e-2d4c-4d3b-b3fd-0b62c1fa6c15', name: 'UP22', count: 0, display_order: 3, is_quick_prefix: true },
  { id: 'eec2b68d-7725-42a9-a0b8-91321a53b803', name: 'UP23', count: 0, display_order: 4, is_quick_prefix: true },
  { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'HR', count: 0, display_order: 5, is_quick_prefix: false },
  { id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', name: 'UK', count: 0, display_order: 6, is_quick_prefix: false },
  { id: 'ef6e8d6b-a68b-409f-a2e0-5794c6205833', name: 'Others', count: 0, display_order: 7, is_quick_prefix: false },
  { id: BIKE_LOCATION_ID, name: 'Bike', count: 0, display_order: 8, is_quick_prefix: false },
];

export default function GateCounterPage() {
  const supabase = createClient();
  const { t, formatDate } = useI18n();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [totalVisitors, setTotalVisitors] = useState<number>(0);
  const [totalCars, setTotalCars] = useState<number>(0);
  const [locations, setLocations] = useState<VehicleLocation[]>(DEFAULT_LOCATIONS);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Device & Sync States
  const [enrollment, setEnrollment] = useState<DeviceEnrollment | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({
    status: 'online_synced',
    pendingCount: 0,
    isOnline: true,
    lastSyncAt: null,
    errorMessage: null,
  });

  // Smart prefix entry state for "Others"
  const [isOthersOpen, setIsOthersOpen] = useState(false);
  const [prefixLetters, setPrefixLetters] = useState('');
  const [prefixDigits, setPrefixDigits] = useState('');
  const [prefixError, setPrefixError] = useState<string | null>(null);

  const lettersRef = useRef<HTMLInputElement>(null);
  const digitsRef = useRef<HTMLInputElement>(null);

  // Auto-focus letters input when smart prefix modal opens
  useEffect(() => {
    if (isOthersOpen) {
      const timer = setTimeout(() => {
        lettersRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOthersOpen]);

  // 1. Initial Load: Read local cache immediately (0ms lag), then reconcile with server in background
  const loadData = useCallback(async () => {
    try {
      // Step A: Load device enrollment, cached locations, and local IndexedDB events
      const [devEnroll, cachedLocs, localEvents] = await Promise.all([
        getDeviceEnrollment(),
        getCachedLocations(),
        getLocalDayEvents(businessDate),
      ]);
      setEnrollment(devEnroll);

      let currentLocations = cachedLocs && cachedLocs.length > 0 ? cachedLocs : DEFAULT_LOCATIONS;

      // Layer local pending events from IndexedDB
      const pendingLocal = localEvents.filter(
        (e) => e.sync_status === 'pending' || e.sync_status === 'syncing' || e.sync_status === 'failed'
      );

      let localPendingVisitors = 0;
      let localPendingCars = 0;
      const localLocMap: Record<string, number> = {};

      pendingLocal.forEach((ev) => {
        if (ev.event_type === 'visitor') {
          localPendingVisitors += ev.increment;
        } else if (ev.event_type === 'vehicle') {
          localPendingCars += ev.increment;
          if (ev.location_id) {
            localLocMap[ev.location_id] = (localLocMap[ev.location_id] || 0) + ev.increment;
          }
        }
      });

      // Show local cached counts immediately (instant touch response)
      setTotalVisitors((prev) => (prev > 0 ? prev : localPendingVisitors));
      setTotalCars((prev) => (prev > 0 ? prev : localPendingCars));
      setLocations(
        currentLocations.map((loc: any) => ({
          id: loc.id,
          name: loc.name,
          count: localLocMap[loc.id] || 0,
          display_order: loc.display_order ?? 0,
          is_quick_prefix: Boolean(loc.is_quick_prefix),
        }))
      );

      // Step B: Reconcile with server in background if online (with 2500ms timeout)
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Network timeout')), 2500)
          );

          const fetchPromise = Promise.all([
            supabase
              .from('vehicle_origin_locations')
              .select('*')
              .eq('is_active', true)
              .order('display_order'),
            supabase
              .from('visitor_counter_events')
              .select('increment, timestamp')
              .eq('business_date', businessDate),
            supabase
              .from('vehicle_counter_events')
              .select('location_id, increment, timestamp, vehicle_prefix')
              .eq('business_date', businessDate),
          ]);

          const [locRes, vRes, cRes] = await Promise.race([fetchPromise, timeoutPromise]);

          if (locRes.data && locRes.data.length > 0) {
            currentLocations = locRes.data;
            await saveCachedLocations(locRes.data);
          }

          const serverVisitors = (vRes.data || []).reduce((sum: number, e: any) => sum + (e.increment || 0), 0);
          const serverCars = (cRes.data || []).reduce((sum: number, e: any) => sum + (e.increment || 0), 0);
          const serverLocMap: Record<string, number> = {};

          (cRes.data || []).forEach((e: any) => {
            serverLocMap[e.location_id] = (serverLocMap[e.location_id] || 0) + (e.increment || 0);
          });

          const latestVTime = vRes.data?.[0]?.timestamp;
          const latestCTime = cRes.data?.[0]?.timestamp;
          const latest = [latestVTime, latestCTime].filter(Boolean).sort().reverse()[0];
          if (latest) setLastUpdatedAt(latest);

          setTotalVisitors(serverVisitors + localPendingVisitors);
          setTotalCars(serverCars + localPendingCars);

          setLocations(
            currentLocations.map((loc: any) => ({
              id: loc.id,
              name: loc.name,
              count: (serverLocMap[loc.id] || 0) + (localLocMap[loc.id] || 0),
              display_order: loc.display_order ?? 0,
              is_quick_prefix: Boolean(loc.is_quick_prefix),
            }))
          );
        } catch {
          // Offline mode or network timeout — already showing local store cleanly
        }
      }
    } catch (err: any) {
      console.error('Error loading gate data:', err);
    }
  }, [businessDate, supabase]);

  // 2. Start Sync Engine on mount and subscribe to state
  useEffect(() => {
    const unsubSync = startSyncEngine();
    const unsubState = subscribeToSyncState((state) => {
      setSyncState(state);
    });
    const unsubStore = subscribeToStoreChanges(() => {
      getPendingCount().then((cnt) => {
        setSyncState((prev) => ({ ...prev, pendingCount: cnt }));
      });
    });

    loadData();

    return () => {
      unsubSync();
      unsubState();
      unsubStore();
    };
  }, [loadData]);

  // 3. Instant Touch Handlers (< 5ms local IndexedDB commit)
  const handleAddVisitors = async (increment = 1) => {
    setTotalVisitors((prev) => prev + increment);
    setLastAction(t('gate.messages.addedVisitors', { count: increment }));
    setLastUpdatedAt(new Date().toISOString());

    try {
      await recordVisitorEvent(
        increment,
        businessDate,
        enrollment?.userId || null,
        enrollment?.deviceId || null
      );
      syncPendingEvents();
    } catch (err) {
      console.error('Failed to commit visitor event locally:', err);
    }
  };

  const handleAddVehicle = async (locationId: string, locationName: string, vehiclePrefix?: string) => {
    setTotalCars((prev) => prev + 1);
    setLocations((prev) =>
      prev.map((l) => (l.id === locationId ? { ...l, count: l.count + 1 } : l))
    );
    const isBike = locationName === 'Bike';
    const recordedPrefix = vehiclePrefix || (isBike ? null : locationName);
    const locDisplay = isBike 
      ? t('gate.vehicles.bike') 
      : (recordedPrefix || (locationName.toLowerCase() === 'others' ? t('gate.regions.Others') : locationName));
    setLastAction(t('gate.messages.addedVehicle', { location: locDisplay }));
    setLastUpdatedAt(new Date().toISOString());

    try {
      await recordVehicleEvent(
        locationId,
        locationName,
        businessDate,
        enrollment?.userId || null,
        enrollment?.deviceId || null,
        recordedPrefix
      );
      syncPendingEvents();
    } catch (err) {
      console.error('Failed to commit vehicle event locally:', err);
    }
  };

  const handleUndo = async () => {
    try {
      const undone = await undoLastLocalEvent();
      if (undone) {
        if (undone.event_type === 'visitor') {
          setTotalVisitors((prev) => Math.max(0, prev - undone.increment));
          setLastAction(t('gate.messages.undoneVisitor'));
        } else {
          setTotalCars((prev) => Math.max(0, prev - 1));
          setLocations((prev) =>
            prev.map((l) => (l.id === undone.location_id ? { ...l, count: Math.max(0, l.count - 1) } : l))
          );
          const isBike =
            undone.location_id === BIKE_LOCATION_ID ||
            undone.location_name?.toLowerCase() === 'bike' ||
            undone.vehicle_prefix?.toLowerCase() === 'bike';
          const locDisplay = isBike 
            ? t('gate.vehicles.bike') 
            : (undone.vehicle_prefix || (undone.location_name?.toLowerCase() === 'others' ? t('gate.regions.Others') : (undone.location_name || '')));
          setLastAction(t('gate.messages.undoneVehicle', { location: locDisplay }));
        }
      } else {
        setLastAction(t('gate.messages.noEventsToUndo'));
      }
    } catch (err) {
      console.error('Error undoing event:', err);
    }
  };

  const handleManualSync = async () => {
    setLoading(true);
    await syncPendingEvents();
    await loadData();
    setLoading(false);
  };

  // 4. Smart Prefix Input Handlers
  const handleLettersChange = (raw: string) => {
    setPrefixError(null);
    const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Allow pasting or typing 4-char string (e.g. "MP09" or "MP 09") directly in letters box
    if (clean.length > 2 && /^[A-Z]{2}[0-9]{1,2}$/.test(clean)) {
      const l = clean.slice(0, 2);
      const d = clean.slice(2, 4);
      setPrefixLetters(l);
      setPrefixDigits(d);
      digitsRef.current?.focus();
      return;
    }

    const onlyLetters = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    setPrefixLetters(onlyLetters);
    if (onlyLetters.length === 2) {
      digitsRef.current?.focus();
    }
  };

  const handleDigitsChange = (raw: string) => {
    setPrefixError(null);
    const onlyDigits = raw.replace(/[^0-9]/g, '').slice(0, 2);
    setPrefixDigits(onlyDigits);
  };

  const isValidPrefix = useMemo(() => {
    return /^[A-Z]{2}$/.test(prefixLetters) && /^[0-9]{2}$/.test(prefixDigits);
  }, [prefixLetters, prefixDigits]);

  const handlePrefixSubmit = async () => {
    const normalized = `${prefixLetters.trim().toUpperCase()}${prefixDigits.trim()}`;
    if (!/^[A-Z]{2}[0-9]{2}$/.test(normalized)) {
      setPrefixError(t('gate.vehicles.invalidPrefix'));
      return;
    }

    await handleAddVehicle(othersLocation.id, 'Others', normalized);
    setIsOthersOpen(false);
    setPrefixLetters('');
    setPrefixDigits('');
    setPrefixError(null);
  };

  // Derive dynamic quick prefixes from configuration/master data (is_quick_prefix === true)
  const quickLocations = useMemo(() => {
    const quicks = locations
      .filter((l) => Boolean(l.is_quick_prefix) && l.name.toUpperCase() !== 'BIKE')
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

    if (quicks.length > 0) return quicks;

    // Fallback if is_quick_prefix not yet populated: default to first 4 non-bike, non-others
    return locations
      .filter((l) => !['BIKE', 'OTHERS', 'MEERUT'].includes(l.name.toUpperCase()))
      .slice(0, 4);
  }, [locations]);

  // Derive Others location
  const othersLocation = useMemo(() => {
    return (
      locations.find((l) => l.name.toUpperCase() === 'OTHERS') || {
        id: 'ef6e8d6b-a68b-409f-a2e0-5794c6205833',
        name: 'Others',
        count: 0,
      }
    );
  }, [locations]);

  // Derive the Bike location
  const bikeLocation = useMemo(() => {
    return (
      locations.find((l) => l.name.toUpperCase() === 'BIKE' || l.id === BIKE_LOCATION_ID) || {
        id: BIKE_LOCATION_ID,
        name: 'Bike',
        count: 0,
      }
    );
  }, [locations]);

  return (
    <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4 pb-8">
      {/* 1. COMPACT HEADER */}
      <div className="bg-stone-900 text-white px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <h1 className="text-base sm:text-lg font-black tracking-tight">
            {t('gate.title')}
          </h1>
          {enrollment ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-stone-800 text-stone-300 px-2 py-0.5 rounded-md border border-stone-700">
              <Smartphone className="h-3 w-3 text-amber-400" />
              {t('gate.enrolled')}
            </span>
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 px-2 py-0.5 rounded-md border border-amber-500/40"
            >
              <ShieldCheck className="h-3 w-3" /> {t('gate.enrollGuardDevice')}
            </Link>
          )}
        </div>

        {/* Sync & Date Badges */}
        <div className="flex items-center gap-1.5 text-[11px]">
          {/* Sync Indicator */}
          {syncState.status === 'syncing' ? (
            <div className="flex items-center gap-1 bg-sky-950/80 border border-sky-600/50 text-sky-300 px-2 py-0.5 rounded-md font-medium">
              <RotateCw className="h-3 w-3 animate-spin text-sky-400" />
              <span>{t('gate.syncStatus.syncing', { count: syncState.pendingCount })}</span>
            </div>
          ) : syncState.status === 'offline_pending' ? (
            <div className="flex items-center gap-1 bg-amber-950/80 border border-amber-600/50 text-amber-300 px-2 py-0.5 rounded-md font-medium">
              <WifiOff className="h-3 w-3 text-amber-400" />
              <span>{t('gate.syncStatus.offline', { count: syncState.pendingCount })}</span>
            </div>
          ) : syncState.status === 'failed' ? (
            <button
              onClick={handleManualSync}
              className="flex items-center gap-1 bg-rose-950/80 border border-rose-600/50 text-rose-300 px-2 py-0.5 rounded-md font-medium hover:bg-rose-900 cursor-pointer"
            >
              <AlertTriangle className="h-3 w-3 text-rose-400" />
              <span>{t('gate.syncStatus.failed', { count: syncState.pendingCount })}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 bg-emerald-950/80 border border-emerald-600/50 text-emerald-300 px-2 py-0.5 rounded-md font-medium">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>{t('gate.syncStatus.synced')}</span>
            </div>
          )}

          {/* Date Badge */}
          <div className="bg-stone-800 border border-stone-700 rounded-md px-2 py-0.5 text-stone-300">
            {formatDate(businessDate, 'short')}
          </div>

          {/* Refresh Action */}
          <button
            onClick={handleManualSync}
            title={t('gate.refreshTitle')}
            className="p-1 rounded-md bg-stone-800 hover:bg-stone-700 text-stone-300 active:scale-95 transition-transform cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. LAST ACTION BAR WITH COMPACT UNDO */}
      <div className="flex items-center justify-between bg-white border border-stone-200 rounded-xl px-3 py-2 shadow-2xs">
        <div className="flex items-center gap-1.5 text-xs text-stone-600 truncate max-w-[200px] sm:max-w-md">
          <span className="font-semibold text-stone-700 truncate">
            {t('gate.visitors.lastAction', { action: lastAction || '—' })}
          </span>
        </div>
        <button
          type="button"
          data-testid="btn-undo"
          onClick={handleUndo}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-stone-100 hover:bg-stone-200 active:bg-stone-300 text-stone-800 border border-stone-300 active:scale-95 transition-transform cursor-pointer shadow-2xs shrink-0"
        >
          <Undo2 className="h-4 w-4 text-amber-600" />
          <span>{t('gate.visitors.undoLastTap')}</span>
        </button>
      </div>

      {/* 3. SECTION 1: VEHICLE COUNTING — PRIMARY FUNCTION */}
      <div className="bg-white border border-stone-200 rounded-2xl p-3.5 sm:p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
          <div className="flex items-center gap-2">
            <Car className="h-5 w-5 text-sky-600" />
            <h2 className="text-sm font-black text-stone-900 uppercase tracking-wider">
              {t('gate.vehicles.title')}
            </h2>
          </div>
          <div className="text-xs text-stone-500 font-medium">
            {t('gate.kpi.todaysVehicles')}: <strong data-testid="vehicles-count" className="text-base font-black text-stone-900">{formatNumber(totalCars)}</strong>
          </div>
        </div>

        {/* 4 Quick-entry buttons in a 2x2 grid */}
        <div className="grid grid-cols-2 gap-3 sm:gap-3.5">
          {quickLocations.map((loc) => (
            <button
              key={loc.id}
              data-testid={`btn-vehicle-${loc.id}`}
              onClick={() => handleAddVehicle(loc.id, loc.name)}
              className="h-20 sm:h-24 rounded-2xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950 flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer touch-manipulation shadow-xs border border-amber-600/30"
            >
              <span className="text-3xl sm:text-4xl font-black tracking-tight leading-none">{loc.name}</span>
              <span className="text-xs font-bold text-amber-950/80 mt-1">+1</span>
            </button>
          ))}
        </div>

        {/* Prominent "Others" button */}
        <button
          type="button"
          data-testid="btn-vehicle-others"
          onClick={() => {
            setPrefixLetters('');
            setPrefixDigits('');
            setPrefixError(null);
            setIsOthersOpen(true);
          }}
          className="w-full h-15 sm:h-16 rounded-2xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950 font-black text-xl sm:text-2xl shadow-xs flex items-center justify-center gap-2.5 transition-transform active:scale-95 cursor-pointer touch-manipulation border border-amber-600/30"
        >
          <span>{t('gate.regions.Others')}</span>
          <span className="text-xs font-bold text-amber-950/80 bg-amber-400/70 px-2 py-0.5 rounded-md">
            +1 ({t('gate.vehicles.enterPrefixShort')})
          </span>
        </button>
      </div>

      {/* 4. SECTION 2: BIKES */}
      <div className="bg-white border border-stone-200 rounded-2xl p-3.5 sm:p-4 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between border-b border-stone-100 pb-2">
          <div className="flex items-center gap-2">
            <Bike className="h-5 w-5 text-emerald-600" />
            <h2 className="text-sm font-black text-stone-900 uppercase tracking-wider">
              {t('gate.vehicles.bike')}
            </h2>
          </div>
          <div className="text-xs text-stone-500 font-medium">
            {t('gate.vehicles.bike')}: <strong className="text-base font-black text-stone-900">{formatNumber(bikeLocation.count)}</strong>
          </div>
        </div>

        <button
          type="button"
          data-testid="btn-vehicle-bike"
          onClick={() => handleAddVehicle(bikeLocation.id, 'Bike')}
          className="w-full h-14 sm:h-15 rounded-2xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950 font-black text-lg sm:text-xl shadow-xs flex items-center justify-center gap-2.5 transition-transform active:scale-95 cursor-pointer touch-manipulation border border-amber-600/30"
        >
          <Bike className="h-6 w-6 text-stone-950" />
          <span>+1 {t('gate.vehicles.bike')}</span>
        </button>
      </div>

      {/* 5. SECTION 3: VISITOR COUNTING — DE-PRIORITISED (VISUALLY SECONDARY) */}
      <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3.5 sm:p-4 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between border-b border-stone-200/80 pb-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-stone-600 uppercase tracking-wider">
            <Users className="h-4 w-4 text-amber-600" />
            <span>{t('gate.visitors.title')}</span>
          </div>
          <div className="text-xs font-medium text-stone-500">
            {t('gate.kpi.todaysVisitors')}: <strong data-testid="visitors-count" className="text-base font-black text-stone-900">{formatNumber(totalVisitors)}</strong>
          </div>
        </div>

        <button
          type="button"
          data-testid="btn-visitor-1"
          onClick={() => handleAddVisitors(1)}
          className="w-full h-12 sm:h-13 rounded-xl bg-white hover:bg-amber-50 active:bg-amber-100 text-stone-900 border-2 border-stone-300 hover:border-amber-400 font-black text-base sm:text-lg shadow-2xs flex items-center justify-center gap-2 transition-transform active:scale-95 cursor-pointer touch-manipulation"
        >
          <Users className="h-4 w-4 text-amber-600" />
          <span>{t('gate.visitors.addOnePerson')}</span>
        </button>
      </div>

      {/* 6. SMART PREFIX ENTRY MODAL */}
      {isOthersOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOthersOpen(false);
          }}
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-4 sm:p-5 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 className="text-base font-black text-stone-900">
                  {t('gate.vehicles.smartPrefixTitle')}
                </h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  {t('gate.vehicles.smartPrefixSubtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOthersOpen(false)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Two license-plate-styled boxes */}
            <div className="flex items-center justify-center gap-3 py-2">
              <div className="flex flex-col items-center">
                <input
                  ref={lettersRef}
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={2}
                  value={prefixLetters}
                  onChange={(e) => handleLettersChange(e.target.value)}
                  placeholder={t('gate.vehicles.lettersPlaceholder')}
                  className="w-24 h-20 text-center font-mono text-3xl font-black rounded-2xl border-2 border-amber-400 bg-amber-50/50 text-stone-900 focus:outline-none focus:ring-4 focus:ring-amber-500/20 uppercase tracking-widest"
                />
                <span className="text-[10px] text-stone-500 mt-1 font-bold uppercase tracking-wider">
                  {t('gate.vehicles.lettersLabel')}
                </span>
              </div>

              <span className="text-3xl font-black text-stone-300 pb-5">−</span>

              <div className="flex flex-col items-center">
                <input
                  ref={digitsRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  maxLength={2}
                  value={prefixDigits}
                  onChange={(e) => handleDigitsChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !prefixDigits) {
                      lettersRef.current?.focus();
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (isValidPrefix) {
                        handlePrefixSubmit();
                      }
                    }
                  }}
                  placeholder={t('gate.vehicles.digitsPlaceholder')}
                  className="w-24 h-20 text-center font-mono text-3xl font-black rounded-2xl border-2 border-amber-400 bg-amber-50/50 text-stone-900 focus:outline-none focus:ring-4 focus:ring-amber-500/20 tracking-widest"
                />
                <span className="text-[10px] text-stone-500 mt-1 font-bold uppercase tracking-wider">
                  {t('gate.vehicles.digitsLabel')}
                </span>
              </div>
            </div>

            {/* Normalized plate preview */}
            <div className="text-center">
              {prefixLetters || prefixDigits ? (
                <span className="inline-block font-mono font-black text-base text-amber-900 bg-amber-100 border border-amber-300 px-3 py-1 rounded-lg">
                  {(prefixLetters || '__').toUpperCase()}{(prefixDigits || '--')}
                </span>
              ) : (
                <span className="text-xs text-stone-400">
                  e.g. MP09, RJ14, PB10, HR26
                </span>
              )}
            </div>

            {prefixError && (
              <p className="text-xs font-semibold text-rose-600 text-center">
                {prefixError}
              </p>
            )}

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsOthersOpen(false)}
                className="h-12 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-sm transition-transform active:scale-95 cursor-pointer"
              >
                {t('gate.vehicles.cancel')}
              </button>
              <button
                type="button"
                disabled={!isValidPrefix}
                onClick={handlePrefixSubmit}
                className={`h-12 rounded-xl font-black text-sm transition-transform active:scale-95 cursor-pointer shadow-xs flex items-center justify-center gap-1.5 ${
                  isValidPrefix
                    ? 'bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950'
                    : 'bg-stone-200 text-stone-400 cursor-not-allowed opacity-60'
                }`}
              >
                <span>{t('gate.vehicles.addVehicle')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
