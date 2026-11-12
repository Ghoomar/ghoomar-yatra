-- ============================================================================
-- Ghoomar Yatra 4-Tier Native Culinary & Menu Architecture DDL
-- Migration: 20261112000000_native_culinary_4tier_architecture.sql
-- ============================================================================

-- 0. Inventory Items Pre-requisite for Brand-Pinning
ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS uq_inventory_item_group;
ALTER TABLE public.inventory_items
  ADD CONSTRAINT uq_inventory_item_group UNIQUE (id, group_id);

-- 1. Canonical Dishes & Preparations (Creation without circular default FK)
CREATE TABLE IF NOT EXISTS public.yatra_canonical_dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_hi TEXT,
  slug TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('FINAL_DISH', 'PREPARATION')),
  is_preparation BOOLEAN NOT NULL DEFAULT false,
  default_formulation_id UUID, -- Foreign key added via ALTER TABLE below
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_canonical_dish_slug UNIQUE (slug),
  CONSTRAINT chk_canonical_dish_category_prep CHECK (
    (category = 'PREPARATION' AND is_preparation = true)
    OR
    (category = 'FINAL_DISH' AND is_preparation = false)
  )
);

-- 2. Serving Configurations
CREATE TABLE IF NOT EXISTS public.yatra_serving_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_dish_id UUID NOT NULL REFERENCES public.yatra_canonical_dishes(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, -- e.g. 'A La Carte', 'Combo', 'Thali'
  name_hi TEXT,
  portion_size_quantity NUMERIC NOT NULL CHECK (portion_size_quantity > 0),
  portion_size_unit TEXT NOT NULL CHECK (portion_size_unit IN ('g', 'kg', 'ml', 'L', 'pcs')),
  dimension_value NUMERIC CHECK (dimension_value IS NULL OR dimension_value > 0),
  dimension_unit TEXT CHECK (dimension_unit IS NULL OR dimension_unit IN ('inch', 'cm')),
  custom_attributes JSONB NOT NULL DEFAULT '{}'::jsonb, -- Arbitrary attributes (piece count, volume ml)
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_dish_config_name UNIQUE (canonical_dish_id, name),
  CONSTRAINT uq_serving_config_dish UNIQUE (id, canonical_dish_id) -- Supports composite FKs
);

-- 3. Recipe Formulations
CREATE TABLE IF NOT EXISTS public.yatra_recipe_formulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_dish_id UUID NOT NULL REFERENCES public.yatra_canonical_dishes(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, -- e.g. 'Standard', 'Bhrampal', 'Deepak'
  version_number INT NOT NULL DEFAULT 1,
  batch_yield_quantity NUMERIC,
  batch_yield_unit TEXT,
  pre_cooking_input_quantity NUMERIC CHECK (pre_cooking_input_quantity IS NULL OR pre_cooking_input_quantity > 0),
  pre_cooking_input_unit TEXT CHECK (pre_cooking_input_unit IS NULL OR pre_cooking_input_unit IN ('kg', 'g', 'pcs')),
  preparation_method TEXT,
  culinary_notes TEXT,
  legacy_recipe_id UUID REFERENCES public.yatra_recipes(id) ON DELETE SET NULL, -- Migration audit
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_dish_formulation_name UNIQUE (canonical_dish_id, name), -- Active unique name per dish
  CONSTRAINT uq_formulation_dish UNIQUE (id, canonical_dish_id), -- Supports composite FKs
  CONSTRAINT chk_formulation_yield_pair CHECK (
    (
      batch_yield_quantity IS NULL
      AND (
        batch_yield_unit IS NULL
        OR batch_yield_unit IN ('kg', 'g', 'pcs')
      )
    )
    OR
    (
      batch_yield_quantity IS NOT NULL
      AND batch_yield_quantity > 0
      AND batch_yield_unit IS NOT NULL
      AND batch_yield_unit IN ('kg', 'g', 'pcs')
    )
  )
);

-- Mutual Dependency Resolution: Canonical Dish Default Formulation Foreign Key
ALTER TABLE public.yatra_canonical_dishes
  DROP CONSTRAINT IF EXISTS fk_canonical_dish_default_formulation,
  DROP CONSTRAINT IF EXISTS chk_default_formulation_only_for_prep;

ALTER TABLE public.yatra_canonical_dishes
  ADD CONSTRAINT fk_canonical_dish_default_formulation
    FOREIGN KEY (default_formulation_id, id)
    REFERENCES public.yatra_recipe_formulations (id, canonical_dish_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT chk_default_formulation_only_for_prep
    CHECK (is_preparation = true OR default_formulation_id IS NULL);

-- 4. Formulation Ingredients (with Brand-Pinning & Sub-Prep Composite FKs)
CREATE TABLE IF NOT EXISTS public.yatra_recipe_formulation_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formulation_id UUID NOT NULL REFERENCES public.yatra_recipe_formulations(id) ON DELETE RESTRICT,
  ingredient_type TEXT NOT NULL CHECK (ingredient_type IN ('RAW_MATERIAL', 'PREPARATION')),
  ingredient_group_id UUID REFERENCES public.logical_ingredient_groups(id) ON DELETE RESTRICT,
  inventory_item_id UUID, -- Optional Brand-Variant Pinning
  sub_preparation_dish_id UUID REFERENCES public.yatra_canonical_dishes(id) ON DELETE RESTRICT,
  sub_preparation_formulation_id UUID, -- Optional specific formulation override
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  notes TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_ing_pinned_inventory_item
    FOREIGN KEY (inventory_item_id, ingredient_group_id)
    REFERENCES public.inventory_items (id, group_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_ing_sub_prep_formulation
    FOREIGN KEY (sub_preparation_formulation_id, sub_preparation_dish_id)
    REFERENCES public.yatra_recipe_formulations (id, canonical_dish_id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_ingredient_reference CHECK (
    (ingredient_type = 'RAW_MATERIAL' AND ingredient_group_id IS NOT NULL AND sub_preparation_dish_id IS NULL AND sub_preparation_formulation_id IS NULL)
    OR
    (ingredient_type = 'PREPARATION' AND sub_preparation_dish_id IS NOT NULL AND ingredient_group_id IS NULL AND inventory_item_id IS NULL)
  )
);

-- 5. Configuration-Formulation Association (with Same-Dish Composite FKs)
CREATE TABLE IF NOT EXISTS public.yatra_configuration_formulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_dish_id UUID NOT NULL REFERENCES public.yatra_canonical_dishes(id) ON DELETE RESTRICT,
  serving_configuration_id UUID NOT NULL,
  formulation_id UUID NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_config_formulation_link UNIQUE (serving_configuration_id, formulation_id),
  CONSTRAINT fk_config_formulation_serving_config
    FOREIGN KEY (serving_configuration_id, canonical_dish_id)
    REFERENCES public.yatra_serving_configurations (id, canonical_dish_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_config_formulation_formulation
    FOREIGN KEY (formulation_id, canonical_dish_id)
    REFERENCES public.yatra_recipe_formulations (id, canonical_dish_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_config_default_formulation
ON public.yatra_configuration_formulations (serving_configuration_id)
WHERE is_default = true;

-- 6. POS Menu Items: Add Columns & Staged Product Type Backfill Migration
ALTER TABLE public.pos_menu_items
  ADD COLUMN IF NOT EXISTS canonical_dish_id UUID REFERENCES public.yatra_canonical_dishes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS serving_configuration_id UUID,
  ADD COLUMN IF NOT EXISTS product_type TEXT
    CHECK (product_type IN ('INDIVIDUAL_DISH', 'COMBO', 'THALI', 'STANDALONE_PURCHASED', 'OTHER_PRODUCT')),
  ADD COLUMN IF NOT EXISTS gas_cost NUMERIC(10,4) NOT NULL DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS other_operating_cost NUMERIC(10,4) NOT NULL DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS packaging_cost_dine_in NUMERIC(10,4) NOT NULL DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS packaging_cost_takeaway NUMERIC(10,4) NOT NULL DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS default_service_channel TEXT NOT NULL DEFAULT 'DINE_IN';

-- Staged Product Type Backfill Table
CREATE TABLE IF NOT EXISTS public.yatra_menu_item_product_type_staging (
  menu_item_id UUID NOT NULL REFERENCES public.pos_menu_items(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL CHECK (product_type IN ('INDIVIDUAL_DISH', 'COMBO', 'THALI', 'STANDALONE_PURCHASED', 'OTHER_PRODUCT')),
  classification_source TEXT NOT NULL
);

TRUNCATE TABLE public.yatra_menu_item_product_type_staging;

-- Staging Insert 1: Combos by yatra_combos_thalis (id or menu_item_id)
INSERT INTO public.yatra_menu_item_product_type_staging (menu_item_id, product_type, classification_source)
SELECT DISTINCT p.id, 'COMBO', 'yatra_combos_thalis'
FROM public.pos_menu_items p
JOIN public.yatra_combos_thalis ct ON p.id = ct.menu_item_id OR p.id = ct.id;

-- Staging Insert 2: Thalis by category
INSERT INTO public.yatra_menu_item_product_type_staging (menu_item_id, product_type, classification_source)
SELECT DISTINCT p.id, 'THALI', 'pos_categories_thali'
FROM public.pos_menu_items p
LEFT JOIN public.pos_categories c ON p.category_id = c.id
WHERE lower(trim(coalesce(c.name, ''))) = 'thali' OR lower(trim(coalesce(p.category, ''))) = 'thali';

-- Staging Insert 3: Standalone Packaged Goods
INSERT INTO public.yatra_menu_item_product_type_staging (menu_item_id, product_type, classification_source)
SELECT p.id, 'STANDALONE_PURCHASED', 'verified_standalone_sku'
FROM public.pos_menu_items p
WHERE lower(trim(p.name)) IN ('mineral water 1 ltr', 'packaged water', 'cold drink 500ml', 'red bull');

-- Staging Insert 4: Active Individual Dishes linked to variants
INSERT INTO public.yatra_menu_item_product_type_staging (menu_item_id, product_type, classification_source)
SELECT DISTINCT v.menu_item_id, 'INDIVIDUAL_DISH', 'yatra_menu_item_variants'
FROM public.yatra_menu_item_variants v
WHERE v.menu_item_id IS NOT NULL;

-- Conflict Detection & Validation (Using $$ dollar quoting)
DO $$
DECLARE
  v_conflict_count INT;
  v_conflict_details TEXT;
BEGIN
  SELECT count(*), string_agg(menu_item_id::text || ' (' || product_types || ')', '; ')
  INTO v_conflict_count, v_conflict_details
  FROM (
    SELECT menu_item_id, string_agg(DISTINCT product_type, ', ') AS product_types
    FROM public.yatra_menu_item_product_type_staging
    GROUP BY menu_item_id
    HAVING count(DISTINCT product_type) > 1
  ) c;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Classification conflict detected for % menu item(s): %. Manual resolution required before staging.',
      v_conflict_count, v_conflict_details;
  END IF;
END;
$$;

-- Apply staged classifications
UPDATE public.pos_menu_items p
SET product_type = s.product_type
FROM (
  SELECT DISTINCT menu_item_id, product_type
  FROM public.yatra_menu_item_product_type_staging
) s
WHERE p.id = s.menu_item_id;

-- Classify remaining unclassified restaurant menu items as INDIVIDUAL_DISH
UPDATE public.pos_menu_items
SET product_type = 'INDIVIDUAL_DISH'
WHERE product_type IS NULL;

-- Step 3 Validation Gate: Zero unresolved product_type
DO $$
DECLARE
  v_unresolved INT;
BEGIN
  SELECT count(*) INTO v_unresolved FROM public.pos_menu_items WHERE product_type IS NULL;
  IF v_unresolved > 0 THEN
    RAISE EXCEPTION 'Backfill validation failed: % pos_menu_items have NULL product_type. Review unresolved list before applying NOT NULL constraint.', v_unresolved;
  END IF;
END;
$$;

-- Step 4 Enforce Constraints & Foreign Keys
ALTER TABLE public.pos_menu_items
  ALTER COLUMN product_type SET NOT NULL,
  ALTER COLUMN product_type SET DEFAULT 'INDIVIDUAL_DISH';

ALTER TABLE public.pos_menu_items
  DROP CONSTRAINT IF EXISTS fk_pos_menu_items_serving_config,
  DROP CONSTRAINT IF EXISTS chk_pos_menu_items_product_type_dish_rules;

ALTER TABLE public.pos_menu_items
  ADD CONSTRAINT fk_pos_menu_items_serving_config
    FOREIGN KEY (serving_configuration_id, canonical_dish_id)
    REFERENCES public.yatra_serving_configurations (id, canonical_dish_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT chk_pos_menu_items_product_type_dish_rules CHECK (
    (
      product_type = 'INDIVIDUAL_DISH'
      AND (
        (canonical_dish_id IS NULL AND serving_configuration_id IS NULL)
        OR
        (canonical_dish_id IS NOT NULL AND serving_configuration_id IS NOT NULL)
      )
    )
    OR
    (
      product_type IN ('COMBO', 'THALI', 'STANDALONE_PURCHASED', 'OTHER_PRODUCT')
      AND canonical_dish_id IS NULL
      AND serving_configuration_id IS NULL
    )
  );

DROP TABLE IF EXISTS public.yatra_menu_item_product_type_staging;

-- 7. Fixed Combo / Thali Compositions
CREATE TABLE IF NOT EXISTS public.yatra_menu_item_compositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES public.pos_menu_items(id) ON DELETE RESTRICT,
  component_dish_id UUID NOT NULL REFERENCES public.yatra_canonical_dishes(id) ON DELETE RESTRICT,
  serving_configuration_id UUID NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_menu_item_composition_order UNIQUE (menu_item_id, sort_order),
  CONSTRAINT fk_composition_serving_config
    FOREIGN KEY (serving_configuration_id, component_dish_id)
    REFERENCES public.yatra_serving_configurations (id, canonical_dish_id)
    ON DELETE RESTRICT
);

-- Trigger: Enforce that parent menu item has product_type IN ('COMBO', 'THALI')
CREATE OR REPLACE FUNCTION public.fn_trg_validate_menu_item_composition_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_product_type TEXT;
BEGIN
  SELECT product_type INTO v_product_type
  FROM public.pos_menu_items
  WHERE id = NEW.menu_item_id;

  IF v_product_type IS NULL OR v_product_type NOT IN ('COMBO', 'THALI') THEN
    RAISE EXCEPTION 'Invalid composition parent: pos_menu_items row % must have product_type IN (''COMBO'', ''THALI''). Current product_type: %',
      NEW.menu_item_id, v_product_type USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_menu_item_composition_parent ON public.yatra_menu_item_compositions;
CREATE TRIGGER trg_validate_menu_item_composition_parent
BEFORE INSERT OR UPDATE OF menu_item_id ON public.yatra_menu_item_compositions
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_validate_menu_item_composition_parent();

-- 8. Raw Material Ingredient Unit Conversions
CREATE TABLE IF NOT EXISTS public.yatra_ingredient_unit_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_group_id UUID REFERENCES public.logical_ingredient_groups(id) ON DELETE RESTRICT,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  multiplier NUMERIC NOT NULL CHECK (multiplier > 0),
  notes TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_conversion_target_xor CHECK (
    (ingredient_group_id IS NOT NULL AND inventory_item_id IS NULL)
    OR
    (ingredient_group_id IS NULL AND inventory_item_id IS NOT NULL)
  ),
  CONSTRAINT chk_verified_ing_conversion_provenance CHECK (
    NOT is_verified
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_unit_conv
ON public.yatra_ingredient_unit_conversions (
  ingredient_group_id,
  lower(trim(from_unit)),
  lower(trim(to_unit))
)
WHERE ingredient_group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_unit_conv
ON public.yatra_ingredient_unit_conversions (
  inventory_item_id,
  lower(trim(from_unit)),
  lower(trim(to_unit))
)
WHERE inventory_item_id IS NOT NULL;

-- 9. Dedicated Formulation Output Conversions (Version-Safe & Verified)
CREATE TABLE IF NOT EXISTS public.yatra_formulation_output_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formulation_id UUID NOT NULL REFERENCES public.yatra_recipe_formulations(id) ON DELETE RESTRICT,
  formulation_version INT NOT NULL DEFAULT 1,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  multiplier NUMERIC NOT NULL CHECK (multiplier > 0),
  measurement_notes TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_output_conv_units_valid CHECK (
    pg_catalog.length(pg_catalog.btrim(from_unit)) > 0
    AND pg_catalog.length(pg_catalog.btrim(to_unit)) > 0
    AND pg_catalog.lower(pg_catalog.btrim(from_unit)) <> pg_catalog.lower(pg_catalog.btrim(to_unit))
  ),
  CONSTRAINT chk_verified_output_conversion_provenance CHECK (
    NOT is_verified
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_formulation_output_unit_conv
ON public.yatra_formulation_output_conversions (
  formulation_id,
  formulation_version,
  pg_catalog.lower(pg_catalog.btrim(from_unit)),
  pg_catalog.lower(pg_catalog.btrim(to_unit))
);

-- Transactional Reciprocal Conversion Consistency Trigger
CREATE OR REPLACE FUNCTION public.fn_validate_reciprocal_unit_conversion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rev_mult NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'yatra_ingredient_unit_conversions' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('conv_lock_' || COALESCE(NEW.ingredient_group_id::text, NEW.inventory_item_id::text))
    );
    SELECT multiplier INTO v_rev_mult
    FROM public.yatra_ingredient_unit_conversions
    WHERE (
      (NEW.ingredient_group_id IS NOT NULL AND ingredient_group_id = NEW.ingredient_group_id)
      OR
      (NEW.inventory_item_id IS NOT NULL AND inventory_item_id = NEW.inventory_item_id)
    )
    AND pg_catalog.lower(pg_catalog.btrim(from_unit)) = pg_catalog.lower(pg_catalog.btrim(NEW.to_unit))
    AND pg_catalog.lower(pg_catalog.btrim(to_unit)) = pg_catalog.lower(pg_catalog.btrim(NEW.from_unit))
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  ELSIF TG_TABLE_NAME = 'yatra_formulation_output_conversions' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('output_conv_lock_' || NEW.formulation_id::text || '_' || NEW.formulation_version::text)
    );
    SELECT multiplier INTO v_rev_mult
    FROM public.yatra_formulation_output_conversions
    WHERE formulation_id = NEW.formulation_id
      AND formulation_version = NEW.formulation_version
      AND pg_catalog.lower(pg_catalog.btrim(from_unit)) = pg_catalog.lower(pg_catalog.btrim(NEW.to_unit))
      AND pg_catalog.lower(pg_catalog.btrim(to_unit)) = pg_catalog.lower(pg_catalog.btrim(NEW.from_unit))
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;

  IF v_rev_mult IS NOT NULL THEN
    IF ABS((v_rev_mult * NEW.multiplier) - 1.0) > 0.0001 THEN
      RAISE EXCEPTION 'Contradictory reciprocal conversion detected: multiplier % conflicts with existing reverse multiplier % (product % <> 1.0)',
        NEW.multiplier, v_rev_mult, (v_rev_mult * NEW.multiplier)
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_reciprocal_ingredient_conv ON public.yatra_ingredient_unit_conversions;
CREATE TRIGGER trg_validate_reciprocal_ingredient_conv
BEFORE INSERT OR UPDATE ON public.yatra_ingredient_unit_conversions
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_reciprocal_unit_conversion();

DROP TRIGGER IF EXISTS trg_validate_reciprocal_output_conv ON public.yatra_formulation_output_conversions;
CREATE TRIGGER trg_validate_reciprocal_output_conv
BEFORE INSERT OR UPDATE ON public.yatra_formulation_output_conversions
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_reciprocal_unit_conversion();

-- 10. Append-Only Costing Snapshots (Immutable Audit History)
CREATE TABLE IF NOT EXISTS public.yatra_costing_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formulation_id UUID NOT NULL REFERENCES public.yatra_recipe_formulations(id) ON DELETE RESTRICT,
  formulation_version INT NOT NULL,
  costing_status TEXT NOT NULL CHECK (costing_status IN ('COSTED_ELIGIBLE', 'UNCOSTED', 'COSTING_INCOMPLETE')),
  serving_configuration_id UUID REFERENCES public.yatra_serving_configurations(id) ON DELETE RESTRICT,
  batch_cost NUMERIC(10,4), -- Nullable for UNCOSTED and COSTING_INCOMPLETE
  usable_batch_yield NUMERIC(10,4),
  usable_batch_unit TEXT,
  output_conversion_multiplier NUMERIC,
  output_conversion_verified BOOLEAN,
  serving_portion_quantity NUMERIC(10,4),
  serving_portion_unit TEXT,
  calculated_serving_cost NUMERIC(10,4),
  resolved_sub_preparations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ingredient_breakdown_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot_fingerprint TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_costed_batch_cost CHECK (
    (costing_status = 'COSTED_ELIGIBLE' AND batch_cost IS NOT NULL AND (serving_configuration_id IS NULL OR calculated_serving_cost IS NOT NULL))
    OR
    (costing_status = 'COSTING_INCOMPLETE' AND calculated_serving_cost IS NULL)
    OR
    (costing_status = 'UNCOSTED' AND batch_cost IS NULL AND calculated_serving_cost IS NULL)
  ),
  CONSTRAINT chk_snapshot_serving_pairing CHECK (
    (
      serving_configuration_id IS NULL
      AND serving_portion_quantity IS NULL
      AND serving_portion_unit IS NULL
      AND calculated_serving_cost IS NULL
    )
    OR
    (
      serving_configuration_id IS NOT NULL
      AND serving_portion_quantity IS NOT NULL
      AND serving_portion_quantity > 0
      AND serving_portion_unit IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_costing_snapshot_fingerprint
ON public.yatra_costing_snapshots (
  formulation_id,
  COALESCE(serving_configuration_id, '00000000-0000-0000-0000-000000000000'::uuid),
  snapshot_fingerprint
);

CREATE OR REPLACE FUNCTION public.fn_prevent_costing_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Historical costing snapshots are immutable and append-only'
    USING ERRCODE = '23505';
END;
$$;

DROP TRIGGER IF EXISTS trg_costing_snapshots_immutable ON public.yatra_costing_snapshots;
CREATE TRIGGER trg_costing_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.yatra_costing_snapshots
FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_costing_snapshot_mutation();

-- 11. External POS Identity & Open Item Mappings
CREATE TABLE IF NOT EXISTS public.pos_external_item_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'PETPOOJA',
  outlet_id TEXT NOT NULL DEFAULT 'DEFAULT',
  external_item_id TEXT NOT NULL,
  menu_item_id UUID NOT NULL REFERENCES public.pos_menu_items(id) ON DELETE RESTRICT,
  external_item_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_external_pos_item UNIQUE (provider, outlet_id, external_item_id)
);

CREATE TABLE IF NOT EXISTS public.pos_open_item_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'PETPOOJA',
  outlet_id TEXT NOT NULL DEFAULT 'DEFAULT',
  raw_description TEXT NOT NULL,
  normalized_description TEXT NOT NULL,
  target_menu_item_id UUID NOT NULL REFERENCES public.pos_menu_items(id) ON DELETE RESTRICT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_open_item_description UNIQUE (provider, outlet_id, normalized_description)
);

-- 12. Menu Item Merge Audit Log
CREATE TABLE IF NOT EXISTS public.yatra_menu_merge_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_menu_item_id UUID NOT NULL REFERENCES public.pos_menu_items(id) ON DELETE RESTRICT,
  source_menu_item_id UUID NOT NULL REFERENCES public.pos_menu_items(id) ON DELETE RESTRICT,
  merged_by UUID REFERENCES auth.users(id),
  source_snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- DAG Validation Helper, Triggers & Locking RPCs
-- ============================================================================

-- 1. Non-Mutating Validation Helper: Validates both descendant preparations AND upstream ancestors
CREATE OR REPLACE FUNCTION public.fn_validate_preparation_default_dag(
  p_dish_id UUID,
  p_formulation_id UUID,
  p_is_dish_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_form_yield_qty NUMERIC;
  v_form_yield_unit TEXT;
  v_form_version INT;
  v_parent_dep RECORD;
  v_cycle_detected BOOLEAN;
  v_cycle_path TEXT;
  v_dag_err TEXT;
BEGIN
  -- 1a. Acquire global DAG advisory lock
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('yatra_recipe_dag_lock'));

  -- 1b. Active Preparation Default Invariant: active preparation must always have an active default formulation
  IF p_is_dish_active AND p_formulation_id IS NULL THEN
    RAISE EXCEPTION 'Cannot clear default_formulation_id on an active Preparation'
      USING ERRCODE = '23514';
  END IF;

  IF p_formulation_id IS NOT NULL THEN
    -- 1c. Validate formulation belongs to dish and is active
    SELECT batch_yield_quantity, batch_yield_unit, version_number
    INTO v_form_yield_qty, v_form_yield_unit, v_form_version
    FROM public.yatra_recipe_formulations
    WHERE id = p_formulation_id AND canonical_dish_id = p_dish_id AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Formulation % does not belong to preparation % or is inactive', p_formulation_id, p_dish_id
        USING ERRCODE = '23503';
    END IF;

    -- 1d. Validate yield and unit compatibility against every active parent formulation consuming via default
    FOR v_parent_dep IN
      SELECT
        p_dish.name AS parent_dish_name,
        fi.unit AS parent_consumed_unit
      FROM public.yatra_recipe_formulation_ingredients fi
      JOIN public.yatra_recipe_formulations pf ON fi.formulation_id = pf.id AND pf.is_active = true
      JOIN public.yatra_canonical_dishes p_dish ON pf.canonical_dish_id = p_dish.id
      WHERE fi.sub_preparation_dish_id = p_dish_id
        AND fi.sub_preparation_formulation_id IS NULL
        AND fi.ingredient_type = 'PREPARATION'
    LOOP
      IF v_form_yield_qty IS NULL THEN
        RAISE EXCEPTION 'Cannot set formulation % as default: it has NULL batch yield while active parent formulation of % consumes it',
          p_formulation_id, v_parent_dep.parent_dish_name USING ERRCODE = '23514';
      END IF;

      IF NOT (
        (v_form_yield_unit IN ('kg', 'g') AND v_parent_dep.parent_consumed_unit IN ('kg', 'g'))
        OR (v_form_yield_unit = 'pcs' AND v_parent_dep.parent_consumed_unit = 'pcs')
        OR EXISTS (
          SELECT 1 FROM public.yatra_formulation_output_conversions
          WHERE formulation_id = p_formulation_id
            AND formulation_version = v_form_version
            AND is_verified = true
            AND pg_catalog.lower(pg_catalog.btrim(from_unit)) = pg_catalog.lower(pg_catalog.btrim(v_form_yield_unit))
            AND pg_catalog.lower(pg_catalog.btrim(to_unit)) = pg_catalog.lower(pg_catalog.btrim(v_parent_dep.parent_consumed_unit))
        )
      ) THEN
        RAISE EXCEPTION 'Cannot set formulation % as default: yield unit % is incompatible with parent recipe % which consumes it in % without a verified output conversion',
          p_formulation_id, v_form_yield_unit, v_parent_dep.parent_dish_name, v_parent_dep.parent_consumed_unit
          USING ERRCODE = '23514';
      END IF;
    END LOOP;

    -- 1e. Re-validate DAG across BOTH child descendants of p_formulation_id AND parent ancestors
    WITH RECURSIVE dag_traversal AS (
      -- Anchor 1: Direct child preparations consumed by p_formulation_id
      SELECT
        fi.sub_preparation_dish_id AS child_dish_id,
        COALESCE(fi.sub_preparation_formulation_id, d.default_formulation_id) AS child_formulation_id,
        ARRAY[p_dish_id, fi.sub_preparation_dish_id] AS path,
        1 AS depth,
        (fi.sub_preparation_dish_id = p_dish_id) AS is_cycle,
        CASE
          WHEN COALESCE(fi.sub_preparation_formulation_id, d.default_formulation_id) IS NULL THEN 'MISSING_CHILD_FORMULATION'
          WHEN NOT EXISTS (
            SELECT 1 FROM public.yatra_recipe_formulations rf
            WHERE rf.id = COALESCE(fi.sub_preparation_formulation_id, d.default_formulation_id)
              AND rf.canonical_dish_id = fi.sub_preparation_dish_id
              AND rf.is_active = true
          ) THEN 'INACTIVE_OR_MISMATCHED_CHILD_FORMULATION'
          ELSE 'OK'
        END AS validation_error
      FROM public.yatra_recipe_formulation_ingredients fi
      JOIN public.yatra_canonical_dishes d ON fi.sub_preparation_dish_id = d.id
      WHERE fi.formulation_id = p_formulation_id
        AND fi.ingredient_type = 'PREPARATION'

      UNION ALL

      -- Anchor 2: Upstream parent recipes that consume p_dish_id via default
      SELECT
        fi.sub_preparation_dish_id AS child_dish_id,
        p_formulation_id AS child_formulation_id,
        ARRAY[pf.canonical_dish_id, p_dish_id] AS path,
        1 AS depth,
        (pf.canonical_dish_id = p_dish_id) AS is_cycle,
        CASE
          WHEN p_formulation_id IS NULL THEN 'MISSING_CHILD_FORMULATION'
          ELSE 'OK'
        END AS validation_error
      FROM public.yatra_recipe_formulation_ingredients fi
      JOIN public.yatra_recipe_formulations pf ON fi.formulation_id = pf.id AND pf.is_active = true
      WHERE fi.sub_preparation_dish_id = p_dish_id
        AND fi.sub_preparation_formulation_id IS NULL
        AND fi.ingredient_type = 'PREPARATION'

      UNION ALL

      -- Recursive traversal of sub-preparations
      SELECT
        next_fi.sub_preparation_dish_id,
        COALESCE(next_fi.sub_preparation_formulation_id, CASE WHEN next_d.id = p_dish_id THEN p_formulation_id ELSE next_d.default_formulation_id END),
        t.path || next_fi.sub_preparation_dish_id,
        t.depth + 1,
        (next_fi.sub_preparation_dish_id = ANY(t.path)) AS is_cycle,
        CASE
          WHEN COALESCE(next_fi.sub_preparation_formulation_id, CASE WHEN next_d.id = p_dish_id THEN p_formulation_id ELSE next_d.default_formulation_id END) IS NULL THEN 'MISSING_CHILD_FORMULATION'
          WHEN NOT EXISTS (
            SELECT 1 FROM public.yatra_recipe_formulations rf
            WHERE rf.id = COALESCE(next_fi.sub_preparation_formulation_id, CASE WHEN next_d.id = p_dish_id THEN p_formulation_id ELSE next_d.default_formulation_id END)
              AND rf.canonical_dish_id = next_fi.sub_preparation_dish_id
              AND rf.is_active = true
          ) THEN 'INACTIVE_OR_MISMATCHED_CHILD_FORMULATION'
          ELSE 'OK'
        END AS validation_error
      FROM dag_traversal t
      JOIN public.yatra_recipe_formulation_ingredients next_fi
        ON next_fi.formulation_id = t.child_formulation_id
      JOIN public.yatra_canonical_dishes next_d
        ON next_fi.sub_preparation_dish_id = next_d.id
      WHERE next_fi.ingredient_type = 'PREPARATION'
        AND NOT t.is_cycle
        AND t.depth <= 10
        AND t.validation_error = 'OK'
    )
    SELECT
      EXISTS (SELECT 1 FROM dag_traversal WHERE is_cycle OR depth > 10),
      (SELECT array_to_string(path, ' -> ') FROM dag_traversal WHERE is_cycle OR depth > 10 LIMIT 1),
      (SELECT validation_error || ' along path: ' || array_to_string(path, ' -> ') FROM dag_traversal WHERE validation_error <> 'OK' LIMIT 1)
    INTO v_cycle_detected, v_cycle_path, v_dag_err;

    IF v_dag_err IS NOT NULL THEN
      RAISE EXCEPTION 'DAG validation failed closed: %', v_dag_err USING ERRCODE = '23503';
    END IF;

    IF v_cycle_detected THEN
      RAISE EXCEPTION 'Setting default formulation creates a DAG cycle or depth > 10 along path: %', v_cycle_path
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

-- 2. Non-Recursive BEFORE Trigger on Canonical Dishes
CREATE OR REPLACE FUNCTION public.fn_trg_validate_preparation_default_formulation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_preparation = true AND (
    (TG_OP = 'INSERT' AND NEW.default_formulation_id IS NOT NULL)
    OR
    (TG_OP = 'UPDATE' AND (NEW.default_formulation_id IS DISTINCT FROM OLD.default_formulation_id OR NEW.is_active IS DISTINCT FROM OLD.is_active))
  ) THEN
    PERFORM public.fn_validate_preparation_default_dag(NEW.id, NEW.default_formulation_id, NEW.is_active);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prep_default_formulation ON public.yatra_canonical_dishes;
CREATE TRIGGER trg_validate_prep_default_formulation
BEFORE INSERT OR UPDATE OF default_formulation_id, is_active ON public.yatra_canonical_dishes
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_validate_preparation_default_formulation();

-- 3. Explicit Atomic RPC for Changing Preparation Defaults
CREATE OR REPLACE FUNCTION public.fn_set_preparation_default_formulation_atomic(
  p_dish_id UUID,
  p_formulation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_dish RECORD;
BEGIN
  SELECT * INTO v_dish
  FROM public.yatra_canonical_dishes
  WHERE id = p_dish_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_dish.is_preparation THEN
    RAISE EXCEPTION 'Dish % is not a valid preparation', p_dish_id USING ERRCODE = '23503';
  END IF;

  UPDATE public.yatra_canonical_dishes
  SET default_formulation_id = p_formulation_id, updated_at = now()
  WHERE id = p_dish_id;

  RETURN jsonb_build_object('success', true, 'dish_id', p_dish_id, 'default_formulation_id', p_formulation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_set_preparation_default_formulation_atomic(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_set_preparation_default_formulation_atomic(UUID, UUID) TO service_role;

-- ============================================================================
-- Formulation Sync & Creation Engine
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_sync_yatra_recipe_formulation_atomic(UUID, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.fn_sync_yatra_recipe_formulation_atomic(UUID, JSONB, JSONB, JSONB);

CREATE OR REPLACE FUNCTION public.fn_sync_yatra_recipe_formulation_internal(
  p_formulation_id UUID,
  p_header JSONB,
  p_ingredients JSONB,
  p_costing_payload JSONB,
  p_is_initial_create BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_formulation RECORD;
  v_dish RECORD;
  v_batch_yield_qty NUMERIC;
  v_batch_yield_unit TEXT;
  v_ing RECORD;
  v_sub_prep RECORD;
  v_sub_form RECORD;
  v_dep RECORD;
  v_cycle_detected BOOLEAN;
  v_cycle_path TEXT;
  v_dag_err TEXT;
  v_is_cost_relevant_change BOOLEAN := false;
  v_existing_ing_hash TEXT;
  v_new_ing_hash TEXT;
  v_new_version INT;
  v_wac_token RECORD;
  v_conv_token RECORD;
  v_sub_token RECORD;
  v_batch_snap JSONB;
  v_serving_snaps JSONB;
  v_cfg_snap JSONB;
  v_batch_fingerprint TEXT;
  v_serving_fingerprint TEXT;
  v_batch_cost NUMERIC(10,4);
  v_batch_status TEXT;
  v_cfg_cost NUMERIC(10,4);
  v_cfg_status TEXT;
BEGIN
  -- 1. Acquire transaction-scoped global DAG advisory lock
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('yatra_recipe_dag_lock'));

  -- 2. Exclusively lock the formulation row
  SELECT * INTO v_formulation
  FROM public.yatra_recipe_formulations
  WHERE id = p_formulation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Formulation not found: %', p_formulation_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_dish
  FROM public.yatra_canonical_dishes
  WHERE id = v_formulation.canonical_dish_id;

  -- 3. Check for cost-relevant yield changes
  IF p_header IS NOT NULL THEN
    IF p_header ? 'batch_yield_quantity' THEN
      v_batch_yield_qty := (p_header->>'batch_yield_quantity')::NUMERIC;
      IF v_batch_yield_qty IS NOT NULL AND v_batch_yield_qty <= 0 THEN
        RAISE EXCEPTION 'batch_yield_quantity must be positive or null' USING ERRCODE = '22023';
      END IF;
    ELSE
      v_batch_yield_qty := v_formulation.batch_yield_quantity;
    END IF;

    IF p_header ? 'batch_yield_unit' THEN
      v_batch_yield_unit := p_header->>'batch_yield_unit';
      IF v_batch_yield_unit IS NOT NULL AND v_batch_yield_unit NOT IN ('kg', 'g', 'pcs') THEN
        RAISE EXCEPTION 'batch_yield_unit must be kg, g, or pcs. Received: %', v_batch_yield_unit USING ERRCODE = '22023';
      END IF;
    ELSE
      v_batch_yield_unit := v_formulation.batch_yield_unit;
    END IF;

    IF (v_batch_yield_qty IS DISTINCT FROM v_formulation.batch_yield_quantity)
       OR (v_batch_yield_unit IS DISTINCT FROM v_formulation.batch_yield_unit) THEN
      v_is_cost_relevant_change := true;
    END IF;
  ELSE
    v_batch_yield_qty := v_formulation.batch_yield_quantity;
    v_batch_yield_unit := v_formulation.batch_yield_unit;
  END IF;

  -- 4. Check for cost-relevant ingredient changes with trim_scale normalization
  IF p_ingredients IS NOT NULL THEN
    SELECT md5(COALESCE(string_agg(
      fi.ingredient_type || ':' ||
      COALESCE(fi.ingredient_group_id::text, '') || ':' ||
      COALESCE(fi.inventory_item_id::text, '') || ':' ||
      COALESCE(fi.sub_preparation_dish_id::text, '') || ':' ||
      COALESCE(fi.sub_preparation_formulation_id::text, '') || ':' ||
      pg_catalog.trim_scale((fi.quantity)::numeric)::text || ':' ||
      pg_catalog.lower(pg_catalog.btrim(fi.unit)),
      ',' ORDER BY
        fi.ingredient_type,
        COALESCE(fi.ingredient_group_id::text, ''),
        COALESCE(fi.inventory_item_id::text, ''),
        COALESCE(fi.sub_preparation_dish_id::text, ''),
        COALESCE(fi.sub_preparation_formulation_id::text, ''),
        pg_catalog.trim_scale((fi.quantity)::numeric)::text,
        pg_catalog.lower(pg_catalog.btrim(fi.unit))
    ), ''))
    INTO v_existing_ing_hash
    FROM public.yatra_recipe_formulation_ingredients fi
    WHERE fi.formulation_id = p_formulation_id;

    SELECT md5(COALESCE(string_agg(
      (x->>'ingredient_type') || ':' ||
      COALESCE(x->>'ingredient_group_id', '') || ':' ||
      COALESCE(x->>'inventory_item_id', '') || ':' ||
      COALESCE(x->>'sub_preparation_dish_id', '') || ':' ||
      COALESCE(x->>'sub_preparation_formulation_id', '') || ':' ||
      pg_catalog.trim_scale(((x->>'quantity')::numeric))::text || ':' ||
      pg_catalog.lower(pg_catalog.btrim(x->>'unit')),
      ',' ORDER BY
        (x->>'ingredient_type'),
        COALESCE(x->>'ingredient_group_id', ''),
        COALESCE(x->>'inventory_item_id', ''),
        COALESCE(x->>'sub_preparation_dish_id', ''),
        COALESCE(x->>'sub_preparation_formulation_id', ''),
        pg_catalog.trim_scale(((x->>'quantity')::numeric))::text,
        pg_catalog.lower(pg_catalog.btrim(x->>'unit'))
    ), ''))
    INTO v_new_ing_hash
    FROM jsonb_array_elements(p_ingredients) AS x;

    IF v_existing_ing_hash IS DISTINCT FROM v_new_ing_hash THEN
      v_is_cost_relevant_change := true;
    END IF;
  END IF;

  -- Determine version number progression
  IF p_is_initial_create THEN
    v_new_version := 1;
    v_is_cost_relevant_change := true;
  ELSIF v_is_cost_relevant_change THEN
    v_new_version := v_formulation.version_number + 1;
  ELSE
    v_new_version := v_formulation.version_number;
  END IF;

  -- 5. Unit Compatibility Validation
  IF (v_batch_yield_qty IS DISTINCT FROM v_formulation.batch_yield_quantity)
     OR (v_batch_yield_unit IS DISTINCT FROM v_formulation.batch_yield_unit) THEN

    IF v_batch_yield_qty IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.yatra_recipe_formulation_ingredients fi
        JOIN public.yatra_recipe_formulations pf ON fi.formulation_id = pf.id AND pf.is_active = true
        WHERE (fi.sub_preparation_formulation_id = p_formulation_id
           OR (fi.sub_preparation_dish_id = v_dish.id AND fi.sub_preparation_formulation_id IS NULL AND v_dish.default_formulation_id = p_formulation_id))
      ) OR EXISTS (
        SELECT 1 FROM public.yatra_configuration_formulations cf
        JOIN public.yatra_serving_configurations sc ON cf.serving_configuration_id = sc.id AND sc.is_active = true
        WHERE cf.formulation_id = p_formulation_id
      ) THEN
        RAISE EXCEPTION 'Cannot clear batch yield while active parent formulations or serving configurations depend on this formulation'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    -- Hard rejection for parent formulation consumption (Test 16d)
    FOR v_dep IN
      SELECT
        p_dish.name AS parent_dish_name,
        fi.unit AS parent_consumed_unit
      FROM public.yatra_recipe_formulation_ingredients fi
      JOIN public.yatra_recipe_formulations pf ON fi.formulation_id = pf.id AND pf.is_active = true
      JOIN public.yatra_canonical_dishes p_dish ON pf.canonical_dish_id = p_dish.id
      WHERE (fi.sub_preparation_formulation_id = p_formulation_id
         OR (fi.sub_preparation_dish_id = v_dish.id AND fi.sub_preparation_formulation_id IS NULL AND v_dish.default_formulation_id = p_formulation_id))
    LOOP
      IF NOT (
        (v_batch_yield_unit IN ('kg', 'g') AND v_dep.parent_consumed_unit IN ('kg', 'g'))
        OR (v_batch_yield_unit = 'pcs' AND v_dep.parent_consumed_unit = 'pcs')
        OR EXISTS (
          SELECT 1 FROM public.yatra_formulation_output_conversions
          WHERE formulation_id = p_formulation_id
            AND formulation_version = v_new_version
            AND is_verified = true
            AND pg_catalog.lower(pg_catalog.btrim(from_unit)) = pg_catalog.lower(pg_catalog.btrim(v_batch_yield_unit))
            AND pg_catalog.lower(pg_catalog.btrim(to_unit)) = pg_catalog.lower(pg_catalog.btrim(v_dep.parent_consumed_unit))
        )
      ) THEN
        RAISE EXCEPTION 'Cannot change batch yield unit to ''%'': parent recipe % consumes this sub-recipe in ''%'' which cannot be converted to ''%''',
          v_batch_yield_unit, v_dep.parent_dish_name, v_dep.parent_consumed_unit, v_batch_yield_unit
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;

  -- 6. Apply header updates & persist version_number
  IF p_header IS NOT NULL THEN
    UPDATE public.yatra_recipe_formulations
    SET
      name = COALESCE(p_header->>'name', name),
      version_number = v_new_version,
      batch_yield_quantity = v_batch_yield_qty,
      batch_yield_unit = v_batch_yield_unit,
      pre_cooking_input_quantity = CASE WHEN p_header ? 'pre_cooking_input_quantity' THEN (p_header->>'pre_cooking_input_quantity')::NUMERIC ELSE pre_cooking_input_quantity END,
      pre_cooking_input_unit = CASE WHEN p_header ? 'pre_cooking_input_unit' THEN p_header->>'pre_cooking_input_unit' ELSE pre_cooking_input_unit END,
      preparation_method = CASE WHEN p_header ? 'preparation_method' THEN p_header->>'preparation_method' ELSE preparation_method END,
      culinary_notes = CASE WHEN p_header ? 'culinary_notes' THEN p_header->>'culinary_notes' ELSE culinary_notes END,
      updated_at = now()
    WHERE id = p_formulation_id;
  ELSIF v_is_cost_relevant_change THEN
    UPDATE public.yatra_recipe_formulations
    SET version_number = v_new_version, updated_at = now()
    WHERE id = p_formulation_id;
  END IF;

  -- 7. Atomically replace ingredients
  IF p_ingredients IS NOT NULL THEN
    DELETE FROM public.yatra_recipe_formulation_ingredients
    WHERE formulation_id = p_formulation_id;

    FOR v_ing IN SELECT * FROM jsonb_to_recordset(p_ingredients) AS x(
      ingredient_type TEXT,
      ingredient_group_id UUID,
      inventory_item_id UUID,
      sub_preparation_dish_id UUID,
      sub_preparation_formulation_id UUID,
      quantity NUMERIC,
      unit TEXT,
      notes TEXT,
      sort_order INT
    )
    LOOP
      IF v_ing.quantity <= 0 THEN
        RAISE EXCEPTION 'Ingredient quantity must be positive. Received: %', v_ing.quantity USING ERRCODE = '22023';
      END IF;

      IF v_ing.ingredient_type = 'RAW_MATERIAL' THEN
        IF v_ing.ingredient_group_id IS NULL THEN
          RAISE EXCEPTION 'RAW_MATERIAL ingredient requires ingredient_group_id' USING ERRCODE = '23502';
        END IF;

        IF v_ing.inventory_item_id IS NOT NULL THEN
          PERFORM 1 FROM public.inventory_items
          WHERE id = v_ing.inventory_item_id AND group_id = v_ing.ingredient_group_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Pinned inventory item % does not belong to group %', v_ing.inventory_item_id, v_ing.ingredient_group_id USING ERRCODE = '23503';
          END IF;
        END IF;

      ELSIF v_ing.ingredient_type = 'PREPARATION' THEN
        IF v_ing.sub_preparation_dish_id IS NULL THEN
          RAISE EXCEPTION 'PREPARATION ingredient requires sub_preparation_dish_id' USING ERRCODE = '23502';
        END IF;

        SELECT * INTO v_sub_prep
        FROM public.yatra_canonical_dishes
        WHERE id = v_ing.sub_preparation_dish_id;

        IF NOT FOUND OR NOT v_sub_prep.is_preparation THEN
          RAISE EXCEPTION 'Referenced dish % is not an active preparation', v_ing.sub_preparation_dish_id USING ERRCODE = '23503';
        END IF;

        IF v_ing.sub_preparation_dish_id = v_dish.id THEN
          RAISE EXCEPTION 'Circular dependency: Dish cannot consume itself: %', v_dish.name USING ERRCODE = '23514';
        END IF;

        IF v_ing.sub_preparation_formulation_id IS NOT NULL THEN
          SELECT * INTO v_sub_form
          FROM public.yatra_recipe_formulations
          WHERE id = v_ing.sub_preparation_formulation_id
            AND canonical_dish_id = v_ing.sub_preparation_dish_id
            AND is_active = true;

          IF NOT FOUND THEN
            RAISE EXCEPTION 'Pinned sub-preparation formulation % is invalid or inactive', v_ing.sub_preparation_formulation_id USING ERRCODE = '23503';
          END IF;
        ELSE
          IF v_sub_prep.default_formulation_id IS NULL THEN
            RAISE EXCEPTION 'Preparation % has no active default formulation', v_sub_prep.name USING ERRCODE = '23502';
          END IF;

          PERFORM 1 FROM public.yatra_recipe_formulations
          WHERE id = v_sub_prep.default_formulation_id AND is_active = true;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Preparation % default formulation is inactive', v_sub_prep.name USING ERRCODE = '23503';
          END IF;
        END IF;

      ELSE
        RAISE EXCEPTION 'Invalid ingredient_type: %', v_ing.ingredient_type USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.yatra_recipe_formulation_ingredients (
        formulation_id,
        ingredient_type,
        ingredient_group_id,
        inventory_item_id,
        sub_preparation_dish_id,
        sub_preparation_formulation_id,
        quantity,
        unit,
        notes,
        sort_order
      ) VALUES (
        p_formulation_id,
        v_ing.ingredient_type,
        v_ing.ingredient_group_id,
        v_ing.inventory_item_id,
        v_ing.sub_preparation_dish_id,
        v_ing.sub_preparation_formulation_id,
        v_ing.quantity,
        v_ing.unit,
        v_ing.notes,
        COALESCE(v_ing.sort_order, 0)
      );
    END LOOP;

    -- 8. Recursive Full-Graph Cycle & Depth Detection
    WITH RECURSIVE dag_traversal AS (
      SELECT
        fi.sub_preparation_dish_id AS child_dish_id,
        COALESCE(fi.sub_preparation_formulation_id, d.default_formulation_id) AS child_formulation_id,
        ARRAY[v_dish.id, fi.sub_preparation_dish_id] AS path,
        1 AS depth,
        (fi.sub_preparation_dish_id = v_dish.id) AS is_cycle,
        CASE
          WHEN COALESCE(fi.sub_preparation_formulation_id, d.default_formulation_id) IS NULL THEN 'MISSING_CHILD_FORMULATION'
          WHEN NOT EXISTS (
            SELECT 1 FROM public.yatra_recipe_formulations rf
            WHERE rf.id = COALESCE(fi.sub_preparation_formulation_id, d.default_formulation_id)
              AND rf.canonical_dish_id = fi.sub_preparation_dish_id
              AND rf.is_active = true
          ) THEN 'INACTIVE_OR_MISMATCHED_CHILD_FORMULATION'
          ELSE 'OK'
        END AS validation_error
      FROM public.yatra_recipe_formulation_ingredients fi
      JOIN public.yatra_canonical_dishes d ON fi.sub_preparation_dish_id = d.id
      WHERE fi.formulation_id = p_formulation_id
        AND fi.ingredient_type = 'PREPARATION'

      UNION ALL

      SELECT
        next_fi.sub_preparation_dish_id,
        COALESCE(next_fi.sub_preparation_formulation_id, next_d.default_formulation_id),
        t.path || next_fi.sub_preparation_dish_id,
        t.depth + 1,
        (next_fi.sub_preparation_dish_id = ANY(t.path)) AS is_cycle,
        CASE
          WHEN COALESCE(next_fi.sub_preparation_formulation_id, next_d.default_formulation_id) IS NULL THEN 'MISSING_CHILD_FORMULATION'
          WHEN NOT EXISTS (
            SELECT 1 FROM public.yatra_recipe_formulations rf
            WHERE rf.id = COALESCE(next_fi.sub_preparation_formulation_id, next_d.default_formulation_id)
              AND rf.canonical_dish_id = next_fi.sub_preparation_dish_id
              AND rf.is_active = true
          ) THEN 'INACTIVE_OR_MISMATCHED_CHILD_FORMULATION'
          ELSE 'OK'
        END AS validation_error
      FROM dag_traversal t
      JOIN public.yatra_recipe_formulation_ingredients next_fi
        ON next_fi.formulation_id = t.child_formulation_id
      JOIN public.yatra_canonical_dishes next_d
        ON next_fi.sub_preparation_dish_id = next_d.id
      WHERE next_fi.ingredient_type = 'PREPARATION'
        AND NOT t.is_cycle
        AND t.depth <= 10
        AND t.validation_error = 'OK'
    )
    SELECT
      EXISTS (SELECT 1 FROM dag_traversal WHERE is_cycle OR depth > 10),
      (SELECT array_to_string(path, ' -> ') FROM dag_traversal WHERE is_cycle OR depth > 10 LIMIT 1),
      (SELECT validation_error || ' along path: ' || array_to_string(path, ' -> ') FROM dag_traversal WHERE validation_error <> 'OK' LIMIT 1)
    INTO v_cycle_detected, v_cycle_path, v_dag_err;

    IF v_dag_err IS NOT NULL THEN
      RAISE EXCEPTION 'DAG validation failed closed: %', v_dag_err USING ERRCODE = '23503';
    END IF;

    IF v_cycle_detected THEN
      RAISE EXCEPTION 'Recipe DAG cycle or excessive depth (>10) detected along path: %', v_cycle_path
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 9. Stale-Input Revalidation & Deterministic Costing Snapshot Persistence
  IF v_is_cost_relevant_change THEN
    IF p_costing_payload IS NULL THEN
      RAISE EXCEPTION 'Cost-relevant formulation change requires p_costing_payload from authoritative server costing engine'
        USING ERRCODE = '23502';
    END IF;

    -- 9a. Revalidate WAC valuation tokens
    IF p_costing_payload ? 'source_tokens' AND (p_costing_payload->'source_tokens') ? 'wac_tokens' THEN
      FOR v_wac_token IN
        SELECT * FROM jsonb_to_recordset(p_costing_payload->'source_tokens'->'wac_tokens') AS w(
          item_id UUID, group_id UUID, token_updated_at TIMESTAMPTZ
        )
      LOOP
        IF v_wac_token.group_id IS NOT NULL THEN
          PERFORM 1 FROM public.logical_ingredient_groups
          WHERE id = v_wac_token.group_id AND updated_at = v_wac_token.token_updated_at;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Stale costing payload: ingredient group % valuation rate updated concurrently', v_wac_token.group_id
              USING ERRCODE = '40001';
          END IF;
        ELSIF v_wac_token.item_id IS NOT NULL THEN
          PERFORM 1 FROM public.inventory_items
          WHERE id = v_wac_token.item_id AND updated_at = v_wac_token.token_updated_at;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Stale costing payload: inventory item % valuation rate updated concurrently', v_wac_token.item_id
              USING ERRCODE = '40001';
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- 9b. Revalidate conversion tokens
    IF p_costing_payload ? 'source_tokens' AND (p_costing_payload->'source_tokens') ? 'conversion_tokens' THEN
      FOR v_conv_token IN
        SELECT * FROM jsonb_to_recordset(p_costing_payload->'source_tokens'->'conversion_tokens') AS c(
          conv_id UUID, conv_table TEXT, token_updated_at TIMESTAMPTZ, is_verified BOOLEAN
        )
      LOOP
        IF v_conv_token.conv_table = 'ingredient' THEN
          PERFORM 1 FROM public.yatra_ingredient_unit_conversions
          WHERE id = v_conv_token.conv_id AND is_verified = true AND updated_at = v_conv_token.token_updated_at;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Stale costing payload: ingredient conversion % modified or unverified', v_conv_token.conv_id
              USING ERRCODE = '40001';
          END IF;
        ELSIF v_conv_token.conv_table = 'output' THEN
          PERFORM 1 FROM public.yatra_formulation_output_conversions
          WHERE id = v_conv_token.conv_id AND is_verified = true AND updated_at = v_conv_token.token_updated_at;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Stale costing payload: output conversion % modified or unverified', v_conv_token.conv_id
              USING ERRCODE = '40001';
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- 9c. Revalidate sub-preparation formulation version tokens
    IF p_costing_payload ? 'source_tokens' AND (p_costing_payload->'source_tokens') ? 'sub_prep_tokens' THEN
      FOR v_sub_token IN
        SELECT * FROM jsonb_to_recordset(p_costing_payload->'source_tokens'->'sub_prep_tokens') AS s(
          dish_id UUID, formulation_id UUID, version_number INT, is_default BOOLEAN
        )
      LOOP
        PERFORM 1 FROM public.yatra_recipe_formulations
        WHERE id = v_sub_token.formulation_id AND version_number = v_sub_token.version_number AND is_active = true;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Stale costing payload: sub-preparation formulation % version modified concurrently', v_sub_token.formulation_id
            USING ERRCODE = '40001';
        END IF;

        IF v_sub_token.is_default THEN
          PERFORM 1 FROM public.yatra_canonical_dishes
          WHERE id = v_sub_token.dish_id AND default_formulation_id = v_sub_token.formulation_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Stale costing payload: preparation % default formulation changed concurrently', v_sub_token.dish_id
              USING ERRCODE = '40001';
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- 9d. Insert batch-level snapshot with deterministic timestamp-free fingerprint
    v_batch_snap := p_costing_payload->'batch_snapshot';
    v_batch_status := v_batch_snap->>'costing_status';
    v_batch_cost := (v_batch_snap->>'batch_cost')::NUMERIC;

    v_batch_fingerprint := md5(
      p_formulation_id::text || ':' ||
      v_new_version::text || ':' ||
      COALESCE(v_batch_status, '') || ':' ||
      COALESCE(v_batch_cost::text, 'NULL') || ':' ||
      COALESCE(v_batch_yield_qty::text, 'NULL') || ':' ||
      COALESCE(v_batch_yield_unit, '') || ':' ||
      COALESCE(v_new_ing_hash, '')
    );

    INSERT INTO public.yatra_costing_snapshots (
      formulation_id,
      formulation_version,
      costing_status,
      serving_configuration_id,
      batch_cost,
      usable_batch_yield,
      usable_batch_unit,
      resolved_sub_preparations_json,
      ingredient_breakdown_json,
      snapshot_fingerprint
    ) VALUES (
      p_formulation_id,
      v_new_version,
      v_batch_status,
      NULL,
      v_batch_cost,
      v_batch_yield_qty,
      v_batch_yield_unit,
      COALESCE(v_batch_snap->'resolved_sub_preparations', '[]'::jsonb),
      COALESCE(v_batch_snap->'ingredient_breakdown', '[]'::jsonb),
      v_batch_fingerprint
    ) ON CONFLICT (formulation_id, COALESCE(serving_configuration_id, '00000000-0000-0000-0000-000000000000'::uuid), snapshot_fingerprint)
    DO NOTHING;

    -- 9e. Insert per-serving-configuration snapshots
    v_serving_snaps := p_costing_payload->'serving_snapshots';
    IF v_serving_snaps IS NOT NULL AND jsonb_array_length(v_serving_snaps) > 0 THEN
      FOR v_cfg_snap IN SELECT * FROM jsonb_array_elements(v_serving_snaps)
      LOOP
        v_cfg_status := v_cfg_snap->>'costing_status';
        v_cfg_cost := (v_cfg_snap->>'calculated_serving_cost')::NUMERIC;

        v_serving_fingerprint := md5(
          p_formulation_id::text || ':' ||
          v_new_version::text || ':' ||
          (v_cfg_snap->>'serving_configuration_id') || ':' ||
          COALESCE(v_cfg_status, '') || ':' ||
          COALESCE(v_batch_cost::text, 'NULL') || ':' ||
          COALESCE(v_cfg_cost::text, 'NULL') || ':' ||
          COALESCE(v_cfg_snap->>'serving_portion_quantity', '') || ':' ||
          COALESCE(v_cfg_snap->>'serving_portion_unit', '') || ':' ||
          COALESCE(v_cfg_snap->>'output_conversion_multiplier', '')
        );

        INSERT INTO public.yatra_costing_snapshots (
          formulation_id,
          formulation_version,
          costing_status,
          serving_configuration_id,
          batch_cost,
          usable_batch_yield,
          usable_batch_unit,
          output_conversion_multiplier,
          output_conversion_verified,
          serving_portion_quantity,
          serving_portion_unit,
          calculated_serving_cost,
          resolved_sub_preparations_json,
          ingredient_breakdown_json,
          snapshot_fingerprint
        ) VALUES (
          p_formulation_id,
          v_new_version,
          v_cfg_status,
          (v_cfg_snap->>'serving_configuration_id')::UUID,
          v_batch_cost,
          v_batch_yield_qty,
          v_batch_yield_unit,
          (v_cfg_snap->>'output_conversion_multiplier')::NUMERIC,
          (v_cfg_snap->>'output_conversion_verified')::BOOLEAN,
          (v_cfg_snap->>'serving_portion_quantity')::NUMERIC,
          (v_cfg_snap->>'serving_portion_unit'),
          v_cfg_cost,
          COALESCE(v_batch_snap->'resolved_sub_preparations', '[]'::jsonb),
          COALESCE(v_batch_snap->'ingredient_breakdown', '[]'::jsonb),
          v_serving_fingerprint
        ) ON CONFLICT (formulation_id, COALESCE(serving_configuration_id, '00000000-0000-0000-0000-000000000000'::uuid), snapshot_fingerprint)
        DO NOTHING;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'formulation_id', p_formulation_id,
    'version_number', v_new_version,
    'cost_relevant_change', v_is_cost_relevant_change
  );
END;
$$;

-- Public 4-Argument Callable Interface
CREATE OR REPLACE FUNCTION public.fn_sync_yatra_recipe_formulation_atomic(
  p_formulation_id UUID,
  p_header JSONB,
  p_ingredients JSONB,
  p_costing_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN public.fn_sync_yatra_recipe_formulation_internal(
    p_formulation_id, p_header, p_ingredients, p_costing_payload, false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_yatra_recipe_formulation_atomic(UUID, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_yatra_recipe_formulation_atomic(UUID, JSONB, JSONB, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.fn_sync_yatra_recipe_formulation_internal(UUID, JSONB, JSONB, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_yatra_recipe_formulation_internal(UUID, JSONB, JSONB, JSONB, BOOLEAN) TO service_role;

-- Initial Create RPC
CREATE OR REPLACE FUNCTION public.fn_create_yatra_recipe_formulation_atomic(
  p_canonical_dish_id UUID,
  p_name TEXT,
  p_header JSONB,
  p_ingredients JSONB,
  p_costing_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_formulation_id UUID;
  v_res JSONB;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('yatra_recipe_dag_lock'));

  PERFORM 1 FROM public.yatra_canonical_dishes WHERE id = p_canonical_dish_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical dish not found: %', p_canonical_dish_id USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number,
    batch_yield_quantity, batch_yield_unit,
    pre_cooking_input_quantity, pre_cooking_input_unit,
    preparation_method, culinary_notes, is_active
  ) VALUES (
    p_canonical_dish_id,
    p_name,
    1,
    (p_header->>'batch_yield_quantity')::NUMERIC,
    p_header->>'batch_yield_unit',
    (p_header->>'pre_cooking_input_quantity')::NUMERIC,
    p_header->>'pre_cooking_input_unit',
    p_header->>'preparation_method',
    p_header->>'culinary_notes',
    true
  ) RETURNING id INTO v_formulation_id;

  v_res := public.fn_sync_yatra_recipe_formulation_internal(
    v_formulation_id, NULL, p_ingredients, p_costing_payload, true
  );

  RETURN jsonb_build_object(
    'success', true,
    'formulation_id', v_formulation_id,
    'version_number', 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_yatra_recipe_formulation_atomic(UUID, TEXT, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_yatra_recipe_formulation_atomic(UUID, TEXT, JSONB, JSONB, JSONB) TO service_role;

-- ============================================================================
-- Atomic Menu Item Merge RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_merge_pos_menu_items_atomic(
  p_target_menu_item_id UUID,
  p_source_menu_item_ids UUID[],
  p_merged_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_source_id UUID;
  v_deduped_source_ids UUID[];
  v_target RECORD;
  v_source RECORD;
  v_existing_alias_target UUID;
  v_snapshot_json JSONB;
BEGIN
  -- 1. Validate target menu item exists and is active
  SELECT * INTO v_target FROM public.pos_menu_items WHERE id = p_target_menu_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target menu item % not found', p_target_menu_item_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_target.is_active THEN
    RAISE EXCEPTION 'Target menu item % is inactive', p_target_menu_item_id USING ERRCODE = '23514';
  END IF;

  -- 2. Deduplicate source menu item IDs and exclude target
  SELECT ARRAY_AGG(DISTINCT s_id)
  INTO v_deduped_source_ids
  FROM unnest(p_source_menu_item_ids) AS s_id
  WHERE s_id IS NOT NULL AND s_id <> p_target_menu_item_id;

  IF v_deduped_source_ids IS NULL OR array_length(v_deduped_source_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'target_menu_item_id', p_target_menu_item_id, 'merged_count', 0);
  END IF;

  FOREACH v_source_id IN ARRAY v_deduped_source_ids
  LOOP
    SELECT * INTO v_source FROM public.pos_menu_items WHERE id = v_source_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source menu item % not found', v_source_id USING ERRCODE = 'P0002';
    END IF;

    -- Merge Idempotency & Conflict Check
    IF NOT v_source.is_active THEN
      IF EXISTS (
        SELECT 1 FROM public.yatra_menu_merge_logs
        WHERE source_menu_item_id = v_source_id AND target_menu_item_id = p_target_menu_item_id
      ) THEN
        -- Idempotent no-op: already merged to this target
        CONTINUE;
      ELSE
        RAISE EXCEPTION 'Source menu item % is already inactive and was not merged into target % (HTTP 409 Conflict)',
          v_source_id, p_target_menu_item_id USING ERRCODE = '23505';
      END IF;
    END IF;

    -- Product type compatibility check
    IF NOT v_source.needs_setup AND v_source.product_type IS DISTINCT FROM v_target.product_type THEN
      RAISE EXCEPTION 'Cannot merge source % (product_type %) into target % (product_type %): mismatched product types',
        v_source.name, v_source.product_type, v_target.name, v_target.product_type USING ERRCODE = '23514';
    END IF;

    -- 3. Capture Comprehensive Pre-Merge Snapshot inside source_snapshot_json
    SELECT jsonb_build_object(
      'menu_item', to_jsonb(v_source),
      'aliases', (SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM public.pos_menu_item_aliases a WHERE a.menu_item_id = v_source_id),
      'external_mappings', (SELECT COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb) FROM public.pos_external_item_mappings e WHERE e.menu_item_id = v_source_id),
      'open_item_mappings', (SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) FROM public.pos_open_item_mappings o WHERE o.target_menu_item_id = v_source_id),
      'compositions', (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM public.yatra_menu_item_compositions c WHERE c.menu_item_id = v_source_id)
    ) INTO v_snapshot_json;

    -- 4. Handle pos_menu_item_aliases (NO updated_at column on this table)
    SELECT menu_item_id INTO v_existing_alias_target
    FROM public.pos_menu_item_aliases
    WHERE lower(trim(alias)) = lower(trim(v_source.name));

    IF v_existing_alias_target IS NULL THEN
      INSERT INTO public.pos_menu_item_aliases (menu_item_id, alias, normalized_alias)
      VALUES (p_target_menu_item_id, v_source.name, v_source.normalized_name);
    ELSIF v_existing_alias_target = v_source_id THEN
      UPDATE public.pos_menu_item_aliases
      SET menu_item_id = p_target_menu_item_id
      WHERE lower(trim(alias)) = lower(trim(v_source.name));
    ELSIF v_existing_alias_target <> p_target_menu_item_id THEN
      RAISE EXCEPTION 'Alias % already points to different menu item % (HTTP 409 Conflict)', v_source.name, v_existing_alias_target
        USING ERRCODE = '23505';
    END IF;

    -- Repoint remaining aliases belonging to source (without updated_at)
    UPDATE public.pos_menu_item_aliases
    SET menu_item_id = p_target_menu_item_id
    WHERE menu_item_id = v_source_id;

    -- 5. Handle pos_external_item_mappings
    DELETE FROM public.pos_external_item_mappings s
    WHERE s.menu_item_id = v_source_id
      AND EXISTS (
        SELECT 1 FROM public.pos_external_item_mappings t
        WHERE t.provider = s.provider AND t.outlet_id = s.outlet_id AND t.external_item_id = s.external_item_id
          AND t.menu_item_id = p_target_menu_item_id
      );

    UPDATE public.pos_external_item_mappings
    SET menu_item_id = p_target_menu_item_id, updated_at = now()
    WHERE menu_item_id = v_source_id;

    -- 6. Handle pos_open_item_mappings
    DELETE FROM public.pos_open_item_mappings s
    WHERE s.target_menu_item_id = v_source_id
      AND EXISTS (
        SELECT 1 FROM public.pos_open_item_mappings t
        WHERE t.provider = s.provider AND t.outlet_id = s.outlet_id AND t.normalized_description = s.normalized_description
          AND t.target_menu_item_id = p_target_menu_item_id
      );

    UPDATE public.pos_open_item_mappings
    SET target_menu_item_id = p_target_menu_item_id
    WHERE target_menu_item_id = v_source_id;

    -- 7. Repoint yatra_combos_thalis
    UPDATE public.yatra_combos_thalis
    SET menu_item_id = p_target_menu_item_id, updated_at = now()
    WHERE menu_item_id = v_source_id;

    -- 8. Repoint or validate yatra_menu_item_compositions
    IF EXISTS (SELECT 1 FROM public.yatra_menu_item_compositions WHERE menu_item_id = v_source_id) THEN
      IF NOT EXISTS (SELECT 1 FROM public.yatra_menu_item_compositions WHERE menu_item_id = p_target_menu_item_id) THEN
        UPDATE public.yatra_menu_item_compositions
        SET menu_item_id = p_target_menu_item_id, updated_at = now()
        WHERE menu_item_id = v_source_id;
      ELSE
        RAISE EXCEPTION 'Merge conflict on compositions: both source % and target % have active combo compositions',
          v_source_id, p_target_menu_item_id USING ERRCODE = '23505';
      END IF;
    END IF;

    -- 9. Mark source inactive & record merge log
    UPDATE public.pos_menu_items SET is_active = false, updated_at = now() WHERE id = v_source_id;

    INSERT INTO public.yatra_menu_merge_logs (target_menu_item_id, source_menu_item_id, merged_by, source_snapshot_json)
    VALUES (p_target_menu_item_id, v_source_id, p_merged_by, v_snapshot_json);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'target_menu_item_id', p_target_menu_item_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_merge_pos_menu_items_atomic(UUID, UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_merge_pos_menu_items_atomic(UUID, UUID[], UUID) TO service_role;

-- ============================================================================
-- Historical Sales Aggregation RPCs (Channel Filtered & Active Item Filtered)
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_menu_sales_aggregation(DATE, DATE);
DROP FUNCTION IF EXISTS public.get_menu_sales_aggregation(DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.get_menu_item_daily_sales(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_menu_item_daily_sales(UUID, DATE, DATE, TEXT);

CREATE OR REPLACE FUNCTION public.get_menu_sales_aggregation(
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_channel TEXT DEFAULT 'ALL'
)
RETURNS TABLE (
  menu_item_id UUID,
  units_sold NUMERIC(14, 2),
  net_sales NUMERIC(14, 2),
  units_dine_in NUMERIC(14, 2),
  units_takeaway NUMERIC(14, 2),
  units_home_delivery NUMERIC(14, 2),
  units_lancho NUMERIC(14, 2),
  units_unknown NUMERIC(14, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_channel IS NOT NULL AND UPPER(TRIM(p_channel)) NOT IN
    ('ALL', 'DINE_IN', 'TAKEAWAY', 'HOME_DELIVERY', 'LANCHO', 'UNKNOWN') THEN
    RAISE EXCEPTION 'Unsupported menu sales channel: %', p_channel USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH item_name_map AS (
    SELECT LOWER(TRIM(p.name)) AS norm_name, p.id AS mapped_menu_item_id, 1 AS priority
    FROM public.pos_menu_items p
    WHERE p.name IS NOT NULL AND TRIM(p.name) <> '' AND p.is_active = true
    UNION ALL
    SELECT LOWER(TRIM(p.normalized_name)), p.id, 2
    FROM public.pos_menu_items p
    WHERE p.normalized_name IS NOT NULL AND TRIM(p.normalized_name) <> '' AND p.is_active = true
    UNION ALL
    SELECT LOWER(TRIM(a.alias)), a.menu_item_id, 3
    FROM public.pos_menu_item_aliases a
    WHERE a.alias IS NOT NULL AND TRIM(a.alias) <> ''
    UNION ALL
    SELECT LOWER(TRIM(a.normalized_alias)), a.menu_item_id, 3
    FROM public.pos_menu_item_aliases a
    WHERE a.normalized_alias IS NOT NULL AND TRIM(a.normalized_alias) <> ''
  ), best_priority AS (
    SELECT norm_name, MIN(priority) AS priority
    FROM item_name_map
    GROUP BY norm_name
  ), deduped_map AS (
    SELECT m.norm_name, (ARRAY_AGG(m.mapped_menu_item_id))[1] AS mapped_menu_item_id
    FROM item_name_map m
    JOIN best_priority b ON b.norm_name = m.norm_name AND b.priority = m.priority
    GROUP BY m.norm_name
    HAVING COUNT(DISTINCT m.mapped_menu_item_id) = 1
  ), classified_sales AS (
    SELECT
      m.mapped_menu_item_id,
      s.quantity,
      s.net_sales,
      CASE
        WHEN COALESCE(s.area, '') ILIKE '%lancho%'
          OR COALESCE(s.order_type, '') ILIKE '%lancho%'
          OR COALESCE(s.payment_type, '') ILIKE '%lancho%' THEN 'LANCHO'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'dine in' THEN 'DINE_IN'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'pick up'
          AND LOWER(TRIM(COALESCE(s.area, ''))) = 'parcel' THEN 'TAKEAWAY'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'delivery(parcel)'
          AND LOWER(TRIM(COALESCE(s.area, ''))) = 'home delivery' THEN 'HOME_DELIVERY'
        ELSE 'UNKNOWN'
      END AS sales_channel
    FROM public.sales_order_items s
    JOIN deduped_map m ON LOWER(TRIM(s.item_name)) = m.norm_name
    WHERE s.status = 'Success'
      AND (p_date_from IS NULL OR s.business_date >= p_date_from)
      AND (p_date_to IS NULL OR s.business_date <= p_date_to)
  )
  SELECT
    s.mapped_menu_item_id,
    ROUND(COALESCE(SUM(s.quantity), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.net_sales), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.quantity) FILTER (WHERE s.sales_channel = 'DINE_IN'), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.quantity) FILTER (WHERE s.sales_channel = 'TAKEAWAY'), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.quantity) FILTER (WHERE s.sales_channel = 'HOME_DELIVERY'), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.quantity) FILTER (WHERE s.sales_channel = 'LANCHO'), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.quantity) FILTER (WHERE s.sales_channel = 'UNKNOWN'), 0)::NUMERIC, 2)
  FROM classified_sales s
  WHERE p_channel IS NULL OR UPPER(TRIM(p_channel)) = 'ALL'
    OR s.sales_channel = UPPER(TRIM(p_channel))
  GROUP BY s.mapped_menu_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_sales_aggregation(DATE, DATE, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_menu_sales_aggregation(DATE, DATE, TEXT) FROM anon, public;

CREATE OR REPLACE FUNCTION public.get_menu_item_daily_sales(
  p_menu_item_id UUID,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_channel TEXT DEFAULT 'ALL'
)
RETURNS TABLE (
  business_date DATE,
  units_sold NUMERIC(14, 2),
  net_sales NUMERIC(14, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_channel IS NOT NULL AND UPPER(TRIM(p_channel)) NOT IN
    ('ALL', 'DINE_IN', 'TAKEAWAY', 'HOME_DELIVERY', 'LANCHO', 'UNKNOWN') THEN
    RAISE EXCEPTION 'Unsupported menu sales channel: %', p_channel USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH item_name_map AS (
    SELECT LOWER(TRIM(p.name)) AS norm_name, p.id AS mapped_menu_item_id, 1 AS priority
    FROM public.pos_menu_items p
    WHERE p.name IS NOT NULL AND TRIM(p.name) <> '' AND p.is_active = true
    UNION ALL
    SELECT LOWER(TRIM(p.normalized_name)), p.id, 2
    FROM public.pos_menu_items p
    WHERE p.normalized_name IS NOT NULL AND TRIM(p.normalized_name) <> '' AND p.is_active = true
    UNION ALL
    SELECT LOWER(TRIM(a.alias)), a.menu_item_id, 3
    FROM public.pos_menu_item_aliases a
    WHERE a.alias IS NOT NULL AND TRIM(a.alias) <> ''
    UNION ALL
    SELECT LOWER(TRIM(a.normalized_alias)), a.menu_item_id, 3
    FROM public.pos_menu_item_aliases a
    WHERE a.normalized_alias IS NOT NULL AND TRIM(a.normalized_alias) <> ''
  ), best_priority AS (
    SELECT norm_name, MIN(priority) AS priority
    FROM item_name_map
    GROUP BY norm_name
  ), deduped_map AS (
    SELECT m.norm_name, (ARRAY_AGG(m.mapped_menu_item_id))[1] AS mapped_menu_item_id
    FROM item_name_map m
    JOIN best_priority b ON b.norm_name = m.norm_name AND b.priority = m.priority
    GROUP BY m.norm_name
    HAVING COUNT(DISTINCT m.mapped_menu_item_id) = 1
  ), classified_sales AS (
    SELECT
      s.business_date,
      s.quantity,
      s.net_sales,
      CASE
        WHEN COALESCE(s.area, '') ILIKE '%lancho%'
          OR COALESCE(s.order_type, '') ILIKE '%lancho%'
          OR COALESCE(s.payment_type, '') ILIKE '%lancho%' THEN 'LANCHO'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'dine in' THEN 'DINE_IN'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'pick up'
          AND LOWER(TRIM(COALESCE(s.area, ''))) = 'parcel' THEN 'TAKEAWAY'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'delivery(parcel)'
          AND LOWER(TRIM(COALESCE(s.area, ''))) = 'home delivery' THEN 'HOME_DELIVERY'
        ELSE 'UNKNOWN'
      END AS sales_channel
    FROM public.sales_order_items s
    JOIN deduped_map m ON LOWER(TRIM(s.item_name)) = m.norm_name
    WHERE s.status = 'Success'
      AND m.mapped_menu_item_id = p_menu_item_id
      AND (p_date_from IS NULL OR s.business_date >= p_date_from)
      AND (p_date_to IS NULL OR s.business_date <= p_date_to)
  )
  SELECT
    s.business_date,
    ROUND(COALESCE(SUM(s.quantity), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.net_sales), 0)::NUMERIC, 2)
  FROM classified_sales s
  WHERE p_channel IS NULL OR UPPER(TRIM(p_channel)) = 'ALL'
    OR s.sales_channel = UPPER(TRIM(p_channel))
  GROUP BY s.business_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_item_daily_sales(UUID, DATE, DATE, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_menu_item_daily_sales(UUID, DATE, DATE, TEXT) FROM anon, public;

-- ============================================================================
-- Safe Catalog View
-- ============================================================================

CREATE OR REPLACE VIEW public.view_pos_menu_catalog
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.name,
  p.name_hi,
  p.name_hi_is_custom,
  p.online_name,
  p.parent_category,
  p.category,
  p.category_id,
  p.category_online_display,
  p.price,
  p.gst_percent,
  p.tax_type,
  p.is_active,
  p.needs_setup,
  p.normalized_name,
  p.canonical_dish_id,
  p.serving_configuration_id,
  p.product_type,
  p.default_service_channel,
  p.created_at,
  p.updated_at
FROM public.pos_menu_items p
WHERE p.is_active = true;

GRANT SELECT ON public.view_pos_menu_catalog TO authenticated, service_role;

-- ============================================================================
-- Row Level Security & Column Privilege Hardening
-- ============================================================================

ALTER TABLE public.yatra_canonical_dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_serving_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_recipe_formulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_recipe_formulation_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_configuration_formulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_menu_item_compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_ingredient_unit_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_formulation_output_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_costing_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_external_item_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_open_item_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yatra_menu_merge_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated Read Policies
DROP POLICY IF EXISTS "dishes_read_authenticated" ON public.yatra_canonical_dishes;
CREATE POLICY "dishes_read_authenticated" ON public.yatra_canonical_dishes FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "serving_config_read_authenticated" ON public.yatra_serving_configurations;
CREATE POLICY "serving_config_read_authenticated" ON public.yatra_serving_configurations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "formulations_read_authenticated" ON public.yatra_recipe_formulations;
CREATE POLICY "formulations_read_authenticated" ON public.yatra_recipe_formulations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ingredients_read_authenticated" ON public.yatra_recipe_formulation_ingredients;
CREATE POLICY "ingredients_read_authenticated" ON public.yatra_recipe_formulation_ingredients FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "config_form_read_authenticated" ON public.yatra_configuration_formulations;
CREATE POLICY "config_form_read_authenticated" ON public.yatra_configuration_formulations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "compositions_read_authenticated" ON public.yatra_menu_item_compositions;
CREATE POLICY "compositions_read_authenticated" ON public.yatra_menu_item_compositions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ing_conv_read_authenticated" ON public.yatra_ingredient_unit_conversions;
CREATE POLICY "ing_conv_read_authenticated" ON public.yatra_ingredient_unit_conversions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "output_conv_read_authenticated" ON public.yatra_formulation_output_conversions;
CREATE POLICY "output_conv_read_authenticated" ON public.yatra_formulation_output_conversions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "pos_ext_read_authenticated" ON public.pos_external_item_mappings;
CREATE POLICY "pos_ext_read_authenticated" ON public.pos_external_item_mappings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "pos_open_read_authenticated" ON public.pos_open_item_mappings;
CREATE POLICY "pos_open_read_authenticated" ON public.pos_open_item_mappings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "merge_logs_read_authenticated" ON public.yatra_menu_merge_logs;
CREATE POLICY "merge_logs_read_authenticated" ON public.yatra_menu_merge_logs FOR SELECT TO authenticated USING (true);

-- Admin Mutation Policies
DROP POLICY IF EXISTS "dishes_admin_all" ON public.yatra_canonical_dishes;
CREATE POLICY "dishes_admin_all" ON public.yatra_canonical_dishes FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "serving_config_admin_all" ON public.yatra_serving_configurations;
CREATE POLICY "serving_config_admin_all" ON public.yatra_serving_configurations FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "formulations_admin_all" ON public.yatra_recipe_formulations;
CREATE POLICY "formulations_admin_all" ON public.yatra_recipe_formulations FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "compositions_admin_all" ON public.yatra_menu_item_compositions;
CREATE POLICY "compositions_admin_all" ON public.yatra_menu_item_compositions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "ing_conv_admin_all" ON public.yatra_ingredient_unit_conversions;
CREATE POLICY "ing_conv_admin_all" ON public.yatra_ingredient_unit_conversions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "output_conv_admin_all" ON public.yatra_formulation_output_conversions;
CREATE POLICY "output_conv_admin_all" ON public.yatra_formulation_output_conversions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "pos_ext_admin_all" ON public.pos_external_item_mappings;
CREATE POLICY "pos_ext_admin_all" ON public.pos_external_item_mappings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "pos_open_admin_all" ON public.pos_open_item_mappings;
CREATE POLICY "pos_open_admin_all" ON public.pos_open_item_mappings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "merge_logs_admin_all" ON public.yatra_menu_merge_logs;
CREATE POLICY "merge_logs_admin_all" ON public.yatra_menu_merge_logs FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Standard Table Grants (Preserve authenticated client operation, RLS controls access)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yatra_canonical_dishes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yatra_serving_configurations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yatra_recipe_formulations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yatra_recipe_formulation_ingredients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yatra_configuration_formulations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yatra_menu_item_compositions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yatra_ingredient_unit_conversions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yatra_formulation_output_conversions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_external_item_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_open_item_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yatra_menu_merge_logs TO authenticated;

-- Costing Snapshots: STRICTLY service_role only
REVOKE ALL ON public.yatra_costing_snapshots FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.yatra_costing_snapshots TO service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
