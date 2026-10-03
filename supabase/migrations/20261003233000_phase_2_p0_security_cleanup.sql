-- Migration: 20261003233000_phase_2_p0_security_cleanup.sql
-- Description: Phase 2 (P0) security cleanup: 2 functions, 1 security boundary, 5 public-policy tables, 11 views

-- ----------------------------------------------------------------------------
-- 1. FUNCTIONS
-- ----------------------------------------------------------------------------
-- get_mtd_financial_summary: lock search_path and revoke public/anon execution
ALTER FUNCTION public.get_mtd_financial_summary(date) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.get_mtd_financial_summary(date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_mtd_financial_summary(date) TO authenticated, service_role;

-- protect_profile_sensitive_fields: revoke direct execution (internal trigger only)
REVOKE EXECUTE ON FUNCTION public.protect_profile_sensitive_fields() FROM anon, authenticated, public;

-- ----------------------------------------------------------------------------
-- 2. SECURITY BOUNDARY TABLE: user_permissions
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.user_permissions FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_permissions TO authenticated, service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_permissions_select_authenticated ON public.user_permissions;
CREATE POLICY user_permissions_select_authenticated 
  ON public.user_permissions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS user_permissions_admin_all ON public.user_permissions;
CREATE POLICY user_permissions_admin_all 
  ON public.user_permissions FOR ALL TO authenticated 
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- 3. REMOVE EXISTING TO public POLICIES (5 TABLES)
-- ----------------------------------------------------------------------------

-- A. sales_order_items
DROP POLICY IF EXISTS sales_order_items_all_policy ON public.sales_order_items;
DROP POLICY IF EXISTS sales_order_items_read_policy ON public.sales_order_items;
REVOKE ALL ON TABLE public.sales_order_items FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_order_items TO authenticated, service_role;

DROP POLICY IF EXISTS sales_order_items_authenticated_all ON public.sales_order_items;
CREATE POLICY sales_order_items_authenticated_all 
  ON public.sales_order_items FOR ALL TO authenticated 
  USING (true) WITH CHECK (true);

-- B. vehicle_counter_events
DROP POLICY IF EXISTS "Allow read access to vehicle events" ON public.vehicle_counter_events;
DROP POLICY IF EXISTS "Allow insert access to vehicle events" ON public.vehicle_counter_events;
DROP POLICY IF EXISTS "Allow admin update to vehicle events" ON public.vehicle_counter_events;
REVOKE ALL ON TABLE public.vehicle_counter_events FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicle_counter_events TO authenticated, service_role;

DROP POLICY IF EXISTS vehicle_events_select_authenticated ON public.vehicle_counter_events;
CREATE POLICY vehicle_events_select_authenticated 
  ON public.vehicle_counter_events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS vehicle_events_insert_authenticated ON public.vehicle_counter_events;
CREATE POLICY vehicle_events_insert_authenticated 
  ON public.vehicle_counter_events FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS vehicle_events_admin_all ON public.vehicle_counter_events;
CREATE POLICY vehicle_events_admin_all 
  ON public.vehicle_counter_events FOR ALL TO authenticated 
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- C. visitor_counter_events
DROP POLICY IF EXISTS "Allow read access to visitor events" ON public.visitor_counter_events;
DROP POLICY IF EXISTS "Allow insert access to visitor events" ON public.visitor_counter_events;
REVOKE ALL ON TABLE public.visitor_counter_events FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.visitor_counter_events TO authenticated, service_role;

DROP POLICY IF EXISTS visitor_events_select_authenticated ON public.visitor_counter_events;
CREATE POLICY visitor_events_select_authenticated 
  ON public.visitor_counter_events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS visitor_events_insert_authenticated ON public.visitor_counter_events;
CREATE POLICY visitor_events_insert_authenticated 
  ON public.visitor_counter_events FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS visitor_events_admin_all ON public.visitor_counter_events;
CREATE POLICY visitor_events_admin_all 
  ON public.visitor_counter_events FOR ALL TO authenticated 
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- D. vehicle_registration_prefixes
DROP POLICY IF EXISTS "Allow public read access to prefixes" ON public.vehicle_registration_prefixes;
DROP POLICY IF EXISTS "Allow authenticated users to mutate prefixes" ON public.vehicle_registration_prefixes;
REVOKE ALL ON TABLE public.vehicle_registration_prefixes FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicle_registration_prefixes TO authenticated, service_role;

DROP POLICY IF EXISTS vehicle_prefixes_select_authenticated ON public.vehicle_registration_prefixes;
CREATE POLICY vehicle_prefixes_select_authenticated 
  ON public.vehicle_registration_prefixes FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS vehicle_prefixes_admin_all ON public.vehicle_registration_prefixes;
CREATE POLICY vehicle_prefixes_admin_all 
  ON public.vehicle_registration_prefixes FOR ALL TO authenticated 
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- E. employee_salary_payouts (Legacy)
DROP POLICY IF EXISTS salary_payouts_all ON public.employee_salary_payouts;
REVOKE ALL ON TABLE public.employee_salary_payouts FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employee_salary_payouts TO authenticated, service_role;

DROP POLICY IF EXISTS salary_payouts_admin_all ON public.employee_salary_payouts;
CREATE POLICY salary_payouts_admin_all 
  ON public.employee_salary_payouts FOR ALL TO authenticated 
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- 4. INTERNAL VIEWS (11 VIEWS)
-- ----------------------------------------------------------------------------
-- Revoke anon and public from all 11 views
DO $$
DECLARE
  v text;
  all_views text[] := ARRAY[
    'daily_financial_summary', 'daily_sales_reconciliation', 'daily_sales_summary',
    'daily_target_progress', 'distinct_sales_items', 'employee_financial_balance',
    'employee_salary_summary', 'inventory_current_position', 'meter_readings_ledger',
    'monthly_profitability', 'vendor_outstanding_summary'
  ];
BEGIN
  FOREACH v IN ARRAY all_views LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, public;', v);
  END LOOP;
END $$;

-- Preserve authenticated & service_role access on the 8 client views
DO $$
DECLARE
  v text;
  client_views text[] := ARRAY[
    'daily_financial_summary', 'daily_sales_reconciliation', 'daily_sales_summary',
    'daily_target_progress', 'employee_salary_summary', 'inventory_current_position',
    'meter_readings_ledger', 'vendor_outstanding_summary'
  ];
BEGIN
  FOREACH v IN ARRAY client_views LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated, service_role;', v);
  END LOOP;
END $$;

-- Lock down 3 server-only / unused views to service_role only
REVOKE ALL ON TABLE public.distinct_sales_items FROM authenticated;
GRANT SELECT ON TABLE public.distinct_sales_items TO service_role;

REVOKE ALL ON TABLE public.employee_financial_balance FROM authenticated;
GRANT SELECT ON TABLE public.employee_financial_balance TO service_role;

REVOKE ALL ON TABLE public.monthly_profitability FROM authenticated;
GRANT SELECT ON TABLE public.monthly_profitability TO service_role;
