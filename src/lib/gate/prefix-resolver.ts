import { VehicleRegistrationPrefix } from '@/lib/types/database';

export interface RawGateVehicleEvent {
  increment: number;
  vehicle_prefix?: string | null;
  location?:
    | {
        id?: string;
        name?: string;
      }
    | {
        id?: string;
        name?: string;
      }[]
    | null;
  location_name?: string | null;
}

export interface ResolvedCarOrigin {
  locationName: string;
  count: number;
  prefixes: string[];
  isUnmapped: boolean;
}

/**
 * Creates an index map for O(1) prefix lookup.
 * Keys are normalized to uppercase.
 */
export function buildPrefixLookupMap(
  prefixes: VehicleRegistrationPrefix[]
): Map<string, VehicleRegistrationPrefix> {
  const map = new Map<string, VehicleRegistrationPrefix>();
  for (const item of prefixes) {
    if (item.is_active !== false) {
      map.set(item.prefix.trim().toUpperCase(), item);
    }
  }
  return map;
}

/**
 * Resolves a single raw registration prefix or legacy location name to its canonical location name.
 */
export function resolveSinglePrefix(
  rawPrefixOrName: string | null | undefined,
  prefixMap: Map<string, VehicleRegistrationPrefix>,
  locale: string = 'en'
): { locationName: string; isUnmapped: boolean } {
  if (!rawPrefixOrName) {
    return {
      locationName: locale === 'hi' ? 'अन्य' : 'Others',
      isUnmapped: false,
    };
  }

  const clean = rawPrefixOrName.trim().toUpperCase();

  // Handle legacy literal 'OTHERS'
  if (clean === 'OTHERS') {
    return {
      locationName: locale === 'hi' ? 'अन्य' : 'Others',
      isUnmapped: false,
    };
  }

  // Handle BIKE: Bikes have no registration prefix and are never unmapped data
  if (clean === 'BIKE') {
    return {
      locationName: locale === 'hi' ? 'बाइक' : 'Bike',
      isUnmapped: false,
    };
  }

  // Lookup in registration prefix master
  const mapping = prefixMap.get(clean);
  if (mapping) {
    const locName = locale === 'hi' && mapping.name_hi ? mapping.name_hi : mapping.location_name;
    return {
      locationName: locName,
      isUnmapped: false,
    };
  }

  // Handle legacy known location names from vehicle_origin_locations
  if (clean === 'MEERUT') {
    return {
      locationName: locale === 'hi' ? 'मेरठ' : 'Meerut',
      isUnmapped: false,
    };
  }
  if (clean === 'HR') {
    return {
      locationName: locale === 'hi' ? 'हरियाणा' : 'Haryana',
      isUnmapped: false,
    };
  }
  if (clean === 'UK') {
    return {
      locationName: locale === 'hi' ? 'उत्तराखंड' : 'Uttarakhand',
      isUnmapped: false,
    };
  }

  // Unmapped prefix (e.g. UP99)
  return {
    locationName: clean,
    isUnmapped: true,
  };
}

/**
 * Aggregates raw vehicle counter events into sorted Car Origins.
 * - Excludes bike events.
 * - Resolves prefixes via the master.
 * - For historical events where vehicle_prefix IS NULL, preserves existing meaning
 *   through the legacy location_id relationship (UP23, UP22, UP16, DL, Meerut, HR, UK, Others).
 * - Consolidates multiple prefixes mapping to the same location into a single location total.
 * - Identifies unmapped prefixes distinctly.
 */
export function resolveCarOrigins(
  events: RawGateVehicleEvent[],
  prefixMaster: VehicleRegistrationPrefix[] | Map<string, VehicleRegistrationPrefix>,
  locale: string = 'en'
): ResolvedCarOrigin[] {
  const prefixMap =
    prefixMaster instanceof Map ? prefixMaster : buildPrefixLookupMap(prefixMaster);

  const locationAggregates: Record<
    string,
    { count: number; prefixes: Set<string>; isUnmapped: boolean }
  > = {};

  for (const ev of events) {
    const locObj = Array.isArray(ev.location) ? ev.location[0] : ev.location;
    const locNameRaw = locObj?.name || ev.location_name || '';
    const prefixRaw = (ev.vehicle_prefix || '').trim();

    // 1. Exclude bike events
    const isBike =
      locNameRaw.toLowerCase() === 'bike' || prefixRaw.toLowerCase() === 'bike';
    if (isBike) continue;

    const inc = Number(ev.increment) || 1;

    let locationName: string;
    let isUnmapped: boolean;
    let rawKey: string;

    if (prefixRaw) {
      // Modern smart-prefix event: resolve strictly via vehicle_registration_prefixes master
      rawKey = prefixRaw.toUpperCase();
      const res = resolveSinglePrefix(rawKey, prefixMap, locale);
      locationName = res.locationName;
      isUnmapped = res.isUnmapped;
    } else {
      // Historical legacy event where vehicle_prefix IS NULL:
      // Preserves existing meaning through legacy location_id relationship!
      rawKey = (locNameRaw || 'Others').trim();
      const cleanLoc = rawKey.toUpperCase();

      if (!cleanLoc || cleanLoc === 'OTHERS') {
        locationName = locale === 'hi' ? 'अन्य' : 'Others';
        isUnmapped = false;
      } else if (cleanLoc === 'MEERUT') {
        locationName = locale === 'hi' ? 'मेरठ' : 'Meerut';
        isUnmapped = false;
      } else if (cleanLoc === 'HR') {
        locationName = locale === 'hi' ? 'हरियाणा' : 'Haryana';
        isUnmapped = false;
      } else if (cleanLoc === 'UK') {
        locationName = locale === 'hi' ? 'उत्तराखंड' : 'Uttarakhand';
        isUnmapped = false;
      } else {
        // Legacy quick buttons UP23, UP22, UP16, DL
        const res = resolveSinglePrefix(cleanLoc, prefixMap, locale);
        locationName = res.locationName;
        isUnmapped = res.isUnmapped;
      }
    }

    // 4. Aggregate
    if (!locationAggregates[locationName]) {
      locationAggregates[locationName] = {
        count: 0,
        prefixes: new Set<string>(),
        isUnmapped,
      };
    }

    locationAggregates[locationName].count += inc;
    locationAggregates[locationName].prefixes.add(rawKey);
  }

  // 5. Sort descending by count, ties broken alphabetically
  return Object.entries(locationAggregates)
    .map(([locationName, data]) => ({
      locationName,
      count: data.count,
      prefixes: Array.from(data.prefixes),
      isUnmapped: data.isUnmapped,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.locationName.localeCompare(b.locationName);
    });
}

export interface PendingUnmappedPrefix {
  prefix: string;
  count: number;
}

export const BIKE_LOCATION_ID = 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f';

/**
 * Extracts and aggregates unique unmapped vehicle prefixes from gate events.
 *
 * Rules:
 * - Excludes Bike events (both location_id = BIKE_LOCATION_ID and literal 'BIKE')
 * - Excludes null/empty prefixes
 * - Excludes literal 'OTHERS'
 * - Excludes prefixes that resolve to an active mapping in vehicle_registration_prefixes
 * - Aggregates occurrence counts per prefix
 * - Sorted by count descending, then prefix ascending (alphabetical)
 */
export function extractPendingUnmappedPrefixes(
  events: Array<{
    vehicle_prefix?: string | null;
    location_id?: string | null;
    location?: { id?: string; name?: string } | { id?: string; name?: string }[] | null;
  }>,
  prefixes: VehicleRegistrationPrefix[]
): PendingUnmappedPrefix[] {
  const activeSet = new Set<string>();
  for (const p of prefixes) {
    if (p.is_active !== false) {
      activeSet.add(p.prefix.trim().toUpperCase());
    }
  }

  const countMap = new Map<string, number>();

  for (const ev of events) {
    // Exclude Bikes by location_id
    if (ev.location_id === BIKE_LOCATION_ID) continue;
    if (ev.location) {
      if (Array.isArray(ev.location)) {
        if (ev.location.some((loc) => loc.id === BIKE_LOCATION_ID || loc.name?.toUpperCase() === 'BIKE')) {
          continue;
        }
      } else if (ev.location.id === BIKE_LOCATION_ID || ev.location.name?.toUpperCase() === 'BIKE') {
        continue;
      }
    }

    const raw = (ev.vehicle_prefix || '').trim().toUpperCase();
    if (!raw || raw === 'BIKE' || raw === 'OTHERS') continue;

    // Exclude if already mapped in active registration prefixes
    if (!activeSet.has(raw)) {
      countMap.set(raw, (countMap.get(raw) || 0) + 1);
    }
  }

  return Array.from(countMap.entries())
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.prefix.localeCompare(b.prefix);
    });
}
