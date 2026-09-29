import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  normalizeItemName,
  loadMenuMasterLookupFromDb,
  resolveItemCategory,
  reconcileNeedsSetupItems,
} from '@/lib/petpooja/matcher';
import { suggestHindiName } from '@/lib/i18n/suggest-hindi';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    // 1. Reconcile any existing Needs Setup items that already resolve to canonical items
    const { reconciledCount, reconciledItems } = await reconcileNeedsSetupItems(supabase);

    // 2. Load fresh authoritative database lookup
    const lookup = await loadMenuMasterLookupFromDb(supabase);

    // 3. Query distinct sales items from sales_hourly_items view
    const { data: salesDistinct, error: salesErr } = await supabase
      .from('distinct_sales_items')
      .select('item_name, unit_price, total_units_sold, total_net_sales');

    if (salesErr) throw salesErr;

    // Fetch existing menu items (to avoid re-inserting already pending items)
    const { data: existingRows, error: itemsErr } = await supabase
      .from('pos_menu_items')
      .select('name, normalized_name, needs_setup');
    if (itemsErr) throw itemsErr;

    const existingNames = new Set((existingRows || []).map((i) => i.name.toLowerCase().trim()));
    const existingNorms = new Set(
      (existingRows || []).map((i) => i.normalized_name || normalizeItemName(i.name))
    );

    const newlyDiscoveredItems: any[] = [];
    const autoResolvedSalesItems: string[] = [];

    for (const row of salesDistinct || []) {
      const rawName = (row.item_name || '').trim();
      if (!rawName) continue;

      // Authoritative Resolution: Exact -> Normalized -> Alias
      const res = resolveItemCategory(rawName, lookup);

      if (res.isMatched && res.category !== 'Uncategorized') {
        // MATCHED: The item already resolves to a canonical Menu Master item.
        // DO NOT create a new record in pos_menu_items!
        // DO NOT put it into Needs Setup!
        // Backfill sales_hourly_items if still uncategorized
        autoResolvedSalesItems.push(rawName);
        await supabase
          .from('sales_hourly_items')
          .update({
            parent_category: res.parentCategory,
            category: res.category,
          })
          .eq('parent_category', 'Uncategorized')
          .ilike('item_name', rawName);
      } else {
        // GENUINELY UNMATCHED: Has no canonical mapping
        const norm = normalizeItemName(rawName);
        if (!existingNames.has(rawName.toLowerCase()) && !existingNorms.has(norm)) {
          const suggestion = suggestHindiName(rawName, 'menu_item');
          newlyDiscoveredItems.push({
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
    }

    if (newlyDiscoveredItems.length > 0) {
      const { error: insertErr } = await supabase
        .from('pos_menu_items')
        .upsert(newlyDiscoveredItems, { onConflict: 'name', ignoreDuplicates: true });
      if (insertErr) throw insertErr;
    }

    return NextResponse.json({
      success: true,
      discoveredCount: newlyDiscoveredItems.length,
      reconciledCount,
      reconciledItems,
      autoResolvedCount: autoResolvedSalesItems.length,
      items: newlyDiscoveredItems.map((i) => ({
        name: i.name,
        name_hi: i.name_hi,
        price: i.price,
      })),
    });
  } catch (err: any) {
    console.error('Error running menu item discovery:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
