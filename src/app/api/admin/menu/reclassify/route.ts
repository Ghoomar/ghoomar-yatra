import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { loadMenuMasterLookupFromDb, resolveItemCategory } from '@/lib/petpooja/matcher';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const body = await request.json();
    const { businessDates } = body;

    if (!Array.isArray(businessDates) || businessDates.length === 0) {
      return NextResponse.json({ error: 'businessDates must be a non-empty array of dates (YYYY-MM-DD).' }, { status: 400 });
    }

    // 1. Load authoritative database lookup
    const lookup = await loadMenuMasterLookupFromDb(supabase);

    const results: Record<string, any> = {};

    for (const date of businessDates) {
      const { data: records, error: fetchErr } = await supabase
        .from('sales_hourly_items')
        .select('id, item_name, parent_category, category, net_amount, quantity')
        .eq('business_date', date);

      if (fetchErr) throw fetchErr;
      if (!records || records.length === 0) {
        results[date] = { recordCount: 0, status: 'No records found' };
        continue;
      }

      // Snapshot before stats
      const beforeDistribution: Record<string, number> = {};
      let beforeTotalSales = 0;
      let beforeTotalQty = 0;
      records.forEach((r) => {
        const p = r.parent_category || 'Uncategorized';
        beforeDistribution[p] = (beforeDistribution[p] || 0) + Number(r.net_amount || 0);
        beforeTotalSales += Number(r.net_amount || 0);
        beforeTotalQty += Number(r.quantity || 0);
      });

      // Prepare updates
      let matchedCount = 0;
      let unmatchedCount = 0;
      const updates = [];

      for (const r of records) {
        const res = resolveItemCategory(r.item_name, lookup);
        if (res.isMatched) {
          matchedCount++;
        } else {
          unmatchedCount++;
        }
        updates.push({
          id: r.id,
          parent_category: res.parentCategory,
          category: res.category,
        });
      }

      // Execute updates
      for (const u of updates) {
        await supabase
          .from('sales_hourly_items')
          .update({
            parent_category: u.parent_category,
            category: u.category,
          })
          .eq('id', u.id);
      }

      // Query after stats
      const { data: afterRecords } = await supabase
        .from('sales_hourly_items')
        .select('item_name, parent_category, category, net_amount, quantity')
        .eq('business_date', date);

      const afterDistribution: Record<string, number> = {};
      let afterTotalSales = 0;
      let afterTotalQty = 0;
      const unmatchedItems: Record<string, { qty: number; sales: number }> = {};

      (afterRecords || []).forEach((r) => {
        const p = r.parent_category || 'Uncategorized';
        afterDistribution[p] = (afterDistribution[p] || 0) + Number(r.net_amount || 0);
        afterTotalSales += Number(r.net_amount || 0);
        afterTotalQty += Number(r.quantity || 0);

        if (p === 'Uncategorized') {
          if (!unmatchedItems[r.item_name]) {
            unmatchedItems[r.item_name] = { qty: 0, sales: 0 };
          }
          unmatchedItems[r.item_name].qty += Number(r.quantity || 0);
          unmatchedItems[r.item_name].sales += Number(r.net_amount || 0);
        }
      });

      // Verification of total conservation
      const salesDiff = Math.abs(afterTotalSales - beforeTotalSales);
      const qtyDiff = Math.abs(afterTotalQty - beforeTotalQty);
      const isConserved = salesDiff < 0.01 && qtyDiff === 0;

      results[date] = {
        recordCount: records.length,
        matchedCount,
        unmatchedCount,
        beforeTotalSales: Math.round(beforeTotalSales * 100) / 100,
        afterTotalSales: Math.round(afterTotalSales * 100) / 100,
        beforeTotalQty,
        afterTotalQty,
        isConserved,
        beforeDistribution,
        afterDistribution,
        unmatchedItems,
      };
    }

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    console.error('Error reclassifying historical sales:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
