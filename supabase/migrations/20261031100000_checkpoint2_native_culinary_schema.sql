-- Checkpoint 2: Native Yatra Culinary Schema & Graph Relationships
-- Forward migration: 20261031100000_checkpoint2_native_culinary_schema.sql

-- 0. Add last_valid_wac to logical_ingredient_groups for group-level WAC snapshot retention
ALTER TABLE public.logical_ingredient_groups ADD COLUMN IF NOT EXISTS last_valid_wac NUMERIC(12, 4) DEFAULT NULL;

-- 1. Create public.yatra_recipes
CREATE TABLE IF NOT EXISTS public.yatra_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_hi TEXT,
  category TEXT NOT NULL CHECK (category IN ('PREPARATION', 'FINAL_DISH', 'COMBO_PORTION', 'BULK_CATERING')),
  batch_yield_quantity NUMERIC(12, 4),
  batch_yield_unit TEXT,
  portion_size_quantity NUMERIC(12, 4),
  portion_size_unit TEXT,
  instructions TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  legacy_recipe_id UUID UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yatra_recipes_category ON public.yatra_recipes(category);
CREATE INDEX IF NOT EXISTS idx_yatra_recipes_is_active ON public.yatra_recipes(is_active);

-- 2. Create public.yatra_recipe_ingredients
CREATE TABLE IF NOT EXISTS public.yatra_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES public.yatra_recipes(id) ON DELETE CASCADE,
  ingredient_type TEXT NOT NULL CHECK (ingredient_type IN ('RAW_MATERIAL', 'PREPARATION')),
  ingredient_group_id UUID REFERENCES public.logical_ingredient_groups(id) ON DELETE RESTRICT,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  sub_recipe_id UUID REFERENCES public.yatra_recipes(id) ON DELETE RESTRICT,
  quantity NUMERIC(12, 4) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ingredient Type Constraints
  CONSTRAINT check_ingredient_type_targets CHECK (
    (ingredient_type = 'RAW_MATERIAL' AND ingredient_group_id IS NOT NULL AND sub_recipe_id IS NULL)
    OR
    (ingredient_type = 'PREPARATION' AND sub_recipe_id IS NOT NULL AND ingredient_group_id IS NULL AND inventory_item_id IS NULL AND sub_recipe_id != recipe_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_yatra_recipe_ingredients_recipe_id ON public.yatra_recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_yatra_recipe_ingredients_group_id ON public.yatra_recipe_ingredients(ingredient_group_id);
CREATE INDEX IF NOT EXISTS idx_yatra_recipe_ingredients_sub_recipe_id ON public.yatra_recipe_ingredients(sub_recipe_id);

-- 3. Validation Trigger for Recipe Ingredients (Food Class, Pinned Item Group, DAG Cycle Detection)
CREATE OR REPLACE FUNCTION public.fn_validate_yatra_recipe_ingredient()
RETURNS TRIGGER AS $$
DECLARE
  v_group_class TEXT;
  v_item_group_id UUID;
  v_cycle_detected BOOLEAN;
BEGIN
  IF NEW.ingredient_type = 'RAW_MATERIAL' THEN
    -- Verify group exists and has Food Raw Material class
    SELECT COALESCE(g.inventory_class, c.inventory_class) INTO v_group_class
    FROM public.logical_ingredient_groups g
    LEFT JOIN public.inventory_categories c ON g.category_id = c.id
    WHERE g.id = NEW.ingredient_group_id;

    IF v_group_class IS NULL THEN
      RAISE EXCEPTION 'Referenced ingredient group % does not exist', NEW.ingredient_group_id;
    END IF;

    IF v_group_class != 'Food Raw Material' THEN
      RAISE EXCEPTION 'Group "%" has inventory_class "%". Only "Food Raw Material" groups can be used in recipes.',
        NEW.ingredient_group_id, v_group_class;
    END IF;

    -- If a specific brand item is pinned, verify it belongs to this group
    IF NEW.inventory_item_id IS NOT NULL THEN
      SELECT group_id INTO v_item_group_id
      FROM public.inventory_items
      WHERE id = NEW.inventory_item_id;

      IF v_item_group_id IS NULL OR v_item_group_id != NEW.ingredient_group_id THEN
        RAISE EXCEPTION 'Pinned inventory item % does not belong to group %',
          NEW.inventory_item_id, NEW.ingredient_group_id;
      END IF;
    END IF;

  ELSIF NEW.ingredient_type = 'PREPARATION' THEN
    IF NEW.sub_recipe_id = NEW.recipe_id THEN
      RAISE EXCEPTION 'A recipe cannot have itself as a sub-preparation';
    END IF;

    -- Cycle detection using recursive CTE (max depth 10)
    WITH RECURSIVE recipe_chain AS (
      -- Start with the candidate sub-recipe
      SELECT NEW.sub_recipe_id AS current_recipe, 1 AS depth, ARRAY[NEW.recipe_id, NEW.sub_recipe_id] AS path
      UNION ALL
      SELECT ri.sub_recipe_id, rc.depth + 1, rc.path || ri.sub_recipe_id
      FROM public.yatra_recipe_ingredients ri
      JOIN recipe_chain rc ON ri.recipe_id = rc.current_recipe
      WHERE ri.ingredient_type = 'PREPARATION'
        AND ri.sub_recipe_id IS NOT NULL
        AND rc.depth < 10
    )
    SELECT EXISTS (
      SELECT 1 FROM recipe_chain WHERE current_recipe = NEW.recipe_id
    ) INTO v_cycle_detected;

    IF v_cycle_detected THEN
      RAISE EXCEPTION 'Adding sub-recipe % introduces a circular dependency in recipe %',
        NEW.sub_recipe_id, NEW.recipe_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_yatra_recipe_ingredient ON public.yatra_recipe_ingredients;
CREATE TRIGGER trg_validate_yatra_recipe_ingredient
  BEFORE INSERT OR UPDATE ON public.yatra_recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_yatra_recipe_ingredient();

-- 4. Create public.yatra_menu_item_variants
CREATE TABLE IF NOT EXISTS public.yatra_menu_item_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES public.pos_menu_items(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES public.yatra_recipes(id) ON DELETE RESTRICT,
  variant_name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  serving_quantity NUMERIC(12, 4),
  serving_unit TEXT,
  gas_cost NUMERIC(12, 4) DEFAULT 0,
  other_operating_cost NUMERIC(12, 4) DEFAULT 0,
  packaging_cost_dine_in NUMERIC(12, 4) DEFAULT 0,
  packaging_cost_takeaway NUMERIC(12, 4) DEFAULT 0,
  default_service_channel TEXT NOT NULL DEFAULT 'DINE_IN' CHECK (default_service_channel IN ('DINE_IN', 'TAKEAWAY')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yatra_menu_item_variants_menu_item_id ON public.yatra_menu_item_variants(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_yatra_menu_item_variants_recipe_id ON public.yatra_menu_item_variants(recipe_id);

-- Partial unique index: at most one active is_default = true variant per menu_item_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_yatra_menu_item_variants_default
  ON public.yatra_menu_item_variants(menu_item_id)
  WHERE is_default = true AND is_active = true;

-- 5. Create public.yatra_combos_thalis
CREATE TABLE IF NOT EXISTS public.yatra_combos_thalis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_hi TEXT,
  product_type TEXT NOT NULL CHECK (product_type IN ('COMBO', 'THALI')),
  menu_item_id UUID REFERENCES public.pos_menu_items(id) ON DELETE SET NULL,
  selling_price NUMERIC(12, 4),
  gas_cost NUMERIC(12, 4) DEFAULT 0,
  other_operating_cost NUMERIC(12, 4) DEFAULT 0,
  packaging_cost_dine_in NUMERIC(12, 4) DEFAULT 0,
  packaging_cost_takeaway NUMERIC(12, 4) DEFAULT 0,
  default_service_channel TEXT NOT NULL DEFAULT 'DINE_IN' CHECK (default_service_channel IN ('DINE_IN', 'TAKEAWAY')),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  legacy_combo_id UUID UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yatra_combos_thalis_menu_item ON public.yatra_combos_thalis(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_yatra_combos_thalis_product_type ON public.yatra_combos_thalis(product_type);

-- 6. Create public.yatra_combo_components
CREATE TABLE IF NOT EXISTS public.yatra_combo_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_thali_id UUID NOT NULL REFERENCES public.yatra_combos_thalis(id) ON DELETE CASCADE,
  component_name TEXT NOT NULL,
  recipe_id UUID NOT NULL REFERENCES public.yatra_recipes(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES public.yatra_menu_item_variants(id) ON DELETE SET NULL,
  portion_quantity NUMERIC(12, 4) NOT NULL CHECK (portion_quantity > 0),
  portion_unit TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yatra_combo_components_combo_thali_id ON public.yatra_combo_components(combo_thali_id);
CREATE INDEX IF NOT EXISTS idx_yatra_combo_components_recipe_id ON public.yatra_combo_components(recipe_id);

-- Validation Trigger for Combo Components: variant must belong to same recipe
CREATE OR REPLACE FUNCTION public.fn_validate_yatra_combo_component()
RETURNS TRIGGER AS $$
DECLARE
  v_var_recipe_id UUID;
BEGIN
  IF NEW.variant_id IS NOT NULL THEN
    SELECT recipe_id INTO v_var_recipe_id
    FROM public.yatra_menu_item_variants
    WHERE id = NEW.variant_id;

    IF v_var_recipe_id IS NULL OR v_var_recipe_id != NEW.recipe_id THEN
      RAISE EXCEPTION 'Referenced variant % does not belong to component recipe %',
        NEW.variant_id, NEW.recipe_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_yatra_combo_component ON public.yatra_combo_components;
CREATE TRIGGER trg_validate_yatra_combo_component
  BEFORE INSERT OR UPDATE ON public.yatra_combo_components
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_yatra_combo_component();

-- 7. Row Level Security & Permissions
ALTER TABLE public.yatra_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_menu_item_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_combos_thalis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_combo_components ENABLE ROW LEVEL SECURITY;

-- Select policies: Allow read to authenticated users
CREATE POLICY "yatra_recipes_select" ON public.yatra_recipes FOR SELECT TO authenticated USING (true);
CREATE POLICY "yatra_recipe_ingredients_select" ON public.yatra_recipe_ingredients FOR SELECT TO authenticated USING (true);
CREATE POLICY "yatra_menu_item_variants_select" ON public.yatra_menu_item_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY "yatra_combos_thalis_select" ON public.yatra_combos_thalis FOR SELECT TO authenticated USING (true);
CREATE POLICY "yatra_combo_components_select" ON public.yatra_combo_components FOR SELECT TO authenticated USING (true);

-- Manage policies: Allow insert/update/delete to Admin or sops.recipes.manage
CREATE POLICY "yatra_recipes_all" ON public.yatra_recipes FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.name = 'Admin'
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid() AND perm.code IN ('sops.recipes.manage', 'admin.manage')
  )
);

CREATE POLICY "yatra_recipe_ingredients_all" ON public.yatra_recipe_ingredients FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.name = 'Admin'
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid() AND perm.code IN ('sops.recipes.manage', 'admin.manage')
  )
);

CREATE POLICY "yatra_menu_item_variants_all" ON public.yatra_menu_item_variants FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.name = 'Admin'
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid() AND perm.code IN ('sops.recipes.manage', 'admin.manage')
  )
);

CREATE POLICY "yatra_combos_thalis_all" ON public.yatra_combos_thalis FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.name = 'Admin'
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid() AND perm.code IN ('sops.recipes.manage', 'admin.manage')
  )
);

CREATE POLICY "yatra_combo_components_all" ON public.yatra_combo_components FOR ALL TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.name = 'Admin'
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid() AND perm.code IN ('sops.recipes.manage', 'admin.manage')
  )
);
