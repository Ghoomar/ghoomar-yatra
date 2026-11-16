-- Migration: 20261116142000_wac_uncosted_opening_stock.sql
-- Description: Fix execute_inventory_transaction so that the first valid purchase
-- establishes the cost basis for existing uncosted opening stock (is_costed = false).

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
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_movement_id UUID;
    v_group_id UUID;
    v_src_current NUMERIC;
    v_abs_qty NUMERIC := ABS(p_quantity);
    v_new_total NUMERIC;
    v_count_loc UUID;
    v_curr_stock NUMERIC;
    v_curr_wac NUMERIC;
    v_is_costed BOOLEAN;
    v_new_wac NUMERIC;
    v_eff_unit_cost NUMERIC;
BEGIN
    -- 1. Validate quantity
    IF p_movement_type NOT IN ('count_adjustment', 'physical_count_adjustment') AND v_abs_qty <= 0 THEN
        RAISE EXCEPTION 'Movement quantity must be positive';
    END IF;

    -- 2. Determine effective unit cost & group_id
    SELECT group_id, current_weighted_average_cost INTO v_group_id, v_curr_wac
    FROM public.inventory_items
    WHERE id = p_item_id;

    v_eff_unit_cost := p_unit_cost;
    IF (v_eff_unit_cost IS NULL OR v_eff_unit_cost <= 0) AND p_movement_type NOT IN ('count_adjustment', 'physical_count_adjustment') THEN
        v_eff_unit_cost := v_curr_wac;
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

    -- 6. Record Movement Ledger Entry
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

    -- 7. Synchronize Total Cached Stock on inventory_items and update WAC
    SELECT COALESCE(SUM(quantity), 0) INTO v_new_total 
    FROM public.item_location_stocks 
    WHERE item_id = p_item_id;

    IF p_movement_type IN ('purchase', 'opening') THEN
        SELECT current_stock, current_weighted_average_cost, is_costed
        INTO v_curr_stock, v_curr_wac, v_is_costed
        FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
        
        -- If existing stock was already costed, calculate moving WAC;
        -- If existing stock was uncosted (is_costed = false), first purchase sets initial WAC basis.
        IF COALESCE(v_curr_stock, 0) > 0 AND COALESCE(v_is_costed, false) = true THEN
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
$function$;

GRANT EXECUTE ON FUNCTION public.execute_inventory_transaction(uuid, date, text, numeric, numeric, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_inventory_transaction(uuid, date, text, numeric, numeric, uuid, uuid, uuid, uuid, text, uuid, text, text, uuid) TO service_role;
