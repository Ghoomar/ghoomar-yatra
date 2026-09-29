import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  normalizeItemName,
  loadMenuMasterLookupFromDb,
  resolveItemCategory,
  reconcileNeedsSetupItems,
} from '@/lib/petpooja/matcher';
import { suggestHindiName } from '@/lib/i18n/suggest-hindi';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    // 0. Auto-reconcile and discover uncatalogued items using authoritative matcher
    try {
      await reconcileNeedsSetupItems(supabase);
      const lookup = await loadMenuMasterLookupFromDb(supabase);

      const { data: salesDistinct } = await supabase
        .from('distinct_sales_items')
        .select('item_name, unit_price');

      if (salesDistinct && salesDistinct.length > 0) {
        const { data: existingRows } = await supabase.from('pos_menu_items').select('name, normalized_name');
        const existingNames = new Set((existingRows || []).map((i) => i.name.toLowerCase().trim()));
        const existingNorms = new Set(
          (existingRows || []).map((i) => i.normalized_name || normalizeItemName(i.name))
        );

        const toInsert: any[] = [];
        for (const row of salesDistinct) {
          const rawName = (row.item_name || '').trim();
          if (!rawName) continue;

          // Check if resolved by authoritative matcher (Exact -> Normalized -> Alias)
          const res = resolveItemCategory(rawName, lookup);
          if (res.isMatched && res.category !== 'Uncategorized') {
            // Already resolved to canonical item: DO NOT put into Needs Setup
            continue;
          }

          // Unmatched: only insert if not already present
          const norm = normalizeItemName(rawName);
          if (!existingNames.has(rawName.toLowerCase()) && !existingNorms.has(norm)) {
            const suggestion = suggestHindiName(rawName, 'menu_item');
            toInsert.push({
              name: rawName,
              normalized_name: norm,
              price: Number(row.unit_price) || 0,
              category: 'Uncategorized',
              parent_category: 'Uncategorized',
              is_active: true,
              needs_setup: true,
              name_hi: suggestion.suggestion || null,
              name_hi_is_custom: false,
              online_name: rawName,
              category_online_display: 'Uncategorized',
              gst_percent: 5.0,
              tax_type: 'Forward Tax',
            });
            existingNames.add(rawName.toLowerCase());
            existingNorms.add(norm);
          }
        }

        if (toInsert.length > 0) {
          await supabase.from('pos_menu_items').upsert(toInsert, { onConflict: 'name', ignoreDuplicates: true });
        }
      }
    } catch (discErr) {
      console.warn('Auto-discovery pass non-critical warning:', discErr);
    }

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

    // Parent & Category maps for enriching allItems
    const parentMap = new Map((parents || []).map((p) => [p.id, p]));
    const catMap = new Map((categories || []).map((c) => [c.id, c]));

    const allItemsEnriched = (items || []).map((it) => {
      const cat = it.category_id ? catMap.get(it.category_id) : (categories || []).find((c) => c.name === it.category);
      const parent = cat?.parent_category_id ? parentMap.get(cat.parent_category_id) : (parents || []).find((p) => p.name === it.parent_category);

      return {
        ...it,
        category_name: it.category || cat?.name || 'Uncategorized',
        category_name_hi: cat?.name_hi || null,
        parent_category: it.parent_category || parent?.name || 'Uncategorized',
        parent_category_name: it.parent_category || parent?.name || 'Uncategorized',
        parent_category_name_hi: parent?.name_hi || null,
        aliases: aliasByItemId.get(it.id) || [],
      };
    });

    const needsSetupCount = (items || []).filter((i) => i.needs_setup || i.category === 'Uncategorized' || !i.category).length;

    return NextResponse.json({
      hierarchy,
      allItems: allItemsEnriched,
      stats: {
        totalParents: (parents || []).length,
        totalCategories: (categories || []).length,
        totalItems: (items || []).length,
        activeItems: (items || []).filter((i) => i.is_active).length,
        totalAliases: (aliases || []).length,
        needsSetupCount,
      },
    });
  } catch (err: any) {
    console.error('Error fetching menu hierarchy:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
