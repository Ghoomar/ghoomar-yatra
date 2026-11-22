-- Migration: 20261122193000_purchase_headers_lines_vendor_items_rls.sql
-- Description: Enable INSERT, UPDATE, DELETE RLS policies on purchase_headers, purchase_lines, and vendor_items
--              so authorized users (Storekeeper, Accountant, Admin, General Manager, Owner) can record purchases.

-- 1. Helper function for purchase management permissions
CREATE OR REPLACE FUNCTION public.can_manage_purchases()
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
      AND perm.code IN ('finance.purchases', 'admin.manage')
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
      AND r.name IN ('Admin', 'Owner', 'General Manager', 'Accountant', 'Storekeeper')
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_purchases() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_manage_purchases() FROM anon, public;

-- Default purchase_headers.created_by to auth.uid() if not explicitly supplied
ALTER TABLE public.purchase_headers ALTER COLUMN created_by SET DEFAULT auth.uid();

-- 2. RLS Policies on purchase_headers
DROP POLICY IF EXISTS "purchase_headers_select" ON public.purchase_headers;
CREATE POLICY "purchase_headers_select" ON public.purchase_headers
FOR SELECT TO authenticated
USING (public.can_manage_purchases() OR public.can_view_costing());

DROP POLICY IF EXISTS "purchase_headers_insert" ON public.purchase_headers;
CREATE POLICY "purchase_headers_insert" ON public.purchase_headers
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_purchases());

DROP POLICY IF EXISTS "purchase_headers_update" ON public.purchase_headers;
CREATE POLICY "purchase_headers_update" ON public.purchase_headers
FOR UPDATE TO authenticated
USING (public.can_manage_purchases())
WITH CHECK (public.can_manage_purchases());

-- 3. RLS Policies on purchase_lines
DROP POLICY IF EXISTS "purchase_lines_select" ON public.purchase_lines;
CREATE POLICY "purchase_lines_select" ON public.purchase_lines
FOR SELECT TO authenticated
USING (public.can_manage_purchases() OR public.can_view_costing());

DROP POLICY IF EXISTS "purchase_lines_insert" ON public.purchase_lines;
CREATE POLICY "purchase_lines_insert" ON public.purchase_lines
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_purchases());

DROP POLICY IF EXISTS "purchase_lines_update" ON public.purchase_lines;
CREATE POLICY "purchase_lines_update" ON public.purchase_lines
FOR UPDATE TO authenticated
USING (public.can_manage_purchases())
WITH CHECK (public.can_manage_purchases());

-- 4. RLS Policies on vendor_items
DROP POLICY IF EXISTS "vendor_items_select" ON public.vendor_items;
CREATE POLICY "vendor_items_select" ON public.vendor_items
FOR SELECT TO authenticated
USING (public.can_manage_purchases() OR public.can_view_costing() OR public.can_manage_packaging());

DROP POLICY IF EXISTS "vendor_items_insert" ON public.vendor_items;
CREATE POLICY "vendor_items_insert" ON public.vendor_items
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_purchases() OR public.can_manage_packaging());

DROP POLICY IF EXISTS "vendor_items_update" ON public.vendor_items;
CREATE POLICY "vendor_items_update" ON public.vendor_items
FOR UPDATE TO authenticated
USING (public.can_manage_purchases() OR public.can_manage_packaging())
WITH CHECK (public.can_manage_purchases() OR public.can_manage_packaging());

DROP POLICY IF EXISTS "vendor_items_delete" ON public.vendor_items;
CREATE POLICY "vendor_items_delete" ON public.vendor_items
FOR DELETE TO authenticated
USING (public.can_manage_purchases());
