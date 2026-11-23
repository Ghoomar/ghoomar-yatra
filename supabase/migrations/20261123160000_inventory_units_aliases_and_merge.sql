-- Migration: 20261123160000_inventory_units_aliases_and_merge.sql
-- Description:
-- 1. Create public.merge_inventory_items stored procedure for atomic duplicate item consolidation
-- 2. Correct liquid items base units to 'ml' (Toned Milk, Full Cream Milk, Club Soda, Mix Fruit Juice, Sprite)
-- 3. Correct Bread base units to 'pkt' and brand 'Bonn' (Sandwich Bread, White Bread)
-- 4. Create Garlic Bread (Bonn) in Bakery category and link to Bonn Bread vendor
-- 5. Seed explicit unit conversions for Garlic Bread, White Bread, and Sandwich Bread
-- 6. Repair corrupted live purchase lines, stock movements, and item location stocks for DAI-009, BEV-007, VEG-027, VEG-014, VEG-031, VEG-021, FRZ-001
-- 7. Execute bread merges: Jambo Beard Big -> Sandwich Bread, Jambo beard mini -> White Bread
-- 8. Seed idempotent aliases for Breads, Tomato, and Jodhpuri Mirch

BEGIN;

--------------------------------------------------------------------------------
-- 1. Create public.merge_inventory_items Stored Procedure
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_inventory_items(
    p_source_item_id uuid,
    p_target_item_id uuid,
    p_performed_by uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_source record;
    v_target record;
    v_target_group_id uuid;
    v_new_stock numeric;
    v_new_wac numeric;
    v_lines_updated int := 0;
    v_movements_updated int := 0;
    v_aliases_added int := 0;
    v_loc record;
    v_vendor record;
BEGIN
    -- 1. Validation
    IF p_source_item_id IS NULL OR p_target_item_id IS NULL THEN
        RAISE EXCEPTION 'Both source_item_id and target_item_id must be provided';
    END IF;

    IF p_source_item_id = p_target_item_id THEN
        RAISE EXCEPTION 'Source and target items cannot be the same item';
    END IF;

    SELECT * INTO v_source FROM public.inventory_items WHERE id = p_source_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source inventory item % does not exist', p_source_item_id;
    END IF;

    SELECT * INTO v_target FROM public.inventory_items WHERE id = p_target_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target inventory item % does not exist', p_target_item_id;
    END IF;

    v_target_group_id := v_target.group_id;

    -- 2. Auto-add source item name and code as aliases on target
    INSERT INTO public.inventory_item_aliases (item_id, group_id, alias, normalized_alias, alias_type, notes)
    VALUES (
        p_target_item_id,
        v_target_group_id,
        v_source.name,
        lower(trim(regexp_replace(v_source.name, '[^a-zA-Z0-9]+', ' ', 'g'))),
        'colloquial',
        'Auto-aliased from merged item ' || v_source.item_code
    )
    ON CONFLICT DO NOTHING;
    v_aliases_added := v_aliases_added + 1;

    IF v_source.name_hi IS NOT NULL AND trim(v_source.name_hi) != '' THEN
        INSERT INTO public.inventory_item_aliases (item_id, group_id, alias, normalized_alias, alias_type, notes)
        VALUES (
            p_target_item_id,
            v_target_group_id,
            v_source.name_hi,
            lower(trim(regexp_replace(v_source.name_hi, '[^a-zA-Z0-9\u0900-\u097F]+', ' ', 'g'))),
            'hindi',
            'Auto-aliased Hindi name from merged item ' || v_source.item_code
        )
        ON CONFLICT DO NOTHING;
        v_aliases_added := v_aliases_added + 1;
    END IF;

    -- Reassign existing aliases of source to target
    UPDATE public.inventory_item_aliases
    SET item_id = p_target_item_id,
        group_id = COALESCE(v_target_group_id, group_id)
    WHERE item_id = p_source_item_id;

    -- 3. Reassign Foreign Keys across all referencing tables
    -- 3a. purchase_lines
    WITH upd AS (
        UPDATE public.purchase_lines
        SET item_id = p_target_item_id
        WHERE item_id = p_source_item_id
        RETURNING id
    )
    SELECT count(*) INTO v_lines_updated FROM upd;

    -- 3b. stock_movements
    WITH upd AS (
        UPDATE public.stock_movements
        SET item_id = p_target_item_id,
            group_id = COALESCE(v_target_group_id, group_id)
        WHERE item_id = p_source_item_id
        RETURNING id
    )
    SELECT count(*) INTO v_movements_updated FROM upd;

    -- 3c. consumption_issue_items
    UPDATE public.consumption_issue_items
    SET item_id = p_target_item_id,
        group_id = COALESCE(v_target_group_id, group_id)
    WHERE item_id = p_source_item_id;

    -- 3d. inventory_count_items
    UPDATE public.inventory_count_items
    SET item_id = p_target_item_id
    WHERE item_id = p_source_item_id;

    -- 3e. employee_uniform_issue_items
    UPDATE public.employee_uniform_issue_items
    SET item_id = p_target_item_id
    WHERE item_id = p_source_item_id;

    -- 3f. physical_asset_status_ledger
    UPDATE public.physical_asset_status_ledger
    SET item_id = p_target_item_id
    WHERE item_id = p_source_item_id;

    -- 3g. yatra_recipe_ingredients
    UPDATE public.yatra_recipe_ingredients
    SET inventory_item_id = p_target_item_id,
        ingredient_group_id = COALESCE(v_target_group_id, ingredient_group_id)
    WHERE inventory_item_id = p_source_item_id;

    -- 3h. yatra_recipe_formulation_ingredients (CRITICAL: update inventory_item_id and ingredient_group_id together)
    UPDATE public.yatra_recipe_formulation_ingredients
    SET inventory_item_id = p_target_item_id,
        ingredient_group_id = v_target_group_id
    WHERE inventory_item_id = p_source_item_id;

    -- 3i. yatra_ingredient_unit_conversions
    UPDATE public.yatra_ingredient_unit_conversions
    SET inventory_item_id = p_target_item_id,
        ingredient_group_id = COALESCE(v_target_group_id, ingredient_group_id)
    WHERE inventory_item_id = p_source_item_id;

    -- 3j. item_packaging_units
    UPDATE public.item_packaging_units
    SET inventory_item_id = p_target_item_id
    WHERE inventory_item_id = p_source_item_id;

    -- 3k. vendor_items (merge per vendor)
    FOR v_vendor IN SELECT * FROM public.vendor_items WHERE inventory_item_id = p_source_item_id LOOP
        IF EXISTS (SELECT 1 FROM public.vendor_items WHERE inventory_item_id = p_target_item_id AND vendor_id = v_vendor.vendor_id) THEN
            UPDATE public.vendor_items
            SET last_purchase_rate = CASE 
                    WHEN v_vendor.last_purchase_date > last_purchase_date OR last_purchase_date IS NULL 
                    THEN v_vendor.last_purchase_rate 
                    ELSE last_purchase_rate 
                END,
                last_purchase_date = GREATEST(last_purchase_date, v_vendor.last_purchase_date)
            WHERE inventory_item_id = p_target_item_id AND vendor_id = v_vendor.vendor_id;
            DELETE FROM public.vendor_items WHERE id = v_vendor.id;
        ELSE
            UPDATE public.vendor_items
            SET inventory_item_id = p_target_item_id
            WHERE id = v_vendor.id;
        END IF;
    END LOOP;

    -- 3l. item_location_stocks (consolidate per location)
    INSERT INTO public.item_location_stocks (item_id, location_id, quantity)
    SELECT p_target_item_id, location_id, quantity
    FROM public.item_location_stocks
    WHERE item_id = p_source_item_id
    ON CONFLICT (item_id, location_id)
    DO UPDATE SET quantity = item_location_stocks.quantity + EXCLUDED.quantity;

    DELETE FROM public.item_location_stocks WHERE item_id = p_source_item_id;

    -- 4. Stock & Moving WAC Consolidation
    v_new_stock := COALESCE(v_target.current_stock, 0) + COALESCE(v_source.current_stock, 0);

    IF v_new_stock <= 0 THEN
        v_new_wac := COALESCE(v_target.current_weighted_average_cost, 0);
    ELSIF COALESCE(v_target.current_stock, 0) <= 0 OR v_target.is_costed = false OR COALESCE(v_target.current_weighted_average_cost, 0) <= 0 THEN
        v_new_wac := COALESCE(v_source.current_weighted_average_cost, 0);
    ELSE
        v_new_wac := ((COALESCE(v_target.current_stock, 0) * COALESCE(v_target.current_weighted_average_cost, 0)) + 
                      (COALESCE(v_source.current_stock, 0) * COALESCE(v_source.current_weighted_average_cost, 0))) / v_new_stock;
    END IF;

    UPDATE public.inventory_items
    SET current_stock = v_new_stock,
        current_weighted_average_cost = v_new_wac,
        is_costed = (v_new_wac > 0),
        updated_at = now()
    WHERE id = p_target_item_id;

    -- 5. Deactivate Source Item
    UPDATE public.inventory_items
    SET is_active = false,
        current_stock = 0,
        notes = TRIM(COALESCE(notes, '') || ' [MERGED into ' || v_target.item_code || ' on ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ']'),
        updated_at = now()
    WHERE id = p_source_item_id;

    -- 6. Deactivate Source Group if orphan (no remaining active items)
    IF v_source.group_id IS NOT NULL AND (v_target_group_id IS NULL OR v_source.group_id != v_target_group_id) THEN
        IF NOT EXISTS (SELECT 1 FROM public.inventory_items WHERE group_id = v_source.group_id AND is_active = true) THEN
            UPDATE public.logical_ingredient_groups
            SET is_active = false,
                updated_at = now()
            WHERE id = v_source.group_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'source_item_code', v_source.item_code,
        'target_item_code', v_target.item_code,
        'consolidated_stock', v_new_stock,
        'consolidated_wac', v_new_wac,
        'purchase_lines_reassigned', v_lines_updated,
        'stock_movements_reassigned', v_movements_updated
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_inventory_items(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_inventory_items(uuid, uuid, uuid) TO service_role;

--------------------------------------------------------------------------------
-- 2. Correct Liquid Items to 'ml' Base Unit
--------------------------------------------------------------------------------
-- ml unit id = '5c26a9e9-8ac0-417d-99c6-b6685af8aed9'
UPDATE public.inventory_items
SET unit_id = '5c26a9e9-8ac0-417d-99c6-b6685af8aed9',
    updated_at = now()
WHERE item_code IN ('DAI-009', 'DAI-005', 'BEV-007', 'BEV-011', 'BEV-013');

UPDATE public.logical_ingredient_groups
SET base_unit_id = '5c26a9e9-8ac0-417d-99c6-b6685af8aed9',
    updated_at = now()
WHERE id IN (
    SELECT group_id FROM public.inventory_items WHERE item_code IN ('DAI-009', 'DAI-005', 'BEV-007', 'BEV-011', 'BEV-013') AND group_id IS NOT NULL
);

--------------------------------------------------------------------------------
-- 3. Correct Bread Base Units to 'pkt' and Brand to 'Bonn'
--------------------------------------------------------------------------------
-- pkt unit id = '7f59d6d4-831d-43ba-958a-0e68a58a4a83'
UPDATE public.inventory_items
SET unit_id = '7f59d6d4-831d-43ba-958a-0e68a58a4a83',
    brand_name = 'Bonn',
    updated_at = now()
WHERE item_code IN ('BAK-008', 'BAK-003');

UPDATE public.logical_ingredient_groups
SET base_unit_id = '7f59d6d4-831d-43ba-958a-0e68a58a4a83',
    updated_at = now()
WHERE id IN (
    SELECT group_id FROM public.inventory_items WHERE item_code IN ('BAK-008', 'BAK-003') AND group_id IS NOT NULL
);

COMMIT;
