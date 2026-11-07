-- Migration: 20261107141000_add_milligram_to_units.sql
-- Description: Add Milligram (mg) to central units master

INSERT INTO public.units (id, name, name_hi, symbol, symbol_hi, is_active)
VALUES (
  gen_random_uuid(),
  'Milligram',
  'मिलीग्राम',
  'mg',
  'मिग्रा',
  true
)
ON CONFLICT (symbol) DO UPDATE SET
  name = EXCLUDED.name,
  name_hi = EXCLUDED.name_hi,
  symbol_hi = EXCLUDED.symbol_hi,
  is_active = true;
