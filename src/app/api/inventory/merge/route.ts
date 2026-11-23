import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { source_item_id, target_item_id } = body;

    if (!source_item_id || !target_item_id) {
      return NextResponse.json(
        { error: 'Both source_item_id and target_item_id are required' },
        { status: 400 }
      );
    }

    if (source_item_id === target_item_id) {
      return NextResponse.json(
        { error: 'Source and target items cannot be the same item' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('merge_inventory_items', {
      p_source_item_id: source_item_id,
      p_target_item_id: target_item_id,
      p_performed_by: user.id,
    });

    if (error) {
      console.error('RPC merge_inventory_items error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err: any) {
    console.error('API POST /api/inventory/merge error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
