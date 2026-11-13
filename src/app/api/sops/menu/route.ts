import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';
import {
  calculateAllRecipes,
  calculateComboThaliCost,
  calculateMenuEngineeringMatrix,
  calculateVariantCost,
  RawMenuItemForMatrix,
  resolveAllGroupWacs,
} from '@/lib/sops/costing';
import { menuSalesCostChannel, parseMenuSalesChannel } from '@/lib/sales/menu-channels';
import { calculateSalesWeightedVariantCost } from '@/lib/sops/costing/channel-mix';
import type { CostCalculationResult, ServiceChannel, YatraComboThali } from '@/lib/sops/costing/types';

const COMBO_SELECT = `
  *,
  components:yatra_combo_components(
    *,
    recipe:yatra_recipes(*),
    variant:yatra_menu_item_variants(*)
  )
`;

function fetchActiveCombos(admin: ReturnType<typeof createAdminClient>) {
  return admin
    .from('yatra_combos_thalis')
    .select(COMBO_SELECT)
    .eq('is_active', true);
}

function calculateCombos(
  comboRows: YatraComboThali[] | null,
  recipeCalcs: Map<string, CostCalculationResult>,
  costingChannel: ServiceChannel | undefined,
  hasCostAccess: boolean
) {
  return (comboRows || []).map((combo) => {
    const cCost = calculateComboThaliCost(combo, recipeCalcs, costingChannel);
    if (hasCostAccess) return cCost;

    return {
      ...cCost,
      total_food_cost: null,
      food_cost: null,
      food_cost_pct: null,
      operating_cost: null,
      packaging_cost: null,
      total_cost: null,
      margin_amount: null,
      contribution_amount: null,
      contribution_pct: null,
      gas_cost: null,
      other_operating_cost: null,
      packaging_cost_dine_in: null,
      packaging_cost_takeaway: null,
      components: (cCost.components || []).map((comp: any) => ({
        ...comp,
        food_cost: null,
        unit_rate: null,
        recipe: comp.recipe
          ? {
              ...comp.recipe,
              total_batch_cost: null,
              cost_per_output_unit: null,
              cost_per_serving: null,
              ingredients: (comp.recipe.ingredients || []).map((ing: any) => ({
                ...ing,
                line_cost: null,
                unit_rate: null,
              })),
            }
          : null,
        variant: comp.variant
          ? {
              ...comp.variant,
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
            }
          : null,
      })),
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const caller = await resolveCallerAuth(request);

    if (!caller.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!caller.canViewMenu) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const channel = parseMenuSalesChannel(searchParams.get('channel') || 'ALL');
    const view = searchParams.get('view');
    if (!channel) {
      return NextResponse.json({ error: 'Unsupported menu sales channel.' }, { status: 400 });
    }
    const costingChannel = menuSalesCostChannel(channel);
    const categoryFilter = searchParams.get('category');
    const parentCategoryFilter = searchParams.get('parent_category');

    const admin = createAdminClient();

    if (view === 'combos') {
      const [recipeRes, comboRes, groupWacMap] = await Promise.all([
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
        fetchActiveCombos(admin),
        resolveAllGroupWacs(admin),
      ]);

      if (recipeRes.error) throw recipeRes.error;
      if (comboRes.error) throw comboRes.error;

      const recipeCalcs = calculateAllRecipes(recipeRes.data || [], groupWacMap);
      const combos = calculateCombos(comboRes.data, recipeCalcs, costingChannel, caller.hasCostAccess);

      return NextResponse.json({ combos, channel, hasCostAccess: caller.hasCostAccess });
    }

    const includeCombos = true;

    // Sales aggregation, menu data, and WAC resolution are independent database reads.
    // Start them together so the sales scan does not wait for recipe calculations.
    const [menuRes, variantRes, recipeRes, comboRes, salesRes, groupWacMap] = await Promise.all([
      admin
        .from('pos_menu_items')
        .select('*')
        .order('name'),
      admin
        .from('yatra_menu_item_variants')
        .select('*')
        .eq('is_active', true),
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
      fetchActiveCombos(admin),
      admin.rpc('get_menu_sales_aggregation', {
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_channel: channel,
      }),
      resolveAllGroupWacs(admin),
    ]);

    if (menuRes.error) throw menuRes.error;
    if (variantRes.error) throw variantRes.error;
    if (recipeRes.error) throw recipeRes.error;
    if (comboRes.error) throw comboRes.error;
    if (salesRes.error) throw salesRes.error;

    // 2. Resolve WAC and DAG calculations + combos
    const recipeCalcs = calculateAllRecipes(recipeRes.data || [], groupWacMap);
    const calculatedCombos = calculateCombos(comboRes.data, recipeCalcs, costingChannel, caller.hasCostAccess);
    const comboMap = new Map<string, any>();
    calculatedCombos.forEach((c) => {
      if (c.id) comboMap.set(c.id, c);
      if (c.name) comboMap.set(c.name.trim().toLowerCase(), c);
    });

    // 3. Index the already-fetched sales aggregation for the menu and BCG calculations.
    const salesMap = new Map<string, {
      unitsSold: number;
      netRevenue: number;
      channelUnits: { dineIn: number; takeaway: number; homeDelivery: number; lancho: number; unknown: number };
    }>();
    (salesRes.data || []).forEach((row: any) => {
      salesMap.set(row.menu_item_id, {
        unitsSold: Number(row.units_sold) || 0,
        netRevenue: Number(row.net_sales) || 0,
        channelUnits: {
          dineIn: Number(row.units_dine_in) || 0,
          takeaway: Number(row.units_takeaway) || 0,
          homeDelivery: Number(row.units_home_delivery) || 0,
          lancho: Number(row.units_lancho) || 0,
          unknown: Number(row.units_unknown) || 0,
        },
      });
    });
    // 4. Map variants by menu_item_id
    const variantsByMenuItem = new Map<string, any[]>();
    (variantRes.data || []).forEach((v) => {
      const arr = variantsByMenuItem.get(v.menu_item_id) || [];
      arr.push(v);
      variantsByMenuItem.set(v.menu_item_id, arr);
    });
    // 5. Preprocess items and prepare matrix inputs
    const matrixInputs: RawMenuItemForMatrix[] = [];
    const preprocessedItems = (menuRes.data || []).map((item) => {
      const itemVariants = variantsByMenuItem.get(item.id) || [];
      const defaultVariant =
        itemVariants.find((v) => v.is_default) || (itemVariants.length > 0 ? itemVariants[0] : null);
      const sales = salesMap.get(item.id) || {
        unitsSold: 0,
        netRevenue: 0,
        channelUnits: { dineIn: 0, takeaway: 0, homeDelivery: 0, lancho: 0, unknown: 0 },
      };

      let defaultVariantCalc: any = null;
      const enrichedVariants = itemVariants.map((v) => {
        const rCalc = recipeCalcs.get(v.recipe_id);
        let vCalc: any = null;
        if (rCalc) {
          const variantWithMenuItem = { ...v, menu_item: item };
          if (channel === 'ALL') {
            const dineInCalc = calculateVariantCost(variantWithMenuItem, rCalc, 'DINE_IN');
            const takeawayCalc = calculateVariantCost(variantWithMenuItem, rCalc, 'TAKEAWAY');
            const defaultCalc = calculateVariantCost(variantWithMenuItem, rCalc);
            vCalc = calculateSalesWeightedVariantCost([
              { units: sales.channelUnits.dineIn, variant: dineInCalc },
              { units: sales.channelUnits.takeaway + sales.channelUnits.homeDelivery, variant: takeawayCalc },
              { units: sales.channelUnits.lancho + sales.channelUnits.unknown, variant: defaultCalc },
            ], defaultCalc);
          } else {
            vCalc = calculateVariantCost(variantWithMenuItem, rCalc, costingChannel);
          }
        }
        if (defaultVariant && v.id === defaultVariant.id) {
          defaultVariantCalc = vCalc;
        }

        if (!caller.hasCostAccess) {
          const base = vCalc || v;
          return {
            ...base,
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
        }
        return vCalc || v;
      });

      // If item is a combo or has no variant but matches a combo calculation, synthesize variant calculation
      const matchedCombo = comboMap.get(item.id) || comboMap.get(item.name?.trim().toLowerCase());
      if (!defaultVariantCalc && matchedCombo) {
        defaultVariantCalc = {
          id: `combo_${matchedCombo.id}`,
          variant_name: `Combo (${matchedCombo.components?.length || 0} items)`,
          selling_price: matchedCombo.selling_price ?? Number(item.price) ?? 0,
          food_cost: matchedCombo.food_cost ?? null,
          food_cost_pct: matchedCombo.food_cost_pct ?? null,
          margin_amount: matchedCombo.margin_amount ?? null,
          costing_status: matchedCombo.costing_status || 'COSTED_ELIGIBLE',
          is_combo: true,
        };
      }
      // Matrix input record
      matrixInputs.push({
        menuItemId: item.id,
        name: item.name,
        nameHi: item.name_hi,
        category: item.category || 'General',
        parentCategory: item.parent_category || 'Other',
        sellingPrice: Number(item.price) || 0,
        costingStatus: defaultVariantCalc ? defaultVariantCalc.costing_status : 'INELIGIBLE',
        defaultVariantName: defaultVariantCalc?.variant_name,
        foodCost: defaultVariantCalc?.food_cost ?? null,
        unitsSold: sales.unitsSold,
        netRevenue: sales.netRevenue,
      });

      return { item, enrichedVariants, defaultVariantCalc, sales };
    });
    // 6. Calculate BCG matrix
    const matrixResult = calculateMenuEngineeringMatrix(matrixInputs);
    const matrixMap = new Map<string, any>();
    (matrixResult.items || []).forEach((m) => matrixMap.set(m.menuItemId, m));

    // 7. Merge matrix properties onto items
    const enrichedItems = preprocessedItems.map(({ item, enrichedVariants, defaultVariantCalc, sales }) => {
      const m = matrixMap.get(item.id);
      return {
        ...item,
        variants: enrichedVariants,
        defaultVariant: caller.hasCostAccess
          ? defaultVariantCalc
          : defaultVariantCalc
          ? {
              ...defaultVariantCalc,
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
            }
          : null,
        unitsSold: sales.unitsSold,
        netRevenue: sales.netRevenue,
        // Merged matrix properties:
        quadrant: m?.quadrant ?? null,
        salesMixPct: m?.salesMixPct ?? 0,
        unitContributionMargin: caller.hasCostAccess ? (m?.unitContributionMargin ?? null) : null,
        foodCostPct: caller.hasCostAccess ? (m?.foodCostPct ?? null) : null,
        isEligibleForMatrix: m?.isEligibleForMatrix ?? false,
        costingStatus: m?.costingStatus ?? (defaultVariantCalc ? defaultVariantCalc.costing_status : 'INELIGIBLE'),
      };
    });

    // 8. Build lightweight backward-compatible matrix projection
    const sanitizedMatrix = {
      state: matrixResult.state,
      totalUnitsSold: matrixResult.totalUnitsSold,
      totalNetRevenue: matrixResult.totalNetRevenue,
      popularityThresholdPct: matrixResult.popularityThresholdPct,
      salesWeightedContributionThreshold: caller.hasCostAccess
        ? matrixResult.salesWeightedContributionThreshold
        : null,
      eligibleItemsCount: matrixResult.eligibleItemsCount,
      totalItemsCount: matrixResult.totalItemsCount,
      items: view === 'catalog' ? [] : matrixResult.items.map((m) => ({
        menuItemId: m.menuItemId,
        name: m.name,
        quadrant: m.quadrant,
        unitsSold: m.unitsSold,
        netRevenue: m.netRevenue,
        foodCost: caller.hasCostAccess ? m.foodCost : null,
        foodCostPct: caller.hasCostAccess ? m.foodCostPct : null,
        unitContributionMargin: caller.hasCostAccess ? m.unitContributionMargin : null,
      })),
    };

    // Filter items if requested
    let filteredItems = enrichedItems;
    if (categoryFilter) {
      filteredItems = filteredItems.filter((i) => i.category === categoryFilter);
    }
    if (parentCategoryFilter) {
      filteredItems = filteredItems.filter((i) => i.parent_category === parentCategoryFilter);
    }
    return NextResponse.json({
      items: filteredItems,
      combos: calculatedCombos,
      matrix: sanitizedMatrix,
      channel,
      date_from: dateFrom,
      date_to: dateTo,
      hasCostAccess: caller.hasCostAccess,
    });
  } catch (err: any) {
    console.error('API GET /api/sops/menu error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
