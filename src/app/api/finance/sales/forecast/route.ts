import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/rbac';
import { generateDayForecast } from '@/lib/forecasting/engine';
import { ModelStateRow, DayContext, GroupProfile, EventType } from '@/lib/forecasting/types';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Check sales permission
    let userRole = null;
    let userPermissions: string[] = [];
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role:roles(name), role_permissions(permission:permissions(code))')
        .eq('id', user.id)
        .maybeSingle();

      userRole = (profile?.role as any)?.name;
      userPermissions = (profile?.role_permissions || []).map((rp: any) => rp?.permission?.code).filter(Boolean);
    }

    const searchParams = request.nextUrl.searchParams;
    const requestedStart = searchParams.get('start_date');

    // Default to today in IST
    const now = new Date();
    // Offset to IST (+5:30)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const todayStr = istNow.toISOString().slice(0, 10);
    const startDateStr = requestedStart && /^\d{4}-\d{2}-\d{2}$/.test(requestedStart) ? requestedStart : todayStr;

    // 1. Fetch Model State for all 7 days of week
    const { data: modelStates, error: stateErr } = await supabase
      .from('sales_forecast_model_state')
      .select('*');

    if (stateErr || !modelStates || modelStates.length === 0) {
      return NextResponse.json({ error: 'Model state not initialized' }, { status: 500 });
    }

    const stateMap = new Map<number, ModelStateRow>();
    for (const s of modelStates) {
      stateMap.set(s.day_of_week, s);
    }

    // 2. Fetch Group Profiles & Event Types
    const { data: grpProfiles } = await supabase
      .from('sales_forecast_group_profiles')
      .select('*');
    const groupProfileMap = new Map<string, GroupProfile>((grpProfiles || []).map((g) => [g.group_type, g]));

    const { data: eventTypes } = await supabase
      .from('sales_forecast_event_types')
      .select('*')
      .eq('is_active', true);
    const eventTypeMap = new Map<string, EventType>((eventTypes || []).map((e) => [e.id, e]));

    // 3. Fetch Day Context for the next 7 days
    const forecastDates: string[] = [];
    const baseDate = new Date(startDateStr + 'T00:00:00Z');
    for (let i = 0; i < 7; i++) {
      const cur = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
      forecastDates.push(cur.toISOString().slice(0, 10));
    }

    const { data: contexts } = await supabase
      .from('sales_forecast_day_context')
      .select('*')
      .in('business_date', forecastDates);

    const contextMap = new Map<string, DayContext>();
    for (const ctx of (contexts || [])) {
      if (ctx.event_type_id && eventTypeMap.has(ctx.event_type_id)) {
        ctx.event_type = eventTypeMap.get(ctx.event_type_id);
      }
      contextMap.set(ctx.business_date, ctx);
    }

    // 4. Generate 7-day dual-track forecast ribbon
    const ribbon = forecastDates.map((dateStr) => {
      const d = new Date(dateStr + 'T00:00:00Z');
      const dow = d.getUTCDay();
      const state = stateMap.get(dow)!;
      const ctx = contextMap.get(dateStr) || null;
      return generateDayForecast(dateStr, state, ctx, groupProfileMap);
    });

    // 5. Fetch Yesterday's Graded Scorecard
    const yestDate = new Date(baseDate.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: yestSnapshot } = await supabase
      .from('sales_forecast_snapshots')
      .select('*')
      .eq('business_date', yestDate)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      start_date: startDateStr,
      ribbon,
      today: ribbon[0],
      tomorrow: ribbon[1],
      yesterday_scorecard: yestSnapshot || null,
      event_types: eventTypes || [],
      group_profiles: grpProfiles || [],
    });
  } catch (err: any) {
    console.error('Forecast API error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch sales forecast' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify RBAC
    const { data: profile } = await supabase
      .from('profiles')
      .select('role:roles(name), role_permissions(permission:permissions(code))')
      .eq('id', user.id)
      .maybeSingle();

    const userRole = (profile?.role as any)?.name;
    const userPermissions = (profile?.role_permissions || []).map((rp: any) => rp?.permission?.code).filter(Boolean);

    if (!hasPermission(userRole, userPermissions, 'finance.sales') && userRole !== 'Admin') {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions to manage forecast context' }, { status: 403 });
    }

    const body = await request.json();
    const {
      business_date,
      day_mode,
      event_type_id,
      expected_guests,
      group_type,
      group_daypart,
      group_notes,
      custom_rev_multiplier_override,
      custom_qty_multiplier_override,
    } = body;

    if (!business_date || !/^\d{4}-\d{2}-\d{2}$/.test(business_date)) {
      return NextResponse.json({ error: 'Valid business_date (YYYY-MM-DD) is required.' }, { status: 400 });
    }

    const { data: savedContext, error: saveErr } = await supabase
      .from('sales_forecast_day_context')
      .upsert({
        business_date,
        day_mode: day_mode || 'normal',
        event_type_id: event_type_id || null,
        expected_guests: expected_guests ? Number(expected_guests) : 0,
        group_type: group_type || null,
        group_daypart: group_daypart || 'lunch',
        group_notes: group_notes || null,
        custom_rev_multiplier_override: custom_rev_multiplier_override ? Number(custom_rev_multiplier_override) : null,
        custom_qty_multiplier_override: custom_qty_multiplier_override ? Number(custom_qty_multiplier_override) : null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (saveErr) {
      return NextResponse.json({ error: saveErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      context: savedContext,
      message: `Successfully saved forecast context for ${business_date}.`,
    });
  } catch (err: any) {
    console.error('Save context error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
