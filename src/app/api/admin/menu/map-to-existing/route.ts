import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeItemName } from '@/lib/petpooja/matcher';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const body = await request.json();
    const { source_item_id, source_item_name, target_menu_item_id, force } = body;

    if (!source_item_name || !source_item_name.trim()) {
      return NextResponse.json({ error: 'Source Petpooja item name is required.' }, { status: 400 });
    }
    if (!target_menu_item_id) {
      return NextResponse.json({ error: 'Target canonical item is required.' }, { status: 400 });
    }

    const cleanAlias = source_item_name.trim();

    // 1. Verify target canonical item exists
    const { data: targetItem, error: targetErr } = await supabase
      .from('pos_menu_items')
      .select('id, name, parent_category, category, needs_setup')
      .eq('id', target_menu_item_id)
      .single();

    if (targetErr || !targetItem) {
      return NextResponse.json({ error: 'Selected target canonical item was not found.' }, { status: 404 });
    }

    if (targetItem.needs_setup || !targetItem.category || targetItem.category === 'Uncategorized') {
      return NextResponse.json(
        { error: 'Target item must be a configured canonical item (not an unconfigured item).' },
        { status: 400 }
      );
    }

    // 2. Check for alias conflict
    const { data: existingAlias } = await supabase
      .from('pos_menu_item_aliases')
      .select('id, alias, menu_item_id, pos_menu_items(id, name)')
      .ilike('alias', cleanAlias)
      .maybeSingle();

    if (existingAlias && existingAlias.menu_item_id !== target_menu_item_id && !force) {
      const currentTargetName = (existingAlias.pos_menu_items as any)?.name || 'another item';
      return NextResponse.json(
        {
          error: `Alias "${cleanAlias}" is already mapped to "${currentTargetName}". Please confirm if you want to reassign this alias.`,
          conflict: true,
          existingTarget: existingAlias.pos_menu_items,
        },
        { status: 409 }
      );
    }

    // 3. Upsert alias pointing to target canonical item
    const normalizedAlias = normalizeItemName(cleanAlias);
    if (existingAlias) {
      await supabase
        .from('pos_menu_item_aliases')
        .update({
          menu_item_id: target_menu_item_id,
          normalized_alias: normalizedAlias,
          notes: `Mapped to ${targetItem.name}`,
        })
        .eq('id', existingAlias.id);
    } else {
      await supabase
        .from('pos_menu_item_aliases')
        .insert({
          alias: cleanAlias,
          normalized_alias: normalizedAlias,
          menu_item_id: target_menu_item_id,
          notes: `Mapped to ${targetItem.name}`,
        });
    }

    // 4. Remove redundant Needs Setup item from pos_menu_items if one exists
    let duplicateId = source_item_id;
    if (!duplicateId) {
      const { data: dupItem } = await supabase
        .from('pos_menu_items')
        .select('id')
        .ilike('name', cleanAlias)
        .eq('needs_setup', true)
        .maybeSingle();
      if (dupItem) duplicateId = dupItem.id;
    }

    if (duplicateId && duplicateId !== target_menu_item_id) {
      // Re-point any aliases referencing the duplicate record
      await supabase
        .from('pos_menu_item_aliases')
        .update({ menu_item_id: target_menu_item_id })
        .eq('menu_item_id', duplicateId);

      // Delete the redundant record from pos_menu_items
      await supabase.from('pos_menu_items').delete().eq('id', duplicateId);
    }

    // 5. Reclassify historical sales in sales_hourly_items without modifying raw item_name
    await supabase
      .from('sales_hourly_items')
      .update({
        parent_category: targetItem.parent_category,
        category: targetItem.category,
      })
      .ilike('item_name', cleanAlias);

    return NextResponse.json({
      success: true,
      message: `Successfully mapped "${cleanAlias}" to "${targetItem.name}".`,
      canonicalItem: targetItem,
    });
  } catch (err: any) {
    console.error('Error in map-to-existing:', err);
    return NextResponse.json({ error: err.message || 'Internal mapping error' }, { status: 500 });
  }
}
