import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCallerAuth } from '@/lib/sops/auth';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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
    const searchTerm = searchParams.get('search')?.toLowerCase().trim();

    const admin = createAdminClient();

    let query = admin
      .from('yatra_canonical_dishes')
      .select(`
        *,
        configurations:yatra_serving_configurations(*),
        formulations:yatra_recipe_formulations(
          *,
          ingredients:yatra_recipe_formulation_ingredients(*)
        ),
        menu_items:pos_menu_items(id, name, name_hi, price, category, parent_category, product_type, is_active)
      `)
      .order('name');

    if (categoryFilter && categoryFilter !== 'ALL') {
      query = query.eq('category', categoryFilter);
    }

    const { data: dishes, error: dishErr } = await query;
    if (dishErr) throw dishErr;

    // Fetch latest costing snapshots for all formulations
    const allFormIds = (dishes || []).flatMap((d: any) => (d.formulations || []).map((f: any) => f.id));
    let snapshotMap = new Map<string, any>();

    if (allFormIds.length > 0) {
      const { data: snapshots } = await admin
        .from('yatra_costing_snapshots')
        .select('*')
        .in('formulation_id', allFormIds)
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

    // Assemble and mask costing if caller lacks permission
    const assembled = (dishes || []).map((dish: any) => {
      const maskedFormulations = (dish.formulations || []).map((f: any) => {
        const batchSnap = snapshotMap.get(`${f.id}:batch`);
        return {
          ...f,
          costing_status: batchSnap?.costing_status || 'UNCOSTED',
          batch_cost: caller.hasCostAccess ? (batchSnap?.batch_cost ?? null) : null,
          ingredient_breakdown: caller.hasCostAccess ? (batchSnap?.ingredient_breakdown_json ?? []) : [],
        };
      });

      const maskedConfigurations = (dish.configurations || []).map((cfg: any) => {
        // Find default or first formulation snapshot for this configuration
        let servingCost: number | null = null;
        let cfgStatus: string = 'UNCOSTED';

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

      return {
        ...dish,
        configurations: maskedConfigurations,
        formulations: maskedFormulations,
      };
    });

    const filtered = searchTerm
      ? assembled.filter((d: any) => {
          const nameMatch = d.name?.toLowerCase().includes(searchTerm);
          const nameHiMatch = d.name_hi?.toLowerCase().includes(searchTerm);
          const slugMatch = d.slug?.toLowerCase().includes(searchTerm);
          return nameMatch || nameHiMatch || slugMatch;
        })
      : assembled;

    return NextResponse.json({
      dishes: filtered,
      totalCount: assembled.length,
      filteredCount: filtered.length,
      hasCostAccess: caller.hasCostAccess,
    });
  } catch (err: any) {
    console.error('API GET /api/sops/dishes error:', err);
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
      description,
      configurations,
    } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Dish name is required' }, { status: 400 });
    }

    if (!category || !['FINAL_DISH', 'PREPARATION'].includes(category)) {
      return NextResponse.json({ error: 'Category must be FINAL_DISH or PREPARATION' }, { status: 400 });
    }

    const admin = createAdminClient();
    const isPreparation = category === 'PREPARATION';
    const baseSlug = slugify(name);
    let uniqueSlug = baseSlug;

    // Check slug collision
    const { data: existing } = await admin
      .from('yatra_canonical_dishes')
      .select('id')
      .eq('slug', baseSlug)
      .maybeSingle();

    if (existing) {
      uniqueSlug = `${baseSlug}-${Date.now().toString().slice(-4)}`;
    }

    // Insert canonical dish
    const { data: dish, error: insertErr } = await admin
      .from('yatra_canonical_dishes')
      .insert({
        name: name.trim(),
        name_hi: name_hi?.trim() || null,
        slug: uniqueSlug,
        category,
        is_preparation: isPreparation,
        description: description?.trim() || null,
        is_active: true,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // If configurations provided for FINAL_DISH, insert them
    if (Array.isArray(configurations) && configurations.length > 0 && !isPreparation) {
      const configRows = configurations.map((cfg: any) => ({
        canonical_dish_id: dish.id,
        name: cfg.name.trim(),
        name_hi: cfg.name_hi?.trim() || null,
        portion_size_quantity: Number(cfg.portion_size_quantity) || 0,
        portion_size_unit: cfg.portion_size_unit?.trim() || 'g',
        is_active: true,
      }));

      const { error: cfgErr } = await admin.from('yatra_serving_configurations').insert(configRows);
      if (cfgErr) console.warn('Failed to insert initial configurations:', cfgErr);
    }

    return NextResponse.json({ success: true, dish }, { status: 201 });
  } catch (err: any) {
    console.error('API POST /api/sops/dishes error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
