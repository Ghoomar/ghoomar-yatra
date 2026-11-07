-- Migration: 20261107140000_atomic_recipe_ingredient_sync.sql
-- Description: Hardened atomic recipe update and ingredient synchronisation

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
  v_updated_recipe JSONB;
  v_current_category TEXT;
  v_target_category TEXT;
  v_parent_count INT;
  v_elem JSONB;
  v_idx INT := 0;
  v_qty NUMERIC;
BEGIN
  -- 1. Validate top-level payload types
  IF p_header IS NULL OR pg_catalog.jsonb_typeof(p_header) != 'object' THEN
    RAISE EXCEPTION 'Invalid header payload: must be a JSON object';
  END IF;

  IF p_ingredients IS NOT NULL AND pg_catalog.jsonb_typeof(p_ingredients) != 'array' THEN
    RAISE EXCEPTION 'Invalid ingredients payload: must be a JSON array or null';
  END IF;

  -- 2. Concurrency lock: lock recipe row for update
  SELECT category INTO v_current_category
  FROM public.yatra_recipes
  WHERE id = p_recipe_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe with ID % not found', p_recipe_id;
  END IF;

  -- 3. Header validation
  IF p_header ? 'name' THEN
    IF p_header->>'name' IS NULL OR pg_catalog.length(pg_catalog.trim(p_header->>'name')) = 0 THEN
      RAISE EXCEPTION 'Recipe name cannot be null or empty';
    END IF;
  END IF;

  IF p_header ? 'category' THEN
    v_target_category := p_header->>'category';
    IF v_target_category IS NULL OR v_target_category NOT IN ('PREPARATION', 'FINAL_DISH', 'COMBO_PORTION', 'BULK_CATERING') THEN
      RAISE EXCEPTION 'Invalid recipe category: %', v_target_category;
    END IF;

    -- Server-side dependency check: Block PREPARATION -> FINAL_DISH if referenced by parent recipes
    IF v_current_category = 'PREPARATION' AND v_target_category = 'FINAL_DISH' THEN
      SELECT count(*) INTO v_parent_count
      FROM public.yatra_recipe_ingredients
      WHERE sub_recipe_id = p_recipe_id;

      IF v_parent_count > 0 THEN
        RAISE EXCEPTION 'Cannot change category from PREPARATION to FINAL_DISH: recipe is referenced as a sub-recipe in % parent recipe(s). Remove sub-recipe references before changing category.', v_parent_count;
      END IF;
    END IF;
  ELSE
    v_target_category := v_current_category;
  END IF;

  -- 4. Validate individual ingredient entries
  IF p_ingredients IS NOT NULL AND pg_catalog.jsonb_array_length(p_ingredients) > 0 THEN
    FOR v_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_ingredients) LOOP
      v_idx := v_idx + 1;
      
      -- Type check
      IF (v_elem->>'ingredient_type') NOT IN ('RAW_MATERIAL', 'PREPARATION') THEN
        RAISE EXCEPTION 'Ingredient line % has invalid ingredient_type: %', v_idx, v_elem->>'ingredient_type';
      END IF;

      -- Quantity check
      v_qty := (v_elem->>'quantity')::NUMERIC;
      IF v_qty IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'Ingredient line % must have a quantity strictly greater than 0', v_idx;
      END IF;

      -- Unit check
      IF v_elem->>'unit' IS NULL OR pg_catalog.length(pg_catalog.trim(v_elem->>'unit')) = 0 THEN
        RAISE EXCEPTION 'Ingredient line % is missing a unit', v_idx;
      END IF;

      -- Foreign key target checks
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

  -- 5. Partial header update with explicit nullability semantics
  UPDATE public.yatra_recipes
  SET
    name = CASE 
      WHEN p_header ? 'name' THEN pg_catalog.trim(p_header->>'name') 
      ELSE name 
    END,
    name_hi = CASE 
      WHEN p_header ? 'name_hi' THEN NULLIF(pg_catalog.trim(p_header->>'name_hi'), '') 
      ELSE name_hi 
    END,
    category = v_target_category,
    batch_yield_quantity = CASE 
      WHEN p_header ? 'batch_yield_quantity' THEN (p_header->>'batch_yield_quantity')::NUMERIC 
      ELSE batch_yield_quantity 
    END,
    batch_yield_unit = CASE 
      WHEN p_header ? 'batch_yield_unit' THEN NULLIF(pg_catalog.trim(p_header->>'batch_yield_unit'), '') 
      ELSE batch_yield_unit 
    END,
    portion_size_quantity = CASE 
      WHEN p_header ? 'portion_size_quantity' THEN (p_header->>'portion_size_quantity')::NUMERIC 
      ELSE portion_size_quantity 
    END,
    portion_size_unit = CASE 
      WHEN p_header ? 'portion_size_unit' THEN NULLIF(pg_catalog.trim(p_header->>'portion_size_unit'), '') 
      ELSE portion_size_unit 
    END,
    instructions = CASE 
      WHEN p_header ? 'instructions' THEN (p_header->>'instructions')::TEXT 
      ELSE instructions 
    END,
    notes = CASE 
      WHEN p_header ? 'notes' THEN (p_header->>'notes')::TEXT 
      ELSE notes 
    END,
    is_active = CASE 
      WHEN p_header ? 'is_active' THEN (p_header->>'is_active')::BOOLEAN 
      ELSE is_active 
    END,
    updated_at = pg_catalog.now()
  WHERE id = p_recipe_id;

  -- 6. Synchronize ingredients
  IF p_ingredients IS NOT NULL THEN
    -- Delete previous ingredients
    DELETE FROM public.yatra_recipe_ingredients
    WHERE recipe_id = p_recipe_id;

    -- If array has elements, insert new rows
    IF pg_catalog.jsonb_array_length(p_ingredients) > 0 THEN
      INSERT INTO public.yatra_recipe_ingredients (
        recipe_id,
        ingredient_type,
        ingredient_group_id,
        inventory_item_id,
        sub_recipe_id,
        quantity,
        unit,
        sort_order,
        notes
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

  -- 7. Return updated recipe record
  SELECT pg_catalog.to_jsonb(r) INTO v_updated_recipe
  FROM public.yatra_recipes r
  WHERE r.id = p_recipe_id;

  RETURN v_updated_recipe;
END;
$$;

-- 8. Restrict execution strictly to service_role
REVOKE ALL ON FUNCTION public.fn_sync_yatra_recipe_atomic(UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_yatra_recipe_atomic(UUID, JSONB, JSONB) TO service_role;
