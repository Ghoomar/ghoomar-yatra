export interface SearchableInventoryItem {
  id: string;
  item_code?: string;
  name: string;
  name_hi?: string | null;
  group_id?: string | null;
  brand_name?: string | null;
  variant_name?: string | null;
  search_family?: string | null;
  [key: string]: any;
}

export interface LogicalIngredientGroup {
  id: string;
  group_code: string;
  name: string;
  name_hi?: string | null;
  category_id?: string | null;
  inventory_class: string;
  base_unit_id: string;
  base_unit?: { symbol: string; symbol_hi?: string | null; name: string; name_hi?: string | null };
  category?: { id: string; name: string; name_hi?: string | null; inventory_class: string };
  abc_risk?: string | null;
  search_family?: string | null;
  is_active?: boolean;
  variants?: SearchableInventoryItem[];
  [key: string]: any;
}

export const CHILLI_FAMILY_TOKENS = new Set(['chilli', 'chili', 'chilly', 'mirch', 'mirchi', 'मिर्च', 'मिर्ची']);
export const CANONICAL_CHILLI_TOKEN = '__chilli_family__';

/**
 * Normalizes query tokens, mapping Chilli family variations (Mirch, Chili, Chilli, Chilly)
 * into a single controlled search-family token while preserving existing substring behavior.
 */
export function normalizeSearchTokens(query: string): string[] {
  const q = query?.trim().toLowerCase();
  if (!q) return [];

  const rawTokens = q.split(/\s+/).filter(Boolean);
  return rawTokens.map((token) => {
    if (CHILLI_FAMILY_TOKENS.has(token)) {
      return CANONICAL_CHILLI_TOKEN;
    }
    return token;
  });
}

/**
 * Generates composite searchable text for an item, enriching it with search-family tokens
 * when family keywords or metadata are present.
 */
export function buildSearchableText(
  item: { name: string; name_hi?: string | null; item_code?: string; search_family?: string | null },
  aliases: string[] = []
): string {
  const aliasesJoined = aliases.join(' ');
  const rawSearchable = `${item.name || ''} ${item.name_hi || ''} ${item.item_code || ''} ${aliasesJoined}`.toLowerCase();

  const isChilliFamily =
    item.search_family === 'chilli' ||
    CHILLI_FAMILY_TOKENS.has(rawSearchable.trim()) ||
    Array.from(CHILLI_FAMILY_TOKENS).some((t) => rawSearchable.includes(t));

  if (isChilliFamily) {
    return `${rawSearchable} ${CANONICAL_CHILLI_TOKEN}`;
  }

  return rawSearchable;
}

/**
 * Shared multi-lingual, alias-aware, substring inventory search utility.
 * Deduplicates results strictly by item id.
 */
export function filterInventoryItems<T extends SearchableInventoryItem>(
  items: T[],
  query: string,
  aliasesMap: Record<string, string[]> = {}
): T[] {
  const q = query?.trim();
  if (!q) return items;

  const tokens = normalizeSearchTokens(q);
  if (tokens.length === 0) return items;

  const seenIds = new Set<string>();
  const matches: T[] = [];

  for (const it of items) {
    const idKey = it.id || (it as any).item_id;
    if (idKey && seenIds.has(idKey)) continue;

    const itAliases = idKey ? aliasesMap[idKey] || [] : [];
    const searchable = buildSearchableText(it, itAliases);

    const isMatch = tokens.every((token) => searchable.includes(token));
    if (isMatch) {
      if (idKey) seenIds.add(idKey);
      matches.push(it);
    }
  }

  return matches;
}

/**
 * Filters Logical Ingredient Groups based on query and aliases.
 * Supports family normalization (Chilli/Mirch) and attaches matching stock variants.
 */
export function filterLogicalIngredientGroups<T extends LogicalIngredientGroup>(
  groups: T[],
  query: string,
  aliasesMap: Record<string, string[]> = {}
): T[] {
  const q = query?.trim();
  if (!q) return groups;

  const tokens = normalizeSearchTokens(q);
  if (tokens.length === 0) return groups;

  const seenIds = new Set<string>();
  const matches: T[] = [];

  for (const grp of groups) {
    if (seenIds.has(grp.id)) continue;

    // Collect aliases for group and all its variants
    const groupAliases = aliasesMap[grp.id] || [];
    const variantAliases = (grp.variants || []).flatMap((v) => aliasesMap[v.id] || []);
    const variantNames = (grp.variants || []).map((v) => `${v.name || ''} ${v.brand_name || ''}`).join(' ');

    const allAliases = Array.from(new Set([...groupAliases, ...variantAliases]));
    const compositeGroup = {
      name: `${grp.name} ${variantNames}`,
      name_hi: grp.name_hi,
      item_code: grp.group_code,
      search_family: grp.search_family,
    };

    const searchable = buildSearchableText(compositeGroup, allAliases);

    const isMatch = tokens.every((token) => searchable.includes(token));
    if (isMatch) {
      seenIds.add(grp.id);
      matches.push(grp);
    }
  }

  return matches;
}

/**
 * Returns a composite searchable string for an item and its aliases
 * used by SearchableSelect components.
 */
export function getSearchableItemText(
  item: SearchableInventoryItem,
  aliasesMap: Record<string, string[]> = {}
): string {
  const idKey = item.id || (item as any).item_id;
  const itAliases = idKey ? aliasesMap[idKey] || [] : [];
  return buildSearchableText(item, itAliases);
}
