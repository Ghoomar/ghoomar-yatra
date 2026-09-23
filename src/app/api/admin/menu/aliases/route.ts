import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeItemName } from '@/lib/petpooja/matcher';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: aliases, error } = await supabase
      .from('pos_menu_item_aliases')
      .select('id, alias, normalized_alias, menu_item_id, notes, created_at, pos_menu_items(id, name, category, parent_category, price)')
      .order('alias', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ aliases: aliases || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const body = await request.json();
    const { alias, menu_item_id, notes } = body;

    if (!alias || !alias.trim()) {
      return NextResponse.json({ error: 'Alias is required.' }, { status: 400 });
    }
    if (!menu_item_id) {
      return NextResponse.json({ error: 'Canonical Menu Item is required.' }, { status: 400 });
    }

    const cleanAlias = alias.trim();
    const normalized = normalizeItemName(cleanAlias);

    const { data, error } = await supabase
      .from('pos_menu_item_aliases')
      .upsert(
        {
          alias: cleanAlias,
          normalized_alias: normalized,
          menu_item_id,
          notes: notes || null,
        },
        { onConflict: 'alias' }
      )
      .select('id, alias, normalized_alias, menu_item_id, notes, created_at, pos_menu_items(id, name, category, parent_category, price)')
      .single();

    if (error) throw error;
    return NextResponse.json({ alias: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required.' }, { status: 400 });
    }

    const { error } = await supabase.from('pos_menu_item_aliases').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
