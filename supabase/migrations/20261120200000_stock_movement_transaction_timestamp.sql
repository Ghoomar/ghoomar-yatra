-- Migration: 20261120200000_stock_movement_transaction_timestamp.sql
-- Description: Adds optional transaction_timestamp column to stock_movements table to preserve
-- actual physical event timestamps (such as fuel delivery time or meter reading time)
-- independently from the reporting business_date and system created_at audit column.
--
-- Note: LOCAL AND PROD SHARE LIVE SUPABASE DB.
-- DO NOT EXECUTE THIS SCRIPT AUTOMATICALLY. REPORT FOR OPERATOR APPROVAL FIRST.

-- 1. Add transaction_timestamp column if not exists
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS transaction_timestamp TIMESTAMPTZ DEFAULT now();

-- 2. Create index for timeline queries
CREATE INDEX IF NOT EXISTS idx_stock_movements_tx_timestamp
  ON public.stock_movements (item_id, transaction_timestamp DESC);

-- 3. Update execute_inventory_transaction with 15th parameter (p_transaction_timestamp)
-- keeping all existing defaults intact and backward-compatible.
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
    p_created_by uuid DEFAULT NULL::uuid,
    p_transaction_timestamp timestamptz DEFAULT NULL::timestamptz
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
    v_tx_timestamp TIMESTAMPTZ := COALESCE(p_transaction_timestamp, now());
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

    -- 6. Record Movement Ledger Entry with transaction_timestamp
    INSERT INTO public.stock_movements (
        business_date, item_id, movement_type, quantity, unit_cost, total_value,
        source_location_id, destination_location_id, department_id, responsible_person_id,
        purpose, reference_id, reference_type, notes, created_by, transaction_timestamp
    ) VALUES (
        p_business_date, p_item_id, p_movement_type, 
        CASE WHEN p_movement_type IN ('count_adjustment', 'physical_count_adjustment') THEN p_quantity ELSE v_abs_qty END,
        v_eff_unit_cost, ROUND(v_abs_qty * v_eff_unit_cost, 2),
        p_source_location_id, p_destination_location_id, p_department_id, p_responsible_person_id,
        p_purpose, p_reference_id, p_reference_type, p_notes, p_created_by, v_tx_timestamp
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
        SET current_stock = v_new_total, updated_at = now() 
        WHERE id = p_item_id;
    END IF;

    RETURN v_movement_id;
END;
$$;
