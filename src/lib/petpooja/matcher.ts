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
  name: string;
  category: string;
  parentCategory: string;
  price?: number;
}

export interface CategoryResolutionResult {
  category: string;
  parentCategory: string;
  isMatched: boolean;
  matchedItemName?: string;
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
 */
export function buildMenuMasterLookup(
  menuItems: Array<{
    name: string;
    category: string;
    parent_category: string;
    price?: number;
    normalized_name?: string | null;
  }>,
  aliases?: Array<{
    alias: string;
    normalized_alias: string;
    menu_item_id: string;
    pos_menu_items?: {
      name: string;
      category: string;
      parent_category: string;
      price?: number;
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

  // 2. Populate menu items
  (menuItems || []).forEach((m) => {
    const parentCat = resolveParentCategory(m.category, m.parent_category, categoryToParentMap);
    const itemData: MenuItemMapping = {
      name: m.name,
      category: m.category,
      parentCategory: parentCat,
      price: m.price ? Number(m.price) : undefined,
    };

    // Raw exact lookup
    exactMap.set(m.name, itemData);

    // Normalized lookup
    const norm = m.normalized_name || normalizeItemName(m.name);
    normalizedMap.set(norm, itemData);
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
        name: a.pos_menu_items.name,
        category: a.pos_menu_items.category,
        parentCategory: parentCat,
        price: a.pos_menu_items.price ? Number(a.pos_menu_items.price) : undefined,
      };
      aliasMap.set(a.alias, itemData);
      aliasMap.set(a.normalized_alias || normalizeItemName(a.alias), itemData);
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
    supabase.from('pos_menu_items').select('name, parent_category, category, price, normalized_name').eq('is_active', true),
    supabase.from('pos_menu_item_aliases').select('alias, normalized_alias, menu_item_id, pos_menu_items(name, category, parent_category, price)'),
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

  // Priority 1: Exact item-name match
  if (lookup.exactMap.has(cleanRaw)) {
    const m = lookup.exactMap.get(cleanRaw)!;
    return {
      category: m.category,
      parentCategory: m.parentCategory,
      isMatched: true,
      matchedItemName: m.name,
      matchType: 'exact',
    };
  }

  // Priority 2: Normalized item-name match
  const norm = normalizeItemName(cleanRaw);
  if (lookup.normalizedMap.has(norm)) {
    const m = lookup.normalizedMap.get(norm)!;
    return {
      category: m.category,
      parentCategory: m.parentCategory,
      isMatched: true,
      matchedItemName: m.name,
      matchType: 'normalized',
    };
  }

  // Priority 3: Authoritative alias mapping
  if (lookup.aliasMap.has(cleanRaw)) {
    const m = lookup.aliasMap.get(cleanRaw)!;
    return {
      category: m.category,
      parentCategory: m.parentCategory,
      isMatched: true,
      matchedItemName: m.name,
      matchType: 'alias',
    };
  }
  if (lookup.aliasMap.has(norm)) {
    const m = lookup.aliasMap.get(norm)!;
    return {
      category: m.category,
      parentCategory: m.parentCategory,
      isMatched: true,
      matchedItemName: m.name,
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
