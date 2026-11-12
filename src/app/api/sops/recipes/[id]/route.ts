import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';
import { calculateAllRecipes, resolveAllGroupWacs, CostCalculationResult } from '@/lib/sops/costing';
import { getWhereUsedRecipes } from '@/lib/sops/recipes/where-used';
import { getUnitDimension, areUnitsCompatible } from '@/lib/sops/costing/units';

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

    // The full recipe graph is also the source for the selected recipe and its where-used parents.
    const [recipeRes, groupWacMap] = await Promise.all([
      admin
        .from('yatra_recipes')
        .select(`
          *,
          ingredients:yatra_recipe_ingredients!yatra_recipe_ingredients_recipe_id_fkey(
            *,
            ingredient_group:logical_ingredient_groups(id, name, name_hi, group_code, inventory_class, base_unit:units!logical_ingredient_groups_base_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
            inventory_item:inventory_items(id, name, name_hi, item_code, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
            sub_recipe:yatra_recipes!yatra_recipe_ingredients_sub_recipe_id_fkey(id, name, name_hi, category, batch_yield_quantity, batch_yield_unit)
          )
        `),
      resolveAllGroupWacs(admin),
    ]);

    if (recipeRes.error) throw recipeRes.error;

    const allRecipes = recipeRes.data || [];
    let recipe = allRecipes.find((candidate: any) => candidate.id === id);

    // If not found in yatra_recipes, check yatra_canonical_dishes
    let canonicalDishData: any = null;
    if (!recipe) {
      const { data: dishFound } = await admin
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
            )
          )
        `)
        .eq('id', id)
        .maybeSingle();

      if (dishFound) {
        canonicalDishData = dishFound;
        const defaultForm = dishFound.formulations?.find((f: any) => f.id === dishFound.default_formulation_id) || dishFound.formulations?.[0];
        const defaultCfg = dishFound.configurations?.[0];
        recipe = {
          id: dishFound.id,
          name: dishFound.name,
          name_hi: dishFound.name_hi,
          category: dishFound.category,
          batch_yield_quantity: defaultForm?.batch_yield_quantity || null,
          batch_yield_unit: defaultForm?.batch_yield_unit || null,
          portion_size_quantity: defaultCfg?.portion_size_quantity || null,
          portion_size_unit: defaultCfg?.portion_size_unit || null,
          instructions: defaultForm?.preparation_method || null,
          notes: dishFound.description || null,
          is_active: dishFound.is_active,
          ingredients: (defaultForm?.ingredients || []).map((fi: any) => ({
            id: fi.id,
            recipe_id: dishFound.id,
            ingredient_type: fi.ingredient_type,
            ingredient_group_id: fi.ingredient_group_id,
            inventory_item_id: fi.inventory_item_id,
            sub_recipe_id: fi.sub_preparation_dish_id,
            quantity: fi.quantity,
            unit: fi.unit,
            sort_order: fi.sort_order,
            notes: fi.notes,
            ingredient_group: fi.ingredient_group,
            inventory_item: fi.inventory_item,
            sub_recipe: fi.sub_preparation_dish ? {
              id: fi.sub_preparation_dish.id,
              name: fi.sub_preparation_dish.name,
              name_hi: fi.sub_preparation_dish.name_hi,
              category: fi.sub_preparation_dish.category,
            } : null,
          })),
        };
      }
    } else {
      // Find matching canonical dish if exists
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
            )
          )
        `)
        .ilike('name', recipe.name)
        .maybeSingle();

      if (matchedDish) {
        canonicalDishData = matchedDish;
      }
    }

    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    const calculationsMap = calculateAllRecipes(allRecipes, groupWacMap);
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

    const whereUsedRecipes = getWhereUsedRecipes(allRecipes, id, calculationsMap);
    const allTracedRecipeIds = [id, ...whereUsedRecipes.map((parent) => parent.id)];

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
      canonicalDish: canonicalDishData,
      calculation: sanitizedCalc,
      whereUsed: {
        recipes: whereUsedRecipes,
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

    // Helper to validate unit compatibility with active central master and engine
    const isValidUnit = async (u: string | null | undefined): Promise<boolean> => {
      if (!u) return true;
      const clean = u.trim();
      if (!clean) return true;
      if (getUnitDimension(clean) !== 'UNKNOWN') return true;
      const { data } = await admin
        .from('units')
        .select('id')
        .eq('symbol', clean)
        .eq('is_active', true)
        .maybeSingle();
      return Boolean(data);
    };

    if (batch_yield_unit && !(await isValidUnit(batch_yield_unit))) {
      return NextResponse.json({ error: `Invalid or unrecognized batch yield unit: '${batch_yield_unit}'` }, { status: 400 });
    }

    if (portion_size_unit && !(await isValidUnit(portion_size_unit))) {
      return NextResponse.json({ error: `Invalid or unrecognized portion size unit: '${portion_size_unit}'` }, { status: 400 });
    }

    if (Array.isArray(ingredients) && ingredients.length > 0) {
      for (let i = 0; i < ingredients.length; i++) {
        const ing = ingredients[i];
        if (!ing.unit || !(await isValidUnit(ing.unit))) {
          return NextResponse.json({ error: `Ingredient line ${i + 1} has an invalid or unrecognized unit: '${ing.unit || ''}'` }, { status: 400 });
        }
      }
    }

    // Validate costing compatibility whenever category, batch yield, or portion size changes
    const costingFieldProvided =
      category !== undefined ||
      batch_yield_quantity !== undefined ||
      batch_yield_unit !== undefined ||
      portion_size_quantity !== undefined ||
      portion_size_unit !== undefined;

    if (costingFieldProvided) {
      const { data: currentRecipe } = await admin
        .from('yatra_recipes')
        .select('category, portion_size_quantity, portion_size_unit, batch_yield_quantity, batch_yield_unit')
        .eq('id', id)
        .single();

      if (currentRecipe) {
        const curCat = currentRecipe.category;
        const targetCat = category !== undefined ? category : curCat;

        const effPortionQty = portion_size_quantity !== undefined ? (portion_size_quantity != null && portion_size_quantity !== '' ? Number(portion_size_quantity) : null) : currentRecipe.portion_size_quantity;
        const effPortionUnit = portion_size_unit !== undefined ? (portion_size_unit?.trim() || null) : currentRecipe.portion_size_unit;
        const effYieldQty = batch_yield_quantity !== undefined ? (batch_yield_quantity != null && batch_yield_quantity !== '' ? Number(batch_yield_quantity) : null) : currentRecipe.batch_yield_quantity;
        const effYieldUnit = batch_yield_unit !== undefined ? (batch_yield_unit?.trim() || null) : currentRecipe.batch_yield_unit;

        const categoryChanged = curCat !== targetCat;
        const yieldQtyChanged = effYieldQty !== currentRecipe.batch_yield_quantity;
        const yieldUnitChanged = effYieldUnit !== currentRecipe.batch_yield_unit;
        const portionQtyChanged = effPortionQty !== currentRecipe.portion_size_quantity;
        const portionUnitChanged = effPortionUnit !== currentRecipe.portion_size_unit;

        const costingChanged = categoryChanged || yieldQtyChanged || yieldUnitChanged || portionQtyChanged || portionUnitChanged;

        if (costingChanged) {
          // Fetch active dependencies
          const [parentsRes, variantsRes, combosRes] = await Promise.all([
            admin.from('yatra_recipe_ingredients').select('quantity, unit, yatra_recipes!recipe_id(name)').eq('sub_recipe_id', id),
            admin.from('yatra_menu_item_variants').select('id, variant_name, serving_quantity, serving_unit').eq('recipe_id', id).eq('is_active', true),
            admin.from('yatra_combo_components').select('id, component_name, portion_quantity, portion_unit, yatra_combos_thalis(name)').eq('recipe_id', id),
          ]);

          const parentIngredients = parentsRes.data || [];
          const parentCount = parentIngredients.length;
          const activeVariants = variantsRes.data || [];
          const comboComponents = combosRes.data || [];
          const variantCount = activeVariants.length;
          const comboCount = comboComponents.length;

          // DEPENDENCY 1: Parent Recipes
          if (parentCount > 0) {
            if (targetCat === 'FINAL_DISH') {
              return NextResponse.json({
                error: `Cannot change category to FINAL_DISH: recipe is referenced as a sub-recipe in ${parentCount} parent recipe(s). Remove sub-recipe references before changing category.`
              }, { status: 400 });
            }
            if (!effYieldQty || effYieldQty <= 0) {
              return NextResponse.json({
                error: `Cannot update batch yield: ${parentCount} parent recipe(s) depend on this recipe and require a positive batch yield quantity for sub-recipe costing.`
              }, { status: 400 });
            }
            if (!effYieldUnit) {
              return NextResponse.json({
                error: `Cannot remove batch yield unit: ${parentCount} parent recipe(s) depend on this recipe for sub-recipe costing.`
              }, { status: 400 });
            }
            if (yieldUnitChanged && effYieldUnit) {
              for (const parentIng of parentIngredients) {
                if (!areUnitsCompatible(parentIng.unit, effYieldUnit)) {
                  const pName = (parentIng.yatra_recipes as any)?.name || 'parent recipe';
                  return NextResponse.json({
                    error: `Cannot change batch yield unit to "${effYieldUnit}": parent recipe "${pName}" consumes this sub-recipe in "${parentIng.unit}" which cannot be converted to "${effYieldUnit}".`
                  }, { status: 400 });
                }
              }
            }
          }

          // DEPENDENCY 2: Active Menu Item Variants
          if (variantCount > 0) {
            if (['PREPARATION', 'COMBO_PORTION', 'BULK_CATERING'].includes(targetCat)) {
              if (!effYieldQty || effYieldQty <= 0 || !effYieldUnit) {
                return NextResponse.json({
                  error: `Cannot update recipe: category is ${targetCat} and recipe is linked to ${variantCount} active menu item variant(s), requiring finished batch yield quantity and unit for variant costing.`
                }, { status: 400 });
              }
            }

            for (const v of activeVariants) {
              const effVarQty = v.serving_quantity ?? effPortionQty;
              const effVarUnit = v.serving_unit || effPortionUnit;

              if (!effVarQty || effVarQty <= 0 || !effVarUnit) {
                return NextResponse.json({
                  error: `Cannot update costing specifications: active variant "${v.variant_name}" has no effective serving quantity or unit.`
                }, { status: 400 });
              }

              if (['PREPARATION', 'COMBO_PORTION', 'BULK_CATERING'].includes(targetCat)) {
                if (effYieldUnit && !areUnitsCompatible(effVarUnit, effYieldUnit)) {
                  return NextResponse.json({
                    error: `Cannot update recipe: active variant "${v.variant_name}" uses effective serving unit "${effVarUnit}" which cannot be converted to the recipe finished batch yield unit "${effYieldUnit}".`
                  }, { status: 400 });
                }
              } else if (targetCat === 'FINAL_DISH') {
                if (effYieldUnit && !areUnitsCompatible(effVarUnit, effYieldUnit)) {
                  return NextResponse.json({
                    error: `Cannot update recipe: active variant "${v.variant_name}" uses effective serving unit "${effVarUnit}" which cannot be converted to recipe batch yield unit "${effYieldUnit}".`
                  }, { status: 400 });
                }
              }
            }
          }

          // DEPENDENCY 3: Combo / Thali Components
          if (comboCount > 0) {
            if (['PREPARATION', 'COMBO_PORTION', 'BULK_CATERING'].includes(targetCat)) {
              if (!effYieldQty || effYieldQty <= 0 || !effYieldUnit) {
                return NextResponse.json({
                  error: `Cannot update recipe: category is ${targetCat} and recipe is linked to ${comboCount} combo/thali component(s), requiring finished batch yield quantity and unit for component costing.`
                }, { status: 400 });
              }
              for (const comp of comboComponents) {
                if (effYieldUnit && !areUnitsCompatible(comp.portion_unit, effYieldUnit)) {
                  const cName = (comp.yatra_combos_thalis as any)?.name || 'combo';
                  return NextResponse.json({
                    error: `Cannot update recipe: combo/thali component "${comp.component_name}" in "${cName}" uses portion unit "${comp.portion_unit}" which cannot be converted to the recipe batch yield unit "${effYieldUnit}".`
                  }, { status: 400 });
                }
              }
            } else if (targetCat === 'FINAL_DISH') {
              if (!effPortionQty || effPortionQty <= 0 || !effPortionUnit) {
                return NextResponse.json({
                  error: 'Cannot update FINAL_DISH recipe: recipe requires a positive portion size quantity and valid portion size unit.'
                }, { status: 400 });
              }
              for (const comp of comboComponents) {
                const compDim = getUnitDimension(comp.portion_unit);
                if (compDim !== 'COUNT' && !areUnitsCompatible(comp.portion_unit, effPortionUnit)) {
                  const cName = (comp.yatra_combos_thalis as any)?.name || 'combo';
                  return NextResponse.json({
                    error: `Cannot update recipe: combo/thali component "${comp.component_name}" in "${cName}" uses portion unit "${comp.portion_unit}" which is incompatible with the recipe portion unit "${effPortionUnit}".`
                  }, { status: 400 });
                }
              }
            }
          }

          if (targetCat === 'FINAL_DISH' && (!effPortionQty || effPortionQty <= 0 || !effPortionUnit)) {
            return NextResponse.json({
              error: 'Cannot update FINAL_DISH recipe: recipe requires a positive portion size quantity and valid portion size unit.'
            }, { status: 400 });
          }
        }
      }
    }

    // Build partial header update payload
    const updateHeader: Record<string, any> = {};
    if (name !== undefined) updateHeader.name = name.trim();
    if (name_hi !== undefined) updateHeader.name_hi = name_hi?.trim() || null;
    if (category !== undefined) updateHeader.category = category;
    if (batch_yield_quantity !== undefined)
      updateHeader.batch_yield_quantity = batch_yield_quantity != null && batch_yield_quantity !== '' ? Number(batch_yield_quantity) : null;
    if (batch_yield_unit !== undefined) updateHeader.batch_yield_unit = batch_yield_unit?.trim() || null;
    if (portion_size_quantity !== undefined)
      updateHeader.portion_size_quantity = portion_size_quantity != null && portion_size_quantity !== '' ? Number(portion_size_quantity) : null;
    if (portion_size_unit !== undefined) updateHeader.portion_size_unit = portion_size_unit?.trim() || null;
    if (instructions !== undefined) updateHeader.instructions = instructions;
    if (notes !== undefined) updateHeader.notes = notes;
    if (is_active !== undefined) updateHeader.is_active = Boolean(is_active);

    // Call atomic transactional function
    const { data: updatedRecipe, error: rpcErr } = await admin.rpc('fn_sync_yatra_recipe_atomic', {
      p_recipe_id: id,
      p_header: updateHeader,
      p_ingredients: Array.isArray(ingredients) ? ingredients : null,
    });

    if (rpcErr) {
      const msg = rpcErr.message || 'Database error during recipe update';
      if (
        msg.includes('Cannot change category') ||
        msg.includes('Invalid') ||
        msg.includes('requires') ||
        msg.includes('cannot specify') ||
        msg.includes('strictly greater than 0') ||
        msg.includes('missing') ||
        msg.includes('cycle')
      ) {
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      throw rpcErr;
    }

    return NextResponse.json({ success: true, recipe: updatedRecipe });
  } catch (err: any) {
    console.error('API PUT /api/sops/recipes/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
