-- Checkpoint 2.1: Final Hardening, Deferred Transaction-Safe Group WAC Sync & Sales Aggregation
-- Migration: 20261031120000_checkpoint2_1_hardening.sql

-- 1. Upgrade Column Precision to NUMERIC(16, 6) on logical_ingredient_groups
ALTER TABLE public.logical_ingredient_groups 
ALTER COLUMN last_valid_wac TYPE NUMERIC(16, 6);

-- 2. Helper function: Unit Conversion Factor between inventory_items unit and group base_unit
CREATE OR REPLACE FUNCTION public.fn_get_unit_conversion_factor(
  p_from_unit_id UUID,
  p_to_unit_id UUID,
  p_item_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from_symbol TEXT;
  v_to_symbol TEXT;
  v_m_from NUMERIC;
  v_m_to NUMERIC;
  v_v_from NUMERIC;
  v_v_to NUMERIC;
  v_custom_factor NUMERIC;
  v_pack_size NUMERIC;
BEGIN
  IF p_from_unit_id IS NULL OR p_to_unit_id IS NULL OR p_from_unit_id = p_to_unit_id THEN
    RETURN 1.0;
  END IF;

  -- Custom unit conversions table check
  SELECT conversion_factor INTO v_custom_factor
  FROM public.custom_unit_conversions
  WHERE from_unit_id = p_from_unit_id AND to_unit_id = p_to_unit_id
  LIMIT 1;

  IF v_custom_factor IS NOT NULL AND v_custom_factor > 0 THEN
    RETURN v_custom_factor;
  END IF;

  SELECT (1.0 / conversion_factor) INTO v_custom_factor
  FROM public.custom_unit_conversions
  WHERE from_unit_id = p_to_unit_id AND to_unit_id = p_from_unit_id
  LIMIT 1;

  IF v_custom_factor IS NOT NULL AND v_custom_factor > 0 THEN
    RETURN v_custom_factor;
  END IF;

  -- Standard mass and volume units
  SELECT LOWER(TRIM(symbol)) INTO v_from_symbol FROM public.units WHERE id = p_from_unit_id;
  SELECT LOWER(TRIM(symbol)) INTO v_to_symbol FROM public.units WHERE id = p_to_unit_id;

  IF v_from_symbol IS NULL OR v_to_symbol IS NULL OR v_from_symbol = v_to_symbol THEN
    RETURN 1.0;
  END IF;

  -- Mass: base = gram (g)
  v_m_from := CASE v_from_symbol
    WHEN 'mg' THEN 0.001
    WHEN 'g' THEN 1.0
    WHEN 'gm' THEN 1.0
    WHEN 'kg' THEN 1000.0
    WHEN 'chutki' THEN 0.36
    ELSE NULL
  END;

  v_m_to := CASE v_to_symbol
    WHEN 'mg' THEN 0.001
    WHEN 'g' THEN 1.0
    WHEN 'gm' THEN 1.0
    WHEN 'kg' THEN 1000.0
    WHEN 'chutki' THEN 0.36
    ELSE NULL
  END;

  IF v_m_from IS NOT NULL AND v_m_to IS NOT NULL AND v_m_to > 0 THEN
    RETURN (v_m_from / v_m_to);
  END IF;

  -- Volume: base = ml
  v_v_from := CASE v_from_symbol
    WHEN 'ml' THEN 1.0
    WHEN 'l' THEN 1000.0
    WHEN 'ltr' THEN 1000.0
    ELSE NULL
  END;

  v_v_to := CASE v_to_symbol
    WHEN 'ml' THEN 1.0
    WHEN 'l' THEN 1000.0
    WHEN 'ltr' THEN 1000.0
    ELSE NULL
  END;

  IF v_v_from IS NOT NULL AND v_v_to IS NOT NULL AND v_v_to > 0 THEN
    RETURN (v_v_from / v_v_to);
  END IF;

  -- Packaging units check
  IF p_item_id IS NOT NULL THEN
    SELECT pack_size_in_base_units INTO v_pack_size
    FROM public.item_packaging_units
    WHERE item_id = p_item_id AND is_active = true
      AND (packaging_unit_id = p_from_unit_id OR LOWER(TRIM(pack_unit_name)) = v_from_symbol)
    LIMIT 1;

    IF v_pack_size IS NOT NULL AND v_pack_size > 0 THEN
      RETURN v_pack_size;
    END IF;
  END IF;

  RETURN 1.0;
END;
$$;

-- 3. Authoritative Sync Function for logical_ingredient_groups.last_valid_wac
CREATE OR REPLACE FUNCTION public.sync_logical_group_last_valid_wac(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base_unit_id UUID;
  v_existing_last_wac NUMERIC(16, 6);
  v_total_stock NUMERIC := 0;
  v_any_costed BOOLEAN := false;
  v_all_positive_stock_costed BOOLEAN := true;
  v_costed_variants_count INT := 0;
  v_weighted_val_sum NUMERIC := 0;
  v_base_stock_sum NUMERIC := 0;
  v_calculated_group_wac NUMERIC(16, 6);
  v_single_variant_wac NUMERIC(16, 6);
  v_item RECORD;
  v_factor NUMERIC;
  v_item_stock_base NUMERIC;
  v_item_wac_base NUMERIC;
BEGIN
  IF p_group_id IS NULL THEN
    RETURN;
  END IF;

  -- Acquire transaction-level lock on the logical ingredient group
  SELECT base_unit_id, last_valid_wac
  INTO v_base_unit_id, v_existing_last_wac
  FROM public.logical_ingredient_groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Scan active child variants of the group
  SELECT 
    COALESCE(SUM(current_stock), 0),
    COALESCE(BOOL_OR(is_costed = true AND current_weighted_average_cost > 0), false),
    COALESCE(BOOL_AND(CASE WHEN current_stock > 0 THEN (is_costed = true AND current_weighted_average_cost > 0) ELSE true END), true),
    COUNT(*) FILTER (WHERE is_costed = true AND current_weighted_average_cost > 0)
  INTO 
    v_total_stock,
    v_any_costed,
    v_all_positive_stock_costed,
    v_costed_variants_count
  FROM public.inventory_items
  WHERE group_id = p_group_id AND is_active = true;

  -- State 1: When all valid cost sources are cancelled / zero costed variants exist
  IF NOT v_any_costed THEN
    UPDATE public.logical_ingredient_groups
    SET last_valid_wac = NULL,
        updated_at = now()
    WHERE id = p_group_id;
    RETURN;
  END IF;

  -- State 2: When positive on-hand stock exists (SUM(current_stock) > 0)
  IF v_total_stock > 0 THEN
    -- Require every positive-stock active variant to have a valid cost basis.
    -- If even one positive-stock variant is uncosted, do NOT overwrite last_valid_wac.
    IF NOT v_all_positive_stock_costed THEN
      RETURN;
    END IF;

    -- Compute quantity-weighted group WAC across all active positive-stock variants
    FOR v_item IN
      SELECT id, current_stock, current_weighted_average_cost, unit_id
      FROM public.inventory_items
      WHERE group_id = p_group_id AND is_active = true AND current_stock > 0
    LOOP
      v_factor := public.fn_get_unit_conversion_factor(v_item.unit_id, v_base_unit_id, v_item.id);
      IF v_factor <= 0 THEN
        v_factor := 1.0;
      END IF;

      v_item_stock_base := v_item.current_stock * v_factor;
      v_item_wac_base := v_item.current_weighted_average_cost / v_factor;

      v_base_stock_sum := v_base_stock_sum + v_item_stock_base;
      v_weighted_val_sum := v_weighted_val_sum + (v_item_stock_base * v_item_wac_base);
    END LOOP;

    IF v_base_stock_sum > 0 THEN
      v_calculated_group_wac := ROUND((v_weighted_val_sum / v_base_stock_sum)::NUMERIC, 6);
      UPDATE public.logical_ingredient_groups
      SET last_valid_wac = v_calculated_group_wac,
          updated_at = now()
      WHERE id = p_group_id;
    END IF;
    RETURN;
  END IF;

  -- State 3: When total group stock reaches zero (SUM(current_stock) = 0) through normal consumption
  -- Preserve existing last_valid_wac snapshot. Never replace with arithmetic average of zero-stock variants.
  IF v_existing_last_wac IS NOT NULL THEN
    RETURN;
  END IF;

  -- If last_valid_wac is NULL and the group has EXACTLY ONE active costed stock variant,
  -- initialize last_valid_wac from that single variant's base-unit-normalized WAC.
  IF v_costed_variants_count = 1 THEN
    SELECT (current_weighted_average_cost / GREATEST(public.fn_get_unit_conversion_factor(unit_id, v_base_unit_id, id), 0.000001))
    INTO v_single_variant_wac
    FROM public.inventory_items
    WHERE group_id = p_group_id AND is_active = true AND is_costed = true AND current_weighted_average_cost > 0
    LIMIT 1;

    IF v_single_variant_wac IS NOT NULL AND v_single_variant_wac > 0 THEN
      UPDATE public.logical_ingredient_groups
      SET last_valid_wac = ROUND(v_single_variant_wac::NUMERIC, 6),
          updated_at = now()
      WHERE id = p_group_id;
    END IF;
  END IF;
END;
$$;

-- 4. Deferred Trigger Function on inventory_items
CREATE OR REPLACE FUNCTION public.trg_fn_sync_logical_group_wac_deferred()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.group_id IS NOT NULL THEN
      PERFORM public.sync_logical_group_last_valid_wac(OLD.group_id);
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.group_id IS DISTINCT FROM NEW.group_id THEN
      IF OLD.group_id IS NOT NULL THEN
        PERFORM public.sync_logical_group_last_valid_wac(OLD.group_id);
      END IF;
      IF NEW.group_id IS NOT NULL THEN
        PERFORM public.sync_logical_group_last_valid_wac(NEW.group_id);
      END IF;
    ELSE
      IF NEW.group_id IS NOT NULL THEN
        PERFORM public.sync_logical_group_last_valid_wac(NEW.group_id);
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.group_id IS NOT NULL THEN
      PERFORM public.sync_logical_group_last_valid_wac(NEW.group_id);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 5. Attach Deferred Constraint Trigger on inventory_items
DROP TRIGGER IF EXISTS trg_sync_logical_group_wac_deferred ON public.inventory_items;

CREATE CONSTRAINT TRIGGER trg_sync_logical_group_wac_deferred
AFTER INSERT OR UPDATE OF current_stock, current_weighted_average_cost, is_costed, group_id, is_active OR DELETE
ON public.inventory_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_sync_logical_group_wac_deferred();

-- 6. Sales Aggregation RPC Function with Alias Resolution & Truncation Elimination
CREATE OR REPLACE FUNCTION public.get_menu_sales_aggregation(
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  menu_item_id UUID,
  units_sold NUMERIC(14, 2),
  net_sales NUMERIC(14, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH item_name_map AS (
    -- Canonical names (priority 1)
    SELECT 
      LOWER(TRIM(p.name)) AS norm_name,
      p.id AS mapped_menu_item_id,
      1 AS priority
    FROM public.pos_menu_items p
    WHERE p.name IS NOT NULL AND TRIM(p.name) != ''
    UNION ALL
    -- Normalized canonical names
    SELECT 
      LOWER(TRIM(p.normalized_name)) AS norm_name,
      p.id AS mapped_menu_item_id,
      1 AS priority
    FROM public.pos_menu_items p
    WHERE p.normalized_name IS NOT NULL AND TRIM(p.normalized_name) != ''
    UNION ALL
    -- Aliases (priority 2, strictly unambiguous: only aliases mapping to exactly 1 distinct menu_item_id)
    SELECT 
      LOWER(TRIM(a.alias)) AS norm_name,
      (ARRAY_AGG(a.menu_item_id))[1] AS mapped_menu_item_id,
      2 AS priority
    FROM public.pos_menu_item_aliases a
    WHERE a.alias IS NOT NULL AND TRIM(a.alias) != ''
    GROUP BY LOWER(TRIM(a.alias))
    HAVING COUNT(DISTINCT a.menu_item_id) = 1
    UNION ALL
    -- Normalized aliases
    SELECT 
      LOWER(TRIM(a.normalized_alias)) AS norm_name,
      (ARRAY_AGG(a.menu_item_id))[1] AS mapped_menu_item_id,
      2 AS priority
    FROM public.pos_menu_item_aliases a
    WHERE a.normalized_alias IS NOT NULL AND TRIM(a.normalized_alias) != ''
    GROUP BY LOWER(TRIM(a.normalized_alias))
    HAVING COUNT(DISTINCT a.menu_item_id) = 1
  ),
  deduped_map AS (
    SELECT DISTINCT ON (norm_name) norm_name, mapped_menu_item_id
    FROM item_name_map
    ORDER BY norm_name, priority ASC
  )
  SELECT 
    m.mapped_menu_item_id AS menu_item_id,
    ROUND(COALESCE(SUM(s.quantity), 0)::NUMERIC, 2) AS units_sold,
    ROUND(COALESCE(SUM(s.net_sales), 0)::NUMERIC, 2) AS net_sales
  FROM public.sales_order_items s
  JOIN deduped_map m ON LOWER(TRIM(s.item_name)) = m.norm_name
  WHERE s.status = 'Success'
    AND (p_date_from IS NULL OR s.business_date >= p_date_from)
    AND (p_date_to IS NULL OR s.business_date <= p_date_to)
  GROUP BY m.mapped_menu_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_sales_aggregation(DATE, DATE) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_menu_sales_aggregation(DATE, DATE) FROM anon, public;

-- 7. Daily Sales Trend RPC for Individual Menu Items
CREATE OR REPLACE FUNCTION public.get_menu_item_daily_sales(
  p_menu_item_id UUID,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
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
  RETURN QUERY
  WITH item_name_map AS (
    SELECT LOWER(TRIM(p.name)) AS norm_name, p.id AS mapped_menu_item_id, 1 AS priority
    FROM public.pos_menu_items p
    WHERE p.id = p_menu_item_id AND p.name IS NOT NULL AND TRIM(p.name) != ''
    UNION ALL
    SELECT LOWER(TRIM(p.normalized_name)) AS norm_name, p.id AS mapped_menu_item_id, 1 AS priority
    FROM public.pos_menu_items p
    WHERE p.id = p_menu_item_id AND p.normalized_name IS NOT NULL AND TRIM(p.normalized_name) != ''
    UNION ALL
    SELECT LOWER(TRIM(a.alias)) AS norm_name, (ARRAY_AGG(a.menu_item_id))[1] AS mapped_menu_item_id, 2 AS priority
    FROM public.pos_menu_item_aliases a
    WHERE a.menu_item_id = p_menu_item_id AND a.alias IS NOT NULL AND TRIM(a.alias) != ''
    GROUP BY LOWER(TRIM(a.alias))
    HAVING COUNT(DISTINCT a.menu_item_id) = 1
  ),
  deduped_map AS (
    SELECT DISTINCT ON (norm_name) norm_name, mapped_menu_item_id
    FROM item_name_map
    ORDER BY norm_name, priority ASC
  )
  SELECT 
    s.business_date,
    ROUND(COALESCE(SUM(s.quantity), 0)::NUMERIC, 2) AS units_sold,
    ROUND(COALESCE(SUM(s.net_sales), 0)::NUMERIC, 2) AS net_sales
  FROM public.sales_order_items s
  JOIN deduped_map m ON LOWER(TRIM(s.item_name)) = m.norm_name
  WHERE s.status = 'Success'
    AND (p_date_from IS NULL OR s.business_date >= p_date_from)
    AND (p_date_to IS NULL OR s.business_date <= p_date_to)
  GROUP BY s.business_date
  ORDER BY s.business_date ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_item_daily_sales(UUID, DATE, DATE) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_menu_item_daily_sales(UUID, DATE, DATE) FROM anon, public;

-- 8. Align public.can_view_costing() with TypeScript canViewCosting() 4-permission condition
CREATE OR REPLACE FUNCTION public.can_view_costing()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
      AND r.name = 'Admin'
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid()
      AND perm.code IN ('sops.costing.view', 'finance.profitability', 'finance.purchases', 'admin.manage')
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_view_costing() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_view_costing() FROM anon, public;
