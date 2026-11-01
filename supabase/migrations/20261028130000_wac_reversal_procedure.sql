-- Migration: 20261028130000_wac_reversal_procedure.sql
-- Description: Deterministic chronological WAC calculation, purchase invoice cancellation, and full-ledger reversal integrity.

-- 1. Create or replace recalculate_item_wac function
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
BEGIN
    -- Chronologically evaluate all authoritative movements for this item
    -- Exclude movements associated with cancelled purchase invoices
    FOR m IN 
        SELECT sm.*
        FROM public.stock_movements sm
        LEFT JOIN public.purchase_headers ph ON (sm.reference_type = 'purchase_header' AND sm.reference_id = ph.id)
        WHERE sm.item_id = p_item_id
          AND (ph.status IS NULL OR ph.status != 'cancelled')
          AND COALESCE(sm.reference_type, '') != 'purchase_cancellation'
        ORDER BY sm.business_date ASC, sm.created_at ASC, sm.id ASC
    LOOP
        -- Inbound valuation event: purchase, opening balance, or positive adjustment with cost
        IF m.movement_type IN ('purchase', 'opening') OR (m.movement_type = 'adjustment_inc' AND m.unit_cost > 0) THEN
            IF m.quantity > 0 THEN
                IF v_running_stock > 0 AND v_is_costed THEN
                    v_running_wac := ROUND(((v_running_stock * v_running_wac) + (m.quantity * m.unit_cost)) / (v_running_stock + m.quantity), 4);
                ELSE
                    v_running_wac := ROUND(m.unit_cost, 4);
                END IF;
                v_running_stock := v_running_stock + m.quantity;
                v_is_costed := true;
            END IF;

        -- Outbound consumption event: issues, consumption, wastage, breakage, return, staff_food, loss, etc.
        ELSIF m.movement_type IN ('issue', 'consumption_issue', 'consumption', 'sale', 'staff_food', 'wastage', 'spoilage', 'breakage', 'loss', 'return', 'adjustment_dec') THEN
            v_running_stock := GREATEST(0, v_running_stock - ABS(m.quantity));
            -- WAC does not mutate on outbound events

        -- Count adjustments: adjust quantity without mutating unit valuation
        ELSIF m.movement_type IN ('count_adjustment', 'physical_count_adjustment') THEN
            v_running_stock := GREATEST(0, v_running_stock + m.quantity);
        END IF;
    END LOOP;

    -- Synchronize cached stock from authoritative location ledger
    SELECT COALESCE(SUM(quantity), 0) INTO v_location_total
    FROM public.item_location_stocks
    WHERE item_id = p_item_id;

    -- If no valid cost-bearing movements exist or location stock is 0 and no active purchases exist, reset costing flag
    IF NOT v_is_costed THEN
        v_running_wac := 0.00;
    ELSIF v_location_total = 0 THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.purchase_lines pl
            JOIN public.purchase_headers ph ON pl.purchase_id = ph.id
            WHERE pl.item_id = p_item_id AND ph.status != 'cancelled'
        ) AND NOT EXISTS (
            SELECT 1 FROM public.stock_movements sm
            WHERE sm.item_id = p_item_id AND sm.movement_type = 'opening' AND sm.unit_cost > 0
        ) THEN
            v_is_costed := false;
            v_running_wac := 0.00;
        END IF;
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

-- 2. Create purchase invoice cancellation procedure
CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice(
    p_purchase_id UUID,
    p_reason TEXT DEFAULT 'Cancelled by authorized user',
    p_cancelled_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_header RECORD;
    v_line RECORD;
    v_lines_count INT := 0;
    v_target_loc UUID;
    v_line_loc UUID;
    v_avail_stock NUMERIC;
BEGIN
    -- 1. Fetch and validate purchase header
    SELECT * INTO v_header
    FROM public.purchase_headers
    WHERE id = p_purchase_id
    FOR UPDATE;

    IF v_header IS NULL THEN
        RAISE EXCEPTION 'Purchase invoice % not found', p_purchase_id;
    END IF;

    IF v_header.status = 'cancelled' THEN
        RAISE EXCEPTION 'Purchase invoice % is already cancelled', v_header.purchase_number;
    END IF;

    -- 2. Mark purchase header as cancelled FIRST so any subsequent recalculation treats it as cancelled
    UPDATE public.purchase_headers
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_reason = p_reason,
        updated_at = now()
    WHERE id = p_purchase_id;

    -- Default location is Central Store if not specified
    SELECT id INTO v_target_loc
    FROM public.inventory_locations
    WHERE code = 'STORE' OR name ILIKE '%central store%'
    LIMIT 1;

    -- 3. Process each purchase line and reverse stock
    FOR v_line IN 
        SELECT pl.* 
        FROM public.purchase_lines pl
        WHERE pl.purchase_id = p_purchase_id
        FOR UPDATE
    LOOP
        v_lines_count := v_lines_count + 1;

        -- Determine original inward location for this line from stock_movements
        SELECT destination_location_id INTO v_line_loc
        FROM public.stock_movements
        WHERE reference_id = p_purchase_id
          AND reference_type = 'purchase_header'
          AND item_id = v_line.item_id
          AND movement_type = 'purchase'
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_line_loc IS NULL THEN
            v_line_loc := v_target_loc;
        END IF;

        -- Check available stock in location before deducting
        SELECT quantity INTO v_avail_stock
        FROM public.item_location_stocks
        WHERE item_id = v_line.item_id AND location_id = v_line_loc
        FOR UPDATE;

        IF v_avail_stock IS NOT NULL AND v_avail_stock >= v_line.quantity THEN
            UPDATE public.item_location_stocks
            SET quantity = quantity - v_line.quantity,
                updated_at = now()
            WHERE item_id = v_line.item_id AND location_id = v_line_loc;
        ELSE
            -- Deduct whatever location had, clamp to 0
            UPDATE public.item_location_stocks
            SET quantity = GREATEST(0, COALESCE(quantity, 0) - v_line.quantity),
                updated_at = now()
            WHERE item_id = v_line.item_id AND location_id = v_line_loc;
        END IF;

        -- Record offsetting movement in stock_movements
        INSERT INTO public.stock_movements (
            business_date, item_id, movement_type, quantity, unit_cost, total_value,
            source_location_id, destination_location_id, purpose,
            reference_id, reference_type, notes, created_by
        ) VALUES (
            CURRENT_DATE, v_line.item_id, 'adjustment_dec', v_line.quantity, v_line.rate, ROUND(v_line.quantity * v_line.rate, 2),
            v_line_loc, NULL, 'Purchase Cancellation Reversal',
            p_purchase_id, 'purchase_cancellation', p_reason, p_cancelled_by
        );

        -- Re-run deterministic WAC recalculation for this item
        PERFORM public.recalculate_item_wac(v_line.item_id);
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'purchase_id', p_purchase_id,
        'purchase_number', v_header.purchase_number,
        'reversed_lines', v_lines_count,
        'status', 'cancelled'
    );
END;
$$;

-- 3. Update execute_inventory_transaction to set is_costed = true on purchase/opening
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

    -- 6. Record Movement Ledger Entry
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

    -- If purchase or opening, recalculate WAC and set is_costed = true
    IF p_movement_type IN ('purchase', 'opening') THEN
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

-- 4. Update vendor_outstanding_summary view to exclude cancelled purchases
CREATE OR REPLACE VIEW public.vendor_outstanding_summary AS
SELECT v.id AS vendor_id,
    v.vendor_code,
    v.name AS vendor_name,
    v.contact_person,
    v.phone,
    COALESCE(purchases.total_purchased, 0.00) AS total_purchased,
    COALESCE(paid.total_paid, 0.00) AS total_paid,
    COALESCE(purchases.total_purchased, 0.00) - COALESCE(paid.total_paid, 0.00) AS outstanding_balance,
    purchases.last_purchase_date,
    v.is_active,
    v.payment_terms,
    v.payment_frequency,
    v.supplier_categories,
    v.alternate_phone
FROM public.vendors v
LEFT JOIN (
    SELECT purchase_headers.vendor_id,
        sum(purchase_headers.net_amount) AS total_purchased,
        max(purchase_headers.purchase_date) AS last_purchase_date
    FROM public.purchase_headers
    WHERE COALESCE(purchase_headers.status, 'approved') != 'cancelled'
    GROUP BY purchase_headers.vendor_id
) purchases ON v.id = purchases.vendor_id
LEFT JOIN (
    SELECT vendor_payments.vendor_id,
        sum(vendor_payments.amount) AS total_paid
    FROM public.vendor_payments
    GROUP BY vendor_payments.vendor_id
) paid ON v.id = paid.vendor_id;

-- 5. Update inventory_current_position view to expose abc_risk and is_costed
CREATE OR REPLACE VIEW public.inventory_current_position AS
SELECT i.id AS item_id,
    i.item_code,
    i.name,
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
    i.current_weighted_average_cost AS wac_cost,
    round(COALESCE(sum(
        CASE
            WHEN sm.movement_type = ANY (ARRAY['opening'::text, 'purchase'::text, 'return'::text, 'adjustment_inc'::text]) THEN sm.quantity
            WHEN sm.movement_type = ANY (ARRAY['count_adjustment'::text, 'physical_count_adjustment'::text]) THEN sm.quantity
            WHEN sm.movement_type = ANY (ARRAY['issue'::text, 'sale'::text, 'consumption'::text, 'staff_food'::text, 'wastage'::text, 'spoilage'::text, 'breakage'::text, 'loss'::text, 'adjustment_dec'::text]) THEN - sm.quantity
            WHEN sm.movement_type = 'transfer'::text THEN 0::numeric
            ELSE 0::numeric
        END), 0.000) * i.current_weighted_average_cost, 2) AS current_stock_value,
    max(sm.created_at) AS last_movement_at,
    i.is_active,
    c.name_hi AS category_name_hi,
    u.symbol_hi AS unit_symbol_hi,
    u.name AS unit_name,
    u.name_hi AS unit_name_hi,
    i.name_hi,
    i.abc_risk,
    i.is_costed
FROM inventory_items i
LEFT JOIN inventory_categories c ON i.category_id = c.id
LEFT JOIN units u ON i.unit_id = u.id
LEFT JOIN stock_movements sm ON i.id = sm.item_id
GROUP BY i.id, i.item_code, i.name, i.category_id, c.name, i.inventory_class, i.unit_id, u.symbol, i.minimum_stock, i.preferred_stock, i.replenishment_frequency, i.storage_type, i.current_weighted_average_cost, i.is_active, c.name_hi, u.symbol_hi, u.name, u.name_hi, i.name_hi, i.abc_risk, i.is_costed;
