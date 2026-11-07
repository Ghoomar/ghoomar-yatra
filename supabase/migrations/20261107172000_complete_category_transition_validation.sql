-- Migration: 20261107172000_complete_category_transition_validation.sql
-- Description: Complete 12-directional category transition compatibility validation,
-- database-level triggers for variants and combo components, and transactional
-- row-locking (FOR UPDATE / FOR SHARE) to eliminate concurrent dependency race conditions.

-- 1. Helper function for unit dimension resolution in SQL
CREATE OR REPLACE FUNCTION public.fn_get_unit_dimension(p_unit text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_norm text;
BEGIN
  IF p_unit IS NULL THEN
    RETURN 'UNKNOWN';
  END IF;
  v_norm := pg_catalog.lower(trim(p_unit));
  IF v_norm IN ('kg', 'kilogram', 'kilograms', 'g', 'gram', 'grams', 'gm', 'mg', 'milligram', 'milligrams', 'chutki') THEN
    RETURN 'MASS';
  ELSIF v_norm IN ('l', 'liter', 'liters', 'litre', 'litres', 'ml', 'milliliter', 'milliliters') THEN
    RETURN 'VOLUME';
  ELSIF v_norm IN ('pcs', 'piece', 'pieces', 'unit', 'units', 'portion', 'portions', 'serving', 'servings', 'plate', 'plates', 'bowl', 'bowls') THEN
    RETURN 'COUNT';
  ELSE
    RETURN 'OTHER';
  END IF;
END;
$$;

-- 2. Helper function for unit convertibility matching the costing engine (including culinary density equivalence)
CREATE OR REPLACE FUNCTION public.fn_are_units_convertible(p_unit_a text, p_unit_b text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_norm_a text;
  v_norm_b text;
  v_dim_a text;
  v_dim_b text;
BEGIN
  IF p_unit_a IS NULL OR p_unit_b IS NULL THEN
    RETURN false;
  END IF;

  v_norm_a := pg_catalog.lower(trim(p_unit_a));
  v_norm_b := pg_catalog.lower(trim(p_unit_b));

  IF v_norm_a = v_norm_b THEN
    RETURN true;
  END IF;

  -- Normalize common aliases
  IF v_norm_a IN ('kilogram', 'kilograms') THEN v_norm_a := 'kg'; END IF;
  IF v_norm_b IN ('kilogram', 'kilograms') THEN v_norm_b := 'kg'; END IF;
  IF v_norm_a IN ('gram', 'grams', 'gm') THEN v_norm_a := 'g'; END IF;
  IF v_norm_b IN ('gram', 'grams', 'gm') THEN v_norm_b := 'g'; END IF;
  IF v_norm_a IN ('milligram', 'milligrams') THEN v_norm_a := 'mg'; END IF;
  IF v_norm_b IN ('milligram', 'milligrams') THEN v_norm_b := 'mg'; END IF;
  IF v_norm_a IN ('liter', 'liters', 'litre', 'litres') THEN v_norm_a := 'l'; END IF;
  IF v_norm_b IN ('liter', 'liters', 'litre', 'litres') THEN v_norm_b := 'l'; END IF;
  IF v_norm_a IN ('milliliter', 'milliliters') THEN v_norm_a := 'ml'; END IF;
  IF v_norm_b IN ('milliliter', 'milliliters') THEN v_norm_b := 'ml'; END IF;
  IF v_norm_a IN ('piece', 'pieces', 'unit', 'units', 'portion', 'portions', 'serving', 'servings') THEN v_norm_a := 'pcs'; END IF;
  IF v_norm_b IN ('piece', 'pieces', 'unit', 'units', 'portion', 'portions', 'serving', 'servings') THEN v_norm_b := 'pcs'; END IF;

  IF v_norm_a = v_norm_b THEN
    RETURN true;
  END IF;

  v_dim_a := public.fn_get_unit_dimension(v_norm_a);
  v_dim_b := public.fn_get_unit_dimension(v_norm_b);

  -- 1. Same valid physical dimension (MASS, VOLUME, COUNT)
  IF v_dim_a != 'UNKNOWN' AND v_dim_a = v_dim_b THEN
    RETURN true;
  END IF;

  -- 2. Standard culinary density equivalence (1 g = 1 ml, 1 kg = 1 L)
  IF (v_dim_a = 'MASS' AND v_dim_b = 'VOLUME') OR (v_dim_a = 'VOLUME' AND v_dim_b = 'MASS') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- 3. Trigger function on yatra_recipe_ingredients:
-- Enforces that sub-preparations cannot reference FINAL_DISH recipes,
-- detects circular dependencies, and acquires FOR SHARE lock to serialize with recipe category updates.
CREATE OR REPLACE FUNCTION public.fn_validate_yatra_recipe_ingredient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_group_class TEXT;
  v_item_group_id UUID;
  v_cycle_detected BOOLEAN;
  v_sub_category TEXT;
BEGIN
  IF NEW.ingredient_type = 'RAW_MATERIAL' THEN
    IF NEW.ingredient_group_id IS NOT NULL THEN
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

      IF NEW.inventory_item_id IS NOT NULL THEN
        SELECT group_id INTO v_item_group_id
        FROM public.inventory_items
        WHERE id = NEW.inventory_item_id;

        IF v_item_group_id IS NULL OR v_item_group_id != NEW.ingredient_group_id THEN
          RAISE EXCEPTION 'Pinned inventory item % does not belong to group %',
            NEW.inventory_item_id, NEW.ingredient_group_id;
        END IF;
      END IF;
    END IF;

  ELSIF NEW.ingredient_type = 'PREPARATION' THEN
    IF NEW.sub_recipe_id = NEW.recipe_id THEN
      RAISE EXCEPTION 'A recipe cannot have itself as a sub-preparation';
    END IF;

    -- Concurrency lock and category check: ensure referenced recipe is not FINAL_DISH
    SELECT category INTO v_sub_category
    FROM public.yatra_recipes
    WHERE id = NEW.sub_recipe_id
    FOR SHARE;

    IF v_sub_category IS NULL THEN
      RAISE EXCEPTION 'Referenced sub-recipe % does not exist', NEW.sub_recipe_id;
    END IF;

    IF v_sub_category = 'FINAL_DISH' THEN
      RAISE EXCEPTION 'Cannot use a FINAL_DISH recipe (%) as a sub-preparation. Only PREPARATION, COMBO_PORTION, or BULK_CATERING recipes can be used as sub-recipes.', NEW.sub_recipe_id;
    END IF;

    -- Cycle detection using recursive CTE (max depth 10)
    WITH RECURSIVE recipe_chain AS (
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
$$;

-- 4. Trigger function on yatra_menu_item_variants:
-- Enforces paired-null portion inheritance contract, acquires FOR SHARE lock on recipe,
-- and validates that the referenced recipe has valid batch yield/portion specs for costing.
CREATE OR REPLACE FUNCTION public.fn_validate_yatra_menu_item_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_recipe RECORD;
  v_has_qty BOOLEAN;
  v_has_unit BOOLEAN;
  v_eff_var_qty NUMERIC;
  v_eff_var_unit TEXT;
BEGIN
  -- 1. Paired-Null Contract Validation on override fields
  v_has_qty := NEW.serving_quantity IS NOT NULL;
  v_has_unit := NEW.serving_unit IS NOT NULL AND pg_catalog.length(trim(NEW.serving_unit)) > 0;

  IF v_has_qty != v_has_unit THEN
    RAISE EXCEPTION 'Invalid variant portion specification: serving_quantity and serving_unit must both be provided together for an override, or both set to null to inherit from the recipe default.';
  END IF;

  IF v_has_qty AND NEW.serving_quantity <= 0 THEN
    RAISE EXCEPTION 'Variant serving quantity must be strictly greater than 0';
  END IF;

  -- 2. Concurrency lock on recipe (FOR SHARE)
  SELECT * INTO v_recipe
  FROM public.yatra_recipes
  WHERE id = NEW.recipe_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referenced recipe % does not exist', NEW.recipe_id;
  END IF;

  -- 3. Resolve effective portion: explicit override OR inherited from recipe default
  v_eff_var_qty := COALESCE(NEW.serving_quantity, v_recipe.portion_size_quantity);
  v_eff_var_unit := COALESCE(NULLIF(trim(NEW.serving_unit), ''), v_recipe.portion_size_unit);

  -- 4. Active variant costing specification requirements
  IF NEW.is_active = true THEN
    IF v_eff_var_qty IS NULL OR v_eff_var_qty <= 0 OR v_eff_var_unit IS NULL OR pg_catalog.length(trim(v_eff_var_unit)) = 0 THEN
      IF NEW.serving_quantity IS NULL THEN
        RAISE EXCEPTION 'Cannot link active variant "%" to recipe "%": variant inherits portion size from recipe default, but recipe lacks valid portion size quantity and unit.',
          NEW.variant_name, v_recipe.name;
      ELSE
        RAISE EXCEPTION 'Active variant "%" has invalid serving quantity or unit.', NEW.variant_name;
      END IF;
    END IF;

    -- Category-specific costing compatibility
    IF v_recipe.category IN ('PREPARATION', 'COMBO_PORTION', 'BULK_CATERING') THEN
      IF v_recipe.batch_yield_quantity IS NULL OR v_recipe.batch_yield_quantity <= 0 OR v_recipe.batch_yield_unit IS NULL THEN
        RAISE EXCEPTION 'Cannot link variant "%" to recipe "%": recipe has category % but lacks finished batch yield quantity and unit for costing.',
          NEW.variant_name, v_recipe.name, v_recipe.category;
      END IF;

      IF NOT public.fn_are_units_convertible(v_eff_var_unit, v_recipe.batch_yield_unit) THEN
        RAISE EXCEPTION 'Cannot link variant "%" to recipe "%": effective serving unit "%" cannot be converted to recipe yield unit "%".',
          NEW.variant_name, v_recipe.name, v_eff_var_unit, v_recipe.batch_yield_unit;
      END IF;

    ELSIF v_recipe.category = 'FINAL_DISH' THEN
      IF v_recipe.batch_yield_unit IS NOT NULL AND NOT public.fn_are_units_convertible(v_eff_var_unit, v_recipe.batch_yield_unit) THEN
        RAISE EXCEPTION 'Cannot link variant "%" to recipe "%": effective serving unit "%" cannot be converted to recipe batch yield unit "%".',
          NEW.variant_name, v_recipe.name, v_eff_var_unit, v_recipe.batch_yield_unit;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_yatra_menu_item_variant ON public.yatra_menu_item_variants;
CREATE TRIGGER trg_validate_yatra_menu_item_variant
  BEFORE INSERT OR UPDATE ON public.yatra_menu_item_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_yatra_menu_item_variant();

-- 5. Upgraded trigger function on yatra_combo_components:
-- Enforces variant belonging, positive portion size, acquires FOR SHARE lock on recipe,
-- and validates category & portion-unit compatibility per calculateComboThaliCost.
CREATE OR REPLACE FUNCTION public.fn_validate_yatra_combo_component()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_recipe RECORD;
  v_var_recipe_id UUID;
  v_dim_comp TEXT;
  v_is_compatible BOOLEAN := false;
BEGIN
  -- 1. Variant belonging check
  IF NEW.variant_id IS NOT NULL THEN
    SELECT recipe_id INTO v_var_recipe_id
    FROM public.yatra_menu_item_variants
    WHERE id = NEW.variant_id;

    IF v_var_recipe_id IS NULL OR v_var_recipe_id != NEW.recipe_id THEN
      RAISE EXCEPTION 'Referenced variant % does not belong to component recipe %',
        NEW.variant_id, NEW.recipe_id;
    END IF;
  END IF;

  -- 2. Portion quantity and unit checks
  IF NEW.portion_quantity IS NULL OR NEW.portion_quantity <= 0 THEN
    RAISE EXCEPTION 'Combo component portion quantity must be strictly greater than 0';
  END IF;

  IF NEW.portion_unit IS NULL OR pg_catalog.length(trim(NEW.portion_unit)) = 0 THEN
    RAISE EXCEPTION 'Combo component portion unit cannot be empty';
  END IF;

  -- 3. Concurrency lock on recipe (FOR SHARE)
  SELECT * INTO v_recipe
  FROM public.yatra_recipes
  WHERE id = NEW.recipe_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referenced recipe % does not exist', NEW.recipe_id;
  END IF;

  -- 4. Category & unit compatibility per calculateComboThaliCost
  IF v_recipe.category IN ('PREPARATION', 'COMBO_PORTION', 'BULK_CATERING') THEN
    IF v_recipe.batch_yield_quantity IS NULL OR v_recipe.batch_yield_quantity <= 0 OR v_recipe.batch_yield_unit IS NULL THEN
      RAISE EXCEPTION 'Cannot use recipe "%" in combo/thali component: category is % but recipe lacks finished batch yield quantity and unit.',
        v_recipe.name, v_recipe.category;
    END IF;

    IF NOT public.fn_are_units_convertible(NEW.portion_unit, v_recipe.batch_yield_unit) THEN
      RAISE EXCEPTION 'Incompatible portion unit "%" for recipe "%": yield is in "%" and cannot be converted without piece weight.',
        NEW.portion_unit, v_recipe.name, v_recipe.batch_yield_unit;
    END IF;

  ELSIF v_recipe.category = 'FINAL_DISH' THEN
    v_dim_comp := public.fn_get_unit_dimension(NEW.portion_unit);
    IF v_dim_comp = 'COUNT' THEN
      v_is_compatible := true;
    ELSIF v_recipe.portion_size_quantity IS NOT NULL AND v_recipe.portion_size_quantity > 0 AND v_recipe.portion_size_unit IS NOT NULL THEN
      v_is_compatible := public.fn_are_units_convertible(NEW.portion_unit, v_recipe.portion_size_unit);
    END IF;

    IF NOT v_is_compatible THEN
      RAISE EXCEPTION 'Cannot use FINAL_DISH recipe "%" in combo component with portion unit "%": recipe requires a configured portion size in a compatible dimension.',
        v_recipe.name, NEW.portion_unit;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_yatra_combo_component ON public.yatra_combo_components;
CREATE TRIGGER trg_validate_yatra_combo_component
  BEFORE INSERT OR UPDATE ON public.yatra_combo_components
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_yatra_combo_component();

-- 6. Upgraded fn_sync_yatra_recipe_atomic with comprehensive costing compatibility validation
-- across category, yield, and portion modifications, and inspection of all existing dependent records
CREATE OR REPLACE FUNCTION public.fn_sync_yatra_recipe_atomic(
  p_recipe_id UUID,
  p_header JSONB,
  p_ingredients JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_recipe RECORD;
  v_updated_recipe JSONB;
  v_current_category TEXT;
  v_target_category TEXT;
  v_old_yield_qty NUMERIC;
  v_old_yield_unit TEXT;
  v_old_portion_qty NUMERIC;
  v_old_portion_unit TEXT;
  v_eff_yield_qty NUMERIC;
  v_eff_yield_unit TEXT;
  v_eff_portion_qty NUMERIC;
  v_eff_portion_unit TEXT;
  v_category_changed BOOLEAN;
  v_yield_qty_changed BOOLEAN;
  v_yield_unit_changed BOOLEAN;
  v_portion_qty_changed BOOLEAN;
  v_portion_unit_changed BOOLEAN;
  v_costing_changed BOOLEAN;
  v_parent_count INT;
  v_variant_count INT;
  v_combo_count INT;
  v_eff_var_qty NUMERIC;
  v_eff_var_unit TEXT;
  v_combo_rec RECORD;
  v_var_rec RECORD;
  v_parent_rec RECORD;
  v_elem JSONB;
  v_idx INT := 0;
  v_qty NUMERIC;
BEGIN
  IF p_header IS NULL OR pg_catalog.jsonb_typeof(p_header) != 'object' THEN
    RAISE EXCEPTION 'Invalid header payload: must be a JSON object';
  END IF;

  IF p_ingredients IS NOT NULL AND pg_catalog.jsonb_typeof(p_ingredients) != 'array' THEN
    RAISE EXCEPTION 'Invalid ingredients payload: must be a JSON array or null';
  END IF;

  -- 1. Concurrency lock: lock recipe row exclusively FOR UPDATE
  SELECT * INTO v_recipe
  FROM public.yatra_recipes
  WHERE id = p_recipe_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe with ID % not found', p_recipe_id;
  END IF;

  v_current_category := v_recipe.category;
  v_old_yield_qty := v_recipe.batch_yield_quantity;
  v_old_yield_unit := v_recipe.batch_yield_unit;
  v_old_portion_qty := v_recipe.portion_size_quantity;
  v_old_portion_unit := v_recipe.portion_size_unit;

  IF p_header ? 'name' THEN
    IF p_header->>'name' IS NULL OR pg_catalog.length(trim(p_header->>'name')) = 0 THEN
      RAISE EXCEPTION 'Recipe name cannot be null or empty';
    END IF;
  END IF;

  IF p_header ? 'category' THEN
    v_target_category := p_header->>'category';
    IF v_target_category IS NULL OR v_target_category NOT IN ('PREPARATION', 'FINAL_DISH', 'COMBO_PORTION', 'BULK_CATERING') THEN
      RAISE EXCEPTION 'Invalid recipe category: %', v_target_category;
    END IF;
  ELSE
    v_target_category := v_current_category;
  END IF;

  -- Resolve effective portion and batch yield specifications
  v_eff_portion_qty := CASE 
    WHEN p_header ? 'portion_size_quantity' THEN (p_header->>'portion_size_quantity')::NUMERIC 
    ELSE v_old_portion_qty 
  END;
  v_eff_portion_unit := CASE 
    WHEN p_header ? 'portion_size_unit' THEN NULLIF(trim(p_header->>'portion_size_unit'), '') 
    ELSE v_old_portion_unit 
  END;
  v_eff_yield_qty := CASE 
    WHEN p_header ? 'batch_yield_quantity' THEN (p_header->>'batch_yield_quantity')::NUMERIC 
    ELSE v_old_yield_qty 
  END;
  v_eff_yield_unit := CASE 
    WHEN p_header ? 'batch_yield_unit' THEN NULLIF(trim(p_header->>'batch_yield_unit'), '') 
    ELSE v_old_yield_unit 
  END;

  -- Detect whether any costing-related specification changed
  v_category_changed := (v_target_category IS DISTINCT FROM v_current_category);
  v_yield_qty_changed := (v_eff_yield_qty IS DISTINCT FROM v_old_yield_qty);
  v_yield_unit_changed := (v_eff_yield_unit IS DISTINCT FROM v_old_yield_unit);
  v_portion_qty_changed := (v_eff_portion_qty IS DISTINCT FROM v_old_portion_qty);
  v_portion_unit_changed := (v_eff_portion_unit IS DISTINCT FROM v_old_portion_unit);

  v_costing_changed := (
    v_category_changed OR
    v_yield_qty_changed OR
    v_yield_unit_changed OR
    v_portion_qty_changed OR
    v_portion_unit_changed
  );

  -- 2. Costing and Dependency Compatibility Validation
  IF v_costing_changed THEN

    -- CHECK DEPENDENCY TYPE 1: Parent Recipes (where this recipe is consumed as a sub-preparation)
    SELECT count(*) INTO v_parent_count
    FROM public.yatra_recipe_ingredients
    WHERE sub_recipe_id = p_recipe_id;

    IF v_parent_count > 0 THEN
      -- Cannot change category to FINAL_DISH if parent recipes exist
      IF v_target_category = 'FINAL_DISH' THEN
        RAISE EXCEPTION 'Cannot change category to FINAL_DISH: recipe is referenced as a sub-recipe in % parent recipe(s). Remove sub-recipe references before changing category.', v_parent_count;
      END IF;

      -- Cannot remove or zero batch yield quantity if parent recipes exist
      IF v_eff_yield_qty IS NULL OR v_eff_yield_qty <= 0 THEN
        RAISE EXCEPTION 'Cannot update batch yield: % parent recipe(s) depend on this recipe and require a positive batch yield quantity for sub-recipe costing.', v_parent_count;
      END IF;

      -- Cannot remove batch yield unit if parent recipes exist
      IF v_eff_yield_unit IS NULL THEN
        RAISE EXCEPTION 'Cannot remove batch yield unit: % parent recipe(s) depend on this recipe for sub-recipe costing.', v_parent_count;
      END IF;

      -- If yield unit changed, inspect every consuming parent recipe ingredient line
      IF v_yield_unit_changed THEN
        FOR v_parent_rec IN
          SELECT r.name as parent_name, ri.quantity, ri.unit
          FROM public.yatra_recipe_ingredients ri
          JOIN public.yatra_recipes r ON ri.recipe_id = r.id
          WHERE ri.sub_recipe_id = p_recipe_id
        LOOP
          IF NOT public.fn_are_units_convertible(v_parent_rec.unit, v_eff_yield_unit) THEN
            RAISE EXCEPTION 'Cannot change batch yield unit to "%": parent recipe "%" consumes this sub-recipe in "%" which cannot be converted to "%".',
              v_eff_yield_unit, v_parent_rec.parent_name, v_parent_rec.unit, v_eff_yield_unit;
          END IF;
        END LOOP;
      END IF;
    END IF;

    -- CHECK DEPENDENCY TYPE 2: Active Menu Item Variants
    SELECT count(*) INTO v_variant_count
    FROM public.yatra_menu_item_variants
    WHERE recipe_id = p_recipe_id AND is_active = true;

    IF v_variant_count > 0 THEN
      -- If target category is yield-based, recipe requires valid batch yield quantity and unit
      IF v_target_category IN ('PREPARATION', 'COMBO_PORTION', 'BULK_CATERING') THEN
        IF v_eff_yield_qty IS NULL OR v_eff_yield_qty <= 0 OR v_eff_yield_unit IS NULL THEN
          RAISE EXCEPTION 'Cannot update recipe: category is % and recipe is linked to % active menu item variant(s), requiring finished batch yield quantity and unit for variant costing.',
            v_target_category, v_variant_count;
        END IF;
      END IF;

      -- Inspect every active menu variant
      FOR v_var_rec IN
        SELECT variant_name, serving_quantity, serving_unit
        FROM public.yatra_menu_item_variants
        WHERE recipe_id = p_recipe_id AND is_active = true
      LOOP
        -- Resolve effective serving: variant override OR inherited from recipe default
        v_eff_var_qty := COALESCE(v_var_rec.serving_quantity, v_eff_portion_qty);
        v_eff_var_unit := COALESCE(v_var_rec.serving_unit, v_eff_portion_unit);

        IF v_eff_var_qty IS NULL OR v_eff_var_qty <= 0 OR v_eff_var_unit IS NULL THEN
          RAISE EXCEPTION 'Cannot update costing specifications: active variant "%" has no effective serving quantity or unit.',
            v_var_rec.variant_name;
        END IF;

        IF v_target_category IN ('PREPARATION', 'COMBO_PORTION', 'BULK_CATERING') THEN
          IF NOT public.fn_are_units_convertible(v_eff_var_unit, v_eff_yield_unit) THEN
            RAISE EXCEPTION 'Cannot update recipe: active variant "%" uses effective serving unit "%" which cannot be converted to the recipe finished batch yield unit "%".',
              v_var_rec.variant_name, v_eff_var_unit, v_eff_yield_unit;
          END IF;
        ELSIF v_target_category = 'FINAL_DISH' THEN
          IF v_eff_yield_unit IS NOT NULL AND NOT public.fn_are_units_convertible(v_eff_var_unit, v_eff_yield_unit) THEN
            RAISE EXCEPTION 'Cannot update recipe: active variant "%" uses effective serving unit "%" which cannot be converted to recipe batch yield unit "%".',
              v_var_rec.variant_name, v_eff_var_unit, v_eff_yield_unit;
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- CHECK DEPENDENCY TYPE 3: Combo / Thali Components
    SELECT count(*) INTO v_combo_count
    FROM public.yatra_combo_components
    WHERE recipe_id = p_recipe_id;

    IF v_combo_count > 0 THEN
      IF v_target_category IN ('PREPARATION', 'COMBO_PORTION', 'BULK_CATERING') THEN
        IF v_eff_yield_qty IS NULL OR v_eff_yield_qty <= 0 OR v_eff_yield_unit IS NULL THEN
          RAISE EXCEPTION 'Cannot update recipe: category is % and recipe is linked to % combo/thali component(s), requiring finished batch yield quantity and unit for component costing.',
            v_target_category, v_combo_count;
        END IF;

        FOR v_combo_rec IN
          SELECT c.component_name, c.portion_quantity, c.portion_unit, ct.name as combo_name
          FROM public.yatra_combo_components c
          JOIN public.yatra_combos_thalis ct ON c.combo_thali_id = ct.id
          WHERE c.recipe_id = p_recipe_id
        LOOP
          IF NOT public.fn_are_units_convertible(v_combo_rec.portion_unit, v_eff_yield_unit) THEN
            RAISE EXCEPTION 'Cannot update recipe: combo/thali component "%" in "%" uses portion unit "%" which cannot be converted to the recipe batch yield unit "%".',
              v_combo_rec.component_name, v_combo_rec.combo_name, v_combo_rec.portion_unit, v_eff_yield_unit;
          END IF;
        END LOOP;

      ELSIF v_target_category = 'FINAL_DISH' THEN
        IF v_eff_portion_qty IS NULL OR v_eff_portion_qty <= 0 OR v_eff_portion_unit IS NULL THEN
          RAISE EXCEPTION 'Cannot update FINAL_DISH recipe: recipe requires a positive portion size quantity and valid portion size unit.';
        END IF;

        FOR v_combo_rec IN
          SELECT c.component_name, c.portion_quantity, c.portion_unit, ct.name as combo_name
          FROM public.yatra_combo_components c
          JOIN public.yatra_combos_thalis ct ON c.combo_thali_id = ct.id
          WHERE c.recipe_id = p_recipe_id
        LOOP
          IF public.fn_get_unit_dimension(v_combo_rec.portion_unit) != 'COUNT' AND
             NOT public.fn_are_units_convertible(v_combo_rec.portion_unit, v_eff_portion_unit) THEN
            RAISE EXCEPTION 'Cannot update recipe: combo/thali component "%" in "%" uses portion unit "%" which is incompatible with the recipe portion unit "%".',
              v_combo_rec.component_name, v_combo_rec.combo_name, v_combo_rec.portion_unit, v_eff_portion_unit;
          END IF;
        END LOOP;
      END IF;
    END IF;

    -- If target category is FINAL_DISH and no variants/combos exist, portion size is still mandatory for FINAL_DISH
    IF v_target_category = 'FINAL_DISH' AND (v_eff_portion_qty IS NULL OR v_eff_portion_qty <= 0 OR v_eff_portion_unit IS NULL) THEN
      RAISE EXCEPTION 'Cannot update FINAL_DISH recipe: recipe requires a positive portion size quantity and valid portion size unit.';
    END IF;

  END IF; -- end IF v_costing_changed

  -- Validate individual ingredient entries
  IF p_ingredients IS NOT NULL AND pg_catalog.jsonb_array_length(p_ingredients) > 0 THEN
    FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_ingredients) LOOP
      v_idx := v_idx + 1;
      IF (v_elem->>'ingredient_type') NOT IN ('RAW_MATERIAL', 'PREPARATION') THEN
        RAISE EXCEPTION 'Ingredient line % has invalid ingredient_type: %', v_idx, v_elem->>'ingredient_type';
      END IF;
      v_qty := (v_elem->>'quantity')::NUMERIC;
      IF v_qty IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'Ingredient line % must have a quantity strictly greater than 0', v_idx;
      END IF;
      IF v_elem->>'unit' IS NULL OR pg_catalog.length(trim(v_elem->>'unit')) = 0 THEN
        RAISE EXCEPTION 'Ingredient line % is missing a unit', v_idx;
      END IF;
      IF (v_elem->>'ingredient_type') = 'RAW_MATERIAL' THEN
        IF (v_elem->>'ingredient_group_id') IS NULL THEN
          RAISE EXCEPTION 'Ingredient line % (RAW_MATERIAL) requires ingredient_group_id', v_idx;
        END IF;
        IF (v_elem->>'sub_recipe_id') IS NOT NULL THEN
          RAISE EXCEPTION 'Ingredient line % (RAW_MATERIAL) cannot specify sub_recipe_id', v_idx;
        END IF;
      ELSIF (v_elem->>'ingredient_type') = 'PREPARATION' THEN
        IF (v_elem->>'sub_recipe_id') IS NULL THEN
          RAISE EXCEPTION 'Ingredient line % (PREPARATION) requires sub_recipe_id', v_idx;
        END IF;
        IF (v_elem->>'sub_recipe_id')::UUID = p_recipe_id THEN
          RAISE EXCEPTION 'Ingredient line %: a recipe cannot reference itself as a sub-recipe', v_idx;
        END IF;
        IF (v_elem->>'ingredient_group_id') IS NOT NULL OR (v_elem->>'inventory_item_id') IS NOT NULL THEN
          RAISE EXCEPTION 'Ingredient line % (PREPARATION) cannot specify ingredient_group_id or inventory_item_id', v_idx;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Partial header update
  UPDATE public.yatra_recipes
  SET
    name = CASE WHEN p_header ? 'name' THEN trim(p_header->>'name') ELSE name END,
    name_hi = CASE WHEN p_header ? 'name_hi' THEN NULLIF(trim(p_header->>'name_hi'), '') ELSE name_hi END,
    category = v_target_category,
    batch_yield_quantity = CASE WHEN p_header ? 'batch_yield_quantity' THEN (p_header->>'batch_yield_quantity')::NUMERIC ELSE batch_yield_quantity END,
    batch_yield_unit = CASE WHEN p_header ? 'batch_yield_unit' THEN NULLIF(trim(p_header->>'batch_yield_unit'), '') ELSE batch_yield_unit END,
    portion_size_quantity = CASE WHEN p_header ? 'portion_size_quantity' THEN (p_header->>'portion_size_quantity')::NUMERIC ELSE portion_size_quantity END,
    portion_size_unit = CASE WHEN p_header ? 'portion_size_unit' THEN NULLIF(trim(p_header->>'portion_size_unit'), '') ELSE portion_size_unit END,
    instructions = CASE WHEN p_header ? 'instructions' THEN (p_header->>'instructions')::TEXT ELSE instructions END,
    notes = CASE WHEN p_header ? 'notes' THEN (p_header->>'notes')::TEXT ELSE notes END,
    is_active = CASE WHEN p_header ? 'is_active' THEN (p_header->>'is_active')::BOOLEAN ELSE is_active END,
    updated_at = pg_catalog.now()
  WHERE id = p_recipe_id;

  -- Synchronize ingredients
  IF p_ingredients IS NOT NULL THEN
    DELETE FROM public.yatra_recipe_ingredients WHERE recipe_id = p_recipe_id;
    IF pg_catalog.jsonb_array_length(p_ingredients) > 0 THEN
      INSERT INTO public.yatra_recipe_ingredients (
        recipe_id, ingredient_type, ingredient_group_id, inventory_item_id, sub_recipe_id, quantity, unit, sort_order, notes
      )
      SELECT
        p_recipe_id,
        elem->>'ingredient_type',
        (elem->>'ingredient_group_id')::UUID,
        (elem->>'inventory_item_id')::UUID,
        (elem->>'sub_recipe_id')::UUID,
        (elem->>'quantity')::NUMERIC,
        elem->>'unit',
        COALESCE((elem->>'sort_order')::INT, ordinality),
        elem->>'notes'
      FROM pg_catalog.jsonb_array_elements(p_ingredients) WITH ORDINALITY AS t(elem, ordinality);
    END IF;
  END IF;

  SELECT pg_catalog.to_jsonb(r) INTO v_updated_recipe FROM public.yatra_recipes r WHERE r.id = p_recipe_id;
  RETURN v_updated_recipe;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_yatra_recipe_atomic(UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_yatra_recipe_atomic(UUID, JSONB, JSONB) TO service_role;
