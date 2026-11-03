-- Serialize location deletion against new stock and historical references.
-- The row lock conflicts with the KEY SHARE locks acquired by foreign-key
-- checks, so reference checks cannot race a concurrent insert/reassignment.
CREATE OR REPLACE FUNCTION public.fn_protect_inventory_location_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_non_zero_stock_count INTEGER;
    v_movement_count INTEGER;
    v_issue_count INTEGER;
    v_asset_count INTEGER;
    v_child_count INTEGER;
BEGIN
    -- Mandatory operational locations cannot be deleted.
    IF UPPER(OLD.code) IN ('STORE', 'KITCHEN-MAIN') THEN
        RAISE EXCEPTION 'Cannot delete mandatory system location: % is permanently reserved.', OLD.code
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Lock before reading stock/history. FK KEY SHARE checks for concurrent
    -- reference inserts or location reassignment must wait until this delete
    -- transaction finishes.
    PERFORM 1
    FROM public.inventory_locations
    WHERE id = OLD.id
    FOR UPDATE;

    SELECT COUNT(*)
    INTO v_non_zero_stock_count
    FROM public.item_location_stocks
    WHERE location_id = OLD.id
      AND quantity <> 0;

    IF v_non_zero_stock_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete location: % item(s) currently have non-zero stock balances in this location. All stock must be transferred or issued out first.', v_non_zero_stock_count
            USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT COUNT(*)
    INTO v_movement_count
    FROM public.stock_movements
    WHERE source_location_id = OLD.id
       OR destination_location_id = OLD.id;

    IF v_movement_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete location: Location has % historical stock movement record(s). It can only be deactivated, not deleted.', v_movement_count
            USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT COUNT(*)
    INTO v_issue_count
    FROM public.consumption_issues
    WHERE source_location_id = OLD.id;

    IF v_issue_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete location: Location has % store issue record(s). It can only be deactivated, not deleted.', v_issue_count
            USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT COUNT(*)
    INTO v_asset_count
    FROM public.physical_asset_status_ledger
    WHERE location_id = OLD.id;

    IF v_asset_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete location: Location has % physical asset status ledger record(s). It can only be deactivated, not deleted.', v_asset_count
            USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT COUNT(*)
    INTO v_child_count
    FROM public.inventory_locations
    WHERE parent_location_id = OLD.id;

    IF v_child_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete location: Location has % child sub-location(s). Please reassign or delete child locations first.', v_child_count
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Only zero-stock placeholder rows may be removed for a pristine location.
    DELETE FROM public.item_location_stocks
    WHERE location_id = OLD.id
      AND quantity = 0;

    RETURN OLD;
END;
$$;
