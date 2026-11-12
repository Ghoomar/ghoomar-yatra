-- ============================================================================
-- Ghoomar Yatra Phase B Data Migration: 4-Tier Native Culinary & Menu Data
-- Migration: 20261112010000_surviving_combos_and_4tier_data.sql
-- ============================================================================

DO $$
DECLARE
  v_rice_category_id UUID;
  v_admin_id UUID;
  v_cheese_group_id UUID;
  v_g_unit_id UUID;
  v_dairy_cat_id UUID;
  v_dish_id UUID;
  v_form_id UUID;
  v_cfg_id UUID;
  v_sub_dish_id UUID;
  v_sub_form_id UUID;
  v_rec RECORD;
BEGIN
  -- 0. Get admin ID for verification provenance
  SELECT id INTO v_admin_id FROM auth.users ORDER BY created_at ASC LIMIT 1;

  -- 1. Owner-Authorised Cleanup of Paneer Rice and Paneer Dish (Combo Portion)
  DELETE FROM public.yatra_combo_components WHERE combo_thali_id = '7e7d7b0e-463e-4740-90de-a7e61c80943d';
  DELETE FROM public.yatra_combos_thalis WHERE id = '7e7d7b0e-463e-4740-90de-a7e61c80943d';
  DELETE FROM public.yatra_recipe_ingredients WHERE recipe_id = 'b4df614a-a873-48da-929c-4faed5af6f9e';
  DELETE FROM public.yatra_recipes WHERE id = 'b4df614a-a873-48da-929c-4faed5af6f9e';

  -- 2. Cheese Slice Resolution (GRP-DAI-013)
  SELECT id INTO v_cheese_group_id FROM public.logical_ingredient_groups WHERE group_code = 'GRP-DAI-013';
  IF v_cheese_group_id IS NULL THEN
    SELECT id INTO v_g_unit_id FROM public.units WHERE symbol = 'g' LIMIT 1;
    SELECT id INTO v_dairy_cat_id FROM public.inventory_categories WHERE name ILIKE '%dairy%' LIMIT 1;

    INSERT INTO public.logical_ingredient_groups (
      group_code, name, name_hi, category_id, base_unit_id, inventory_class, is_active
    ) VALUES (
      'GRP-DAI-013', 'Cheese Slice', 'चीज स्लाइस', v_dairy_cat_id, v_g_unit_id, 'Food Raw Material', true
    ) RETURNING id INTO v_cheese_group_id;
  END IF;

  UPDATE public.inventory_items
  SET group_id = v_cheese_group_id, updated_at = now()
  WHERE id = 'bc94f42d-9e29-4a5f-a592-be1788dab983';

  INSERT INTO public.yatra_ingredient_unit_conversions (
    inventory_item_id, from_unit, to_unit, multiplier, is_verified, verified_by, verified_at, notes
  ) VALUES (
    'bc94f42d-9e29-4a5f-a592-be1788dab983', 'pcs', 'g', 20.0, true, v_admin_id, now(), 'Verified Cheese Slice 20g/slice'
  ) ON CONFLICT (inventory_item_id, lower(trim(from_unit)), lower(trim(to_unit))) WHERE inventory_item_id IS NOT NULL
  DO UPDATE SET multiplier = EXCLUDED.multiplier, is_verified = true, verified_by = EXCLUDED.verified_by, verified_at = EXCLUDED.verified_at;

  -- 3. Resolve intended Rice category under Indian parent category
  SELECT c.id INTO v_rice_category_id
  FROM public.pos_categories c
  JOIN public.pos_parent_categories pc ON c.parent_category_id = pc.id
  WHERE lower(trim(c.name)) = 'rice' AND lower(trim(pc.name)) = 'indian';

  IF v_rice_category_id IS NULL THEN
    RAISE EXCEPTION 'Category Rice under Indian parent not found';
  END IF;

  -- 4. Upsert Chhole Rice in pos_menu_items
  INSERT INTO public.pos_menu_items (
    id, name, normalized_name, category, parent_category, category_id,
    price, gst_percent, tax_type, product_type, gas_cost, other_operating_cost,
    packaging_cost_dine_in, packaging_cost_takeaway, default_service_channel,
    is_active, needs_setup
  ) VALUES (
    '10395494-24d8-478d-9f03-2779f0756111', 'Chhole Rice', 'chhole rice',
    'Rice', 'Indian', v_rice_category_id,
    189.00, 5.00, 'F', 'COMBO', 7.0000, 0.0000,
    0.0000, 15.0000, 'DINE_IN', true, false
  ) ON CONFLICT (id) DO UPDATE SET
    category_id = EXCLUDED.category_id,
    category = EXCLUDED.category,
    parent_category = EXCLUDED.parent_category,
    price = EXCLUDED.price,
    gst_percent = EXCLUDED.gst_percent,
    tax_type = EXCLUDED.tax_type,
    product_type = 'COMBO',
    gas_cost = 7.0000,
    packaging_cost_takeaway = 15.0000,
    default_service_channel = 'DINE_IN',
    updated_at = now();

  -- 5. Upsert Dal Makhani Rice in pos_menu_items
  INSERT INTO public.pos_menu_items (
    id, name, normalized_name, category, parent_category, category_id,
    price, gst_percent, tax_type, product_type, gas_cost, other_operating_cost,
    packaging_cost_dine_in, packaging_cost_takeaway, default_service_channel,
    is_active, needs_setup
  ) VALUES (
    '67a2c221-2d2d-4c9f-bbe3-7195d2812f10', 'Dal Makhani Rice', 'dal makhani rice',
    'Rice', 'Indian', v_rice_category_id,
    179.00, 5.00, 'F', 'COMBO', 7.0000, 0.0000,
    0.0000, 15.0000, 'DINE_IN', true, false
  ) ON CONFLICT (id) DO UPDATE SET
    category_id = EXCLUDED.category_id,
    category = EXCLUDED.category,
    parent_category = EXCLUDED.parent_category,
    price = EXCLUDED.price,
    gst_percent = EXCLUDED.gst_percent,
    tax_type = EXCLUDED.tax_type,
    product_type = 'COMBO',
    gas_cost = 7.0000,
    packaging_cost_takeaway = 15.0000,
    default_service_channel = 'DINE_IN',
    updated_at = now();

  -- 6. Link yatra_combos_thalis.menu_item_id
  UPDATE public.yatra_combos_thalis
  SET menu_item_id = '10395494-24d8-478d-9f03-2779f0756111', updated_at = now()
  WHERE id = '10395494-24d8-478d-9f03-2779f0756111';

  UPDATE public.yatra_combos_thalis
  SET menu_item_id = '67a2c221-2d2d-4c9f-bbe3-7195d2812f10', updated_at = now()
  WHERE id = '67a2c221-2d2d-4c9f-bbe3-7195d2812f10';

  -- ==========================================================================
  -- 7. Seed Canonical Dishes
  -- ==========================================================================

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Chhole', 'chhole', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Cooked Rice', 'cooked-rice', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Dal Makhani', 'dal-makhani', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Salad', 'salad', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Aloo Pyaaza Paneer ki Subzi', 'aloo-pyaaza-paneer-ki-subzi', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Mix Veg', 'mix-veg', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Black Coffee', 'black-coffee', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Dal Fry', 'dal-fry', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Dal Panchmel', 'dal-panchmel', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Gulab Jamun', 'gulab-jamun', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Handi Paneer', 'handi-paneer', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Jodhpuri Gatta Masala', 'jodhpuri-gatta-masala', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Jodhpuri Kadhi', 'jodhpuri-kadhi', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Kaju Curry', 'kaju-curry', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Mawa Churma', 'mawa-churma', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Mint Mojito', 'mint-mojito', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Moongdal Halwa', 'moongdal-halwa', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Paneer Sandwich', 'paneer-sandwich', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Paneer Tikka Pizza', 'paneer-tikka-pizza', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Papad', 'papad', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Rajputana Saag', 'rajputana-saag', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Red Sauce Pasta', 'red-sauce-pasta', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Salted Lassi', 'salted-lassi', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Sarson Ka Saag', 'sarson-ka-saag', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Sev Tamatar', 'sev-tamatar', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Tawa Roti', 'tawa-roti', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Veg Sandwich', 'veg-sandwich', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Veg. Cheese Grilled Sandwich', 'veg-cheese-grilled-sandwich', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('White Sauce Pasta', 'white-sauce-pasta', 'FINAL_DISH', false, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Boiled Vegetables YM', 'boiled-vegetables-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Chasni', 'chasni', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Chopped Masala YM', 'chopped-masala-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Dal Makhani 2 YM', 'dal-makhani-2-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Dal Makhani YM', 'dal-makhani-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Dal Panchmel YM', 'dal-panchmel-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Garlic Paste YM', 'garlic-paste-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Gatta Gravy YM', 'gatta-gravy-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Gatta YM', 'gatta-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Ghee YM', 'ghee-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Green Chilli Paste YM', 'green-chilli-paste-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Green Chutney', 'green-chutney', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Gulab Jamun Prep', 'gulab-jamun-prep', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Kadhai Paneer YM', 'kadhai-paneer-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Kair Sangri Prep', 'kair-sangri-prep', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Khada Masala YM', 'khada-masala-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Master Gravy YM', 'master-gravy-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Mawa Churma YM', 'mawa-churma-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Pasta Vegetables Mix YM', 'pasta-vegetables-mix-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Pizza Base YM', 'pizza-base-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Raita YM', 'raita-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Rajasthani Chopped Masala YM', 'rajasthani-chopped-masala-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Rajputana Saag YM', 'rajputana-saag-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Slice Cutting YM', 'slice-cutting-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Spring Roll Sauce YM', 'spring-roll-sauce-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Spring Roll Vegetables YM', 'spring-roll-vegetables-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('Tomato Puree YM', 'tomato-puree-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  INSERT INTO public.yatra_canonical_dishes (name, slug, category, is_preparation, is_active)
  VALUES ('White Gravy YM', 'white-gravy-ym', 'PREPARATION', true, true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_preparation = EXCLUDED.is_preparation;

  -- ==========================================================================
  -- 8. Seed Recipe Formulations
  -- ==========================================================================

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chhole'),
    'Standard',
    1, 200, 'g', 'b42326e5-30e6-464c-b756-341c653bf09b', 'Batch yield 200g Chhole costing ₹21.55.', true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Cooked Rice'),
    'Standard',
    1, 160, 'g', 'b48fa976-3800-4415-a822-566ab4100193', '100g raw Basmati Rice cooked yield is 160g. Cost ₹11.00 per 160g serving.', true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani'),
    'Standard',
    1, 200, 'g', 'dffc0126-8fc1-458d-84f1-c790bf85875a', 'Dal Makhani portion for combos: 200g serving costing ₹11.62.', true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Salad'),
    'Standard',
    1, 40, 'g', 'd914facf-ed4d-4a8c-a564-10eb2ea6b1dc', 'Standard combo side salad: 4g Lemon Garnish, 18g Cucumber, 18g Carrot = 40g serving @ ₹2.20.', true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Aloo Pyaaza Paneer ki Subzi'),
    'Standard',
    1, 436, 'g', '4a2857c0-90d4-4674-98c5-aa5a68b8c3ce', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    'Bhrampal',
    1, 327, 'g', 'e633be86-2eee-47e0-99f2-b133938665e9', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Black Coffee'),
    'Standard',
    1, 200, 'g', '2d228b33-7d9b-4c59-9eb7-fecd1a83ea0a', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Fry'),
    'Standard',
    1, 317, 'g', '384150a5-e6ba-4c1f-a419-9d69d3d7086d', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani'),
    'Standard',
    1, 340, 'g', '2b3ceb42-ab12-453a-b7e8-2fb71594ea04', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Panchmel'),
    'Standard',
    1, 6.2, 'kg', '4982115f-8f88-45cf-a2b5-59691bcf9fb3', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    'Deepak',
    1, 350, 'g', 'eb4fc715-b508-43d7-93fc-8c8e29ca5f3f', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Gulab Jamun'),
    'Standard',
    1, 1, 'pcs', 'f3c98e9c-feb9-4e6c-b2f9-2e776d05f40d', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Handi Paneer'),
    'Standard',
    1, 370, 'g', '1d90db00-8bf8-4c5b-9ff3-824f35221895', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Jodhpuri Gatta Masala'),
    'Standard',
    1, 6, 'kg', '22eaf5a8-62fc-479c-b302-1aa50210a00c', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Jodhpuri Kadhi'),
    'Standard',
    1, 8.5, 'kg', 'a3a1f762-025b-40ad-bb3e-d4e00ea17db8', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Kaju Curry'),
    'Standard',
    1, 350, 'g', '096d9d2e-3037-48fb-9fa9-807cc52025fb', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mawa Churma'),
    'Standard',
    1, 65, 'g', 'c4043d6f-f594-476c-b0d3-229a3c858130', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mint Mojito'),
    'Standard',
    1, 1, 'pcs', 'a31b2b51-4d4a-4f37-8ef2-eae85e0b6740', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Moongdal Halwa'),
    'Standard',
    1, NULL, 'kg', '261cc0ac-d54c-47fc-8a75-3ddf5ba4784f', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Paneer Sandwich'),
    'Standard',
    1, 261, 'g', '12dd7811-5786-4ebf-b41a-5d0a322c287e', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Paneer Tikka Pizza'),
    'Standard',
    1, 300, 'g', 'e745f4a7-4e02-4174-abd2-6c8a4f35d54a', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Papad'),
    'Standard',
    1, 15, 'g', 'ba94cc31-a550-4c70-8d82-36857ce1945c', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Rajputana Saag'),
    'Standard',
    1, 2.2, 'kg', '05dea742-78f2-4eda-b636-4d6161d9fac6', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Red Sauce Pasta'),
    'Standard',
    1, 456, 'g', '3bf76bc0-70e5-43ca-8e10-4a08bc820b5b', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Salted Lassi'),
    'Standard',
    1, 300, 'g', '762096e8-a9f7-4c33-b1f0-c73ce1d82d87', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Sarson Ka Saag'),
    'Standard',
    1, 9, 'kg', '81774375-a025-4ac9-a61c-7e5fd16bc24b', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Sev Tamatar'),
    'Standard',
    1, NULL, 'kg', '01c9e786-2eaf-4469-bfba-47a4d8bd13d9', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Tawa Roti'),
    'Standard',
    1, 35, 'pcs', '57995ded-79c0-4622-bd9f-72424f1ffe9b', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Veg Sandwich'),
    'Standard',
    1, NULL, 'kg', 'e27bee44-ccf8-401c-97d4-13b86309dc65', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Veg Sandwich'),
    'Chef Version 2',
    1, 293, 'g', '94fca9ff-2286-4cca-97b5-c399408b2934', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Veg. Cheese Grilled Sandwich'),
    'Standard',
    1, 2, 'pcs', '77726fdf-b1b3-493d-ba05-d7ef57c49292', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Sauce Pasta'),
    'Kaushinder',
    1, 366, 'g', '21d61495-be2c-4967-b393-66d738358775', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Sauce Pasta'),
    'Sumit',
    1, 495, 'g', 'd25e1454-2b13-42b8-9a00-452bb35d2404', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Boiled Vegetables YM'),
    'Standard',
    1, 4.5, 'kg', '5c197337-8eda-491a-8419-ce1f9228f2a7', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chasni'),
    'Standard',
    1, 9, 'kg', '1bebc078-2767-4e94-a056-312d09e80c69', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chopped Masala YM'),
    'Standard',
    1, 7.5, 'kg', '42166877-1a9e-4982-af98-eec2be5a117c', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani 2 YM'),
    'Standard',
    1, 10, 'kg', '8f90ebf1-16a6-4817-99c4-529783630913', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani YM'),
    'Standard',
    1, 4.5, 'kg', 'd5257d36-e388-471c-bd44-64287f244e6c', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Panchmel YM'),
    'Standard',
    1, 4, 'kg', 'cc2da0c2-ed33-4494-9c6e-62a33e33d8ef', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Garlic Paste YM'),
    'Standard',
    1, 1, 'kg', 'df3a391b-15ef-4773-aaa6-ca021507a39f', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Gatta Gravy YM'),
    'Standard',
    1, 11.5, 'kg', '3e030d33-302d-49cc-a64c-c6ccccf004ee', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Gatta YM'),
    'Standard',
    1, 1, 'kg', 'd88ec5f0-28c8-4368-ba28-2ed6a728d20d', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Ghee YM'),
    'Standard',
    1, 2.5, 'kg', '124aa47a-609d-4e7a-8c0f-a074093058a1', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Green Chilli Paste YM'),
    'Standard',
    1, 200, 'g', '88fd7a11-8e73-4bff-865f-5a5aa0329231', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Green Chutney'),
    'Standard',
    1, NULL, NULL, '109e10a2-9844-489e-bb20-571a3280cdf8', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Gulab Jamun Prep'),
    'Standard',
    1, 2.6, 'kg', '482d9b5c-1c7d-4c0c-b279-0926d9a6e0cb', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Kadhai Paneer YM'),
    'Standard',
    1, 7, 'kg', '98df1db4-6a22-4d1b-be4e-89b8a72321f5', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Kair Sangri Prep'),
    'Standard',
    1, NULL, 'kg', '82858c5e-7378-42ae-8175-6020f1fc5bf7', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Khada Masala YM'),
    'Standard',
    1, 750, 'g', '917ec6dd-0f7c-4f35-890e-1202ee283052', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Master Gravy YM'),
    'Standard',
    1, 16, 'kg', 'c5e8ceb1-5b37-44f8-99cf-ed85547824be', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mawa Churma YM'),
    'Standard',
    1, 4.5, 'kg', '4e9293ae-0ee8-4ab7-a1b4-d0a51175aa93', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Pasta Vegetables Mix YM'),
    'Standard',
    1, 300, 'g', 'a2ef5de6-2a77-4d9d-802d-e192219b7f3d', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Pizza Base YM'),
    'Standard',
    1, NULL, 'kg', '0583ce81-abe9-42fc-9c1e-03e0ebe891a9', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Raita YM'),
    'Standard',
    1, 5, 'kg', 'be98091b-92d9-423c-8b40-93436852f5c6', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Rajasthani Chopped Masala YM'),
    'Standard',
    1, 1.2, 'kg', '187523da-6003-4823-8473-915717248fb9', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Rajputana Saag YM'),
    'Standard',
    1, 1.868, 'kg', '7e4177ba-c0d0-48b1-824f-6d4fd5c7c221', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Slice Cutting YM'),
    'Standard',
    1, 1.7, 'kg', '534ddb20-e403-44f7-9768-11d1f72ed1e1', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Spring Roll Sauce YM'),
    'Standard',
    1, NULL, 'kg', '4c347d02-137f-49e9-8c3d-cc6fcc9bdab5', 'Duplicated from Pizza Base YM', true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Spring Roll Vegetables YM'),
    'Standard',
    1, NULL, 'kg', 'f45bf654-dc7f-4502-976c-e00c454356a5', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Tomato Puree YM'),
    'Standard',
    1, 700, 'g', '438d9e6c-823f-4262-beb0-e32754d71ad2', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Gravy YM'),
    'Mukesh',
    1, 1.1, 'kg', '20cd9143-d018-47e1-83da-fc4ea0347c34', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  INSERT INTO public.yatra_recipe_formulations (
    canonical_dish_id, name, version_number, batch_yield_quantity, batch_yield_unit,
    legacy_recipe_id, culinary_notes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Gravy YM'),
    'Standard',
    1, 3.5, 'kg', '89f1f11f-4ba7-4634-b1a4-2e3e26cb3fba', NULL, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    batch_yield_quantity = EXCLUDED.batch_yield_quantity,
    batch_yield_unit = EXCLUDED.batch_yield_unit,
    legacy_recipe_id = EXCLUDED.legacy_recipe_id,
    culinary_notes = EXCLUDED.culinary_notes;

  -- Set default_formulation_id on preparations
  UPDATE public.yatra_canonical_dishes d
  SET default_formulation_id = f.id
  FROM public.yatra_recipe_formulations f
  WHERE d.id = f.canonical_dish_id
    AND d.is_preparation = true
    AND f.name = 'Standard';

  -- ==========================================================================
  -- 9. Seed Serving Configurations & Configuration-Formulation Links
  -- ==========================================================================

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    'A La Carte (327g)',
    327, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND sc.name = 'A La Carte (327g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    'A La Carte (350g)',
    350, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND sc.name = 'A La Carte (350g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    'Combo (300g)',
    300, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND sc.name = 'Combo (300g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    'Thali (100g)',
    100, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND sc.name = 'Thali (100g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Sauce Pasta'),
    'A La Carte (366g)',
    366, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Sauce Pasta'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND sc.name = 'A La Carte (366g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Sauce Pasta'),
    'A La Carte (495g)',
    495, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Sauce Pasta'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND sc.name = 'A La Carte (495g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Veg Sandwich'),
    'Standard (293g)',
    293, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Veg Sandwich'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND sc.name = 'Standard (293g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mint Mojito'),
    'Standard (1 pcs)',
    1, 'pcs', '{"volume_ml": 350}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mint Mojito'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND sc.name = 'Standard (1 pcs)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Veg. Cheese Grilled Sandwich'),
    'Standard (2 pcs)',
    2, 'pcs', '{"measured_weight_g": 462}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Veg. Cheese Grilled Sandwich'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND sc.name = 'Standard (2 pcs)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chhole'),
    'Combo (200g)',
    200, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chhole'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND sc.name = 'Combo (200g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chhole'),
    'A La Carte (350g)',
    350, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chhole'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND sc.name = 'A La Carte (350g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Cooked Rice'),
    'Combo (160g)',
    160, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Cooked Rice'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Cooked Rice' AND sc.name = 'Combo (160g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Cooked Rice' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani'),
    'Combo (200g)',
    200, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND sc.name = 'Combo (200g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani'),
    'A La Carte (340g)',
    340, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND sc.name = 'A La Carte (340g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Salad'),
    'Combo (40g)',
    40, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Salad'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Salad' AND sc.name = 'Combo (40g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Salad' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Aloo Pyaaza Paneer ki Subzi'),
    'A La Carte (436g)',
    436, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Aloo Pyaaza Paneer ki Subzi'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Aloo Pyaaza Paneer ki Subzi' AND sc.name = 'A La Carte (436g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Aloo Pyaaza Paneer ki Subzi' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Black Coffee'),
    'Standard (200g)',
    200, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Black Coffee'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Black Coffee' AND sc.name = 'Standard (200g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Black Coffee' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Fry'),
    'A La Carte (317g)',
    317, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Fry'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND sc.name = 'A La Carte (317g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Panchmel'),
    'A La Carte (342g)',
    342, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Panchmel'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND sc.name = 'A La Carte (342g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Gulab Jamun'),
    'Standard (1 pcs)',
    1, 'pcs', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Gulab Jamun'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun' AND sc.name = 'Standard (1 pcs)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Handi Paneer'),
    'A La Carte (370g)',
    370, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Handi Paneer'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND sc.name = 'A La Carte (370g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Jodhpuri Gatta Masala'),
    'A La Carte (350g)',
    350, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Jodhpuri Gatta Masala'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Gatta Masala' AND sc.name = 'A La Carte (350g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Gatta Masala' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Jodhpuri Kadhi'),
    'A La Carte (370g)',
    370, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Jodhpuri Kadhi'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND sc.name = 'A La Carte (370g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Kaju Curry'),
    'A La Carte (350g)',
    350, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Kaju Curry'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND sc.name = 'A La Carte (350g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mawa Churma'),
    'Portion (65g)',
    65, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mawa Churma'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma' AND sc.name = 'Portion (65g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Moongdal Halwa'),
    'Portion (120g)',
    120, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Moongdal Halwa'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Moongdal Halwa' AND sc.name = 'Portion (120g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Moongdal Halwa' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Paneer Sandwich'),
    'Standard (261g)',
    261, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Paneer Sandwich'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND sc.name = 'Standard (261g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Paneer Tikka Pizza'),
    'Standard (300g)',
    300, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Paneer Tikka Pizza'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Paneer Tikka Pizza' AND sc.name = 'Standard (300g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Tikka Pizza' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Papad'),
    'Standard (15g)',
    15, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Papad'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Papad' AND sc.name = 'Standard (15g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Papad' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Rajputana Saag'),
    'Portion (90g)',
    90, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Rajputana Saag'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND sc.name = 'Portion (90g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Red Sauce Pasta'),
    'A La Carte (456g)',
    456, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Red Sauce Pasta'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND sc.name = 'A La Carte (456g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Salted Lassi'),
    'Standard (300g)',
    300, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Salted Lassi'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Salted Lassi' AND sc.name = 'Standard (300g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Salted Lassi' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Sarson Ka Saag'),
    'A La Carte (372g)',
    372, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Sarson Ka Saag'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND sc.name = 'A La Carte (372g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Sev Tamatar'),
    'A La Carte (350g)',
    350, 'g', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Sev Tamatar'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Sev Tamatar' AND sc.name = 'A La Carte (350g)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sev Tamatar' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  INSERT INTO public.yatra_serving_configurations (
    canonical_dish_id, name, portion_size_quantity, portion_size_unit, custom_attributes, is_active
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Tawa Roti'),
    '1 Piece (1 pcs)',
    1, 'pcs', '{}'::jsonb, true
  ) ON CONFLICT (canonical_dish_id, name) DO UPDATE SET
    portion_size_quantity = EXCLUDED.portion_size_quantity,
    portion_size_unit = EXCLUDED.portion_size_unit,
    custom_attributes = EXCLUDED.custom_attributes;

  INSERT INTO public.yatra_configuration_formulations (
    canonical_dish_id, serving_configuration_id, formulation_id, is_default
  ) VALUES (
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Tawa Roti'),
    (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Tawa Roti' AND sc.name = '1 Piece (1 pcs)'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Tawa Roti' AND rf.name = 'Standard'),
    true
  ) ON CONFLICT (serving_configuration_id, formulation_id) DO UPDATE SET is_default = true;

  -- ==========================================================================
  -- 10. Seed Formulation Ingredients
  -- ==========================================================================

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Rajputana Saag YM'),
    NULL,
    1.8680,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    250.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'fccaaa69-24ad-4e45-9a0f-a6f072207421',
    NULL,
    10.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    200.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'eea7dadd-aaaa-4d8f-8445-0c6907e3fee7',
    NULL,
    87.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8992d1e8-a6d2-4964-bd58-95dc4903a03c',
    NULL,
    48.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ad4d5c99-692c-4b8e-a090-f088e5eb53df',
    NULL,
    20.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b7ba95c3-df40-4487-b5e4-d1bf94dbcaec',
    NULL,
    27.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    31.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '3f5b5029-e424-44aa-b27d-18e5ec29678c',
    NULL,
    9.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '1017f901-7330-413f-8224-fdb279e54727',
    NULL,
    30.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0fd864d1-762a-4d9f-9fe4-a1906946f9ae',
    NULL,
    1.0000,
    'chutki',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Garlic Paste YM'),
    NULL,
    52.0000,
    'g',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'fe45312e-d89e-4a74-8b50-45134981c2fc',
    NULL,
    70.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Ghee YM'),
    NULL,
    16.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8be877ec-34ff-4eca-bc02-53f65e961ff5',
    NULL,
    44.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    1.0000,
    'chutki',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '1017f901-7330-413f-8224-fdb279e54727',
    NULL,
    1.0000,
    'chutki',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b7ba95c3-df40-4487-b5e4-d1bf94dbcaec',
    NULL,
    1.0000,
    'chutki',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ad4d5c99-692c-4b8e-a090-f088e5eb53df',
    NULL,
    1.0000,
    'chutki',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '3f5b5029-e424-44aa-b27d-18e5ec29678c',
    NULL,
    1.0000,
    'chutki',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'd10a6a14-37bc-45e6-a7d3-2ff6ff40985b',
    NULL,
    1.0000,
    'chutki',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0fd864d1-762a-4d9f-9fe4-a1906946f9ae',
    NULL,
    3.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '96c3a3d6-216a-450d-9987-491891e60022',
    NULL,
    11.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'bee69833-07dd-43b8-963f-d32f36a2df1b',
    NULL,
    11.0000,
    'g',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Gravy YM'),
    NULL,
    280.0000,
    'g',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Ghee YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '90b50b63-8cd8-4627-b0fc-6d753fd52b1a',
    NULL,
    2.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Ghee YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'e3828d3f-ad2d-43ad-8114-26b7aad38c89',
    NULL,
    500.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'e8f28c53-698b-4d00-a208-a0650dec19b1',
    NULL,
    125.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5c8547e2-89d6-4bba-9779-16c8ae4ba003',
    NULL,
    1.0000,
    'chutki',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '642353fb-3e9c-43e9-997b-4c43132764e7',
    NULL,
    1.0000,
    'chutki',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '3f5b5029-e424-44aa-b27d-18e5ec29678c',
    NULL,
    1.0000,
    'chutki',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    1.0000,
    'chutki',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'be417ca0-b52d-4151-8f14-b3ce84556272',
    NULL,
    1.0000,
    'chutki',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8cd5b91e-3293-4cac-af41-b8841363e717',
    NULL,
    1.0000,
    'chutki',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '49c23fc0-6011-4dbd-8ec9-87fde2dfeffa',
    NULL,
    1.0000,
    'chutki',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '9e80ab5c-c28d-4efc-9fe3-d95fd00284a1',
    NULL,
    1.0000,
    'chutki',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '55de99f3-4305-47e1-bcb8-18f347fc073c',
    NULL,
    112.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '9d119989-f51e-4136-87a4-02eafeddbe1e',
    NULL,
    30.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '6bbd5f9a-0b9b-42da-ae45-04c7054b423f',
    NULL,
    10.0000,
    'g',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajasthani Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    100.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajasthani Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'eea7dadd-aaaa-4d8f-8445-0c6907e3fee7',
    NULL,
    100.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajasthani Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    800.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajasthani Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    450.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajasthani Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cc1d4212-3e72-4d6d-bf39-8a289da5935a',
    NULL,
    30.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajasthani Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    20.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajasthani Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '7f4eca12-dbd4-4ac5-9b42-6c7270349d95',
    NULL,
    5.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chasni' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'aaea4b78-a158-4352-be38-dc2c83df198e',
    NULL,
    4.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    37.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '755a7ffa-6cd8-4473-a4c2-b7bf7f324639',
    NULL,
    44.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chopped Masala YM'),
    NULL,
    108.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Master Gravy YM'),
    NULL,
    135.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Ghee YM'),
    NULL,
    20.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8be877ec-34ff-4eca-bc02-53f65e961ff5',
    NULL,
    24.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0b48e22e-8628-48e9-8d65-11fd4f715a20',
    NULL,
    9.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    1.0000,
    'chutki',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cc1d4212-3e72-4d6d-bf39-8a289da5935a',
    NULL,
    1.0000,
    'chutki',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b7ba95c3-df40-4487-b5e4-d1bf94dbcaec',
    NULL,
    1.0000,
    'chutki',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '1017f901-7330-413f-8224-fdb279e54727',
    NULL,
    1.0000,
    'chutki',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '3f5b5029-e424-44aa-b27d-18e5ec29678c',
    NULL,
    1.0000,
    'chutki',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'd10a6a14-37bc-45e6-a7d3-2ff6ff40985b',
    NULL,
    1.0000,
    'chutki',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bccfda8-016a-4d56-933f-33a9ad72520d',
    NULL,
    1.0000,
    'chutki',
    NULL,
    13
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8992d1e8-a6d2-4964-bd58-95dc4903a03c',
    NULL,
    6.0000,
    'g',
    NULL,
    14
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0fd864d1-762a-4d9f-9fe4-a1906946f9ae',
    NULL,
    10.0000,
    'g',
    NULL,
    15
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'e8f28c53-698b-4d00-a208-a0650dec19b1',
    NULL,
    96.0000,
    'g',
    NULL,
    16
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Gravy YM' AND rf.name = 'Mukesh'),
    'RAW_MATERIAL',
    'fe45312e-d89e-4a74-8b50-45134981c2fc',
    NULL,
    250.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Gravy YM' AND rf.name = 'Mukesh'),
    'RAW_MATERIAL',
    '922631e1-8e6c-493f-a6de-5914f62f3d57',
    NULL,
    250.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    'f4e2d7c8-f128-4193-8023-986dacc3bcf1',
    NULL,
    10.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '755a7ffa-6cd8-4473-a4c2-b7bf7f324639',
    NULL,
    15.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '600450de-eae0-408f-9750-ecaf8ce29fe4',
    NULL,
    7.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '17b63426-a4df-45d6-8e7f-5d2ada864b75',
    NULL,
    16.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '0a79ec34-7012-4092-b26a-34daef57dda4',
    NULL,
    16.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '7a2cfd5d-bd3e-4abe-81a4-5491cb432c0a',
    NULL,
    100.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    'bc902c10-7abc-4695-8b37-1894a5c944a7',
    NULL,
    151.0000,
    'ml',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '6bbd5f9a-0b9b-42da-ae45-04c7054b423f',
    NULL,
    10.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '8be877ec-34ff-4eca-bc02-53f65e961ff5',
    NULL,
    111.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '0b48e22e-8628-48e9-8d65-11fd4f715a20',
    NULL,
    10.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '260e8503-82d6-499a-a088-791479e196cf',
    NULL,
    8.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '8cd5b91e-3293-4cac-af41-b8841363e717',
    NULL,
    1.0000,
    'chutki',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '5c8547e2-89d6-4bba-9779-16c8ae4ba003',
    NULL,
    1.0000,
    'chutki',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '9e80ab5c-c28d-4efc-9fe3-d95fd00284a1',
    NULL,
    1.0000,
    'chutki',
    NULL,
    13
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '49c23fc0-6011-4dbd-8ec9-87fde2dfeffa',
    NULL,
    1.0000,
    'chutki',
    NULL,
    14
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Kaushinder'),
    'RAW_MATERIAL',
    '8b8bab3f-aa43-4dee-997f-f4cf13e7a4a0',
    NULL,
    1.0000,
    'chutki',
    NULL,
    15
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Gatta Masala' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Gatta Gravy YM'),
    NULL,
    5.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Gatta Masala' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Gatta YM'),
    NULL,
    1.0000,
    'kg',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Gatta Masala' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0fd864d1-762a-4d9f-9fe4-a1906946f9ae',
    NULL,
    1.0000,
    'chutki',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Moongdal Halwa' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'a0652ab4-e2dc-4675-9c7c-1133d328543c',
    NULL,
    1.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Moongdal Halwa' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '96c3a3d6-216a-450d-9987-491891e60022',
    NULL,
    500.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Moongdal Halwa' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'aaea4b78-a158-4352-be38-dc2c83df198e',
    NULL,
    1100.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Moongdal Halwa' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '90b50b63-8cd8-4627-b0fc-6d753fd52b1a',
    NULL,
    1100.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Moongdal Halwa' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '7d6075b9-a9e9-414f-b90f-47a583d6b874',
    NULL,
    3.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Moongdal Halwa' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'aaea4b78-a158-4352-be38-dc2c83df198e',
    NULL,
    2.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani 2 YM'),
    NULL,
    320.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '6bbd5f9a-0b9b-42da-ae45-04c7054b423f',
    NULL,
    10.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8be877ec-34ff-4eca-bc02-53f65e961ff5',
    NULL,
    15.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Black Coffee' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'd87cf348-6828-4406-9a3b-ffd544bd3e04',
    NULL,
    5.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Ghee YM'),
    NULL,
    18.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0b48e22e-8628-48e9-8d65-11fd4f715a20',
    NULL,
    6.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8992d1e8-a6d2-4964-bd58-95dc4903a03c',
    NULL,
    4.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    6.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    10.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'fccaaa69-24ad-4e45-9a0f-a6f072207421',
    NULL,
    3.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ad4d5c99-692c-4b8e-a090-f088e5eb53df',
    NULL,
    1.0000,
    'chutki',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '1e8e3789-781d-4176-bff2-4aa4da3c3f64',
    NULL,
    200.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    1.0000,
    'chutki',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0fd864d1-762a-4d9f-9fe4-a1906946f9ae',
    NULL,
    2.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '6bbd5f9a-0b9b-42da-ae45-04c7054b423f',
    NULL,
    35.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '600450de-eae0-408f-9750-ecaf8ce29fe4',
    NULL,
    20.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0a79ec34-7012-4092-b26a-34daef57dda4',
    NULL,
    35.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '17b63426-a4df-45d6-8e7f-5d2ada864b75',
    NULL,
    35.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '755a7ffa-6cd8-4473-a4c2-b7bf7f324639',
    NULL,
    15.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0b48e22e-8628-48e9-8d65-11fd4f715a20',
    NULL,
    20.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '7a2cfd5d-bd3e-4abe-81a4-5491cb432c0a',
    NULL,
    150.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8be877ec-34ff-4eca-bc02-53f65e961ff5',
    NULL,
    100.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cd9b6808-b1b9-488f-86f1-071cacbac374',
    NULL,
    100.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'bee69833-07dd-43b8-963f-d32f36a2df1b',
    NULL,
    27.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '9e80ab5c-c28d-4efc-9fe3-d95fd00284a1',
    NULL,
    2.0000,
    'chutki',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '49c23fc0-6011-4dbd-8ec9-87fde2dfeffa',
    NULL,
    1.0000,
    'chutki',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0a9232d0-319b-474f-a575-82290d0c621b',
    NULL,
    8.6000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ad4d5c99-692c-4b8e-a090-f088e5eb53df',
    NULL,
    50.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b7ba95c3-df40-4487-b5e4-d1bf94dbcaec',
    NULL,
    110.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '1017f901-7330-413f-8224-fdb279e54727',
    NULL,
    160.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    157.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '978f8317-cb74-4bd1-a30d-be86ba1b2a01',
    NULL,
    30.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8228a706-6f5d-47c6-8a92-425f49b22f4b',
    NULL,
    30.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'a424af2b-07d6-4484-b27c-2490d3b8dac7',
    NULL,
    20.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    586.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Green Chilli Paste YM'),
    NULL,
    270.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cc1d4212-3e72-4d6d-bf39-8a289da5935a',
    NULL,
    59.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Gravy YM'),
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Gravy YM' AND rf.name = 'Mukesh'),
    1.1000,
    'kg',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '218ed3a3-3f1f-4d9b-80dd-ee189e136a11',
    NULL,
    100.0000,
    'g',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '7f4eca12-dbd4-4ac5-9b42-6c7270349d95',
    NULL,
    10.0000,
    'g',
    NULL,
    13
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    3.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    2.0000,
    'kg',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cc1d4212-3e72-4d6d-bf39-8a289da5935a',
    NULL,
    100.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    1.5000,
    'kg',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chopped Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    50.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Tomato Puree YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    1.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Tomato Puree YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '785c51cc-311a-4d05-bcd6-af64a2810be2',
    NULL,
    25.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Tomato Puree YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0b48e22e-8628-48e9-8d65-11fd4f715a20',
    NULL,
    25.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Tomato Puree YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cc1d4212-3e72-4d6d-bf39-8a289da5935a',
    NULL,
    1.0000,
    'chutki',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun Prep' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '96c3a3d6-216a-450d-9987-491891e60022',
    NULL,
    2.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun Prep' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'e8f28c53-698b-4d00-a208-a0650dec19b1',
    NULL,
    300.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun Prep' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '260e8503-82d6-499a-a088-791479e196cf',
    NULL,
    300.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun Prep' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'd9e318f2-ce71-496e-835b-563f200a8019',
    NULL,
    1.0000,
    'chutki',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun Prep' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    50.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun Prep' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Ghee YM'),
    NULL,
    700.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    250.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8992d1e8-a6d2-4964-bd58-95dc4903a03c',
    NULL,
    50.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Garlic Paste YM'),
    NULL,
    150.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    150.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ad4d5c99-692c-4b8e-a090-f088e5eb53df',
    NULL,
    30.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b7ba95c3-df40-4487-b5e4-d1bf94dbcaec',
    NULL,
    42.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    76.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '3f5b5029-e424-44aa-b27d-18e5ec29678c',
    NULL,
    20.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Panchmel YM'),
    NULL,
    4.0000,
    'kg',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    353.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'fccaaa69-24ad-4e45-9a0f-a6f072207421',
    NULL,
    10.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'a424af2b-07d6-4484-b27c-2490d3b8dac7',
    NULL,
    10.0000,
    'g',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '7f4eca12-dbd4-4ac5-9b42-6c7270349d95',
    NULL,
    6.0000,
    'g',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '90b50b63-8cd8-4627-b0fc-6d753fd52b1a',
    NULL,
    60.0000,
    'g',
    NULL,
    13
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Aloo Pyaaza Paneer ki Subzi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0f471f1b-8ee8-4ee4-8396-a386aeecc6b6',
    NULL,
    117.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Aloo Pyaaza Paneer ki Subzi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    61.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Aloo Pyaaza Paneer ki Subzi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'e8f28c53-698b-4d00-a208-a0650dec19b1',
    NULL,
    90.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Aloo Pyaaza Paneer ki Subzi' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Rajasthani Chopped Masala YM'),
    NULL,
    112.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Aloo Pyaaza Paneer ki Subzi' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Master Gravy YM'),
    NULL,
    125.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Aloo Pyaaza Paneer ki Subzi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0fd864d1-762a-4d9f-9fe4-a1906946f9ae',
    NULL,
    1.0000,
    'chutki',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'f632a5e0-c5e2-41f7-b1b3-b2fbc11d2710',
    NULL,
    3.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    400.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0c653a81-f6f2-41dd-86ef-8301f54b8342',
    NULL,
    1.5000,
    'kg',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Slice Cutting YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    500.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Slice Cutting YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '755a7ffa-6cd8-4473-a4c2-b7bf7f324639',
    NULL,
    400.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Slice Cutting YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    500.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Tawa Roti' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'de40e653-ad13-47fb-8201-1b7859cd47bf',
    NULL,
    1.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Tawa Roti' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    50.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Tawa Roti' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    20.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Boiled Vegetables YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'f1f42202-169e-47bf-8037-d01294b66573',
    NULL,
    2.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Boiled Vegetables YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '3596577d-7a5c-4957-8b24-247d1f6965a7',
    NULL,
    1.0000,
    'kg',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Boiled Vegetables YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5aa706cf-a871-4eba-b0a9-94c050a09c85',
    NULL,
    1.5000,
    'kg',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Salted Lassi' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Raita YM'),
    NULL,
    250.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '55de99f3-4305-47e1-bcb8-18f347fc073c',
    NULL,
    2.0000,
    'pcs',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '9d119989-f51e-4136-87a4-02eafeddbe1e',
    NULL,
    57.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    41.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    37.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Green Chutney'),
    NULL,
    15.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cdd69ad6-fcfe-4d05-a992-568baf755dab',
    NULL,
    34.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'f138bdb9-d926-4ef0-9b98-45b23d974325',
    NULL,
    50.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8a03313a-27cb-4575-a4ed-03f43549a02f',
    NULL,
    42.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg. Cheese Grilled Sandwich' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '6bbd5f9a-0b9b-42da-ae45-04c7054b423f',
    NULL,
    4.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5a8fa3b2-4a9d-4112-9915-3b9099b7672d',
    NULL,
    1.5000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'd9409318-85d0-4ef8-9eb3-9b84e3f04c09',
    NULL,
    600.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Rajputana Saag YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '61937a64-66c6-4cfb-92f5-4ab16074ef71',
    NULL,
    676.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'aaca0f17-d2e7-49b3-930d-e82862992047',
    NULL,
    643.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'a424af2b-07d6-4484-b27c-2490d3b8dac7',
    NULL,
    6.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '978f8317-cb74-4bd1-a30d-be86ba1b2a01',
    NULL,
    30.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0b48e22e-8628-48e9-8d65-11fd4f715a20',
    NULL,
    230.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    1.0000,
    'kg',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8992d1e8-a6d2-4964-bd58-95dc4903a03c',
    NULL,
    250.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    600.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '3f5b5029-e424-44aa-b27d-18e5ec29678c',
    NULL,
    23.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ad4d5c99-692c-4b8e-a090-f088e5eb53df',
    NULL,
    30.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '1017f901-7330-413f-8224-fdb279e54727',
    NULL,
    20.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    77.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b7ba95c3-df40-4487-b5e4-d1bf94dbcaec',
    NULL,
    30.0000,
    'g',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '7fe939ef-cab6-4ec9-8492-a892b3d22745',
    NULL,
    3.0000,
    'kg',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '42703f1e-abe8-4553-920d-f22d7799fc21',
    NULL,
    2.0000,
    'kg',
    NULL,
    13
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kair Sangri Prep' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ff582227-74e1-4a0d-9615-d8c4257c3798',
    NULL,
    1.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Green Chilli Paste YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8992d1e8-a6d2-4964-bd58-95dc4903a03c',
    NULL,
    100.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'fe45312e-d89e-4a74-8b50-45134981c2fc',
    NULL,
    500.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '922631e1-8e6c-493f-a6de-5914f62f3d57',
    NULL,
    500.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'e4db6c6e-ee62-406f-aaba-aa17424c4990',
    NULL,
    100.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '26a8c8d3-e87a-490e-81b9-f917b12f1b5b',
    NULL,
    200.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Ghee YM'),
    NULL,
    250.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    70.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cc1d4212-3e72-4d6d-bf39-8a289da5935a',
    NULL,
    60.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '1017f901-7330-413f-8224-fdb279e54727',
    NULL,
    32.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'd10a6a14-37bc-45e6-a7d3-2ff6ff40985b',
    NULL,
    20.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '3f5b5029-e424-44aa-b27d-18e5ec29678c',
    NULL,
    22.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '63a0a21b-a7d4-45a9-8d2b-822d8a51f19a',
    NULL,
    13.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Tomato Puree YM'),
    NULL,
    500.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'bc902c10-7abc-4695-8b37-1894a5c944a7',
    NULL,
    2.0000,
    'l',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Garlic Paste YM'),
    NULL,
    136.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Khada Masala YM'),
    NULL,
    50.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '73b17a79-f84e-4946-93ee-cf8652e5eb54',
    NULL,
    400.0000,
    'g',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '9e2ff2eb-0473-4215-a63f-21f6891ae3a9',
    NULL,
    1.0000,
    'kg',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani 2 YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '755c2f2f-b662-4c36-8d05-6da891d5f234',
    NULL,
    400.0000,
    'g',
    NULL,
    13
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Khada Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '6b0a6cb3-f656-4721-942f-81787ce6c2c8',
    NULL,
    50.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Khada Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'd9e318f2-ce71-496e-835b-563f200a8019',
    NULL,
    40.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Khada Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b97fd639-3a46-4d15-afbd-0db3b589a88a',
    NULL,
    70.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Khada Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '7d6075b9-a9e9-414f-b90f-47a583d6b874',
    NULL,
    40.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Khada Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'e2e32863-d07e-4b97-a065-607ad477766e',
    NULL,
    100.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Khada Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'a35d4f0d-6f35-43bd-a6ed-dadde76a030f',
    NULL,
    80.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Khada Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ae105509-8bff-49ea-aacf-0f93894591d2',
    NULL,
    50.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Khada Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '78e5a6a2-8555-41de-90e1-0488d3eb4419',
    NULL,
    70.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Khada Masala YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'd3025d8c-f347-444b-8b42-54004271d695',
    NULL,
    50.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    '55de99f3-4305-47e1-bcb8-18f347fc073c',
    NULL,
    112.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    '9d119989-f51e-4136-87a4-02eafeddbe1e',
    NULL,
    30.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    'cdd69ad6-fcfe-4d05-a992-568baf755dab',
    NULL,
    40.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    30.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    20.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    '755a7ffa-6cd8-4473-a4c2-b7bf7f324639',
    NULL,
    21.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    '8a03313a-27cb-4575-a4ed-03f43549a02f',
    NULL,
    27.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    'be417ca0-b52d-4151-8f14-b3ce84556272',
    NULL,
    1.0000,
    'chutki',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    '3f5b5029-e424-44aa-b27d-18e5ec29678c',
    NULL,
    1.0000,
    'chutki',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    '8cd5b91e-3293-4cac-af41-b8841363e717',
    NULL,
    1.0000,
    'chutki',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    '5c8547e2-89d6-4bba-9779-16c8ae4ba003',
    NULL,
    1.0000,
    'chutki',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND rf.name = 'Chef Version 2'),
    'RAW_MATERIAL',
    '642353fb-3e9c-43e9-997b-4c43132764e7',
    NULL,
    1.0000,
    'chutki',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kadhai Paneer YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    2.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kadhai Paneer YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '755a7ffa-6cd8-4473-a4c2-b7bf7f324639',
    NULL,
    1.5000,
    'kg',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kadhai Paneer YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    1.0000,
    'kg',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kadhai Paneer YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    800.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kadhai Paneer YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cc1d4212-3e72-4d6d-bf39-8a289da5935a',
    NULL,
    70.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Kadhai Paneer YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    50.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Pasta Vegetables Mix YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0a79ec34-7012-4092-b26a-34daef57dda4',
    NULL,
    100.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Pasta Vegetables Mix YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '17b63426-a4df-45d6-8e7f-5d2ada864b75',
    NULL,
    50.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Pasta Vegetables Mix YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'f4e2d7c8-f128-4193-8023-986dacc3bcf1',
    NULL,
    50.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Pasta Vegetables Mix YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '673b81de-be8c-4d49-aaa7-a778184b951c',
    NULL,
    50.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Pasta Vegetables Mix YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '600450de-eae0-408f-9750-ecaf8ce29fe4',
    NULL,
    50.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '03cd532e-5535-4e33-8a03-1a9ccd0166b4',
    NULL,
    24.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cd74b28a-ec93-4650-accd-c27d221656cf',
    NULL,
    37.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'be417ca0-b52d-4151-8f14-b3ce84556272',
    NULL,
    2.0000,
    'chutki',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '6ab71f7d-f397-4fd9-ba5e-56945434d6c3',
    NULL,
    50.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '99a207f9-f1af-46c2-8755-d7b1135eb1cc',
    NULL,
    112.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cd00861f-0f0d-448e-809c-6c0645dfe7df',
    NULL,
    3.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0fd864d1-762a-4d9f-9fe4-a1906946f9ae',
    NULL,
    1.0000,
    'chutki',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '2d2aef09-2a32-42d3-99fe-f57340f3b82a',
    NULL,
    112.0000,
    'ml',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0a9232d0-319b-474f-a575-82290d0c621b',
    NULL,
    5.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b4c96333-6a97-47c4-a241-5b180aa7cff4',
    NULL,
    500.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8992d1e8-a6d2-4964-bd58-95dc4903a03c',
    NULL,
    200.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8228a706-6f5d-47c6-8a92-425f49b22f4b',
    NULL,
    30.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'f9506a5a-f48f-4708-8191-288504c30802',
    NULL,
    20.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'a35d4f0d-6f35-43bd-a6ed-dadde76a030f',
    NULL,
    20.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ae105509-8bff-49ea-aacf-0f93894591d2',
    NULL,
    5.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ff4c6012-4b48-4d86-8ab4-e482623eaba6',
    NULL,
    2.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5cb77ed5-702f-4827-86ce-faaf4dd0c985',
    NULL,
    5.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'e2e32863-d07e-4b97-a065-607ad477766e',
    NULL,
    5.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '90b50b63-8cd8-4627-b0fc-6d753fd52b1a',
    NULL,
    250.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    250.0000,
    'g',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ad4d5c99-692c-4b8e-a090-f088e5eb53df',
    NULL,
    50.0000,
    'g',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'a424af2b-07d6-4484-b27c-2490d3b8dac7',
    NULL,
    100.0000,
    'g',
    NULL,
    13
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    250.0000,
    'g',
    NULL,
    14
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '7cfe43f4-efe9-44d5-a29d-ab8a29e8e373',
    NULL,
    2.0000,
    'g',
    NULL,
    15
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'd859ccd0-91ee-4dca-8adb-3af8ebef0a93',
    NULL,
    100.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chopped Masala YM'),
    NULL,
    60.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Ghee YM'),
    NULL,
    8.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Garlic Paste YM'),
    NULL,
    10.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8be877ec-34ff-4eca-bc02-53f65e961ff5',
    NULL,
    4.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    2.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cc1d4212-3e72-4d6d-bf39-8a289da5935a',
    NULL,
    0.1765,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Cooked Rice' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0c163828-ec34-432e-a439-27505c460178',
    NULL,
    100.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Papad' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8d6e2fa8-1d53-43fa-9e5b-f94d7814031b',
    NULL,
    15.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Raita YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0a9232d0-319b-474f-a575-82290d0c621b',
    NULL,
    5.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Raita YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'fccaaa69-24ad-4e45-9a0f-a6f072207421',
    NULL,
    5.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Raita YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'be417ca0-b52d-4151-8f14-b3ce84556272',
    NULL,
    13.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Raita YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '00025231-2342-432b-94eb-384a64193800',
    NULL,
    70.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mawa Churma YM'),
    NULL,
    56.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '90b50b63-8cd8-4627-b0fc-6d753fd52b1a',
    NULL,
    12.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '1bbaa2dd-e78f-49d9-b1bd-1265d052c4f8',
    NULL,
    2.0000,
    'chutki',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '7d6075b9-a9e9-414f-b90f-47a583d6b874',
    NULL,
    1.0000,
    'chutki',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'aaea4b78-a158-4352-be38-dc2c83df198e',
    NULL,
    0.5000,
    'chutki',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Master Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    5.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Master Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    3.0000,
    'kg',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Master Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '922631e1-8e6c-493f-a6de-5914f62f3d57',
    NULL,
    400.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Master Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'fe45312e-d89e-4a74-8b50-45134981c2fc',
    NULL,
    500.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Master Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8992d1e8-a6d2-4964-bd58-95dc4903a03c',
    NULL,
    100.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Master Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cc1d4212-3e72-4d6d-bf39-8a289da5935a',
    NULL,
    50.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Master Gravy YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '785c51cc-311a-4d05-bcd6-af64a2810be2',
    NULL,
    50.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '1e8e3789-781d-4176-bff2-4aa4da3c3f64',
    NULL,
    400.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '73b17a79-f84e-4946-93ee-cf8652e5eb54',
    NULL,
    200.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'a765fda0-8255-4110-af8b-489aa4de7be4',
    NULL,
    200.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'a0652ab4-e2dc-4675-9c7c-1133d328543c',
    NULL,
    200.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    '6bbd5f9a-0b9b-42da-ae45-04c7054b423f',
    NULL,
    15.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    '260e8503-82d6-499a-a088-791479e196cf',
    NULL,
    10.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    '0b48e22e-8628-48e9-8d65-11fd4f715a20',
    NULL,
    10.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    'bc902c10-7abc-4695-8b37-1894a5c944a7',
    NULL,
    170.0000,
    'ml',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Pasta Vegetables Mix YM'),
    NULL,
    60.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    '7a2cfd5d-bd3e-4abe-81a4-5491cb432c0a',
    NULL,
    200.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    '8be877ec-34ff-4eca-bc02-53f65e961ff5',
    NULL,
    50.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    7.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    '49c23fc0-6011-4dbd-8ec9-87fde2dfeffa',
    NULL,
    6.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    '5c8547e2-89d6-4bba-9779-16c8ae4ba003',
    NULL,
    2.0000,
    'chutki',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    'aaea4b78-a158-4352-be38-dc2c83df198e',
    NULL,
    8.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    '8cd5b91e-3293-4cac-af41-b8841363e717',
    NULL,
    1.0000,
    'chutki',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    '9e80ab5c-c28d-4efc-9fe3-d95fd00284a1',
    NULL,
    2.0000,
    'g',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND rf.name = 'Sumit'),
    'RAW_MATERIAL',
    'bee69833-07dd-43b8-963f-d32f36a2df1b',
    NULL,
    23.0000,
    'g',
    NULL,
    13
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '73b17a79-f84e-4946-93ee-cf8652e5eb54',
    NULL,
    400.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '9e2ff2eb-0473-4215-a63f-21f6891ae3a9',
    NULL,
    1.0000,
    'kg',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '755c2f2f-b662-4c36-8d05-6da891d5f234',
    NULL,
    400.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b4c96333-6a97-47c4-a241-5b180aa7cff4',
    NULL,
    1.0000,
    'kg',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '95a1ede5-2bdc-4765-87be-c1f999ccbe84',
    NULL,
    350.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '978f8317-cb74-4bd1-a30d-be86ba1b2a01',
    NULL,
    10.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8228a706-6f5d-47c6-8a92-425f49b22f4b',
    NULL,
    10.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'f9506a5a-f48f-4708-8191-288504c30802',
    NULL,
    10.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '7f4eca12-dbd4-4ac5-9b42-6c7270349d95',
    NULL,
    2.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b7ba95c3-df40-4487-b5e4-d1bf94dbcaec',
    NULL,
    30.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'ad4d5c99-692c-4b8e-a090-f088e5eb53df',
    NULL,
    20.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    50.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gatta YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '889f7bf7-8aeb-4194-bf02-e16ebac0a5dd',
    NULL,
    2.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Salad' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cd00861f-0f0d-448e-809c-6c0645dfe7df',
    NULL,
    4.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Salad' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'cdd69ad6-fcfe-4d05-a992-568baf755dab',
    NULL,
    18.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Salad' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5aa706cf-a871-4eba-b0a9-94c050a09c85',
    NULL,
    18.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Garlic Paste YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0b48e22e-8628-48e9-8d65-11fd4f715a20',
    NULL,
    250.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Garlic Paste YM' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '785c51cc-311a-4d05-bcd6-af64a2810be2',
    NULL,
    250.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani 2 YM'),
    NULL,
    184.7000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '6bbd5f9a-0b9b-42da-ae45-04c7054b423f',
    NULL,
    5.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '8be877ec-34ff-4eca-bc02-53f65e961ff5',
    NULL,
    5.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Boiled Vegetables YM'),
    NULL,
    188.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    'e8f28c53-698b-4d00-a208-a0650dec19b1',
    NULL,
    36.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    '0b48e22e-8628-48e9-8d65-11fd4f715a20',
    NULL,
    15.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    '8992d1e8-a6d2-4964-bd58-95dc4903a03c',
    NULL,
    3.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chopped Masala YM'),
    NULL,
    58.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Master Gravy YM'),
    NULL,
    40.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Ghee YM'),
    NULL,
    13.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    'fccaaa69-24ad-4e45-9a0f-a6f072207421',
    NULL,
    1.0000,
    'chutki',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    'ad4d5c99-692c-4b8e-a090-f088e5eb53df',
    NULL,
    1.0000,
    'chutki',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    1.0000,
    'chutki',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    'b7ba95c3-df40-4487-b5e4-d1bf94dbcaec',
    NULL,
    1.0000,
    'chutki',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    '1017f901-7330-413f-8224-fdb279e54727',
    NULL,
    1.0000,
    'chutki',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    'd10a6a14-37bc-45e6-a7d3-2ff6ff40985b',
    NULL,
    1.0000,
    'chutki',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    '3f5b5029-e424-44aa-b27d-18e5ec29678c',
    NULL,
    2.0000,
    'chutki',
    NULL,
    13
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    '1017f901-7330-413f-8224-fdb279e54727',
    NULL,
    1.0000,
    'chutki',
    NULL,
    14
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    'b7ba95c3-df40-4487-b5e4-d1bf94dbcaec',
    NULL,
    1.0000,
    'chutki',
    NULL,
    15
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Bhrampal'),
    'RAW_MATERIAL',
    '8be877ec-34ff-4eca-bc02-53f65e961ff5',
    NULL,
    22.0000,
    'g',
    NULL,
    16
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Tikka Pizza' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '98f5513f-7a24-4a09-96f5-aeac3f265133',
    NULL,
    1.0000,
    'pcs',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Tikka Pizza' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '3036b75c-8d92-4922-a8fb-d200456e2b91',
    NULL,
    20.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Tikka Pizza' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '5ad4ade2-4307-4020-9d9f-b54931d6a3b1',
    NULL,
    25.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Tikka Pizza' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    25.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Tikka Pizza' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    '755a7ffa-6cd8-4473-a4c2-b7bf7f324639',
    NULL,
    25.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Tikka Pizza' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'b93c2a69-5343-42ad-8978-7622eb11834e',
    NULL,
    50.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Paneer Tikka Pizza' AND rf.name = 'Standard'),
    'RAW_MATERIAL',
    'e8f28c53-698b-4d00-a208-a0650dec19b1',
    NULL,
    35.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chopped Masala YM'),
    NULL,
    60.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Ghee YM'),
    NULL,
    12.0000,
    'g',
    NULL,
    1
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '0b48e22e-8628-48e9-8d65-11fd4f715a20',
    NULL,
    7.0000,
    'g',
    NULL,
    2
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '8992d1e8-a6d2-4964-bd58-95dc4903a03c',
    NULL,
    4.0000,
    'g',
    NULL,
    3
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '0906d38b-44d1-4a0d-ad54-319f3f084e40',
    NULL,
    25.0000,
    'g',
    NULL,
    4
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '5bdf4991-21ce-4cf6-9a63-0c514fa43c0f',
    NULL,
    15.0000,
    'g',
    NULL,
    5
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '404199be-527c-4304-a748-f4f64c4fa6b2',
    NULL,
    25.0000,
    'g',
    NULL,
    6
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Boiled Vegetables YM'),
    NULL,
    80.0000,
    'g',
    NULL,
    7
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '96c3a3d6-216a-450d-9987-491891e60022',
    NULL,
    15.0000,
    'g',
    NULL,
    8
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '8be877ec-34ff-4eca-bc02-53f65e961ff5',
    NULL,
    13.0000,
    'g',
    NULL,
    9
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    'bee69833-07dd-43b8-963f-d32f36a2df1b',
    NULL,
    13.0000,
    'g',
    NULL,
    10
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Master Gravy YM'),
    NULL,
    100.0000,
    'g',
    NULL,
    11
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    'e8f28c53-698b-4d00-a208-a0650dec19b1',
    NULL,
    20.0000,
    'g',
    NULL,
    12
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '0fd864d1-762a-4d9f-9fe4-a1906946f9ae',
    NULL,
    4.0000,
    'g',
    NULL,
    13
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '56fd15e1-a21e-4089-866a-a76071bc120b',
    NULL,
    1.0000,
    'chutki',
    NULL,
    14
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    'ad4d5c99-692c-4b8e-a090-f088e5eb53df',
    NULL,
    1.0000,
    'chutki',
    NULL,
    15
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    'b7ba95c3-df40-4487-b5e4-d1bf94dbcaec',
    NULL,
    1.0000,
    'chutki',
    NULL,
    16
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    'cc1d4212-3e72-4d6d-bf39-8a289da5935a',
    NULL,
    1.0000,
    'chutki',
    NULL,
    17
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '1017f901-7330-413f-8224-fdb279e54727',
    NULL,
    1.0000,
    'chutki',
    NULL,
    18
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '3f5b5029-e424-44aa-b27d-18e5ec29678c',
    NULL,
    1.0000,
    'chutki',
    NULL,
    19
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '63a0a21b-a7d4-45a9-8d2b-822d8a51f19a',
    NULL,
    1.0000,
    'chutki',
    NULL,
    20
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, ingredient_group_id, inventory_item_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND rf.name = 'Deepak'),
    'RAW_MATERIAL',
    '7f4eca12-dbd4-4ac5-9b42-6c7270349d95',
    NULL,
    1.0000,
    'chutki',
    NULL,
    21
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chasni'),
    NULL,
    25.0000,
    'g',
    NULL,
    0
  );

  INSERT INTO public.yatra_recipe_formulation_ingredients (
    formulation_id, ingredient_type, sub_preparation_dish_id, sub_preparation_formulation_id,
    quantity, unit, notes, sort_order
  ) VALUES (
    (SELECT rf.id FROM public.yatra_recipe_formulations rf JOIN public.yatra_canonical_dishes d ON rf.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun' AND rf.name = 'Standard'),
    'PREPARATION',
    (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Gulab Jamun Prep'),
    NULL,
    25.0000,
    'g',
    NULL,
    1
  );

  -- ==========================================================================
  -- 11. Seed Combo Compositions (Chhole Rice & Dal Makhani Rice)
  -- ==========================================================================
  -- Chhole Rice Components
  INSERT INTO public.yatra_menu_item_compositions (menu_item_id, component_dish_id, serving_configuration_id, quantity, sort_order)
  VALUES
    ('10395494-24d8-478d-9f03-2779f0756111',
     (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Chhole'),
     (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Chhole' AND sc.name = 'Combo (200g)'),
     1, 1),
    ('10395494-24d8-478d-9f03-2779f0756111',
     (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Cooked Rice'),
     (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Cooked Rice' AND sc.name = 'Combo (160g)'),
     1, 2),
    ('10395494-24d8-478d-9f03-2779f0756111',
     (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Salad'),
     (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Salad' AND sc.name = 'Combo (40g)'),
     1, 3)
  ON CONFLICT (menu_item_id, sort_order) DO UPDATE SET
    component_dish_id = EXCLUDED.component_dish_id,
    serving_configuration_id = EXCLUDED.serving_configuration_id,
    quantity = EXCLUDED.quantity,
    updated_at = now();

  -- Dal Makhani Rice Components
  INSERT INTO public.yatra_menu_item_compositions (menu_item_id, component_dish_id, serving_configuration_id, quantity, sort_order)
  VALUES
    ('67a2c221-2d2d-4c9f-bbe3-7195d2812f10',
     (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani'),
     (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND sc.name = 'Combo (200g)'),
     1, 1),
    ('67a2c221-2d2d-4c9f-bbe3-7195d2812f10',
     (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Cooked Rice'),
     (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Cooked Rice' AND sc.name = 'Combo (160g)'),
     1, 2),
    ('67a2c221-2d2d-4c9f-bbe3-7195d2812f10',
     (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Salad'),
     (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Salad' AND sc.name = 'Combo (40g)'),
     1, 3)
  ON CONFLICT (menu_item_id, sort_order) DO UPDATE SET
    component_dish_id = EXCLUDED.component_dish_id,
    serving_configuration_id = EXCLUDED.serving_configuration_id,
    quantity = EXCLUDED.quantity,
    updated_at = now();

  -- ==========================================================================
  -- 12. Link POS Menu Items to Canonical Dishes & Configurations
  -- ==========================================================================

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Sarson Ka Saag'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Sarson Ka Saag' AND sc.name = 'A La Carte (372g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '5d2c8278-3a7b-45d2-8d94-1bdeb550e031';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Jodhpuri Kadhi'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Kadhi' AND sc.name = 'A La Carte (370g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = 'c29e04df-86e2-496b-b8ed-1b09610834fa';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mix Veg'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Mix Veg' AND sc.name = 'A La Carte (350g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = 'f9dc4f32-4b95-4ef2-bb75-9c8be31acc8b';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mawa Churma'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Mawa Churma' AND sc.name = 'Portion (65g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '14548fbd-7249-4b45-b505-e1173029934e';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Moongdal Halwa'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Moongdal Halwa' AND sc.name = 'Portion (120g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '0d84bc50-2522-4761-8e09-21588cc4d4a8';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Papad'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Papad' AND sc.name = 'Standard (15g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '4d189a91-828c-4cd0-974f-92cbcd63f598';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Paneer Tikka Pizza'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Paneer Tikka Pizza' AND sc.name = 'Standard (300g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = 'f47fe8f4-53c3-49be-a2bc-d40283ce1ab7';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Kaju Curry'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Kaju Curry' AND sc.name = 'A La Carte (350g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '17bab1cc-4500-49e3-914d-668ad4acc171';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Veg Sandwich'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Veg Sandwich' AND sc.name = 'Standard (293g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = 'f7c72c49-7050-4946-a62b-a5c8ca1057c2';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Makhani'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Dal Makhani' AND sc.name = 'A La Carte (340g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '2c7b7b9f-34ab-4cdc-82eb-9d08c2477cda';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Aloo Pyaaza Paneer ki Subzi'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Aloo Pyaaza Paneer ki Subzi' AND sc.name = 'A La Carte (436g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '453ea5df-420c-4b8f-8890-07f67524cd04';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Mint Mojito'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Mint Mojito' AND sc.name = 'Standard (1 pcs)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = 'bfe4155c-cc81-491a-82fe-4aaa8ab637d5';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Fry'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Dal Fry' AND sc.name = 'A La Carte (317g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '3f6d0575-3087-4c8e-90fb-4290d1ab3cae';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'White Sauce Pasta'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'White Sauce Pasta' AND sc.name = 'A La Carte (366g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = 'abcbc35c-eed5-4866-b00d-cb5162d23e17';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Paneer Sandwich'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Paneer Sandwich' AND sc.name = 'Standard (261g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '07959f29-8c10-4942-8b03-934d00c198c3';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Gulab Jamun'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Gulab Jamun' AND sc.name = 'Standard (1 pcs)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '3f129d7f-4c81-4fbd-ad51-6fa85e3ef8d6';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Black Coffee'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Black Coffee' AND sc.name = 'Standard (200g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = 'c887dee0-06a9-43bd-ae31-062ddcd041a3';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Jodhpuri Gatta Masala'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Jodhpuri Gatta Masala' AND sc.name = 'A La Carte (350g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '5c6a8559-1126-4218-a840-466b9680595e';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Tawa Roti'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Tawa Roti' AND sc.name = '1 Piece (1 pcs)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '70e826de-6edb-4560-879d-7e9f7cc65136';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Red Sauce Pasta'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Red Sauce Pasta' AND sc.name = 'A La Carte (456g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '4f48ca24-0ecb-47fd-b81e-b81c1879fda6';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Salted Lassi'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Salted Lassi' AND sc.name = 'Standard (300g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '46b2898e-de4a-4717-b4d8-77251f7118ab';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Handi Paneer'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Handi Paneer' AND sc.name = 'A La Carte (370g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = 'c2d3dca1-6a6c-4a39-8399-dad563f3e565';

  UPDATE public.pos_menu_items
  SET
    canonical_dish_id = (SELECT id FROM public.yatra_canonical_dishes WHERE name = 'Dal Panchmel'),
    serving_configuration_id = (SELECT sc.id FROM public.yatra_serving_configurations sc JOIN public.yatra_canonical_dishes d ON sc.canonical_dish_id = d.id WHERE d.name = 'Dal Panchmel' AND sc.name = 'A La Carte (342g)'),
    product_type = 'INDIVIDUAL_DISH',
    updated_at = now()
  WHERE id = '04488937-6403-43a1-8db9-a97ffb798272';

  -- 13. Full Post-Migration Reconciliation Assertion (Section 7.1)
  FOR v_rec IN
    SELECT
      p.name AS menu_name,
      d.name AS component_dish,
      sc.name AS config_name,
      (c.quantity * sc.portion_size_quantity) AS effective_weight_g
    FROM public.yatra_menu_item_compositions c
    JOIN public.pos_menu_items p ON c.menu_item_id = p.id
    JOIN public.yatra_canonical_dishes d ON c.component_dish_id = d.id
    JOIN public.yatra_serving_configurations sc ON c.serving_configuration_id = sc.id
    WHERE c.menu_item_id IN ('10395494-24d8-478d-9f03-2779f0756111', '67a2c221-2d2d-4c9f-bbe3-7195d2812f10')
    ORDER BY c.menu_item_id, c.sort_order
  LOOP
    IF v_rec.effective_weight_g NOT IN (200, 160, 40) THEN
      RAISE EXCEPTION 'Reconciliation failed: unexpected effective portion weight % for % in %',
        v_rec.effective_weight_g, v_rec.component_dish, v_rec.menu_name;
    END IF;
  END LOOP;
END;
$$;
