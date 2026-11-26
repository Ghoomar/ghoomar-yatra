-- Migration: Phase 2 Stabilization — Admin Bill Manual Edits & Canonical Menu Merge Hardening
-- Date: 2026-11-26

-- 1. Admin-only Bill Manual Edits (preserves raw CSV audits + survives re-imports)
CREATE TABLE IF NOT EXISTS public.sales_bill_manual_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  invoice_no TEXT NOT NULL,

  -- Explicit Override Fields (NULL = retain POS value)
  override_covers_pax INTEGER NULL CHECK (override_covers_pax IS NULL OR (override_covers_pax >= 0 AND override_covers_pax <= 2000)),
  override_order_type TEXT NULL,
  override_area TEXT NULL,
  override_payment_type TEXT NULL,
  override_customer_name TEXT NULL,
  override_customer_phone TEXT NULL,
  override_status TEXT NULL CHECK (override_status IS NULL OR override_status IN ('Success', 'Complimentary', 'Cancelled')),
  override_notes TEXT NULL,

  -- Raw POS Snapshot & Audit Trail
  original_snapshot_json JSONB NOT NULL,
  reason TEXT NOT NULL,
  edited_by UUID REFERENCES auth.users(id),
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  reverted_at TIMESTAMPTZ NULL,
  reverted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_bill_manual_edits_active
  ON public.sales_bill_manual_edits(sales_order_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_sales_bill_manual_edits_date_inv
  ON public.sales_bill_manual_edits(business_date, invoice_no)
  WHERE is_active = true;

ALTER TABLE public.sales_bill_manual_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_select_sales_bill_manual_edits ON public.sales_bill_manual_edits;
DROP POLICY IF EXISTS p_all_sales_bill_manual_edits ON public.sales_bill_manual_edits;

CREATE POLICY p_select_sales_bill_manual_edits
  ON public.sales_bill_manual_edits
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY p_all_sales_bill_manual_edits
  ON public.sales_bill_manual_edits
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON TABLE public.sales_bill_manual_edits TO authenticated;
GRANT ALL ON TABLE public.sales_bill_manual_edits TO service_role;

-- 2. Canonical POS Menu Name Normalization Helper
CREATE OR REPLACE FUNCTION public.normalize_pos_menu_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT regexp_replace(lower(trim(p_name)), '\s+', ' ', 'g');
$$;

GRANT EXECUTE ON FUNCTION public.normalize_pos_menu_name(TEXT) TO authenticated, service_role;

-- 3. Harden Atomic POS Menu Merge RPC (variant repointing, alias safety, flexible product_type merge)
CREATE OR REPLACE FUNCTION public.fn_merge_pos_menu_items_atomic(
  p_target_menu_item_id UUID,
  p_source_menu_item_ids UUID[],
  p_merged_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_source_id UUID;
  v_deduped_source_ids UUID[];
  v_target RECORD;
  v_source RECORD;
  v_existing_alias_target UUID;
  v_conflict_alias_target UUID;
  v_norm_source_alias TEXT;
  v_target_has_default_variant BOOLEAN;
  v_var RECORD;
  v_snapshot_json JSONB;
  v_merged_count INTEGER := 0;
BEGIN
  -- 1. Validate target menu item exists and is active
  SELECT * INTO v_target FROM public.pos_menu_items WHERE id = p_target_menu_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target menu item % not found', p_target_menu_item_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_target.is_active THEN
    RAISE EXCEPTION 'Target menu item % is inactive', p_target_menu_item_id USING ERRCODE = '23514';
  END IF;

  -- 2. Deduplicate source menu item IDs and exclude target
  SELECT ARRAY_AGG(DISTINCT s_id)
  INTO v_deduped_source_ids
  FROM unnest(p_source_menu_item_ids) AS s_id
  WHERE s_id IS NOT NULL AND s_id <> p_target_menu_item_id;

  IF v_deduped_source_ids IS NULL OR array_length(v_deduped_source_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'target_menu_item_id', p_target_menu_item_id, 'merged_count', 0);
  END IF;

  FOREACH v_source_id IN ARRAY v_deduped_source_ids
  LOOP
    SELECT * INTO v_source FROM public.pos_menu_items WHERE id = v_source_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source menu item % not found', v_source_id USING ERRCODE = 'P0002';
    END IF;

    -- Merge Idempotency & Conflict Check
    IF NOT v_source.is_active THEN
      IF EXISTS (
        SELECT 1 FROM public.yatra_menu_merge_logs
        WHERE source_menu_item_id = v_source_id AND target_menu_item_id = p_target_menu_item_id
      ) THEN
        CONTINUE;
      ELSE
        RAISE EXCEPTION 'Source menu item % is already inactive and was not merged into target % (HTTP 409 Conflict)',
          v_source_id, p_target_menu_item_id USING ERRCODE = '23505';
      END IF;
    END IF;

    -- Block merging structured COMBO/THALI compositions into incompatible INDIVIDUAL_DISH only when source actually owns compositions
    IF NOT v_source.needs_setup
       AND v_source.product_type IN ('COMBO', 'THALI')
       AND v_target.product_type = 'INDIVIDUAL_DISH'
       AND EXISTS (SELECT 1 FROM public.yatra_menu_item_compositions WHERE menu_item_id = v_source_id) THEN
      RAISE EXCEPTION 'Cannot merge structured % % into INDIVIDUAL_DISH %: active combo compositions exist',
        v_source.product_type, v_source.name, v_target.name USING ERRCODE = '23514';
    END IF;

    -- 3. Capture Pre-Merge Snapshot inside source_snapshot_json (including variants)
    SELECT jsonb_build_object(
      'menu_item', to_jsonb(v_source),
      'aliases', (SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM public.pos_menu_item_aliases a WHERE a.menu_item_id = v_source_id),
      'variants', (SELECT COALESCE(jsonb_agg(to_jsonb(v)), '[]'::jsonb) FROM public.yatra_menu_item_variants v WHERE v.menu_item_id = v_source_id),
      'external_mappings', (SELECT COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb) FROM public.pos_external_item_mappings e WHERE e.menu_item_id = v_source_id),
      'open_item_mappings', (SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) FROM public.pos_open_item_mappings o WHERE o.target_menu_item_id = v_source_id),
      'compositions', (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM public.yatra_menu_item_compositions c WHERE c.menu_item_id = v_source_id)
    ) INTO v_snapshot_json;

    -- 4. Handle pos_menu_item_aliases (exact alias check + cardinality-safe normalized check; no updated_at column)
    v_norm_source_alias := COALESCE(
      NULLIF(trim(v_source.normalized_name), ''),
      public.normalize_pos_menu_name(v_source.name)
    );

    SELECT menu_item_id INTO v_existing_alias_target
    FROM public.pos_menu_item_aliases
    WHERE alias = v_source.name
    LIMIT 1;

    IF v_existing_alias_target IS NULL THEN
      SELECT a.menu_item_id INTO v_conflict_alias_target
      FROM public.pos_menu_item_aliases a
      JOIN public.pos_menu_items pm ON pm.id = a.menu_item_id
      WHERE pm.is_active = true
        AND public.normalize_pos_menu_name(a.alias) = v_norm_source_alias
        AND a.menu_item_id NOT IN (v_source_id, p_target_menu_item_id)
      LIMIT 1;

      IF v_conflict_alias_target IS NOT NULL THEN
        RAISE EXCEPTION 'Alias % already points to active menu item % (HTTP 409 Conflict)',
          v_source.name, v_conflict_alias_target USING ERRCODE = '23505';
      END IF;

      INSERT INTO public.pos_menu_item_aliases (menu_item_id, alias, normalized_alias)
      VALUES (p_target_menu_item_id, v_source.name, v_norm_source_alias)
      ON CONFLICT (alias) DO NOTHING;
    ELSIF v_existing_alias_target = v_source_id THEN
      UPDATE public.pos_menu_item_aliases
      SET menu_item_id = p_target_menu_item_id,
          normalized_alias = v_norm_source_alias
      WHERE alias = v_source.name;
    ELSIF v_existing_alias_target <> p_target_menu_item_id THEN
      RAISE EXCEPTION 'Alias % already points to different menu item % (HTTP 409 Conflict)',
        v_source.name, v_existing_alias_target USING ERRCODE = '23505';
    END IF;

    -- Repoint all remaining aliases belonging to source (deduping exact target collision cleanly)
    UPDATE public.pos_menu_item_aliases
    SET menu_item_id = p_target_menu_item_id
    WHERE menu_item_id = v_source_id;

    -- 5. Handle pos_external_item_mappings
    DELETE FROM public.pos_external_item_mappings s
    WHERE s.menu_item_id = v_source_id
      AND EXISTS (
        SELECT 1 FROM public.pos_external_item_mappings t
        WHERE t.provider = s.provider AND t.outlet_id = s.outlet_id AND t.external_item_id = s.external_item_id
          AND t.menu_item_id = p_target_menu_item_id
      );

    UPDATE public.pos_external_item_mappings
    SET menu_item_id = p_target_menu_item_id, updated_at = now()
    WHERE menu_item_id = v_source_id;

    -- 6. Handle pos_open_item_mappings
    DELETE FROM public.pos_open_item_mappings s
    WHERE s.target_menu_item_id = v_source_id
      AND EXISTS (
        SELECT 1 FROM public.pos_open_item_mappings t
        WHERE t.provider = s.provider AND t.outlet_id = s.outlet_id AND t.normalized_description = s.normalized_description
          AND t.target_menu_item_id = p_target_menu_item_id
      );

    UPDATE public.pos_open_item_mappings
    SET target_menu_item_id = p_target_menu_item_id
    WHERE target_menu_item_id = v_source_id;

    -- 7. Repoint yatra_combos_thalis
    UPDATE public.yatra_combos_thalis
    SET menu_item_id = p_target_menu_item_id, updated_at = now()
    WHERE menu_item_id = v_source_id;

    -- 7b. Repoint yatra_menu_item_variants safely (respecting idx_yatra_menu_item_variants_default)
    SELECT EXISTS (
      SELECT 1 FROM public.yatra_menu_item_variants
      WHERE menu_item_id = p_target_menu_item_id
        AND is_default = true
        AND is_active = true
    ) INTO v_target_has_default_variant;

    FOR v_var IN
      SELECT id, variant_name, recipe_id, is_default, is_active
      FROM public.yatra_menu_item_variants
      WHERE menu_item_id = v_source_id
      ORDER BY is_default DESC, created_at ASC
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.yatra_menu_item_variants tv
        WHERE tv.menu_item_id = p_target_menu_item_id
          AND tv.recipe_id = v_var.recipe_id
          AND public.normalize_pos_menu_name(tv.variant_name) = public.normalize_pos_menu_name(v_var.variant_name)
      ) THEN
        DELETE FROM public.yatra_menu_item_variants WHERE id = v_var.id;
      ELSE
        UPDATE public.yatra_menu_item_variants
        SET menu_item_id = p_target_menu_item_id,
            is_default = CASE
              WHEN v_var.is_default AND v_var.is_active AND NOT v_target_has_default_variant THEN true
              ELSE false
            END,
            updated_at = now()
        WHERE id = v_var.id;

        IF v_var.is_default AND v_var.is_active AND NOT v_target_has_default_variant THEN
          v_target_has_default_variant := true;
        END IF;
      END IF;
    END LOOP;

    -- 8. Repoint or validate yatra_menu_item_compositions
    IF EXISTS (SELECT 1 FROM public.yatra_menu_item_compositions WHERE menu_item_id = v_source_id) THEN
      IF NOT EXISTS (SELECT 1 FROM public.yatra_menu_item_compositions WHERE menu_item_id = p_target_menu_item_id) THEN
        UPDATE public.yatra_menu_item_compositions
        SET menu_item_id = p_target_menu_item_id, updated_at = now()
        WHERE menu_item_id = v_source_id;
      ELSE
        RAISE EXCEPTION 'Merge conflict on compositions: both source % and target % have active combo compositions',
          v_source_id, p_target_menu_item_id USING ERRCODE = '23505';
      END IF;
    END IF;

    -- 9. Mark source inactive & record merge log
    UPDATE public.pos_menu_items
    SET is_active = false,
        needs_setup = false,
        updated_at = now()
    WHERE id = v_source_id;

    IF v_target.category IS NOT NULL OR v_target.parent_category IS NOT NULL THEN
      UPDATE public.sales_hourly_items
      SET parent_category = COALESCE(v_target.parent_category, parent_category),
          category = COALESCE(v_target.category, category)
      WHERE public.normalize_pos_menu_name(item_name) = public.normalize_pos_menu_name(v_source.name);
    END IF;

    INSERT INTO public.yatra_menu_merge_logs (target_menu_item_id, source_menu_item_id, merged_by, source_snapshot_json)
    VALUES (p_target_menu_item_id, v_source_id, p_merged_by, v_snapshot_json);

    v_merged_count := v_merged_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'target_menu_item_id', p_target_menu_item_id,
    'merged_count', v_merged_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_merge_pos_menu_items_atomic(UUID, UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_merge_pos_menu_items_atomic(UUID, UUID[], UUID) TO service_role;

-- 4. Upgrade Sales Aggregation RPCs to normalize names & resolve aliases strictly to active canonical items
CREATE OR REPLACE FUNCTION public.get_menu_sales_aggregation(
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_channel TEXT DEFAULT 'ALL'
)
RETURNS TABLE (
  menu_item_id UUID,
  units_sold NUMERIC(14, 2),
  net_sales NUMERIC(14, 2),
  units_dine_in NUMERIC(14, 2),
  units_takeaway NUMERIC(14, 2),
  units_home_delivery NUMERIC(14, 2),
  units_lancho NUMERIC(14, 2),
  units_unknown NUMERIC(14, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_channel IS NOT NULL AND UPPER(TRIM(p_channel)) NOT IN
    ('ALL', 'DINE_IN', 'TAKEAWAY', 'HOME_DELIVERY', 'LANCHO', 'UNKNOWN') THEN
    RAISE EXCEPTION 'Unsupported menu sales channel: %', p_channel USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH item_name_map AS (
    SELECT public.normalize_pos_menu_name(p.name) AS norm_name, p.id AS mapped_menu_item_id, 1 AS priority
    FROM public.pos_menu_items p
    WHERE p.name IS NOT NULL AND TRIM(p.name) <> '' AND p.is_active = true
    UNION ALL
    SELECT public.normalize_pos_menu_name(a.alias), a.menu_item_id, 2
    FROM public.pos_menu_item_aliases a
    JOIN public.pos_menu_items pt ON pt.id = a.menu_item_id AND pt.is_active = true
    WHERE a.alias IS NOT NULL AND TRIM(a.alias) <> ''
    UNION ALL
    SELECT public.normalize_pos_menu_name(a.normalized_alias), a.menu_item_id, 2
    FROM public.pos_menu_item_aliases a
    JOIN public.pos_menu_items pt ON pt.id = a.menu_item_id AND pt.is_active = true
    WHERE a.normalized_alias IS NOT NULL AND TRIM(a.normalized_alias) <> ''
    UNION ALL
    SELECT public.normalize_pos_menu_name(p.normalized_name), p.id, 3
    FROM public.pos_menu_items p
    WHERE p.normalized_name IS NOT NULL AND TRIM(p.normalized_name) <> '' AND p.is_active = true
  ), best_priority AS (
    SELECT norm_name, MIN(priority) AS priority
    FROM item_name_map
    GROUP BY norm_name
  ), deduped_map AS (
    SELECT m.norm_name, (ARRAY_AGG(m.mapped_menu_item_id))[1] AS mapped_menu_item_id
    FROM item_name_map m
    JOIN best_priority b ON b.norm_name = m.norm_name AND b.priority = m.priority
    GROUP BY m.norm_name
    HAVING COUNT(DISTINCT m.mapped_menu_item_id) = 1
  ), classified_sales AS (
    SELECT
      m.mapped_menu_item_id,
      s.quantity,
      s.net_sales,
      CASE
        WHEN COALESCE(s.area, '') ILIKE '%lancho%'
          OR COALESCE(s.order_type, '') ILIKE '%lancho%'
          OR COALESCE(s.payment_type, '') ILIKE '%lancho%' THEN 'LANCHO'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'dine in' THEN 'DINE_IN'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'pick up'
          AND LOWER(TRIM(COALESCE(s.area, ''))) = 'parcel' THEN 'TAKEAWAY'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'delivery(parcel)'
          AND LOWER(TRIM(COALESCE(s.area, ''))) = 'home delivery' THEN 'HOME_DELIVERY'
        ELSE 'UNKNOWN'
      END AS sales_channel
    FROM public.sales_order_items s
    JOIN deduped_map m ON public.normalize_pos_menu_name(s.item_name) = m.norm_name
    WHERE s.status = 'Success'
      AND (p_date_from IS NULL OR s.business_date >= p_date_from)
      AND (p_date_to IS NULL OR s.business_date <= p_date_to)
  )
  SELECT
    s.mapped_menu_item_id,
    ROUND(COALESCE(SUM(s.quantity), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.net_sales), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.quantity) FILTER (WHERE s.sales_channel = 'DINE_IN'), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.quantity) FILTER (WHERE s.sales_channel = 'TAKEAWAY'), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.quantity) FILTER (WHERE s.sales_channel = 'HOME_DELIVERY'), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.quantity) FILTER (WHERE s.sales_channel = 'LANCHO'), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.quantity) FILTER (WHERE s.sales_channel = 'UNKNOWN'), 0)::NUMERIC, 2)
  FROM classified_sales s
  WHERE p_channel IS NULL OR UPPER(TRIM(p_channel)) = 'ALL'
    OR s.sales_channel = UPPER(TRIM(p_channel))
  GROUP BY s.mapped_menu_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_sales_aggregation(DATE, DATE, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_menu_sales_aggregation(DATE, DATE, TEXT) FROM anon, public;

CREATE OR REPLACE FUNCTION public.get_menu_item_daily_sales(
  p_menu_item_id UUID,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_channel TEXT DEFAULT 'ALL'
)
RETURNS TABLE (
  business_date DATE,
  units_sold NUMERIC(14, 2),
  net_sales NUMERIC(14, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_channel IS NOT NULL AND UPPER(TRIM(p_channel)) NOT IN
    ('ALL', 'DINE_IN', 'TAKEAWAY', 'HOME_DELIVERY', 'LANCHO', 'UNKNOWN') THEN
    RAISE EXCEPTION 'Unsupported menu sales channel: %', p_channel USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH item_name_map AS (
    SELECT public.normalize_pos_menu_name(p.name) AS norm_name, p.id AS mapped_menu_item_id, 1 AS priority
    FROM public.pos_menu_items p
    WHERE p.name IS NOT NULL AND TRIM(p.name) <> '' AND p.is_active = true
    UNION ALL
    SELECT public.normalize_pos_menu_name(a.alias), a.menu_item_id, 2
    FROM public.pos_menu_item_aliases a
    JOIN public.pos_menu_items pt ON pt.id = a.menu_item_id AND pt.is_active = true
    WHERE a.alias IS NOT NULL AND TRIM(a.alias) <> ''
    UNION ALL
    SELECT public.normalize_pos_menu_name(a.normalized_alias), a.menu_item_id, 2
    FROM public.pos_menu_item_aliases a
    JOIN public.pos_menu_items pt ON pt.id = a.menu_item_id AND pt.is_active = true
    WHERE a.normalized_alias IS NOT NULL AND TRIM(a.normalized_alias) <> ''
    UNION ALL
    SELECT public.normalize_pos_menu_name(p.normalized_name), p.id, 3
    FROM public.pos_menu_items p
    WHERE p.normalized_name IS NOT NULL AND TRIM(p.normalized_name) <> '' AND p.is_active = true
  ), best_priority AS (
    SELECT norm_name, MIN(priority) AS priority
    FROM item_name_map
    GROUP BY norm_name
  ), deduped_map AS (
    SELECT m.norm_name, (ARRAY_AGG(m.mapped_menu_item_id))[1] AS mapped_menu_item_id
    FROM item_name_map m
    JOIN best_priority b ON b.norm_name = m.norm_name AND b.priority = m.priority
    GROUP BY m.norm_name
    HAVING COUNT(DISTINCT m.mapped_menu_item_id) = 1
  ), classified_sales AS (
    SELECT
      s.business_date,
      s.quantity,
      s.net_sales,
      CASE
        WHEN COALESCE(s.area, '') ILIKE '%lancho%'
          OR COALESCE(s.order_type, '') ILIKE '%lancho%'
          OR COALESCE(s.payment_type, '') ILIKE '%lancho%' THEN 'LANCHO'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'dine in' THEN 'DINE_IN'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'pick up'
          AND LOWER(TRIM(COALESCE(s.area, ''))) = 'parcel' THEN 'TAKEAWAY'
        WHEN LOWER(TRIM(COALESCE(s.order_type, ''))) = 'delivery(parcel)'
          AND LOWER(TRIM(COALESCE(s.area, ''))) = 'home delivery' THEN 'HOME_DELIVERY'
        ELSE 'UNKNOWN'
      END AS sales_channel
    FROM public.sales_order_items s
    JOIN deduped_map m ON public.normalize_pos_menu_name(s.item_name) = m.norm_name
    WHERE s.status = 'Success'
      AND m.mapped_menu_item_id = p_menu_item_id
      AND (p_date_from IS NULL OR s.business_date >= p_date_from)
      AND (p_date_to IS NULL OR s.business_date <= p_date_to)
  )
  SELECT
    s.business_date,
    ROUND(COALESCE(SUM(s.quantity), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.net_sales), 0)::NUMERIC, 2)
  FROM classified_sales s
  WHERE p_channel IS NULL OR UPPER(TRIM(p_channel)) = 'ALL'
    OR s.sales_channel = UPPER(TRIM(p_channel))
  GROUP BY s.business_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_item_daily_sales(UUID, DATE, DATE, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_menu_item_daily_sales(UUID, DATE, DATE, TEXT) FROM anon, public;
