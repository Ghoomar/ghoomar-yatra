import { RoleName } from '@/lib/types/database';

export interface GateEvent {
  id: string; // UUID primary key
  event_type: 'visitor' | 'vehicle';
  business_date: string; // YYYY-MM-DD
  timestamp: string; // ISO 8601 string
  increment: number;
  location_id?: string | null;
  location_name?: string | null;
  counter_type?: string; // 'entry'
  entered_by?: string | null;
  device_id?: string | null;
  sync_status: 'pending' | 'syncing' | 'synced' | 'failed';
  sync_attempts: number;
  last_sync_error?: string | null;
  created_at: string;
}

export interface DeviceEnrollment {
  key: 'device_enrollment';
  deviceId: string;
  role: RoleName;
  userEmail: string;
  userId: string;
  status: 'active' | 'revoked';
  enrolledAt: string;
}

const DB_NAME = 'ghoomar_gate_offline_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error('Listener error in offline-store:', e);
    }
  });
}

export function subscribeToStoreChanges(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB is only available in browser'));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      // Store 1: gate_events
      if (!db.objectStoreNames.contains('gate_events')) {
        const eventStore = db.createObjectStore('gate_events', { keyPath: 'id' });
        eventStore.createIndex('by_sync_status', 'sync_status', { unique: false });
        eventStore.createIndex('by_business_date', 'business_date', { unique: false });
        eventStore.createIndex('by_timestamp', 'timestamp', { unique: false });
      }

      // Store 2: gate_metadata
      if (!db.objectStoreNames.contains('gate_metadata')) {
        db.createObjectStore('gate_metadata', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });

  return dbPromise;
}

// ----------------------------------------------------
// DEVICE ENROLLMENT MANAGEMENT
// ----------------------------------------------------

export async function getDeviceEnrollment(): Promise<DeviceEnrollment | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('gate_metadata', 'readonly');
      const store = tx.objectStore('gate_metadata');
      const req = store.get('device_enrollment');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Error fetching device enrollment:', err);
    return null;
  }
}

export async function saveDeviceEnrollment(
  enrollment: Omit<DeviceEnrollment, 'key'>
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gate_metadata', 'readwrite');
    const store = tx.objectStore('gate_metadata');
    const record: DeviceEnrollment = {
      key: 'device_enrollment',
      ...enrollment,
    };
    const req = store.put(record);
    req.onsuccess = () => {
      notifyListeners();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearDeviceEnrollment(): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gate_metadata', 'readwrite');
    const store = tx.objectStore('gate_metadata');
    const req = store.delete('device_enrollment');
    req.onsuccess = () => {
      notifyListeners();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

// ----------------------------------------------------
// VEHICLE LOCATIONS CACHE
// ----------------------------------------------------

export async function saveCachedLocations(locations: any[]): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction('gate_metadata', 'readwrite');
    const store = tx.objectStore('gate_metadata');
    store.put({ key: 'cached_locations', locations });
  } catch (err) {
    console.error('Error caching locations:', err);
  }
}

export async function getCachedLocations(): Promise<any[]> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction('gate_metadata', 'readonly');
      const store = tx.objectStore('gate_metadata');
      const req = store.get('cached_locations');
      req.onsuccess = () => resolve(req.result?.locations || []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    console.error('Error reading cached locations:', err);
    return [];
  }
}

// ----------------------------------------------------
// EVENT CREATION & PERSISTENCE (INSTANT < 5MS)
// ----------------------------------------------------

export async function recordVisitorEvent(
  increment: number,
  businessDate: string,
  enteredBy?: string | null,
  deviceId?: string | null
): Promise<GateEvent> {
  const db = await getDB();
  const event: GateEvent = {
    id: crypto.randomUUID(),
    event_type: 'visitor',
    business_date: businessDate,
    timestamp: new Date().toISOString(),
    increment,
    counter_type: 'entry',
    entered_by: enteredBy || null,
    device_id: deviceId || null,
    sync_status: 'pending',
    sync_attempts: 0,
    created_at: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction('gate_events', 'readwrite');
    const store = tx.objectStore('gate_events');
    const req = store.add(event);
    req.onsuccess = () => {
      notifyListeners();
      resolve(event);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function recordVehicleEvent(
  locationId: string,
  locationName: string,
  businessDate: string,
  enteredBy?: string | null,
  deviceId?: string | null
): Promise<GateEvent> {
  const db = await getDB();
  const event: GateEvent = {
    id: crypto.randomUUID(),
    event_type: 'vehicle',
    business_date: businessDate,
    timestamp: new Date().toISOString(),
    location_id: locationId,
    location_name: locationName,
    increment: 1,
    counter_type: 'entry',
    entered_by: enteredBy || null,
    device_id: deviceId || null,
    sync_status: 'pending',
    sync_attempts: 0,
    created_at: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction('gate_events', 'readwrite');
    const store = tx.objectStore('gate_events');
    const req = store.add(event);
    req.onsuccess = () => {
      notifyListeners();
      resolve(event);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function undoLastLocalEvent(): Promise<GateEvent | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gate_events', 'readwrite');
    const store = tx.objectStore('gate_events');
    const index = store.index('by_timestamp');
    const req = index.openCursor(null, 'prev');

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const event = cursor.value as GateEvent;
        if (event.sync_status === 'pending' || event.sync_status === 'failed') {
          cursor.delete();
          notifyListeners();
          resolve(event);
          return;
        }
        resolve(event);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// ----------------------------------------------------
// SYNC QUEUE QUERIES & STATE TRANSITIONS
// ----------------------------------------------------

export async function getPendingEvents(): Promise<GateEvent[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gate_events', 'readonly');
    const store = tx.objectStore('gate_events');
    const index = store.index('by_sync_status');
    const results: GateEvent[] = [];

    const reqPending = index.openCursor(IDBKeyRange.only('pending'));
    reqPending.onsuccess = () => {
      const cursor = reqPending.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        const reqFailed = index.openCursor(IDBKeyRange.only('failed'));
        reqFailed.onsuccess = () => {
          const cursorFailed = reqFailed.result;
          if (cursorFailed) {
            results.push(cursorFailed.value);
            cursorFailed.continue();
          } else {
            resolve(results);
          }
        };
        reqFailed.onerror = () => reject(reqFailed.error);
      }
    };
    reqPending.onerror = () => reject(reqPending.error);
  });
}

export async function markEventsSyncing(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gate_events', 'readwrite');
    const store = tx.objectStore('gate_events');

    let completed = 0;
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (getReq.result) {
          const ev = getReq.result as GateEvent;
          ev.sync_status = 'syncing';
          ev.sync_attempts += 1;
          store.put(ev);
        }
        completed++;
        if (completed === ids.length) {
          notifyListeners();
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    }
  });
}

export async function markEventsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gate_events', 'readwrite');
    const store = tx.objectStore('gate_events');

    let completed = 0;
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (getReq.result) {
          const ev = getReq.result as GateEvent;
          ev.sync_status = 'synced';
          ev.last_sync_error = null;
          store.put(ev);
        }
        completed++;
        if (completed === ids.length) {
          notifyListeners();
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    }
  });
}

export async function markEventsFailed(ids: string[], error: string): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gate_events', 'readwrite');
    const store = tx.objectStore('gate_events');

    let completed = 0;
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (getReq.result) {
          const ev = getReq.result as GateEvent;
          ev.sync_status = 'failed';
          ev.last_sync_error = error;
          store.put(ev);
        }
        completed++;
        if (completed === ids.length) {
          notifyListeners();
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    }
  });
}

// ----------------------------------------------------
// LOCAL AGGREGATES FOR BUSINESS DATE
// ----------------------------------------------------

export async function getLocalDayEvents(businessDate: string): Promise<GateEvent[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gate_events', 'readonly');
    const store = tx.objectStore('gate_events');
    const index = store.index('by_business_date');
    const req = index.getAll(IDBKeyRange.only(businessDate));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingCount(): Promise<number> {
  try {
    const pending = await getPendingEvents();
    return pending.length;
  } catch {
    return 0;
  }
}
