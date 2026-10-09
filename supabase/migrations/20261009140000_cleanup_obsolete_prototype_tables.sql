-- Migration: 20261009140000_cleanup_obsolete_prototype_tables.sql
-- Description: Drop obsolete development prototype tables and streamline Petpooja import architecture
-- Context: Focus items prototype dropped, stage performances dropped, legacy prototype physical_assets/uniform_items cleaned

-- 1. Drop genuinely obsolete prototype tables with zero consumers
DROP TABLE IF EXISTS public.focus_items CASCADE;
DROP TABLE IF EXISTS public.stage_performances CASCADE;
DROP TABLE IF EXISTS public.employee_salary_payouts CASCADE;

-- 2. Clean legacy prototype asset/uniform tables superseded by unified inventory_items
DROP TABLE IF EXISTS public.asset_movements CASCADE;
DROP TABLE IF EXISTS public.physical_assets CASCADE;
DROP TABLE IF EXISTS public.uniform_template_items CASCADE;
DROP TABLE IF EXISTS public.uniform_templates CASCADE;
DROP TABLE IF EXISTS public.uniform_items CASCADE;

-- 3. Note on Petpooja architecture:
-- HOURLY_ITEM_SALES is permanently discontinued from daily manual uploads.
-- Hourly sales analytics are now derived on-the-fly directly from ITEM_ORDER_DETAILS
-- during import, preserving full analytical granularity in sales_hourly_items.
