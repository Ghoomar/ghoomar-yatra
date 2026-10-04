import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { lookupRtoPrefix } from '@/lib/gate/rto-directory';
import { suggestHindiName } from '@/lib/i18n/suggest-hindi';

/**
 * Server-side Admin authentication verifier
 */
async function verifyAdminCaller(request: Request) {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  const serverSupabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await serverSupabase.auth.getUser(bearerToken);

  if (authErr || !user) {
    return {
      authorized: false as const,
      status: 401,
      error: 'Authentication required. Please log in.',
    };
  }

  const { data: profile, error: profErr } = await serverSupabase
    .from('profiles')
    .select('*, role:roles(id, name)')
    .eq('id', user.id)
    .single();

  if (profErr || !profile || !profile.is_active) {
    return {
      authorized: false as const,
      status: 403,
      error: 'Access denied. Account is inactive or unverified.',
    };
  }

  const { data: permCheck } = await serverSupabase
    .from('role_permissions')
    .select('permissions(code)')
    .eq('role_id', profile.role_id);

  const hasAdminPerm =
    permCheck?.some((rp: any) => rp.permissions?.code === 'admin.manage') ||
    profile.role?.name === 'Admin';

  if (!hasAdminPerm) {
    return {
      authorized: false as const,
      status: 403,
      error: 'Access denied. System Administrator privilege required.',
    };
  }

  return { authorized: true as const, caller: profile, serverSupabase };
}

/**
 * Server-side OpenStreetMap Nominatim geocoding
 * Resolves canonical latitude and longitude for a given city and state.
 * Returns null if geocoding fails, times out, or returns ambiguous results.
 */
async function geocodeLocation(
  locationName: string,
  state: string
): Promise<{ latitude: number; longitude: number } | null> {
  if (!locationName || !state) return null;

  try {
    const query = `${locationName.trim()}, ${state.trim()}, India`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      {
        headers: {
          'User-Agent': 'GhoomarYatra-Admin/1.0',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    if (isNaN(lat) || isNaN(lon)) return null;

    // Round to 4 decimal places (standard high-precision geographic resolution ~11m)
    return {
      latitude: Math.round(lat * 10000) / 10000,
      longitude: Math.round(lon * 10000) / 10000,
    };
  } catch (err) {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = await verifyAdminCaller(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const rawPrefix = searchParams.get('prefix');
  const directLocation = searchParams.get('location');
  const directState = searchParams.get('state');

  // Case A: Direct Geocoding of explicit location + state
  if (directLocation && directState) {
    const coords = await geocodeLocation(directLocation, directState);
    const hindi = suggestHindiName(directLocation, 'location');
    return NextResponse.json({
      locationName: directLocation,
      nameHi: hindi.suggestion,
      state: directState,
      latitude: coords ? coords.latitude : null,
      longitude: coords ? coords.longitude : null,
      confidence: coords ? 'high' : 'partial',
    });
  }

  // Case B: Prefix Lookup & Suggestion
  if (!rawPrefix) {
    return NextResponse.json(
      { error: 'Prefix parameter is required.' },
      { status: 400 }
    );
  }

  const cleanPrefix = rawPrefix.trim().toUpperCase();
  const rtoMatch = lookupRtoPrefix(cleanPrefix);

  if (!rtoMatch) {
    return NextResponse.json({
      prefix: cleanPrefix,
      locationName: '',
      nameHi: '',
      district: '',
      state: '',
      latitude: null,
      longitude: null,
      isExactRto: false,
      confidence: 'none',
    });
  }

  // If only state was recognized (e.g. UP03) or prefix represents a whole state/territory with no resolved city
  const isStateOnly =
    !rtoMatch.isExactRto ||
    !rtoMatch.locationName ||
    rtoMatch.locationName.trim().toLowerCase() === rtoMatch.state.trim().toLowerCase() ||
    cleanPrefix.length <= 2;

  if (isStateOnly) {
    return NextResponse.json({
      prefix: cleanPrefix,
      locationName: cleanPrefix.length === 2 ? rtoMatch.locationName : '',
      nameHi:
        cleanPrefix.length === 2
          ? rtoMatch.nameHi || suggestHindiName(rtoMatch.locationName, 'location').suggestion
          : '',
      district: cleanPrefix.length === 2 ? rtoMatch.district : '',
      state: rtoMatch.state,
      latitude: null,
      longitude: null,
      isExactRto: cleanPrefix.length === 2,
      confidence: 'partial',
    });
  }

  // Canonical RTO match
  const nameHi =
    rtoMatch.nameHi ||
    suggestHindiName(rtoMatch.locationName, 'location').suggestion ||
    '';

  // Server-side geocoding
  const coords = await geocodeLocation(rtoMatch.locationName, rtoMatch.state);

  return NextResponse.json({
    prefix: cleanPrefix,
    locationName: rtoMatch.locationName,
    nameHi,
    district: rtoMatch.district,
    state: rtoMatch.state,
    latitude: coords ? coords.latitude : null,
    longitude: coords ? coords.longitude : null,
    isExactRto: true,
    confidence: 'high',
  });
}
