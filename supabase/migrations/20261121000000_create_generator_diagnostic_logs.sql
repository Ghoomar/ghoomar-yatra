-- Migration: 20261121000000_create_generator_diagnostic_logs.sql
-- Description: Creates generator_diagnostic_logs table to store physical LCD diagnostic panel readings
-- (Runtime hours/minutes, total engine starts, fuel level %, cumulative kWh energy generation)
-- independently from inventory fuel stock movements.
--
-- Note: LOCAL AND PROD SHARE LIVE SUPABASE DB.
-- DO NOT EXECUTE THIS SCRIPT AUTOMATICALLY. STAGED FOR OPERATOR REVIEW ONLY.

CREATE TABLE IF NOT EXISTS public.generator_diagnostic_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_date DATE NOT NULL DEFAULT CURRENT_DATE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    runtime_hours INTEGER NOT NULL CHECK (runtime_hours >= 0),
    runtime_minutes INTEGER NOT NULL CHECK (runtime_minutes >= 0 AND runtime_minutes < 60),
    total_runtime_minutes INTEGER GENERATED ALWAYS AS (runtime_hours * 60 + runtime_minutes) STORED,
    total_starts INTEGER NOT NULL CHECK (total_starts >= 0),
    fuel_level_pct INTEGER NOT NULL CHECK (fuel_level_pct >= 0 AND fuel_level_pct <= 100),
    energy_acc_kwh NUMERIC(10, 2) NOT NULL CHECK (energy_acc_kwh >= 0),
    notes TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient history ledger querying and timeline lookups
CREATE INDEX IF NOT EXISTS idx_gen_diag_logs_date
    ON public.generator_diagnostic_logs (business_date, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_gen_diag_logs_recorded_at
    ON public.generator_diagnostic_logs (recorded_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.generator_diagnostic_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies matching utility and meter readings
CREATE POLICY "generator_diagnostic_logs_select"
    ON public.generator_diagnostic_logs
    FOR SELECT
    TO authenticated, anon
    USING (true);

CREATE POLICY "generator_diagnostic_logs_insert"
    ON public.generator_diagnostic_logs
    FOR INSERT
    TO authenticated, anon
    WITH CHECK (true);

CREATE POLICY "generator_diagnostic_logs_update"
    ON public.generator_diagnostic_logs
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "generator_diagnostic_logs_delete"
    ON public.generator_diagnostic_logs
    FOR DELETE
    TO authenticated
    USING (true);

COMMENT ON TABLE public.generator_diagnostic_logs IS 'Diagnostic logs captured from physical generator LCD display (runtime, starts, fuel level, energy accumulator)';
