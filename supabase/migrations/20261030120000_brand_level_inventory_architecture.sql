-- Migration: 20261030120000_brand_level_inventory_architecture.sql
-- Description: Checkpoint 1.2: Brand-Level Stock Tracking, Logical Ingredient Groups,
--              Coconut Powder/Milk Powder Separation, Chilli Family Normalization,
--              and Strict Database/Application Costing Parity.

-- 1. Create logical_ingredient_groups table
CREATE TABLE IF NOT EXISTS public.logical_ingredient_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL UNIQUE,
    name_hi TEXT,
    category_id UUID REFERENCES public.inventory_categories(id) ON DELETE SET NULL,
    inventory_class TEXT NOT NULL CHECK (inventory_class IN ('Food Raw Material', 'Non-Food Consumable', 'Physical Asset', 'Uniform')),
    base_unit_id UUID NOT NULL REFERENCES public.units(id),
    abc_risk TEXT CHECK (abc_risk IN ('Routine Monitoring', 'Frequent Monitoring', 'High Control')),
    search_family TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on logical_ingredient_groups
ALTER TABLE public.logical_ingredient_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "logical_ingredient_groups_select" ON public.logical_ingredient_groups;
CREATE POLICY "logical_ingredient_groups_select"
ON public.logical_ingredient_groups
FOR SELECT
TO authenticated, anon, service_role
USING (true);

DROP POLICY IF EXISTS "logical_ingredient_groups_write" ON public.logical_ingredient_groups;
CREATE POLICY "logical_ingredient_groups_write"
ON public.logical_ingredient_groups
FOR ALL
TO authenticated
USING (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid() AND perm.code IN ('inventory.stock', 'admin.manage')
  )
)
WITH CHECK (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid() AND perm.code IN ('inventory.stock', 'admin.manage')
  )
);

-- 2. Extend inventory_items with brand-level tracking attributes
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.logical_ingredient_groups(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS brand_name TEXT;

ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS variant_name TEXT;

-- 3. Extend inventory_item_aliases to support both items and groups
ALTER TABLE public.inventory_item_aliases 
ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.logical_ingredient_groups(id) ON DELETE CASCADE;

ALTER TABLE public.inventory_item_aliases 
ALTER COLUMN item_id DROP NOT NULL;

-- 4. Create performance indexes
CREATE INDEX IF NOT EXISTS idx_inventory_items_group_id ON public.inventory_items(group_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_brand_name ON public.inventory_items(brand_name);
CREATE INDEX IF NOT EXISTS idx_logical_groups_search_family ON public.logical_ingredient_groups(search_family);
CREATE INDEX IF NOT EXISTS idx_inv_aliases_group_id ON public.inventory_item_aliases(group_id);

-- 5. Harden can_view_costing() to achieve 100% parity with TypeScript canViewCosting()
-- Rule: Only Admin (via universal administrative override) OR sops.costing.view permission grants access.
CREATE OR REPLACE FUNCTION public.can_view_costing()
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
      AND r.name = 'Admin'
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid()
      AND perm.code = 'sops.costing.view'
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_view_costing() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_view_costing() FROM anon, public;

-- 6. Update view inventory_current_position to expose brand & group columns
DROP VIEW IF EXISTS public.inventory_current_position;

CREATE OR REPLACE VIEW public.inventory_current_position AS
SELECT 
    i.id AS item_id,
    i.item_code,
    i.name,
    i.group_id,
    g.name AS group_name,
    g.name_hi AS group_name_hi,
    i.brand_name,
    i.variant_name,
    i.category_id,
    c.name AS category_name,
    i.inventory_class,
    i.unit_id,
    u.symbol AS unit_symbol,
    i.minimum_stock,
    i.preferred_stock,
    i.replenishment_frequency,
    i.storage_type,
    COALESCE(sum(
        CASE
            WHEN sm.movement_type = ANY (ARRAY['opening'::text, 'purchase'::text, 'return'::text, 'adjustment_inc'::text]) THEN sm.quantity
            WHEN sm.movement_type = ANY (ARRAY['count_adjustment'::text, 'physical_count_adjustment'::text]) THEN sm.quantity
            WHEN sm.movement_type = ANY (ARRAY['issue'::text, 'sale'::text, 'consumption'::text, 'staff_food'::text, 'wastage'::text, 'spoilage'::text, 'breakage'::text, 'loss'::text, 'adjustment_dec'::text]) THEN - sm.quantity
            WHEN sm.movement_type = 'transfer'::text THEN 0::numeric
            ELSE 0::numeric
        END), 0.000) AS current_quantity,
    CASE
        WHEN can_view_costing() THEN i.current_weighted_average_cost
        ELSE NULL::numeric
    END::numeric(12,2) AS wac_cost,
    CASE
        WHEN can_view_costing() THEN round(COALESCE(sum(
            CASE
                WHEN sm.movement_type = ANY (ARRAY['opening'::text, 'purchase'::text, 'return'::text, 'adjustment_inc'::text]) THEN sm.quantity
                WHEN sm.movement_type = ANY (ARRAY['count_adjustment'::text, 'physical_count_adjustment'::text]) THEN sm.quantity
                WHEN sm.movement_type = ANY (ARRAY['issue'::text, 'sale'::text, 'consumption'::text, 'staff_food'::text, 'wastage'::text, 'spoilage'::text, 'breakage'::text, 'loss'::text, 'adjustment_dec'::text]) THEN - sm.quantity
                WHEN sm.movement_type = 'transfer'::text THEN 0::numeric
                ELSE 0::numeric
            END), 0.000) * i.current_weighted_average_cost, 2)
        ELSE NULL::numeric
    END AS current_stock_value,
    max(sm.created_at) AS last_movement_at,
    i.is_active,
    c.name_hi AS category_name_hi,
    u.symbol_hi AS unit_symbol_hi,
    u.name AS unit_name,
    u.name_hi AS unit_name_hi,
    i.name_hi,
    i.abc_risk,
    i.is_costed
FROM public.inventory_items i
LEFT JOIN public.logical_ingredient_groups g ON i.group_id = g.id
LEFT JOIN public.inventory_categories c ON i.category_id = c.id
LEFT JOIN public.units u ON i.unit_id = u.id
LEFT JOIN public.stock_movements sm ON i.id = sm.item_id
GROUP BY 
    i.id, i.item_code, i.name, i.group_id, g.name, g.name_hi, i.brand_name, i.variant_name,
    i.category_id, c.name, i.inventory_class, i.unit_id, u.symbol, i.minimum_stock,
    i.preferred_stock, i.replenishment_frequency, i.storage_type, i.current_weighted_average_cost,
    i.is_active, c.name_hi, u.symbol_hi, u.name, u.name_hi, i.name_hi, i.abc_risk, i.is_costed;

GRANT SELECT ON public.inventory_current_position TO authenticated, anon, service_role;
