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

export async function POST(request: NextRequest) {
  try {
    const caller = await resolveCallerAuth(request);
    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!caller.canManageRecipes) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const { name, name_hi, base_unit_symbol, inventory_class } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Raw material name is required' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Resolve base unit
    const unitSymbol = base_unit_symbol?.trim() || 'g';
    const { data: unitData } = await admin
      .from('units')
      .select('id, symbol, symbol_hi, name, name_hi')
      .eq('symbol', unitSymbol)
      .maybeSingle();

    let baseUnitId = unitData?.id;
    if (!baseUnitId) {
      const { data: fallbackUnit } = await admin
        .from('units')
        .select('id, symbol, symbol_hi, name, name_hi')
        .eq('symbol', 'g')
        .single();
      baseUnitId = fallbackUnit?.id;
    }

    const cleanName = name.trim();
    const codeSuffix = Math.floor(1000 + Math.random() * 9000);
    const groupCode = `GRP-FOOD-${codeSuffix}`;

    const { data: group, error: insertErr } = await admin
      .from('logical_ingredient_groups')
      .insert({
        group_code: groupCode,
        name: cleanName,
        name_hi: name_hi?.trim() || null,
        inventory_class: inventory_class || 'Food Raw Material',
        base_unit_id: baseUnitId,
        is_active: true,
      })
      .select(`
        id,
        group_code,
        name,
        name_hi,
        inventory_class,
        search_family,
        last_valid_wac,
        base_unit:units!logical_ingredient_groups_base_unit_id_fkey(id, symbol, symbol_hi, name, name_hi)
      `)
      .single();

    if (insertErr) throw insertErr;

    return NextResponse.json({ success: true, group }, { status: 201 });
  } catch (err: any) {
    console.error('API POST /api/inventory/groups error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
