-- ==============================================================================
-- Migration: 20261024190000_create_user_intelligence_tables.sql
-- Description: User Intelligence & Reliability Architecture: Auth Events, Devices, Reliability
-- ==============================================================================

-- 1. Table: user_auth_events
CREATE TABLE IF NOT EXISTS public.user_auth_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  identifier TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'login_success', 'login_failure', 'logout', 'session_expired', 'account_deactivated', 'device_enrolled', 'device_revoked'
  status TEXT NOT NULL,     -- 'success', 'failure'
  failure_reason TEXT,
  ip_address TEXT,
  user_agent TEXT,
  device_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_auth_events_user_id ON public.user_auth_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_auth_events_created_at ON public.user_auth_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_auth_events_event_type ON public.user_auth_events(event_type, created_at DESC);

-- 2. Table: user_devices
CREATE TABLE IF NOT EXISTS public.user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  device_id TEXT NOT NULL,
  device_label TEXT,
  device_type TEXT, -- 'desktop', 'laptop', 'tablet', 'mobile', 'unknown'
  os_name TEXT,
  os_version TEXT,
  browser_name TEXT,
  browser_version TEXT,
  screen_resolution TEXT,
  device_pixel_ratio NUMERIC,
  timezone TEXT,
  language TEXT,
  pwa_supported BOOLEAN DEFAULT false,
  standalone_mode BOOLEAN DEFAULT false,
  notification_permission TEXT DEFAULT 'default',
  is_gate_device BOOLEAN DEFAULT false,
  gate_device_id TEXT,
  last_ip TEXT,
  last_visibility_state TEXT DEFAULT 'visible',
  first_seen_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  last_seen_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT user_devices_user_device_key UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices(user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_devices_device_id ON public.user_devices(device_id);

-- 3. Table: user_reliability_events
CREATE TABLE IF NOT EXISTS public.user_reliability_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  device_id TEXT,
  event_type TEXT NOT NULL, -- 'js_error', 'unhandled_rejection', 'api_failure', 'connection_failure', 'sync_failure', 'pwa_error', 'startup_perf'
  error_message TEXT,
  error_category TEXT,
  endpoint TEXT,
  status_code INT,
  duration_ms INT,
  connection_type TEXT,
  effective_type TEXT,
  downlink_mbps NUMERIC,
  rtt_ms INT,
  is_online BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_reliability_events_user_id ON public.user_reliability_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_reliability_events_created_at ON public.user_reliability_events(created_at DESC);

-- 4. Permissions & RLS Hardening
REVOKE ALL ON TABLE public.user_auth_events FROM anon, public;
REVOKE ALL ON TABLE public.user_devices FROM anon, public;
REVOKE ALL ON TABLE public.user_reliability_events FROM anon, public;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_auth_events TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_devices TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_reliability_events TO authenticated, service_role;

ALTER TABLE public.user_auth_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reliability_events ENABLE ROW LEVEL SECURITY;

-- user_auth_events RLS: Admins can view all, Service role can do all
DROP POLICY IF EXISTS "auth_events_admin_select" ON public.user_auth_events;
CREATE POLICY "auth_events_admin_select" ON public.user_auth_events
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "auth_events_insert" ON public.user_auth_events;
CREATE POLICY "auth_events_insert" ON public.user_auth_events
  FOR INSERT TO authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid() OR public.is_admin());

-- user_devices RLS: Admins can view all, Users can update own device
DROP POLICY IF EXISTS "user_devices_admin_select" ON public.user_devices;
CREATE POLICY "user_devices_admin_select" ON public.user_devices
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "user_devices_user_upsert" ON public.user_devices;
CREATE POLICY "user_devices_user_upsert" ON public.user_devices
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "user_devices_user_update" ON public.user_devices;
CREATE POLICY "user_devices_user_update" ON public.user_devices
  FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "user_devices_admin_delete" ON public.user_devices;
CREATE POLICY "user_devices_admin_delete" ON public.user_devices
  FOR DELETE TO authenticated USING (public.is_admin());

-- user_reliability_events RLS: Admins can view all, Users can insert own
DROP POLICY IF EXISTS "reliability_admin_select" ON public.user_reliability_events;
CREATE POLICY "reliability_admin_select" ON public.user_reliability_events
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "reliability_insert" ON public.user_reliability_events;
CREATE POLICY "reliability_insert" ON public.user_reliability_events
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.is_admin());
