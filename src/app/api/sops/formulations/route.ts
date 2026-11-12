import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';
import { resolveAllGroupWacs, calculateServingConfigurationCost } from '@/lib/sops/costing';
import { convertDirectQuantity } from '@/lib/sops/costing/units';

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
      canonical_dish_id,
      name,
      batch_yield_quantity,
      batch_yield_unit,
      pre_cooking_input_quantity,
      pre_cooking_input_unit,
      preparation_method,
      culinary_notes,
      ingredients = [],
    } = body;

    if (!canonical_dish_id) {
      return NextResponse.json({ error: 'canonical_dish_id is required' }, { status: 400 });
    }

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Formulation name is required' }, { status: 400 });
    }

    const admin = createAdminClient();

    // 1. Validate canonical dish exists
    const { data: dish, error: dishErr } = await admin
      .from('yatra_canonical_dishes')
      .select('id, name, is_preparation, category')
      .eq('id', canonical_dish_id)
      .single();

    if (dishErr || !dish) {
      return NextResponse.json({ error: 'Canonical dish not found' }, { status: 404 });
    }

    // 2. Build header
    const header = {
      batch_yield_quantity: batch_yield_quantity ? Number(batch_yield_quantity) : null,
      batch_yield_unit: batch_yield_unit?.trim() || null,
      pre_cooking_input_quantity: pre_cooking_input_quantity ? Number(pre_cooking_input_quantity) : null,
      pre_cooking_input_unit: pre_cooking_input_unit?.trim() || null,
      preparation_method: preparation_method || null,
      culinary_notes: culinary_notes || null,
    };

    // 3. Format ingredients array
    const formattedIngredients = (ingredients || []).map((ing: any, idx: number) => ({
      ingredient_type: ing.ingredient_type || 'RAW_MATERIAL',
      ingredient_group_id: ing.ingredient_type === 'PREPARATION' ? null : (ing.ingredient_group_id || null),
      inventory_item_id: ing.ingredient_type === 'PREPARATION' ? null : (ing.inventory_item_id || null),
      sub_preparation_dish_id: ing.ingredient_type === 'PREPARATION' ? (ing.sub_preparation_dish_id || null) : null,
      sub_preparation_formulation_id: ing.ingredient_type === 'PREPARATION' ? (ing.sub_preparation_formulation_id || null) : null,
      quantity: Number(ing.quantity) || 0,
      unit: ing.unit?.trim() || 'g',
      sort_order: ing.sort_order ?? idx + 1,
      notes: ing.notes || null,
    }));

    // 4. Calculate costing payload
    let costingPayload: any = null;
    try {
      const groupWacMap = await resolveAllGroupWacs(admin);
      let totalBatchCost: number | null = 0;
      let isEligible = true;
      let isUncosted = false;
      const ingredientBreakdown: any[] = [];

      for (const ing of formattedIngredients) {
        if (ing.ingredient_type === 'RAW_MATERIAL') {
          if (!ing.ingredient_group_id) {
            isEligible = false;
            totalBatchCost = null;
            break;
          }
          const wac = groupWacMap.get(ing.ingredient_group_id);
          if (wac && wac.isCosted && wac.wac !== null && wac.wac > 0) {
            const conv = convertDirectQuantity(ing.quantity, ing.unit, wac.baseUnitSymbol);
            if (conv.possible && conv.converted !== undefined) {
              const lineCost = conv.converted * wac.wac;
              if (totalBatchCost !== null) totalBatchCost += lineCost;
              ingredientBreakdown.push({
                ingredient_group_id: ing.ingredient_group_id,
                quantity: ing.quantity,
                unit: ing.unit,
                unit_rate: wac.wac,
                line_cost: Math.round(lineCost * 100) / 100,
              });
            } else {
              isEligible = false;
              totalBatchCost = null;
              break;
            }
          } else {
            isUncosted = true;
            totalBatchCost = null;
          }
        }
      }

      const yieldQty = header.batch_yield_quantity;
      const yieldUnit = header.batch_yield_unit;

      let status = 'UNCOSTED';
      if (!yieldQty || yieldQty <= 0 || !yieldUnit || formattedIngredients.length === 0) {
        status = 'COSTING_INCOMPLETE';
        totalBatchCost = null;
      } else if (isUncosted) {
        status = 'UNCOSTED';
        totalBatchCost = null;
      } else if (isEligible && totalBatchCost !== null) {
        status = 'COSTED_ELIGIBLE';
      }

      costingPayload = {
        batch_snapshot: {
          costing_status: status,
          batch_cost: totalBatchCost != null ? Math.round(totalBatchCost * 100) / 100 : null,
          usable_batch_yield: yieldQty,
          usable_batch_unit: yieldUnit,
          resolved_sub_preparations: [],
          ingredient_breakdown: ingredientBreakdown,
        },
        serving_snapshots: [],
      };
    } catch (calcErr) {
      console.warn('Costing payload calculation failed, proceeding without snapshot:', calcErr);
      costingPayload = null;
    }

    // 5. Call atomic creation RPC
    const { data: rpcRes, error: rpcErr } = await admin.rpc('fn_create_yatra_recipe_formulation_atomic', {
      p_canonical_dish_id: canonical_dish_id,
      p_name: name.trim(),
      p_header: header,
      p_ingredients: formattedIngredients,
      p_costing_payload: costingPayload,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...rpcRes }, { status: 201 });
  } catch (err: any) {
    console.error('API POST /api/sops/formulations error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
