-- Migration: 20261107142000_transition_variant_portion_inheritance.sql
-- Description: Transition existing 27 menu item variants to inherit recipe default portion sizes

DO $$
DECLARE
  v_matching_count INT;
  v_divergent_count INT;
BEGIN
  -- Count variants matching parent recipe default
  SELECT count(*) INTO v_matching_count
  FROM public.yatra_menu_item_variants v
  JOIN public.yatra_recipes r ON v.recipe_id = r.id
  WHERE (
    (v.serving_quantity IS NOT NULL AND v.serving_quantity = r.portion_size_quantity AND v.serving_unit = r.portion_size_unit)
    OR
    (v.serving_quantity IS NULL AND v.serving_unit IS NOT NULL AND (r.portion_size_quantity IS NULL OR v.serving_unit = r.portion_size_unit))
  );

  -- Count variants that diverge (true user overrides)
  SELECT count(*) INTO v_divergent_count
  FROM public.yatra_menu_item_variants v
  JOIN public.yatra_recipes r ON v.recipe_id = r.id
  WHERE v.serving_quantity IS NOT NULL
    AND (v.serving_quantity != r.portion_size_quantity OR v.serving_unit != r.portion_size_unit);

  RAISE NOTICE 'Variants matching recipe default: %, Divergent overrides: %', v_matching_count, v_divergent_count;

  -- Idempotent, paired update: set BOTH to NULL where values match the recipe default
  UPDATE public.yatra_menu_item_variants v
  SET
    serving_quantity = NULL,
    serving_unit = NULL,
    updated_at = now()
  FROM public.yatra_recipes r
  WHERE v.recipe_id = r.id
    AND (
      (v.serving_quantity IS NOT NULL AND v.serving_unit IS NOT NULL AND v.serving_quantity = r.portion_size_quantity AND v.serving_unit = r.portion_size_unit)
      OR
      (v.serving_quantity IS NULL AND v.serving_unit IS NOT NULL AND (r.portion_size_quantity IS NULL OR v.serving_unit = r.portion_size_unit))
    );

  -- True overrides are strictly preserved
END $$;
