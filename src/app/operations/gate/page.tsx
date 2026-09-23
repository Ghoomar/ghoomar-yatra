'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

interface VehicleLocation {
  id: string;
  name: string;
  count: number;
}

const BIKE_LOCATION_ID = 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f';

const DEFAULT_LOCATIONS: VehicleLocation[] = [
  { id: 'd343fa14-72f7-49c1-bfbc-e8bffdd2ddd9', name: 'DL', count: 0 },
  { id: 'c59f0429-9ed0-47f4-8cbb-8542ca4ec5d7', name: 'UP16', count: 0 },
  { id: 'b1c52c0e-2d4c-4d3b-b3fd-0b62c1fa6c15', name: 'UP22', count: 0 },
  { id: 'eec2b68d-7725-42a9-a0b8-91321a53b803', name: 'UP23', count: 0 },
  { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'HR', count: 0 },
  { id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', name: 'UK', count: 0 },
  { id: 'ef6e8d6b-a68b-409f-a2e0-5794c6205833', name: 'Others', count: 0 },
  { id: BIKE_LOCATION_ID, name: 'Bike', count: 0 },
];

const PREFIX_ORDER = ['DL', 'UP16', 'UP22', 'UP23', 'HR', 'UK', 'Others'];

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
              .select('location_id, increment, timestamp')
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
  const handleAddVisitors = async (increment: number) => {
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

  const handleAddVehicle = async (locationId: string, locationName: string) => {
    setTotalCars((prev) => prev + 1);
    setLocations((prev) =>
      prev.map((l) => (l.id === locationId ? { ...l, count: l.count + 1 } : l))
    );
    const locDisplay = locationName === 'Bike' 
      ? t('gate.vehicles.bike') 
      : (locationName.toLowerCase() === 'others' ? t('gate.regions.Others') : locationName);
    setLastAction(t('gate.messages.addedVehicle', { location: locDisplay }));
    setLastUpdatedAt(new Date().toISOString());

    try {
      await recordVehicleEvent(
        locationId,
        locationName,
        businessDate,
        enrollment?.userId || null,
        enrollment?.deviceId || null
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
            undone.location_name?.toLowerCase() === 'bike';
          const locDisplay = isBike 
            ? t('gate.vehicles.bike') 
            : (undone.location_name?.toLowerCase() === 'others' ? t('gate.regions.Others') : (undone.location_name || ''));
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

  // Derive the 7 car prefix locations in guaranteed order
  const carLocations = useMemo(() => {
    return PREFIX_ORDER.map((prefix) => {
      const found = locations.find((l) => l.name.toUpperCase() === prefix.toUpperCase());
      const fallback = DEFAULT_LOCATIONS.find((d) => d.name === prefix);
      return (
        found || {
          id: fallback ? fallback.id : prefix.toLowerCase(),
          name: prefix,
          count: 0,
        }
      );
    });
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
    <div className="max-w-3xl mx-auto space-y-3 sm:space-y-4 pb-8">
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        <div className="bg-white border border-stone-200 rounded-xl p-2.5 sm:p-3.5 text-center shadow-xs">
          <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            <Users className="h-3.5 w-3.5 text-amber-600" /> {t('gate.kpi.todaysVisitors')}
          </div>
          <div
            data-testid="visitors-count"
            className="text-3xl sm:text-4xl font-black text-stone-900 mt-0.5 tracking-tight"
          >
            {formatNumber(totalVisitors)}
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-2.5 sm:p-3.5 text-center shadow-xs">
          <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            <Car className="h-3.5 w-3.5 text-sky-600" /> {t('gate.kpi.todaysVehicles')}
          </div>
          <div
            data-testid="vehicles-count"
            className="text-3xl sm:text-4xl font-black text-stone-900 mt-0.5 tracking-tight"
          >
            {formatNumber(totalCars)}
          </div>
        </div>
      </div>

      {/* SECTION 1: VISITOR COUNTER BUTTONS + INTEGRATED COMPACT UNDO */}
      <div className="bg-white border border-stone-200 rounded-xl p-3 sm:p-4 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs sm:text-sm font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
            <Users className="h-4 w-4 text-amber-600" /> {t('gate.visitors.title')}
          </h2>

          {/* Integrated Compact Undo Action */}
          <div className="flex items-center gap-2">
            {lastAction && (
              <span className="text-[11px] text-stone-500 truncate max-w-[120px] sm:max-w-[200px]">
                {t('gate.visitors.lastAction', { action: lastAction })}
              </span>
            )}
            <button
              type="button"
              data-testid="btn-undo"
              onClick={handleUndo}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-stone-100 hover:bg-stone-200 active:bg-stone-300 text-stone-800 border border-stone-300 active:scale-95 transition-transform cursor-pointer shadow-2xs"
            >
              <Undo2 className="h-3.5 w-3.5 text-amber-600" />
              <span>{t('gate.visitors.undoLastTap')}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
          {[1, 2, 5, 10].map((inc) => (
            <button
              key={inc}
              data-testid={`btn-visitor-${inc}`}
              onClick={() => handleAddVisitors(inc)}
              className="h-20 sm:h-24 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950 font-black text-2xl sm:text-3xl shadow-xs flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer touch-manipulation"
            >
              <span>+{inc}</span>
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-amber-950/75 mt-0.5">
                {inc === 1 ? t('gate.visitors.person') : t('gate.visitors.group')}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* SECTION 2: VEHICLE COUNTER BUTTONS */}
      <div className="bg-white border border-stone-200 rounded-xl p-3 sm:p-4 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs sm:text-sm font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
            <Car className="h-4 w-4 text-sky-600" /> {t('gate.vehicles.title')}
          </h2>
        </div>

        {/* 7 Registration-prefix buttons: DL, UP16, UP22, UP23 on row 1; HR, UK, Others on row 2 */}
        <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
          {carLocations.map((loc) => {
            const isOthers = loc.name.toLowerCase() === 'others';
            const displayName = isOthers ? t('gate.regions.Others') : loc.name;
            return (
              <button
                key={loc.id}
                data-testid={`btn-vehicle-${loc.id}`}
                onClick={() => handleAddVehicle(loc.id, loc.name)}
                className={`h-16 sm:h-18 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950 flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer touch-manipulation shadow-xs ${
                  isOthers ? 'col-span-2' : 'col-span-1'
                }`}
              >
                <div
                  className={`font-black tracking-tight leading-none ${
                    isOthers ? 'text-base sm:text-lg' : 'text-xl sm:text-2xl'
                  }`}
                >
                  {displayName}
                </div>
                <div className="text-[11px] font-bold text-amber-950/75 mt-1">+1</div>
              </button>
            );
          })}
        </div>

        {/* Separate +1 Bike Button */}
        <button
          type="button"
          data-testid="btn-vehicle-bike"
          onClick={() => handleAddVehicle(bikeLocation.id, 'Bike')}
          className="w-full h-12 sm:h-13 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950 font-black text-base sm:text-lg shadow-xs flex items-center justify-center gap-2 transition-transform active:scale-95 cursor-pointer touch-manipulation"
        >
          <Bike className="h-5 w-5" />
          <span>+1 {t('gate.vehicles.bike')}</span>
        </button>
      </div>
    </div>
  );
}
