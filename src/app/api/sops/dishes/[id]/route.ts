import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Dish ID is required' }, { status: 400 });
    }

    const caller = await resolveCallerAuth(request);

    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!caller.canViewRecipes) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const admin = createAdminClient();

    // Query canonical dish with formulations, ingredients, and configurations
    let { data: dish, error: dishErr } = await admin
      .from('yatra_canonical_dishes')
      .select(`
        *,
        configurations:yatra_serving_configurations(*),
        formulations:yatra_recipe_formulations(
          *,
          ingredients:yatra_recipe_formulation_ingredients(
            *,
            ingredient_group:logical_ingredient_groups(id, name, name_hi, group_code, inventory_class, base_unit:units!logical_ingredient_groups_base_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
            inventory_item:inventory_items(id, name, name_hi, item_code, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
            sub_preparation_dish:yatra_canonical_dishes!yatra_recipe_formulation_ingredients_sub_preparation_dish_id_fkey(id, name, name_hi, category, is_preparation)
          ),
          config_links:yatra_configuration_formulations(*)
        ),
        menu_items:pos_menu_items(id, name, name_hi, price, category, parent_category, product_type, serving_configuration_id, is_active)
      `)
      .eq('id', id)
      .maybeSingle();

    if (!dish) {
      // Check if id corresponds to legacy recipe name
      const { data: legacyRec } = await admin.from('yatra_recipes').select('name').eq('id', id).maybeSingle();
      if (legacyRec?.name) {
        const { data: matchedDish } = await admin
          .from('yatra_canonical_dishes')
          .select(`
            *,
            configurations:yatra_serving_configurations(*),
            formulations:yatra_recipe_formulations(
              *,
              ingredients:yatra_recipe_formulation_ingredients(
                *,
                ingredient_group:logical_ingredient_groups(id, name, name_hi, group_code, inventory_class, base_unit:units!logical_ingredient_groups_base_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
                inventory_item:inventory_items(id, name, name_hi, item_code, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
                sub_preparation_dish:yatra_canonical_dishes!yatra_recipe_formulation_ingredients_sub_preparation_dish_id_fkey(id, name, name_hi, category, is_preparation)
              ),
              config_links:yatra_configuration_formulations(*)
            ),
            menu_items:pos_menu_items(id, name, name_hi, price, category, parent_category, product_type, serving_configuration_id, is_active)
          `)
          .eq('name', legacyRec.name)
          .maybeSingle();
        if (matchedDish) dish = matchedDish;
      }
    }

    if (dishErr) throw dishErr;
    if (!dish) {
      return NextResponse.json({ error: 'Canonical dish not found' }, { status: 404 });
    }

    // Query costing snapshots for all formulations of this dish
    const formIds = (dish.formulations || []).map((f: any) => f.id);
    let snapshotMap = new Map<string, any>();

    if (formIds.length > 0) {
      const { data: snapshots } = await admin
        .from('yatra_costing_snapshots')
        .select('*')
        .in('formulation_id', formIds)
        .order('created_at', { ascending: false });

      for (const snap of snapshots || []) {
        const key = snap.serving_configuration_id
          ? `${snap.formulation_id}:${snap.serving_configuration_id}`
          : `${snap.formulation_id}:batch`;
        if (!snapshotMap.has(key)) {
          snapshotMap.set(key, snap);
        }
      }
    }

    // Where-used: Parent formulations consuming this dish as a sub-preparation
    let whereUsedFormulations: any[] = [];
    if (dish.is_preparation) {
      const { data: parentIngs } = await admin
        .from('yatra_recipe_formulation_ingredients')
        .select(`
          id, quantity, unit,
          parent_formulation:yatra_recipe_formulations!yatra_recipe_formulation_ingredients_formulation_id_fkey(
            id, name, canonical_dish:yatra_canonical_dishes!yatra_recipe_formulations_canonical_dish_id_fkey(id, name, name_hi, category)
          )
        `)
        .eq('sub_preparation_dish_id', id);

      whereUsedFormulations = (parentIngs || [])
        .map((pi: any) => ({
          formulationId: pi.parent_formulation?.id,
          formulationName: pi.parent_formulation?.name,
          dishId: pi.parent_formulation?.canonical_dish?.id,
          dishName: pi.parent_formulation?.canonical_dish?.name,
          dishCategory: pi.parent_formulation?.canonical_dish?.category,
          quantity: pi.quantity,
          unit: pi.unit,
        }))
        .filter((item: any) => item.dishId);
    }

    // Where-used in Combos/Thalis
    const { data: comboComps } = await admin
      .from('yatra_menu_item_compositions')
      .select(`
        id, quantity,
        serving_configuration:yatra_serving_configurations!yatra_menu_item_compositions_serving_configuration_id_fkey(id, name, portion_size_quantity, portion_size_unit),
        menu_item:pos_menu_items!yatra_menu_item_compositions_menu_item_id_fkey(id, name, name_hi, product_type, price, is_active)
      `)
      .eq('component_dish_id', id);

    const whereUsedCombos = (comboComps || [])
      .filter((c: any) => c.menu_item && c.menu_item.is_active)
      .map((c: any) => ({
        compositionId: c.id,
        menuItemId: c.menu_item.id,
        menuItemName: c.menu_item.name,
        productType: c.menu_item.product_type,
        price: c.menu_item.price,
        configName: c.serving_configuration?.name,
        quantity: c.quantity,
      }));

    // Mask costs
    const maskedFormulations = (dish.formulations || []).map((f: any) => {
      const batchSnap = snapshotMap.get(`${f.id}:batch`);
      const sanitizedIngredients = (f.ingredients || []).map((ing: any) => ({
        ...ing,
        line_cost: caller.hasCostAccess ? ing.line_cost : null,
        unit_rate: caller.hasCostAccess ? ing.unit_rate : null,
      }));

      return {
        ...f,
        ingredients: sanitizedIngredients,
        costing_status: batchSnap?.costing_status || 'UNCOSTED',
        batch_cost: caller.hasCostAccess ? (batchSnap?.batch_cost ?? null) : null,
        usable_batch_yield: batchSnap?.usable_batch_yield ?? f.batch_yield_quantity,
        usable_batch_unit: batchSnap?.usable_batch_unit ?? f.batch_yield_unit,
        ingredient_breakdown: caller.hasCostAccess ? (batchSnap?.ingredient_breakdown_json ?? []) : [],
      };
    });

    const maskedConfigurations = (dish.configurations || []).map((cfg: any) => {
      let servingCost: number | null = null;
      let cfgStatus = 'UNCOSTED';

      for (const f of dish.formulations || []) {
        const cfgSnap = snapshotMap.get(`${f.id}:${cfg.id}`);
        if (cfgSnap) {
          servingCost = cfgSnap.calculated_serving_cost;
          cfgStatus = cfgSnap.costing_status;
          break;
        }
      }

      return {
        ...cfg,
        costing_status: cfgStatus,
        serving_cost: caller.hasCostAccess ? servingCost : null,
      };
    });

    return NextResponse.json({
      dish: {
        ...dish,
        configurations: maskedConfigurations,
        formulations: maskedFormulations,
      },
      whereUsed: {
        formulations: whereUsedFormulations,
        combos: whereUsedCombos,
        menuItems: dish.menu_items || [],
      },
      hasCostAccess: caller.hasCostAccess,
    });
  } catch (err: any) {
    console.error('API GET /api/sops/dishes/[id] error:', err);
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
      return NextResponse.json({ error: 'Dish ID is required' }, { status: 400 });
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
      name,
      name_hi,
      category,
      description,
      is_active,
      default_formulation_id,
      configurations,
    } = body;

    const admin = createAdminClient();

    // 1. If default_formulation_id is being updated, call atomic RPC
    if (default_formulation_id !== undefined) {
      const { error: rpcErr } = await admin.rpc('fn_set_preparation_default_formulation_atomic', {
        p_dish_id: id,
        p_formulation_id: default_formulation_id,
      });

      if (rpcErr) {
        return NextResponse.json({ error: rpcErr.message }, { status: 400 });
      }
    }

    // 2. Update dish fields
    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updatePayload.name = name.trim();
    if (name_hi !== undefined) updatePayload.name_hi = name_hi?.trim() || null;
    if (description !== undefined) updatePayload.description = description?.trim() || null;
    if (is_active !== undefined) updatePayload.is_active = Boolean(is_active);
    if (category !== undefined) {
      updatePayload.category = category;
      updatePayload.is_preparation = category === 'PREPARATION';
    }

    const { data: updatedDish, error: updateErr } = await admin
      .from('yatra_canonical_dishes')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // 3. Upsert configurations if provided
    if (Array.isArray(configurations)) {
      for (const cfg of configurations) {
        if (cfg.id) {
          await admin
            .from('yatra_serving_configurations')
            .update({
              name: cfg.name?.trim(),
              name_hi: cfg.name_hi?.trim() || null,
              portion_size_quantity: Number(cfg.portion_size_quantity) || 0,
              portion_size_unit: cfg.portion_size_unit?.trim() || 'g',
              is_active: cfg.is_active !== undefined ? Boolean(cfg.is_active) : true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', cfg.id)
            .eq('canonical_dish_id', id);
        } else if (cfg.name?.trim()) {
          await admin.from('yatra_serving_configurations').insert({
            canonical_dish_id: id,
            name: cfg.name.trim(),
            name_hi: cfg.name_hi?.trim() || null,
            portion_size_quantity: Number(cfg.portion_size_quantity) || 0,
            portion_size_unit: cfg.portion_size_unit?.trim() || 'g',
            is_active: true,
          });
        }
      }
    }

    return NextResponse.json({ success: true, dish: updatedDish });
  } catch (err: any) {
    console.error('API PUT /api/sops/dishes/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Dish ID is required' }, { status: 400 });
    }

    const caller = await resolveCallerAuth(request);

    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!caller.canManageRecipes) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const admin = createAdminClient();

    // Verify dish exists
    const { data: dish, error: findErr } = await admin
      .from('yatra_canonical_dishes')
      .select('id, name')
      .eq('id', id)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!dish) {
      return NextResponse.json({ error: 'Canonical dish not found' }, { status: 404 });
    }

    // 1. Pre-flight check: active POS menu items linked to this dish
    const { data: linkedMenuItems } = await admin
      .from('pos_menu_items')
      .select('id, name, price')
      .eq('canonical_dish_id', id)
      .eq('is_active', true);

    // 2. Pre-flight check: active combo/thali compositions
    const { data: comboCompositions } = await admin
      .from('yatra_menu_item_compositions')
      .select('id, menu_item:pos_menu_items!yatra_menu_item_compositions_menu_item_id_fkey(id, name, is_active)')
      .eq('component_dish_id', id);

    const activeCombos = (comboCompositions || [])
      .filter((c: any) => c.menu_item && c.menu_item.is_active)
      .map((c: any) => ({ id: c.menu_item.id, name: c.menu_item.name }));

    // 3. Pre-flight check: parent formulations using this as sub-preparation
    const { data: parentFormIngredients } = await admin
      .from('yatra_recipe_formulation_ingredients')
      .select(`
        id,
        formulation:yatra_recipe_formulations!yatra_recipe_formulation_ingredients_formulation_id_fkey(
          id, name, is_active,
          canonical_dish:yatra_canonical_dishes!yatra_recipe_formulations_canonical_dish_id_fkey(id, name, is_active)
        )
      `)
      .eq('sub_preparation_dish_id', id);

    const activeParentFormulations = (parentFormIngredients || [])
      .filter((pi: any) => pi.formulation?.is_active && pi.formulation?.canonical_dish?.is_active)
      .map((pi: any) => ({
        formulationId: pi.formulation.id,
        formulationName: pi.formulation.name,
        dishName: pi.formulation.canonical_dish.name,
      }));

    const hasDependencies =
      (linkedMenuItems && linkedMenuItems.length > 0) ||
      activeCombos.length > 0 ||
      activeParentFormulations.length > 0;

    if (hasDependencies) {
      return NextResponse.json(
        {
          error: `Cannot delete or archive "${dish.name}": active dependencies exist. Please unlink all menu items, combo components, and parent formulations first.`,
          canDelete: false,
          dependencies: {
            menuItems: linkedMenuItems || [],
            combos: activeCombos,
            parentFormulations: activeParentFormulations,
          },
        },
        { status: 400 }
      );
    }

    // Safe to delete/archive:
    // Mark canonical dish inactive
    await admin
      .from('yatra_canonical_dishes')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    // Mark formulations inactive
    await admin
      .from('yatra_recipe_formulations')
      .update({ is_active: false })
      .eq('canonical_dish_id', id);

    // Mark serving configurations inactive
    await admin
      .from('yatra_serving_configurations')
      .update({ is_active: false })
      .eq('canonical_dish_id', id);

    // Sync legacy recipe if present
    await admin
      .from('yatra_recipes')
      .update({ is_active: false })
      .or(`id.eq.${id},name.eq.${dish.name}`);

    return NextResponse.json({
      success: true,
      message: `"${dish.name}" has been safely archived.`,
      archived: true,
    });
  } catch (err: any) {
    console.error('API DELETE /api/sops/dishes/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
