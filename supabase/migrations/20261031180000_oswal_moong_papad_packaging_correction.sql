-- Migration: 20261031180000_oswal_moong_papad_packaging_correction.sql
-- Checkpoint 2.2 Forward Migration: Preserve 'Oswal' Brand Name on RTE-009 Packaging & Delete Inactive Duplicate

-- 1. Update active packaging units on RTE-009 to 'Oswal'
UPDATE public.item_packaging_units
SET brand_name = 'Oswal', updated_at = NOW()
WHERE inventory_item_id = (SELECT id FROM public.inventory_items WHERE item_code = 'RTE-009')
  AND is_active = true
  AND brand_name != 'Oswal';

-- 2. Delete obsolete inactive packaging definition on RTE-009
DELETE FROM public.item_packaging_units
WHERE inventory_item_id = (SELECT id FROM public.inventory_items WHERE item_code = 'RTE-009')
  AND is_active = false;
