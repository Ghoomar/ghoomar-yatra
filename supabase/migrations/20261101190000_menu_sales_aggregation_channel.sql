-- Migration: 20261101190000_menu_sales_aggregation_channel.sql
-- Description: Upgrade public.get_menu_sales_aggregation to support optional channel filtering (DINE_IN, TAKEAWAY, ALL)
-- Author: Ghoomar Yatra Teamwork Architecture
-- Milestone: M3 (Menu Master UI & Period Sales)

-- 1. Drop obsolete 2-argument signature to prevent PostgREST RPC function overload ambiguity
DROP FUNCTION IF EXISTS public.get_menu_sales_aggregation(DATE, DATE);

-- 2. Create the upgraded 3-argument function with default parameter values
CREATE OR REPLACE FUNCTION public.get_menu_sales_aggregation(
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_channel TEXT DEFAULT NULL
)
RETURNS TABLE (
  menu_item_id UUID,
  units_sold NUMERIC(14, 2),
  net_sales NUMERIC(14, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH item_name_map AS (
    -- Canonical names (priority 1)
    SELECT 
      LOWER(TRIM(p.name)) AS norm_name,
      p.id AS mapped_menu_item_id,
      1 AS priority
    FROM public.pos_menu_items p
    WHERE p.name IS NOT NULL AND TRIM(p.name) != ''
    UNION ALL
    -- Normalized canonical names
    SELECT 
      LOWER(TRIM(p.normalized_name)) AS norm_name,
      p.id AS mapped_menu_item_id,
      1 AS priority
    FROM public.pos_menu_items p
    WHERE p.normalized_name IS NOT NULL AND TRIM(p.normalized_name) != ''
    UNION ALL
    -- Aliases (priority 2, strictly unambiguous: only aliases mapping to exactly 1 distinct menu_item_id)
    SELECT 
      LOWER(TRIM(a.alias)) AS norm_name,
      (ARRAY_AGG(a.menu_item_id))[1] AS mapped_menu_item_id,
      2 AS priority
    FROM public.pos_menu_item_aliases a
    WHERE a.alias IS NOT NULL AND TRIM(a.alias) != ''
    GROUP BY LOWER(TRIM(a.alias))
    HAVING COUNT(DISTINCT a.menu_item_id) = 1
    UNION ALL
    -- Normalized aliases
    SELECT 
      LOWER(TRIM(a.normalized_alias)) AS norm_name,
      (ARRAY_AGG(a.menu_item_id))[1] AS mapped_menu_item_id,
      2 AS priority
    FROM public.pos_menu_item_aliases a
    WHERE a.normalized_alias IS NOT NULL AND TRIM(a.normalized_alias) != ''
    GROUP BY LOWER(TRIM(a.normalized_alias))
    HAVING COUNT(DISTINCT a.menu_item_id) = 1
  ),
  deduped_map AS (
    SELECT DISTINCT ON (norm_name) norm_name, mapped_menu_item_id
    FROM item_name_map
    ORDER BY norm_name, priority ASC
  )
  SELECT 
    m.mapped_menu_item_id AS menu_item_id,
    ROUND(COALESCE(SUM(s.quantity), 0)::NUMERIC, 2) AS units_sold,
    ROUND(COALESCE(SUM(s.net_sales), 0)::NUMERIC, 2) AS net_sales
  FROM public.sales_order_items s
  JOIN deduped_map m ON LOWER(TRIM(s.item_name)) = m.norm_name
  WHERE s.status = 'Success'
    AND (p_date_from IS NULL OR s.business_date >= p_date_from)
    AND (p_date_to IS NULL OR s.business_date <= p_date_to)
    AND (
      p_channel IS NULL
      OR UPPER(TRIM(p_channel)) = 'ALL'
      OR (
        UPPER(TRIM(p_channel)) = 'DINE_IN' 
        AND s.order_type ILIKE 'Dine%'
        AND NOT (
          COALESCE(s.area, '') ILIKE '%lancho%' 
          OR COALESCE(s.order_type, '') ILIKE '%lancho%' 
          OR COALESCE(s.payment_type, '') ILIKE '%lancho%'
        )
      )
      OR (
        UPPER(TRIM(p_channel)) = 'TAKEAWAY' 
        AND (s.order_type ILIKE 'Pick%' OR s.order_type ILIKE 'Takeaway%' OR LOWER(COALESCE(s.area, '')) = 'parcel')
        AND NOT (
          COALESCE(s.area, '') ILIKE '%lancho%' 
          OR COALESCE(s.order_type, '') ILIKE '%lancho%' 
          OR COALESCE(s.payment_type, '') ILIKE '%lancho%'
          OR s.order_type ILIKE 'Delivery%'
          OR s.order_type ILIKE 'Snacks Stall%'
        )
      )
    )
  GROUP BY m.mapped_menu_item_id;
END;
$$;

-- 3. Grants and Revocations
GRANT EXECUTE ON FUNCTION public.get_menu_sales_aggregation(DATE, DATE, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_menu_sales_aggregation(DATE, DATE, TEXT) FROM anon, public;
