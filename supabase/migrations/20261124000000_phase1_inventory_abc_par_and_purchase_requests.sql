-- Migration: 20261124000000_phase1_inventory_abc_par_and_purchase_requests.sql
-- Description: Phase 1 ABC Inventory Control, Min/Max-Par Caps, Weekly Count Enforcement, Dual-Queue Purchase Approval

-- 1. Extend inventory_items with ABC class, Max-Par, shelf life, and last counted timestamp
ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS abc_class TEXT NOT NULL DEFAULT 'routine_monitoring'
        CHECK (abc_class IN ('high_control', 'frequent_monitoring', 'routine_monitoring')),
    ADD COLUMN IF NOT EXISTS max_stock_level NUMERIC,
    ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER,
    ADD COLUMN IF NOT EXISTS last_counted_at TIMESTAMPTZ;

-- 2. Accurate last_counted_at backfill:
-- Backfill from inventory_count_items joined to approved inventory_counts using COALESCE(ic.approved_at, ic.business_date::timestamptz)
-- falling back to stock_movements count adjustments
WITH latest_counts AS (
    SELECT 
        ici.item_id,
        MAX(COALESCE(ic.approved_at, ic.business_date::timestamptz)) AS last_counted
    FROM public.inventory_count_items ici
    JOIN public.inventory_counts ic ON ici.count_id = ic.id
    WHERE ic.status = 'approved'
    GROUP BY ici.item_id
),
latest_movements AS (
    SELECT 
        sm.item_id,
        MAX(sm.business_date::timestamptz) AS last_counted
    FROM public.stock_movements sm
    WHERE sm.movement_type IN ('count_adjustment', 'physical_count_adjustment')
    GROUP BY sm.item_id
)
UPDATE public.inventory_items i
SET last_counted_at = COALESCE(lc.last_counted, lm.last_counted)
FROM public.inventory_items i2
LEFT JOIN latest_counts lc ON i2.id = lc.item_id
LEFT JOIN latest_movements lm ON i2.id = lm.item_id
WHERE i.id = i2.id AND COALESCE(lc.last_counted, lm.last_counted) IS NOT NULL;

-- 3. Recreate view public.inventory_current_position to expose abc_class, max_stock_level, shelf_life_days, last_counted_at
DROP VIEW IF EXISTS public.inventory_current_position CASCADE;

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
    i.max_stock_level,
    i.shelf_life_days,
    i.last_counted_at,
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
    END AS wac_cost,
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
    i.abc_class,
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
    i.preferred_stock, i.max_stock_level, i.shelf_life_days, i.last_counted_at,
    i.replenishment_frequency, i.storage_type, i.current_weighted_average_cost,
    i.is_active, c.name_hi, u.symbol_hi, u.name, u.name_hi, i.name_hi, i.abc_class, i.abc_risk, i.is_costed;

GRANT SELECT ON public.inventory_current_position TO authenticated, anon, service_role;

-- Recreate helper RPC get_inventory_current_position
DROP FUNCTION IF EXISTS public.get_inventory_current_position();
CREATE OR REPLACE FUNCTION public.get_inventory_current_position()
RETURNS TABLE (
    item_id UUID,
    item_code TEXT,
    name TEXT,
    group_id UUID,
    group_name TEXT,
    group_name_hi TEXT,
    brand_name TEXT,
    variant_name TEXT,
    category_id UUID,
    category_name TEXT,
    inventory_class TEXT,
    unit_id UUID,
    unit_symbol TEXT,
    minimum_stock NUMERIC,
    preferred_stock NUMERIC,
    max_stock_level NUMERIC,
    shelf_life_days INTEGER,
    last_counted_at TIMESTAMPTZ,
    replenishment_frequency TEXT,
    storage_type TEXT,
    current_quantity NUMERIC,
    wac_cost NUMERIC,
    current_stock_value NUMERIC,
    last_movement_at TIMESTAMPTZ,
    is_active BOOLEAN,
    category_name_hi TEXT,
    unit_symbol_hi TEXT,
    unit_name TEXT,
    unit_name_hi TEXT,
    name_hi TEXT,
    abc_class TEXT,
    abc_risk TEXT,
    is_costed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_cost BOOLEAN := false;
BEGIN
    SELECT public.can_view_costing() INTO v_has_cost;
    
    RETURN QUERY
    SELECT 
        v.item_id,
        v.item_code,
        v.name,
        v.group_id,
        v.group_name,
        v.group_name_hi,
        v.brand_name,
        v.variant_name,
        v.category_id,
        v.category_name,
        v.inventory_class,
        v.unit_id,
        v.unit_symbol,
        v.minimum_stock,
        v.preferred_stock,
        v.max_stock_level,
        v.shelf_life_days,
        v.last_counted_at,
        v.replenishment_frequency,
        v.storage_type,
        v.current_quantity,
        CASE WHEN v_has_cost THEN v.wac_cost ELSE NULL END AS wac_cost,
        CASE WHEN v_has_cost THEN v.current_stock_value ELSE NULL END AS current_stock_value,
        v.last_movement_at,
        v.is_active,
        v.category_name_hi,
        v.unit_symbol_hi,
        v.unit_name,
        v.unit_name_hi,
        v.name_hi,
        v.abc_class,
        v.abc_risk,
        v.is_costed
    FROM public.inventory_current_position v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_current_position() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_inventory_current_position() FROM anon;

-- 4. Create purchase_approval_settings table
CREATE TABLE IF NOT EXISTS public.purchase_approval_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    singleton BOOLEAN UNIQUE NOT NULL DEFAULT true,
    auto_approve_enabled BOOLEAN NOT NULL DEFAULT true,
    line_auto_approve_limit NUMERIC NOT NULL DEFAULT 1500,
    daily_non_staple_auto_limit NUMERIC NOT NULL DEFAULT 5000,
    high_control_count_interval_days INTEGER NOT NULL DEFAULT 7,
    frequent_monitoring_count_interval_days INTEGER NOT NULL DEFAULT 15,
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES auth.users(id),
    CONSTRAINT single_row CHECK (singleton = true)
);

INSERT INTO public.purchase_approval_settings (singleton, auto_approve_enabled, line_auto_approve_limit, daily_non_staple_auto_limit, high_control_count_interval_days, frequent_monitoring_count_interval_days)
VALUES (true, true, 1500, 5000, 7, 15)
ON CONFLICT (singleton) DO NOTHING;

-- 5. Create dual-queue purchase request tables
CREATE TABLE IF NOT EXISTS public.purchase_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number TEXT UNIQUE NOT NULL,
    target_purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
    notes TEXT,
    requested_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_request_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.inventory_items(id),
    preferred_vendor_id UUID REFERENCES public.vendors(id),
    requested_quantity NUMERIC NOT NULL CHECK (requested_quantity > 0),
    approved_quantity NUMERIC,
    pack_unit_snapshot TEXT,
    pack_quantity NUMERIC,
    conversion_factor_snapshot NUMERIC DEFAULT 1,
    estimated_unit_rate NUMERIC NOT NULL DEFAULT 0,
    estimated_total NUMERIC NOT NULL DEFAULT 0,
    stock_at_request NUMERIC DEFAULT 0,
    min_par_snapshot NUMERIC,
    max_par_snapshot NUMERIC,
    abc_class_snapshot TEXT,
    approval_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (approval_status IN ('auto_approved', 'pending_approval', 'approved', 'rejected', 'purchased')),
    was_auto_approved BOOLEAN NOT NULL DEFAULT false,
    routing_reasons TEXT[] DEFAULT '{}',
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    converted_purchase_id UUID REFERENCES public.purchase_headers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prl_request_id ON public.purchase_request_lines(request_id);
CREATE INDEX IF NOT EXISTS idx_prl_item_id ON public.purchase_request_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_prl_status ON public.purchase_request_lines(approval_status);
CREATE INDEX IF NOT EXISTS idx_prl_auto_approved ON public.purchase_request_lines(was_auto_approved, approval_status, created_at);

-- Sequence and generator for request_number
CREATE SEQUENCE IF NOT EXISTS public.purchase_request_number_seq START WITH 1001;

CREATE OR REPLACE FUNCTION public.generate_purchase_request_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_seq_num BIGINT;
    v_date TEXT;
BEGIN
    v_seq_num := nextval('public.purchase_request_number_seq');
    v_date := to_char(CURRENT_DATE, 'YYYYMMDD');
    RETURN 'PR-' || v_date || '-' || LPAD(v_seq_num::text, 4, '0');
END;
$$;

-- 6. RPC: record_inventory_count_verification
-- Allows Storekeeper to update last_counted_at securely without RLS errors
CREATE OR REPLACE FUNCTION public.record_inventory_count_verification(
    p_item_ids UUID[],
    p_counted_at TIMESTAMPTZ DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_item_ids IS NOT NULL AND array_length(p_item_ids, 1) > 0 THEN
        UPDATE public.inventory_items
        SET last_counted_at = COALESCE(p_counted_at, now()),
            updated_at = now()
        WHERE id = ANY(p_item_ids);
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_inventory_count_verification(UUID[], TIMESTAMPTZ) TO authenticated, service_role;

-- 7. RBAC Permission: finance.purchases.approve
INSERT INTO public.permissions (id, module, code, action, description)
VALUES (gen_random_uuid(), 'finance', 'finance.purchases.approve', 'approve', 'Approve Purchase Requisitions')
ON CONFLICT (code) DO UPDATE
SET description = EXCLUDED.description,
    module = EXCLUDED.module,
    action = EXCLUDED.action;

-- Dynamic Admin role lookup: link permission to Admin
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'Admin'
  AND p.code = 'finance.purchases.approve'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Approval authorization function
CREATE OR REPLACE FUNCTION public.can_approve_purchases()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp ON p.role_id = rp.role_id
    JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.id = auth.uid()
      AND perm.code IN ('finance.purchases.approve', 'admin.manage')
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
      AND r.name IN ('Admin', 'Owner', 'General Manager')
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_approve_purchases() TO authenticated, service_role;

-- RLS on purchase_approval_settings
ALTER TABLE public.purchase_approval_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_approval_settings_select" ON public.purchase_approval_settings;
CREATE POLICY "purchase_approval_settings_select" ON public.purchase_approval_settings
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "purchase_approval_settings_update" ON public.purchase_approval_settings;
CREATE POLICY "purchase_approval_settings_update" ON public.purchase_approval_settings
FOR UPDATE TO authenticated
USING (public.can_approve_purchases())
WITH CHECK (public.can_approve_purchases());

-- RLS on purchase_requests
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_requests_select" ON public.purchase_requests;
CREATE POLICY "purchase_requests_select" ON public.purchase_requests
FOR SELECT TO authenticated
USING (public.can_manage_purchases() OR public.can_approve_purchases());

DROP POLICY IF EXISTS "purchase_requests_insert" ON public.purchase_requests;
CREATE POLICY "purchase_requests_insert" ON public.purchase_requests
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_purchases() OR public.can_approve_purchases());

DROP POLICY IF EXISTS "purchase_requests_update" ON public.purchase_requests;
CREATE POLICY "purchase_requests_update" ON public.purchase_requests
FOR UPDATE TO authenticated
USING (public.can_manage_purchases() OR public.can_approve_purchases())
WITH CHECK (public.can_manage_purchases() OR public.can_approve_purchases());

DROP POLICY IF EXISTS "purchase_requests_delete" ON public.purchase_requests;
CREATE POLICY "purchase_requests_delete" ON public.purchase_requests
FOR DELETE TO authenticated
USING (public.can_approve_purchases());

-- RLS on purchase_request_lines
ALTER TABLE public.purchase_request_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_request_lines_select" ON public.purchase_request_lines;
CREATE POLICY "purchase_request_lines_select" ON public.purchase_request_lines
FOR SELECT TO authenticated
USING (public.can_manage_purchases() OR public.can_approve_purchases());

DROP POLICY IF EXISTS "purchase_request_lines_insert" ON public.purchase_request_lines;
CREATE POLICY "purchase_request_lines_insert" ON public.purchase_request_lines
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_purchases() OR public.can_approve_purchases());

DROP POLICY IF EXISTS "purchase_request_lines_update" ON public.purchase_request_lines;
CREATE POLICY "purchase_request_lines_update" ON public.purchase_request_lines
FOR UPDATE TO authenticated
USING (public.can_manage_purchases() OR public.can_approve_purchases())
WITH CHECK (public.can_manage_purchases() OR public.can_approve_purchases());

DROP POLICY IF EXISTS "purchase_request_lines_delete" ON public.purchase_request_lines;
CREATE POLICY "purchase_request_lines_delete" ON public.purchase_request_lines
FOR DELETE TO authenticated
USING (public.can_approve_purchases());

-- Grants
GRANT ALL ON public.purchase_approval_settings TO authenticated, service_role;
GRANT ALL ON public.purchase_requests TO authenticated, service_role;
GRANT ALL ON public.purchase_request_lines TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.purchase_request_number_seq TO authenticated, service_role;

-- 8. Seed Class A items (19 items)
UPDATE public.inventory_items
SET abc_class = 'high_control',
    abc_risk = 'High Control'
WHERE id IN (
    '8b8a9d87-26cc-40b7-92e1-fb164540acf0', -- Baati Aata
    '38a2889b-7ddb-45d9-87d3-02920a0bc3f3', -- Gehu Aata
    'b6f069e1-8013-4ca6-a5b4-71cd8f5b6da4', -- Butter
    'f9f1c85d-59d4-4cad-bc7e-f5ebad927caf', -- Fresh Cream
    '5d8e3b7c-5cbc-4598-ae46-b390142be9ab', -- Curd
    '5cafe000-fd1f-4999-ae90-00a64e94cc30', -- Khoya
    'a09eefc4-6e17-4ab1-b4f4-dd8fce417299', -- Paneer
    'b9aefd7d-120c-49d6-8116-1446e3244b94', -- Toned Milk
    '5d46dafa-156c-40ab-a83e-99ff3e7cfff5', -- Kaju
    'ba01126b-90f6-450d-882d-72b566368e3e', -- Kaju Tukada
    '17659632-f8df-41e5-b8ca-0dff56c38f17', -- Coal
    '195c1900-0002-4000-a000-000000000002', -- Commercial Cylinder 19.5kg
    '17629516-0789-4a52-8801-c0a1f813701e', -- Desi Ghee
    'b2e1cc44-afc5-480d-a03e-257e9f3de36e', -- Refined Oil
    '1ecc6cc1-4a33-45f5-be25-f301b1f606ad', -- Vanaspati Ghee
    'c95f1ea4-6512-4835-8570-defa59a8a784', -- Basmati Rice
    '6bf8a77e-9047-40a3-86c1-6ef47b11dae9', -- Staff Rice
    '744cb3f3-2ee9-4ae4-acd5-c547983c8260', -- Refined Sugar
    '490893a2-bfdc-4f4d-b911-7c89e26ee0b2'  -- Onion
);

-- Sync logical ingredient groups for Class A
UPDATE public.logical_ingredient_groups g
SET abc_risk = 'High Control'
FROM public.inventory_items i
WHERE i.group_id = g.id
  AND i.abc_class = 'high_control';

-- 9. Seed Class B items (verified live UUIDs)
UPDATE public.inventory_items
SET abc_class = 'frequent_monitoring',
    abc_risk = 'Frequent Monitoring'
WHERE id IN (
    '6021cedc-215e-4516-8364-ffaec26085e6', -- Water Bottle (1L) — 100%
    '9875d391-6407-4035-8c93-fa4579baae2b', -- Water Bottle (1L) — Clear
    '819e718e-e698-4229-9061-45636695efa6', -- Small Water Bottle
    '2aa53bdc-01ad-48a2-83fa-0a26c3ff2b90', -- Water Bottle (1L) — Bisleri
    '6f5b648f-dc6e-4f4f-bc93-c068b78b33aa', -- Water Bottle (1L) — Kinley
    '614d6ab1-d7e3-494d-8b09-9862bacaa9d5', -- Coca Cola
    '791a751b-b1fc-4c09-aee7-e4794d60584e', -- Diet Coke
    '7811f213-3528-4672-a3f6-83552bf421e8', -- Fanta
    '84d44d5b-d11a-44fe-88fc-d13154822555', -- Club Soda
    '1f4f5744-a176-4537-a78f-efde2350556b', -- Limca
    '57eb02c1-4fb0-40bb-9116-67c4d4c0de94', -- Maaza
    'f12e398f-1517-4ca2-a0b0-2ead864b51c0', -- Sprite (for Mocktails)
    '26dfc407-9cd2-4363-aeeb-eb2bf5b25d54', -- Sprite
    '88e75fac-ba2b-47c2-a5f5-11558333799a', -- Thums Up
    '87727301-1b48-47ea-8b05-a14ce01c30db', -- Margarine
    'aa70aa5f-82b6-4a0c-ac39-f721f4260496', -- Diced Cheese Blend — Goodrich
    '102ed6fc-b7c9-4a9d-9e51-782ff98a98c0', -- Diced Cheese Blend — Amul
    '2b1b6e43-a364-4f88-946e-2fafd11a9271', -- Cheese Block
    'f1f4cf55-4cbb-4b10-b468-2b3183aae8ea', -- Full Cream Milk
    'f8bc708a-41c3-4255-b0b1-1b9ccf6b9d18', -- Mozzarella Cheese
    '2fa2e5dd-6345-46a1-bfbd-8b6807d64853', -- White Cheese Dressing
    '097ef60e-a6f9-4af6-9bec-0754ca301828', -- Cheese Blend Sauce
    '7b68942b-c358-4967-85af-a1c6be9447ca', -- Detergent Powder — Fena
    'c495b487-3cb7-411b-8a85-f430bc08b35d', -- Detergent Powder — Bansal
    'e5a02766-d1d2-42d9-bf8a-6b4415dbf9cf', -- Detergent Powder — Surf
    '17394bc8-c2fa-4314-bca2-1e98900a9b5b', -- Detergent Powder — Nirma
    '439e4936-e589-4b82-8f6c-f3b035d4e457', -- Cling Wrap
    '08b53968-6bef-4c60-841e-9737b37c1fda', -- Aluminium Foil
    '306eafac-8e28-406c-a03b-23945688c961', -- Tissue Paper / Napkins (M-fold)
    '208bdc1e-7c1b-48f0-99c0-ddd09b54c3b8', -- Tissue Paper / Napkins (L-fold)
    '0cf5a2ba-59a9-4701-b439-7187da3e4dbd', -- Arhar Dal
    '0e2b3cea-ed21-491c-873e-febb6a2552c0', -- Chana Dal
    'c5187943-432d-442d-b0d0-92642b09739c', -- Moong Dhuli
    'c6b2996a-ea2c-49d6-ac57-4661d5d0e7cd', -- Urad Sabut / Kali Urad
    '767f04ce-813d-4983-8291-6b75224422ac', -- Magaj Beej / Watermelon Seeds
    '79cfce28-1d92-42f1-8132-30a3270f9b81', -- Pista
    '55e04d30-979d-40ca-a316-e6c3195eda7f', -- Kesar
    '3a80b147-0abe-44a1-89d7-58f58a8eff55', -- Big Aloo
    '71ea183b-c64d-4620-b511-4748998faf11', -- Small Aloo
    '798aa4ed-e4c3-435f-b550-e32d895b1db3', -- Cauliflower
    '8490f4ad-e4e7-49a0-af8d-d9db4ddbfe3e', -- Green Onion / Spring Onion
    '2a03c9d7-12b4-4e4e-9ade-c1f7bdb81962', -- Coriander / Dhaniya
    'b8f8453a-d2b9-40b7-ba38-3f84b72f257f', -- Chhila Lehsun / Peeled Garlic
    'f2981b0c-43db-42f8-8c1a-e032b8806c4d', -- Mustard Oil
    '11d45c3f-3174-45bd-bbe4-cfb4121350ea', -- Besan
    '60de99a4-8c8b-4c5d-ad62-ed94c5eadf05', -- Maida
    '8e311530-b226-4662-9346-050acc39894d', -- Hari Elaichi / Green Cardamom
    '71b9f656-9d98-4636-8414-c4b2ee39dcb5', -- Ice Cube
    '4b4114c4-cc9d-4af3-8336-57f7248dfc9d', -- Gol Gappe
    '55ea4d75-506a-4167-9042-e5001871579c', -- Coffee — ITC Sunbean
    '18f8fbde-b4f8-4783-833d-4b6b7539bbb3'  -- Coffee — Nescafe
);

-- Sync logical ingredient groups for Class B
UPDATE public.logical_ingredient_groups g
SET abc_risk = 'Frequent Monitoring'
FROM public.inventory_items i
WHERE i.group_id = g.id
  AND i.abc_class = 'frequent_monitoring';

-- 10. Seed Starter Perishable Min/Max-Par and Shelf Life
-- Garlic Bread
UPDATE public.inventory_items
SET minimum_stock = 0,
    max_stock_level = 1,
    shelf_life_days = 10
WHERE id = '16dc978c-02b6-4479-92c3-cebf6b946e82';

-- Sandwich Bread
UPDATE public.inventory_items
SET minimum_stock = 1,
    max_stock_level = 4,
    shelf_life_days = 7
WHERE id = '1cbdea44-0d24-430e-aeb9-cb1d5b082af0';

-- White Bread
UPDATE public.inventory_items
SET minimum_stock = 1,
    max_stock_level = 3,
    shelf_life_days = 7
WHERE id = '11756bcb-1125-4aad-b2a5-6e0237f0fdd8';

-- Pizza Base (both general and Bonn)
UPDATE public.inventory_items
SET minimum_stock = 6,
    max_stock_level = 16,
    shelf_life_days = 7
WHERE id IN ('4a5109a3-7428-40b8-bce4-aabaf7d1495d', 'c355d7ef-b24c-4ae9-b111-d8e79cb20e58');

-- Toned Milk (base unit ml)
UPDATE public.inventory_items
SET minimum_stock = 5000,
    max_stock_level = 25000,
    shelf_life_days = 2
WHERE id = 'b9aefd7d-120c-49d6-8116-1446e3244b94';

-- Paneer (base unit g)
UPDATE public.inventory_items
SET minimum_stock = 2000,
    max_stock_level = 5000,
    shelf_life_days = 3
WHERE id = 'a09eefc4-6e17-4ab1-b4f4-dd8fce417299';

-- Curd (base unit g)
UPDATE public.inventory_items
SET minimum_stock = 5000,
    max_stock_level = 20000,
    shelf_life_days = 3
WHERE id = '5d8e3b7c-5cbc-4598-ae46-b390142be9ab';

-- Tomato (base unit g)
UPDATE public.inventory_items
SET minimum_stock = 5000,
    max_stock_level = 12000,
    shelf_life_days = 3
WHERE id = '69a8465f-65fd-42ad-8cd6-593302b8c57a';
