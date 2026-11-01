import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canViewCosting } from '@/lib/rbac';

export async function GET(request: NextRequest) {
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

    const hasCostAccess = canViewCosting(roleName, permissionCodes);

    // Fetch master inventory datasets using privileged admin client
    const admin = createAdminClient();

    const url = new URL(request.url);
    const includeMovements = url.searchParams.get('include_movements') === 'true';

    const [posRes, locRes, stockRes, aliasRes, movRes] = await Promise.all([
      admin.from('inventory_current_position').select('*').order('name'),
      admin.from('inventory_locations').select('*').eq('is_active', true).order('code'),
      admin.from('item_location_stocks').select('item_id, location_id, quantity, location:inventory_locations(id, name, name_hi, code)'),
      admin.from('inventory_item_aliases').select('item_id, alias, alias_type'),
      includeMovements
        ? admin
            .from('stock_movements')
            .select(`
              *,
              item:inventory_items(id, name, name_hi, item_code, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
              source_location:inventory_locations!stock_movements_source_location_id_fkey(id, name, name_hi, code),
              destination_location:inventory_locations!stock_movements_destination_location_id_fkey(id, name, name_hi, code)
            `)
            .order('business_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(100)
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (posRes.error) {
      throw posRes.error;
    }

    // Enforce server-side cost-data masking
    const sanitizedItems = (posRes.data || []).map((item: any) => {
      if (hasCostAccess) return item;
      return {
        ...item,
        wac_cost: null,
        current_stock_value: null,
        current_weighted_average_cost: null,
      };
    });

    const sanitizedMovements = (movRes.data || []).map((m: any) => {
      if (hasCostAccess) return m;
      return {
        ...m,
        unit_cost: null,
        total_value: null,
      };
    });

    return NextResponse.json({
      items: sanitizedItems,
      locations: locRes.data || [],
      locationStocks: stockRes.data || [],
      aliases: aliasRes.data || [],
      movements: sanitizedMovements,
      hasCostAccess,
    });
  } catch (err: any) {
    console.error('API /api/inventory error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
