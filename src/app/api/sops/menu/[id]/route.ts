import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';
import { calculateAllRecipes, calculateVariantCost, resolveAllGroupWacs } from '@/lib/sops/costing';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Menu Item ID is required' }, { status: 400 });
    }

    const caller = await resolveCallerAuth(request);

    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!caller.canViewMenu) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const admin = createAdminClient();

    // 1. Fetch menu item
    const { data: menuItem, error: menuErr } = await admin
      .from('pos_menu_items')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (menuErr) throw menuErr;
    if (!menuItem) {
      return NextResponse.json({ error: 'Menu item not found' }, { status: 404 });
    }

    // 2. Fetch variants
    const { data: variants, error: varErr } = await admin
      .from('yatra_menu_item_variants')
      .select(`
        *,
        recipe:yatra_recipes(
          *,
          ingredients:yatra_recipe_ingredients!yatra_recipe_ingredients_recipe_id_fkey(
            *,
            ingredient_group:logical_ingredient_groups(id, name, name_hi, group_code, inventory_class, base_unit:units!logical_ingredient_groups_base_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
            inventory_item:inventory_items(id, name, name_hi, item_code, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
            sub_recipe:yatra_recipes!yatra_recipe_ingredients_sub_recipe_id_fkey(id, name, name_hi, category, batch_yield_quantity, batch_yield_unit)
          )
        )
      `)
      .eq('menu_item_id', id)
      .eq('is_active', true);

    if (varErr) throw varErr;

    // 3. Resolve WAC and DAG costs
    const { data: allRecipes } = await admin
      .from('yatra_recipes')
      .select(`
        *,
        ingredients:yatra_recipe_ingredients!yatra_recipe_ingredients_recipe_id_fkey(
          *,
          ingredient_group:logical_ingredient_groups(id, name, name_hi, group_code, inventory_class, base_unit:units!logical_ingredient_groups_base_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
          inventory_item:inventory_items(id, name, name_hi, item_code, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
          sub_recipe:yatra_recipes!yatra_recipe_ingredients_sub_recipe_id_fkey(id, name, name_hi, category, batch_yield_quantity, batch_yield_unit)
        )
      `);

    const groupWacMap = await resolveAllGroupWacs(admin);
    const recipeCalcs = calculateAllRecipes(allRecipes || [], groupWacMap);

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    // 4. Fetch sales aggregation and daily trend
    const [salesAggRes, dailyTrendRes] = await Promise.all([
      admin.rpc('get_menu_sales_aggregation', {
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      }),
      admin.rpc('get_menu_item_daily_sales', {
        p_menu_item_id: id,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
      }),
    ]);

    const itemSalesRow = (salesAggRes.data || []).find((r: any) => r.menu_item_id === id);
    const salesMetrics = {
      unitsSold: itemSalesRow ? Number(itemSalesRow.units_sold) || 0 : 0,
      netRevenue: itemSalesRow ? Number(itemSalesRow.net_sales) || 0 : 0,
      trend: (dailyTrendRes.data || []).map((r: any) => ({
        businessDate: r.business_date,
        unitsSold: Number(r.units_sold) || 0,
        netSales: Number(r.net_sales) || 0,
      })),
    };

    // 5. Calculate variant channels (Dine In & Takeaway)
    const enrichedVariants = (variants || []).map((v) => {
      const rCalc = recipeCalcs.get(v.recipe_id);
      const dineInCalc = rCalc ? calculateVariantCost({ ...v, menu_item: menuItem }, rCalc, 'DINE_IN') : null;
      const takeawayCalc = rCalc ? calculateVariantCost({ ...v, menu_item: menuItem }, rCalc, 'TAKEAWAY') : null;

      const sanitize = (calc: any) => {
        if (!calc) return null;
        if (caller.hasCostAccess) return calc;
        return {
          ...calc,
          food_cost: null,
          food_cost_pct: null,
          margin_amount: null,
          operating_cost: null,
          packaging_cost: null,
          total_cost: null,
          contribution_amount: null,
          contribution_pct: null,
        };
      };

      return {
        ...v,
        dine_in: sanitize(dineInCalc),
        takeaway: sanitize(takeawayCalc),
      };
    });

    return NextResponse.json({
      menuItem,
      variants: enrichedVariants,
      salesMetrics,
      date_from: dateFrom,
      date_to: dateTo,
      hasCostAccess: caller.hasCostAccess,
    });
  } catch (err: any) {
    console.error('API GET /api/sops/menu/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Menu Item ID is required' }, { status: 400 });
    }

    const caller = await resolveCallerAuth(request);

    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!caller.canManageRecipes) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const {
      variant_id,
      serving_quantity,
      serving_unit,
      gas_cost,
      other_operating_cost,
      packaging_cost_dine_in,
      packaging_cost_takeaway,
      default_service_channel,
      is_default,
      recipe_id,
      notes,
    } = body;

    if (!variant_id) {
      return NextResponse.json({ error: 'Variant ID is required' }, { status: 400 });
    }

    const admin = createAdminClient();

    // If making this variant default, unset previous default for this menu item
    if (is_default === true) {
      await admin
        .from('yatra_menu_item_variants')
        .update({ is_default: false })
        .eq('menu_item_id', id);
    }

    const updatePayload: any = { updated_at: new Date().toISOString() };
    if (serving_quantity !== undefined)
      updatePayload.serving_quantity = serving_quantity != null ? Number(serving_quantity) : null;
    if (serving_unit !== undefined) updatePayload.serving_unit = serving_unit?.trim() || null;
    if (gas_cost !== undefined) updatePayload.gas_cost = gas_cost != null ? Number(gas_cost) : 0;
    if (other_operating_cost !== undefined)
      updatePayload.other_operating_cost = other_operating_cost != null ? Number(other_operating_cost) : 0;
    if (packaging_cost_dine_in !== undefined)
      updatePayload.packaging_cost_dine_in = packaging_cost_dine_in != null ? Number(packaging_cost_dine_in) : 0;
    if (packaging_cost_takeaway !== undefined)
      updatePayload.packaging_cost_takeaway =
        packaging_cost_takeaway != null ? Number(packaging_cost_takeaway) : 0;
    if (default_service_channel !== undefined)
      updatePayload.default_service_channel = default_service_channel;
    if (is_default !== undefined) updatePayload.is_default = Boolean(is_default);
    if (recipe_id !== undefined) updatePayload.recipe_id = recipe_id;
    if (notes !== undefined) updatePayload.notes = notes;

    const { data: updatedVariant, error: updateErr } = await admin
      .from('yatra_menu_item_variants')
      .update(updatePayload)
      .eq('id', variant_id)
      .eq('menu_item_id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true, variant: updatedVariant });
  } catch (err: any) {
    console.error('API PUT /api/sops/menu/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
