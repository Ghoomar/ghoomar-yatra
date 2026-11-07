-- Migration: 20261107201000_biometric_attendance_atomic_import.sql
-- Description: Atomic stored procedure for Petpooja biometric attendance import and overwrite.
-- Ensures audit batches and attendance records are committed in the same database transaction.

CREATE OR REPLACE FUNCTION public.fn_import_biometric_attendance_atomic(
  p_batch JSONB,
  p_records JSONB,
  p_overwrite BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_batch_id UUID;
  v_business_date DATE;
  v_existing_batch_id UUID;
  v_new_batch JSONB;
BEGIN
  v_business_date := (p_batch->>'business_date')::DATE;

  -- 1. Check for existing batch for this date
  SELECT id INTO v_existing_batch_id
  FROM public.attendance_import_batches
  WHERE business_date = v_business_date
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_batch_id IS NOT NULL AND NOT p_overwrite THEN
    RAISE EXCEPTION 'DUPLICATE_IMPORT';
  END IF;

  -- 2. If overwriting, clear previous biometric attendance for this business date
  -- Audit batches in attendance_import_batches are NEVER deleted to preserve complete historical trail
  IF p_overwrite THEN
    DELETE FROM public.attendance
    WHERE business_date = v_business_date
      AND source = 'petpooja_biometric';
  END IF;

  -- 3. Insert new batch row
  INSERT INTO public.attendance_import_batches (
    business_date,
    file_name,
    file_checksum,
    record_count,
    mapped_count,
    unmapped_count,
    fd_count,
    hd_count,
    absent_count,
    report_structure,
    source,
    imported_by,
    raw_metadata,
    created_at
  ) VALUES (
    v_business_date,
    p_batch->>'file_name',
    p_batch->>'file_checksum',
    (p_batch->>'record_count')::INTEGER,
    (p_batch->>'mapped_count')::INTEGER,
    COALESCE((p_batch->>'unmapped_count')::INTEGER, 0),
    (p_batch->>'fd_count')::INTEGER,
    (p_batch->>'hd_count')::INTEGER,
    (p_batch->>'absent_count')::INTEGER,
    COALESCE(p_batch->>'report_structure', 'ATTENDANCE_MASTER'),
    COALESCE(p_batch->>'source', 'petpooja_biometric'),
    NULLIF(p_batch->>'imported_by', '')::UUID,
    p_batch->'raw_metadata',
    clock_timestamp()
  ) RETURNING id INTO v_batch_id;

  -- 4. Bulk insert attendance records linking to batch
  INSERT INTO public.attendance (
    employee_id,
    business_date,
    status,
    shift_multiplier,
    source,
    petpooja_emp_id,
    punch_in,
    punch_out,
    working_hours,
    break_hours,
    notes,
    marked_by,
    raw_metadata,
    import_batch_id
  )
  SELECT
    (elem->>'employee_id')::UUID,
    (elem->>'business_date')::DATE,
    elem->>'status',
    (elem->>'shift_multiplier')::NUMERIC,
    elem->>'source',
    (elem->>'petpooja_emp_id')::INTEGER,
    elem->>'punch_in',
    elem->>'punch_out',
    elem->>'working_hours',
    elem->>'break_hours',
    elem->>'notes',
    NULLIF(elem->>'marked_by', '')::UUID,
    elem->'raw_metadata',
    v_batch_id
  FROM jsonb_array_elements(p_records) AS elem
  ON CONFLICT (employee_id, business_date)
  DO UPDATE SET
    status = EXCLUDED.status,
    shift_multiplier = EXCLUDED.shift_multiplier,
    source = EXCLUDED.source,
    petpooja_emp_id = EXCLUDED.petpooja_emp_id,
    punch_in = EXCLUDED.punch_in,
    punch_out = EXCLUDED.punch_out,
    working_hours = EXCLUDED.working_hours,
    break_hours = EXCLUDED.break_hours,
    notes = EXCLUDED.notes,
    marked_by = EXCLUDED.marked_by,
    raw_metadata = EXCLUDED.raw_metadata,
    import_batch_id = EXCLUDED.import_batch_id,
    updated_at = now();

  -- Return new batch row
  SELECT to_jsonb(b) INTO v_new_batch
  FROM public.attendance_import_batches b
  WHERE b.id = v_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'batch', v_new_batch
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_import_biometric_attendance_atomic(JSONB, JSONB, BOOLEAN) TO authenticated, service_role;
