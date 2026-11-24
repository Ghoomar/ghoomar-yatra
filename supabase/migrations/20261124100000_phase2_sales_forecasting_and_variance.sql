-- ============================================================================
-- Migration: 20261124100000_phase2_sales_forecasting_and_variance.sql
-- Description: Phase 2 Dual-Track Sales Forecasting Engine, Intelligent Bill
--              Classification, BOM Purchasing Integration & Theo-vs-Act Variance
-- ============================================================================

-- 1. Helper Security Functions for Sales & Costing Permissions
CREATE OR REPLACE FUNCTION public.can_manage_sales_forecast()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
      AND r.name IN ('Admin', 'Owner', 'General Manager', 'Accountant')
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid()
      AND perm.code IN ('finance.sales', 'admin.manage')
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_sales_forecast() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_manage_sales_forecast() FROM anon, public;

CREATE OR REPLACE FUNCTION public.can_view_sensitive_costing()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
      AND r.name IN ('Admin', 'Owner', 'General Manager', 'Accountant')
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid()
      AND perm.code IN ('sops.costing.view', 'finance.profitability', 'reports.view', 'admin.manage')
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_view_sensitive_costing() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_view_sensitive_costing() FROM anon, public;

-- 2. Dynamic Bill Classification Thresholds
CREATE TABLE IF NOT EXISTS public.sales_bill_classification_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_date DATE NOT NULL,
  dine_in_pax_p95 NUMERIC(6,2) NOT NULL DEFAULT 7.00,
  dine_in_pax_p99 NUMERIC(6,2) NOT NULL DEFAULT 10.00,
  dine_in_spp_p95 NUMERIC(10,2) NOT NULL DEFAULT 553.54,
  dine_in_spp_p99 NUMERIC(10,2) NOT NULL DEFAULT 840.70,
  pax_large_group_threshold INTEGER NOT NULL DEFAULT 20,
  spend_per_pax_anomaly_threshold NUMERIC(10,2) NOT NULL DEFAULT 750.00,
  bill_net_sales_anomaly_threshold NUMERIC(12,2) NOT NULL DEFAULT 10000.00,
  iqr_multiplier NUMERIC(4,2) NOT NULL DEFAULT 2.50,
  trained_on_bills_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Transaction-Level Bill Classifications
CREATE TABLE IF NOT EXISTS public.sales_bill_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  primary_table_no TEXT,
  bill_status TEXT NOT NULL DEFAULT 'Success',
  bill_class TEXT NOT NULL CHECK (bill_class IN ('normal', 'large_group', 'high_value_anomaly', 'data_anomaly', 'cancelled', 'excluded')),
  is_group_member BOOLEAN NOT NULL DEFAULT false,
  group_cluster_id UUID,
  group_type TEXT CHECK (group_type IN ('standard_group', 'school_group', 'corporate', 'tour_bus')),
  group_association_tier TEXT CHECK (group_association_tier IN ('tier1_auto_explicit', 'tier2_candidate_flag', 'manual_manager')),
  is_manually_overridden BOOLEAN NOT NULL DEFAULT false,
  manager_override_notes TEXT,
  bill_net_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  bill_pax INTEGER NOT NULL DEFAULT 0,
  bill_apc NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  daypart TEXT NOT NULL DEFAULT 'lunch' CHECK (daypart IN ('breakfast', 'lunch', 'dinner', 'late_night')),
  outside_activities_net NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  outside_activities_qty NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  restaurant_food_net NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  restaurant_food_qty NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  classification_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_sales_bill_classification UNIQUE (sales_order_id)
);
CREATE INDEX IF NOT EXISTS idx_bill_class_date ON public.sales_bill_classifications(business_date, bill_class);
CREATE INDEX IF NOT EXISTS idx_bill_class_cluster ON public.sales_bill_classifications(group_cluster_id);
CREATE INDEX IF NOT EXISTS idx_bill_class_order ON public.sales_bill_classifications(sales_order_id);

-- 4. Learned Group Profiles
CREATE TABLE IF NOT EXISTS public.sales_forecast_group_profiles (
  group_type TEXT PRIMARY KEY CHECK (group_type IN ('standard_group', 'school_group', 'corporate', 'tour_bus')),
  sample_events_count INTEGER NOT NULL DEFAULT 0,
  learned_apc NUMERIC(10,2) NOT NULL DEFAULT 240.00,
  learned_units_per_guest NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  primary_daypart TEXT NOT NULL DEFAULT 'lunch' CHECK (primary_daypart IN ('breakfast', 'lunch', 'dinner', 'full_day')),
  typical_dish_mix_json JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed Learned Group Profiles
INSERT INTO public.sales_forecast_group_profiles (group_type, sample_events_count, learned_apc, learned_units_per_guest, primary_daypart)
VALUES
  ('standard_group', 5, 280.00, 1.20, 'lunch'),
  ('school_group', 5, 240.00, 1.00, 'lunch'),
  ('corporate', 2, 850.00, 1.80, 'dinner'),
  ('tour_bus', 3, 260.00, 1.10, 'lunch')
ON CONFLICT (group_type) DO NOTHING;

-- 5. Event Types with Independent Revenue & Volume Multipliers
CREATE TABLE IF NOT EXISTS public.sales_forecast_event_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_hi TEXT NOT NULL,
  prior_revenue_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  learned_revenue_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  prior_volume_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  learned_volume_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  sample_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed Event Types
INSERT INTO public.sales_forecast_event_types (code, name, name_hi, prior_revenue_multiplier, learned_revenue_multiplier, prior_volume_multiplier, learned_volume_multiplier)
VALUES
  ('CHILDRENS_DAY', 'Children''s Day / School Visits', 'बाल दिवस / स्कूल ग्रुप', 1.00, 1.00, 1.00, 1.00),
  ('DIWALI_HOLIDAY', 'Diwali Shopping Slowdown', 'दीपावली बाज़ार मंदी', 0.50, 0.50, 0.50, 0.50),
  ('WEEKEND_FESTIVAL', 'Weekend Cultural Festival', 'सप्ताहांत सांस्कृतिक उत्सव', 1.25, 1.25, 1.20, 1.20),
  ('LONG_WEEKEND', 'National Holiday / Long Weekend', 'राष्ट्रीय अवकाश / लंबा सप्ताहांत', 1.30, 1.30, 1.25, 1.25)
ON CONFLICT (code) DO NOTHING;

-- 6. Day Context Overrides
CREATE TABLE IF NOT EXISTS public.sales_forecast_day_context (
  business_date DATE PRIMARY KEY,
  day_mode TEXT NOT NULL CHECK (day_mode IN ('normal', 'special_event', 'group_booking', 'hybrid_event_and_group')),
  event_type_id UUID REFERENCES public.sales_forecast_event_types(id),
  expected_guests INTEGER DEFAULT 0,
  group_type TEXT REFERENCES public.sales_forecast_group_profiles(group_type),
  group_daypart TEXT DEFAULT 'lunch' CHECK (group_daypart IN ('breakfast', 'lunch', 'dinner', 'full_day')),
  group_notes TEXT,
  custom_rev_multiplier_override NUMERIC(5,2),
  custom_qty_multiplier_override NUMERIC(5,2),
  tagged_retroactively BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed 2026-11-14 & 2026-11-17 as Children's Day school_group days
INSERT INTO public.sales_forecast_day_context (business_date, day_mode, expected_guests, group_type, group_daypart, group_notes, tagged_retroactively)
VALUES
  ('2026-11-14', 'group_booking', 373, 'school_group', 'lunch', 'Children''s Day School Groups (Krypton & Oxford)', true),
  ('2026-11-17', 'group_booking', 191, 'school_group', 'lunch', 'Children''s Day Extension School Groups (ASM & Public School)', true)
ON CONFLICT (business_date) DO UPDATE SET
  day_mode = EXCLUDED.day_mode,
  expected_guests = EXCLUDED.expected_guests,
  group_type = EXCLUDED.group_type,
  group_daypart = EXCLUDED.group_daypart,
  group_notes = EXCLUDED.group_notes;

-- 7. Dual-Track Independent Model State
CREATE TABLE IF NOT EXISTS public.sales_forecast_model_state (
  day_of_week SMALLINT PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6),
  
  -- Revenue Track State (rev_*)
  rev_baseline_net NUMERIC(12,2) NOT NULL DEFAULT 50000.00,
  rev_baseline_gross NUMERIC(12,2) NOT NULL DEFAULT 50250.00,
  rev_learned_discount_rate NUMERIC(6,4) NOT NULL DEFAULT 0.0043,
  rev_ewma_alpha NUMERIC(4,3) NOT NULL DEFAULT 0.320 CHECK (rev_ewma_alpha BETWEEN 0.20 AND 0.65),
  rev_smoothed_signed_error NUMERIC(12,2) NOT NULL DEFAULT 0,
  rev_smoothed_abs_error NUMERIC(12,2) NOT NULL DEFAULT 0,
  rev_tracking_signal NUMERIC(4,3) NOT NULL DEFAULT 0,
  rev_signed_bias_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  rev_applied_bias_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  rev_recent_wape NUMERIC(6,4) NOT NULL DEFAULT 0,
  rev_error_std NUMERIC(6,4) NOT NULL DEFAULT 0,
  rev_confidence_score NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  
  -- Quantity Track State (qty_*)
  qty_baseline_total_units NUMERIC(10,2) NOT NULL DEFAULT 500.00,
  qty_baseline_orders NUMERIC(10,2) NOT NULL DEFAULT 100.00,
  qty_baseline_covers NUMERIC(10,2) NOT NULL DEFAULT 250.00,
  qty_ewma_alpha NUMERIC(4,3) NOT NULL DEFAULT 0.320 CHECK (qty_ewma_alpha BETWEEN 0.20 AND 0.65),
  qty_smoothed_signed_error NUMERIC(10,2) NOT NULL DEFAULT 0,
  qty_smoothed_abs_error NUMERIC(10,2) NOT NULL DEFAULT 0,
  qty_tracking_signal NUMERIC(4,3) NOT NULL DEFAULT 0,
  qty_signed_bias_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  qty_applied_bias_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  qty_recent_wape NUMERIC(6,4) NOT NULL DEFAULT 0,
  qty_error_std NUMERIC(6,4) NOT NULL DEFAULT 0,
  qty_confidence_score NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  
  -- Per-Item & Category Mix State
  category_volume_mix_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  category_revenue_mix_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  dish_volume_mix_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sample_weeks_count INTEGER NOT NULL DEFAULT 0,
  last_trained_date DATE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial model state for all 7 days of week (0 to 6)
INSERT INTO public.sales_forecast_model_state (day_of_week, rev_baseline_net, rev_baseline_gross, qty_baseline_total_units, qty_baseline_orders, qty_baseline_covers)
VALUES
  (0, 80848.00, 81200.00, 780.00, 150.00, 380.00),
  (1, 52982.00, 53210.00, 490.00, 100.00, 240.00),
  (2, 47566.00, 47770.00, 460.00, 95.00,  220.00),
  (3, 48836.00, 49050.00, 470.00, 98.00,  230.00),
  (4, 45291.00, 45490.00, 440.00, 90.00,  210.00),
  (5, 58023.00, 58270.00, 560.00, 115.00, 270.00),
  (6, 78461.00, 78800.00, 750.00, 145.00, 360.00)
ON CONFLICT (day_of_week) DO NOTHING;

-- 8. Graded Forecast Snapshots with Dual-Track Metrics & Bill Decomposition
CREATE TABLE IF NOT EXISTS public.sales_forecast_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date DATE UNIQUE NOT NULL,
  day_of_week SMALLINT NOT NULL,
  frozen_at TIMESTAMPTZ DEFAULT now(),
  snapshot_source TEXT NOT NULL CHECK (snapshot_source IN ('scheduled', 'live_freeze', 'backfill_replay')),
  
  -- Revenue Track Predictions & Actuals
  predicted_net_revenue NUMERIC(12,2) NOT NULL,
  predicted_net_revenue_low NUMERIC(12,2) NOT NULL,
  predicted_net_revenue_high NUMERIC(12,2) NOT NULL,
  predicted_gross_revenue NUMERIC(12,2),
  predicted_discount_amount NUMERIC(12,2),
  implied_dish_net_revenue NUMERIC(12,2),
  revenue_reconciliation_delta NUMERIC(12,2),
  actual_net_revenue NUMERIC(12,2),
  actual_gross_revenue NUMERIC(12,2),
  actual_discount_amount NUMERIC(12,2),
  signed_rev_error NUMERIC(12,2),
  signed_rev_error_pct NUMERIC(6,2),
  abs_rev_error_pct NUMERIC(6,2),
  rev_confidence_score NUMERIC(5,2) NOT NULL,
  rev_alpha_used NUMERIC(4,3) NOT NULL,
  rev_bias_correction_used NUMERIC(6,2) NOT NULL,
  was_rev_outlier_dampened BOOLEAN DEFAULT false,
  
  -- Quantity Track Predictions & Actuals
  predicted_total_units NUMERIC(10,2) NOT NULL,
  predicted_orders INTEGER NOT NULL,
  predicted_pax INTEGER,
  actual_total_units NUMERIC(10,2),
  actual_orders INTEGER,
  actual_pax INTEGER,
  signed_unit_error NUMERIC(10,2),
  signed_unit_error_pct NUMERIC(6,2),
  pax_signed_error INTEGER,
  dish_wape NUMERIC(6,4),
  qty_confidence_score NUMERIC(5,2) NOT NULL,
  qty_alpha_used NUMERIC(4,3) NOT NULL,
  qty_bias_correction_used NUMERIC(6,2) NOT NULL,
  was_qty_outlier_dampened BOOLEAN DEFAULT false,
  
  -- Guest & Context Snapshots
  day_mode_at_prediction TEXT DEFAULT 'normal',
  event_type_id UUID REFERENCES public.sales_forecast_event_types(id),
  event_rev_multiplier_used NUMERIC(5,2) DEFAULT 1.00,
  event_qty_multiplier_used NUMERIC(5,2) DEFAULT 1.00,
  expected_guests INTEGER DEFAULT 0,
  additive_group_revenue NUMERIC(12,2) DEFAULT 0.00,
  additive_group_units NUMERIC(10,2) DEFAULT 0.00,
  driver_summary TEXT,
  
  -- Disaggregated Demand Decomposition (Actuals)
  decomp_normal_net NUMERIC(12,2) DEFAULT 0.00,
  decomp_group_net NUMERIC(12,2) DEFAULT 0.00,
  decomp_high_value_net NUMERIC(12,2) DEFAULT 0.00,
  decomp_data_anomaly_net NUMERIC(12,2) DEFAULT 0.00,
  decomp_outside_activities_net NUMERIC(12,2) DEFAULT 0.00,
  decomp_normal_units NUMERIC(10,2) DEFAULT 0.00,
  decomp_group_units NUMERIC(10,2) DEFAULT 0.00,
  decomp_high_value_units NUMERIC(10,2) DEFAULT 0.00,
  decomp_data_anomaly_units NUMERIC(10,2) DEFAULT 0.00,
  decomp_complimentary_menu_value NUMERIC(12,2) DEFAULT 0.00,
  daypart_breakdown_json JSONB DEFAULT '{}'::jsonb,
  
  predicted_categories_json JSONB,
  predicted_dishes_json JSONB,
  actual_categories_json JSONB,
  actual_dishes_json JSONB,
  learning_summary_json JSONB DEFAULT '{}'::jsonb,
  graded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_date ON public.sales_forecast_snapshots(business_date);

-- Enable Row Level Security (RLS)
ALTER TABLE public.sales_bill_classification_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_bill_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_forecast_group_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_forecast_event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_forecast_day_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_forecast_model_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_forecast_snapshots ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS p_select_thresholds ON public.sales_bill_classification_thresholds;
DROP POLICY IF EXISTS p_select_classifications ON public.sales_bill_classifications;
DROP POLICY IF EXISTS p_select_group_profiles ON public.sales_forecast_group_profiles;
DROP POLICY IF EXISTS p_select_event_types ON public.sales_forecast_event_types;
DROP POLICY IF EXISTS p_select_day_context ON public.sales_forecast_day_context;
DROP POLICY IF EXISTS p_select_model_state ON public.sales_forecast_model_state;
DROP POLICY IF EXISTS p_select_snapshots ON public.sales_forecast_snapshots;

DROP POLICY IF EXISTS p_all_thresholds ON public.sales_bill_classification_thresholds;
DROP POLICY IF EXISTS p_all_classifications ON public.sales_bill_classifications;
DROP POLICY IF EXISTS p_all_group_profiles ON public.sales_forecast_group_profiles;
DROP POLICY IF EXISTS p_all_event_types ON public.sales_forecast_event_types;
DROP POLICY IF EXISTS p_all_day_context ON public.sales_forecast_day_context;
DROP POLICY IF EXISTS p_all_model_state ON public.sales_forecast_model_state;
DROP POLICY IF EXISTS p_all_snapshots ON public.sales_forecast_snapshots;

-- RLS Policies
-- Read access for authenticated users
CREATE POLICY p_select_thresholds ON public.sales_bill_classification_thresholds FOR SELECT TO authenticated USING (true);
CREATE POLICY p_select_classifications ON public.sales_bill_classifications FOR SELECT TO authenticated USING (true);
CREATE POLICY p_select_group_profiles ON public.sales_forecast_group_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY p_select_event_types ON public.sales_forecast_event_types FOR SELECT TO authenticated USING (true);
CREATE POLICY p_select_day_context ON public.sales_forecast_day_context FOR SELECT TO authenticated USING (true);
CREATE POLICY p_select_model_state ON public.sales_forecast_model_state FOR SELECT TO authenticated USING (true);
CREATE POLICY p_select_snapshots ON public.sales_forecast_snapshots FOR SELECT TO authenticated USING (true);

-- Manage access for service_role and users with sales forecast management permissions
CREATE POLICY p_all_thresholds ON public.sales_bill_classification_thresholds FOR ALL TO authenticated
  USING (public.can_manage_sales_forecast()) WITH CHECK (public.can_manage_sales_forecast());

CREATE POLICY p_all_classifications ON public.sales_bill_classifications FOR ALL TO authenticated
  USING (public.can_manage_sales_forecast()) WITH CHECK (public.can_manage_sales_forecast());

CREATE POLICY p_all_group_profiles ON public.sales_forecast_group_profiles FOR ALL TO authenticated
  USING (public.can_manage_sales_forecast()) WITH CHECK (public.can_manage_sales_forecast());

CREATE POLICY p_all_event_types ON public.sales_forecast_event_types FOR ALL TO authenticated
  USING (public.can_manage_sales_forecast()) WITH CHECK (public.can_manage_sales_forecast());

CREATE POLICY p_all_day_context ON public.sales_forecast_day_context FOR ALL TO authenticated
  USING (public.can_manage_sales_forecast()) WITH CHECK (public.can_manage_sales_forecast());

CREATE POLICY p_all_model_state ON public.sales_forecast_model_state FOR ALL TO authenticated
  USING (public.can_manage_sales_forecast()) WITH CHECK (public.can_manage_sales_forecast());

CREATE POLICY p_all_snapshots ON public.sales_forecast_snapshots FOR ALL TO authenticated
  USING (public.can_manage_sales_forecast()) WITH CHECK (public.can_manage_sales_forecast());

-- Grants
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON TABLE public.sales_bill_classification_thresholds TO service_role;
GRANT ALL ON TABLE public.sales_bill_classifications TO service_role;
GRANT ALL ON TABLE public.sales_forecast_group_profiles TO service_role;
GRANT ALL ON TABLE public.sales_forecast_event_types TO service_role;
GRANT ALL ON TABLE public.sales_forecast_day_context TO service_role;
GRANT ALL ON TABLE public.sales_forecast_model_state TO service_role;
GRANT ALL ON TABLE public.sales_forecast_snapshots TO service_role;
