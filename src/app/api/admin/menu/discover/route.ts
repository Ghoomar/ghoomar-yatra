import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeItemName } from '@/lib/petpooja/matcher';
import { suggestHindiName } from '@/lib/i18n/suggest-hindi';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    // Query distinct sales items from sales_hourly_items view
    const { data: salesDistinct, error: salesErr } = await supabase
      .from('distinct_sales_items')
      .select('item_name, unit_price, total_units_sold, total_net_sales');

    if (salesErr) throw salesErr;

    const { data: existingRows, error: itemsErr } = await supabase.from('pos_menu_items').select('name');
    if (itemsErr) throw itemsErr;

    const existingNames = new Set((existingRows || []).map((i) => i.name.toLowerCase().trim()));

    const discoveredItems: any[] = [];
    for (const row of salesDistinct || []) {
      const rawName = (row.item_name || '').trim();
      if (!rawName) continue;
      if (!existingNames.has(rawName.toLowerCase())) {
        const norm = normalizeItemName(rawName);
        const suggestion = suggestHindiName(rawName, 'menu_item');
        discoveredItems.push({
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
      }
    }

    if (discoveredItems.length > 0) {
      const { error: insertErr } = await supabase
        .from('pos_menu_items')
        .upsert(discoveredItems, { onConflict: 'name', ignoreDuplicates: true });
      if (insertErr) throw insertErr;
    }

    return NextResponse.json({
      success: true,
      discoveredCount: discoveredItems.length,
      items: discoveredItems.map((i) => ({
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
