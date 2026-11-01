import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';

export async function GET(request: NextRequest) {
  try {
    const caller = await resolveCallerAuth(request);
    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const inventoryClass = searchParams.get('class') || 'Food Raw Material';

    const admin = createAdminClient();

    let query = admin
      .from('logical_ingredient_groups')
      .select(`
        id,
        group_code,
        name,
        name_hi,
        inventory_class,
        search_family,
        last_valid_wac,
        base_unit:units!logical_ingredient_groups_base_unit_id_fkey(id, symbol, symbol_hi, name, name_hi),
        variants:inventory_items(id, item_code, name, brand_name, is_costed, is_active)
      `)
      .order('name');

    if (inventoryClass && inventoryClass !== 'ALL') {
      query = query.eq('inventory_class', inventoryClass);
    }

    const [groupsRes, aliasesRes] = await Promise.all([
      query,
      admin.from('inventory_item_aliases').select('item_id, alias, alias_type'),
    ]);

    if (groupsRes.error) throw groupsRes.error;

    // Group aliases by item_id / group_id
    const aliasesMap: Record<string, string[]> = {};
    (aliasesRes.data || []).forEach((a: any) => {
      if (!aliasesMap[a.item_id]) aliasesMap[a.item_id] = [];
      aliasesMap[a.item_id].push(a.alias);
    });

    return NextResponse.json({
      groups: groupsRes.data || [],
      aliasesMap,
    });
  } catch (err: any) {
    console.error('API /api/inventory/groups error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
