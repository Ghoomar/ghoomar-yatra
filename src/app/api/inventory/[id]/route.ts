import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canViewCosting } from '@/lib/rbac';
import { calculateAllRecipes, resolveAllGroupWacs } from '@/lib/sops/costing';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: itemId } = await params;
    if (!itemId) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

    let user: any = null;
    let serverSupabase: any = null;

    const testUserId = (process.env.NODE_ENV !== 'production' && process.env.ENABLE_TEST_AUTH_OVERRIDE === 'true')
      ? request.headers.get('x-test-user-id')
      : null;
    if (testUserId) {
      user = { id: testUserId };
      serverSupabase = createAdminClient();
    } else {
      try {
        serverSupabase = await createServerSupabaseClient();
        const { data: authData, error: authErr } = await serverSupabase.auth.getUser(bearerToken);
        if (!authErr) user = authData?.user;
      } catch {
        const admin = createAdminClient();
        if (bearerToken) {
          const { data: authData } = await admin.auth.getUser(bearerToken);
          user = authData?.user;
        }
        serverSupabase = admin;
      }
    }

    // Role and permission resolution
    let roleName: string | null = null;
    let permissionCodes: string[] = [];

    if (user) {
      const { data: profile } = await serverSupabase
        .from('profiles')
        .select('*, role:roles(id, name)')
        .eq('id', user.id)
        .maybeSingle();

      if (profile) {
        roleName = profile.role?.name || null;
        const { data: rolePerms } = await serverSupabase
          .from('role_permissions')
          .select('permissions(code)')
          .eq('role_id', profile.role_id);

        permissionCodes = (rolePerms || [])
          .map((rp: any) => rp.permissions?.code)
          .filter(Boolean);
      }
    }

    const hasCostAccess = canViewCosting(roleName, permissionCodes);

    // Fetch primary item details using admin client to ensure reliable data aggregation
    const admin = createAdminClient();

    const [
      itemRes,
      locStocksRes,
      aliasesRes,
      pkgRes,
      vendorItemsRes,
      purchasesRes,
      movementsRes,
      countItemsRes,
    ] = await Promise.all([
      admin
        .from('inventory_items')
        .select(`
          *,
          unit:units!inventory_items_unit_id_fkey(id, name, symbol, name_hi, symbol_hi),
          category:inventory_categories(id, name, code, inventory_class, name_hi)
        `)
        .eq('id', itemId)
        .single(),
      admin
        .from('item_location_stocks')
        .select(`
          quantity, updated_at,
          location:inventory_locations(id, code, name, name_hi)
        `)
        .eq('item_id', itemId),
      admin
        .from('inventory_item_aliases')
        .select('*')
        .eq('item_id', itemId)
        .order('alias'),
      admin
        .from('item_packaging_units')
        .select(`
          *,
          vendor:vendors(id, name, name_hi)
        `)
        .eq('inventory_item_id', itemId)
        .order('is_default', { ascending: false }),
      admin
        .from('vendor_items')
        .select(`
          last_purchase_rate, last_purchase_date, is_preferred,
          vendor:vendors(id, name, vendor_code)
        `)
        .eq('inventory_item_id', itemId),
      admin
        .from('purchase_lines')
        .select(`
          id, quantity, rate, total_amount, brand_name_snapshot, pack_unit_snapshot,
          pack_quantity, pack_rate, conversion_factor_snapshot,
          purchase:purchase_headers(id, purchase_number, purchase_date, invoice_number, status, vendor:vendors(name))
        `)
        .eq('item_id', itemId)
        .order('id', { ascending: false })
        .limit(20),
      admin
        .from('stock_movements')
        .select(`
          id, business_date, movement_type, quantity, unit_cost, total_value, purpose,
          reference_type, notes, created_at,
          source_loc:inventory_locations!stock_movements_source_location_id_fkey(name),
          dest_loc:inventory_locations!stock_movements_destination_location_id_fkey(name),
          department:departments(name)
        `)
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(50),
      admin
        .from('inventory_count_items')
        .select(`
          id, expected_quantity, physical_quantity, variance_quantity, variance_value, reason, notes,
          count:inventory_counts(id, business_date, count_type, status)
        `)
        .eq('item_id', itemId)
        .order('id', { ascending: false })
        .limit(20),
    ]);

    if (itemRes.error || !itemRes.data) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const item = itemRes.data;
    const isCosted = Boolean(item.is_costed);
    const rawWac = item.current_weighted_average_cost != null ? Number(item.current_weighted_average_cost) : null;
    const rawStock = Number(item.current_stock || 0);

    // Apply security boundary masking if unauthorized
    let sanitizedWac: number | null = rawWac;
    let sanitizedValuation: number | null = isCosted && rawWac != null ? Math.round(rawStock * rawWac * 100) / 100 : null;

    let sanitizedVendorItems = (vendorItemsRes.data || []).map((vi: any) => ({
      ...vi,
      last_purchase_rate: hasCostAccess ? vi.last_purchase_rate : null,
    }));

    let sanitizedPurchaseLines = (purchasesRes.data || []).map((pl: any) => ({
      ...pl,
      rate: hasCostAccess ? pl.rate : null,
      total_amount: hasCostAccess ? pl.total_amount : null,
      pack_rate: hasCostAccess ? pl.pack_rate : null,
    }));

    let sanitizedMovements = (movementsRes.data || []).map((m: any) => ({
      ...m,
      unit_cost: hasCostAccess ? m.unit_cost : null,
      total_value: hasCostAccess ? m.total_value : null,
    }));

    let sanitizedCountItems = (countItemsRes.data || []).map((ci: any) => ({
      ...ci,
      variance_value: hasCostAccess ? ci.variance_value : null,
    }));

    if (!hasCostAccess) {
      sanitizedWac = null;
      sanitizedValuation = null;
    }

    // Recipe & Menu Dependencies (Card 4)
    let directRecipes: any[] = [];
    let transitiveRecipes: any[] = [];
    let linkedMenuItems: any[] = [];
    let linkedCombos: any[] = [];

    if (item.group_id) {
      // 1. Resolve DAG recipe costs to attach costing status badges
      const [groupWacMap, { data: allRecipes }] = await Promise.all([
        resolveAllGroupWacs(admin),
        admin.from('yatra_recipes').select(`
          *,
          ingredients:yatra_recipe_ingredients!yatra_recipe_ingredients_recipe_id_fkey(
            *,
            ingredient_group:logical_ingredient_groups(id, name, name_hi, group_code, inventory_class, base_unit:units!logical_ingredient_groups_base_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
            inventory_item:inventory_items(id, name, name_hi, item_code, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
            sub_recipe:yatra_recipes!yatra_recipe_ingredients_sub_recipe_id_fkey(id, name, name_hi, category, batch_yield_quantity, batch_yield_unit)
          )
        `),
      ]);
      const recipeCalcs = calculateAllRecipes(allRecipes || [], groupWacMap);

      const { data: directIngs } = await admin
        .from('yatra_recipe_ingredients')
        .select(`
          id, quantity, unit, sort_order, notes,
          recipe:yatra_recipes(id, name, name_hi, category, batch_yield_quantity, batch_yield_unit, portion_size_quantity, portion_size_unit, is_active)
        `)
        .or(`ingredient_group_id.eq.${item.group_id},inventory_item_id.eq.${itemId}`);

      const directRecipeMap = new Map();
      const prepIdsToTrace: string[] = [];

      for (const di of directIngs || []) {
        const r = di.recipe as any;
        if (r && r.is_active) {
          if (!directRecipeMap.has(r.id)) {
            const rCost = recipeCalcs.get(r.id);
            directRecipeMap.set(r.id, {
              ...r,
              usage_type: 'DIRECT',
              quantity: di.quantity,
              unit: di.unit,
              costing_status: rCost?.status || 'UNCOSTED',
            });
            if (r.category === 'PREPARATION') {
              prepIdsToTrace.push(r.id);
            }
          }
        }
      }
      directRecipes = Array.from(directRecipeMap.values());

      // Transitive downstream recipes (depth 10, cycle-safe)
      const visitedRecipeIds = new Set(directRecipeMap.keys());
      let currentPrepIds = [...prepIdsToTrace];
      const transitiveRecipeMap = new Map();

      for (let depth = 0; depth < 10 && currentPrepIds.length > 0; depth++) {
        const { data: parentIngs } = await admin
          .from('yatra_recipe_ingredients')
          .select(`
            id, quantity, unit, sub_recipe_id,
            recipe:yatra_recipes(id, name, name_hi, category, batch_yield_quantity, batch_yield_unit, portion_size_quantity, portion_size_unit, is_active)
          `)
          .in('sub_recipe_id', currentPrepIds);

        const nextPrepIds: string[] = [];
        for (const pi of parentIngs || []) {
          const pr = pi.recipe as any;
          if (pr && pr.is_active && !visitedRecipeIds.has(pr.id)) {
            visitedRecipeIds.add(pr.id);
            const prCost = recipeCalcs.get(pr.id);
            transitiveRecipeMap.set(pr.id, {
              ...pr,
              usage_type: 'TRANSITIVE',
              via_sub_recipe_id: pi.sub_recipe_id,
              depth: depth + 1,
              costing_status: prCost?.status || 'UNCOSTED',
            });
            if (pr.category === 'PREPARATION') {
              nextPrepIds.push(pr.id);
            }
          }
        }
        currentPrepIds = nextPrepIds;
      }
      transitiveRecipes = Array.from(transitiveRecipeMap.values());

      const allActiveRecipeIds = Array.from(visitedRecipeIds);
      if (allActiveRecipeIds.length > 0) {
        const [varRes, comboRes] = await Promise.all([
          admin
            .from('yatra_menu_item_variants')
            .select(`
              id, variant_name, is_default, recipe_id,
              menu_item:pos_menu_items(id, name, category, price)
            `)
            .in('recipe_id', allActiveRecipeIds)
            .eq('is_active', true),
          admin
            .from('yatra_combo_components')
            .select(`
              id, component_name, recipe_id,
              combo:yatra_combos_thalis(id, name, product_type, selling_price, is_active)
            `)
            .in('recipe_id', allActiveRecipeIds)
        ]);

        linkedMenuItems = (varRes.data || []).filter((v: any) => v.menu_item);
        linkedCombos = (comboRes.data || []).filter((c: any) => c.combo && c.combo.is_active);
      }
    }

    return NextResponse.json({
      item: {
        ...item,
        current_weighted_average_cost: sanitizedWac,
        total_valuation: sanitizedValuation,
        is_costed: isCosted,
      },
      locationStocks: locStocksRes.data || [],
      aliases: aliasesRes.data || [],
      packagingUnits: pkgRes.data || [],
      vendorItems: sanitizedVendorItems,
      purchaseLines: sanitizedPurchaseLines,
      stockMovements: sanitizedMovements,
      countItems: sanitizedCountItems,
      recipeDependencies: {
        directRecipes,
        transitiveRecipes,
        linkedMenuItems,
        linkedCombos,
      },
      hasCostAccess,
    });
  } catch (err: any) {
    console.error('API /api/inventory/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
