import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';
import { calculateAllRecipes, resolveAllGroupWacs, CostCalculationResult, CostingStatus } from '@/lib/sops/costing';

export async function GET(request: NextRequest) {
  try {
    const caller = await resolveCallerAuth(request);

    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!caller.canViewRecipes) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const categoryFilter = searchParams.get('category');
    const statusFilter = searchParams.get('status') as CostingStatus | null;
    const searchTerm = searchParams.get('search')?.toLowerCase().trim();

    const admin = createAdminClient();

    // 1. Fetch all recipes and ingredients
    const { data: recipes, error: recErr } = await admin
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
      .order('name');

    if (recErr) throw recErr;

    // 2. Resolve group WAC rates and calculate multi-tier DAG costs
    const groupWacMap = await resolveAllGroupWacs(admin);
    const calculationMap = calculateAllRecipes(recipes || [], groupWacMap);

    // 3. Assemble and mask outputs based on permissions
    const assembled = (recipes || []).map((recipe) => {
      const calc = calculationMap.get(recipe.id) || ({
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

      const sanitizedLineCosts = (calc.ingredientLineCosts || []).map((line) => {
        if (caller.hasCostAccess) return line;
        return {
          ...line,
          lineCost: null,
          unitRate: null,
        };
      });

      return {
        ...recipe,
        costing_status: calc.status,
        costing_reasons: calc.reasons,
        total_batch_cost: caller.hasCostAccess ? calc.totalBatchCost : null,
        cost_per_output_unit: caller.hasCostAccess ? calc.costPerOutputUnit : null,
        cost_per_serving: caller.hasCostAccess ? calc.costPerServing : null,
        servings_per_batch: calc.servingsPerBatch,
        ingredient_line_costs: sanitizedLineCosts,
      };
    });

    // 4. Apply optional filters
    const filtered = assembled.filter((r) => {
      if (categoryFilter && categoryFilter !== 'ALL' && r.category !== categoryFilter) {
        return false;
      }
      if (statusFilter && r.costing_status !== statusFilter) {
        return false;
      }
      if (searchTerm) {
        const nameMatch = r.name?.toLowerCase().includes(searchTerm);
        const nameHiMatch = r.name_hi?.toLowerCase().includes(searchTerm);
        if (!nameMatch && !nameHiMatch) return false;
      }
      return true;
    });

    return NextResponse.json({
      recipes: filtered,
      totalCount: assembled.length,
      filteredCount: filtered.length,
      hasCostAccess: caller.hasCostAccess,
    });
  } catch (err: any) {
    console.error('API GET /api/sops/recipes error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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
      ingredients,
    } = body;

    if (!name || !category) {
      return NextResponse.json({ error: 'Recipe name and category are required' }, { status: 400 });
    }

    const validCategories = ['PREPARATION', 'FINAL_DISH', 'COMBO_PORTION', 'BULK_CATERING'];
    if (!validCategories.includes(category)) {
      return NextResponse.json({ error: `Invalid category: ${category}` }, { status: 400 });
    }

    const admin = createAdminClient();

    // Insert recipe header
    const { data: recipe, error: insertErr } = await admin
      .from('yatra_recipes')
      .insert({
        name: name.trim(),
        name_hi: name_hi?.trim() || null,
        category,
        batch_yield_quantity: batch_yield_quantity ? Number(batch_yield_quantity) : null,
        batch_yield_unit: batch_yield_unit?.trim() || null,
        portion_size_quantity: portion_size_quantity ? Number(portion_size_quantity) : null,
        portion_size_unit: portion_size_unit?.trim() || null,
        instructions: instructions || null,
        notes: notes || null,
        is_active: true,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Insert recipe ingredients if provided
    if (Array.isArray(ingredients) && ingredients.length > 0) {
      const rows = ingredients.map((ing: any, idx: number) => ({
        recipe_id: recipe.id,
        ingredient_type: ing.ingredient_type,
        ingredient_group_id: ing.ingredient_type === 'RAW_MATERIAL' ? ing.ingredient_group_id : null,
        inventory_item_id: ing.ingredient_type === 'RAW_MATERIAL' ? ing.inventory_item_id || null : null,
        sub_recipe_id: ing.ingredient_type === 'PREPARATION' ? ing.sub_recipe_id : null,
        quantity: Number(ing.quantity),
        unit: ing.unit,
        sort_order: ing.sort_order ?? idx + 1,
        notes: ing.notes || null,
      }));

      const { error: ingErr } = await admin.from('yatra_recipe_ingredients').insert(rows);
      if (ingErr) throw ingErr;
    }

    return NextResponse.json({ success: true, recipe }, { status: 201 });
  } catch (err: any) {
    console.error('API POST /api/sops/recipes error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
