import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';
import { calculateAllRecipes, calculateVariantCost, resolveAllGroupWacs } from '@/lib/sops/costing';
import { parseMenuSalesChannel } from '@/lib/sales/menu-channels';

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

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const channel = parseMenuSalesChannel(searchParams.get('channel') || 'ALL');
    if (!channel) {
      return NextResponse.json({ error: 'Unsupported menu sales channel.' }, { status: 400 });
    }

    // 1. Concurrently fetch Menu Item, Variants with Recipes, and Scoped Daily Sales Trend
    const [menuItemRes, variantsRes, dailyTrendRes] = await Promise.all([
      admin
        .from('pos_menu_items')
        .select('*')
        .eq('id', id)
        .maybeSingle(),
      admin
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
        .eq('is_active', true),
      admin.rpc('get_menu_item_daily_sales', {
        p_menu_item_id: id,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_channel: channel,
      }),
    ]);

    if (menuItemRes.error) throw menuItemRes.error;
    if (!menuItemRes.data) {
      return NextResponse.json({ error: 'Menu item not found' }, { status: 404 });
    }
    if (variantsRes.error) throw variantsRes.error;
    if (dailyTrendRes.error) throw dailyTrendRes.error;

    const menuItem = menuItemRes.data;
    const variants = variantsRes.data || [];
    const dailyTrend = dailyTrendRes.data || [];

    // 2. Scoped Sales Metrics: Aggregated directly from trend (eliminates 20k sales scan)
    const trend = dailyTrend.map((r: any) => ({
      businessDate: r.business_date,
      unitsSold: Number(r.units_sold) || 0,
      netSales: Number(r.net_sales) || 0,
    }));
    const salesMetrics = {
      unitsSold: trend.reduce((sum: number, r: any) => sum + r.unitsSold, 0),
      netRevenue: trend.reduce((sum: number, r: any) => sum + r.netSales, 0),
      trend,
    };

    // 3. Scoped Recipe Dependency Sub-tree & Scoped WAC Resolution
    let recipeCalcs = new Map();

    if (variants.length > 0) {
      const allTreeRecipes: any[] = variants.map((v) => v.recipe).filter(Boolean);
      const recipeMap = new Map<string, any>(allTreeRecipes.map((r) => [r.id, r]));
      const groupIds = new Set<string>();

      // Record groups from variant recipes
      for (const recipe of allTreeRecipes) {
        for (const ing of recipe.ingredients || []) {
          const gid = ing.ingredient_group_id || ing.ingredient_group?.id;
          if (gid) groupIds.add(gid);
        }
      }

      // Collect transitive sub-preparations (frontier loop handles any depth DAG)
      let frontier: string[] = [];
      for (const recipe of allTreeRecipes) {
        for (const ing of recipe.ingredients || []) {
          if (ing.ingredient_type === 'PREPARATION' && (ing.sub_recipe_id || ing.sub_recipe?.id)) {
            const subId = ing.sub_recipe_id || ing.sub_recipe?.id;
            if (subId && !recipeMap.has(subId)) {
              frontier.push(subId);
            }
          }
        }
      }

      while (frontier.length > 0) {
        const { data: subRecipes, error: subErr } = await admin
          .from('yatra_recipes')
          .select(`
            *,
            ingredients:yatra_recipe_ingredients!yatra_recipe_ingredients_recipe_id_fkey(
              *,
              ingredient_group:logical_ingredient_groups(id, name, name_hi, group_code, inventory_class, base_unit:units!logical_ingredient_groups_base_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
              inventory_item:inventory_items(id, name, name_hi, item_code, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
              sub_recipe:yatra_recipes!yatra_recipe_ingredients_sub_recipe_id_fkey(id, name, name_hi, category, batch_yield_quantity, batch_yield_unit)
            )
          `)
          .in('id', frontier);

        if (subErr) throw subErr;

        const nextFrontier: string[] = [];
        for (const sr of subRecipes || []) {
          if (!recipeMap.has(sr.id)) {
            recipeMap.set(sr.id, sr);
            allTreeRecipes.push(sr);
            for (const ing of sr.ingredients || []) {
              const gid = ing.ingredient_group_id || ing.ingredient_group?.id;
              if (gid) groupIds.add(gid);
              if (ing.ingredient_type === 'PREPARATION' && (ing.sub_recipe_id || ing.sub_recipe?.id)) {
                const subId = ing.sub_recipe_id || ing.sub_recipe?.id;
                if (subId && !recipeMap.has(subId)) {
                  nextFrontier.push(subId);
                }
              }
            }
          }
        }
        frontier = nextFrontier;
      }

      // Fetch ONLY groups and items required by the scoped sub-tree
      const arrGroupIds = Array.from(groupIds);
      let groupWacMap = new Map();

      if (arrGroupIds.length > 0) {
        const [groupsRes, itemsRes] = await Promise.all([
          admin
            .from('logical_ingredient_groups')
            .select(`
              id, name, name_hi, group_code, inventory_class, last_valid_wac,
              base_unit:units!logical_ingredient_groups_base_unit_id_fkey(symbol, name)
            `)
            .in('id', arrGroupIds),
          admin
            .from('inventory_items')
            .select(`
              id, name, name_hi, item_code, group_id, current_stock,
              current_weighted_average_cost, is_costed, is_active, conversion_factor,
              unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi),
              secondary_unit:units!inventory_items_secondary_unit_id_fkey(symbol, symbol_hi, name, name_hi)
            `)
            .in('group_id', arrGroupIds),
        ]);

        if (groupsRes.error) throw groupsRes.error;
        if (itemsRes.error) throw itemsRes.error;

        groupWacMap = resolveAllGroupWacs((groupsRes.data || []) as any, (itemsRes.data || []) as any);
      }

      recipeCalcs = calculateAllRecipes(allTreeRecipes, groupWacMap);
    }

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
          gas_cost: null,
          other_operating_cost: null,
          packaging_cost_dine_in: null,
          packaging_cost_takeaway: null,
        };
      };

      const baseVariant = caller.hasCostAccess
        ? v
        : {
            ...v,
            gas_cost: null,
            other_operating_cost: null,
            packaging_cost_dine_in: null,
            packaging_cost_takeaway: null,
          };

      const isPortionOverridden = v.serving_quantity !== null && v.serving_unit !== null;
      const isPortionInvalid = (v.serving_quantity !== null) !== (v.serving_unit !== null);
      const effectiveServingQty = v.serving_quantity ?? v.recipe?.portion_size_quantity ?? null;
      const effectiveServingUnit = v.serving_unit ?? v.recipe?.portion_size_unit ?? null;
      const recipeDefaultPortionDisplay = `${v.recipe?.portion_size_quantity || '—'} ${v.recipe?.portion_size_unit || ''}`.trim();

      return {
        ...baseVariant,
        is_portion_overridden: isPortionOverridden,
        is_portion_invalid: isPortionInvalid,
        raw_serving_quantity: v.serving_quantity,
        raw_serving_unit: v.serving_unit,
        effective_serving_quantity: effectiveServingQty,
        effective_serving_unit: effectiveServingUnit,
        recipe_default_portion_display: recipeDefaultPortionDisplay,
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

    // Paired-Null Contract Validation for variant portion specification
    if (serving_quantity !== undefined || serving_unit !== undefined) {
      const hasQty = serving_quantity !== undefined && serving_quantity !== null && serving_quantity !== '';
      const hasUnit = serving_unit !== undefined && serving_unit !== null && String(serving_unit).trim() !== '';

      if (hasQty !== hasUnit) {
        return NextResponse.json({
          error: 'Invalid portion specification: serving_quantity and serving_unit must both be provided together for an override, or both set to null to inherit from the recipe default.',
        }, { status: 400 });
      }

      if (!hasQty && !hasUnit) {
        updatePayload.serving_quantity = null;
        updatePayload.serving_unit = null;
      } else {
        const qty = Number(serving_quantity);
        if (isNaN(qty) || qty <= 0) {
          return NextResponse.json({ error: 'Serving quantity must be a positive number' }, { status: 400 });
        }
        updatePayload.serving_quantity = qty;
        updatePayload.serving_unit = String(serving_unit).trim();
      }
    }

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
