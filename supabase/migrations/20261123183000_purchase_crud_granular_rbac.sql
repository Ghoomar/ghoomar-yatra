-- Migration: 20261123183000_purchase_crud_granular_rbac.sql
-- Description: Seed granular finance edit permissions, link to Admin, and implement delete_purchase_invoice, edit_vendor_payment, and delete_vendor_payment RPCs

-- 1. Seed Granular Permissions under 'finance'
INSERT INTO public.permissions (id, module, code, action, description)
VALUES
    (gen_random_uuid(), 'finance', 'finance.purchases.edit', 'edit', 'Edit Purchase Invoices'),
    (gen_random_uuid(), 'finance', 'finance.vendors.edit', 'edit', 'Edit Vendors'),
    (gen_random_uuid(), 'finance', 'finance.payments.edit', 'edit', 'Edit Vendor Payments')
ON CONFLICT (code) DO UPDATE
SET description = EXCLUDED.description,
    module = EXCLUDED.module,
    action = EXCLUDED.action;

-- 2. Link all 3 permissions to Admin role by default
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'Admin'
  AND p.code IN ('finance.purchases.edit', 'finance.vendors.edit', 'finance.payments.edit')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Atomic RPC: delete_purchase_invoice
CREATE OR REPLACE FUNCTION public.delete_purchase_invoice(
    p_purchase_id UUID,
    p_deleted_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_header RECORD;
    v_target_loc UUID;
    v_avail_stock NUMERIC;
    v_item_name TEXT;
    v_loc_name TEXT;
    r RECORD;
BEGIN
    -- 1. Fetch and lock purchase header
    SELECT * INTO v_header
    FROM public.purchase_headers
    WHERE id = p_purchase_id
    FOR UPDATE;

    IF v_header IS NULL THEN
        RAISE EXCEPTION 'Purchase invoice % not found', p_purchase_id;
    END IF;

    -- 2. Reject if any vendor payment allocations exist on this invoice
    IF EXISTS (
        SELECT 1 FROM public.vendor_payment_allocations
        WHERE purchase_id = p_purchase_id AND amount_allocated > 0
    ) THEN
        RAISE EXCEPTION 'Cannot delete purchase invoice %: payments have been allocated to this invoice. Please delete or unlink the payment first.', v_header.purchase_number;
    END IF;

    -- Default fallback location is Central Store
    SELECT id INTO v_target_loc
    FROM public.inventory_locations
    WHERE code = 'STORE' OR name ILIKE '%central store%'
    LIMIT 1;

    -- 3. If purchase is active, validate and reverse stock
    IF COALESCE(v_header.status, 'approved') != 'cancelled' THEN
        -- Create a temp table of required deductions per (item_id, location_id) aggregating duplicate lines
        CREATE TEMP TABLE tmp_invoice_loc_req ON COMMIT DROP AS
        SELECT 
            pl.item_id,
            COALESCE(
                (
                    SELECT sm.destination_location_id
                    FROM public.stock_movements sm
                    WHERE sm.reference_id = p_purchase_id
                      AND sm.reference_type = 'purchase_header'
                      AND sm.item_id = pl.item_id
                      AND sm.movement_type = 'purchase'
                    ORDER BY sm.created_at DESC
                    LIMIT 1
                ),
                v_target_loc
            ) as location_id,
            SUM(pl.quantity) as required_qty
        FROM public.purchase_lines pl
        WHERE pl.purchase_id = p_purchase_id
        GROUP BY pl.item_id, 2;

        -- Pre-check sufficiency
        FOR r IN SELECT * FROM tmp_invoice_loc_req
        LOOP
            SELECT quantity INTO v_avail_stock
            FROM public.item_location_stocks
            WHERE item_id = r.item_id AND location_id = r.location_id
            FOR UPDATE;

            IF v_avail_stock IS NULL OR v_avail_stock < r.required_qty THEN
                SELECT name INTO v_item_name FROM public.inventory_items WHERE id = r.item_id;
                SELECT name INTO v_loc_name FROM public.inventory_locations WHERE id = r.location_id;
                RAISE EXCEPTION 'Cannot delete purchase invoice %: Insufficient stock for item "%" at location "%" (Available: %, Required: %)',
                    v_header.purchase_number,
                    COALESCE(v_item_name, r.item_id::text),
                    COALESCE(v_loc_name, r.location_id::text),
                    COALESCE(v_avail_stock, 0),
                    r.required_qty;
            END IF;
        END LOOP;

        -- Apply aggregated deduction
        FOR r IN SELECT * FROM tmp_invoice_loc_req
        LOOP
            UPDATE public.item_location_stocks
            SET quantity = quantity - r.required_qty,
                updated_at = now()
            WHERE item_id = r.item_id AND location_id = r.location_id;
        END LOOP;
    END IF;

    -- 4. Temporary table for affected items to re-calc WAC
    CREATE TEMP TABLE tmp_del_items ON COMMIT DROP AS
    SELECT DISTINCT item_id FROM public.purchase_lines WHERE purchase_id = p_purchase_id;

    -- 5. Delete records
    DELETE FROM public.stock_movements
    WHERE reference_id = p_purchase_id 
      AND (reference_type = 'purchase_header' OR reference_type = 'purchase_cancellation');

    DELETE FROM public.vendor_payment_allocations WHERE purchase_id = p_purchase_id;
    DELETE FROM public.purchase_lines WHERE purchase_id = p_purchase_id;
    DELETE FROM public.purchase_headers WHERE id = p_purchase_id;

    -- 6. Recalculate WAC for all affected items
    FOR r IN SELECT item_id FROM tmp_del_items
    LOOP
        PERFORM public.recalculate_item_wac(r.item_id);
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'purchase_number', v_header.purchase_number
    );
END;
$$;

-- 4. Atomic RPC: edit_vendor_payment
CREATE OR REPLACE FUNCTION public.edit_vendor_payment(
    p_payment_id UUID,
    p_payment_date DATE,
    p_amount NUMERIC,
    p_payment_method_id UUID,
    p_reference_number TEXT,
    p_notes TEXT,
    p_edited_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment RECORD;
    v_pay RECORD;
    v_purchase RECORD;
    v_remaining_amount NUMERIC;
    v_unallocated NUMERIC;
    v_to_allocate NUMERIC;
BEGIN
    SELECT * INTO v_payment
    FROM public.vendor_payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF v_payment IS NULL THEN
        RAISE EXCEPTION 'Payment voucher % not found', p_payment_id;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero';
    END IF;

    -- 1. Update payment details
    UPDATE public.vendor_payments
    SET payment_date = p_payment_date,
        business_date = p_payment_date,
        amount = p_amount,
        payment_method_id = p_payment_method_id,
        reference_number = NULLIF(TRIM(p_reference_number), ''),
        notes = NULLIF(TRIM(p_notes), '')
    WHERE id = p_payment_id;

    -- 2. Clear all payment allocations for this vendor and re-allocate FIFO across active invoices
    DELETE FROM public.vendor_payment_allocations
    WHERE payment_id IN (
        SELECT id FROM public.vendor_payments WHERE vendor_id = v_payment.vendor_id
    );

    FOR v_pay IN
        SELECT id, amount
        FROM public.vendor_payments
        WHERE vendor_id = v_payment.vendor_id
        ORDER BY payment_date ASC, created_at ASC
    LOOP
        v_remaining_amount := v_pay.amount;

        FOR v_purchase IN
            SELECT ph.id, ph.net_amount,
                   COALESCE((SELECT sum(amount_allocated) FROM public.vendor_payment_allocations WHERE purchase_id = ph.id), 0) as already_allocated
            FROM public.purchase_headers ph
            WHERE ph.vendor_id = v_payment.vendor_id
              AND COALESCE(ph.status, 'approved') != 'cancelled'
            ORDER BY ph.purchase_date ASC, ph.created_at ASC
        LOOP
            IF v_remaining_amount <= 0 THEN
                EXIT;
            END IF;

            v_unallocated := v_purchase.net_amount - v_purchase.already_allocated;
            IF v_unallocated > 0 THEN
                v_to_allocate := LEAST(v_remaining_amount, v_unallocated);
                INSERT INTO public.vendor_payment_allocations (payment_id, purchase_id, amount_allocated, created_at)
                VALUES (v_pay.id, v_purchase.id, v_to_allocate, now());
                v_remaining_amount := v_remaining_amount - v_to_allocate;
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', p_payment_id,
        'payment_number', v_payment.payment_number,
        'amount', p_amount
    );
END;
$$;

-- 5. Atomic RPC: delete_vendor_payment
CREATE OR REPLACE FUNCTION public.delete_vendor_payment(
    p_payment_id UUID,
    p_deleted_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment RECORD;
    v_vendor_id UUID;
    v_pay RECORD;
    v_purchase RECORD;
    v_remaining_amount NUMERIC;
    v_unallocated NUMERIC;
    v_to_allocate NUMERIC;
BEGIN
    SELECT * INTO v_payment
    FROM public.vendor_payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF v_payment IS NULL THEN
        RAISE EXCEPTION 'Payment voucher % not found', p_payment_id;
    END IF;

    v_vendor_id := v_payment.vendor_id;

    -- 1. Remove payment allocations and payment voucher
    DELETE FROM public.vendor_payment_allocations WHERE payment_id = p_payment_id;
    DELETE FROM public.vendor_payments WHERE id = p_payment_id;

    -- 2. Cleanly re-run FIFO allocation for remaining payments of this vendor
    DELETE FROM public.vendor_payment_allocations
    WHERE payment_id IN (
        SELECT id FROM public.vendor_payments WHERE vendor_id = v_vendor_id
    );

    FOR v_pay IN
        SELECT id, amount
        FROM public.vendor_payments
        WHERE vendor_id = v_vendor_id
        ORDER BY payment_date ASC, created_at ASC
    LOOP
        v_remaining_amount := v_pay.amount;

        FOR v_purchase IN
            SELECT ph.id, ph.net_amount,
                   COALESCE((SELECT sum(amount_allocated) FROM public.vendor_payment_allocations WHERE purchase_id = ph.id), 0) as already_allocated
            FROM public.purchase_headers ph
            WHERE ph.vendor_id = v_vendor_id
              AND COALESCE(ph.status, 'approved') != 'cancelled'
            ORDER BY ph.purchase_date ASC, ph.created_at ASC
        LOOP
            IF v_remaining_amount <= 0 THEN
                EXIT;
            END IF;

            v_unallocated := v_purchase.net_amount - v_purchase.already_allocated;
            IF v_unallocated > 0 THEN
                v_to_allocate := LEAST(v_remaining_amount, v_unallocated);
                INSERT INTO public.vendor_payment_allocations (payment_id, purchase_id, amount_allocated, created_at)
                VALUES (v_pay.id, v_purchase.id, v_to_allocate, now());
                v_remaining_amount := v_remaining_amount - v_to_allocate;
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'payment_number', v_payment.payment_number
    );
END;
$$;
