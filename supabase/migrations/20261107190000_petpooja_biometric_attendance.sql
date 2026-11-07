-- ====================================================================
-- PETPOOJA BIOMETRIC ATTENDANCE INTEGRATION & EMPLOYEE IDENTITY SCHEMA
-- ====================================================================

-- 1. Extend employees with Petpooja Employee ID and updated status constraints
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS petpooja_emp_id INTEGER UNIQUE;

CREATE INDEX IF NOT EXISTS idx_employees_petpooja_emp_id ON public.employees(petpooja_emp_id);

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employment_status_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_employment_status_check 
  CHECK (employment_status = ANY (ARRAY['Active'::text, 'Inactive'::text, 'Left'::text, 'On Leave'::text, 'Resigned'::text, 'Terminated'::text]));

-- 2. Create attendance_import_batches for audit log, checksum, and idempotency
CREATE TABLE IF NOT EXISTS public.attendance_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_date DATE NOT NULL,
    file_name TEXT NOT NULL,
    file_checksum TEXT NOT NULL,
    record_count INTEGER NOT NULL DEFAULT 0,
    mapped_count INTEGER NOT NULL DEFAULT 0,
    unmapped_count INTEGER NOT NULL DEFAULT 0,
    fd_count INTEGER NOT NULL DEFAULT 0,
    hd_count INTEGER NOT NULL DEFAULT 0,
    absent_count INTEGER NOT NULL DEFAULT 0,
    report_structure TEXT DEFAULT 'ATTENDANCE_MASTER',
    source TEXT NOT NULL DEFAULT 'petpooja_biometric',
    imported_by UUID REFERENCES auth.users(id),
    raw_metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_import_batches_date ON public.attendance_import_batches(business_date);
CREATE INDEX IF NOT EXISTS idx_attendance_import_batches_checksum ON public.attendance_import_batches(file_checksum);

-- RLS on attendance_import_batches
ALTER TABLE public.attendance_import_batches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'attendance_import_batches' AND policyname = 'attendance_batches_select_authenticated'
  ) THEN
    CREATE POLICY attendance_batches_select_authenticated ON public.attendance_import_batches
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'attendance_import_batches' AND policyname = 'attendance_batches_insert_authenticated'
  ) THEN
    CREATE POLICY attendance_batches_insert_authenticated ON public.attendance_import_batches
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'attendance_import_batches' AND policyname = 'attendance_batches_update_authenticated'
  ) THEN
    CREATE POLICY attendance_batches_update_authenticated ON public.attendance_import_batches
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'attendance_import_batches' AND policyname = 'attendance_batches_delete_admin'
  ) THEN
    CREATE POLICY attendance_batches_delete_admin ON public.attendance_import_batches
      FOR DELETE TO authenticated USING (is_admin());
  END IF;
END $$;

-- 3. Extend public.attendance with biometric operational columns
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS petpooja_emp_id INTEGER,
  ADD COLUMN IF NOT EXISTS punch_in TEXT,
  ADD COLUMN IF NOT EXISTS punch_out TEXT,
  ADD COLUMN IF NOT EXISTS working_hours TEXT,
  ADD COLUMN IF NOT EXISTS break_hours TEXT,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES public.attendance_import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_attendance_business_date_source ON public.attendance(business_date, source);
CREATE INDEX IF NOT EXISTS idx_attendance_petpooja_emp_id ON public.attendance(petpooja_emp_id);

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_status_check 
  CHECK (status = ANY (ARRAY['FD'::text, 'HD'::text, 'Absent'::text, 'Present'::text, 'Half Day'::text, 'Weekly Off'::text, 'Leave'::text]));

-- 4. Master Data: Departments, Teams, Roles for complete bilingual alignment
INSERT INTO public.departments (name, name_hi, is_active)
VALUES 
  ('Housekeeping', 'हाउसकीपिंग', true),
  ('Security', 'सुरक्षा', true)
ON CONFLICT (name) DO UPDATE SET 
  name_hi = EXCLUDED.name_hi,
  is_active = true;

-- Ensure teams exist for newly defined and existing departments
DO $$
DECLARE
  v_dept_hk UUID;
  v_dept_sec UUID;
  v_dept_act UUID;
  v_dept_admin UUID;
  v_dept_serv UUID;
  v_dept_kit UUID;
  v_dept_store UUID;
  v_team_hk UUID;
  v_team_sec UUID;
  v_team_act UUID;
  v_team_admin UUID;
  v_team_serv UUID;
  v_team_kit UUID;
  v_team_store UUID;
BEGIN
  SELECT id INTO v_dept_hk FROM public.departments WHERE name = 'Housekeeping';
  SELECT id INTO v_dept_sec FROM public.departments WHERE name = 'Security';
  SELECT id INTO v_dept_act FROM public.departments WHERE name = 'Performances & Activities';
  SELECT id INTO v_dept_admin FROM public.departments WHERE name = 'Accounts & Admin';
  SELECT id INTO v_dept_serv FROM public.departments WHERE name = 'Service & Beverage';
  SELECT id INTO v_dept_kit FROM public.departments WHERE name = 'Kitchen & Production';
  SELECT id INTO v_dept_store FROM public.departments WHERE name = 'Stores & Inventory';

  -- Housekeeping Team
  INSERT INTO public.teams (department_id, name, name_hi, is_active)
  VALUES (v_dept_hk, 'Housekeeping & Hygiene', 'हाउसकीपिंग एवं स्वच्छता', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_team_hk FROM public.teams WHERE department_id = v_dept_hk LIMIT 1;

  -- Security Team
  INSERT INTO public.teams (department_id, name, name_hi, is_active)
  VALUES (v_dept_sec, 'Security Personnel', 'सुरक्षा कर्मी', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_team_sec FROM public.teams WHERE department_id = v_dept_sec LIMIT 1;

  -- Cultural Troupe Team
  INSERT INTO public.teams (department_id, name, name_hi, is_active)
  VALUES (v_dept_act, 'Cultural Troupe', 'सांस्कृतिक दल', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_team_act FROM public.teams WHERE department_id = v_dept_act AND name = 'Cultural Troupe' LIMIT 1;

  SELECT id INTO v_team_admin FROM public.teams WHERE department_id = v_dept_admin LIMIT 1;
  SELECT id INTO v_team_serv FROM public.teams WHERE department_id = v_dept_serv LIMIT 1;
  SELECT id INTO v_team_kit FROM public.teams WHERE department_id = v_dept_kit LIMIT 1;
  SELECT id INTO v_team_store FROM public.teams WHERE department_id = v_dept_store LIMIT 1;

  -- Insert/Ensure Roles with bilingual names
  -- Management & Admin roles
  INSERT INTO public.employee_roles (team_id, name, name_hi, is_active, can_receive_store_issues)
  VALUES
    (v_team_admin, 'Owner', 'मालिक', true, true),
    (v_team_admin, 'General Manager', 'महाप्रबंधक', true, true),
    (v_team_admin, 'Restaurant Manager', 'रेस्टोरेंट मैनेजर', true, true),
    (v_team_admin, 'Electrician', 'इलेक्ट्रीशियन', true, false)
  ON CONFLICT DO NOTHING;

  -- Service & Beverage roles
  INSERT INTO public.employee_roles (team_id, name, name_hi, is_active, can_receive_store_issues)
  VALUES
    (v_team_serv, 'Service Captain', 'सर्विस कैप्टन', true, true),
    (v_team_serv, 'Waiter', 'वेटर', true, false),
    (v_team_serv, 'Bain Marie', 'बैन मैरी', true, false),
    (v_team_serv, 'Helper', 'हेल्पर', true, false)
  ON CONFLICT DO NOTHING;

  -- Kitchen roles
  INSERT INTO public.employee_roles (team_id, name, name_hi, is_active, can_receive_store_issues)
  VALUES
    (v_team_kit, 'Continental Chef', 'कॉन्टिनेंटल शेफ', true, true),
    (v_team_kit, 'Head Chef - Indian', 'हेड शेफ (भारतीय)', true, true),
    (v_team_kit, 'Tandoor Chef', 'तंदूर शेफ', true, true),
    (v_team_kit, 'Head Chef – Chinese', 'हेड शेफ (चाइनीज़)', true, true),
    (v_team_kit, 'Head Maharaj', 'हेड महाराज', true, true),
    (v_team_kit, 'Maharaj', 'महाराज', true, true),
    (v_team_kit, 'Paan & Barf Gola', 'पान एवं बर्फ गोला', true, false)
  ON CONFLICT DO NOTHING;

  -- Housekeeping roles
  INSERT INTO public.employee_roles (team_id, name, name_hi, is_active, can_receive_store_issues)
  VALUES
    (v_team_hk, 'Utensil Cleaning Staff', 'बर्तन सफाई कर्मी', true, false),
    (v_team_hk, 'Wiping Staff', 'वाइपिंग कर्मी', true, false),
    (v_team_hk, 'Housekeeping Attendant', 'हाउसकीपिंग कर्मी', true, false),
    (v_team_hk, 'Kitchen Cleaning Staff', 'रसोई सफाई कर्मी', true, false)
  ON CONFLICT DO NOTHING;

  -- Cultural & Entertainment roles
  INSERT INTO public.employee_roles (team_id, name, name_hi, is_active, can_receive_store_issues)
  VALUES
    (v_team_act, 'Head Massage Therapist', 'हेड मसाज थेरेपिस्ट', true, false),
    (v_team_act, 'Bhopa / Folk Performer', 'भोपा / लोक कलाकार', true, false),
    (v_team_act, 'Been Party', 'बीन पार्टी', true, false),
    (v_team_act, 'Magician', 'जादूगर', true, false),
    (v_team_act, 'Dhol Player', 'ढोल वादक', true, false),
    (v_team_act, 'Mehendi Artist', 'मेहंदी कलाकार', true, false),
    (v_team_act, 'Puppet Show Artist', 'कठपुतली कलाकार', true, false),
    (v_team_act, 'Pandit / Jyotish', 'पंडित / ज्योतिषी', true, false)
  ON CONFLICT DO NOTHING;

  -- Store roles
  INSERT INTO public.employee_roles (team_id, name, name_hi, is_active, can_receive_store_issues)
  VALUES
    (v_team_store, 'Purchase Officer', 'खरीद अधिकारी', true, true)
  ON CONFLICT DO NOTHING;

  -- Security roles
  INSERT INTO public.employee_roles (team_id, name, name_hi, is_active, can_receive_store_issues)
  VALUES
    (v_team_sec, 'Security Guard', 'सुरक्षा गार्ड', true, false)
  ON CONFLICT DO NOTHING;
END $$;
