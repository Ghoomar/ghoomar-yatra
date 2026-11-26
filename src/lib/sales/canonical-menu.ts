import type { SupabaseClient } from '@supabase/supabase-js';

export interface CanonicalMenuEntry {
  id: string;
  name: string;
  normalized_name: string;
  parent_category: string;
  category: string;
  price: number;
  product_type: string | null;
  default_service_channel: string | null;
}

export interface CanonicalMenuLookup {
  byId: Map<string, CanonicalMenuEntry>;
  byExactActiveName: Map<string, CanonicalMenuEntry>;
  byNormalizedKey: Map<string, CanonicalMenuEntry>;
  activeItems: CanonicalMenuEntry[];
}

export function normalizeMenuLookupName(name: string | null | undefined): string {
  return (name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export const EXTRA_EXCLUDED_NON_FOOD_NORM_NAMES = new Set<string>([
  'test item',
  'snacks stall',
  'unknown',
  'unknown item',
]);

export function isNonFoodOrTestDishName(
  name: string | null | undefined,
  excludedSet?: Set<string>
): boolean {
  const trimmed = (name || '').trim();
  if (!trimmed) return true;
  const norm = normalizeMenuLookupName(trimmed);
  if (EXTRA_EXCLUDED_NON_FOOD_NORM_NAMES.has(norm)) return true;
  if (!excludedSet) return false;
  if (excludedSet.has(trimmed)) return true;
  for (const item of excludedSet) {
    if (normalizeMenuLookupName(item) === norm) return true;
  }
  return false;
}

/**
 * Loads the canonical active menu lookup map from pos_menu_items, pos_menu_item_aliases,
 * and yatra_menu_merge_logs (chained merge safety).
 * All analytics, Petpooja imports, forecasting, and BOM explosions should resolve item names through this helper.
 */
export async function loadCanonicalMenuLookup(
  supabase: SupabaseClient
): Promise<CanonicalMenuLookup> {
  const [{ data: menuRows, error: menuErr }, { data: aliasRows, error: aliasErr }, { data: mergeRows }] =
    await Promise.all([
      supabase
        .from('pos_menu_items')
        .select(
          'id, name, normalized_name, parent_category, category, price, is_active, product_type, default_service_channel'
        ),
      supabase
        .from('pos_menu_item_aliases')
        .select('alias, normalized_alias, menu_item_id'),
      supabase
        .from('yatra_menu_merge_logs')
        .select('source_menu_item_id, target_menu_item_id, merged_at')
        .order('merged_at', { ascending: false }),
    ]);

  if (menuErr) {
    throw new Error(`Failed to load pos_menu_items for canonical lookup: ${menuErr.message}`);
  }
  if (aliasErr) {
    throw new Error(`Failed to load pos_menu_item_aliases for canonical lookup: ${aliasErr.message}`);
  }

  const mergeTargetBySource = new Map<string, string>();
  for (const m of mergeRows || []) {
    if (m.source_menu_item_id && m.target_menu_item_id && !mergeTargetBySource.has(m.source_menu_item_id)) {
      mergeTargetBySource.set(m.source_menu_item_id, m.target_menu_item_id);
    }
  }

  const byId = new Map<string, CanonicalMenuEntry>();
  const activeItems: CanonicalMenuEntry[] = [];
  const byExactActiveName = new Map<string, CanonicalMenuEntry>();
  const byNormalizedKey = new Map<string, CanonicalMenuEntry>();

  for (const row of menuRows || []) {
    if (!row.is_active) continue;
    const entry: CanonicalMenuEntry = {
      id: row.id,
      name: row.name,
      normalized_name: row.normalized_name || normalizeMenuLookupName(row.name),
      parent_category: row.parent_category || 'Uncategorized',
      category: row.category || 'General',
      price: Number(row.price || 0),
      product_type: row.product_type || null,
      default_service_channel: row.default_service_channel || null,
    };
    byId.set(entry.id, entry);
    activeItems.push(entry);
    byExactActiveName.set(entry.name.trim(), entry);
  }

  const resolveActiveById = (id: string | null | undefined): CanonicalMenuEntry | null => {
    let cur = id;
    for (let depth = 0; cur && depth < 8; depth++) {
      const hit = byId.get(cur);
      if (hit) return hit;
      cur = mergeTargetBySource.get(cur);
    }
    return null;
  };

  // Priority 1: Active canonical names
  for (const entry of activeItems) {
    const key = normalizeMenuLookupName(entry.name);
    if (key) {
      byNormalizedKey.set(key, entry);
    }
  }

  // Priority 2: Explicit aliases pointing to active items (or transitively merged targets)
  for (const a of aliasRows || []) {
    const target = resolveActiveById(a.menu_item_id);
    if (!target) continue;
    const k1 = normalizeMenuLookupName(a.alias);
    if (k1 && !byNormalizedKey.has(k1)) {
      byNormalizedKey.set(k1, target);
    }
    const k2 = normalizeMenuLookupName(a.normalized_alias);
    if (k2 && !byNormalizedKey.has(k2)) {
      byNormalizedKey.set(k2, target);
    }
  }

  // Priority 3: Active normalized_name field
  for (const entry of activeItems) {
    const key = normalizeMenuLookupName(entry.normalized_name);
    if (key && !byNormalizedKey.has(key)) {
      byNormalizedKey.set(key, entry);
    }
  }

  return {
    byId,
    byExactActiveName,
    byNormalizedKey,
    activeItems,
  };
}

/**
 * Resolves any historical Petpooja POS item name (including [D], [d], (1 FULL), (1 PCS),
 * whitespace/case differences, or merged aliases) to its authoritative active canonical menu item.
 */
export function resolveCanonicalMenuItem(
  rawName: string | null | undefined,
  lookup: CanonicalMenuLookup
): CanonicalMenuEntry | null {
  const trimmed = (rawName || '').trim();
  if (!trimmed) return null;

  const exact = lookup.byExactActiveName.get(trimmed);
  if (exact) return exact;

  const norm = normalizeMenuLookupName(trimmed);
  const directNorm = lookup.byNormalizedKey.get(norm);
  if (directNorm) return directNorm;

  // Fallback strip for future unmerged [D] / (1 FULL) / (1 PCS) suffixes
  const stripped = norm
    .replace(/\s*\[d\]$/i, '')
    .replace(/\s*\((1\s*full|1\s*pcs)\)$/i, '')
    .trim();

  if (stripped && stripped !== norm) {
    const strippedHit = lookup.byNormalizedKey.get(stripped);
    if (strippedHit) return strippedHit;
  }

  return null;
}

export function resolveCanonicalDishName(
  rawName: string | null | undefined,
  lookup: CanonicalMenuLookup
): string {
  const trimmed = (rawName || '').trim();
  if (!trimmed) return '';
  return resolveCanonicalMenuItem(trimmed, lookup)?.name || trimmed;
}
