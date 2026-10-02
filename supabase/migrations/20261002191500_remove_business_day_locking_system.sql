-- Migration: 20261002191500_remove_business_day_locking_system.sql
-- Description: Completely and permanently remove the legacy Business Day / Record Locking system
--              and migrate the operations.closing RBAC permission to operations.daily.
-- Idempotency: Safe to run on pre-removal databases or already-cleaned databases.

-- ============================================================================
-- 1. DROP LOCK-SPECIFIC DATABASE TRIGGERS
-- ============================================================================
-- Drop trg_lock_closed_day triggers from all 7 operational tables if they exist.
DROP TRIGGER IF EXISTS trg_lock_closed_day ON public.expenses;
DROP TRIGGER IF EXISTS trg_lock_closed_day ON public.purchase_headers;
DROP TRIGGER IF EXISTS trg_lock_closed_day ON public.stock_movements;
DROP TRIGGER IF EXISTS trg_lock_closed_day ON public.activity_daily_records;
DROP TRIGGER IF EXISTS trg_lock_closed_day ON public.attendance;
DROP TRIGGER IF EXISTS trg_lock_closed_day ON public.meter_readings;
DROP TRIGGER IF EXISTS trg_lock_closed_day ON public.consumption_issues;

-- ============================================================================
-- 2. DROP LOCK-SPECIFIC TRIGGER FUNCTION
-- ============================================================================
DROP FUNCTION IF EXISTS public.check_business_day_lock();

-- ============================================================================
-- 3. REBUILD DOWNSTREAM FINANCIAL VIEWS (Sever dependency on business_days)
-- ============================================================================
-- Rebuild daily_financial_summary so it no longer unions or queries public.business_days.
-- closing_status defaults to 'open' for schema backwards-compatibility.
CREATE OR REPLACE VIEW public.daily_financial_summary AS
SELECT d.business_date,
  'open'::text AS closing_status,
  COALESCE(s.net_sales, 0.00) AS revenue,
  COALESCE(s.is_reported, false) AS sales_reported,
  s.last_updated_at AS revenue_last_updated,
  COALESCE(cons.customer_food_cost, 0.00) AS customer_food_consumption,
  COALESCE(cons.staff_food_cost, 0.00) AS staff_food_consumption,
  COALESCE(cons.wastage_cost, 0.00) AS wastage_cost,
  COALESCE(cons.total_consumption, 0.00) AS total_material_consumption,
  COALESCE(exp.variable_expenses, 0.00) AS variable_expenses,
  COALESCE(s.total_payment_commissions, 0.00) AS payment_commissions,
  (((((COALESCE(s.net_sales, 0.00) - COALESCE(cons.total_consumption, 0.00)) - COALESCE(exp.variable_expenses, 0.00)) - COALESCE(s.total_payment_commissions, 0.00)) - round((COALESCE(s.net_sales, 0.00) * 0.10), 2)) - round((COALESCE(s.net_sales, 0.00) * 0.10), 2)) AS gross_operating_surplus,
  round((COALESCE(s.net_sales, 0.00) * 0.10), 2) AS property_rent,
  round((COALESCE(s.net_sales, 0.00) * 0.10), 2) AS investor_share,
  COALESCE(cons.operational_consumption_cost, 0.00) AS operational_consumption
FROM (((( SELECT daily_sales_summary.business_date
        FROM daily_sales_summary
      UNION
      SELECT stock_movements.business_date
        FROM stock_movements
      UNION
      SELECT expenses.business_date
        FROM expenses) d
  LEFT JOIN daily_sales_summary s ON ((d.business_date = s.business_date)))
  LEFT JOIN ( SELECT stock_movements.business_date,
          sum(
              CASE
                  WHEN (stock_movements.purpose = 'Customer Food'::text) THEN stock_movements.total_value
                  ELSE (0)::numeric
              END) AS customer_food_cost,
          sum(
              CASE
                  WHEN ((stock_movements.purpose = 'Staff Food'::text) OR (stock_movements.movement_type = 'staff_food'::text)) THEN stock_movements.total_value
                  ELSE (0)::numeric
              END) AS staff_food_cost,
          sum(
              CASE
                  WHEN ((stock_movements.purpose = ANY (ARRAY['Wastage'::text, 'Spoilage'::text])) OR (stock_movements.movement_type = ANY (ARRAY['wastage'::text, 'spoilage'::text, 'breakage'::text]))) THEN stock_movements.total_value
                  ELSE (0)::numeric
              END) AS wastage_cost,
          sum(
              CASE
                  WHEN ((stock_movements.purpose = 'Operational Consumption'::text) OR ((stock_movements.movement_type = 'issue'::text) AND (stock_movements.purpose <> ALL (ARRAY['Customer Food'::text, 'Staff Food'::text])))) THEN stock_movements.total_value
                  ELSE (0)::numeric
              END) AS operational_consumption_cost,
          sum(
              CASE
                  WHEN (stock_movements.movement_type = ANY (ARRAY['issue'::text, 'consumption_issue'::text, 'staff_food'::text, 'wastage'::text, 'spoilage'::text, 'breakage'::text, 'consumption'::text])) THEN stock_movements.total_value
                  ELSE (0)::numeric
              END) AS total_consumption
        FROM stock_movements
        GROUP BY stock_movements.business_date) cons ON ((d.business_date = cons.business_date)))
  LEFT JOIN ( SELECT expenses.business_date,
          sum(expenses.amount) AS variable_expenses
        FROM expenses
        GROUP BY expenses.business_date) exp ON ((d.business_date = exp.business_date)));

-- Re-assert monthly_profitability view dependency
CREATE OR REPLACE VIEW public.monthly_profitability AS
SELECT 
    TO_CHAR(business_date, 'YYYY-MM') AS year_month,
    COUNT(DISTINCT business_date) AS days_recorded,
    SUM(revenue) AS mtd_revenue,
    SUM(customer_food_consumption) AS mtd_customer_food_cost,
    SUM(staff_food_consumption) AS mtd_staff_food_cost,
    SUM(wastage_cost) AS mtd_wastage_cost,
    SUM(total_material_consumption) AS mtd_material_consumption,
    SUM(variable_expenses) AS mtd_variable_expenses,
    SUM(payment_commissions) AS mtd_payment_commissions,
    SUM(gross_operating_surplus) AS mtd_operating_surplus,
    CASE 
        WHEN SUM(revenue) > 0 
        THEN ROUND((SUM(customer_food_consumption) / SUM(revenue)) * 100, 1) 
        ELSE 0 
    END AS food_cost_percentage
FROM public.daily_financial_summary
GROUP BY TO_CHAR(business_date, 'YYYY-MM');

-- ============================================================================
-- 4. DROP BUSINESS_DAYS TABLE (SAFE, NON-CASCADING)
-- ============================================================================
-- With view dependencies severed above, DROP TABLE does not require CASCADE.
DROP TABLE IF EXISTS public.business_days;

-- ============================================================================
-- 5. MIGRATE RBAC PERMISSION: operations.closing -> operations.daily
-- ============================================================================
-- Safely migrates operations.closing to operations.daily preserving existing
-- role_permissions assignments (Admin, General Manager, Accountant, Cashier).
DO $$
BEGIN
  -- Case 1: If operations.closing exists and operations.daily does NOT exist, update in place
  IF EXISTS (SELECT 1 FROM public.permissions WHERE code = 'operations.closing') AND 
     NOT EXISTS (SELECT 1 FROM public.permissions WHERE code = 'operations.daily') THEN
    UPDATE public.permissions 
    SET code = 'operations.daily',
        action = 'manage',
        description = 'Access Daily Operations hub and operational oversight'
    WHERE code = 'operations.closing';

  -- Case 2: If both exist, reassign role_permissions and delete operations.closing
  ELSIF EXISTS (SELECT 1 FROM public.permissions WHERE code = 'operations.closing') AND 
        EXISTS (SELECT 1 FROM public.permissions WHERE code = 'operations.daily') THEN
    UPDATE public.role_permissions
    SET permission_id = (SELECT id FROM public.permissions WHERE code = 'operations.daily')
    WHERE permission_id = (SELECT id FROM public.permissions WHERE code = 'operations.closing')
      AND role_id NOT IN (
        SELECT role_id FROM public.role_permissions 
        WHERE permission_id = (SELECT id FROM public.permissions WHERE code = 'operations.daily')
      );
    DELETE FROM public.role_permissions 
    WHERE permission_id = (SELECT id FROM public.permissions WHERE code = 'operations.closing');
    DELETE FROM public.permissions WHERE code = 'operations.closing';

  -- Case 3: If neither exists, insert operations.daily cleanly
  ELSIF NOT EXISTS (SELECT 1 FROM public.permissions WHERE code = 'operations.daily') THEN
    INSERT INTO public.permissions (module, action, code, description)
    VALUES ('operations', 'manage', 'operations.daily', 'Access Daily Operations hub and operational oversight');
  END IF;
END $$;
