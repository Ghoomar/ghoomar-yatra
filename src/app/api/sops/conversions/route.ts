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
    const itemId = searchParams.get('item_id') || searchParams.get('inventory_item_id');
    const groupId = searchParams.get('group_id') || searchParams.get('ingredient_group_id');

    const admin = createAdminClient();
    let query = admin
      .from('yatra_ingredient_unit_conversions')
      .select(`
        *,
        ingredient_group:logical_ingredient_groups(id, name, name_hi, group_code, inventory_class),
        inventory_item:inventory_items(id, name, name_hi, item_code)
      `)
      .order('created_at', { ascending: false });

    if (itemId && groupId) {
      query = query.or(`inventory_item_id.eq.${itemId},ingredient_group_id.eq.${groupId}`);
    } else if (itemId) {
      query = query.eq('inventory_item_id', itemId);
    } else if (groupId) {
      query = query.eq('ingredient_group_id', groupId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ conversions: data || [] });
  } catch (err: any) {
    console.error('API GET /api/sops/conversions error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const caller = await resolveCallerAuth(request);
    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManage =
      caller.canManageRecipes ||
      caller.permissionCodes.includes('inventory.stock') ||
      caller.permissionCodes.includes('inventory.stock.manage') ||
      ['admin', 'Super Admin', 'Developer', 'Store Manager', 'General Manager'].includes(caller.roleName || '');

    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const {
      ingredient_group_id,
      inventory_item_id,
      from_unit,
      to_unit,
      conversion_factor,
      notes,
    } = body;

    if (!from_unit || !to_unit || (!conversion_factor && !body.multiplier)) {
      return NextResponse.json(
        { error: 'from_unit, to_unit, and conversion_factor are required' },
        { status: 400 }
      );
    }

    const factor = Number(conversion_factor || body.multiplier);
    if (isNaN(factor) || factor <= 0) {
      return NextResponse.json({ error: 'conversion_factor or multiplier must be positive' }, { status: 400 });
    }

    if (!ingredient_group_id && !inventory_item_id) {
      return NextResponse.json(
        { error: 'Either ingredient_group_id or inventory_item_id must be provided' },
        { status: 400 }
      );
    }

    // Respect chk_conversion_target_xor (exactly one target can be set)
    const targetItem = inventory_item_id ? inventory_item_id : null;
    const targetGroup = targetItem ? null : (ingredient_group_id || null);

    const admin = createAdminClient();

    // Check if an existing row matches this target and units
    let existingQuery = admin
      .from('yatra_ingredient_unit_conversions')
      .select('id')
      .eq('from_unit', from_unit.trim().toLowerCase())
      .eq('to_unit', to_unit.trim().toLowerCase());

    if (targetItem) {
      existingQuery = existingQuery.eq('inventory_item_id', targetItem);
    } else {
      existingQuery = existingQuery.eq('ingredient_group_id', targetGroup);
    }

    const { data: existingRows } = await existingQuery;

    let result;
    if (existingRows && existingRows.length > 0) {
      const { data, error } = await admin
        .from('yatra_ingredient_unit_conversions')
        .update({
          multiplier: factor,
          verified_by: caller.user.id,
          verified_at: new Date().toISOString(),
          is_verified: true,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRows[0].id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await admin
        .from('yatra_ingredient_unit_conversions')
        .insert({
          ingredient_group_id: targetGroup,
          inventory_item_id: targetItem,
          from_unit: from_unit.trim().toLowerCase(),
          to_unit: to_unit.trim().toLowerCase(),
          multiplier: factor,
          verified_by: caller.user.id,
          verified_at: new Date().toISOString(),
          is_verified: true,
          notes: notes || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    return NextResponse.json({ success: true, conversion: result });
  } catch (err: any) {
    console.error('API POST /api/sops/conversions error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const caller = await resolveCallerAuth(request);
    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManage =
      caller.canManageRecipes ||
      caller.permissionCodes.includes('inventory.stock') ||
      caller.permissionCodes.includes('inventory.stock.manage') ||
      ['admin', 'Super Admin', 'Developer', 'Store Manager', 'General Manager'].includes(caller.roleName || '');

    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Conversion ID is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('yatra_ingredient_unit_conversions')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Conversion deleted successfully' });
  } catch (err: any) {
    console.error('API DELETE /api/sops/conversions error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
