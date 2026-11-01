-- Migration: 20261031160000_moong_papad_conversions.sql
-- Checkpoint 2.1 Forward Migration: Moong Papad Exact Unit Conversions & Packaging Units

-- 1. Update Moong Papad (RTE-009) conversion factor to exact 400/28 grams per piece
UPDATE public.inventory_items
SET 
  conversion_factor = (400.0 / 28.0), -- 14.28571428571428571429
  secondary_unit_id = (SELECT id FROM public.units WHERE symbol = 'g' LIMIT 1),
  updated_at = NOW()
WHERE item_code = 'RTE-009';

-- 2. Configure Moong Papad packaging options:
-- Deactivate previous/dummy packaging units for RTE-009
UPDATE public.item_packaging_units
SET is_active = false, is_default = false, updated_at = NOW()
WHERE inventory_item_id = (SELECT id FROM public.inventory_items WHERE item_code = 'RTE-009');

-- Upsert Packet (400g / 28 pcs) - Default Packaging Option
INSERT INTO public.item_packaging_units (
  inventory_item_id,
  brand_name,
  pack_unit_id,
  pack_unit_name,
  pack_size_in_base_units,
  is_default,
  is_active
) VALUES (
  (SELECT id FROM public.inventory_items WHERE item_code = 'RTE-009'),
  'Generic',
  (SELECT id FROM public.units WHERE symbol = 'pkt' LIMIT 1),
  'Packet (400g / 28 pcs)',
  28,
  true,
  true
);

-- Upsert Kilogram (70 pcs / 2.5 pkts) - Secondary Packaging Option
INSERT INTO public.item_packaging_units (
  inventory_item_id,
  brand_name,
  pack_unit_id,
  pack_unit_name,
  pack_size_in_base_units,
  is_default,
  is_active
) VALUES (
  (SELECT id FROM public.inventory_items WHERE item_code = 'RTE-009'),
  'Generic',
  (SELECT id FROM public.units WHERE symbol = 'kg' LIMIT 1),
  'Kilogram (70 pcs / 2.5 pkts)',
  70,
  false,
  true
);

-- 3. Robust Unit Conversion Function supporting standard mass/volume, packaging units, and piece-weights
CREATE OR REPLACE FUNCTION public.fn_get_unit_conversion_factor(
  p_from_unit_id UUID,
  p_to_unit_id UUID,
  p_item_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from_symbol TEXT;
  v_to_symbol TEXT;
  v_m_from NUMERIC;
  v_m_to NUMERIC;
  v_v_from NUMERIC;
  v_v_to NUMERIC;
  v_item_base_unit UUID;
  v_item_sec_unit UUID;
  v_conversion_factor NUMERIC;
  v_pack_size NUMERIC;
BEGIN
  IF p_from_unit_id IS NULL OR p_to_unit_id IS NULL OR p_from_unit_id = p_to_unit_id THEN
    RETURN 1.0;
  END IF;

  -- Symbols
  SELECT LOWER(TRIM(symbol)) INTO v_from_symbol FROM public.units WHERE id = p_from_unit_id;
  SELECT LOWER(TRIM(symbol)) INTO v_to_symbol FROM public.units WHERE id = p_to_unit_id;

  IF v_from_symbol IS NULL OR v_to_symbol IS NULL OR v_from_symbol = v_to_symbol THEN
    RETURN 1.0;
  END IF;

  -- Mass conversions (base: g)
  v_m_from := CASE v_from_symbol
    WHEN 'mg' THEN 0.001
    WHEN 'g' THEN 1.0
    WHEN 'gm' THEN 1.0
    WHEN 'kg' THEN 1000.0
    WHEN 'chutki' THEN 0.36
    ELSE NULL
  END;

  v_m_to := CASE v_to_symbol
    WHEN 'mg' THEN 0.001
    WHEN 'g' THEN 1.0
    WHEN 'gm' THEN 1.0
    WHEN 'kg' THEN 1000.0
    WHEN 'chutki' THEN 0.36
    ELSE NULL
  END;

  IF v_m_from IS NOT NULL AND v_m_to IS NOT NULL AND v_m_to > 0 THEN
    RETURN (v_m_from / v_m_to);
  END IF;

  -- Volume conversions (base: ml)
  v_v_from := CASE v_from_symbol
    WHEN 'ml' THEN 1.0
    WHEN 'l' THEN 1000.0
    WHEN 'ltr' THEN 1000.0
    ELSE NULL
  END;

  v_v_to := CASE v_to_symbol
    WHEN 'ml' THEN 1.0
    WHEN 'l' THEN 1000.0
    WHEN 'ltr' THEN 1000.0
    ELSE NULL
  END;

  IF v_v_from IS NOT NULL AND v_v_to IS NOT NULL AND v_v_to > 0 THEN
    RETURN (v_v_from / v_v_to);
  END IF;

  -- Liquid mass-to-volume culinary equivalence (1 g = 1 ml, 1 kg = 1 L)
  IF v_m_from IS NOT NULL AND v_v_to IS NOT NULL AND v_v_to > 0 THEN
    RETURN (v_m_from / v_v_to);
  END IF;
  IF v_v_from IS NOT NULL AND v_m_to IS NOT NULL AND v_m_to > 0 THEN
    RETURN (v_v_from / v_m_to);
  END IF;

  -- Item-specific conversions (packaging units & secondary unit conversion factor)
  IF p_item_id IS NOT NULL THEN
    SELECT unit_id, secondary_unit_id, conversion_factor 
    INTO v_item_base_unit, v_item_sec_unit, v_conversion_factor
    FROM public.inventory_items
    WHERE id = p_item_id;

    -- Secondary unit conversion (e.g. base pcs <-> sec g where 1 pc = conversion_factor g)
    IF v_conversion_factor IS NOT NULL AND v_conversion_factor > 0 AND v_item_base_unit IS NOT NULL AND v_item_sec_unit IS NOT NULL THEN
      -- Direct between base and secondary
      IF p_from_unit_id = v_item_base_unit AND p_to_unit_id = v_item_sec_unit THEN
        RETURN v_conversion_factor;
      ELSIF p_from_unit_id = v_item_sec_unit AND p_to_unit_id = v_item_base_unit THEN
        RETURN (1.0 / v_conversion_factor);
      END IF;

      -- If from_unit is a mass unit and to_unit is base unit (e.g. kg to pcs)
      IF v_m_from IS NOT NULL AND p_to_unit_id = v_item_base_unit AND v_item_sec_unit = (SELECT id FROM public.units WHERE symbol = 'g' LIMIT 1) THEN
        RETURN (v_m_from / v_conversion_factor);
      END IF;

      -- If from_unit is base unit and to_unit is mass (e.g. pcs to kg)
      IF p_from_unit_id = v_item_base_unit AND v_m_to IS NOT NULL AND v_item_sec_unit = (SELECT id FROM public.units WHERE symbol = 'g' LIMIT 1) THEN
        RETURN (v_conversion_factor / v_m_to);
      END IF;
    END IF;

    -- Packaging unit check
    -- 1) From packaging unit to base unit
    SELECT pack_size_in_base_units INTO v_pack_size
    FROM public.item_packaging_units
    WHERE inventory_item_id = p_item_id AND is_active = true
      AND (pack_unit_id = p_from_unit_id OR LOWER(TRIM(pack_unit_name)) = v_from_symbol)
    ORDER BY is_default DESC
    LIMIT 1;

    IF v_pack_size IS NOT NULL AND v_pack_size > 0 THEN
      IF p_to_unit_id = v_item_base_unit THEN
        RETURN v_pack_size;
      END IF;
      -- If converting to secondary unit (e.g. pkt to g)
      IF v_conversion_factor IS NOT NULL AND v_conversion_factor > 0 AND p_to_unit_id = v_item_sec_unit THEN
        RETURN (v_pack_size * v_conversion_factor);
      END IF;
      -- If converting to mass unit (e.g. pkt to kg)
      IF v_conversion_factor IS NOT NULL AND v_conversion_factor > 0 AND v_m_to IS NOT NULL AND v_item_sec_unit = (SELECT id FROM public.units WHERE symbol = 'g' LIMIT 1) THEN
        RETURN (v_pack_size * v_conversion_factor / v_m_to);
      END IF;
    END IF;

    -- 2) From base unit to packaging unit
    SELECT pack_size_in_base_units INTO v_pack_size
    FROM public.item_packaging_units
    WHERE inventory_item_id = p_item_id AND is_active = true
      AND (pack_unit_id = p_to_unit_id OR LOWER(TRIM(pack_unit_name)) = v_to_symbol)
    ORDER BY is_default DESC
    LIMIT 1;

    IF v_pack_size IS NOT NULL AND v_pack_size > 0 THEN
      IF p_from_unit_id = v_item_base_unit THEN
        RETURN (1.0 / v_pack_size);
      END IF;
      -- From mass to packaging unit (e.g. kg to pkt)
      IF v_conversion_factor IS NOT NULL AND v_conversion_factor > 0 AND v_m_from IS NOT NULL AND v_item_sec_unit = (SELECT id FROM public.units WHERE symbol = 'g' LIMIT 1) THEN
        RETURN (v_m_from / (v_conversion_factor * v_pack_size));
      END IF;
    END IF;
  END IF;

  RETURN 1.0;
END;
$$;
