-- Migration: 20261028120000_checkpoint1_schema_extensions.sql
-- Description: Additive master schema extensions for units, categories, inventory items, aliases, packaging units, and purchase snapshot columns.

-- 1. Seed the 3 missing consumption units into public.units
INSERT INTO public.units (name, symbol, name_hi, symbol_hi, is_active)
VALUES 
  ('Packet', 'pkt', 'पैकेट', 'पैकेट', true),
  ('Bottle', 'btl', 'बोतल', 'बोतल', true),
  ('Can', 'can', 'कैन', 'कैन', true)
ON CONFLICT (symbol) DO UPDATE 
SET name = EXCLUDED.name,
    name_hi = EXCLUDED.name_hi,
    symbol_hi = EXCLUDED.symbol_hi,
    is_active = true;

-- 2. Additive columns to inventory_items
ALTER TABLE public.inventory_items 
  ADD COLUMN IF NOT EXISTS abc_risk text 
    CHECK (abc_risk IN ('Routine Monitoring', 'Frequent Monitoring', 'High Control')),
  ADD COLUMN IF NOT EXISTS is_costed boolean DEFAULT false NOT NULL;

-- 3. Create inventory_item_aliases table
CREATE TABLE IF NOT EXISTS public.inventory_item_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    alias_type TEXT NOT NULL CHECK (alias_type IN ('hindi', 'transliteration', 'brand', 'colloquial', 'common')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_inv_item_alias UNIQUE (item_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_inv_aliases_lookup ON public.inventory_item_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_inv_aliases_item ON public.inventory_item_aliases(item_id);

-- 4. Create item_packaging_units table
CREATE TABLE IF NOT EXISTS public.item_packaging_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    brand_name TEXT NOT NULL,
    pack_unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
    pack_unit_name TEXT NOT NULL,
    pack_size_in_base_units NUMERIC NOT NULL CHECK (pack_size_in_base_units > 0),
    vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
    is_default BOOLEAN DEFAULT false NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_pkg_item_id ON public.item_packaging_units(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_item_pkg_vendor_id ON public.item_packaging_units(vendor_id);

-- 5. Add immutable snapshot columns to purchase_lines
ALTER TABLE public.purchase_lines
  ADD COLUMN IF NOT EXISTS packaging_unit_id UUID REFERENCES public.item_packaging_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS pack_unit_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS pack_quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS pack_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS conversion_factor_snapshot NUMERIC;

-- 6. Add status and cancellation columns to purchase_headers
ALTER TABLE public.purchase_headers
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved' CHECK (status IN ('draft', 'approved', 'cancelled')),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

-- 7. Seed 4 dot-notation permissions into public.permissions
INSERT INTO public.permissions (module, action, code, description)
VALUES
  ('sops', 'view', 'sops.menu.view', 'View SOPs menu engineering matrix and master'),
  ('sops', 'view', 'sops.recipes.view', 'View SOPs recipe book and formulations'),
  ('sops', 'manage', 'sops.recipes.manage', 'Manage and update SOPs recipes and formulations'),
  ('sops', 'view', 'sops.costing.view', 'View ingredient costs, variant WACs, and food cost margins')
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    action = EXCLUDED.action,
    description = EXCLUDED.description;

-- Grant permissions to key roles (Admin, Owner, General Manager, Accountant)
DO $$
DECLARE
  v_admin_id UUID;
  v_owner_id UUID;
  v_gm_id UUID;
  v_acct_id UUID;
  v_perm_menu_view UUID;
  v_perm_rec_view UUID;
  v_perm_rec_manage UUID;
  v_perm_cost_view UUID;
BEGIN
  SELECT id INTO v_admin_id FROM public.roles WHERE name = 'Admin';
  SELECT id INTO v_owner_id FROM public.roles WHERE name = 'Owner';
  SELECT id INTO v_gm_id FROM public.roles WHERE name = 'General Manager';
  SELECT id INTO v_acct_id FROM public.roles WHERE name = 'Accountant';

  SELECT id INTO v_perm_menu_view FROM public.permissions WHERE code = 'sops.menu.view';
  SELECT id INTO v_perm_rec_view FROM public.permissions WHERE code = 'sops.recipes.view';
  SELECT id INTO v_perm_rec_manage FROM public.permissions WHERE code = 'sops.recipes.manage';
  SELECT id INTO v_perm_cost_view FROM public.permissions WHERE code = 'sops.costing.view';

  -- Admin permissions
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    VALUES 
      (v_admin_id, v_perm_menu_view),
      (v_admin_id, v_perm_rec_view),
      (v_admin_id, v_perm_rec_manage),
      (v_admin_id, v_perm_cost_view)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Owner permissions
  IF v_owner_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    VALUES 
      (v_owner_id, v_perm_menu_view),
      (v_owner_id, v_perm_rec_view),
      (v_owner_id, v_perm_cost_view)
    ON CONFLICT DO NOTHING;
  END IF;

  -- General Manager permissions
  IF v_gm_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    VALUES 
      (v_gm_id, v_perm_menu_view),
      (v_gm_id, v_perm_rec_view),
      (v_gm_id, v_perm_rec_manage),
      (v_gm_id, v_perm_cost_view)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Accountant permissions
  IF v_acct_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    VALUES 
      (v_acct_id, v_perm_menu_view),
      (v_acct_id, v_perm_rec_view),
      (v_acct_id, v_perm_cost_view)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
