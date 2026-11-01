-- Migration: 20261029140000_checkpoint1_1_hardening.sql
-- Description: Checkpoint 1.1 Hardening: Atomic invoice cancellation safety, WAC retention at zero stock,
--              packaging RLS & policies, and cost-definer security functions.

-- 1. Helper function to check if caller has costing viewing permissions
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
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid()
      AND perm.code = 'sops.costing.view'
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
      AND r.name IN ('Admin', 'Owner', 'General Manager', 'Accountant')
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_view_costing() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_view_costing() FROM anon, public;

-- 2. Helper function to check if caller can manage packaging definitions
CREATE OR REPLACE FUNCTION public.can_manage_packaging()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid()
      AND perm.code IN ('finance.purchases', 'inventory.stock', 'admin.manage')
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
      AND r.name IN ('Admin', 'Owner', 'General Manager', 'Accountant', 'Storekeeper')
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_packaging() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_manage_packaging() FROM anon, public;

-- 3. Hardened recalculate_item_wac: preserves WAC and is_costed on consumption to zero stock
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
                    -- Prior stock was 0 or uncosted: new WAC is the unit cost of this inward
                    v_running_wac := ROUND(m.unit_cost, 4);
                END IF;
                v_running_stock := v_running_stock + m.quantity;
                v_is_costed := true;
            END IF;

        -- Outbound consumption event: issues, consumption, wastage, breakage, return, staff_food, loss, etc.
        ELSIF m.movement_type IN ('issue', 'consumption_issue', 'consumption', 'sale', 'staff_food', 'wastage', 'spoilage', 'breakage', 'loss', 'return', 'adjustment_dec') THEN
            v_running_stock := GREATEST(0, v_running_stock - ABS(m.quantity));
            -- WAC and is_costed DO NOT mutate on outbound events! They remain valid for costing!

        -- Count adjustments: adjust quantity without mutating unit valuation
        ELSIF m.movement_type IN ('count_adjustment', 'physical_count_adjustment') THEN
            v_running_stock := GREATEST(0, v_running_stock + m.quantity);
        END IF;
    END LOOP;

    -- Synchronize cached stock from authoritative location ledger
    SELECT COALESCE(SUM(quantity), 0) INTO v_location_total
    FROM public.item_location_stocks
    WHERE item_id = p_item_id;

    -- Check if active (non-cancelled) purchase or opening valuation exists
    SELECT EXISTS (
        SELECT 1 FROM public.purchase_lines pl
        JOIN public.purchase_headers ph ON pl.purchase_id = ph.id
        WHERE pl.item_id = p_item_id AND ph.status != 'cancelled'
    ) INTO v_has_active_purchases;

    SELECT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.item_id = p_item_id AND sm.movement_type = 'opening' AND sm.unit_cost > 0
    ) INTO v_has_opening_valuation;

    -- If all purchase sources were cancelled and no opening valuation exists, revert to uncosted
    IF NOT v_is_costed THEN
        v_running_wac := 0.00;
        v_is_costed := false;
    ELSIF NOT v_has_active_purchases AND NOT v_has_opening_valuation THEN
        v_running_wac := 0.00;
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

-- 4. Hardened execute_inventory_transaction: correct moving WAC derivation when prior stock was 0
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
        
        IF COALESCE(v_curr_stock, 0) > 0 THEN
            v_new_wac := ROUND(((v_curr_stock * COALESCE(v_curr_wac, v_eff_unit_cost)) + (v_abs_qty * v_eff_unit_cost)) / (v_curr_stock + v_abs_qty), 4);
        ELSE
            -- Stock prior to this inward was 0: WAC is exactly the new incoming purchase cost!
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

-- 5. Hardened cancel_purchase_invoice: Atomic pre-check, payment allocation safety, and elimination of zero-clamping
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
    v_item_name TEXT;
    v_loc_name TEXT;
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

    -- 2. Reject if any vendor payment allocations exist on this invoice
    IF EXISTS (
        SELECT 1 FROM public.vendor_payment_allocations
        WHERE purchase_id = p_purchase_id AND amount_allocated > 0
    ) THEN
        RAISE EXCEPTION 'Cannot cancel purchase invoice %: payments have been allocated to this invoice. Please reverse payment allocations first.', v_header.purchase_number;
    END IF;

    -- Default fallback location is Central Store
    SELECT id INTO v_target_loc
    FROM public.inventory_locations
    WHERE code = 'STORE' OR name ILIKE '%central store%'
    LIMIT 1;

    -- 3. Atomic pre-validation: Verify sufficient stock at affected locations on ALL lines
    FOR v_line IN 
        SELECT pl.* 
        FROM public.purchase_lines pl
        WHERE pl.purchase_id = p_purchase_id
        FOR UPDATE
    LOOP
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

        -- Lock and check available on-hand stock in that location
        SELECT quantity INTO v_avail_stock
        FROM public.item_location_stocks
        WHERE item_id = v_line.item_id AND location_id = v_line_loc
        FOR UPDATE;

        IF v_avail_stock IS NULL OR v_avail_stock < v_line.quantity THEN
            SELECT name INTO v_item_name FROM public.inventory_items WHERE id = v_line.item_id;
            SELECT name INTO v_loc_name FROM public.inventory_locations WHERE id = v_line_loc;
            RAISE EXCEPTION 'Cannot cancel purchase invoice %: Insufficient stock for item "%" at location "%". Required to reverse: %, Available: %',
                v_header.purchase_number,
                COALESCE(v_item_name, v_line.item_id::text),
                COALESCE(v_loc_name, v_line_loc::text),
                v_line.quantity,
                COALESCE(v_avail_stock, 0);
        END IF;
    END LOOP;

    -- 4. Mark purchase header as cancelled
    UPDATE public.purchase_headers
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_reason = p_reason,
        updated_at = now()
    WHERE id = p_purchase_id;

    -- 5. Process each purchase line and reverse stock WITHOUT silent zero-clamping
    FOR v_line IN 
        SELECT pl.* 
        FROM public.purchase_lines pl
        WHERE pl.purchase_id = p_purchase_id
    LOOP
        v_lines_count := v_lines_count + 1;

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

        -- Exact deduction (safe because pre-check verified v_avail_stock >= v_line.quantity)
        UPDATE public.item_location_stocks
        SET quantity = quantity - v_line.quantity,
            updated_at = now()
        WHERE item_id = v_line.item_id AND location_id = v_line_loc;

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

-- 6. Row-Level Security for item_packaging_units
ALTER TABLE public.item_packaging_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_packaging_units_select" ON public.item_packaging_units;
CREATE POLICY "item_packaging_units_select" ON public.item_packaging_units
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "item_packaging_units_insert" ON public.item_packaging_units;
CREATE POLICY "item_packaging_units_insert" ON public.item_packaging_units
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_packaging() OR public.is_admin());

DROP POLICY IF EXISTS "item_packaging_units_update" ON public.item_packaging_units;
CREATE POLICY "item_packaging_units_update" ON public.item_packaging_units
FOR UPDATE TO authenticated
USING (public.can_manage_packaging() OR public.is_admin())
WITH CHECK (public.can_manage_packaging() OR public.is_admin());

DROP POLICY IF EXISTS "item_packaging_units_delete" ON public.item_packaging_units;
CREATE POLICY "item_packaging_units_delete" ON public.item_packaging_units
FOR DELETE TO authenticated
USING (public.is_admin());

-- 7. Cost-Data Security: Row-Level Security on purchase_headers, purchase_lines, vendor_items
ALTER TABLE public.purchase_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_headers_select" ON public.purchase_headers;
CREATE POLICY "purchase_headers_select" ON public.purchase_headers
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.role_permissions rp ON p.role_id = rp.role_id
        JOIN public.permissions perm ON rp.permission_id = perm.id
        WHERE p.id = auth.uid() AND perm.code IN ('finance.purchases', 'sops.costing.view')
    ) OR EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.roles r ON p.role_id = r.id
        WHERE p.id = auth.uid() AND r.name IN ('Admin', 'Owner', 'Accountant', 'General Manager')
    )
);

DROP POLICY IF EXISTS "purchase_lines_select" ON public.purchase_lines;
CREATE POLICY "purchase_lines_select" ON public.purchase_lines
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.role_permissions rp ON p.role_id = rp.role_id
        JOIN public.permissions perm ON rp.permission_id = perm.id
        WHERE p.id = auth.uid() AND perm.code IN ('finance.purchases', 'sops.costing.view')
    ) OR EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.roles r ON p.role_id = r.id
        WHERE p.id = auth.uid() AND r.name IN ('Admin', 'Owner', 'Accountant', 'General Manager')
    )
);

DROP POLICY IF EXISTS "vendor_items_select" ON public.vendor_items;
CREATE POLICY "vendor_items_select" ON public.vendor_items
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.role_permissions rp ON p.role_id = rp.role_id
        JOIN public.permissions perm ON rp.permission_id = perm.id
        WHERE p.id = auth.uid() AND perm.code IN ('finance.purchases', 'sops.costing.view')
    ) OR EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.roles r ON p.role_id = r.id
        WHERE p.id = auth.uid() AND r.name IN ('Admin', 'Owner', 'Accountant', 'General Manager')
    )
);

-- 8. Security-definer RPC function for cost-redacted inventory current position
CREATE OR REPLACE FUNCTION public.get_inventory_current_position()
RETURNS TABLE (
    item_id UUID,
    item_code TEXT,
    name TEXT,
    category_id UUID,
    category_name TEXT,
    inventory_class TEXT,
    unit_id UUID,
    unit_symbol TEXT,
    minimum_stock NUMERIC,
    preferred_stock NUMERIC,
    replenishment_frequency TEXT,
    storage_type TEXT,
    current_quantity NUMERIC,
    wac_cost NUMERIC,
    current_stock_value NUMERIC,
    last_movement_at TIMESTAMPTZ,
    is_active BOOLEAN,
    category_name_hi TEXT,
    unit_symbol_hi TEXT,
    unit_name TEXT,
    unit_name_hi TEXT,
    name_hi TEXT,
    abc_risk TEXT,
    is_costed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_cost BOOLEAN := false;
BEGIN
    SELECT public.can_view_costing() INTO v_has_cost;
    
    RETURN QUERY
    SELECT 
        v.item_id,
        v.item_code,
        v.name,
        v.category_id,
        v.category_name,
        v.inventory_class,
        v.unit_id,
        v.unit_symbol,
        v.minimum_stock,
        v.preferred_stock,
        v.replenishment_frequency,
        v.storage_type,
        v.current_quantity,
        CASE WHEN v_has_cost THEN v.wac_cost ELSE NULL END AS wac_cost,
        CASE WHEN v_has_cost THEN v.current_stock_value ELSE NULL END AS current_stock_value,
        v.last_movement_at,
        v.is_active,
        v.category_name_hi,
        v.unit_symbol_hi,
        v.unit_name,
        v.unit_name_hi,
        v.name_hi,
        v.abc_risk,
        v.is_costed
    FROM public.inventory_current_position v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_current_position() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_inventory_current_position() FROM anon;

-- 9. Cost-redacted public view for direct Supabase client queries
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
            WHEN (sm.movement_type = ANY (ARRAY['opening'::text, 'purchase'::text, 'return'::text, 'adjustment_inc'::text])) THEN sm.quantity
            WHEN (sm.movement_type = ANY (ARRAY['count_adjustment'::text, 'physical_count_adjustment'::text])) THEN sm.quantity
            WHEN (sm.movement_type = ANY (ARRAY['issue'::text, 'sale'::text, 'consumption'::text, 'staff_food'::text, 'wastage'::text, 'spoilage'::text, 'breakage'::text, 'loss'::text, 'adjustment_dec'::text])) THEN (- sm.quantity)
            WHEN (sm.movement_type = 'transfer'::text) THEN (0)::numeric
            ELSE (0)::numeric
        END), 0.000) AS current_quantity,
    (CASE WHEN public.can_view_costing() THEN i.current_weighted_average_cost ELSE NULL END)::numeric(12,2) AS wac_cost,
    CASE WHEN public.can_view_costing() THEN round((COALESCE(sum(
        CASE
            WHEN (sm.movement_type = ANY (ARRAY['opening'::text, 'purchase'::text, 'return'::text, 'adjustment_inc'::text])) THEN sm.quantity
            WHEN (sm.movement_type = ANY (ARRAY['count_adjustment'::text, 'physical_count_adjustment'::text])) THEN sm.quantity
            WHEN (sm.movement_type = ANY (ARRAY['issue'::text, 'sale'::text, 'consumption'::text, 'staff_food'::text, 'wastage'::text, 'spoilage'::text, 'breakage'::text, 'loss'::text, 'adjustment_dec'::text])) THEN (- sm.quantity)
            WHEN (sm.movement_type = 'transfer'::text) THEN (0)::numeric
            ELSE (0)::numeric
        END), 0.000) * i.current_weighted_average_cost), 2) ELSE NULL END AS current_stock_value,
    max(sm.created_at) AS last_movement_at,
    i.is_active,
    c.name_hi AS category_name_hi,
    u.symbol_hi AS unit_symbol_hi,
    u.name AS unit_name,
    u.name_hi AS unit_name_hi,
    i.name_hi,
    i.abc_risk,
    i.is_costed
  FROM (((inventory_items i
    LEFT JOIN inventory_categories c ON ((i.category_id = c.id)))
    LEFT JOIN units u ON ((i.unit_id = u.id)))
    LEFT JOIN stock_movements sm ON ((i.id = sm.item_id)))
  GROUP BY i.id, i.item_code, i.name, i.category_id, c.name, i.inventory_class, i.unit_id, u.symbol, i.minimum_stock, i.preferred_stock, i.replenishment_frequency, i.storage_type, i.current_weighted_average_cost, i.is_active, c.name_hi, u.symbol_hi, u.name, u.name_hi, i.name_hi, i.abc_risk, i.is_costed;

