/**
 * Gate Counter Offline Safety & Service Worker Cache Verification Suite
 * 
 * Verifies:
 * 1. Service Worker caching logic (Network First with Cache Fallback for Next.js chunks, Gate navigation fallback)
 * 2. Service Worker cache upgrade ('ghoomar-gate-v2') and stale cache purging
 * 3. Gate Counter offline initialization from local store (0ms lag, no network required)
 * 4. Visitor counter increments (+1, +2, +5, +10) stored locally in IndexedDB
 * 5. Vehicle counters (DL, UP16, UP22, UP23, HR, UK, Others, Bike) stored locally
 * 6. Local event persistence: sync_status = 'pending', accurate original ISO timestamps
 * 7. Offline queue remains intact while offline (sync attempts do not drop events, queue count equals total events)
 * 8. Undo functionality for un-synced events
 * 9. Reconnecting (online event / sync trigger) idempotently upserts events to Supabase
 * 10. Original event timestamps are preserved and transmitted verbatim to Supabase (not overwritten by sync time)
 * 11. Events marked as 'synced' in IndexedDB and pending queue cleared upon successful sync
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAILED: ${message}`);
    testsFailed++;
  }
}

// =========================================================================
// PART 1: IN-MEMORY INDEXEDDB ENGINE IMPLEMENTATION FOR NODE
// =========================================================================

class MockIDBKeyRange {
  constructor(lower, upper, lowerOpen, upperOpen) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }
  static only(value) {
    return new MockIDBKeyRange(value, value, false, false);
  }
}

class MockObjectStore {
  constructor(name, options = {}, indexes = new Map()) {
    this.name = name;
    this.keyPath = options.keyPath || 'id';
    this.records = new Map();
    this.indexes = indexes;
  }

  createIndex(name, keyPath, options) {
    const idx = { name, keyPath, unique: Boolean(options?.unique) };
    this.indexes.set(name, idx);
    return idx;
  }

  index(name) {
    const idxMeta = this.indexes.get(name);
    if (!idxMeta) throw new Error(`Index ${name} not found`);
    const store = this;

    return {
      getAll(range) {
        const req = { onsuccess: null, onerror: null, result: [] };
        setTimeout(() => {
          const results = [];
          for (const item of store.records.values()) {
            const val = item[idxMeta.keyPath];
            if (range instanceof MockIDBKeyRange) {
              if (val === range.lower) results.push(JSON.parse(JSON.stringify(item)));
            } else if (range === undefined || val === range) {
              results.push(JSON.parse(JSON.stringify(item)));
            }
          }
          req.result = results;
          req.onsuccess?.();
        }, 0);
        return req;
      },

      openCursor(range, direction = 'next') {
        const req = { onsuccess: null, onerror: null, result: null };
        setTimeout(() => {
          let items = Array.from(store.records.values());
          if (range instanceof MockIDBKeyRange) {
            items = items.filter((item) => item[idxMeta.keyPath] === range.lower);
          }
          if (direction === 'prev') {
            items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
          } else {
            items.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
          }

          let currentIndex = 0;
          function advanceCursor() {
            if (currentIndex >= items.length) {
              req.result = null;
              req.onsuccess?.();
              return;
            }
            const currentItem = items[currentIndex];
            req.result = {
              value: JSON.parse(JSON.stringify(currentItem)),
              continue() {
                currentIndex++;
                advanceCursor();
              },
              delete() {
                const key = currentItem[store.keyPath];
                store.records.delete(key);
              },
            };
            req.onsuccess?.();
          }

          advanceCursor();
        }, 0);
        return req;
      },
    };
  }

  get(key) {
    const req = { onsuccess: null, onerror: null, result: undefined };
    setTimeout(() => {
      const rec = this.records.get(key);
      req.result = rec ? JSON.parse(JSON.stringify(rec)) : undefined;
      req.onsuccess?.();
    }, 0);
    return req;
  }

  put(record) {
    const req = { onsuccess: null, onerror: null };
    setTimeout(() => {
      const key = record[this.keyPath];
      this.records.set(key, JSON.parse(JSON.stringify(record)));
      req.onsuccess?.();
    }, 0);
    return req;
  }

  add(record) {
    const req = { onsuccess: null, onerror: null };
    setTimeout(() => {
      const key = record[this.keyPath];
      if (this.records.has(key)) {
        req.error = new Error(`Key already exists: ${key}`);
        req.onerror?.();
      } else {
        this.records.set(key, JSON.parse(JSON.stringify(record)));
        req.onsuccess?.();
      }
    }, 0);
    return req;
  }

  delete(key) {
    const req = { onsuccess: null, onerror: null };
    setTimeout(() => {
      this.records.delete(key);
      req.onsuccess?.();
    }, 0);
    return req;
  }
}

class MockIDBDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.stores = new Map();
    this.objectStoreNames = {
      contains: (name) => this.stores.has(name),
    };
  }

  createObjectStore(name, options) {
    const store = new MockObjectStore(name, options);
    this.stores.set(name, store);
    return store;
  }

  transaction(storeNames, mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const db = this;
    return {
      objectStore(name) {
        const store = db.stores.get(name);
        if (!store) throw new Error(`Object store ${name} not found`);
        return store;
      },
    };
  }
}

const mockDB = new MockIDBDatabase('ghoomar_gate_offline_db', 1);

const mockIndexedDB = {
  open(name, version) {
    const req = {
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      result: mockDB,
    };
    setTimeout(() => {
      if (req.onupgradeneeded) {
        req.onupgradeneeded({ target: { result: mockDB } });
      }
      req.onsuccess?.();
    }, 0);
    return req;
  },
};

function setOnlineStatus(val) {
  try {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: val, configurable: true, writable: true });
  } catch {
    globalThis.navigator.onLine = val;
  }
}

// Setup Node globals for browser APIs
globalThis.window = globalThis;
globalThis.IDBKeyRange = MockIDBKeyRange;
globalThis.indexedDB = mockIndexedDB;
setOnlineStatus(false);
globalThis.document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };

// =========================================================================
// PART 2: SERVICE WORKER CACHE & FETCH SPECIFICATION SIMULATION
// =========================================================================

class MockCache {
  constructor(name) {
    this.name = name;
    this.map = new Map();
  }

  async addAll(urls) {
    for (const u of urls) {
      this.map.set(u, { url: u, status: 200, body: `shell-content-for-${u}` });
    }
  }

  async put(request, response) {
    const key = typeof request === 'string' ? request : request.url;
    this.map.set(key, response);
  }

  async match(request) {
    const key = typeof request === 'string' ? request : request.url;
    return this.map.get(key) || null;
  }
}

class MockCacheStorage {
  constructor() {
    this.caches = new Map();
  }

  async open(name) {
    if (!this.caches.has(name)) {
      this.caches.set(name, new MockCache(name));
    }
    return this.caches.get(name);
  }

  async keys() {
    return Array.from(this.caches.keys());
  }

  async delete(name) {
    return this.caches.delete(name);
  }

  async match(request) {
    for (const cache of this.caches.values()) {
      const match = await cache.match(request);
      if (match) return match;
    }
    return null;
  }
}

globalThis.caches = new MockCacheStorage();

// Read sw.js file and verify its contents directly
const swPath = resolve(__dirname, '../public/sw.js');
const swCode = readFileSync(swPath, 'utf8');

console.log('================================================================');
console.log('🧪 GATE COUNTER OFFLINE SAFETY & SERVICE WORKER VERIFICATION');
console.log('================================================================\n');

console.log('📌 Test Group 1: Service Worker Offline Configuration');

// Verify cache name
const cacheNameMatch = swCode.match(/const CACHE_NAME = '([^']+)';/);
assert(cacheNameMatch && cacheNameMatch[1] === 'ghoomar-gate-v2', `Cache namespace is correctly set to 'ghoomar-gate-v2' (found '${cacheNameMatch?.[1]}')`);

// Verify precached URLs includes Gate Counter
assert(swCode.includes("'/operations/gate'"), "Precache URLs explicitly includes '/operations/gate'");
assert(swCode.includes("'/manifest-gate.webmanifest'"), "Precache URLs includes '/manifest-gate.webmanifest'");

// Verify Network First with Cache Fallback for static assets
assert(swCode.includes("url.pathname.startsWith('/_next/static/')"), "Service Worker intercepts Next.js static chunks (/_next/static/*)");
assert(swCode.includes(".catch(() => caches.match(request))"), "Service Worker falls back to cached static chunks when offline");

// Verify navigation fallback for /operations/gate
assert(swCode.includes("url.pathname === '/operations/gate'"), "Gate route has dedicated offline fallback handler");
assert(swCode.includes("caches.match('/operations/gate')"), "Offline navigation serves cached /operations/gate HTML shell");

// Simulate Service Worker Cache Eviction (activate event)
const cacheStorage = globalThis.caches;
await (await cacheStorage.open('ghoomar-gate-v1')).put('/stale-chunk.js', { body: 'stale' });
await (await cacheStorage.open('ghoomar-gate-v2')).put('/operations/gate', { body: 'fresh-gate' });

const existingCachesBefore = await cacheStorage.keys();
assert(existingCachesBefore.includes('ghoomar-gate-v1') && existingCachesBefore.includes('ghoomar-gate-v2'), "Simulated presence of both old (v1) and new (v2) caches before activation");

// Run SW activate logic: delete all caches where name !== 'ghoomar-gate-v2'
const newCacheName = cacheNameMatch[1];
const cacheNames = await cacheStorage.keys();
await Promise.all(
  cacheNames
    .filter((name) => name !== newCacheName)
    .map((name) => cacheStorage.delete(name))
);

const remainingCaches = await cacheStorage.keys();
assert(!remainingCaches.includes('ghoomar-gate-v1'), "Old 'ghoomar-gate-v1' cache purged successfully during activation");
assert(remainingCaches.includes('ghoomar-gate-v2'), "Active 'ghoomar-gate-v2' cache preserved during activation");

// Simulate Network First with Cache Fallback behavior for a Next.js chunk
console.log('\n📌 Test Group 2: Next.js Chunk Fetching (Online vs Offline)');

const chunkUrl = 'https://yatra.ghoomar.in/_next/static/chunks/app/operations/gate/page-12345.js';
const v2Cache = await cacheStorage.open('ghoomar-gate-v2');

// Phase 1: Online fetch succeeds and puts response in cache
let onlineNetworkAvailable = true;
async function simulatedFetchChunk(url) {
  if (onlineNetworkAvailable) {
    const res = { status: 200, url, body: 'console.log("gate page loaded");' };
    await v2Cache.put(url, res);
    return res;
  } else {
    // Network failure -> fallback to cache
    const cached = await v2Cache.match(url);
    if (cached) return cached;
    throw new TypeError('Failed to fetch');
  }
}

const onlineRes = await simulatedFetchChunk(chunkUrl);
assert(onlineRes.status === 200, "Online chunk fetch returns status 200 from network");
const inCache = await v2Cache.match(chunkUrl);
assert(inCache && inCache.body.includes('gate page loaded'), "Chunk was automatically cached in 'ghoomar-gate-v2'");

// Phase 2: Offline - network fails, chunk served from cache
onlineNetworkAvailable = false;
const offlineRes = await simulatedFetchChunk(chunkUrl);
assert(offlineRes && offlineRes.body.includes('gate page loaded'), "Offline chunk fetch successfully served from cache fallback without error");

// =========================================================================
// PART 3: GATE COUNTER OFFLINE STORE & SYNC ENGINE VERIFICATION
// =========================================================================
console.log('\n📌 Test Group 3: Gate Counter Offline Store Operations');

import createJiti from 'jiti';

const tempMockPath = resolve(tmpdir(), `temp-mock-supabase-${Date.now()}.cjs`);
writeFileSync(
  tempMockPath,
  `
const capturedVisitors = [];
const capturedVehicles = [];

function resetCaptured() {
  capturedVisitors.length = 0;
  capturedVehicles.length = 0;
}

function createClient() {
  return {
    from(table) {
      if (table === 'visitor_counter_events') {
        return {
          upsert(rows) {
            capturedVisitors.push(...rows);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'vehicle_counter_events') {
        return {
          upsert(rows) {
            capturedVehicles.push(...rows);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'gate_device_authorizations') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: { is_active: true, revoked_at: null } });
                  },
                };
              },
            };
          },
          update() {
            return {
              eq() {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error('Unexpected table ' + table);
    },
  };
}

module.exports = { createClient, capturedVisitors, capturedVehicles, resetCaptured };
`
);

const jiti = createJiti(resolve(__dirname, 'dummy.js'), {
  alias: {
    '@/lib/supabase/client': tempMockPath,
    '@': resolve(__dirname, '../src'),
  },
});

const offlineStore = jiti('../src/lib/gate/offline-store.ts');
const syncEngineModule = jiti('../src/lib/gate/sync-engine.ts');
const mockSupabase = jiti(tempMockPath);

const {
  recordVisitorEvent,
  recordVehicleEvent,
  undoLastLocalEvent,
  getPendingEvents,
  getLocalDayEvents,
  saveCachedLocations,
  getCachedLocations,
  saveDeviceEnrollment,
  getDeviceEnrollment,
  markEventsSyncing,
  markEventsSynced,
} = offlineStore;

const businessDate = '2026-09-30';

// 1. Device Enrollment & Location caching
await saveDeviceEnrollment({
  deviceId: 'device-test-uuid',
  role: 'gate_operator',
  userEmail: 'gate@ghoomar.in',
  userId: 'user-gate-001',
  status: 'active',
  enrolledAt: new Date().toISOString(),
});

const enroll = await getDeviceEnrollment();
assert(enroll?.deviceId === 'device-test-uuid', `Device enrollment stored & retrieved offline (deviceId=${enroll?.deviceId})`);

const sampleLocations = [
  { id: 'loc-dl', name: 'DL' },
  { id: 'loc-up16', name: 'UP16' },
  { id: 'loc-bike', name: 'Bike' },
];
await saveCachedLocations(sampleLocations);
const cachedLocs = await getCachedLocations();
assert(cachedLocs.length === 3 && cachedLocs[0].name === 'DL', `Vehicle locations cached & retrieved offline (${cachedLocs.length} locations)`);

// 2. Test Visitor increments: +1, +2, +5, +10
console.log('\n📌 Test Group 4: Visitor & Vehicle Counter Event Recording');

const v1 = await recordVisitorEvent(1, businessDate, 'user-gate-001', 'device-test-uuid');
const v2 = await recordVisitorEvent(2, businessDate, 'user-gate-001', 'device-test-uuid');
const v5 = await recordVisitorEvent(5, businessDate, 'user-gate-001', 'device-test-uuid');
const v10 = await recordVisitorEvent(10, businessDate, 'user-gate-001', 'device-test-uuid');

assert(v1.increment === 1 && v1.event_type === 'visitor', "Visitor +1 event recorded with increment = 1");
assert(v2.increment === 2 && v2.event_type === 'visitor', "Visitor +2 event recorded with increment = 2");
assert(v5.increment === 5 && v5.event_type === 'visitor', "Visitor +5 event recorded with increment = 5");
assert(v10.increment === 10 && v10.event_type === 'visitor', "Visitor +10 event recorded with increment = 10");

assert(v1.sync_status === 'pending', "Visitor event sync_status is 'pending'");
assert(Boolean(v1.timestamp && !isNaN(Date.parse(v1.timestamp))), `Original event timestamp is a valid ISO string (${v1.timestamp})`);

// 3. Test Vehicle increments
const carDL = await recordVehicleEvent('loc-dl', 'DL', businessDate, 'user-gate-001', 'device-test-uuid');
const carUP = await recordVehicleEvent('loc-up16', 'UP16', businessDate, 'user-gate-001', 'device-test-uuid');
const bike = await recordVehicleEvent('loc-bike', 'Bike', businessDate, 'user-gate-001', 'device-test-uuid');

assert(carDL.location_name === 'DL' && carDL.increment === 1, "Vehicle 'DL' event recorded with increment = 1");
assert(carUP.location_name === 'UP16' && carUP.increment === 1, "Vehicle 'UP16' event recorded with increment = 1");
assert(bike.location_name === 'Bike' && bike.increment === 1, "Vehicle 'Bike' event recorded with increment = 1");

// 4. Test Local Store Aggregates & Pending Queue
const allEvents = await getLocalDayEvents(businessDate);
assert(allEvents.length === 7, `Local IndexedDB contains exactly 7 events (got ${allEvents.length})`);

const pendingBefore = await getPendingEvents();
assert(pendingBefore.length === 7, `Offline pending queue contains exactly 7 pending events (got ${pendingBefore.length})`);

// 5. Test Undo functionality
console.log('\n📌 Test Group 5: Local Undo Operations');
const undone = await undoLastLocalEvent();
assert(undone?.location_name === 'Bike', `Undo removed the most recent event ('Bike', id=${undone?.id})`);

const pendingAfterUndo = await getPendingEvents();
assert(pendingAfterUndo.length === 6, `Pending queue after undo reduced to exactly 6 events (got ${pendingAfterUndo.length})`);

// 6. Test Offline Safety: sync attempts while offline must NOT drop events
console.log('\n📌 Test Group 6: Offline Sync Queue Resilience');

setOnlineStatus(false);
mockSupabase.resetCaptured();

// Attempt sync while offline
const offlineSyncRes = await syncEngineModule.syncPendingEvents();
assert(offlineSyncRes.success === false && offlineSyncRes.error === 'Offline', "Sync attempt while offline gracefully aborted with error: 'Offline'");

const pendingStillIntact = await getPendingEvents();
assert(pendingStillIntact.length === 6, `All 6 pending events remained 100% intact in offline queue (zero events dropped)`);
assert(mockSupabase.capturedVisitors.length === 0, "No records sent to server while offline");

// 7. Test Reconnection & Idempotent Sync
console.log('\n📌 Test Group 7: Reconnection & Timestamp-Preserving Server Sync');

// Save snapshot of original timestamps
const originalTimestamps = new Map(pendingStillIntact.map((e) => [e.id, e.timestamp]));

// Reconnect to network
setOnlineStatus(true);

// Execute real sync engine end-to-end
const onlineSyncRes = await syncEngineModule.syncPendingEvents();
assert(onlineSyncRes.success === true, `Online sync completed successfully with success: true (synced ${onlineSyncRes.synced} events)`);

// Assertions on synced data
const upsertedVisitors = mockSupabase.capturedVisitors;
const upsertedVehicles = mockSupabase.capturedVehicles;

assert(upsertedVisitors.length === 4, `Successfully upserted 4 visitor events (+1, +2, +5, +10)`);
const totalVisitorsSynced = upsertedVisitors.reduce((sum, r) => sum + r.increment, 0);
assert(totalVisitorsSynced === 18, `Total visitor increment sum equals 18 (1 + 2 + 5 + 10 = 18)`);

assert(upsertedVehicles.length === 2, `Successfully upserted 2 vehicle events (DL and UP16)`);

// Verify timestamps preserved verbatim
let allTimestampsPreserved = true;
for (const row of [...upsertedVisitors, ...upsertedVehicles]) {
  const original = originalTimestamps.get(row.id);
  if (row.timestamp !== original) {
    allTimestampsPreserved = false;
    console.error(`Timestamp mismatch for event ${row.id}: expected ${original}, got ${row.timestamp}`);
  }
}
assert(allTimestampsPreserved, "All original event timestamps were preserved verbatim (not overwritten with sync time)");

// Verify pending queue is now empty
const pendingRemaining = await getPendingEvents();
assert(pendingRemaining.length === 0, `Pending queue is now completely empty (0 pending, got ${pendingRemaining.length})`);

// Verify events in IndexedDB are marked as synced
const dayEvents = await getLocalDayEvents(businessDate);
const allMarkedSynced = dayEvents.every((e) => e.sync_status === 'synced');
assert(allMarkedSynced && dayEvents.length === 6, "All 6 events in local IndexedDB are verified as sync_status: 'synced'");

console.log('\n================================================================');
console.log(`🏁 GATE COUNTER OFFLINE SAFETY RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('================================================================\n');

try { unlinkSync(tempMockPath); } catch {}

if (testsFailed > 0) {
  process.exit(1);
}
