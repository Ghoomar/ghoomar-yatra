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

    // Recipe & Menu Dependencies (Card 4) - 4-Tier Native & Legacy Traversal
    let directRecipes: any[] = [];
    let transitiveRecipes: any[] = [];
    let linkedMenuItems: any[] = [];
    let linkedCombos: any[] = [];

    const directRecipeMap = new Map<string, any>();
    const prepDishIdsToTrace = new Set<string>();
    const prepFormIdsToTrace = new Set<string>();
    const allDishIds = new Set<string>();
    const allLegacyRecipeIds = new Set<string>();

    // 1. Query 4-tier formulation ingredients by group_id or brand-pinned item_id
    const formIngFilter = item.group_id
      ? `ingredient_group_id.eq.${item.group_id},inventory_item_id.eq.${itemId}`
      : `inventory_item_id.eq.${itemId}`;

    const { data: formIngs } = await admin
      .from('yatra_recipe_formulation_ingredients')
      .select(`
        id, quantity, unit, sort_order, notes, formulation_id, ingredient_group_id, inventory_item_id,
        formulation:yatra_recipe_formulations!yatra_recipe_formulation_ingredients_formulation_id_fkey(
          id, name, version_number, batch_yield_quantity, batch_yield_unit, is_active,
          canonical_dish:yatra_canonical_dishes!yatra_recipe_formulations_canonical_dish_id_fkey(
            id, name, name_hi, category, is_preparation, is_active
          )
        )
      `)
      .or(formIngFilter);

    // Fetch latest costing snapshots for discovered formulations
    const discoveredFormIds = (formIngs || [])
      .map((fi: any) => fi.formulation?.id)
      .filter(Boolean);

    let formSnapshotMap = new Map<string, any>();
    if (discoveredFormIds.length > 0) {
      const { data: snaps } = await admin
        .from('yatra_costing_snapshots')
        .select('formulation_id, costing_status, batch_cost')
        .in('formulation_id', discoveredFormIds)
        .is('serving_configuration_id', null)
        .order('created_at', { ascending: false });

      for (const s of snaps || []) {
        if (!formSnapshotMap.has(s.formulation_id)) {
          formSnapshotMap.set(s.formulation_id, s);
        }
      }
    }

    for (const fi of formIngs || []) {
      const f = fi.formulation as any;
      const dish = f?.canonical_dish as any;
      if (f && f.is_active && dish && dish.is_active) {
        const key = `form_${f.id}`;
        if (!directRecipeMap.has(key)) {
          const snap = formSnapshotMap.get(f.id);
          const displayName = dish.name === f.name || f.name === 'Standard' ? dish.name : `${dish.name} (${f.name})`;
          directRecipeMap.set(key, {
            id: f.id,
            formulation_id: f.id,
            dish_id: dish.id,
            name: displayName,
            name_hi: dish.name_hi,
            category: dish.category,
            usage_type: 'DIRECT',
            quantity: fi.quantity,
            unit: fi.unit,
            costing_status: snap?.costing_status || 'UNCOSTED',
            is_preparation: dish.is_preparation,
          });
          allDishIds.add(dish.id);
          if (dish.is_preparation || dish.category === 'PREPARATION') {
            prepDishIdsToTrace.add(dish.id);
            prepFormIdsToTrace.add(f.id);
          }
        }
      }
    }

    // 2. Query legacy recipes for backward compatibility
    if (item.group_id) {
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

      for (const di of directIngs || []) {
        const r = di.recipe as any;
        if (r && r.is_active) {
          const key = `rec_${r.id}`;
          if (!directRecipeMap.has(key)) {
            const rCost = recipeCalcs.get(r.id);
            directRecipeMap.set(key, {
              ...r,
              usage_type: 'DIRECT',
              quantity: di.quantity,
              unit: di.unit,
              costing_status: rCost?.status || 'UNCOSTED',
            });
            allLegacyRecipeIds.add(r.id);
            if (r.category === 'PREPARATION') {
              prepDishIdsToTrace.add(r.id);
            }
          }
        }
      }
    }
    directRecipes = Array.from(directRecipeMap.values());

    // 3. Transitive downstream traversal (DAG depth 10, cycle-safe)
    const visitedDishIds = new Set<string>(allDishIds);
    const visitedFormIds = new Set<string>(prepFormIdsToTrace);
    const visitedRecipeIds = new Set<string>(allLegacyRecipeIds);
    let currentPrepDishIds = Array.from(prepDishIdsToTrace);
    let currentPrepFormIds = Array.from(prepFormIdsToTrace);
    let currentLegacyPrepIds = Array.from(allLegacyRecipeIds);
    const transitiveRecipeMap = new Map<string, any>();

    for (let depth = 0; depth < 10 && (currentPrepDishIds.length > 0 || currentLegacyPrepIds.length > 0); depth++) {
      const nextPrepDishIds = new Set<string>();
      const nextPrepFormIds = new Set<string>();
      const nextLegacyPrepIds = new Set<string>();

      // 3a. 4-Tier parent formulation ingredients
      if (currentPrepDishIds.length > 0) {
        const { data: parentFormIngs } = await admin
          .from('yatra_recipe_formulation_ingredients')
          .select(`
            id, quantity, unit, sub_preparation_dish_id, sub_preparation_formulation_id,
            formulation:yatra_recipe_formulations!yatra_recipe_formulation_ingredients_formulation_id_fkey(
              id, name, version_number, batch_yield_quantity, batch_yield_unit, is_active,
              canonical_dish:yatra_canonical_dishes!yatra_recipe_formulations_canonical_dish_id_fkey(
                id, name, name_hi, category, is_preparation, is_active
              )
            )
          `)
          .in('sub_preparation_dish_id', currentPrepDishIds)
          .eq('ingredient_type', 'PREPARATION');

        for (const pfi of parentFormIngs || []) {
          const pf = pfi.formulation as any;
          const pdish = pf?.canonical_dish as any;
          if (pf && pf.is_active && pdish && pdish.is_active && !visitedFormIds.has(pf.id)) {
            visitedFormIds.add(pf.id);
            visitedDishIds.add(pdish.id);
            allDishIds.add(pdish.id);

            const snap = formSnapshotMap.get(pf.id);
            const displayName = pdish.name === pf.name || pf.name === 'Standard' ? pdish.name : `${pdish.name} (${pf.name})`;
            transitiveRecipeMap.set(`form_${pf.id}`, {
              id: pf.id,
              formulation_id: pf.id,
              dish_id: pdish.id,
              name: displayName,
              name_hi: pdish.name_hi,
              category: pdish.category,
              usage_type: 'TRANSITIVE',
              via_sub_recipe_id: pfi.sub_preparation_dish_id,
              depth: depth + 1,
              costing_status: snap?.costing_status || 'UNCOSTED',
              is_preparation: pdish.is_preparation,
            });

            if (pdish.is_preparation || pdish.category === 'PREPARATION') {
              nextPrepDishIds.add(pdish.id);
              nextPrepFormIds.add(pf.id);
            }
          }
        }
      }

      // 3b. Legacy parent recipe ingredients
      if (currentLegacyPrepIds.length > 0) {
        const { data: parentIngs } = await admin
          .from('yatra_recipe_ingredients')
          .select(`
            id, quantity, unit, sub_recipe_id,
            recipe:yatra_recipes(id, name, name_hi, category, batch_yield_quantity, batch_yield_unit, portion_size_quantity, portion_size_unit, is_active)
          `)
          .in('sub_recipe_id', currentLegacyPrepIds);

        for (const pi of parentIngs || []) {
          const pr = pi.recipe as any;
          if (pr && pr.is_active && !visitedRecipeIds.has(pr.id)) {
            visitedRecipeIds.add(pr.id);
            allLegacyRecipeIds.add(pr.id);
            transitiveRecipeMap.set(`rec_${pr.id}`, {
              ...pr,
              usage_type: 'TRANSITIVE',
              via_sub_recipe_id: pi.sub_recipe_id,
              depth: depth + 1,
              costing_status: 'UNCOSTED',
            });
            if (pr.category === 'PREPARATION') {
              nextLegacyPrepIds.add(pr.id);
            }
          }
        }
      }

      currentPrepDishIds = Array.from(nextPrepDishIds);
      currentPrepFormIds = Array.from(nextPrepFormIds);
      currentLegacyPrepIds = Array.from(nextLegacyPrepIds);
    }
    transitiveRecipes = Array.from(transitiveRecipeMap.values());

    // 4. Linked POS Menu Items (4-tier canonical dishes + legacy variants)
    const linkedMenuItemMap = new Map<string, any>();

    // 4a. 4-tier direct menu items linked to canonical dishes
    const allDishesArray = Array.from(allDishIds);
    if (allDishesArray.length > 0) {
      const { data: tier4MenuItems } = await admin
        .from('pos_menu_items')
        .select(`
          id, name, category, price, product_type, canonical_dish_id,
          serving_config:yatra_serving_configurations!pos_menu_items_serving_configuration_id_fkey(name)
        `)
        .in('canonical_dish_id', allDishesArray)
        .eq('is_active', true);

      for (const mi of tier4MenuItems || []) {
        const variantName = (mi.serving_config as any)?.name || 'Standard';
        linkedMenuItemMap.set(mi.id, {
          id: mi.id,
          variant_name: variantName,
          is_default: true,
          recipe_id: mi.canonical_dish_id,
          menu_item: {
            id: mi.id,
            name: mi.name,
            category: mi.category,
            price: mi.price,
          },
        });
      }

      // 4b. 4-tier combo/thali compositions referencing canonical dishes
      const { data: compositions } = await admin
        .from('yatra_menu_item_compositions')
        .select(`
          id, quantity, component_dish_id,
          dish:yatra_canonical_dishes!yatra_menu_item_compositions_component_dish_id_fkey(name),
          menu_item:pos_menu_items!yatra_menu_item_compositions_menu_item_id_fkey(id, name, product_type, price, is_active)
        `)
        .in('component_dish_id', allDishesArray);

      for (const comp of compositions || []) {
        const cItem = comp.menu_item as any;
        if (cItem && cItem.is_active) {
          const compName = (comp.dish as any)?.name || 'Component';
          linkedCombos.push({
            id: comp.id,
            component_name: compName,
            recipe_id: comp.component_dish_id,
            combo: {
              id: cItem.id,
              name: cItem.name,
              product_type: cItem.product_type,
              selling_price: cItem.price,
              is_active: cItem.is_active,
            },
          });
        }
      }
    }

    // 4c. Legacy menu item variants and combos
    const allLegacyArray = Array.from(allLegacyRecipeIds);
    if (allLegacyArray.length > 0) {
      const [varRes, comboRes] = await Promise.all([
        admin
          .from('yatra_menu_item_variants')
          .select(`
            id, variant_name, is_default, recipe_id,
            menu_item:pos_menu_items(id, name, category, price)
          `)
          .in('recipe_id', allLegacyArray)
          .eq('is_active', true),
        admin
          .from('yatra_combo_components')
          .select(`
            id, component_name, recipe_id,
            combo:yatra_combos_thalis(id, name, product_type, selling_price, is_active)
          `)
          .in('recipe_id', allLegacyArray),
      ]);

      for (const v of (varRes.data || []) as any[]) {
        if (v.menu_item && !linkedMenuItemMap.has(v.menu_item.id)) {
          linkedMenuItemMap.set(v.menu_item.id, v);
        }
      }

      for (const c of (comboRes.data || []) as any[]) {
        if (c.combo && c.combo.is_active) {
          linkedCombos.push(c);
        }
      }
    }

    linkedMenuItems = Array.from(linkedMenuItemMap.values());

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
