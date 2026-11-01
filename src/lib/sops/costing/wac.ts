import { GroupWacResolution } from './types';
import { convertDirectQuantity, normalizeUnit } from './units';

export interface InventoryItemForWac {
  id: string;
  item_code?: string;
  name: string;
  group_id?: string | null;
  brand_name?: string | null;
  current_stock: number;
  current_weighted_average_cost: number;
  is_costed: boolean;
  is_active?: boolean;
  conversion_factor?: number | string | null;
  unit?: { symbol: string; name?: string } | null;
  unit_symbol?: string | null;
  secondary_unit?: { symbol: string; name?: string } | null;
  secondary_unit_symbol?: string | null;
}

export interface LogicalGroupForWac {
  id: string;
  group_code: string;
  name: string;
  last_valid_wac?: number | null;
  base_unit_symbol?: string | null;
  base_unit?: { symbol: string; name?: string } | null;
  variants?: InventoryItemForWac[];
}

/**
 * Resolves the effective WAC for an ingredient group or pinned stock item according to
 * the authoritative 3-tier costing hierarchy.
 *
 * @param group The logical ingredient group
 * @param childItems All active inventory items belonging to this group
 * @param retainedGroupSnapshot Optional persisted/cached snapshot of the last positive-stock group WAC
 * @param pinnedItemId Optional explicitly pinned inventory_item_id
 */
export function resolveGroupEffectiveWac(
  group: LogicalGroupForWac,
  childItems: InventoryItemForWac[],
  retainedGroupSnapshot?: { wac: number; baseUnitSymbol: string } | null,
  pinnedItemId?: string | null
): GroupWacResolution {
  const groupBaseUnit = normalizeUnit(group.base_unit_symbol || group.base_unit?.symbol || 'g');

  // Look for configured conversion_factor on active variants in this group
  const variantWithConv = childItems.find(
    (i) => i.is_active !== false && i.conversion_factor && Number(i.conversion_factor) > 0
  );
  const conversionFactor = variantWithConv ? Number(variantWithConv.conversion_factor) : null;
  const secondaryUnitSymbol = variantWithConv?.secondary_unit?.symbol || variantWithConv?.secondary_unit_symbol || null;

  // Case 1: Pinned Item Override
  if (pinnedItemId) {
    const pinnedItem = childItems.find((it) => it.id === pinnedItemId);
    if (!pinnedItem) {
      return {
        groupId: group.id,
        wac: null,
        baseUnitSymbol: groupBaseUnit,
        isCosted: false,
        tier: 3,
        reason: `Pinned inventory item ${pinnedItemId} not found in group`,
        childVariantsCount: childItems.length,
        inStockVariantsCount: 0,
        costedVariantsCount: 0,
        conversionFactor,
        secondaryUnitSymbol,
      };
    }

    const itemUnit = normalizeUnit(pinnedItem.unit_symbol || pinnedItem.unit?.symbol || groupBaseUnit);
    const itemWac = Number(pinnedItem.current_weighted_average_cost || 0);
    const isCosted = Boolean(pinnedItem.is_costed && itemWac > 0);

    if (!isCosted) {
      return {
        groupId: group.id,
        wac: null,
        baseUnitSymbol: groupBaseUnit,
        isCosted: false,
        tier: 3,
        reason: `Pinned item '${pinnedItem.name}' is uncosted`,
        childVariantsCount: childItems.length,
        inStockVariantsCount: Number(pinnedItem.current_stock || 0) > 0 ? 1 : 0,
        costedVariantsCount: 0,
        conversionFactor,
        secondaryUnitSymbol,
      };
    }

    // Convert WAC from pinned item unit to group base unit
    // Note: If WAC is per itemUnit (e.g. ₹600/kg), converting to groupBaseUnit (e.g. g):
    // 1 itemUnit = conv.converted groupBaseUnits.
    // So cost per groupBaseUnit = itemWac / conv.converted.
    let convertedWac = itemWac;
    if (itemUnit !== groupBaseUnit) {
      const conv = convertDirectQuantity(1, itemUnit, groupBaseUnit);
      if (conv.possible && conv.converted && conv.converted > 0) {
        convertedWac = itemWac / conv.converted;
      }
    }

    return {
      groupId: group.id,
      wac: convertedWac,
      baseUnitSymbol: groupBaseUnit,
      isCosted: true,
      tier: 1,
      childVariantsCount: childItems.length,
      inStockVariantsCount: Number(pinnedItem.current_stock || 0) > 0 ? 1 : 0,
      costedVariantsCount: 1,
      conversionFactor,
      secondaryUnitSymbol,
    };
  }

  // Active child variants
  const activeVariants = childItems.filter((i) => i.is_active !== false);
  const inStockVariants = activeVariants.filter((i) => Number(i.current_stock || 0) > 0);
  const costedVariants = activeVariants.filter((i) => i.is_costed && Number(i.current_weighted_average_cost || 0) > 0);

  // -------------------------------------------------------------
  // Tier 1: In-Stock Weighted Average WAC
  // -------------------------------------------------------------
  if (inStockVariants.length > 0) {
    // If any in-stock variant has uncosted/unknown valuation, the group cannot be definitively costed
    const hasUncostedInStock = inStockVariants.some((i) => !i.is_costed || Number(i.current_weighted_average_cost || 0) <= 0);
    if (hasUncostedInStock) {
      return {
        groupId: group.id,
        wac: null,
        baseUnitSymbol: groupBaseUnit,
        isCosted: false,
        tier: 3,
        reason: 'One or more in-stock brand variants have unknown/uncosted valuation',
        childVariantsCount: activeVariants.length,
        inStockVariantsCount: inStockVariants.length,
        costedVariantsCount: costedVariants.length,
        conversionFactor,
        secondaryUnitSymbol,
      };
    }

    let totalValuation = 0;
    let totalStockInBaseUnit = 0;

    for (const v of inStockVariants) {
      const stock = Number(v.current_stock || 0);
      const rawWac = Number(v.current_weighted_average_cost || 0);
      const itemUnit = normalizeUnit(v.unit_symbol || v.unit?.symbol || groupBaseUnit);

      // Convert stock to group base unit
      let stockInBaseUnit = stock;
      if (itemUnit !== groupBaseUnit) {
        const conv = convertDirectQuantity(stock, itemUnit, groupBaseUnit);
        if (conv.possible && conv.converted !== undefined) {
          stockInBaseUnit = conv.converted;
        }
      }

      // Valuation = stock * unit WAC (regardless of units, total value in ₹)
      const val = stock * rawWac;
      totalValuation += val;
      totalStockInBaseUnit += stockInBaseUnit;
    }

    if (totalStockInBaseUnit > 0) {
      const calculatedGroupWac = totalValuation / totalStockInBaseUnit;
      return {
        groupId: group.id,
        wac: calculatedGroupWac,
        baseUnitSymbol: groupBaseUnit,
        isCosted: true,
        tier: 1,
        childVariantsCount: activeVariants.length,
        inStockVariantsCount: inStockVariants.length,
        costedVariantsCount: costedVariants.length,
        conversionFactor,
        secondaryUnitSymbol,
      };
    }
  }

  // -------------------------------------------------------------
  // Tier 2: Retained Positive-Stock Group WAC Snapshot (When On-Hand Stock = 0)
  // -------------------------------------------------------------
  // When all child stock items reach zero through normal consumption:
  // Retain the last valid group-level WAC snapshot.
  // Mandatory Clarification 1: Do NOT replace it with a simple arithmetic average
  // of the brands' retained WACs, as this would change recipe costing without a new purchase.
  const preservedSnapshotWac =
    retainedGroupSnapshot && retainedGroupSnapshot.wac > 0
      ? retainedGroupSnapshot.wac
      : group.last_valid_wac && Number(group.last_valid_wac) > 0
      ? Number(group.last_valid_wac)
      : null;

  if (preservedSnapshotWac !== null && preservedSnapshotWac > 0) {
    let snapshotWac = preservedSnapshotWac;
    const snapUnit = retainedGroupSnapshot?.baseUnitSymbol
      ? normalizeUnit(retainedGroupSnapshot.baseUnitSymbol)
      : groupBaseUnit;

    if (snapUnit !== groupBaseUnit) {
      const conv = convertDirectQuantity(1, snapUnit, groupBaseUnit);
      if (conv.possible && conv.converted && conv.converted > 0) {
        snapshotWac = preservedSnapshotWac / conv.converted;
      }
    }

    return {
      groupId: group.id,
      wac: snapshotWac,
      baseUnitSymbol: groupBaseUnit,
      isCosted: true,
      tier: 2,
      reason: 'Preserved last valid positive-stock group WAC snapshot',
      childVariantsCount: activeVariants.length,
      inStockVariantsCount: 0,
      costedVariantsCount: costedVariants.length,
      conversionFactor,
      secondaryUnitSymbol,
    };
  }

  // -------------------------------------------------------------
  // Tier 3: Uncosted
  // -------------------------------------------------------------
  // If zero on-hand stock and no positive-stock group WAC snapshot was recorded,
  // the group is explicitly UNCOSTED. Never treat missing or zero placeholder WAC as free (0 cost).
  return {
    groupId: group.id,
    wac: null,
    baseUnitSymbol: groupBaseUnit,
    isCosted: false,
    tier: 3,
    reason: 'Zero on-hand stock and no valid group WAC snapshot recorded',
    childVariantsCount: activeVariants.length,
    inStockVariantsCount: 0,
    costedVariantsCount: costedVariants.length,
    conversionFactor,
    secondaryUnitSymbol,
  };
}

export const resolveGroupWac = resolveGroupEffectiveWac;

/**
 * Synchronously resolves WAC for all ingredient groups against an in-memory array of inventory items.
 */
export function resolveAllGroupWacsSync(
  groups: LogicalGroupForWac[],
  items: InventoryItemForWac[],
  snapshotsMap?: Map<string, { wac: number; baseUnitSymbol: string }>
): Map<string, GroupWacResolution> {
  const result = new Map<string, GroupWacResolution>();
  const itemsByGroup = new Map<string, InventoryItemForWac[]>();

  for (const item of items) {
    if (item.group_id) {
      if (!itemsByGroup.has(item.group_id)) itemsByGroup.set(item.group_id, []);
      itemsByGroup.get(item.group_id)!.push(item);
    }
  }

  for (const group of groups) {
    const childItems = itemsByGroup.get(group.id) || group.variants || [];
    const snapshot = snapshotsMap?.get(group.id);
    const res = resolveGroupEffectiveWac(group, childItems, snapshot);
    result.set(group.id, res);
  }

  return result;
}

/**
 * Fetches all logical groups and inventory items from Supabase and resolves effective group WACs.
 */
export async function fetchAndResolveGroupWacs(
  supabase: any,
  snapshotsMap?: Map<string, { wac: number; baseUnitSymbol: string }>
): Promise<Map<string, GroupWacResolution>> {
  const [groupsRes, itemsRes] = await Promise.all([
    supabase
      .from('logical_ingredient_groups')
      .select(`
        id, name, name_hi, group_code, inventory_class, last_valid_wac,
        base_unit:units!logical_ingredient_groups_base_unit_id_fkey(symbol, name)
      `),
    supabase
      .from('inventory_items')
      .select(`
        id, name, name_hi, item_code, group_id, current_stock,
        current_weighted_average_cost, is_costed, is_active, conversion_factor,
        unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi, name, name_hi),
        secondary_unit:units!inventory_items_secondary_unit_id_fkey(symbol, symbol_hi, name, name_hi)
      `),
  ]);

  if (groupsRes.error) throw groupsRes.error;
  if (itemsRes.error) throw itemsRes.error;

  return resolveAllGroupWacsSync(
    (groupsRes.data || []) as LogicalGroupForWac[],
    (itemsRes.data || []) as InventoryItemForWac[],
    snapshotsMap
  );
}

/**
 * Resolves WAC for all ingredient groups against inventory items (either in-memory or via Supabase client).
 */
export function resolveAllGroupWacs(
  groups: LogicalGroupForWac[],
  items: InventoryItemForWac[],
  snapshotsMap?: Map<string, { wac: number; baseUnitSymbol: string }>
): Map<string, GroupWacResolution>;
export function resolveAllGroupWacs(
  supabase: any,
  snapshotsMap?: Map<string, { wac: number; baseUnitSymbol: string }>
): Promise<Map<string, GroupWacResolution>>;
export function resolveAllGroupWacs(
  groupsOrSupabase: any,
  itemsOrSnapshots?: any,
  snapshotsMap?: any
): any {
  if (groupsOrSupabase && typeof groupsOrSupabase.from === 'function') {
    return fetchAndResolveGroupWacs(groupsOrSupabase, itemsOrSnapshots);
  }
  return resolveAllGroupWacsSync(groupsOrSupabase, itemsOrSnapshots || [], snapshotsMap);
}

