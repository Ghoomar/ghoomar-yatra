-- ==============================================================================
-- Migration: 20261003180000_phase_1_auth_rbac_rls_hardening.sql
-- Description: Phase 1 (P0) Authentication & RBAC Foundation Security Hardening
--
-- Target Objects:
-- 1. Helper function public.is_admin() (SECURITY DEFINER with fixed search_path)
-- 2. Stored procedure public.execute_inventory_transaction (Revoke anon, set search_path)
-- 3. Row-Level Security on Core Auth & Sensitive Operational Tables:
--    - public.roles
--    - public.permissions
--    - public.role_permissions (recursion-free)
--    - public.profiles (self-update strictly scoped to locale; identity & security fields protected)
--    - public.audit_logs (append-only ledger with actor-ID anti-spoofing check)
--    - public.attendance (authenticated staff ops, admin-only delete)
--    - public.gate_device_authorizations (authenticated device upsert, admin-only delete)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Helper Function: public.is_admin()
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
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
    WHERE p.id = auth.uid() AND r.name = 'Admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, public;

-- ------------------------------------------------------------------------------
-- 2. Harden Stored Procedure: public.execute_inventory_transaction
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.execute_inventory_transaction(
  uuid, date, text, numeric, numeric, uuid, uuid, uuid, uuid, text, uuid, text, text, text, date, uuid
) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.execute_inventory_transaction(
  uuid, date, text, numeric, numeric, uuid, uuid, uuid, uuid, text, uuid, text, text, text, date, uuid
) TO authenticated, service_role;

ALTER FUNCTION public.execute_inventory_transaction(
  uuid, date, text, numeric, numeric, uuid, uuid, uuid, uuid, text, uuid, text, text, text, date, uuid
) SET search_path = public, pg_temp;

-- ------------------------------------------------------------------------------
-- 3. Revoke direct anon privileges from Phase 1 tables (Defense in Depth)
-- ------------------------------------------------------------------------------
REVOKE ALL ON TABLE public.roles FROM anon;
REVOKE ALL ON TABLE public.permissions FROM anon;
REVOKE ALL ON TABLE public.role_permissions FROM anon;
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.audit_logs FROM anon;
REVOKE ALL ON TABLE public.attendance FROM anon;
REVOKE ALL ON TABLE public.gate_device_authorizations FROM anon;

-- ------------------------------------------------------------------------------
-- 4. Enable RLS on Phase 1 Tables
-- ------------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gate_device_authorizations ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 5. Policies: public.roles
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "roles_select_authenticated" ON public.roles;
CREATE POLICY "roles_select_authenticated"
ON public.roles
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "roles_admin_all" ON public.roles;
CREATE POLICY "roles_admin_all"
ON public.roles
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- 6. Policies: public.permissions
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "permissions_select_authenticated" ON public.permissions;
CREATE POLICY "permissions_select_authenticated"
ON public.permissions
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "permissions_admin_all" ON public.permissions;
CREATE POLICY "permissions_admin_all"
ON public.permissions
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- 7. Policies: public.role_permissions (Recursion-Free)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "role_permissions_select_authenticated" ON public.role_permissions;
CREATE POLICY "role_permissions_select_authenticated"
ON public.role_permissions
FOR SELECT
TO authenticated
USING (true);

-- Direct client INSERT / UPDATE / DELETE are intentionally denied.
-- Permission changes occur solely via server API (/api/admin/roles/permissions) using service_role.

-- ------------------------------------------------------------------------------
-- 8. Policies & Sensitive Field Protection: public.profiles
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "profiles_update_authenticated" ON public.profiles;
CREATE POLICY "profiles_update_authenticated"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid() OR public.is_admin())
WITH CHECK (id = auth.uid() OR public.is_admin());

-- Engine-level trigger: Ordinary authenticated users may only self-edit locale;
-- identity (full_name, email, phone) and authorization (role_id, is_active) fields are locked down.
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only enforce when executed in the context of an authenticated user (service_role auth.uid() is NULL)
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_admin() THEN
      IF OLD.id <> auth.uid() THEN
        RAISE EXCEPTION 'Access denied: cannot modify other user profiles';
      END IF;
      IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Access denied: cannot modify id';
      END IF;
      IF NEW.email IS DISTINCT FROM OLD.email THEN
        RAISE EXCEPTION 'Access denied: ordinary users cannot modify email';
      END IF;
      IF NEW.phone IS DISTINCT FROM OLD.phone THEN
        RAISE EXCEPTION 'Access denied: ordinary users cannot modify phone';
      END IF;
      IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
        RAISE EXCEPTION 'Access denied: ordinary users cannot modify full_name directly';
      END IF;
      IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
        RAISE EXCEPTION 'Access denied: ordinary users cannot modify role_id';
      END IF;
      IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION 'Access denied: ordinary users cannot modify is_active';
      END IF;
      IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Access denied: cannot modify created_at';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_sensitive_fields();

-- ------------------------------------------------------------------------------
-- 9. Policies: public.audit_logs (Immutable & Actor-ID Anti-Spoofing)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "audit_logs_insert_authenticated" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_authenticated"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
  -- Prevent actor-ID spoofing: logged user must match auth.uid(), or be left null for system actions
  (user_id IS NULL OR user_id = auth.uid())
);

-- UPDATE and DELETE have NO policies for any role — audit log is strictly immutable.

-- ------------------------------------------------------------------------------
-- 10. Policies: public.attendance
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "attendance_select_authenticated" ON public.attendance;
CREATE POLICY "attendance_select_authenticated"
ON public.attendance
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "attendance_insert_authenticated" ON public.attendance;
CREATE POLICY "attendance_insert_authenticated"
ON public.attendance
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "attendance_update_authenticated" ON public.attendance;
CREATE POLICY "attendance_update_authenticated"
ON public.attendance
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "attendance_delete_admin" ON public.attendance;
CREATE POLICY "attendance_delete_admin"
ON public.attendance
FOR DELETE
TO authenticated
USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- 11. Policies: public.gate_device_authorizations (Explicit Operation Scopes)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "gate_devices_select_authenticated" ON public.gate_device_authorizations;
CREATE POLICY "gate_devices_select_authenticated"
ON public.gate_device_authorizations
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "gate_devices_upsert_authenticated" ON public.gate_device_authorizations;
DROP POLICY IF EXISTS "gate_devices_insert_authenticated" ON public.gate_device_authorizations;
CREATE POLICY "gate_devices_insert_authenticated"
ON public.gate_device_authorizations
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "gate_devices_update_authenticated" ON public.gate_device_authorizations;
CREATE POLICY "gate_devices_update_authenticated"
ON public.gate_device_authorizations
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR public.is_admin())
WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "gate_devices_delete_admin" ON public.gate_device_authorizations;
CREATE POLICY "gate_devices_delete_admin"
ON public.gate_device_authorizations
FOR DELETE
TO authenticated
USING (public.is_admin());
