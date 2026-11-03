-- Add explicit reporting filters for every observed Petpooja channel pattern.
-- Lancho classification has precedence over order_type so Lancho lines cannot leak
-- into dine-in, takeaway, or the Delivery(Parcel) / Home Delivery bucket.

DROP FUNCTION IF EXISTS public.get_menu_sales_aggregation(DATE, DATE, TEXT);

CREATE FUNCTION public.get_menu_sales_aggregation(
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
    SELECT LOWER(TRIM(p.name)) AS norm_name, p.id AS mapped_menu_item_id, 1 AS priority
    FROM public.pos_menu_items p
    WHERE p.name IS NOT NULL AND TRIM(p.name) <> ''
    UNION ALL
    SELECT LOWER(TRIM(p.normalized_name)), p.id, 2
    FROM public.pos_menu_items p
    WHERE p.normalized_name IS NOT NULL AND TRIM(p.normalized_name) <> ''
    UNION ALL
    SELECT LOWER(TRIM(a.alias)), a.menu_item_id, 3
    FROM public.pos_menu_item_aliases a
    WHERE a.alias IS NOT NULL AND TRIM(a.alias) <> ''
    UNION ALL
    SELECT LOWER(TRIM(a.normalized_alias)), a.menu_item_id, 3
    FROM public.pos_menu_item_aliases a
    WHERE a.normalized_alias IS NOT NULL AND TRIM(a.normalized_alias) <> ''
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
    JOIN deduped_map m ON LOWER(TRIM(s.item_name)) = m.norm_name
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

DROP FUNCTION IF EXISTS public.get_menu_item_daily_sales(UUID, DATE, DATE);

CREATE FUNCTION public.get_menu_item_daily_sales(
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
    SELECT LOWER(TRIM(p.name)) AS norm_name, p.id AS mapped_menu_item_id, 1 AS priority
    FROM public.pos_menu_items p
    WHERE p.name IS NOT NULL AND TRIM(p.name) <> ''
    UNION ALL
    SELECT LOWER(TRIM(p.normalized_name)), p.id, 2
    FROM public.pos_menu_items p
    WHERE p.normalized_name IS NOT NULL AND TRIM(p.normalized_name) <> ''
    UNION ALL
    SELECT LOWER(TRIM(a.alias)), a.menu_item_id, 3
    FROM public.pos_menu_item_aliases a
    WHERE a.alias IS NOT NULL AND TRIM(a.alias) <> ''
    UNION ALL
    SELECT LOWER(TRIM(a.normalized_alias)), a.menu_item_id, 3
    FROM public.pos_menu_item_aliases a
    WHERE a.normalized_alias IS NOT NULL AND TRIM(a.normalized_alias) <> ''
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
  )
  SELECT
    s.business_date,
    ROUND(COALESCE(SUM(s.quantity), 0)::NUMERIC, 2),
    ROUND(COALESCE(SUM(s.net_sales), 0)::NUMERIC, 2)
  FROM public.sales_order_items s
  JOIN deduped_map m ON LOWER(TRIM(s.item_name)) = m.norm_name
  WHERE s.status = 'Success'
    AND m.mapped_menu_item_id = p_menu_item_id
    AND (p_date_from IS NULL OR s.business_date >= p_date_from)
    AND (p_date_to IS NULL OR s.business_date <= p_date_to)
    AND (
      p_channel IS NULL OR UPPER(TRIM(p_channel)) = 'ALL'
      OR (
        UPPER(TRIM(p_channel)) = 'LANCHO'
        AND (COALESCE(s.area, '') ILIKE '%lancho%'
          OR COALESCE(s.order_type, '') ILIKE '%lancho%'
          OR COALESCE(s.payment_type, '') ILIKE '%lancho%')
      )
      OR (
        UPPER(TRIM(p_channel)) = 'DINE_IN'
        AND LOWER(TRIM(COALESCE(s.order_type, ''))) = 'dine in'
        AND COALESCE(s.area, '') NOT ILIKE '%lancho%'
        AND COALESCE(s.order_type, '') NOT ILIKE '%lancho%'
        AND COALESCE(s.payment_type, '') NOT ILIKE '%lancho%'
      )
      OR (
        UPPER(TRIM(p_channel)) = 'TAKEAWAY'
        AND LOWER(TRIM(COALESCE(s.order_type, ''))) = 'pick up'
        AND LOWER(TRIM(COALESCE(s.area, ''))) = 'parcel'
        AND COALESCE(s.area, '') NOT ILIKE '%lancho%'
        AND COALESCE(s.order_type, '') NOT ILIKE '%lancho%'
        AND COALESCE(s.payment_type, '') NOT ILIKE '%lancho%'
      )
      OR (
        UPPER(TRIM(p_channel)) = 'HOME_DELIVERY'
        AND LOWER(TRIM(COALESCE(s.order_type, ''))) = 'delivery(parcel)'
        AND LOWER(TRIM(COALESCE(s.area, ''))) = 'home delivery'
        AND COALESCE(s.area, '') NOT ILIKE '%lancho%'
        AND COALESCE(s.order_type, '') NOT ILIKE '%lancho%'
        AND COALESCE(s.payment_type, '') NOT ILIKE '%lancho%'
      )
      OR (
        UPPER(TRIM(p_channel)) = 'UNKNOWN'
        AND COALESCE(s.area, '') NOT ILIKE '%lancho%'
        AND COALESCE(s.order_type, '') NOT ILIKE '%lancho%'
        AND COALESCE(s.payment_type, '') NOT ILIKE '%lancho%'
        AND LOWER(TRIM(COALESCE(s.order_type, ''))) <> 'dine in'
        AND NOT (LOWER(TRIM(COALESCE(s.order_type, ''))) = 'pick up'
          AND LOWER(TRIM(COALESCE(s.area, ''))) = 'parcel')
        AND NOT (LOWER(TRIM(COALESCE(s.order_type, ''))) = 'delivery(parcel)'
          AND LOWER(TRIM(COALESCE(s.area, ''))) = 'home delivery')
      )
    )
  GROUP BY s.business_date
  ORDER BY s.business_date ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_item_daily_sales(UUID, DATE, DATE, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_menu_item_daily_sales(UUID, DATE, DATE, TEXT) FROM anon, public;
