import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();

    const [
      { data: categories, error: cErr },
      { data: items },
    ] = await Promise.all([
      supabase.from('pos_categories').select('*').order('display_order', { ascending: true }),
      supabase.from('pos_menu_items').select('id, category, category_id'),
    ]);

    if (cErr) throw cErr;

    const countByCatId = new Map<string, number>();
    const countByCatName = new Map<string, number>();
    (items || []).forEach((it) => {
      if (it.category_id) {
        countByCatId.set(it.category_id, (countByCatId.get(it.category_id) || 0) + 1);
      }
      countByCatName.set(it.category, (countByCatName.get(it.category) || 0) + 1);
    });

    const enriched = (categories || []).map((c) => ({
      ...c,
      itemCount: countByCatId.get(c.id) || countByCatName.get(c.name) || 0,
    }));

    return NextResponse.json({ categories: enriched });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const body = await request.json();
    const { name, parent_category_id, display_order, is_active } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Category name is required.' }, { status: 400 });
    }
    if (!parent_category_id) {
      return NextResponse.json({ error: 'Parent Category is required.' }, { status: 400 });
    }

    const { data: parent } = await supabase
      .from('pos_parent_categories')
      .select('name')
      .eq('id', parent_category_id)
      .single();

    if (!parent) {
      return NextResponse.json({ error: 'Selected Parent Category does not exist.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('pos_categories')
      .insert({
        name: name.trim(),
        parent_category_id,
        parent_category_name: parent.name,
        display_order: Number(display_order) || 0,
        is_active: is_active !== false,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ category: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const body = await request.json();
    const { id, name, parent_category_id, display_order, is_active } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID is required.' }, { status: 400 });
    }

    const { data: oldCat } = await supabase.from('pos_categories').select('*').eq('id', id).single();
    if (!oldCat) {
      return NextResponse.json({ error: 'Category not found.' }, { status: 404 });
    }

    let parentName = oldCat.parent_category_name;
    let newParentId = oldCat.parent_category_id;

    if (parent_category_id && parent_category_id !== oldCat.parent_category_id) {
      const { data: parent } = await supabase
        .from('pos_parent_categories')
        .select('name')
        .eq('id', parent_category_id)
        .single();
      if (!parent) {
        return NextResponse.json({ error: 'Parent Category does not exist.' }, { status: 400 });
      }
      parentName = parent.name;
      newParentId = parent_category_id;
    }

    const newName = name ? name.trim() : oldCat.name;

    const { data, error } = await supabase
      .from('pos_categories')
      .update({
        name: newName,
        parent_category_id: newParentId,
        parent_category_name: parentName,
        display_order: display_order !== undefined ? Number(display_order) : oldCat.display_order,
        is_active: is_active !== undefined ? Boolean(is_active) : oldCat.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Synchronize pos_menu_items if category name or parent changed
    await supabase
      .from('pos_menu_items')
      .update({
        category: newName,
        parent_category: parentName,
        updated_at: new Date().toISOString(),
      })
      .or(`category_id.eq.${id},category.eq.${oldCat.name}`);

    return NextResponse.json({ category: data });
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

    const { data: cat } = await supabase.from('pos_categories').select('name').eq('id', id).single();
    if (!cat) {
      return NextResponse.json({ error: 'Category not found.' }, { status: 404 });
    }

    // Check if items belong to this category
    const { count } = await supabase
      .from('pos_menu_items')
      .select('*', { count: 'exact', head: true })
      .or(`category_id.eq.${id},category.eq.${cat.name}`);

    if (count && count > 0) {
      return NextResponse.json(
        { error: `Cannot delete category: ${count} menu items still belong to it.` },
        { status: 400 }
      );
    }

    const { error } = await supabase.from('pos_categories').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
