import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    const [
      { data: parents, error: pErr },
      { data: categories, error: cErr },
      { data: items, error: iErr },
      { data: aliases, error: aErr },
    ] = await Promise.all([
      supabase.from('pos_parent_categories').select('*').order('display_order', { ascending: true }),
      supabase.from('pos_categories').select('*').order('display_order', { ascending: true }),
      supabase.from('pos_menu_items').select('*').order('name', { ascending: true }),
      supabase.from('pos_menu_item_aliases').select('*'),
    ]);

    if (pErr) throw pErr;
    if (cErr) throw cErr;
    if (iErr) throw iErr;

    // Group aliases by menu_item_id
    const aliasByItemId = new Map<string, string[]>();
    (aliases || []).forEach((a) => {
      const list = aliasByItemId.get(a.menu_item_id) || [];
      list.push(a.alias);
      aliasByItemId.set(a.menu_item_id, list);
    });

    // Group items by category_id (or category name fallback)
    const itemsByCatId = new Map<string, any[]>();
    const itemsByCatName = new Map<string, any[]>();
    (items || []).forEach((it) => {
      const itemWithAliases = {
        ...it,
        aliases: aliasByItemId.get(it.id) || [],
      };
      if (it.category_id) {
        const list = itemsByCatId.get(it.category_id) || [];
        list.push(itemWithAliases);
        itemsByCatId.set(it.category_id, list);
      }
      const nameList = itemsByCatName.get(it.category) || [];
      nameList.push(itemWithAliases);
      itemsByCatName.set(it.category, nameList);
    });

    // Group categories by parent_category_id
    const catsByParentId = new Map<string, any[]>();
    (categories || []).forEach((cat) => {
      const catItems = itemsByCatId.get(cat.id) || itemsByCatName.get(cat.name) || [];
      const catObj = {
        ...cat,
        itemCount: catItems.length,
        items: catItems,
      };
      const list = catsByParentId.get(cat.parent_category_id) || [];
      list.push(catObj);
      catsByParentId.set(cat.parent_category_id, list);
    });

    // Build final hierarchy tree
    const hierarchy = (parents || []).map((parent) => {
      const parentCats = catsByParentId.get(parent.id) || [];
      const totalItems = parentCats.reduce((sum, c) => sum + c.itemCount, 0);
      return {
        ...parent,
        categoryCount: parentCats.length,
        itemCount: totalItems,
        categories: parentCats,
      };
    });

    return NextResponse.json({
      hierarchy,
      stats: {
        totalParents: (parents || []).length,
        totalCategories: (categories || []).length,
        totalItems: (items || []).length,
        activeItems: (items || []).filter((i) => i.is_active).length,
        totalAliases: (aliases || []).length,
      },
    });
  } catch (err: any) {
    console.error('Error fetching menu hierarchy:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
