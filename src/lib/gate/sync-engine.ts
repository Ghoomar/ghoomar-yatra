import { createClient } from '@/lib/supabase/client';
import {
  getPendingEvents,
  markEventsSyncing,
  markEventsSynced,
  markEventsFailed,
  getDeviceEnrollment,
  clearDeviceEnrollment,
  GateEvent,
} from './offline-store';

export type SyncStatus = 'online_synced' | 'offline_pending' | 'syncing' | 'failed';

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  isOnline: boolean;
  lastSyncAt: Date | null;
  errorMessage: string | null;
}

let isSyncing = false;
let lastSyncAt: Date | null = null;
let lastErrorMessage: string | null = null;
const stateListeners = new Set<(state: SyncState) => void>();

function notifyState(isOnline: boolean, pendingCount: number) {
  let status: SyncStatus = 'online_synced';
  if (isSyncing) {
    status = 'syncing';
  } else if (!isOnline && pendingCount > 0) {
    status = 'offline_pending';
  } else if (lastErrorMessage && pendingCount > 0) {
    status = 'failed';
  } else if (pendingCount > 0) {
    status = 'offline_pending';
  }

  const state: SyncState = {
    status,
    pendingCount,
    isOnline,
    lastSyncAt,
    errorMessage: lastErrorMessage,
  };

  stateListeners.forEach((fn) => {
    try {
      fn(state);
    } catch (e) {
      console.error('Error in sync state listener:', e);
    }
  });
}

export function subscribeToSyncState(callback: (state: SyncState) => void): () => void {
  stateListeners.add(callback);
  return () => {
    stateListeners.delete(callback);
  };
}

export async function syncPendingEvents(): Promise<{ success: boolean; synced: number; error?: string }> {
  if (isSyncing) {
    return { success: false, synced: 0, error: 'Sync already in progress' };
  }

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : false;
  if (!isOnline) {
    const pending = await getPendingEvents();
    notifyState(false, pending.length);
    return { success: false, synced: 0, error: 'Offline' };
  }

  const pending = await getPendingEvents();
  if (pending.length === 0) {
    lastErrorMessage = null;
    notifyState(true, 0);
    return { success: true, synced: 0 };
  }

  isSyncing = true;
  notifyState(true, pending.length);

  const supabase = createClient();
  const enrollment = await getDeviceEnrollment();

  try {
    // 1. Check Device Revocation with server if enrolled
    if (enrollment && enrollment.deviceId) {
      const { data: authRecord } = await supabase
        .from('gate_device_authorizations')
        .select('is_active, revoked_at')
        .eq('device_id', enrollment.deviceId)
        .maybeSingle();

      if (authRecord && (authRecord.is_active === false || authRecord.revoked_at !== null)) {
        await clearDeviceEnrollment();
        throw new Error('Device offline authorization has been revoked by an administrator.');
      }
    }

    // 2. Mark pending batch as 'syncing'
    const pendingIds = pending.map((e) => e.id);
    await markEventsSyncing(pendingIds);

    const visitorBatch: GateEvent[] = [];
    const vehicleBatch: GateEvent[] = [];

    for (const ev of pending) {
      if (ev.event_type === 'visitor') {
        visitorBatch.push(ev);
      } else {
        vehicleBatch.push(ev);
      }
    }

    // 3. Idempotent Upsert for Visitors
    if (visitorBatch.length > 0) {
      const visitorRows = visitorBatch.map((e) => ({
        id: e.id,
        business_date: e.business_date,
        timestamp: e.timestamp,
        increment: e.increment,
        counter_type: e.counter_type || 'entry',
        entered_by: e.entered_by || enrollment?.userId || null,
      }));

      const { error: vErr } = await supabase
        .from('visitor_counter_events')
        .upsert(visitorRows, { onConflict: 'id', ignoreDuplicates: true });

      if (vErr) throw vErr;
    }

    // 4. Idempotent Upsert for Vehicles
    if (vehicleBatch.length > 0) {
      const vehicleRows = vehicleBatch.map((e) => ({
        id: e.id,
        business_date: e.business_date,
        timestamp: e.timestamp,
        location_id: e.location_id,
        increment: e.increment,
        entered_by: e.entered_by || enrollment?.userId || null,
      }));

      const { error: cErr } = await supabase
        .from('vehicle_counter_events')
        .upsert(vehicleRows, { onConflict: 'id', ignoreDuplicates: true });

      if (cErr) throw cErr;
    }

    // 5. Mark all as synced in IndexedDB
    await markEventsSynced(pendingIds);

    // 6. Update last sync time on server if device enrolled
    if (enrollment && enrollment.deviceId) {
      await supabase
        .from('gate_device_authorizations')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('device_id', enrollment.deviceId);
    }

    lastSyncAt = new Date();
    lastErrorMessage = null;
    isSyncing = false;

    const remaining = await getPendingEvents();
    notifyState(true, remaining.length);

    return { success: true, synced: pendingIds.length };
  } catch (err: any) {
    console.error('Gate synchronization error:', err);
    lastErrorMessage = err.message || 'Synchronization failed';
    isSyncing = false;

    const pendingIds = pending.map((e) => e.id);
    await markEventsFailed(pendingIds, lastErrorMessage || 'Unknown sync error');

    const remaining = await getPendingEvents();
    notifyState(isOnline, remaining.length);

    return { success: false, synced: 0, error: lastErrorMessage || undefined };
  }
}

let syncIntervalId: any = null;

export function startSyncEngine(): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleOnline = () => {
    syncPendingEvents();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      syncPendingEvents();
    }
  };

  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // Initial sync attempt
  syncPendingEvents();

  // Periodic heartbeat sync every 30 seconds
  syncIntervalId = setInterval(() => {
    if (navigator.onLine) {
      syncPendingEvents();
    }
  }, 30000);

  return () => {
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (syncIntervalId) clearInterval(syncIntervalId);
  };
}
