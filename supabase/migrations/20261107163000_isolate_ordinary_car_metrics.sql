-- Corrective Migration: Isolate ordinary cars from commercial taxi visits in operating_metrics
-- Historical migrations remain untouched.
-- Taxis (CAR_5, CAR_7, TRAVELLER, BUS) and any events linked to taxi visits (taxi_visit_id IS NOT NULL)
-- are strictly excluded from the 'cars' count in operating_metrics, ensuring 'cars' represents ordinary cars only.

CREATE OR REPLACE FUNCTION public.operating_metrics(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT (marketing_can('dashboard.view') OR marketing_can('operations.daily') OR marketing_can('reports.view')) THEN
    PERFORM marketing_assert('reports.view');
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 3660 THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;

  WITH coverage AS (
    SELECT
      (p_to - p_from + 1) AS expected,
      count(DISTINCT business_date) AS imported
    FROM sales_import_batches
    WHERE report_type = 'ORDERS_MASTER'
      AND business_date BETWEEN p_from AND p_to
  ),
  dining AS (
    SELECT
      coalesce(sum(net_sales), 0) AS net,
      count(*) AS bills,
      coalesce(sum(covers_pax), 0) AS covers
    FROM sales_orders
    WHERE business_date BETWEEN p_from AND p_to
      AND status = 'Success'
      AND lower(trim(order_type)) IN ('dine in', 'dine-in', 'dinein')
      AND upper(trim(coalesce(area, ''))) NOT IN ('LANCHO', 'PARCEL')
      AND coalesce(payment_type, '') NOT ILIKE '%lancho%'
  ),
  vehicles AS (
    SELECT
      -- Ordinary cars only: exclude all taxi arrivals and attached taxi events
      coalesce(sum(e.increment) FILTER (
        WHERE e.taxi_visit_id IS NULL
          AND (e.vehicle_category IS NULL OR e.vehicle_category = 'CAR')
          AND lower(coalesce(e.vehicle_prefix, '')) <> 'bike'
          AND lower(coalesce(l.name, '')) <> 'bike'
      ), 0) AS cars,
      coalesce(sum(e.increment) FILTER (
        WHERE (e.vehicle_category = 'BIKE' OR (e.vehicle_category IS NULL AND (lower(coalesce(e.vehicle_prefix, '')) = 'bike' OR lower(coalesce(l.name, '')) = 'bike')))
      ), 0) AS bikes,
      coalesce(sum(e.increment) FILTER (
        WHERE e.vehicle_category = 'TRAVELLER'
      ), 0) AS travellers,
      coalesce(sum(e.increment) FILTER (
        WHERE e.vehicle_category = 'BUS'
      ), 0) AS buses
    FROM vehicle_counter_events e
    LEFT JOIN vehicle_origin_locations l ON l.id = e.location_id
    WHERE e.business_date BETWEEN p_from AND p_to
      AND e.voided_at IS NULL
  ),
  completeness AS (
    SELECT
      *,
      imported = expected AND p_to < (now() AT TIME ZONE 'Asia/Kolkata')::date AS complete
    FROM coverage
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'expected_days', c.expected,
    'imported_days', c.imported,
    'complete', c.complete,
    'live', p_to >= (now() AT TIME ZONE 'Asia/Kolkata')::date,
    'net_sales', d.net::text,
    'bills', d.bills,
    'covers', d.covers,
    'cars', v.cars,
    'bikes', v.bikes,
    'travellers', v.travellers,
    'buses', v.buses,
    'spend_per_cover', CASE WHEN c.complete THEN round(d.net / nullif(d.covers, 0), 2)::text END,
    'spend_per_bill', CASE WHEN c.complete THEN round(d.net / nullif(d.bills, 0), 2)::text END,
    'covers_per_bill', CASE WHEN c.complete THEN round(d.covers::numeric / nullif(d.bills, 0), 2)::text END,
    'covers_per_car', CASE WHEN c.complete THEN round(d.covers::numeric / nullif(v.cars, 0), 2)::text END,
    'spend_per_car', CASE WHEN c.complete THEN round(d.net / nullif(v.cars, 0), 2)::text END
  )
  INTO result
  FROM completeness c
  CROSS JOIN dining d
  CROSS JOIN vehicles v;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.operating_metrics(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operating_metrics(date, date) TO authenticated;
