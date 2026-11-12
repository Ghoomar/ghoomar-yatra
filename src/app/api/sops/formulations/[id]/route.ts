import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';
import { resolveAllGroupWacs } from '@/lib/sops/costing';
import { convertDirectQuantity } from '@/lib/sops/costing/units';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Formulation ID is required' }, { status: 400 });
    }

    const caller = await resolveCallerAuth(request);

    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!caller.canViewRecipes) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const admin = createAdminClient();

    const { data: formulation, error: formErr } = await admin
      .from('yatra_recipe_formulations')
      .select(`
        *,
        canonical_dish:yatra_canonical_dishes!yatra_recipe_formulations_canonical_dish_id_fkey(
          id, name, name_hi, slug, category, is_preparation, default_formulation_id,
          configurations:yatra_serving_configurations(*)
        ),
        ingredients:yatra_recipe_formulation_ingredients(
          *,
          ingredient_group:logical_ingredient_groups(id, name, name_hi, group_code, inventory_class, base_unit:units!logical_ingredient_groups_base_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
          inventory_item:inventory_items(id, name, name_hi, item_code, unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi)),
          sub_preparation_dish:yatra_canonical_dishes!yatra_recipe_formulation_ingredients_sub_preparation_dish_id_fkey(id, name, name_hi, category, is_preparation)
        ),
        config_links:yatra_configuration_formulations(
          *,
          serving_configuration:yatra_serving_configurations(*)
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (formErr) throw formErr;
    if (!formulation) {
      return NextResponse.json({ error: 'Formulation not found' }, { status: 404 });
    }

    // Costing snapshot
    const { data: snapshots } = await admin
      .from('yatra_costing_snapshots')
      .select('*')
      .eq('formulation_id', id)
      .order('created_at', { ascending: false });

    const batchSnap = (snapshots || []).find((s) => s.serving_configuration_id === null);

    const sanitizedIngredients = (formulation.ingredients || []).map((ing: any) => ({
      ...ing,
      line_cost: caller.hasCostAccess ? ing.line_cost : null,
      unit_rate: caller.hasCostAccess ? ing.unit_rate : null,
    }));

    return NextResponse.json({
      formulation: {
        ...formulation,
        ingredients: sanitizedIngredients,
        costing_status: batchSnap?.costing_status || 'UNCOSTED',
        batch_cost: caller.hasCostAccess ? (batchSnap?.batch_cost ?? null) : null,
        usable_batch_yield: batchSnap?.usable_batch_yield ?? formulation.batch_yield_quantity,
        usable_batch_unit: batchSnap?.usable_batch_unit ?? formulation.batch_yield_unit,
        ingredient_breakdown: caller.hasCostAccess ? (batchSnap?.ingredient_breakdown_json ?? []) : [],
      },
      hasCostAccess: caller.hasCostAccess,
    });
  } catch (err: any) {
    console.error('API GET /api/sops/formulations/[id] error:', err);
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
      return NextResponse.json({ error: 'Formulation ID is required' }, { status: 400 });
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
      batch_yield_quantity,
      batch_yield_unit,
      pre_cooking_input_quantity,
      pre_cooking_input_unit,
      preparation_method,
      culinary_notes,
      is_active,
      ingredients,
    } = body;

    const admin = createAdminClient();

    // 1. Build partial header
    const header: Record<string, any> = {};
    if (name !== undefined) header.name = name.trim();
    if (batch_yield_quantity !== undefined)
      header.batch_yield_quantity = batch_yield_quantity != null && batch_yield_quantity !== '' ? Number(batch_yield_quantity) : null;
    if (batch_yield_unit !== undefined) header.batch_yield_unit = batch_yield_unit?.trim() || null;
    if (pre_cooking_input_quantity !== undefined)
      header.pre_cooking_input_quantity = pre_cooking_input_quantity != null && pre_cooking_input_quantity !== '' ? Number(pre_cooking_input_quantity) : null;
    if (pre_cooking_input_unit !== undefined) header.pre_cooking_input_unit = pre_cooking_input_unit?.trim() || null;
    if (preparation_method !== undefined) header.preparation_method = preparation_method;
    if (culinary_notes !== undefined) header.culinary_notes = culinary_notes;
    if (is_active !== undefined) header.is_active = Boolean(is_active);

    // 2. Format ingredients if provided
    let formattedIngredients: any = null;
    if (Array.isArray(ingredients)) {
      formattedIngredients = ingredients.map((ing: any, idx: number) => ({
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
    }

    // 3. Compute costing payload
    let costingPayload: any = null;
    try {
      if (formattedIngredients) {
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
      }
    } catch (calcErr) {
      console.warn('Costing payload calculation failed, continuing without snapshot:', calcErr);
      costingPayload = null;
    }

    // 4. Call atomic sync RPC
    const { data: rpcRes, error: rpcErr } = await admin.rpc('fn_sync_yatra_recipe_formulation_atomic', {
      p_formulation_id: id,
      p_header: Object.keys(header).length > 0 ? header : null,
      p_ingredients: formattedIngredients,
      p_costing_payload: costingPayload,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...rpcRes });
  } catch (err: any) {
    console.error('API PUT /api/sops/formulations/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
