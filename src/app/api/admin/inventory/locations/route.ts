import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { suggestHindiName } from '@/lib/i18n/suggest-hindi';
import { isMandatoryInventoryLocation, isNonZeroStockBalance } from '@/lib/inventory/location-rules';

// Helper to authenticate caller and verify system admin permission
async function verifyAdminCaller(request: Request) {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

  let user: any = null;
  let serverSupabase: any = null;

  // Support test auth override for automated test suites in non-production
  const testUserId =
    process.env.NODE_ENV !== 'production' && process.env.ENABLE_TEST_AUTH_OVERRIDE === 'true'
      ? request.headers.get('x-test-user-id')
      : null;

  if (testUserId) {
    user = { id: testUserId };
    serverSupabase = createAdminClient();
  } else {
    try {
      serverSupabase = await createServerSupabaseClient();
      const { data: authData, error: authErr } = await serverSupabase.auth.getUser(bearerToken);
      if (!authErr && authData?.user) {
        user = authData.user;
      }
    } catch {
      // Fallback
    }

    if (!user && bearerToken) {
      try {
        const admin = createAdminClient();
        const { data: authData } = await admin.auth.getUser(bearerToken);
        if (authData?.user) {
          user = authData.user;
          serverSupabase = admin;
        }
      } catch {
        // Fallback
      }
    }
  }

  if (!user) {
    return { authorized: false, status: 401, error: 'Authentication required. Please log in.' };
  }

  const adminClient = createAdminClient();
  const { data: profile, error: profErr } = await adminClient
    .from('profiles')
    .select('*, role:roles(id, name)')
    .eq('id', user.id)
    .maybeSingle();

  if (profErr || !profile || !profile.is_active) {
    return { authorized: false, status: 403, error: 'Access denied. Account is inactive or unverified.' };
  }

  const { data: permCheck } = await adminClient
    .from('role_permissions')
    .select('permissions(code)')
    .eq('role_id', profile.role_id);

  const hasAdminPerm =
    permCheck?.some((rp: any) => rp.permissions?.code === 'admin.manage') ||
    profile.role?.name === 'Admin';

  if (!hasAdminPerm) {
    return { authorized: false, status: 403, error: 'Access denied. System Administrator privilege required.' };
  }

  return { authorized: true, caller: profile, adminClient };
}

/**
 * GET /api/admin/inventory/locations
 * Fetches all inventory locations joined with department metadata and stock summary.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAdminCaller(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const activeFilter = searchParams.get('active');

    const admin = auth.adminClient!;

    let locQuery = admin
      .from('inventory_locations')
      .select('*, department:departments(id, name, name_hi, code)')
      .order('code', { ascending: true });

    if (activeFilter === 'true') {
      locQuery = locQuery.eq('is_active', true);
    } else if (activeFilter === 'false') {
      locQuery = locQuery.eq('is_active', false);
    }

    const [
      { data: locations, error: locErr },
      { data: stockRows, error: stockErr },
      { data: smSource },
      { data: smDest },
      { data: ciSource },
      { data: paslLoc },
      { data: childLocs },
    ] = await Promise.all([
      locQuery,
      admin.from('item_location_stocks').select('location_id, quantity'),
      admin.from('stock_movements').select('source_location_id').not('source_location_id', 'is', null),
      admin.from('stock_movements').select('destination_location_id').not('destination_location_id', 'is', null),
      admin.from('consumption_issues').select('source_location_id').not('source_location_id', 'is', null),
      admin.from('physical_asset_status_ledger').select('location_id').not('location_id', 'is', null),
      admin.from('inventory_locations').select('parent_location_id').not('parent_location_id', 'is', null),
    ]);

    if (locErr) throw locErr;
    if (stockErr) throw stockErr;

    // Aggregate stock summary per location
    const stockSummary = new Map<string, { totalItems: number; positiveItems: number; nonZeroItems: number; totalQty: number }>();
    (stockRows || []).forEach((r: any) => {
      const curr = stockSummary.get(r.location_id) || { totalItems: 0, positiveItems: 0, nonZeroItems: 0, totalQty: 0 };
      curr.totalItems += 1;
      const q = Number(r.quantity) || 0;
      if (q > 0) {
        curr.positiveItems += 1;
      }
      if (isNonZeroStockBalance(q)) curr.nonZeroItems += 1;
      curr.totalQty += q;
      stockSummary.set(r.location_id, curr);
    });

    // Track locations with historical references
    const locationsWithHistory = new Set<string>();
    smSource?.forEach((r: any) => r.source_location_id && locationsWithHistory.add(r.source_location_id));
    smDest?.forEach((r: any) => r.destination_location_id && locationsWithHistory.add(r.destination_location_id));
    ciSource?.forEach((r: any) => r.source_location_id && locationsWithHistory.add(r.source_location_id));
    paslLoc?.forEach((r: any) => r.location_id && locationsWithHistory.add(r.location_id));
    childLocs?.forEach((r: any) => r.parent_location_id && locationsWithHistory.add(r.parent_location_id));

    const enriched = (locations || []).map((loc: any) => {
      const st = stockSummary.get(loc.id) || { totalItems: 0, positiveItems: 0, nonZeroItems: 0, totalQty: 0 };
      const hasHistory = locationsWithHistory.has(loc.id);
      const isSystemReserved = isMandatoryInventoryLocation(loc.code);
      return {
        ...loc,
        stock_summary: {
          total_items: st.totalItems,
          positive_items: st.positiveItems,
          non_zero_items: st.nonZeroItems,
          total_quantity: st.totalQty,
        },
        has_positive_stock: st.positiveItems > 0,
        has_non_zero_stock: st.nonZeroItems > 0,
        has_historical_records: hasHistory,
        is_system_reserved: isSystemReserved,
        can_delete: !isSystemReserved && st.nonZeroItems === 0 && !hasHistory,
      };
    });

    return NextResponse.json({ success: true, data: enriched, locations: enriched });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch inventory locations.' }, { status: 500 });
  }
}

/**
 * POST /api/admin/inventory/locations
 * Creates a new inventory location with unique code validation and Hindi translation support.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAdminCaller(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { code, name, name_hi, location_type, department_id, is_active, notes } = body;

    // Validate Location Code
    if (!code || typeof code !== 'string' || !code.trim()) {
      return NextResponse.json({ error: 'Location Code is required.' }, { status: 400 });
    }

    const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!cleanCode || !/^[A-Z0-9_-]+$/.test(cleanCode)) {
      return NextResponse.json(
        { error: 'Location Code must contain only uppercase letters, numbers, hyphens, or underscores.' },
        { status: 400 }
      );
    }

    // Validate Location Name
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Location Name is required.' }, { status: 400 });
    }
    const cleanName = name.trim();

    // Validate Location Type
    const VALID_TYPES = [
      'central_store',
      'kitchen_section',
      'service_bar',
      'dining_hall',
      'customer_fridge',
      'activity_area',
      'restroom',
      'stall_counter',
      'general_storage',
    ];

    if (!location_type || !VALID_TYPES.includes(location_type)) {
      return NextResponse.json(
        { error: `Invalid location type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const admin = auth.adminClient!;

    // Check duplicate code
    const { data: existingCode, error: existingCodeErr } = await admin
      .from('inventory_locations')
      .select('id, code')
      .eq('code', cleanCode)
      .maybeSingle();

    if (existingCodeErr) throw existingCodeErr;

    if (existingCode) {
      return NextResponse.json(
        { error: `A location with code '${cleanCode}' already exists.` },
        { status: 409 }
      );
    }

    // Resolve Hindi Name: use provided value or auto-suggest
    let finalNameHi = name_hi && typeof name_hi === 'string' && name_hi.trim() ? name_hi.trim() : null;
    if (!finalNameHi) {
      try {
        const suggestion = suggestHindiName(cleanName, 'location');
        finalNameHi = suggestion.suggestion || null;
      } catch {
        finalNameHi = null;
      }
    }

    // Verify department_id if supplied
    let cleanDeptId = department_id ? String(department_id).trim() : null;
    if (cleanDeptId) {
      const { data: dept } = await admin.from('departments').select('id').eq('id', cleanDeptId).maybeSingle();
      if (!dept) {
        return NextResponse.json({ error: 'Specified department does not exist.' }, { status: 400 });
      }
    }

    // Insert record
    const { data: inserted, error: insErr } = await admin
      .from('inventory_locations')
      .insert({
        code: cleanCode,
        name: cleanName,
        name_hi: finalNameHi,
        location_type,
        department_id: cleanDeptId,
        is_active: is_active !== false,
        notes: notes && typeof notes === 'string' ? notes.trim() : null,
      })
      .select('*, department:departments(id, name, name_hi, code)')
      .single();

    if (insErr) throw insErr;

    const enriched = {
      ...inserted,
      stock_summary: { total_items: 0, positive_items: 0, total_quantity: 0 },
      has_positive_stock: false,
      has_historical_records: false,
      is_system_reserved: isMandatoryInventoryLocation(inserted.code),
      can_delete: !isMandatoryInventoryLocation(inserted.code),
    };

    return NextResponse.json({ success: true, data: enriched, location: enriched }, { status: 201 });
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'A location with this code already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: err.message || 'Failed to create inventory location.' }, { status: 500 });
  }
}
