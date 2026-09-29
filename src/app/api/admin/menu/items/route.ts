import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeItemName } from '@/lib/petpooja/matcher';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const parent = searchParams.get('parent') || '';
    const category = searchParams.get('category') || '';
    const active = searchParams.get('active');

    let query = supabase.from('pos_menu_items').select('*').order('name', { ascending: true });

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }
    if (parent) {
      query = query.eq('parent_category', parent);
    }
    if (category) {
      query = query.eq('category', category);
    }
    if (active === 'true') {
      query = query.eq('is_active', true);
    } else if (active === 'false') {
      query = query.eq('is_active', false);
    }

    const { data: items, error } = await query;
    if (error) throw error;

    // Fetch aliases for these items
    const itemIds = (items || []).map((i) => i.id);
    let aliasesByItemId = new Map<string, string[]>();

    if (itemIds.length > 0) {
      const { data: aliases } = await supabase
        .from('pos_menu_item_aliases')
        .select('alias, menu_item_id')
        .in('menu_item_id', itemIds);

      (aliases || []).forEach((a) => {
        const list = aliasesByItemId.get(a.menu_item_id) || [];
        list.push(a.alias);
        aliasesByItemId.set(a.menu_item_id, list);
      });
    }

    const enriched = (items || []).map((it) => ({
      ...it,
      aliases: aliasesByItemId.get(it.id) || [],
    }));

    return NextResponse.json({ items: enriched });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const body = await request.json();
    const { name, name_hi, name_hi_is_custom, category_id, price, is_active, aliases } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Item name is required.' }, { status: 400 });
    }
    if (!category_id) {
      return NextResponse.json({ error: 'Category is required.' }, { status: 400 });
    }

    const { data: cat } = await supabase
      .from('pos_categories')
      .select('name, parent_category_name')
      .eq('id', category_id)
      .single();

    if (!cat) {
      return NextResponse.json({ error: 'Selected Category does not exist.' }, { status: 400 });
    }

    const cleanName = name.trim();
    const normalized = normalizeItemName(cleanName);
    const finalNameHi = name_hi && name_hi.trim() ? name_hi.trim() : null;

    // Duplicate creation protection: check exact name and normalized name against existing canonical items
    const { data: existingExact } = await supabase
      .from('pos_menu_items')
      .select('id, name, parent_category, category, needs_setup')
      .ilike('name', cleanName)
      .maybeSingle();

    if (existingExact && !existingExact.needs_setup && existingExact.category !== 'Uncategorized') {
      return NextResponse.json(
        {
          error: `An item with this name already exists ("${existingExact.name}").`,
          conflict: true,
          existingItem: existingExact,
        },
        { status: 409 }
      );
    }

    const { data: existingNorm } = await supabase
      .from('pos_menu_items')
      .select('id, name, parent_category, category, needs_setup')
      .eq('normalized_name', normalized)
      .maybeSingle();

    if (existingNorm && !existingNorm.needs_setup && existingNorm.category !== 'Uncategorized') {
      return NextResponse.json(
        {
          error: `An item with this name already exists ("${existingNorm.name}").`,
          conflict: true,
          existingItem: existingNorm,
        },
        { status: 409 }
      );
    }

    // Business rule: GST = 5%, Tax Type = Forward Tax
    const { data: item, error } = await supabase
      .from('pos_menu_items')
      .insert({
        name: cleanName,
        name_hi: finalNameHi,
        name_hi_is_custom: Boolean(name_hi_is_custom),
        needs_setup: false,
        normalized_name: normalized,
        category: cat.name,
        category_id,
        parent_category: cat.parent_category_name,
        price: Number(price) || 0,
        gst_percent: 5.0,
        tax_type: 'Forward Tax',
        is_active: is_active !== false,
        online_name: cleanName,
        category_online_display: cat.name,
      })
      .select()
      .single();

    if (error) throw error;

    // Handle POS Aliases if provided
    if (Array.isArray(aliases) && aliases.length > 0) {
      for (const al of aliases) {
        if (typeof al === 'string' && al.trim()) {
          await supabase.from('pos_menu_item_aliases').upsert(
            {
              alias: al.trim(),
              normalized_alias: normalizeItemName(al.trim()),
              menu_item_id: item.id,
              notes: 'Added from Item Master UI',
            },
            { onConflict: 'alias' }
          );
        }
      }
    }

    return NextResponse.json({ item });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const body = await request.json();
    const { id, name, name_hi, name_hi_is_custom, category_id, price, is_active, aliases } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID is required.' }, { status: 400 });
    }

    const { data: oldItem } = await supabase.from('pos_menu_items').select('*').eq('id', id).single();
    if (!oldItem) {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
    }

    let catName = oldItem.category;
    let parentName = oldItem.parent_category;
    let finalCatId = oldItem.category_id;

    if (category_id && category_id !== oldItem.category_id) {
      const { data: cat } = await supabase
        .from('pos_categories')
        .select('name, parent_category_name')
        .eq('id', category_id)
        .single();
      if (!cat) {
        return NextResponse.json({ error: 'Selected Category does not exist.' }, { status: 400 });
      }
      catName = cat.name;
      parentName = cat.parent_category_name;
      finalCatId = category_id;
    }

    const finalName = name ? name.trim() : oldItem.name;
    const normalized = normalizeItemName(finalName);

    // If name is being changed, verify it does not collide with an existing canonical item
    if (finalName.toLowerCase() !== oldItem.name.toLowerCase()) {
      const { data: duplicateExact } = await supabase
        .from('pos_menu_items')
        .select('id, name, parent_category, category, needs_setup')
        .ilike('name', finalName)
        .neq('id', id)
        .maybeSingle();

      if (duplicateExact && !duplicateExact.needs_setup && duplicateExact.category !== 'Uncategorized') {
        return NextResponse.json(
          {
            error: `An item named "${duplicateExact.name}" already exists in the Menu Master.`,
            conflict: true,
            canMapToExisting: true,
            existingItem: duplicateExact,
          },
          { status: 409 }
        );
      }

      const { data: duplicateNorm } = await supabase
        .from('pos_menu_items')
        .select('id, name, parent_category, category, needs_setup')
        .eq('normalized_name', normalized)
        .neq('id', id)
        .maybeSingle();

      if (duplicateNorm && !duplicateNorm.needs_setup && duplicateNorm.category !== 'Uncategorized') {
        return NextResponse.json(
          {
            error: `An item named "${duplicateNorm.name}" already exists in the Menu Master.`,
            conflict: true,
            canMapToExisting: true,
            existingItem: duplicateNorm,
          },
          { status: 409 }
        );
      }
    }

    const finalNameHi = name_hi !== undefined ? (name_hi && name_hi.trim() ? name_hi.trim() : null) : oldItem.name_hi;

    const updatePayload: Record<string, any> = {
      name: finalName,
      name_hi: finalNameHi,
      name_hi_is_custom: name_hi_is_custom !== undefined ? Boolean(name_hi_is_custom) : oldItem.name_hi_is_custom,
      needs_setup: false,
      normalized_name: normalized,
      category: catName,
      category_id: finalCatId,
      parent_category: parentName,
      updated_at: new Date().toISOString(),
    };

    if (price !== undefined) {
      updatePayload.price = Number(price);
    }
    if (is_active !== undefined) {
      updatePayload.is_active = Boolean(is_active);
    }

    // Preserve GST = 5%, Tax Type = Forward Tax (do not overwrite)
    if (!oldItem.gst_percent) updatePayload.gst_percent = 5.0;
    if (!oldItem.tax_type) updatePayload.tax_type = 'Forward Tax';

    const { data: item, error } = await supabase
      .from('pos_menu_items')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // If item was previously uncategorized or had needs_setup, or categories changed, sync historical sales rows
    if (catName && catName !== 'Uncategorized' && (oldItem.category !== catName || oldItem.parent_category !== parentName || oldItem.needs_setup)) {
      await supabase
        .from('sales_hourly_items')
        .update({
          category: catName,
          parent_category: parentName,
        })
        .ilike('item_name', oldItem.name.trim());
    }

    // Synchronize aliases if provided
    if (Array.isArray(aliases)) {
      // Remove old aliases for this item
      await supabase.from('pos_menu_item_aliases').delete().eq('menu_item_id', id);

      // Insert new aliases
      for (const al of aliases) {
        if (typeof al === 'string' && al.trim()) {
          await supabase.from('pos_menu_item_aliases').upsert(
            {
              alias: al.trim(),
              normalized_alias: normalizeItemName(al.trim()),
              menu_item_id: id,
              notes: 'Updated from Item Master UI',
            },
            { onConflict: 'alias' }
          );
        }
      }
    }

    return NextResponse.json({ item });
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

    // Instead of hard-deleting, deactivate or delete if unused in sales
    const { error } = await supabase.from('pos_menu_items').update({ is_active: false }).eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Item deactivated successfully.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
