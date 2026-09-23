import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();

    const [
      { data: parents, error: pErr },
      { data: categories },
      { data: items },
    ] = await Promise.all([
      supabase.from('pos_parent_categories').select('*').order('display_order', { ascending: true }),
      supabase.from('pos_categories').select('id, parent_category_id'),
      supabase.from('pos_menu_items').select('id, parent_category'),
    ]);

    if (pErr) throw pErr;

    const catCountMap = new Map<string, number>();
    (categories || []).forEach((c) => {
      catCountMap.set(c.parent_category_id, (catCountMap.get(c.parent_category_id) || 0) + 1);
    });

    const itemCountMap = new Map<string, number>();
    (items || []).forEach((it) => {
      itemCountMap.set(it.parent_category, (itemCountMap.get(it.parent_category) || 0) + 1);
    });

    const enriched = (parents || []).map((p) => ({
      ...p,
      categoryCount: catCountMap.get(p.id) || 0,
      itemCount: itemCountMap.get(p.name) || 0,
    }));

    return NextResponse.json({ parents: enriched });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const body = await request.json();
    const { name, display_order, is_active } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Parent Category name is required.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('pos_parent_categories')
      .insert({
        name: name.trim(),
        display_order: Number(display_order) || 0,
        is_active: is_active !== false,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ parent: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const body = await request.json();
    const { id, name, display_order, is_active } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID is required.' }, { status: 400 });
    }

    // Check old parent name
    const { data: oldParent } = await supabase.from('pos_parent_categories').select('*').eq('id', id).single();
    if (!oldParent) {
      return NextResponse.json({ error: 'Parent Category not found.' }, { status: 404 });
    }

    const newName = name ? name.trim() : oldParent.name;

    const { data, error } = await supabase
      .from('pos_parent_categories')
      .update({
        name: newName,
        display_order: display_order !== undefined ? Number(display_order) : oldParent.display_order,
        is_active: is_active !== undefined ? Boolean(is_active) : oldParent.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // If name changed, synchronize pos_categories and pos_menu_items
    if (newName !== oldParent.name) {
      await supabase
        .from('pos_categories')
        .update({ parent_category_name: newName, updated_at: new Date().toISOString() })
        .eq('parent_category_id', id);

      await supabase
        .from('pos_menu_items')
        .update({ parent_category: newName, updated_at: new Date().toISOString() })
        .eq('parent_category', oldParent.name);
    }

    return NextResponse.json({ parent: data });
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

    // Check if child categories exist
    const { count } = await supabase
      .from('pos_categories')
      .select('*', { count: 'exact', head: true })
      .eq('parent_category_id', id);

    if (count && count > 0) {
      return NextResponse.json(
        { error: `Cannot delete parent category: ${count} subcategories still belong to it.` },
        { status: 400 }
      );
    }

    const { error } = await supabase.from('pos_parent_categories').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
