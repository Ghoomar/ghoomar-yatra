import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';
import { runAutoGradingForDate } from '@/lib/forecasting/auto-grade';

export async function POST(request: NextRequest) {
  try {
    const caller = await resolveCallerAuth(request);
    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!caller.canManageRecipes) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions to merge menu items' }, { status: 403 });
    }

    const body = await request.json();
    const { target_menu_item_id, source_menu_item_ids } = body;

    if (!target_menu_item_id) {
      return NextResponse.json({ error: 'Target menu item ID is required' }, { status: 400 });
    }

    const sourceIds = Array.isArray(source_menu_item_ids)
      ? source_menu_item_ids.filter(Boolean)
      : (source_menu_item_ids ? [source_menu_item_ids] : []);

    if (sourceIds.length === 0) {
      return NextResponse.json({ error: 'At least one source menu item ID is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: sourceItemsBeforeMerge } = await admin
      .from('pos_menu_items')
      .select('id, name')
      .in('id', sourceIds);
    const sourceNames = (sourceItemsBeforeMerge || []).map((s: any) => s.name).filter(Boolean);

    const { data, error } = await admin.rpc('fn_merge_pos_menu_items_atomic', {
      p_target_menu_item_id: target_menu_item_id,
      p_source_menu_item_ids: sourceIds,
      p_merged_by: caller.user.id || null,
    });

    if (error) {
      if (error.code === 'P0002') {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.code === '23505' || error.message.includes('409 Conflict') || error.message.includes('Merge conflict')) {
        return NextResponse.json({ error: error.message, conflict: true }, { status: 409 });
      }
      if (error.code === '23514') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Auto-regrade any snapshot dates that sold the merged source items so forecast & history roll up cleanly
    const regradedDates: string[] = [];
    if (sourceNames.length > 0) {
      try {
        const { data: affectedItemRows } = await admin
          .from('sales_order_items')
          .select('business_date')
          .in('item_name', sourceNames);

        const candidateDates = Array.from(
          new Set((affectedItemRows || []).map((r: any) => r.business_date).filter(Boolean))
        ).sort();

        if (candidateDates.length > 0) {
          const { data: existingSnaps } = await admin
            .from('sales_forecast_snapshots')
            .select('business_date')
            .in('business_date', candidateDates)
            .order('business_date', { ascending: true });

          for (const snap of existingSnaps || []) {
            await runAutoGradingForDate(admin, snap.business_date);
            regradedDates.push(snap.business_date);
          }
        }
      } catch (regradeErr) {
        console.warn('Post-merge forecast snapshot regrade warning:', regradeErr);
      }
    }

    return NextResponse.json({ success: true, result: data, regraded_dates: regradedDates });
  } catch (err: any) {
    console.error('API /api/admin/menu/merge error:', err);
    return NextResponse.json({ error: err.message || 'Failed to merge menu items' }, { status: 500 });
  }
}
