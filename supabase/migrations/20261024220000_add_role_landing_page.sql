-- ==============================================================================
-- Migration: 20261024220000_add_role_landing_page.sql
-- Description: Add configurable default landing page route for RBAC roles
-- ==============================================================================

-- 1. Add landing_page column to public.roles
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS landing_page TEXT;

-- 2. Populate initial default landing-page mapping
UPDATE public.roles SET landing_page = '/dashboard' WHERE name = 'Admin';
UPDATE public.roles SET landing_page = '/finance/profitability' WHERE name = 'Accountant';
UPDATE public.roles SET landing_page = '/finance/purchases' WHERE name = 'Cashier';
UPDATE public.roles SET landing_page = '/operations/gate' WHERE name = 'Gate Staff';
UPDATE public.roles SET landing_page = '/operations/daily' WHERE name = 'General Manager';
UPDATE public.roles SET landing_page = '/dashboard' WHERE name = 'Owner';
UPDATE public.roles SET landing_page = '/inventory/issues' WHERE name IN ('Storekeeper', 'Store Keeper');
UPDATE public.roles SET landing_page = '/dashboard' WHERE name = 'Viewer';
UPDATE public.roles SET landing_page = '/dashboard' WHERE name = 'Department Head';
