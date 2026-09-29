/**
 * Authoritative Petpooja Menu Master & Category Matching Engine
 * 
 * Maps Petpooja sales item names to canonical Menu Master items,
 * resolving both the granular Category and the management Parent Category
 * driven directly by the database configuration.
 */

export const CATEGORY_TO_PARENT_MAP: Record<string, string> = {
  // All Day Breakfast
  'parantha favourites': 'All Day Breakfast',
  'classic sandwiches': 'All Day Breakfast',

  // Beverages
  'classic beverages': 'Beverages',
  'mocktails': 'Beverages',
  'milkshakes': 'Beverages',
  'soups': 'Beverages',

  // Soya Specials
  'soya specials starters': 'Soya Specials',
  'soya specials main course': 'Soya Specials',

  // Italian
  'pizza': 'Italian',
  'pasta': 'Italian',
  'garlic bread': 'Italian',

  // Chinese
  'chinese starters': 'Chinese',
  'chinese main course': 'Chinese',
  'chinese noodles & rice': 'Chinese',

  // Rajasthani (Dedicated Parent Category)
  'rajasthani specialities': 'Rajasthani',
  'rajasthani specilities': 'Rajasthani', // legacy typo compatibility

  // Main Course
  'others': 'Main Course',

  // Indian
  'indian starter': 'Indian',
  'paneer preprations': 'Indian',
  'subziyon ki bahaar': 'Indian',
  'dal': 'Indian',
  'rice': 'Indian',
  'roti': 'Indian',
  'raita': 'Indian',
  'papad': 'Indian',
  'salad': 'Indian',
  'dessert': 'Indian',
  'thali': 'Indian',
};

/**
 * Resolves the parent category for a given category name.
 * Uses dynamic categories map if provided, otherwise falls back to static dictionary.
 */
export function resolveParentCategory(
  category: string,
  existingParent?: string | null,
  dynamicCategoryMap?: Map<string, string>
): string {
  if (existingParent && existingParent.trim() && existingParent.trim() !== 'Uncategorized') {
    return existingParent.trim();
  }
  const cleanCat = (category || '').toLowerCase().trim();
  if (dynamicCategoryMap && dynamicCategoryMap.has(cleanCat)) {
    return dynamicCategoryMap.get(cleanCat)!;
  }
  return CATEGORY_TO_PARENT_MAP[cleanCat] || 'Uncategorized';
}

/**
 * Deterministic normalization for item names.
 * Handles:
 * - Leading / trailing whitespace
 * - Removal of POS order-type tags: [D] (Dine-in), [T] (Takeaway), [Delivery]
 * - Harmless abbreviation differences like "Veg." -> "Veg"
 * - Case-folding (lowercase)
 * - Punctuation normalization ([._\-] -> ' ')
 * - Collapsing multiple whitespace runs to single space
 */
export function normalizeItemName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    // Strip trailing POS service tags e.g. "Dal Makhani [D]" -> "Dal Makhani"
    .replace(/\s*\[(?:d|t|delivery)\]\s*$/i, '')
    // Normalize "Veg." -> "veg"
    .replace(/\bveg\.\b/gi, 'veg')
    // Lowercase
    .toLowerCase()
    // Harmless punctuation to space
    .replace(/[._\-]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MenuItemMapping {
  id?: string;
  name: string;
  category: string;
  parentCategory: string;
  price?: number;
  needsSetup?: boolean;
}

export interface CategoryResolutionResult {
  category: string;
  parentCategory: string;
  isMatched: boolean;
  matchedItemName?: string;
  matchedItemId?: string;
  matchType?: 'exact' | 'normalized' | 'alias' | 'none';
}

/**
 * Match lookup tables built from the database Menu Master (pos_menu_items + pos_menu_item_aliases)
 */
export interface MenuMasterLookup {
  exactMap: Map<string, MenuItemMapping>;
  normalizedMap: Map<string, MenuItemMapping>;
  aliasMap: Map<string, MenuItemMapping>;
  categoryToParentMap: Map<string, string>;
}

/**
 * Builds fast lookup maps from pos_menu_items, pos_menu_item_aliases, and pos_categories.
 * Prioritizes configured canonical items so unconfigured Needs Setup records never shadow canonical items.
 */
export function buildMenuMasterLookup(
  menuItems: Array<{
    id?: string;
    name: string;
    category: string;
    parent_category: string;
    price?: number;
    normalized_name?: string | null;
    needs_setup?: boolean | null;
  }>,
  aliases?: Array<{
    alias: string;
    normalized_alias?: string | null;
    menu_item_id: string;
    pos_menu_items?: {
      id?: string;
      name: string;
      category: string;
      parent_category: string;
      price?: number;
      needs_setup?: boolean | null;
    } | null;
  }>,
  dbCategories?: Array<{
    name: string;
    parent_category_name: string;
  }>
): MenuMasterLookup {
  const exactMap = new Map<string, MenuItemMapping>();
  const normalizedMap = new Map<string, MenuItemMapping>();
  const aliasMap = new Map<string, MenuItemMapping>();
  const categoryToParentMap = new Map<string, string>();

  // 1. Populate category to parent from database if provided
  (dbCategories || []).forEach((c) => {
    categoryToParentMap.set(c.name.toLowerCase().trim(), c.parent_category_name);
  });

  // 2. Partition into configured canonical items vs unconfigured Needs Setup records
  const canonicalItems: typeof menuItems = [];
  const uncategorizedItems: typeof menuItems = [];

  (menuItems || []).forEach((m) => {
    const isUnconfigured = Boolean(m.needs_setup) || !m.category || m.category === 'Uncategorized';
    if (isUnconfigured) {
      uncategorizedItems.push(m);
    } else {
      canonicalItems.push(m);
    }
  });

  // Index canonical items FIRST (authoritative)
  canonicalItems.forEach((m) => {
    const parentCat = resolveParentCategory(m.category, m.parent_category, categoryToParentMap);
    const itemData: MenuItemMapping = {
      id: m.id,
      name: m.name,
      category: m.category,
      parentCategory: parentCat,
      price: m.price ? Number(m.price) : undefined,
      needsSetup: false,
    };

    exactMap.set(m.name, itemData);
    exactMap.set(m.name.toLowerCase().trim(), itemData);

    const norm = m.normalized_name || normalizeItemName(m.name);
    normalizedMap.set(norm, itemData);
  });

  // Index unconfigured items only where slot is free
  uncategorizedItems.forEach((m) => {
    const parentCat = resolveParentCategory(m.category, m.parent_category, categoryToParentMap);
    const itemData: MenuItemMapping = {
      id: m.id,
      name: m.name,
      category: m.category || 'Uncategorized',
      parentCategory: parentCat,
      price: m.price ? Number(m.price) : undefined,
      needsSetup: true,
    };

    if (!exactMap.has(m.name)) exactMap.set(m.name, itemData);
    if (!exactMap.has(m.name.toLowerCase().trim())) exactMap.set(m.name.toLowerCase().trim(), itemData);

    const norm = m.normalized_name || normalizeItemName(m.name);
    if (!normalizedMap.has(norm)) normalizedMap.set(norm, itemData);
  });

  // 3. Populate aliases
  (aliases || []).forEach((a) => {
    if (a.pos_menu_items) {
      const parentCat = resolveParentCategory(
        a.pos_menu_items.category,
        a.pos_menu_items.parent_category,
        categoryToParentMap
      );
      const itemData: MenuItemMapping = {
        id: a.pos_menu_items.id || a.menu_item_id,
        name: a.pos_menu_items.name,
        category: a.pos_menu_items.category,
        parentCategory: parentCat,
        price: a.pos_menu_items.price ? Number(a.pos_menu_items.price) : undefined,
        needsSetup: Boolean(a.pos_menu_items.needs_setup),
      };
      aliasMap.set(a.alias, itemData);
      aliasMap.set(a.alias.toLowerCase().trim(), itemData);

      const normAlias = a.normalized_alias || normalizeItemName(a.alias);
      aliasMap.set(normAlias, itemData);
    }
  });

  return { exactMap, normalizedMap, aliasMap, categoryToParentMap };
}

/**
 * Loads the complete Menu Master lookup directly from the database tables.
 */
export async function loadMenuMasterLookupFromDb(supabase: any): Promise<MenuMasterLookup> {
  const [
    { data: categories },
    { data: menuItems },
    { data: aliases },
  ] = await Promise.all([
    supabase.from('pos_categories').select('name, parent_category_name').eq('is_active', true),
    supabase.from('pos_menu_items').select('id, name, parent_category, category, price, normalized_name, needs_setup').eq('is_active', true),
    supabase.from('pos_menu_item_aliases').select('alias, normalized_alias, menu_item_id, pos_menu_items(id, name, category, parent_category, price, needs_setup)'),
  ]);

  return buildMenuMasterLookup(menuItems || [], (aliases as any) || [], categories || []);
}

/**
 * Matches an incoming Petpooja item_name according to strict priority:
 * 1. Exact match on raw item name
 * 2. Normalized match on normalizeItemName(rawName)
 * 3. Authoritative alias match
 * 4. Fallback: Uncategorized (never guess or invent)
 */
export function resolveItemCategory(
  rawItemName: string,
  lookup: MenuMasterLookup
): CategoryResolutionResult {
  if (!rawItemName || !rawItemName.trim()) {
    return {
      category: 'Uncategorized',
      parentCategory: 'Uncategorized',
      isMatched: false,
      matchType: 'none',
    };
  }

  const cleanRaw = rawItemName.trim();
  const lowerRaw = cleanRaw.toLowerCase();
  const norm = normalizeItemName(cleanRaw);

  // Priority 1: Exact item-name match on configured canonical item
  const exactMatch = lookup.exactMap.get(cleanRaw) || lookup.exactMap.get(lowerRaw);
  if (exactMatch && !exactMatch.needsSetup && exactMatch.category !== 'Uncategorized') {
    return {
      category: exactMatch.category,
      parentCategory: exactMatch.parentCategory,
      isMatched: true,
      matchedItemName: exactMatch.name,
      matchedItemId: exactMatch.id,
      matchType: 'exact',
    };
  }

  // Priority 2: Normalized item-name match on configured canonical item
  const normMatch = lookup.normalizedMap.get(norm);
  if (normMatch && !normMatch.needsSetup && normMatch.category !== 'Uncategorized') {
    return {
      category: normMatch.category,
      parentCategory: normMatch.parentCategory,
      isMatched: true,
      matchedItemName: normMatch.name,
      matchedItemId: normMatch.id,
      matchType: 'normalized',
    };
  }

  // Priority 3: Authoritative alias mapping
  const aliasMatch = lookup.aliasMap.get(cleanRaw) || lookup.aliasMap.get(lowerRaw) || lookup.aliasMap.get(norm);
  if (aliasMatch && !aliasMatch.needsSetup && aliasMatch.category !== 'Uncategorized') {
    return {
      category: aliasMatch.category,
      parentCategory: aliasMatch.parentCategory,
      isMatched: true,
      matchedItemName: aliasMatch.name,
      matchedItemId: aliasMatch.id,
      matchType: 'alias',
    };
  }

  // Priority 4: Genuinely unmatched
  return {
    category: 'Uncategorized',
    parentCategory: 'Uncategorized',
    isMatched: false,
    matchType: 'none',
  };
}

/**
 * Automatically reconciles existing Needs Setup records in pos_menu_items.
 * If an item in Needs Setup resolves to a configured canonical item (via exact, normalized, or alias match),
 * it re-points any aliases, syncs historical sales rows, and deletes the redundant Needs Setup record.
 */
export async function reconcileNeedsSetupItems(supabase: any): Promise<{
  reconciledCount: number;
  reconciledItems: Array<{ sourceName: string; canonicalName: string; matchType: string }>;
}> {
  const lookup = await loadMenuMasterLookupFromDb(supabase);

  // Fetch all items currently in Needs Setup
  const { data: needsSetupItems, error: nsErr } = await supabase
    .from('pos_menu_items')
    .select('id, name, parent_category, category')
    .eq('needs_setup', true);

  if (nsErr || !needsSetupItems || needsSetupItems.length === 0) {
    return { reconciledCount: 0, reconciledItems: [] };
  }

  const reconciledItems: Array<{ sourceName: string; canonicalName: string; matchType: string }> = [];

  for (const item of needsSetupItems) {
    const res = resolveItemCategory(item.name, lookup);

    // If it resolves to a configured canonical item (and isn't resolving to itself)
    if (res.isMatched && res.category !== 'Uncategorized' && res.matchedItemId && res.matchedItemId !== item.id) {
      // 1. If the source name is different from the canonical name, register it as an alias
      if (item.name.trim().toLowerCase() !== (res.matchedItemName || '').toLowerCase()) {
        await supabase
          .from('pos_menu_item_aliases')
          .upsert(
            {
              alias: item.name.trim(),
              normalized_alias: normalizeItemName(item.name.trim()),
              menu_item_id: res.matchedItemId,
              notes: `Auto-reconciled from ${res.matchType} match`,
            },
            { onConflict: 'alias' }
          );
      }

      // 2. Re-point any aliases that point to this redundant item
      await supabase
        .from('pos_menu_item_aliases')
        .update({ menu_item_id: res.matchedItemId })
        .eq('menu_item_id', item.id);

      // 2. Reclassify sales in sales_hourly_items without altering raw item_name
      await supabase
        .from('sales_hourly_items')
        .update({
          parent_category: res.parentCategory,
          category: res.category,
        })
        .ilike('item_name', item.name.trim());

      // 3. Delete redundant item from pos_menu_items
      await supabase.from('pos_menu_items').delete().eq('id', item.id);

      reconciledItems.push({
        sourceName: item.name,
        canonicalName: res.matchedItemName || '',
        matchType: res.matchType || 'normalized',
      });
    }
  }

  return {
    reconciledCount: reconciledItems.length,
    reconciledItems,
  };
}
