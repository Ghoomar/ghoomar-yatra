import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';

export async function GET(request: NextRequest) {
  try {
    const caller = await resolveCallerAuth(request);
    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('yatra_ingredient_unit_conversions')
      .select(`
        *,
        ingredient_group:logical_ingredient_groups(id, name, name_hi, group_code, inventory_class),
        inventory_item:inventory_items(id, name, name_hi, item_code)
      `)
      .order('created_at', { ascending: false });

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

    if (!caller.canManageRecipes) {
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

    if (!from_unit || !to_unit || !conversion_factor) {
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

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('yatra_ingredient_unit_conversions')
      .upsert({
        ingredient_group_id: ingredient_group_id || null,
        inventory_item_id: inventory_item_id || null,
        from_unit: from_unit.trim(),
        to_unit: to_unit.trim(),
        multiplier: factor,
        verified_by: caller.user.id,
        verified_at: new Date().toISOString(),
        notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, conversion: data });
  } catch (err: any) {
    console.error('API POST /api/sops/conversions error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
