import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('item_id');
    const groupId = searchParams.get('group_id');

    const admin = createAdminClient();
    let query = admin
      .from('inventory_item_aliases')
      .select('*')
      .order('alias');

    if (itemId && groupId) {
      query = query.or(`item_id.eq.${itemId},group_id.eq.${groupId}`);
    } else if (itemId) {
      query = query.eq('item_id', itemId);
    } else if (groupId) {
      query = query.eq('group_id', groupId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ aliases: data || [] });
  } catch (err: any) {
    console.error('API GET /api/inventory/aliases error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { item_id, group_id, alias, alias_type, notes } = body;

    if (!alias || typeof alias !== 'string' || !alias.trim()) {
      return NextResponse.json({ error: 'Alias is required' }, { status: 400 });
    }

    if (!item_id && !group_id) {
      return NextResponse.json({ error: 'Either item_id or group_id must be provided' }, { status: 400 });
    }

    const cleanAlias = alias.trim();
    const normalizedAlias = cleanAlias
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\u0900-\u097F]+/g, ' ')
      .trim();

    // Check valid alias_type allowed by DB constraint
    const validTypes = ['hindi', 'transliteration', 'brand', 'colloquial', 'common'];
    const chosenType = validTypes.includes(alias_type) ? alias_type : 'colloquial';

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('inventory_item_aliases')
      .insert({
        item_id: item_id || null,
        group_id: group_id || null,
        alias: cleanAlias,
        normalized_alias: normalizedAlias,
        alias_type: chosenType,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Unique violation - already exists
        return NextResponse.json({ message: 'Alias already exists', duplicate: true }, { status: 200 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, alias: data });
  } catch (err: any) {
    console.error('API POST /api/inventory/aliases error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Alias ID is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('inventory_item_aliases')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Alias deleted successfully' });
  } catch (err: any) {
    console.error('API DELETE /api/inventory/aliases error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
