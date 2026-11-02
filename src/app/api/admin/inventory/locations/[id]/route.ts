import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function verifyAdminCaller(request: Request) {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

  let user: any = null;
  let serverSupabase: any = null;

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
 * GET /api/admin/inventory/locations/[id]
 * Supports standard fetch and dependency check inspection (?checkDependencies=true).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Location ID is required.' }, { status: 400 });
    }

    const auth = await verifyAdminCaller(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const admin = auth.adminClient!;
    const { searchParams } = new URL(request.url);
    const checkDependencies = searchParams.get('checkDependencies') === 'true';

    const { data: location, error: locErr } = await admin
      .from('inventory_locations')
      .select('*, department:departments(id, name, name_hi, code)')
      .eq('id', id)
      .maybeSingle();

    if (locErr || !location) {
      return NextResponse.json({ error: 'Inventory location not found.' }, { status: 404 });
    }

    if (!checkDependencies) {
      return NextResponse.json({ success: true, data: location });
    }

    // Inspect live dependencies for safeguard modal
    const isStore = location.code.toUpperCase() === 'STORE';

    const [
      { data: stockRows, error: stockErr },
      { count: smCount },
      { count: ciCount },
      { count: paslCount },
      { count: childCount },
    ] = await Promise.all([
      admin
        .from('item_location_stocks')
        .select('quantity, item:inventory_items(id, item_code, name, name_hi, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi))')
        .eq('location_id', id)
        .neq('quantity', 0),
      admin
        .from('stock_movements')
        .select('*', { count: 'exact', head: true })
        .or(`source_location_id.eq.${id},destination_location_id.eq.${id}`),
      admin
        .from('consumption_issues')
        .select('*', { count: 'exact', head: true })
        .eq('source_location_id', id),
      admin
        .from('physical_asset_status_ledger')
        .select('*', { count: 'exact', head: true })
        .eq('location_id', id),
      admin
        .from('inventory_locations')
        .select('*', { count: 'exact', head: true })
        .eq('parent_location_id', id),
    ]);

    if (stockErr) throw stockErr;

    const affectedItems = (stockRows || []).map((s: any) => ({
      itemId: s.item?.id,
      itemName: s.item?.name,
      itemNameHi: s.item?.name_hi || null,
      itemCode: s.item?.item_code,
      quantity: Number(s.quantity),
      unitSymbol: s.item?.unit?.symbol || 'units',
      unitSymbolHi: s.item?.unit?.symbol_hi || null,
    }));

    const totalReferences = (smCount || 0) + (ciCount || 0) + (paslCount || 0) + (childCount || 0);
    const hasPositiveStock = affectedItems.length > 0;
    const hasReferences = totalReferences > 0;
    const canDelete = !isStore && !hasPositiveStock && !hasReferences;

    return NextResponse.json({
      locationId: location.id,
      code: location.code,
      name: location.name,
      name_hi: location.name_hi,
      isStore,
      canDelete,
      currentStock: {
        hasPositiveStock,
        totalItemsWithStock: affectedItems.length,
        totalQuantity: affectedItems.reduce((acc: number, item: any) => acc + (item.quantity || 0), 0),
        items: affectedItems,
      },
      historicalReferences: {
        hasReferences,
        stockMovementsCount: smCount || 0,
        consumptionIssuesCount: ciCount || 0,
        assetLedgerCount: paslCount || 0,
        childLocationsCount: childCount || 0,
        totalReferences,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch location.' }, { status: 500 });
  }
}

/**
 * PUT /api/admin/inventory/locations/[id]
 * Updates location in place and toggles active status with STORE protection.
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Location ID is required.' }, { status: 400 });
    }

    const auth = await verifyAdminCaller(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const admin = auth.adminClient!;

    // Fetch existing record
    const { data: existing, error: findErr } = await admin
      .from('inventory_locations')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (findErr || !existing) {
      return NextResponse.json({ error: 'Inventory location not found.' }, { status: 404 });
    }

    const body = await request.json();
    const { code, name, name_hi, location_type, department_id, is_active, notes } = body;

    const isStore = existing.code.toUpperCase() === 'STORE';

    // System Invariant: STORE protections
    if (isStore) {
      if (code && code.trim().toUpperCase() !== 'STORE') {
        return NextResponse.json(
          { error: 'Cannot modify code of system reserved location STORE.' },
          { status: 400 }
        );
      }
      if (is_active === false) {
        return NextResponse.json(
          { error: 'System reserved location STORE cannot be deactivated.' },
          { status: 400 }
        );
      }
    }

    const updatePayload: Record<string, any> = {};

    // Validate and update Code if supplied for non-STORE locations
    if (code !== undefined && !isStore) {
      if (typeof code !== 'string' || !code.trim()) {
        return NextResponse.json({ error: 'Location Code cannot be empty.' }, { status: 400 });
      }
      const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (!cleanCode || !/^[A-Z0-9_-]+$/.test(cleanCode)) {
        return NextResponse.json(
          { error: 'Location Code must contain only uppercase letters, numbers, hyphens, or underscores.' },
          { status: 400 }
        );
      }

      // Check code uniqueness across other locations
      const { data: duplicate } = await admin
        .from('inventory_locations')
        .select('id')
        .ilike('code', cleanCode)
        .neq('id', id)
        .maybeSingle();

      if (duplicate) {
        return NextResponse.json(
          { error: `Another location with code '${cleanCode}' already exists.` },
          { status: 409 }
        );
      }
      updatePayload.code = cleanCode;
    }

    // Validate and update Name
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'Location Name cannot be empty.' }, { status: 400 });
      }
      updatePayload.name = name.trim();
    }

    // Update Hindi Name
    if (name_hi !== undefined) {
      updatePayload.name_hi = typeof name_hi === 'string' && name_hi.trim() ? name_hi.trim() : null;
    }

    // Validate Location Type
    if (location_type !== undefined) {
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
      if (!VALID_TYPES.includes(location_type)) {
        return NextResponse.json(
          { error: `Invalid location type. Must be one of: ${VALID_TYPES.join(', ')}` },
          { status: 400 }
        );
      }
      updatePayload.location_type = location_type;
    }

    // Update Department
    if (department_id !== undefined) {
      const cleanDeptId = department_id ? String(department_id).trim() : null;
      if (cleanDeptId) {
        const { data: dept } = await admin.from('departments').select('id').eq('id', cleanDeptId).maybeSingle();
        if (!dept) {
          return NextResponse.json({ error: 'Specified department does not exist.' }, { status: 400 });
        }
      }
      updatePayload.department_id = cleanDeptId;
    }

    // Update Active Status
    if (is_active !== undefined) {
      updatePayload.is_active = isStore ? true : Boolean(is_active);
    }

    // Update Notes
    if (notes !== undefined) {
      updatePayload.notes = typeof notes === 'string' && notes.trim() ? notes.trim() : null;
    }

    updatePayload.updated_at = new Date().toISOString();

    const { data: updated, error: updErr } = await admin
      .from('inventory_locations')
      .update(updatePayload)
      .eq('id', id)
      .select('*, department:departments(id, name, name_hi, code)')
      .single();

    if (updErr) throw updErr;

    return NextResponse.json({ success: true, data: updated, location: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update inventory location.' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/inventory/locations/[id]
 * Deletes an inventory location subject to mandatory deletion safeguards:
 *   - System Invariant: STORE cannot be deleted.
 *   - Rule 1: Non-zero stock blocks deletion with affected items breakdown.
 *   - Rule 2: Historical references block deletion and require deactivation.
 *   - Rule 3: Pristine zero-stock placeholder rows are safely deleted before location deletion.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Location ID is required.' }, { status: 400 });
    }

    const auth = await verifyAdminCaller(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const admin = auth.adminClient!;

    // 1. Fetch location to check existence and system reserved status
    const { data: location, error: findErr } = await admin
      .from('inventory_locations')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (findErr || !location) {
      return NextResponse.json({ error: 'Inventory location not found.' }, { status: 404 });
    }

    // 2. System Invariant: STORE cannot be deleted
    if (location.code.toUpperCase() === 'STORE') {
      return NextResponse.json(
        {
          error: 'The system reserved location Central Store (STORE) is permanently locked and cannot be deleted.',
          rule: 'RESERVED_STORE',
        },
        { status: 400 }
      );
    }

    // 3. Rule 1: Non-zero stock balance strictly blocks deletion
    const { data: stockItems, error: stockErr } = await admin
      .from('item_location_stocks')
      .select('quantity, item:inventory_items(id, item_code, name, name_hi, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi))')
      .eq('location_id', id)
      .neq('quantity', 0);

    if (stockErr) throw stockErr;

    if (stockItems && stockItems.length > 0) {
      const affectedItems = stockItems.map((s: any) => ({
        id: s.item?.id,
        item_code: s.item?.item_code,
        name: s.item?.name,
        name_hi: s.item?.name_hi || null,
        quantity: Number(s.quantity),
        unit: s.item?.unit?.symbol || 'units',
        unit_hi: s.item?.unit?.symbol_hi || null,
      }));

      return NextResponse.json(
        {
          error: `Cannot delete location: ${affectedItems.length} item(s) currently have non-zero stock balances in this location. All stock must be transferred or issued out first.`,
          rule: 'HAS_STOCK',
          items: affectedItems,
        },
        { status: 400 }
      );
    }

    // 4. Rule 2: Check historical records (Movements, Issues, Asset ledger, Child locations)
    const [
      { count: smCount },
      { count: ciCount },
      { count: paslCount },
      { count: childCount },
    ] = await Promise.all([
      admin
        .from('stock_movements')
        .select('*', { count: 'exact', head: true })
        .or(`source_location_id.eq.${id},destination_location_id.eq.${id}`),
      admin
        .from('consumption_issues')
        .select('*', { count: 'exact', head: true })
        .eq('source_location_id', id),
      admin
        .from('physical_asset_status_ledger')
        .select('*', { count: 'exact', head: true })
        .eq('location_id', id),
      admin
        .from('inventory_locations')
        .select('*', { count: 'exact', head: true })
        .eq('parent_location_id', id),
    ]);

    const totalHistory = (smCount || 0) + (ciCount || 0) + (paslCount || 0) + (childCount || 0);

    if (totalHistory > 0) {
      return NextResponse.json(
        {
          error: 'This location has historical transactions/audit records and cannot be permanently deleted. You can deactivate/archive it instead.',
          rule: 'HAS_HISTORY',
          history_counts: {
            stock_movements: smCount || 0,
            consumption_issues: ciCount || 0,
            asset_ledger: paslCount || 0,
            child_locations: childCount || 0,
          },
        },
        { status: 400 }
      );
    }

    // 5. Rule 3: Safe Deletion of Pristine Location
    // Clean up any zero-quantity placeholder rows in item_location_stocks to satisfy ON DELETE RESTRICT
    const { error: cleanErr } = await admin
      .from('item_location_stocks')
      .delete()
      .eq('location_id', id)
      .eq('quantity', 0);

    if (cleanErr) throw cleanErr;

    // Delete the location record
    const { error: delErr } = await admin
      .from('inventory_locations')
      .delete()
      .eq('id', id);

    if (delErr) throw delErr;

    return NextResponse.json({
      success: true,
      message: 'Location deleted successfully.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete inventory location.' },
      { status: 500 }
    );
  }
}
