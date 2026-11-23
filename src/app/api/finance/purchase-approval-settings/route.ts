import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveFinanceCallerAuth } from '@/lib/auth/finance-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('purchase_approval_settings')
      .select('*')
      .eq('singleton', true)
      .maybeSingle();

    if (error) {
      console.error('Error fetching purchase approval settings:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ settings: data });
  } catch (err: any) {
    console.error('Error in GET /api/finance/purchase-approval-settings:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await resolveFinanceCallerAuth(request);
    if (!auth || !auth.user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    if (!auth.canApprovePurchases) {
      return NextResponse.json(
        { error: 'Forbidden. Only administrators can update approval policy settings.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      auto_approve_enabled,
      line_auto_approve_limit,
      daily_non_staple_auto_limit,
      high_control_count_interval_days,
      frequent_monitoring_count_interval_days,
    } = body;

    const updates: any = {
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    };

    if (typeof auto_approve_enabled === 'boolean') {
      updates.auto_approve_enabled = auto_approve_enabled;
    }
    if (line_auto_approve_limit != null && !isNaN(Number(line_auto_approve_limit))) {
      updates.line_auto_approve_limit = Number(line_auto_approve_limit);
    }
    if (daily_non_staple_auto_limit != null && !isNaN(Number(daily_non_staple_auto_limit))) {
      updates.daily_non_staple_auto_limit = Number(daily_non_staple_auto_limit);
    }
    if (high_control_count_interval_days != null && !isNaN(Number(high_control_count_interval_days))) {
      updates.high_control_count_interval_days = Number(high_control_count_interval_days);
    }
    if (frequent_monitoring_count_interval_days != null && !isNaN(Number(frequent_monitoring_count_interval_days))) {
      updates.frequent_monitoring_count_interval_days = Number(frequent_monitoring_count_interval_days);
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('purchase_approval_settings')
      .update(updates)
      .eq('singleton', true)
      .select()
      .single();

    if (error) {
      console.error('Error updating purchase approval settings:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, settings: data });
  } catch (err: any) {
    console.error('Error in PATCH /api/finance/purchase-approval-settings:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
