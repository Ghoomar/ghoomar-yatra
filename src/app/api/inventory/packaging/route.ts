import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

    let user: any = null;
    let serverSupabase: any = null;

    const testUserId = (process.env.NODE_ENV !== 'production' && process.env.ENABLE_TEST_AUTH_OVERRIDE === 'true')
      ? request.headers.get('x-test-user-id')
      : null;
    if (testUserId) {
      user = { id: testUserId };
      serverSupabase = createAdminClient();
    } else {
      try {
        serverSupabase = await createServerSupabaseClient();
        const { data: authData, error: authErr } = await serverSupabase.auth.getUser(bearerToken);
        if (!authErr) user = authData?.user;
      } catch {
        const admin = createAdminClient();
        if (bearerToken) {
          const { data: authData } = await admin.auth.getUser(bearerToken);
          user = authData?.user;
        }
        serverSupabase = admin;
      }
    }

    // Role and permission resolution
    let roleName: string | null = null;
    let permissionCodes: string[] = [];

    if (user) {
      const { data: profile } = await serverSupabase
        .from('profiles')
        .select('*, role:roles(id, name)')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) {
        roleName = profile.role?.name || null;
        const { data: rolePerms } = await serverSupabase
          .from('role_permissions')
          .select('permissions(code)')
          .eq('role_id', profile.role_id);

        permissionCodes = (rolePerms || [])
          .map((rp: any) => rp.permissions?.code)
          .filter(Boolean);
      }
    }

    // Authorization check: finance.purchases, inventory.stock, admin.manage, or authorized roles
    const isAuthorizedRole = ['Admin', 'Owner', 'General Manager', 'Accountant', 'Storekeeper'].includes(roleName || '');
    const hasAuthorizedPerm = permissionCodes.some((code) =>
      ['finance.purchases', 'inventory.stock', 'admin.manage'].includes(code)
    );

    if (!isAuthorizedRole && !hasAuthorizedPerm) {
      return NextResponse.json(
        { error: 'Forbidden: Insufficient permissions to manage packaging definitions' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { inventory_item_id, brand_name, pack_unit_name, pack_size_in_base_units, pack_unit_id, vendor_id, is_default } = body;

    if (!inventory_item_id || !brand_name?.trim() || !pack_unit_name?.trim()) {
      return NextResponse.json(
        { error: 'Missing required packaging fields: inventory_item_id, brand_name, pack_unit_name' },
        { status: 400 }
      );
    }

    const packSize = Number(pack_size_in_base_units);
    if (isNaN(packSize) || packSize <= 0) {
      return NextResponse.json(
        { error: 'pack_size_in_base_units must be a positive number' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('item_packaging_units')
      .insert({
        inventory_item_id,
        brand_name: brand_name.trim(),
        pack_unit_name: pack_unit_name.trim(),
        pack_size_in_base_units: packSize,
        pack_unit_id: pack_unit_id || null,
        vendor_id: vendor_id || null,
        is_default: Boolean(is_default),
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting packaging unit:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, packaging: data }, { status: 201 });
  } catch (err: any) {
    console.error('API /api/inventory/packaging error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
