import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';
import { calculateAllRecipes, resolveAllGroupWacs, CostCalculationResult } from '@/lib/sops/costing';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Recipe ID is required' }, { status: 400 });
    }

    const caller = await resolveCallerAuth(request);

    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!caller.canViewRecipes) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const admin = createAdminClient();

    // 1. Fetch the target recipe with ingredients
    const { data: recipe, error: recErr } = await admin
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
      .eq('id', id)
      .maybeSingle();

    if (recErr) throw recErr;
    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    // 2. Fetch full DAG to compute cost breakdown
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
    const calculationsMap = calculateAllRecipes(allRecipes || [], groupWacMap);
    const calc = calculationsMap.get(id) || ({
      recipe,
      totalBatchCost: null,
      costPerOutputUnit: null,
      output_unit: recipe.batch_yield_unit || null,
      costPerServing: null,
      serving_unit: recipe.portion_size_unit || null,
      servingsPerBatch: null,
      status: 'UNCOSTED',
      reasons: [],
      ingredientLineCosts: [],
    } as CostCalculationResult);

    // 3. Fetch transitive where-used dependencies (cycle-safe, max depth 10)
    const visitedRecipeIds = new Set<string>([id]);
    let frontierRecipeIds = [id];
    const parentRecipeMap = new Map<string, any>();

    for (let depth = 1; depth <= 10 && frontierRecipeIds.length > 0; depth++) {
      const { data: parentRows, error: parentErr } = await admin
        .from('yatra_recipe_ingredients')
        .select(`
          quantity,
          unit,
          sub_recipe_id,
          recipe:yatra_recipes!yatra_recipe_ingredients_recipe_id_fkey(id, name, name_hi, category, batch_yield_quantity, batch_yield_unit)
        `)
        .in('sub_recipe_id', frontierRecipeIds)
        .eq('ingredient_type', 'PREPARATION');

      if (parentErr) throw parentErr;

      const nextFrontier: string[] = [];
      for (const row of parentRows || []) {
        const pRec = row.recipe as any;
        if (pRec && !visitedRecipeIds.has(pRec.id)) {
          visitedRecipeIds.add(pRec.id);
          nextFrontier.push(pRec.id);
          parentRecipeMap.set(pRec.id, {
            id: pRec.id,
            name: pRec.name,
            name_hi: pRec.name_hi,
            category: pRec.category,
            depth,
            quantity: row.quantity,
            unit: row.unit,
            status: calculationsMap.get(pRec.id)?.status || 'UNCOSTED',
            costing_status: calculationsMap.get(pRec.id)?.status || 'UNCOSTED',
          });
        }
      }
      frontierRecipeIds = nextFrontier;
    }

    const allTracedRecipeIds = Array.from(visitedRecipeIds);

    // Fetch linked menu item variants and combos for all traced recipes (including self)
    const [variantRes, comboRes] = await Promise.all([
      admin
        .from('yatra_menu_item_variants')
        .select(`
          id,
          variant_name,
          recipe_id,
          is_default,
          default_service_channel,
          menu_item:pos_menu_items(id, name, name_hi, price, category, parent_category)
        `)
        .in('recipe_id', allTracedRecipeIds)
        .eq('is_active', true),

      admin
        .from('yatra_combo_components')
        .select(`
          id,
          component_name,
          recipe_id,
          portion_quantity,
          portion_unit,
          combo:yatra_combos_thalis!yatra_combo_components_combo_thali_id_fkey(id, name, name_hi, product_type, selling_price, is_active)
        `)
        .in('recipe_id', allTracedRecipeIds),
    ]);

    // 4. Sanitize / mask cost data if unauthorized
    const sanitizedCalc = caller.hasCostAccess
      ? calc
      : {
          ...calc,
          totalBatchCost: null,
          costPerOutputUnit: null,
          costPerServing: null,
          ingredientLineCosts: (calc.ingredientLineCosts || []).map((line) => ({
            ...line,
            lineCost: null,
            unitRate: null,
          })),
        };

    return NextResponse.json({
      recipe,
      calculation: sanitizedCalc,
      whereUsed: {
        recipes: Array.from(parentRecipeMap.values()),
        menuItems: (variantRes.data || [])
          .filter((v: any) => v.menu_item)
          .map((v: any) => ({
            variantId: v.id,
            variantName: v.variant_name,
            recipeId: v.recipe_id,
            isDefault: v.is_default,
            channel: v.default_service_channel,
            menuItemId: v.menu_item?.id,
            menuItemName: v.menu_item?.name,
            menuItemNameHi: v.menu_item?.name_hi,
            price: v.menu_item?.price,
            category: v.menu_item?.category,
            parentCategory: v.menu_item?.parent_category,
          })),
        combos: (comboRes.data || [])
          .filter((c: any) => c.combo && c.combo.is_active !== false)
          .map((c: any) => ({
            id: c.combo?.id,
            name: c.combo?.name,
            name_hi: c.combo?.name_hi,
            recipeId: c.recipe_id,
            productType: c.combo?.product_type,
            sellingPrice: c.combo?.selling_price,
            componentName: c.component_name,
            portionQuantity: c.portion_quantity,
            portionUnit: c.portion_unit,
          })),
      },
      hasCostAccess: caller.hasCostAccess,
    });
  } catch (err: any) {
    console.error('API GET /api/sops/recipes/[id] error:', err);
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
      return NextResponse.json({ error: 'Recipe ID is required' }, { status: 400 });
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
      batch_yield_quantity,
      batch_yield_unit,
      portion_size_quantity,
      portion_size_unit,
      instructions,
      notes,
      is_active,
      ingredients,
    } = body;

    const admin = createAdminClient();

    // 1. Update recipe header
    const updatePayload: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updatePayload.name = name.trim();
    if (name_hi !== undefined) updatePayload.name_hi = name_hi?.trim() || null;
    if (category !== undefined) updatePayload.category = category;
    if (batch_yield_quantity !== undefined)
      updatePayload.batch_yield_quantity = batch_yield_quantity ? Number(batch_yield_quantity) : null;
    if (batch_yield_unit !== undefined) updatePayload.batch_yield_unit = batch_yield_unit?.trim() || null;
    if (portion_size_quantity !== undefined)
      updatePayload.portion_size_quantity = portion_size_quantity ? Number(portion_size_quantity) : null;
    if (portion_size_unit !== undefined) updatePayload.portion_size_unit = portion_size_unit?.trim() || null;
    if (instructions !== undefined) updatePayload.instructions = instructions;
    if (notes !== undefined) updatePayload.notes = notes;
    if (is_active !== undefined) updatePayload.is_active = Boolean(is_active);

    const { data: updatedRecipe, error: updateErr } = await admin
      .from('yatra_recipes')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // 2. Synchronize ingredients if provided
    if (Array.isArray(ingredients)) {
      // Remove previous ingredients for this recipe
      const { error: delErr } = await admin
        .from('yatra_recipe_ingredients')
        .delete()
        .eq('recipe_id', id);

      if (delErr) throw delErr;

      if (ingredients.length > 0) {
        const rows = ingredients.map((ing: any, idx: number) => ({
          recipe_id: id,
          ingredient_type: ing.ingredient_type,
          ingredient_group_id: ing.ingredient_type === 'RAW_MATERIAL' ? ing.ingredient_group_id : null,
          inventory_item_id: ing.ingredient_type === 'RAW_MATERIAL' ? ing.inventory_item_id || null : null,
          sub_recipe_id: ing.ingredient_type === 'PREPARATION' ? ing.sub_recipe_id : null,
          quantity: Number(ing.quantity),
          unit: ing.unit,
          sort_order: ing.sort_order ?? idx + 1,
          notes: ing.notes || null,
        }));

        const { error: insErr } = await admin.from('yatra_recipe_ingredients').insert(rows);
        if (insErr) throw insErr;
      }
    }

    return NextResponse.json({ success: true, recipe: updatedRecipe });
  } catch (err: any) {
    console.error('API PUT /api/sops/recipes/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
