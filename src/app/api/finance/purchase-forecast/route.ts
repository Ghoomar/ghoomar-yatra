import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateDayForecast } from '@/lib/forecasting/engine';
import { explodeBomDemands } from '@/lib/inventory/bom-explosion';
import { ModelStateRow, GroupProfile, EventType } from '@/lib/forecasting/types';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Check RBAC costing permission
    let canViewCosts = false;
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role:roles(name), role_permissions(permission:permissions(code))')
        .eq('id', user.id)
        .maybeSingle();

      const userRole = (profile?.role as any)?.name;
      const userPermissions = (profile?.role_permissions || []).map((rp: any) => rp?.permission?.code).filter(Boolean);

      // Sensitive costing protection: Storekeepers (who have finance.purchases) MUST NOT see costs!
      // Only users with sops.costing.view, finance.profitability, reports.view, or Admin can view costs.
      if (
        userRole === 'Admin' ||
        userRole === 'Owner' ||
        userPermissions.includes('sops.costing.view') ||
        userPermissions.includes('finance.profitability') ||
        userPermissions.includes('admin.manage')
      ) {
        canViewCosts = true;
      }
    }

    const searchParams = request.nextUrl.searchParams;
    const requestedDate = searchParams.get('date');

    // Default to tomorrow in IST
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTomorrow = new Date(now.getTime() + istOffset + 24 * 60 * 60 * 1000);
    const tomorrowStr = istTomorrow.toISOString().slice(0, 10);
    const targetDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : tomorrowStr;

    const d = new Date(targetDate + 'T00:00:00Z');
    const dow = d.getUTCDay();

    // 1. Fetch Model State for this day of week
    const { data: modelState, error: stateErr } = await supabase
      .from('sales_forecast_model_state')
      .select('*')
      .eq('day_of_week', dow)
      .single();

    if (stateErr || !modelState) {
      return NextResponse.json({ error: 'Model state not found' }, { status: 500 });
    }

    // 2. Fetch Day Context & Group Profiles
    const { data: dayContext } = await supabase
      .from('sales_forecast_day_context')
      .select('*, event_type:sales_forecast_event_types(*)')
      .eq('business_date', targetDate)
      .maybeSingle();

    const { data: grpProfiles } = await supabase
      .from('sales_forecast_group_profiles')
      .select('*');
    const groupProfileMap = new Map<string, GroupProfile>((grpProfiles || []).map((g) => [g.group_type, g]));

    // 3. Generate Day Forecast
    const forecast = generateDayForecast(targetDate, modelState, dayContext, groupProfileMap);

    // 4. Extract Dish Demands and Explode BOM
    const dishDemands = forecast.dishes.map((dish) => ({
      dish_name: dish.dish_name,
      predicted_quantity: dish.predicted_quantity,
    }));

    // Strictly uses Quantity Track confidence score (qty_confidence_score)
    const suggestions = await explodeBomDemands(
      supabase,
      dishDemands,
      forecast.qty_confidence_score,
      canViewCosts
    );

    // Summary calculation
    const belowParItems = suggestions.filter((s) => s.suggested_order_qty > 0).length;
    let totalForecastSpend: number | undefined = undefined;

    if (canViewCosts) {
      totalForecastSpend = suggestions.reduce((acc, s) => acc + (s.line_cost || 0), 0);
      totalForecastSpend = Math.round(totalForecastSpend * 100) / 100;
    }

    return NextResponse.json({
      success: true,
      target_date: targetDate,
      day_of_week: dow,
      qty_confidence_score: forecast.qty_confidence_score,
      qty_confidence_tier: forecast.qty_confidence_tier,
      predicted_total_units: forecast.predicted_total_units,
      predicted_covers: forecast.predicted_pax,
      driver_summary: forecast.driver_summary,
      summary: {
        total_items: suggestions.length,
        below_par_items: belowParItems,
        total_forecast_spend: totalForecastSpend,
      },
      suggestions,
    });
  } catch (err: any) {
    console.error('Purchase forecast error:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate purchase forecast' }, { status: 500 });
  }
}
