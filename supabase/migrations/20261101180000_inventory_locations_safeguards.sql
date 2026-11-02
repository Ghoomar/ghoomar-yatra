-- Migration: 20261101180000_inventory_locations_safeguards.sql
-- Description: Enforces deletion safeguards and system invariants on public.inventory_locations
-- Rules Enforced:
--   1. System Invariant: Location code 'STORE' is permanently protected against deletion and deactivation.
--   2. Rule 1: Non-zero current stock balance (quantity <> 0) strictly blocks deletion.
--   3. Rule 2: Locations with historical records in stock_movements, consumption_issues,
--              physical_asset_status_ledger, or child locations cannot be deleted (must be deactivated).
--   4. Rule 3: Safe transactional cleanup of zero-stock placeholder rows (quantity = 0) on pristine locations.

-- 1. Trigger Function: BEFORE DELETE on inventory_locations
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
    -- System Invariant: Central Store (STORE) cannot be deleted
    IF UPPER(OLD.code) = 'STORE' THEN
        RAISE EXCEPTION 'Cannot delete system location: Central Store (STORE) is permanently reserved by the system.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Rule 1: Non-zero current stock balance strictly blocks deletion
    SELECT COUNT(*)
    INTO v_non_zero_stock_count
    FROM public.item_location_stocks
    WHERE location_id = OLD.id
      AND quantity <> 0;

    IF v_non_zero_stock_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete location: % item(s) currently have non-zero stock balances in this location. All stock must be transferred or issued out first.', v_non_zero_stock_count
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Rule 2: Locations with historical transactions/references cannot be deleted
    -- Check historical stock movements
    SELECT COUNT(*)
    INTO v_movement_count
    FROM public.stock_movements
    WHERE source_location_id = OLD.id
       OR destination_location_id = OLD.id;

    IF v_movement_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete location: Location has % historical stock movement record(s). It can only be deactivated, not deleted.', v_movement_count
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Check store consumption issues
    SELECT COUNT(*)
    INTO v_issue_count
    FROM public.consumption_issues
    WHERE source_location_id = OLD.id;

    IF v_issue_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete location: Location has % store issue record(s). It can only be deactivated, not deleted.', v_issue_count
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Check physical asset status ledger
    SELECT COUNT(*)
    INTO v_asset_count
    FROM public.physical_asset_status_ledger
    WHERE location_id = OLD.id;

    IF v_asset_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete location: Location has % physical asset status ledger record(s). It can only be deactivated, not deleted.', v_asset_count
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Check child locations
    SELECT COUNT(*)
    INTO v_child_count
    FROM public.inventory_locations
    WHERE parent_location_id = OLD.id;

    IF v_child_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete location: Location has % child sub-location(s). Please reassign or delete child locations first.', v_child_count
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- Safe Cleanup: Delete zero-stock placeholder records so ON DELETE RESTRICT on item_location_stocks does not fail
    DELETE FROM public.item_location_stocks
    WHERE location_id = OLD.id
      AND quantity = 0;

    RETURN OLD;
END;
$$;

-- 2. Trigger Function: BEFORE UPDATE on inventory_locations (Protect STORE invariants & touch updated_at)
CREATE OR REPLACE FUNCTION public.fn_protect_inventory_location_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Protect STORE code and active status
    IF UPPER(OLD.code) = 'STORE' THEN
        IF UPPER(NEW.code) <> 'STORE' THEN
            RAISE EXCEPTION 'Cannot modify code of system reserved location STORE.'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.is_active = false THEN
            RAISE EXCEPTION 'System reserved location STORE cannot be deactivated.'
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;

    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- 3. Bind Triggers to public.inventory_locations
DROP TRIGGER IF EXISTS trg_protect_inventory_location_delete ON public.inventory_locations;
CREATE TRIGGER trg_protect_inventory_location_delete
    BEFORE DELETE ON public.inventory_locations
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_protect_inventory_location_delete();

DROP TRIGGER IF EXISTS trg_protect_inventory_location_update ON public.inventory_locations;
CREATE TRIGGER trg_protect_inventory_location_update
    BEFORE UPDATE ON public.inventory_locations
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_protect_inventory_location_update();
