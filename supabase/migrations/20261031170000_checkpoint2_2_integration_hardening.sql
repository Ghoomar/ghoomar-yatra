-- Migration: 20261031170000_checkpoint2_2_integration_hardening.sql
-- Checkpoint 2.2: Hardened Unit Conversion Architecture & Precision Upgrade (NUMERIC(16, 6))

-- 1. Drop dependent view and trigger before altering column types
DROP VIEW IF EXISTS public.inventory_current_position;
DROP TRIGGER IF EXISTS trg_sync_logical_group_wac_deferred ON public.inventory_items;

-- 2. Upgrade Column Precisions to NUMERIC(16, 6) across inventory and purchase valuation ledgers
ALTER TABLE public.inventory_items 
ALTER COLUMN current_weighted_average_cost TYPE NUMERIC(16, 6);

ALTER TABLE public.stock_movements 
ALTER COLUMN unit_cost TYPE NUMERIC(16, 6);

ALTER TABLE public.purchase_lines 
ALTER COLUMN rate TYPE NUMERIC(16, 6);

-- Recreate trigger on inventory_items
CREATE CONSTRAINT TRIGGER trg_sync_logical_group_wac_deferred
AFTER INSERT OR UPDATE OF current_stock, current_weighted_average_cost, is_costed, group_id, is_active OR DELETE
ON public.inventory_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_sync_logical_group_wac_deferred();

-- 3. Recreate view public.inventory_current_position
CREATE OR REPLACE VIEW public.inventory_current_position AS
SELECT 
    i.id AS item_id,
    i.item_code,
    i.name,
    i.group_id,
    g.name AS group_name,
    g.name_hi AS group_name_hi,
    i.brand_name,
    i.variant_name,
    i.category_id,
    c.name AS category_name,
    i.inventory_class,
    i.unit_id,
    u.symbol AS unit_symbol,
    i.minimum_stock,
    i.preferred_stock,
    i.replenishment_frequency,
    i.storage_type,
    COALESCE(sum(
        CASE
            WHEN sm.movement_type = ANY (ARRAY['opening'::text, 'purchase'::text, 'return'::text, 'adjustment_inc'::text]) THEN sm.quantity
            WHEN sm.movement_type = ANY (ARRAY['count_adjustment'::text, 'physical_count_adjustment'::text]) THEN sm.quantity
            WHEN sm.movement_type = ANY (ARRAY['issue'::text, 'sale'::text, 'consumption'::text, 'staff_food'::text, 'wastage'::text, 'spoilage'::text, 'breakage'::text, 'loss'::text, 'adjustment_dec'::text]) THEN - sm.quantity
            WHEN sm.movement_type = 'transfer'::text THEN 0::numeric
            ELSE 0::numeric
        END), 0.000) AS current_quantity,
    CASE
        WHEN can_view_costing() THEN i.current_weighted_average_cost
        ELSE NULL::numeric
    END AS wac_cost,
    CASE
        WHEN can_view_costing() THEN round(COALESCE(sum(
            CASE
                WHEN sm.movement_type = ANY (ARRAY['opening'::text, 'purchase'::text, 'return'::text, 'adjustment_inc'::text]) THEN sm.quantity
                WHEN sm.movement_type = ANY (ARRAY['count_adjustment'::text, 'physical_count_adjustment'::text]) THEN sm.quantity
                WHEN sm.movement_type = ANY (ARRAY['issue'::text, 'sale'::text, 'consumption'::text, 'staff_food'::text, 'wastage'::text, 'spoilage'::text, 'breakage'::text, 'loss'::text, 'adjustment_dec'::text]) THEN - sm.quantity
                WHEN sm.movement_type = 'transfer'::text THEN 0::numeric
                ELSE 0::numeric
            END), 0.000) * i.current_weighted_average_cost, 2)
        ELSE NULL::numeric
    END AS current_stock_value,
    max(sm.created_at) AS last_movement_at,
    i.is_active,
    c.name_hi AS category_name_hi,
    u.symbol_hi AS unit_symbol_hi,
    u.name AS unit_name,
    u.name_hi AS unit_name_hi,
    i.name_hi,
    i.abc_risk,
    i.is_costed
FROM public.inventory_items i
LEFT JOIN public.logical_ingredient_groups g ON i.group_id = g.id
LEFT JOIN public.inventory_categories c ON i.category_id = c.id
LEFT JOIN public.units u ON i.unit_id = u.id
LEFT JOIN public.stock_movements sm ON i.id = sm.item_id
GROUP BY 
    i.id, i.item_code, i.name, i.group_id, g.name, g.name_hi, i.brand_name, i.variant_name,
    i.category_id, c.name, i.inventory_class, i.unit_id, u.symbol, i.minimum_stock,
    i.preferred_stock, i.replenishment_frequency, i.storage_type, i.current_weighted_average_cost,
    i.is_active, c.name_hi, u.symbol_hi, u.name, u.name_hi, i.name_hi, i.abc_risk, i.is_costed;

GRANT SELECT ON public.inventory_current_position TO authenticated, anon, service_role;

-- 4. Upgrade recalculate_item_wac to precision 6
CREATE OR REPLACE FUNCTION public.recalculate_item_wac(p_item_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    m RECORD;
    v_running_stock NUMERIC := 0;
    v_running_wac NUMERIC := 0;
    v_is_costed BOOLEAN := false;
    v_location_total NUMERIC := 0;
    v_has_active_purchases BOOLEAN := false;
    v_has_opening_valuation BOOLEAN := false;
BEGIN
    FOR m IN 
        SELECT sm.*
        FROM public.stock_movements sm
        LEFT JOIN public.purchase_headers ph ON (sm.reference_type = 'purchase_header' AND sm.reference_id = ph.id)
        WHERE sm.item_id = p_item_id
          AND (ph.status IS NULL OR ph.status != 'cancelled')
          AND COALESCE(sm.reference_type, '') != 'purchase_cancellation'
        ORDER BY sm.business_date ASC, sm.created_at ASC, sm.id ASC
    LOOP
        IF m.movement_type IN ('purchase', 'opening') OR (m.movement_type = 'adjustment_inc' AND m.unit_cost > 0) THEN
            IF m.quantity > 0 THEN
                IF v_running_stock > 0 AND v_is_costed THEN
                    v_running_wac := ROUND(((v_running_stock * v_running_wac) + (m.quantity * m.unit_cost)) / (v_running_stock + m.quantity), 6);
                ELSE
                    v_running_wac := ROUND(m.unit_cost, 6);
                END IF;
                v_running_stock := v_running_stock + m.quantity;
                v_is_costed := true;
                IF m.movement_type = 'purchase' THEN v_has_active_purchases := true; END IF;
                IF m.movement_type = 'opening' THEN v_has_opening_valuation := true; END IF;
            END IF;
        ELSIF m.movement_type IN ('issue', 'consumption_issue', 'consumption', 'sale', 'staff_food', 'wastage', 'spoilage', 'breakage', 'loss', 'return', 'adjustment_dec') THEN
            v_running_stock := GREATEST(0, v_running_stock - ABS(m.quantity));
        ELSIF m.movement_type IN ('count_adjustment', 'physical_count_adjustment') THEN
            v_running_stock := GREATEST(0, v_running_stock + m.quantity);
        END IF;
    END LOOP;

    SELECT COALESCE(SUM(quantity), 0) INTO v_location_total
    FROM public.item_location_stocks
    WHERE item_id = p_item_id;

    IF NOT (v_has_active_purchases OR v_has_opening_valuation) THEN
        v_running_wac := 0;
        v_is_costed := false;
    END IF;

    UPDATE public.inventory_items
    SET current_stock = v_location_total,
        current_weighted_average_cost = v_running_wac,
        is_costed = v_is_costed,
        updated_at = now()
    WHERE id = p_item_id;

    RETURN v_running_wac;
END;
$$;

-- 5. Upgrade execute_inventory_transaction to precision 6
CREATE OR REPLACE FUNCTION public.execute_inventory_transaction(
    p_item_id uuid,
    p_business_date date,
    p_movement_type text,
    p_quantity numeric,
    p_unit_cost numeric DEFAULT NULL::numeric,
    p_source_location_id uuid DEFAULT NULL::uuid,
    p_destination_location_id uuid DEFAULT NULL::uuid,
    p_department_id uuid DEFAULT NULL::uuid,
    p_responsible_person_id uuid DEFAULT NULL::uuid,
    p_purpose text DEFAULT NULL::text,
    p_reference_id uuid DEFAULT NULL::uuid,
    p_reference_type text DEFAULT NULL::text,
    p_notes text DEFAULT NULL::text,
    p_created_by uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_movement_id UUID;
    v_group_id UUID;
    v_src_current NUMERIC;
    v_abs_qty NUMERIC := ABS(p_quantity);
    v_new_total NUMERIC;
    v_count_loc UUID;
    v_curr_stock NUMERIC;
    v_curr_wac NUMERIC;
    v_new_wac NUMERIC;
    v_eff_unit_cost NUMERIC;
BEGIN
    IF p_movement_type NOT IN ('count_adjustment', 'physical_count_adjustment') AND v_abs_qty <= 0 THEN
        RAISE EXCEPTION 'Movement quantity must be positive';
    END IF;

    SELECT group_id, current_weighted_average_cost INTO v_group_id, v_curr_wac
    FROM public.inventory_items
    WHERE id = p_item_id;

    v_eff_unit_cost := p_unit_cost;
    IF (v_eff_unit_cost IS NULL OR v_eff_unit_cost <= 0) AND p_movement_type NOT IN ('count_adjustment', 'physical_count_adjustment') THEN
        v_eff_unit_cost := v_curr_wac;
    END IF;
    v_eff_unit_cost := COALESCE(v_eff_unit_cost, 0);

    IF p_source_location_id IS NOT NULL AND p_movement_type IN ('transfer', 'issue', 'consumption_issue', 'sale', 'consumption', 'staff_food', 'wastage', 'spoilage', 'breakage', 'loss', 'adjustment_dec', 'return') THEN
        SELECT quantity INTO v_src_current 
        FROM public.item_location_stocks 
        WHERE item_id = p_item_id AND location_id = p_source_location_id 
        FOR UPDATE;

        IF v_src_current IS NULL OR v_src_current < v_abs_qty THEN
            RAISE EXCEPTION 'Insufficient stock in source location (Available: %, Requested: %)', COALESCE(v_src_current, 0), v_abs_qty;
        END IF;

        UPDATE public.item_location_stocks 
        SET quantity = quantity - v_abs_qty, updated_at = now() 
        WHERE item_id = p_item_id AND location_id = p_source_location_id;
    END IF;

    IF p_destination_location_id IS NOT NULL AND p_movement_type IN ('purchase', 'opening', 'transfer', 'return', 'adjustment_inc') THEN
        INSERT INTO public.item_location_stocks (item_id, location_id, quantity, updated_at)
        VALUES (p_item_id, p_destination_location_id, v_abs_qty, now())
        ON CONFLICT (item_id, location_id) 
        DO UPDATE SET quantity = item_location_stocks.quantity + v_abs_qty, updated_at = now();
    END IF;

    v_count_loc := COALESCE(p_destination_location_id, p_source_location_id);
    IF p_movement_type IN ('count_adjustment', 'physical_count_adjustment') AND v_count_loc IS NOT NULL THEN
        INSERT INTO public.item_location_stocks (item_id, location_id, quantity, updated_at)
        VALUES (p_item_id, v_count_loc, GREATEST(0, p_quantity), now())
        ON CONFLICT (item_id, location_id) 
        DO UPDATE SET quantity = GREATEST(0, item_location_stocks.quantity + p_quantity), updated_at = now();
    END IF;

    INSERT INTO public.stock_movements (
        business_date, item_id, group_id, movement_type, quantity, unit_cost, total_value,
        source_location_id, destination_location_id, department_id, responsible_person_id,
        purpose, reference_id, reference_type, notes, created_by
    ) VALUES (
        p_business_date, p_item_id, v_group_id, p_movement_type, 
        CASE WHEN p_movement_type IN ('count_adjustment', 'physical_count_adjustment') THEN p_quantity ELSE v_abs_qty END,
        v_eff_unit_cost, ROUND(v_abs_qty * v_eff_unit_cost, 2),
        p_source_location_id, p_destination_location_id, p_department_id, p_responsible_person_id,
        p_purpose, p_reference_id, p_reference_type, p_notes, p_created_by
    ) RETURNING id INTO v_movement_id;

    SELECT COALESCE(SUM(quantity), 0) INTO v_new_total 
    FROM public.item_location_stocks 
    WHERE item_id = p_item_id;

    IF p_movement_type IN ('purchase', 'opening') THEN
        SELECT current_stock, current_weighted_average_cost INTO v_curr_stock, v_curr_wac
        FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
        
        IF COALESCE(v_curr_stock, 0) > 0 THEN
            v_new_wac := ROUND(((v_curr_stock * COALESCE(v_curr_wac, v_eff_unit_cost)) + (v_abs_qty * v_eff_unit_cost)) / (v_curr_stock + v_abs_qty), 6);
        ELSE
            v_new_wac := ROUND(v_eff_unit_cost, 6);
        END IF;

        UPDATE public.inventory_items 
        SET current_stock = v_new_total,
            current_weighted_average_cost = v_new_wac,
            is_costed = true,
            updated_at = now()
        WHERE id = p_item_id;
    ELSE
        UPDATE public.inventory_items 
        SET current_stock = v_new_total,
            updated_at = now()
        WHERE id = p_item_id;
    END IF;

    RETURN v_movement_id;
END;
$$;

-- 6. Hardened fn_get_unit_conversion_factor with NULL return on incompatible dimensions
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
  v_item_base_unit UUID;
  v_item_sec_unit UUID;
  v_conversion_factor NUMERIC;
  v_pack_size NUMERIC;
BEGIN
  IF p_from_unit_id IS NULL OR p_to_unit_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_from_unit_id = p_to_unit_id THEN
    RETURN 1.0;
  END IF;

  SELECT LOWER(TRIM(symbol)) INTO v_from_symbol FROM public.units WHERE id = p_from_unit_id;
  SELECT LOWER(TRIM(symbol)) INTO v_to_symbol FROM public.units WHERE id = p_to_unit_id;

  IF v_from_symbol IS NULL OR v_to_symbol IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_from_symbol = v_to_symbol THEN
    RETURN 1.0;
  END IF;

  -- Mass conversions (base: g)
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

  -- Volume conversions (base: ml)
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

  -- Culinary liquid equivalence (1 g = 1 ml, 1 kg = 1 L)
  IF v_m_from IS NOT NULL AND v_v_to IS NOT NULL AND v_v_to > 0 THEN
    RETURN (v_m_from / v_v_to);
  END IF;
  IF v_v_from IS NOT NULL AND v_m_to IS NOT NULL AND v_m_to > 0 THEN
    RETURN (v_v_from / v_m_to);
  END IF;

  -- Metadata-driven Item Specific conversions
  IF p_item_id IS NOT NULL THEN
    SELECT unit_id, secondary_unit_id, conversion_factor 
    INTO v_item_base_unit, v_item_sec_unit, v_conversion_factor
    FROM public.inventory_items
    WHERE id = p_item_id;

    IF v_conversion_factor IS NOT NULL AND v_conversion_factor > 0 AND v_item_base_unit IS NOT NULL AND v_item_sec_unit IS NOT NULL THEN
      IF p_from_unit_id = v_item_base_unit AND p_to_unit_id = v_item_sec_unit THEN
        RETURN v_conversion_factor;
      ELSIF p_from_unit_id = v_item_sec_unit AND p_to_unit_id = v_item_base_unit THEN
        RETURN (1.0 / v_conversion_factor);
      END IF;

      IF v_m_from IS NOT NULL AND p_to_unit_id = v_item_base_unit AND v_item_sec_unit = (SELECT id FROM public.units WHERE symbol = 'g' LIMIT 1) THEN
        RETURN (v_m_from / v_conversion_factor);
      END IF;

      IF p_from_unit_id = v_item_base_unit AND v_m_to IS NOT NULL AND v_item_sec_unit = (SELECT id FROM public.units WHERE symbol = 'g' LIMIT 1) THEN
        RETURN (v_conversion_factor / v_m_to);
      END IF;
    END IF;

    -- Packaging units check
    SELECT pack_size_in_base_units INTO v_pack_size
    FROM public.item_packaging_units
    WHERE inventory_item_id = p_item_id AND is_active = true
      AND (pack_unit_id = p_from_unit_id OR LOWER(TRIM(pack_unit_name)) = v_from_symbol)
    ORDER BY is_default DESC
    LIMIT 1;

    IF v_pack_size IS NOT NULL AND v_pack_size > 0 THEN
      IF p_to_unit_id = v_item_base_unit THEN
        RETURN v_pack_size;
      END IF;
      IF v_conversion_factor IS NOT NULL AND v_conversion_factor > 0 AND p_to_unit_id = v_item_sec_unit THEN
        RETURN (v_pack_size * v_conversion_factor);
      END IF;
      IF v_conversion_factor IS NOT NULL AND v_conversion_factor > 0 AND v_m_to IS NOT NULL AND v_item_sec_unit = (SELECT id FROM public.units WHERE symbol = 'g' LIMIT 1) THEN
        RETURN (v_pack_size * v_conversion_factor / v_m_to);
      END IF;
    END IF;

    SELECT pack_size_in_base_units INTO v_pack_size
    FROM public.item_packaging_units
    WHERE inventory_item_id = p_item_id AND is_active = true
      AND (pack_unit_id = p_to_unit_id OR LOWER(TRIM(pack_unit_name)) = v_to_symbol)
    ORDER BY is_default DESC
    LIMIT 1;

    IF v_pack_size IS NOT NULL AND v_pack_size > 0 THEN
      IF p_from_unit_id = v_item_base_unit THEN
        RETURN (1.0 / v_pack_size);
      END IF;
      IF v_conversion_factor IS NOT NULL AND v_conversion_factor > 0 AND v_m_from IS NOT NULL AND v_item_sec_unit = (SELECT id FROM public.units WHERE symbol = 'g' LIMIT 1) THEN
        RETURN (v_m_from / (v_conversion_factor * v_pack_size));
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;
