'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { getTodayBusinessDate, formatNumber, formatTimeAgo } from '@/lib/utils';
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
  Clock,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';

interface VehicleLocation {
  id: string;
  name: string;
  count: number;
}

const DEFAULT_LOCATIONS: VehicleLocation[] = [
  { id: 'delhi', name: 'DELHI', count: 0 },
  { id: 'noida', name: 'NOIDA / GHAZIABAD', count: 0 },
  { id: 'amroha', name: 'AMROHA', count: 0 },
  { id: 'moradabad', name: 'MORADABAD', count: 0 },
  { id: 'meerut', name: 'MEERUT', count: 0 },
  { id: 'other', name: 'OTHER', count: 0 },
];

export default function GateCounterPage() {
  const supabase = createClient();
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
    // Immediate optimistic local UI update (0ms lag)
    setTotalVisitors((prev) => prev + increment);
    setLastAction(`+${increment} Visitors`);
    setLastUpdatedAt(new Date().toISOString());

    // Commit to IndexedDB
    try {
      await recordVisitorEvent(
        increment,
        businessDate,
        enrollment?.userId || null,
        enrollment?.deviceId || null
      );
      // Trigger background sync
      syncPendingEvents();
    } catch (err) {
      console.error('Failed to commit visitor event locally:', err);
    }
  };

  const handleAddVehicle = async (locationId: string, locationName: string) => {
    // Immediate optimistic local UI update (0ms lag)
    setTotalCars((prev) => prev + 1);
    setLocations((prev) =>
      prev.map((l) => (l.id === locationId ? { ...l, count: l.count + 1 } : l))
    );
    setLastAction(`+1 Car from ${locationName}`);
    setLastUpdatedAt(new Date().toISOString());

    // Commit to IndexedDB
    try {
      await recordVehicleEvent(
        locationId,
        locationName,
        businessDate,
        enrollment?.userId || null,
        enrollment?.deviceId || null
      );
      // Trigger background sync
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
          setLastAction(`Undone +${undone.increment} Visitors`);
        } else {
          setTotalCars((prev) => Math.max(0, prev - 1));
          setLocations((prev) =>
            prev.map((l) => (l.id === undone.location_id ? { ...l, count: Math.max(0, l.count - 1) } : l))
          );
          setLastAction(`Undone +1 Car from ${undone.location_name}`);
        }
      } else {
        setLastAction('No recent local entries to undo');
      }
    } catch (err) {
      console.error('Error undoing event:', err);
    }
  };

  const handleManualSync = async () => {
    await syncPendingEvents();
    await loadData();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-12">
      {/* Top Banner with Device & Sync Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-stone-900 text-white p-4 rounded-2xl shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-400 font-bold uppercase tracking-wider">
              Highway Gate & Footfall Console
            </span>
            {enrollment ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-stone-800 text-stone-300 px-2 py-0.5 rounded-full border border-stone-700">
                <Smartphone className="h-3 w-3 text-amber-400" />
                Enrolled Device
              </span>
            ) : (
              <Link href="/login" className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 px-2 py-0.5 rounded-full border border-amber-500/40">
                <ShieldCheck className="h-3 w-3" /> Enroll Guard Device
              </Link>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-0.5 flex items-center gap-2">
            Fast Touch Counter
          </h1>
        </div>

        {/* Sync & Date Badges */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Reactive Sync Indicator */}
          {syncState.status === 'syncing' ? (
            <div className="flex items-center gap-1.5 bg-sky-950/80 border border-sky-600/50 text-sky-300 px-2.5 py-1 rounded-lg font-medium shadow-xs">
              <RotateCw className="h-3.5 w-3.5 animate-spin text-sky-400" />
              <span>Syncing {syncState.pendingCount} entries...</span>
            </div>
          ) : syncState.status === 'offline_pending' ? (
            <div className="flex items-center gap-1.5 bg-amber-950/80 border border-amber-600/50 text-amber-300 px-2.5 py-1 rounded-lg font-medium shadow-xs">
              <WifiOff className="h-3.5 w-3.5 text-amber-400" />
              <span>Offline · {syncState.pendingCount} pending</span>
            </div>
          ) : syncState.status === 'failed' ? (
            <button
              onClick={handleManualSync}
              className="flex items-center gap-1.5 bg-rose-950/80 border border-rose-600/50 text-rose-300 px-2.5 py-1 rounded-lg font-medium shadow-xs hover:bg-rose-900 cursor-pointer"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
              <span>{syncState.pendingCount} failed · Sync Now</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 bg-emerald-950/80 border border-emerald-600/50 text-emerald-300 px-2.5 py-1 rounded-lg font-medium shadow-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Online · Synced</span>
            </div>
          )}

          {/* Date Badge */}
          <div className="bg-stone-800 border border-stone-700 rounded-lg px-2.5 py-1 text-stone-300">
            Date: <strong className="text-white">{businessDate}</strong>
          </div>

          {/* Manual Refresh / Sync Action */}
          <button
            onClick={handleManualSync}
            title="Refresh and sync transactions"
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 active:scale-95 transition-transform"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-white border-2 border-stone-200/80 rounded-2xl p-4 sm:p-5 text-center shadow-xs">
          <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-stone-500 uppercase tracking-wider">
            <Users className="h-4 w-4 text-amber-600" /> Today's Visitors
          </div>
          <div data-testid="visitors-count" className="text-4xl sm:text-5xl font-black text-stone-900 mt-2 tracking-tight">
            {formatNumber(totalVisitors)}
          </div>
          <div className="text-[11px] text-stone-400 mt-1">Cumulative footfall</div>
        </div>

        <div className="bg-white border-2 border-stone-200/80 rounded-2xl p-4 sm:p-5 text-center shadow-xs">
          <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-stone-500 uppercase tracking-wider">
            <Car className="h-4 w-4 text-sky-600" /> Today's Vehicles
          </div>
          <div data-testid="vehicles-count" className="text-4xl sm:text-5xl font-black text-stone-900 mt-2 tracking-tight">
            {formatNumber(totalCars)}
          </div>
          <div className="text-[11px] text-stone-400 mt-1">Total cars logged</div>
        </div>
      </div>

      {/* Undo Action Bar */}
      <div className="flex items-center justify-between bg-stone-100 border border-stone-200 p-3 rounded-xl text-xs">
        <span className="text-stone-600 truncate mr-2">
          {lastAction ? (
            <span>Last Action: <strong className="text-stone-900">{lastAction}</strong></span>
          ) : (
            'No recent action'
          )}
        </span>
        <Button
          variant="outline"
          size="sm"
          data-testid="btn-undo"
          onClick={handleUndo}
          className="gap-1 text-xs border-stone-300 hover:bg-stone-200 shrink-0 touch-manipulation active:scale-95"
        >
          <Undo2 className="h-3.5 w-3.5" /> Undo Last Tap
        </Button>
      </div>

      {/* SECTION 1: VISITOR COUNTER BUTTONS */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs sm:text-sm font-bold text-stone-900 uppercase tracking-wider flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-600" /> Record Entering Visitors
          </h2>
          <span className="text-[11px] text-stone-400">Instant touch response</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          {[1, 2, 5, 10].map((inc) => (
            <button
              key={inc}
              data-testid={`btn-visitor-${inc}`}
              onClick={() => handleAddVisitors(inc)}
              className="h-24 sm:h-28 rounded-2xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950 font-black text-3xl sm:text-4xl shadow-md shadow-amber-500/20 flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer touch-manipulation"
            >
              <span>+{inc}</span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-950/70 mt-1">
                {inc === 1 ? 'Person' : 'Group'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* SECTION 2: VEHICLE ORIGIN COUNTER */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs sm:text-sm font-bold text-stone-900 uppercase tracking-wider flex items-center gap-2">
            <Car className="h-4 w-4 text-sky-600" /> Record Vehicle by Origin
          </h2>
          <span className="text-[11px] text-stone-400">No registration plate stored</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
          {locations.map((loc) => (
            <button
              key={loc.id}
              data-testid={`btn-vehicle-${loc.id}`}
              onClick={() => handleAddVehicle(loc.id, loc.name)}
              className="h-20 sm:h-24 rounded-2xl bg-stone-900 hover:bg-stone-800 active:bg-stone-950 text-white p-2.5 sm:p-3 flex flex-col items-center justify-center transition-transform active:scale-95 cursor-pointer shadow-sm touch-manipulation"
            >
              <div className="text-xs sm:text-sm font-bold tracking-tight text-amber-400 uppercase truncate max-w-full">
                {loc.name}
              </div>
              <div className="text-base sm:text-xl font-extrabold text-white mt-0.5">+1 Car</div>
              <div className="text-[10px] text-stone-400">Today: {loc.count}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
