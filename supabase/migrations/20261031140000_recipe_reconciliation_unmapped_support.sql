-- Migration: 20261031140000_recipe_reconciliation_unmapped_support.sql
-- Description: Allow unmapped raw materials in yatra_recipe_ingredients with notes while tagging costing incomplete

-- 1. Relax check constraint on yatra_recipe_ingredients
ALTER TABLE public.yatra_recipe_ingredients 
DROP CONSTRAINT IF EXISTS check_ingredient_type_targets;

ALTER TABLE public.yatra_recipe_ingredients 
ADD CONSTRAINT check_ingredient_type_targets CHECK (
  (ingredient_type = 'RAW_MATERIAL' AND sub_recipe_id IS NULL)
  OR
  (ingredient_type = 'PREPARATION' AND sub_recipe_id IS NOT NULL AND ingredient_group_id IS NULL AND inventory_item_id IS NULL AND sub_recipe_id != recipe_id)
);

-- 2. Update validation trigger function to allow ingredient_group_id IS NULL when unmapped
CREATE OR REPLACE FUNCTION public.fn_validate_yatra_recipe_ingredient()
RETURNS TRIGGER AS $$
DECLARE
  v_group_class TEXT;
  v_item_group_id UUID;
  v_cycle_detected BOOLEAN;
BEGIN
  IF NEW.ingredient_type = 'RAW_MATERIAL' THEN
    -- If group is mapped, verify group exists and has Food Raw Material class
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
    END IF;
    -- If NEW.ingredient_group_id IS NULL, permitted as an unmapped raw material (with notes populated)

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
