-- Forward Migration: Owner-Approved Canonical Items & Recipe Synchronization
-- Adds 5 owner-approved food raw materials to canonical inventory, sets up Moong Papad secondary unit,
-- and adds aliases for Bati Aata and Moong Papad.

-- 1. Create Logical Ingredient Groups for the 5 owner-approved items
INSERT INTO public.logical_ingredient_groups (
  group_code, name, name_hi, category_id, inventory_class, base_unit_id, abc_risk, is_active
) VALUES 
  ('GRP-DAI-012', 'Mozzarella Cheese', 'मोज़ेरेला चीज़', 'dc36c922-9bcc-4f99-9132-4c98594d262d', 'Food Raw Material', 'f9ed0c0b-c950-4742-aa64-caff9f95f84e', 'Routine Monitoring', true),
  ('GRP-SAU-013', 'Tandoori Sauce', 'तंदूरी सॉस', '128f248c-b58f-4407-9379-d200673e79c1', 'Food Raw Material', 'f9ed0c0b-c950-4742-aa64-caff9f95f84e', 'Routine Monitoring', true),
  ('GRP-OIL-006', 'Mustard Oil', 'सरसों का तेल', '54e9a9d8-9388-4ddc-b266-a647564de392', 'Food Raw Material', 'f9ed0c0b-c950-4742-aa64-caff9f95f84e', 'Routine Monitoring', true),
  ('GRP-VEG-033', 'Sarson', 'सरसों का साग', '69eda835-17b4-4ec5-a81f-55d0c5b69683', 'Food Raw Material', 'f9ed0c0b-c950-4742-aa64-caff9f95f84e', 'Routine Monitoring', true),
  ('GRP-VEG-034', 'Bathua', 'बथुआ', '69eda835-17b4-4ec5-a81f-55d0c5b69683', 'Food Raw Material', 'f9ed0c0b-c950-4742-aa64-caff9f95f84e', 'Routine Monitoring', true)
ON CONFLICT (name) DO UPDATE SET
  group_code = EXCLUDED.group_code,
  name_hi = COALESCE(logical_ingredient_groups.name_hi, EXCLUDED.name_hi),
  category_id = EXCLUDED.category_id,
  inventory_class = EXCLUDED.inventory_class,
  base_unit_id = EXCLUDED.base_unit_id,
  abc_risk = EXCLUDED.abc_risk,
  is_active = true;

-- 2. Create the 5 Canonical Stock Items in inventory_items
INSERT INTO public.inventory_items (
  item_code, name, name_hi, category_id, inventory_class, unit_id,
  current_stock, current_weighted_average_cost, is_costed, abc_risk, is_active,
  group_id, brand_name, variant_name, notes
) VALUES
  (
    'DAI-012', 'Mozzarella Cheese', 'मोज़ेरेला चीज़', 'dc36c922-9bcc-4f99-9132-4c98594d262d', 'Food Raw Material', 'f9ed0c0b-c950-4742-aa64-caff9f95f84e',
    0.000, 0.00, false, 'Routine Monitoring', true,
    (SELECT id FROM public.logical_ingredient_groups WHERE name = 'Mozzarella Cheese' LIMIT 1),
    'Generic', 'Mozzarella Cheese', 'Owner-approved food raw material addition'
  ),
  (
    'SAU-013', 'Tandoori Sauce', 'तंदूरी सॉस', '128f248c-b58f-4407-9379-d200673e79c1', 'Food Raw Material', 'f9ed0c0b-c950-4742-aa64-caff9f95f84e',
    0.000, 0.00, false, 'Routine Monitoring', true,
    (SELECT id FROM public.logical_ingredient_groups WHERE name = 'Tandoori Sauce' LIMIT 1),
    'Generic', 'Tandoori Sauce', 'Owner-approved food raw material addition'
  ),
  (
    'OIL-006', 'Mustard Oil', 'सरसों का तेल', '54e9a9d8-9388-4ddc-b266-a647564de392', 'Food Raw Material', 'f9ed0c0b-c950-4742-aa64-caff9f95f84e',
    0.000, 0.00, false, 'Routine Monitoring', true,
    (SELECT id FROM public.logical_ingredient_groups WHERE name = 'Mustard Oil' LIMIT 1),
    'Generic', 'Mustard Oil', 'Owner-approved food raw material addition'
  ),
  (
    'VEG-033', 'Sarson', 'सरसों का साग', '69eda835-17b4-4ec5-a81f-55d0c5b69683', 'Food Raw Material', 'f9ed0c0b-c950-4742-aa64-caff9f95f84e',
    0.000, 0.00, false, 'Routine Monitoring', true,
    (SELECT id FROM public.logical_ingredient_groups WHERE name = 'Sarson' LIMIT 1),
    'Generic', 'Sarson', 'Owner-approved food raw material addition'
  ),
  (
    'VEG-034', 'Bathua', 'बथुआ', '69eda835-17b4-4ec5-a81f-55d0c5b69683', 'Food Raw Material', 'f9ed0c0b-c950-4742-aa64-caff9f95f84e',
    0.000, 0.00, false, 'Routine Monitoring', true,
    (SELECT id FROM public.logical_ingredient_groups WHERE name = 'Bathua' LIMIT 1),
    'Generic', 'Bathua', 'Owner-approved food raw material addition'
  )
ON CONFLICT (item_code) DO UPDATE SET
  name = EXCLUDED.name,
  name_hi = COALESCE(inventory_items.name_hi, EXCLUDED.name_hi),
  category_id = EXCLUDED.category_id,
  inventory_class = EXCLUDED.inventory_class,
  unit_id = EXCLUDED.unit_id,
  group_id = EXCLUDED.group_id,
  brand_name = EXCLUDED.brand_name,
  variant_name = EXCLUDED.variant_name,
  is_active = true,
  updated_at = now();

-- 3. Location Stocks: Ensure Central Store Room has zero quantity record for the 5 items
INSERT INTO public.item_location_stocks (item_id, location_id, quantity)
SELECT i.id, 'a89335e9-01b4-4edd-bee5-a894053d798d'::uuid, 0.000
FROM public.inventory_items i
WHERE i.item_code IN ('DAI-012', 'SAU-013', 'OIL-006', 'VEG-033', 'VEG-034')
ON CONFLICT (item_id, location_id) DO NOTHING;

-- 4. Packaging Units: Add standard default packaging for the 5 items
INSERT INTO public.item_packaging_units (
  inventory_item_id, brand_name, pack_unit_name, pack_size_in_base_units, pack_unit_id, is_default, is_active
)
SELECT 
  i.id,
  'Generic',
  CASE 
    WHEN i.item_code IN ('DAI-012', 'VEG-033', 'VEG-034') THEN 'Packet (1 kg)'
    WHEN i.item_code IN ('SAU-013', 'OIL-006') THEN 'Bottle (1 kg)'
    ELSE 'Packet (1 kg)'
  END,
  1000.0,
  CASE 
    WHEN i.item_code IN ('DAI-012', 'VEG-033', 'VEG-034') THEN '7f59d6d4-831d-43ba-958a-0e68a58a4a83'::uuid
    WHEN i.item_code IN ('SAU-013', 'OIL-006') THEN '596fbb76-0065-43b9-b530-c42197bc8bbf'::uuid
    ELSE '7f59d6d4-831d-43ba-958a-0e68a58a4a83'::uuid
  END,
  true,
  true
FROM public.inventory_items i
WHERE i.item_code IN ('DAI-012', 'SAU-013', 'OIL-006', 'VEG-033', 'VEG-034')
ON CONFLICT DO NOTHING;

-- 5. Moong Papad Secondary Unit & Conversion Factor Configuration
UPDATE public.inventory_items
SET secondary_unit_id = 'f9ed0c0b-c950-4742-aa64-caff9f95f84e'::uuid, -- g
    conversion_factor = 15.000,                                      -- 15g per pc
    updated_at = now()
WHERE id = '295bd668-4f84-481d-b5bd-7c029bacb324' OR item_code = 'RTE-009';

-- 6. Add Aliases for Bati Aata, Moong Papad, and New Items
-- A. Baati Aata: Add 'Bati Aata' alias
INSERT INTO public.inventory_item_aliases (
  item_id, group_id, alias, normalized_alias, alias_type, notes
)
SELECT 
  '8b8a9d87-26cc-40b7-92e1-fb164540acf0'::uuid,
  'f632a5e0-c5e2-41f7-b1b3-b2fbc11d2710'::uuid,
  'Bati Aata',
  'bati aata',
  'colloquial',
  'Owner approved alias mapping for Baati Aata'
ON CONFLICT (item_id, normalized_alias) DO UPDATE SET
  group_id = EXCLUDED.group_id;

-- B. Moong Papad: Add 'Papad' and 'Moong Papad' aliases
INSERT INTO public.inventory_item_aliases (
  item_id, group_id, alias, normalized_alias, alias_type, notes
) VALUES
  (
    '295bd668-4f84-481d-b5bd-7c029bacb324'::uuid,
    '8d6e2fa8-1d53-43fa-9e5b-f94d7814031b'::uuid,
    'Papad',
    'papad',
    'colloquial',
    'Owner approved synonym mapping for Moong Papad'
  ),
  (
    '295bd668-4f84-481d-b5bd-7c029bacb324'::uuid,
    '8d6e2fa8-1d53-43fa-9e5b-f94d7814031b'::uuid,
    'Moong Papad',
    'moong papad',
    'common',
    'Authoritative name'
  )
ON CONFLICT (item_id, normalized_alias) DO UPDATE SET
  group_id = EXCLUDED.group_id;

-- C. Aliases for 5 new items
INSERT INTO public.inventory_item_aliases (item_id, group_id, alias, normalized_alias, alias_type, notes)
SELECT i.id, i.group_id, 'Mozzarella Cheese', 'mozzarella cheese', 'common', 'Standard alias'
FROM public.inventory_items i WHERE i.item_code = 'DAI-012'
ON CONFLICT (item_id, normalized_alias) DO NOTHING;

INSERT INTO public.inventory_item_aliases (item_id, group_id, alias, normalized_alias, alias_type, notes)
SELECT i.id, i.group_id, 'Tandoori Sauce', 'tandoori sauce', 'common', 'Standard alias'
FROM public.inventory_items i WHERE i.item_code = 'SAU-013'
ON CONFLICT (item_id, normalized_alias) DO NOTHING;

INSERT INTO public.inventory_item_aliases (item_id, group_id, alias, normalized_alias, alias_type, notes)
SELECT i.id, i.group_id, 'Mustard Oil', 'mustard oil', 'common', 'Standard alias'
FROM public.inventory_items i WHERE i.item_code = 'OIL-006'
ON CONFLICT (item_id, normalized_alias) DO NOTHING;

INSERT INTO public.inventory_item_aliases (item_id, group_id, alias, normalized_alias, alias_type, notes)
SELECT i.id, i.group_id, 'Sarson', 'sarson', 'common', 'Standard alias'
FROM public.inventory_items i WHERE i.item_code = 'VEG-033'
ON CONFLICT (item_id, normalized_alias) DO NOTHING;

INSERT INTO public.inventory_item_aliases (item_id, group_id, alias, normalized_alias, alias_type, notes)
SELECT i.id, i.group_id, 'Bathua', 'bathua', 'common', 'Standard alias'
FROM public.inventory_items i WHERE i.item_code = 'VEG-034'
ON CONFLICT (item_id, normalized_alias) DO NOTHING;
