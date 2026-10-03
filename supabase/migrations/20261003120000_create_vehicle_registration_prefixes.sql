-- Migration: 20261003120000_create_vehicle_registration_prefixes.sql
-- Description: Create vehicle_registration_prefixes master table for mapping registration
--              prefixes (e.g. UP23, DL08) to canonical locations, and update
--              vehicle_origin_locations for the new 4 quick-tap buttons (UP21, UP22, UP23, UP16).

-- ============================================================================
-- 1. VEHICLE REGISTRATION PREFIXES MASTER TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vehicle_registration_prefixes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prefix TEXT NOT NULL UNIQUE,
    location_name TEXT NOT NULL,
    name_hi TEXT,
    state TEXT NOT NULL,
    district TEXT,
    latitude NUMERIC(9,6),
    longitude NUMERIC(9,6),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for high-speed prefix lookup in analytics & reporting
CREATE INDEX IF NOT EXISTS idx_vehicle_reg_prefix_lookup 
ON public.vehicle_registration_prefixes(prefix) 
WHERE is_active = true;

-- Enable Row Level Security
ALTER TABLE public.vehicle_registration_prefixes ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Public read, Authenticated write
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'vehicle_registration_prefixes' AND policyname = 'Allow public read access to prefixes'
  ) THEN
    CREATE POLICY "Allow public read access to prefixes"
    ON public.vehicle_registration_prefixes
    FOR SELECT
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'vehicle_registration_prefixes' AND policyname = 'Allow authenticated users to mutate prefixes'
  ) THEN
    CREATE POLICY "Allow authenticated users to mutate prefixes"
    ON public.vehicle_registration_prefixes
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- 2. SEED REGISTRATION PREFIXES
-- ============================================================================
INSERT INTO public.vehicle_registration_prefixes 
(prefix, location_name, name_hi, state, district, latitude, longitude)
VALUES
  -- Delhi Series (DL01 - DL13)
  ('DL01', 'North Delhi', 'उत्तरी दिल्ली', 'Delhi', 'North Delhi', 28.6811, 77.2228),
  ('DL02', 'New Delhi', 'नई दिल्ली', 'Delhi', 'New Delhi', 28.6139, 77.2090),
  ('DL03', 'South Delhi', 'दक्षिणी दिल्ली', 'Delhi', 'South Delhi', 28.5355, 77.2100),
  ('DL04', 'West Delhi', 'पश्चिमी दिल्ली', 'Delhi', 'West Delhi', 28.6369, 77.0878),
  ('DL05', 'North-East Delhi', 'उत्तर-पूर्वी दिल्ली', 'Delhi', 'North East Delhi', 28.7095, 77.2740),
  ('DL06', 'Central Delhi', 'मध्य दिल्ली', 'Delhi', 'Central Delhi', 28.6448, 77.2307),
  ('DL07', 'Mayur Vihar', 'मयूर विहार', 'Delhi', 'East Delhi', 28.6083, 77.2964),
  ('DL08', 'North-West Delhi', 'उत्तर-पश्चिमी दिल्ली', 'Delhi', 'North West Delhi', 28.6989, 77.1685),
  ('DL09', 'Dwarka', 'द्वारका', 'Delhi', 'South West Delhi', 28.5921, 77.0460),
  ('DL10', 'Rajouri Garden', 'राजौरी गार्डन', 'Delhi', 'West Delhi', 28.6475, 77.1215),
  ('DL11', 'Rohini', 'रोहिणी', 'Delhi', 'North West Delhi', 28.7495, 77.0565),
  ('DL12', 'Vasant Vihar', 'वसंत विहार', 'Delhi', 'South West Delhi', 28.5606, 77.1610),
  ('DL13', 'Surajmal Vihar', 'सूरजमल विहार', 'Delhi', 'East Delhi', 28.6576, 77.3039),
  ('DL', 'Delhi', 'दिल्ली', 'Delhi', 'Delhi', 28.6139, 77.2090),

  -- Western Uttar Pradesh Corridor (NH-9 & Regional Hubs)
  ('UP23', 'Amroha', 'अमरोहा', 'Uttar Pradesh', 'Amroha', 28.9044, 78.4678),
  ('UP21', 'Moradabad', 'मुरादाबाद', 'Uttar Pradesh', 'Moradabad', 28.8386, 78.7733),
  ('UP22', 'Rampur', 'रामपुर', 'Uttar Pradesh', 'Rampur', 28.8033, 79.0264),
  ('UP16', 'Noida', 'नोएडा', 'Uttar Pradesh', 'Gautam Buddha Nagar', 28.5355, 77.3910),
  ('UP14', 'Ghaziabad', 'गाजियाबाद', 'Uttar Pradesh', 'Ghaziabad', 28.6692, 77.4538),
  ('UP15', 'Meerut', 'मेरठ', 'Uttar Pradesh', 'Meerut', 28.9845, 77.7064),
  ('UP20', 'Bijnor', 'बिजनौर', 'Uttar Pradesh', 'Bijnor', 29.3732, 78.1352),
  ('UP25', 'Bareilly', 'बरेली', 'Uttar Pradesh', 'Bareilly', 28.3670, 79.4304),
  ('UP38', 'Sambhal', 'संभल', 'Uttar Pradesh', 'Sambhal', 28.5847, 78.5714),
  ('UP37', 'Hapur', 'हापुड़', 'Uttar Pradesh', 'Hapur', 28.7306, 77.7759),
  ('UP17', 'Baghpat', 'बागपत', 'Uttar Pradesh', 'Baghpat', 28.9454, 77.2201),
  ('UP11', 'Saharanpur', 'सहारनपुर', 'Uttar Pradesh', 'Saharanpur', 29.9671, 77.5460),
  ('UP12', 'Muzaffarnagar', 'मुज़फ्फरनगर', 'Uttar Pradesh', 'Muzaffarnagar', 29.4727, 77.7085),
  ('UP13', 'Bulandshahr', 'बुलंदशहर', 'Uttar Pradesh', 'Bulandshahr', 28.4069, 77.8498),
  ('UP80', 'Agra', 'आगरा', 'Uttar Pradesh', 'Agra', 27.1767, 78.0081),
  ('UP81', 'Aligarh', 'अलीगढ़', 'Uttar Pradesh', 'Aligarh', 27.8974, 78.0880),
  ('UP85', 'Mathura', 'मथुरा', 'Uttar Pradesh', 'Mathura', 27.4924, 77.6737),
  ('UP78', 'Kanpur', 'कानपुर', 'Uttar Pradesh', 'Kanpur Nagar', 26.4499, 80.3319),
  ('UP32', 'Lucknow', 'लखनऊ', 'Uttar Pradesh', 'Lucknow', 26.8467, 80.9462),
  ('UP41', 'Barabanki', 'बाराबंकी', 'Uttar Pradesh', 'Barabanki', 26.9274, 81.1834),
  ('UP53', 'Gorakhpur', 'गोरखपुर', 'Uttar Pradesh', 'Gorakhpur', 26.7606, 83.3732),

  -- Uttarakhand Corridor
  ('UK06', 'Rudrapur', 'रुद्रपुर', 'Uttarakhand', 'Udham Singh Nagar', 28.9798, 79.4002),
  ('UK08', 'Haridwar', 'हरिद्वार', 'Uttarakhand', 'Haridwar', 29.9457, 78.1642),
  ('UK01', 'Almora', 'अल्मोड़ा', 'Uttarakhand', 'Almora', 29.5971, 79.6591),
  ('UK04', 'Nainital', 'नैनीताल', 'Uttarakhand', 'Nainital', 29.3919, 79.4542),
  ('UK07', 'Dehradun', 'देहरादून', 'Uttarakhand', 'Dehradun', 30.3165, 78.0322),
  ('UK', 'Uttarakhand', 'उत्तराखंड', 'Uttarakhand', 'Uttarakhand', 30.0668, 79.0193),

  -- Haryana Corridor
  ('HR26', 'Gurugram', 'गुरुग्राम', 'Haryana', 'Gurugram', 28.4595, 77.0266),
  ('HR51', 'Faridabad', 'फरीदाबाद', 'Haryana', 'Faridabad', 28.4089, 77.3178),
  ('HR29', 'Ballabgarh', 'बल्लभगढ़', 'Haryana', 'Faridabad', 28.3412, 77.3276),
  ('HR19', 'Charkhi Dadri', 'चरखी दादरी', 'Haryana', 'Charkhi Dadri', 28.5921, 76.2654),
  ('HR76', 'Pataudi', 'पटौदी', 'Haryana', 'Gurugram', 28.3229, 76.7824),
  ('HR98', 'Badhra', 'बाढड़ा', 'Haryana', 'Charkhi Dadri', 28.4878, 76.0125),
  ('HR01', 'Ambala', 'अंबाला', 'Haryana', 'Ambala', 30.3782, 76.7767),
  ('HR03', 'Panchkula', 'पंचकूला', 'Haryana', 'Panchkula', 30.6942, 76.8606),
  ('HR05', 'Karnal', 'करनाल', 'Haryana', 'Karnal', 29.6857, 76.9905),
  ('HR06', 'Panipat', 'पानीपत', 'Haryana', 'Panipat', 29.3909, 76.9635),
  ('HR10', 'Sonipat', 'सोनीपत', 'Haryana', 'Sonipat', 28.9931, 77.0151),
  ('HR', 'Haryana', 'हरियाणा', 'Haryana', 'Haryana', 29.0588, 76.0856),

  -- Bharat Series
  ('BH24', 'Bharat Series (2024)', 'भारत सीरीज', 'All India', 'National', 28.6139, 77.2090)
ON CONFLICT (prefix) DO UPDATE SET
  location_name = EXCLUDED.location_name,
  name_hi = EXCLUDED.name_hi,
  state = EXCLUDED.state,
  district = EXCLUDED.district,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  is_active = true,
  updated_at = now();

-- ============================================================================
-- 3. UPDATE VEHICLE ORIGIN LOCATIONS FOR 4 QUICK BUTTONS
-- ============================================================================
-- The 4 quick buttons are strictly: UP21, UP22, UP23, UP16.
-- DL is removed from quick buttons (now entered via manual modal).

-- Insert UP21 if not present
INSERT INTO public.vehicle_origin_locations (name, name_hi, display_order, is_quick_prefix, is_active)
VALUES ('UP21', 'UP21', 1, true, true)
ON CONFLICT (name) DO UPDATE SET
  display_order = 1,
  is_quick_prefix = true,
  is_active = true;

-- Update UP22, UP23, UP16
UPDATE public.vehicle_origin_locations 
SET display_order = 2, is_quick_prefix = true, is_active = true 
WHERE name = 'UP22';

UPDATE public.vehicle_origin_locations 
SET display_order = 3, is_quick_prefix = true, is_active = true 
WHERE name = 'UP23';

UPDATE public.vehicle_origin_locations 
SET display_order = 4, is_quick_prefix = true, is_active = true 
WHERE name = 'UP16';

-- DL is no longer a quick button
UPDATE public.vehicle_origin_locations 
SET display_order = 5, is_quick_prefix = false, is_active = true 
WHERE name = 'DL';

-- Other non-quick options
UPDATE public.vehicle_origin_locations 
SET display_order = 6, is_quick_prefix = false, is_active = true 
WHERE name = 'HR';

UPDATE public.vehicle_origin_locations 
SET display_order = 7, is_quick_prefix = false, is_active = true 
WHERE name = 'UK';

UPDATE public.vehicle_origin_locations 
SET display_order = 8, is_quick_prefix = false, is_active = true 
WHERE name = 'Others';

UPDATE public.vehicle_origin_locations 
SET display_order = 9, is_quick_prefix = false, is_active = true 
WHERE name = 'Bike';

-- ============================================================================
-- 4. ROW LEVEL SECURITY ON GATE OPERATIONAL COUNTER EVENTS
-- ============================================================================
-- Enable RLS on vehicle_counter_events and visitor_counter_events so that
-- unauthorized client-side direct mutations (UPDATE/DELETE) are blocked.
-- Guards and reporting can read and insert (sync events), but event prefix
-- corrections require admin privilege.
ALTER TABLE public.vehicle_counter_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_counter_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Read access
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'vehicle_counter_events' AND policyname = 'Allow read access to vehicle events'
  ) THEN
    CREATE POLICY "Allow read access to vehicle events"
    ON public.vehicle_counter_events
    FOR SELECT
    USING (true);
  END IF;

  -- Insert access (for gate sync)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'vehicle_counter_events' AND policyname = 'Allow insert access to vehicle events'
  ) THEN
    CREATE POLICY "Allow insert access to vehicle events"
    ON public.vehicle_counter_events
    FOR INSERT
    WITH CHECK (true);
  END IF;

  -- Admin-only update
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'vehicle_counter_events' AND policyname = 'Allow admin update to vehicle events'
  ) THEN
    CREATE POLICY "Allow admin update to vehicle events"
    ON public.vehicle_counter_events
    FOR UPDATE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.roles r ON p.role_id = r.id
        WHERE p.id = auth.uid()
          AND (r.name = 'Admin' OR EXISTS (
            SELECT 1 FROM public.role_permissions rp
            JOIN public.permissions perm ON rp.permission_id = perm.id
            WHERE rp.role_id = p.role_id AND perm.code = 'admin.manage'
          ))
      )
    );
  END IF;

  -- Visitor counter read and insert policies
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'visitor_counter_events' AND policyname = 'Allow read access to visitor events'
  ) THEN
    CREATE POLICY "Allow read access to visitor events"
    ON public.visitor_counter_events
    FOR SELECT
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'visitor_counter_events' AND policyname = 'Allow insert access to visitor events'
  ) THEN
    CREATE POLICY "Allow insert access to visitor events"
    ON public.visitor_counter_events
    FOR INSERT
    WITH CHECK (true);
  END IF;
END $$;
