-- Migration: 20261005200000_remove_inventory_batch_expiry.sql
-- Description: Complete structural removal of Inventory Batch, Lot, and Expiry Management.
-- Yatra operates under a physical pooled-inventory model. There is no batch separation,
-- no FEFO/FIFO-by-expiry, and no operational batch tracking.
--
-- Objects Modified / Dropped:
-- 1. DROP INDEX public.idx_stock_movements_expiry;
-- 2. DROP COLUMN shelf_life_days FROM public.inventory_items;
-- 3. DROP COLUMN batch_number, expiry_date FROM public.purchase_lines;
-- 4. DROP COLUMN batch_number, expiry_date FROM public.stock_movements;
-- 5. DROP FUNCTION public.execute_inventory_transaction (16 parameters);
-- 6. CREATE FUNCTION public.execute_inventory_transaction (clean 14 parameters);
-- 7. RE-APPLY Phase 1 security hardening (SECURITY DEFINER, search_path, revoke anon, grant authenticated/service_role).

-- ------------------------------------------------------------------------------
-- 1. Drop Expiry Index
-- ------------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_stock_movements_expiry;

-- ------------------------------------------------------------------------------
-- 2. Drop Obsolete Columns (No archive, discard non-operational data)
-- ------------------------------------------------------------------------------
ALTER TABLE public.inventory_items 
  DROP COLUMN IF EXISTS shelf_life_days;

ALTER TABLE public.purchase_lines 
  DROP COLUMN IF EXISTS batch_number,
  DROP COLUMN IF EXISTS expiry_date;

ALTER TABLE public.stock_movements 
  DROP COLUMN IF EXISTS batch_number,
  DROP COLUMN IF EXISTS expiry_date;

-- ------------------------------------------------------------------------------
-- 3. Drop Obsolete 16-Parameter Inventory Transaction Procedure
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.execute_inventory_transaction(
  uuid, date, text, numeric, numeric, uuid, uuid, uuid, uuid, text, uuid, text, text, text, date, uuid
);

-- ------------------------------------------------------------------------------
-- 4. Create Clean 14-Parameter Inventory Transaction Procedure
-- ------------------------------------------------------------------------------
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
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_movement_id UUID;
    v_src_current NUMERIC;
    v_abs_qty NUMERIC := ABS(p_quantity);
    v_new_total NUMERIC;
    v_count_loc UUID;
    v_curr_stock NUMERIC;
    v_curr_wac NUMERIC;
    v_new_wac NUMERIC;
    v_eff_unit_cost NUMERIC;
BEGIN
    -- 1. Validate quantity
    IF p_movement_type NOT IN ('count_adjustment', 'physical_count_adjustment') AND v_abs_qty <= 0 THEN
        RAISE EXCEPTION 'Movement quantity must be positive';
    END IF;

    -- 2. Determine effective unit cost (WAC derivation if not provided)
    v_eff_unit_cost := p_unit_cost;
    IF (v_eff_unit_cost IS NULL OR v_eff_unit_cost <= 0) AND p_movement_type NOT IN ('count_adjustment', 'physical_count_adjustment') THEN
        SELECT current_weighted_average_cost INTO v_eff_unit_cost
        FROM public.inventory_items
        WHERE id = p_item_id;
    END IF;
    v_eff_unit_cost := COALESCE(v_eff_unit_cost, 0);

    -- 3. Handle Source Location Deduction
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

    -- 4. Handle Destination Location Addition
    IF p_destination_location_id IS NOT NULL AND p_movement_type IN ('purchase', 'opening', 'transfer', 'return', 'adjustment_inc') THEN
        INSERT INTO public.item_location_stocks (item_id, location_id, quantity, updated_at)
        VALUES (p_item_id, p_destination_location_id, v_abs_qty, now())
        ON CONFLICT (item_id, location_id) 
        DO UPDATE SET quantity = item_location_stocks.quantity + v_abs_qty, updated_at = now();
    END IF;

    -- 5. Handle Count Adjustments at Location
    v_count_loc := COALESCE(p_destination_location_id, p_source_location_id);
    IF p_movement_type IN ('count_adjustment', 'physical_count_adjustment') AND v_count_loc IS NOT NULL THEN
        INSERT INTO public.item_location_stocks (item_id, location_id, quantity, updated_at)
        VALUES (p_item_id, v_count_loc, GREATEST(0, p_quantity), now())
        ON CONFLICT (item_id, location_id) 
        DO UPDATE SET quantity = GREATEST(0, item_location_stocks.quantity + p_quantity), updated_at = now();
    END IF;

    -- 6. Record Movement Ledger Entry (authoritative valuation guaranteed, pooled stock)
    INSERT INTO public.stock_movements (
        business_date, item_id, movement_type, quantity, unit_cost, total_value,
        source_location_id, destination_location_id, department_id, responsible_person_id,
        purpose, reference_id, reference_type, notes, created_by
    ) VALUES (
        p_business_date, p_item_id, p_movement_type, 
        CASE WHEN p_movement_type IN ('count_adjustment', 'physical_count_adjustment') THEN p_quantity ELSE v_abs_qty END,
        v_eff_unit_cost, ROUND(v_abs_qty * v_eff_unit_cost, 2),
        p_source_location_id, p_destination_location_id, p_department_id, p_responsible_person_id,
        p_purpose, p_reference_id, p_reference_type, p_notes, p_created_by
    ) RETURNING id INTO v_movement_id;

    -- 7. Synchronize Total Cached Stock on inventory_items
    SELECT COALESCE(SUM(quantity), 0) INTO v_new_total 
    FROM public.item_location_stocks 
    WHERE item_id = p_item_id;

    -- If purchase, recalculate WAC
    IF p_movement_type = 'purchase' THEN
        SELECT current_stock, current_weighted_average_cost INTO v_curr_stock, v_curr_wac
        FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
        
        IF COALESCE(v_curr_stock, 0) + v_abs_qty > 0 THEN
            v_new_wac := ROUND(((COALESCE(v_curr_stock, 0) * COALESCE(v_curr_wac, v_eff_unit_cost)) + (v_abs_qty * v_eff_unit_cost)) / (COALESCE(v_curr_stock, 0) + v_abs_qty), 4);
        ELSE
            v_new_wac := v_eff_unit_cost;
        END IF;

        UPDATE public.inventory_items 
        SET current_stock = v_new_total,
            current_weighted_average_cost = v_new_wac,
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

-- ------------------------------------------------------------------------------
-- 5. Restore Security Hardening & Grants
-- ------------------------------------------------------------------------------
ALTER FUNCTION public.execute_inventory_transaction(
    uuid, date, text, numeric, numeric, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.execute_inventory_transaction(
    uuid, date, text, numeric, numeric, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid
) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.execute_inventory_transaction(
    uuid, date, text, numeric, numeric, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid
) TO authenticated, service_role;
