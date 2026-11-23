-- Migration: 20261123170000_edit_purchase_invoice_rpc.sql
-- Function to atomically edit a purchase invoice with net-delta stock validation,
-- WAC recalculation, payment allocation safeguards, and vendor price memory update.

CREATE OR REPLACE FUNCTION public.edit_purchase_invoice(
    p_purchase_id UUID,
    p_vendor_id UUID,
    p_purchase_date DATE,
    p_invoice_number TEXT,
    p_notes TEXT,
    p_lines JSONB,
    p_edited_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_header RECORD;
    v_old_line RECORD;
    v_elem JSONB;
    v_target_loc UUID;
    v_line_loc UUID;
    v_allocated_amount NUMERIC := 0;
    v_new_total NUMERIC := 0;
    v_vendor_name TEXT;
    v_item_name TEXT;
    v_loc_name TEXT;
    v_item_id UUID;
    v_group_id UUID;
    v_qty NUMERIC;
    v_rate NUMERIC;
    v_line_total NUMERIC;
    v_pkg_id UUID;
    v_brand_snap TEXT;
    v_pack_unit_snap TEXT;
    v_pack_qty NUMERIC;
    v_pack_rate NUMERIC;
    v_conv_snap NUMERIC;
    v_distinct_item_id UUID;
    r RECORD;
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
        RAISE EXCEPTION 'Cannot edit purchase invoice %: invoice is already cancelled', v_header.purchase_number;
    END IF;

    -- 2. Validate p_lines is a non-empty array
    IF p_lines IS NULL OR jsonb_typeof(p_lines) != 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'Purchase invoice must have at least one line item';
    END IF;

    -- Compute new total from lines
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_new_total := v_new_total + COALESCE((v_elem->>'total_amount')::numeric, 0);
    END LOOP;
    v_new_total := ROUND(v_new_total, 2);

    -- 3. Check payment allocations
    SELECT COALESCE(SUM(amount_allocated), 0) INTO v_allocated_amount
    FROM public.vendor_payment_allocations
    WHERE purchase_id = p_purchase_id;

    -- Reject changing vendor if payments have already been allocated
    IF v_allocated_amount > 0 AND p_vendor_id IS DISTINCT FROM v_header.vendor_id THEN
        RAISE EXCEPTION 'Cannot change vendor on invoice %: Payments (₹%) have already been allocated against this bill',
            v_header.purchase_number, v_allocated_amount;
    END IF;

    -- Reject if new total is less than already allocated payment
    IF v_new_total < v_allocated_amount THEN
        RAISE EXCEPTION 'Cannot update purchase invoice %: New total (₹%) cannot be less than already allocated payment (₹%)',
            v_header.purchase_number, v_new_total, v_allocated_amount;
    END IF;

    -- Determine Central Store location
    SELECT id INTO v_target_loc
    FROM public.inventory_locations
    WHERE code = 'STORE' OR name ILIKE '%central store%'
    LIMIT 1;

    -- Get vendor name for notes
    SELECT name INTO v_vendor_name FROM public.vendors WHERE id = p_vendor_id;

    -- 4. Temporary table to compute net delta per (item_id, location_id)
    CREATE TEMP TABLE tmp_item_loc_delta (
        item_id UUID,
        location_id UUID,
        old_qty NUMERIC DEFAULT 0,
        new_qty NUMERIC DEFAULT 0
    ) ON COMMIT DROP;

    -- Record old line quantities to be reversed
    FOR v_old_line IN
        SELECT pl.*
        FROM public.purchase_lines pl
        WHERE pl.purchase_id = p_purchase_id
    LOOP
        SELECT destination_location_id INTO v_line_loc
        FROM public.stock_movements
        WHERE reference_id = p_purchase_id
          AND reference_type = 'purchase_header'
          AND item_id = v_old_line.item_id
          AND movement_type = 'purchase'
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_line_loc IS NULL THEN
            v_line_loc := v_target_loc;
        END IF;

        INSERT INTO tmp_item_loc_delta (item_id, location_id, old_qty, new_qty)
        VALUES (v_old_line.item_id, v_line_loc, v_old_line.quantity, 0);
    END LOOP;

    -- Record new line quantities to be inwarded
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_item_id := (v_elem->>'item_id')::uuid;
        v_qty := (v_elem->>'quantity')::numeric;

        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'Line quantity must be greater than zero';
        END IF;

        INSERT INTO tmp_item_loc_delta (item_id, location_id, old_qty, new_qty)
        VALUES (v_item_id, v_target_loc, 0, v_qty);
    END LOOP;

    -- 5. Net delta pre-validation: check that available - old_qty + new_qty >= 0
    FOR r IN
        SELECT 
            d.item_id, 
            d.location_id, 
            SUM(d.old_qty) as total_old_qty, 
            SUM(d.new_qty) as total_new_qty,
            COALESCE(ils.quantity, 0) as current_avail
        FROM tmp_item_loc_delta d
        LEFT JOIN public.item_location_stocks ils ON (ils.item_id = d.item_id AND ils.location_id = d.location_id)
        GROUP BY d.item_id, d.location_id, ils.quantity
    LOOP
        IF (r.current_avail - r.total_old_qty + r.total_new_qty) < 0 THEN
            SELECT name INTO v_item_name FROM public.inventory_items WHERE id = r.item_id;
            SELECT name INTO v_loc_name FROM public.inventory_locations WHERE id = r.location_id;
            RAISE EXCEPTION 'Cannot update purchase invoice %: Insufficient stock for item "%" at location "%" (Available: %, Net change: %, Resulting: %)',
                v_header.purchase_number,
                COALESCE(v_item_name, r.item_id::text),
                COALESCE(v_loc_name, r.location_id::text),
                r.current_avail,
                (r.total_new_qty - r.total_old_qty),
                (r.current_avail - r.total_old_qty + r.total_new_qty);
        END IF;
    END LOOP;

    -- 6. Apply net delta to item_location_stocks
    FOR r IN
        SELECT 
            d.item_id, 
            d.location_id, 
            SUM(d.old_qty) as total_old_qty, 
            SUM(d.new_qty) as total_new_qty
        FROM tmp_item_loc_delta d
        GROUP BY d.item_id, d.location_id
    LOOP
        INSERT INTO public.item_location_stocks (item_id, location_id, quantity, updated_at)
        VALUES (r.item_id, r.location_id, GREATEST(0, r.total_new_qty - r.total_old_qty), now())
        ON CONFLICT (item_id, location_id)
        DO UPDATE SET quantity = item_location_stocks.quantity - r.total_old_qty + r.total_new_qty, updated_at = now();
    END LOOP;

    -- 7. Delete old stock movements and purchase lines
    DELETE FROM public.stock_movements
    WHERE reference_id = p_purchase_id AND reference_type = 'purchase_header';

    DELETE FROM public.purchase_lines
    WHERE purchase_id = p_purchase_id;

    -- 8. Update purchase_headers
    UPDATE public.purchase_headers
    SET vendor_id = p_vendor_id,
        purchase_date = p_purchase_date,
        business_date = p_purchase_date,
        invoice_number = NULLIF(TRIM(p_invoice_number), ''),
        total_amount = v_new_total,
        net_amount = v_new_total,
        notes = NULLIF(TRIM(p_notes), ''),
        updated_at = now()
    WHERE id = p_purchase_id;

    -- 9. Insert new purchase_lines and new stock_movements
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_item_id := (v_elem->>'item_id')::uuid;
        v_qty := (v_elem->>'quantity')::numeric;
        v_rate := (v_elem->>'rate')::numeric;
        v_line_total := (v_elem->>'total_amount')::numeric;
        v_pkg_id := NULLIF(v_elem->>'packaging_unit_id', '')::uuid;
        v_brand_snap := NULLIF(TRIM(v_elem->>'brand_name_snapshot'), '');
        v_pack_unit_snap := NULLIF(TRIM(v_elem->>'pack_unit_snapshot'), '');
        v_pack_qty := NULLIF(v_elem->>'pack_quantity', '')::numeric;
        v_pack_rate := NULLIF(v_elem->>'pack_rate', '')::numeric;
        v_conv_snap := NULLIF(v_elem->>'conversion_factor_snapshot', '')::numeric;

        -- Fetch group_id for stock_movements
        SELECT group_id INTO v_group_id FROM public.inventory_items WHERE id = v_item_id;

        -- Insert line item with exact total_amount
        INSERT INTO public.purchase_lines (
            purchase_id, item_id, quantity, rate, total_amount,
            packaging_unit_id, brand_name_snapshot, pack_unit_snapshot,
            pack_quantity, pack_rate, conversion_factor_snapshot
        ) VALUES (
            p_purchase_id, v_item_id, v_qty, v_rate, v_line_total,
            v_pkg_id, v_brand_snap, v_pack_unit_snap,
            v_pack_qty, v_pack_rate, v_conv_snap
        );

        -- Insert stock movement with group_id populated
        INSERT INTO public.stock_movements (
            business_date, item_id, group_id, movement_type, quantity, unit_cost, total_value,
            source_location_id, destination_location_id, purpose,
            reference_id, reference_type, notes, created_by
        ) VALUES (
            p_purchase_date, v_item_id, v_group_id, 'purchase', v_qty, v_rate, v_line_total,
            NULL, v_target_loc, 'Vendor Inward Receipt (Edited)',
            p_purchase_id, 'purchase_header', 'PO ' || v_header.purchase_number || ' - ' || COALESCE(v_vendor_name, 'Vendor'), p_edited_by
        );

        -- Update vendor price memory
        INSERT INTO public.vendor_items (vendor_id, inventory_item_id, last_purchase_rate, last_purchase_date, is_preferred)
        VALUES (p_vendor_id, v_item_id, v_rate, p_purchase_date, true)
        ON CONFLICT (vendor_id, inventory_item_id)
        DO UPDATE SET last_purchase_rate = v_rate, last_purchase_date = p_purchase_date;
    END LOOP;

    -- 10. Recalculate WAC and synchronized stock for all affected items
    FOR v_distinct_item_id IN
        SELECT DISTINCT item_id FROM tmp_item_loc_delta
    LOOP
        PERFORM public.recalculate_item_wac(v_distinct_item_id);
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'purchase_id', p_purchase_id,
        'purchase_number', v_header.purchase_number,
        'net_amount', v_new_total,
        'status', v_header.status
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.edit_purchase_invoice TO authenticated, service_role;
