-- Migration: 20261122180000_electricity_metering_allocation_and_reconciliation.sql
-- Description: Updates electricity meter metadata, inserts 2 UPPCL reconciliation midnight anchors,
-- creates electricity_bill_reconciliations table, and establishes daily_electricity_allocations proportional view.

-- 1. Update Meter Metadata
ALTER TABLE public.meters 
    ADD COLUMN IF NOT EXISTS sanctioned_load_kva NUMERIC(10, 2) DEFAULT 45.00,
    ADD COLUMN IF NOT EXISTS tariff_category TEXT DEFAULT 'LMV2 PV Commercial';

UPDATE public.meters
SET 
    meter_name = 'Ghoomar Yatra Main Electricity Meter',
    meter_number = 'AL0057395',
    location = 'Main Transformer Yard',
    sanctioned_load_kva = 45.00,
    tariff_category = 'LMV2 PV Commercial'
WHERE id = 'bfd3c905-e5d4-4c59-bd75-5046ca5de89c';

-- 2. Insert Two Official UPPCL Midnight Anchors (Idempotent)
INSERT INTO public.meter_readings (
    id,
    meter_id,
    business_date,
    reading_timestamp,
    reading_value,
    is_reset,
    notes,
    created_at
)
VALUES 
    (
        'c1010000-0000-4000-a000-000000000001',
        'bfd3c905-e5d4-4c59-bd75-5046ca5de89c',
        '2026-10-01',
        '2026-09-30T18:30:00Z', -- 01-Oct-2026 00:00:00 IST
        174.55,
        false,
        'Official UPPCL bill reconciliation reading (Sep 2026 billing period close)',
        '2026-09-30T18:30:00Z'
    ),
    (
        'c1010000-0000-4000-a000-000000000002',
        'bfd3c905-e5d4-4c59-bd75-5046ca5de89c',
        '2026-11-01',
        '2026-10-31T18:30:00Z', -- 01-Nov-2026 00:00:00 IST
        377.51,
        false,
        'Official UPPCL bill reconciliation reading (Oct 2026 billing period close)',
        '2026-10-31T18:30:00Z'
    )
ON CONFLICT (id) DO UPDATE SET
    reading_value = EXCLUDED.reading_value,
    reading_timestamp = EXCLUDED.reading_timestamp,
    business_date = EXCLUDED.business_date,
    notes = EXCLUDED.notes;

-- 3. Create Monthly Electricity Bill Reconciliations Table
CREATE TABLE IF NOT EXISTS public.electricity_bill_reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
    bill_month TEXT NOT NULL,
    bill_number TEXT,
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    billed_kvah NUMERIC(12, 2) NOT NULL CHECK (billed_kvah > 0),
    energy_charges NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    demand_charges NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    electricity_duty NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    fppa_charges NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- Allows negative values
    other_operational_charges NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    lpsc_charges NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- Excluded from operational cost
    arrears_charges NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- Excluded from operational cost
    operational_bill_cost NUMERIC(12, 2) GENERATED ALWAYS AS (
        energy_charges + demand_charges + electricity_duty + fppa_charges + other_operational_charges
    ) STORED,
    current_bill_amount NUMERIC(12, 2) GENERATED ALWAYS AS (
        energy_charges + demand_charges + electricity_duty + fppa_charges + other_operational_charges + lpsc_charges
    ) STORED,
    final_payable_amount NUMERIC(12, 2) GENERATED ALWAYS AS (
        energy_charges + demand_charges + electricity_duty + fppa_charges + other_operational_charges + lpsc_charges + arrears_charges
    ) STORED,
    effective_rate_per_kvah NUMERIC(10, 4) GENERATED ALWAYS AS (
        CASE WHEN billed_kvah > 0 
             THEN ROUND((energy_charges + demand_charges + electricity_duty + fppa_charges + other_operational_charges) / billed_kvah, 4)
             ELSE 0.0000 
        END
    ) STORED,
    source_reference TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'RECONCILED' CHECK (status IN ('DRAFT', 'RECONCILED', 'DISPUTED')),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_elec_bill_month UNIQUE (meter_id, bill_month)
);

CREATE INDEX IF NOT EXISTS idx_elec_bill_rec_dates 
    ON public.electricity_bill_reconciliations (meter_id, billing_period_start, billing_period_end);

-- Enable RLS
ALTER TABLE public.electricity_bill_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "electricity_bill_reconciliations_select"
    ON public.electricity_bill_reconciliations
    FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "electricity_bill_reconciliations_insert"
    ON public.electricity_bill_reconciliations
    FOR INSERT TO authenticated, anon WITH CHECK (true);

CREATE POLICY "electricity_bill_reconciliations_update"
    ON public.electricity_bill_reconciliations
    FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);

CREATE POLICY "electricity_bill_reconciliations_delete"
    ON public.electricity_bill_reconciliations
    FOR DELETE TO authenticated, anon USING (true);

-- 4. Seed the 2 Authoritative UPPCL Bills Idempotently
INSERT INTO public.electricity_bill_reconciliations (
    id,
    meter_id,
    bill_month,
    bill_number,
    billing_period_start,
    billing_period_end,
    billed_kvah,
    energy_charges,
    demand_charges,
    electricity_duty,
    fppa_charges,
    other_operational_charges,
    lpsc_charges,
    arrears_charges,
    source_reference,
    notes,
    status
)
VALUES 
    (
        'b1010000-0000-4000-a000-000000000001',
        'bfd3c905-e5d4-4c59-bd75-5046ca5de89c',
        'OCT-2026',
        '915-171-650-679',
        '2026-09-09',
        '2026-09-30',
        6982.00,
        54055.66,
        14742.00,
        4889.45,
        -3605.00,
        0.00,
        0.00,
        0.00,
        'UPPCL Bill No: 915-171-650-679 (Bill Date: 04-OCT-2026)',
        'September 2026 usage reconciliation (Connection 09-Sep to 01-Oct 00:00 IST)',
        'RECONCILED'
    ),
    (
        'b1010000-0000-4000-a000-000000000002',
        'bfd3c905-e5d4-4c59-bd75-5046ca5de89c',
        'NOV-2026',
        '915-658-299-073',
        '2026-10-01',
        '2026-10-31',
        8118.40,
        62675.72,
        13668.75,
        5200.78,
        -7000.79,
        0.00,
        175.21,
        0.00,
        'UPPCL Bill No: 915-658-299-073 (Bill Date: 04-NOV-2026)',
        'October 2026 usage reconciliation (LPSC Rs 175.21 excluded from operational costing)',
        'RECONCILED'
    )
ON CONFLICT (meter_id, bill_month) DO UPDATE SET
    bill_number = EXCLUDED.bill_number,
    billing_period_start = EXCLUDED.billing_period_start,
    billing_period_end = EXCLUDED.billing_period_end,
    billed_kvah = EXCLUDED.billed_kvah,
    energy_charges = EXCLUDED.energy_charges,
    demand_charges = EXCLUDED.demand_charges,
    electricity_duty = EXCLUDED.electricity_duty,
    fppa_charges = EXCLUDED.fppa_charges,
    other_operational_charges = EXCLUDED.other_operational_charges,
    lpsc_charges = EXCLUDED.lpsc_charges,
    arrears_charges = EXCLUDED.arrears_charges,
    source_reference = EXCLUDED.source_reference,
    notes = EXCLUDED.notes,
    status = EXCLUDED.status;

-- 5. Create Proportional Daily Electricity Allocations View
CREATE OR REPLACE VIEW public.daily_electricity_allocations AS
WITH intervals AS (
    SELECT 
        id AS reading_id,
        meter_id,
        previous_reading_timestamp AS start_ts,
        reading_timestamp AS end_ts,
        delta_consumption,
        is_reset,
        EXTRACT(EPOCH FROM (reading_timestamp - previous_reading_timestamp)) AS total_seconds
    FROM public.meter_readings_ledger
    WHERE previous_reading_timestamp IS NOT NULL
      AND reading_timestamp > previous_reading_timestamp
      AND NOT is_reset
      AND delta_consumption > 0
),
interval_days AS (
    SELECT 
        i.reading_id,
        i.meter_id,
        i.start_ts,
        i.end_ts,
        i.delta_consumption,
        i.total_seconds,
        d.day::date AS business_date,
        (d.day AT TIME ZONE 'Asia/Kolkata') AS day_start_ts,
        ((d.day + interval '1 day') AT TIME ZONE 'Asia/Kolkata') AS day_end_ts
    FROM intervals i
    CROSS JOIN LATERAL generate_series(
        date_trunc('day', i.start_ts AT TIME ZONE 'Asia/Kolkata'),
        date_trunc('day', (i.end_ts - interval '1 microsecond') AT TIME ZONE 'Asia/Kolkata'),
        interval '1 day'
    ) AS d(day)
),
allocated_pieces AS (
    SELECT 
        reading_id,
        meter_id,
        business_date,
        start_ts,
        end_ts,
        day_start_ts,
        day_end_ts,
        delta_consumption,
        total_seconds,
        GREATEST(start_ts, day_start_ts) AS eff_start,
        LEAST(end_ts, day_end_ts) AS eff_end,
        EXTRACT(EPOCH FROM (LEAST(end_ts, day_end_ts) - GREATEST(start_ts, day_start_ts))) AS piece_seconds,
        (delta_consumption * (EXTRACT(EPOCH FROM (LEAST(end_ts, day_end_ts) - GREATEST(start_ts, day_start_ts))) / total_seconds)) AS allocated_kvah,
        CASE 
            WHEN start_ts < day_start_ts OR end_ts > day_end_ts THEN true 
            ELSE false 
        END AS is_spanning
    FROM interval_days
),
daily_metrics AS (
    SELECT 
        business_date,
        meter_id,
        COUNT(DISTINCT reading_id) AS intervals_count,
        SUM(piece_seconds) AS covered_seconds,
        ROUND(SUM(allocated_kvah)::numeric, 4) AS daily_kvah,
        BOOL_OR(is_spanning) AS has_spanning_interval
    FROM allocated_pieces
    GROUP BY business_date, meter_id
)
SELECT 
    d.business_date,
    d.meter_id,
    d.intervals_count,
    d.covered_seconds,
    d.daily_kvah,
    CASE 
        WHEN d.covered_seconds < 86400 AND d.business_date = (SELECT (MAX(reading_timestamp) AT TIME ZONE 'Asia/Kolkata')::date FROM public.meter_readings)
            THEN 'partial'
        WHEN d.has_spanning_interval
            THEN 'allocated'
        ELSE 'measured'
    END AS allocation_status,
    -- Join with reconciled bills
    b.id AS bill_reconciliation_id,
    b.bill_month,
    b.effective_rate_per_kvah,
    CASE 
        WHEN b.id IS NOT NULL AND b.status = 'RECONCILED'
            THEN ROUND((d.daily_kvah * b.effective_rate_per_kvah)::numeric, 2)
        ELSE ROUND((d.daily_kvah * COALESCE(cr.amount_or_rate, 10.0000))::numeric, 2)
    END AS operational_cost,
    CASE 
        WHEN b.id IS NOT NULL AND b.status = 'RECONCILED' THEN 'reconciled'
        ELSE 'estimated'
    END AS cost_type
FROM daily_metrics d
LEFT JOIN public.electricity_bill_reconciliations b 
    ON d.business_date >= b.billing_period_start 
   AND d.business_date <= b.billing_period_end
   AND b.status = 'RECONCILED'
LEFT JOIN public.financial_cost_rules cr 
    ON cr.category = 'Utilities' 
   AND cr.calculation_method = 'meter_based' 
   AND cr.is_active = true;

GRANT SELECT ON public.daily_electricity_allocations TO authenticated, anon;
