/**
 * Intelligent Bill Classifier & Group Association Layer
 * Ghoomar Yatra Phase 2
 */

import { BillClassificationResult, BillClass, GroupType, GroupTier, Daypart, ClassificationThresholds } from './types';
import { isLanchoOrder, isSnacksStallOrder, isTakeawayOrder, isDineInOrder } from '@/lib/sales/business-units';

/**
 * 16 Excluded Non-Restaurant Outside Activities, Stalls & Event Passes
 * These items have zero kitchen recipes and zero raw materials.
 */
export const EXCLUDED_NON_RESTAURANT_ITEMS = new Set([
  // Outside Village Rides & Stalls
  'Camel Ride',
  'Camel Adult',
  'Camel Child',
  'Skill Games',
  'Meetha Paan',
  'Jyotish Ticket',
  'Barf Kar Gola',
  'Champi Maalish',
  'Mehendi',
  // Event Admission Passes & Merchandise
  'Couple Pass',
  'Male Pass',
  'Female Pass',
  'Early Bird Couple Pass',
  'Student Couple Pass',
  'Dandiya Sticks',
  'Tip',
]);

/**
 * Staff / Cashier / Aggregator Blacklist for Auto-Linking
 * Prevents phantom group linking for delivery aggregator support and dummy phones.
 */
export const PHONE_AUTO_LINK_BLACKLIST = new Set([
  '9927300836', // Lancho Restaurant Support (Hyperlocal Delivery Aggregator)
  '9999999999', // Dummy POS phone
  '8888888888', // Dummy vendor phone
  '1234567890', // Test dummy phone
  '0000000000',
]);

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  dine_in_pax_p95: 7.0,
  dine_in_pax_p99: 10.0,
  dine_in_spp_p95: 553.54,
  dine_in_spp_p99: 840.7,
  pax_large_group_threshold: 20,
  spend_per_pax_anomaly_threshold: 750.0,
  bill_net_sales_anomaly_threshold: 10000.0,
  iqr_multiplier: 2.5,
  trained_on_bills_count: 5063,
};

export interface RawOrderForClassification {
  id: string;
  business_date: string;
  invoice_no: string;
  order_timestamp?: string | null;
  hour_of_day?: number | null;
  status: string;
  order_type?: string | null;
  area?: string | null;
  payment_type?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  covers_pax?: number | null;
  net_sales?: number | string | null;
  gross_amount?: number | string | null;
  items?: Array<{
    item_name: string;
    quantity: number | string;
    net_sales: number | string;
    unit_price?: number | string;
    table_no?: string | null;
  }>;
}

/**
 * Helper to determine Daypart from hour of day (IST).
 */
export function getDaypart(hour?: number | null): Daypart {
  const h = hour ?? 12;
  if (h >= 6 && h < 12) return 'breakfast';
  if (h >= 12 && h < 17) return 'lunch';
  if (h >= 17 && h < 23) return 'dinner';
  return 'late_night';
}

/**
 * Normalizes phone numbers (removes non-digits).
 */
export function normalizePhone(phone?: string | null): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').trim();
}

/**
 * Checks if customer name contains recognized group keywords.
 */
export function matchGroupKeyword(name?: string | null): GroupType | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('school') || n.includes('picnic') || n.includes('vidyalaya') || n.includes('academy')) {
    return 'school_group';
  }
  if (n.includes('corporate') || n.includes('power and torque') || n.includes('pvt') || n.includes('ltd') || n.includes('company')) {
    return 'corporate';
  }
  if (n.includes('tour') || n.includes('bus') || n.includes('yatri') || n.includes('darshan')) {
    return 'tour_bus';
  }
  if (n.includes('group') || n.includes('party') || n.includes('gathering')) {
    return 'standard_group';
  }
  return null;
}

/**
 * Checks if order contains school picnic specific menu items.
 */
export function hasSchoolPicnicItems(items?: RawOrderForClassification['items']): boolean {
  if (!items || items.length === 0) return false;
  return items.some((it) => {
    const name = (it.item_name || '').toLowerCase();
    return name.includes('school picnic');
  });
}

/**
 * Checks if bill contains driver thali or complimentary school items.
 */
export function isKnownZeroPriceItem(name?: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    n.includes('driver') ||
    n.includes('mitra') ||
    n.includes('complimentary')
  );
}

/**
 * Classifies an individual bill according to strict precedence:
 * Precedence:
 * 0. status = 'Cancelled' -> 'cancelled'
 * 1. data_anomaly
 * 2. large_group
 * 3. high_value_anomaly
 * 4. normal (including regular Complimentary)
 */
export function classifyBill(
  order: RawOrderForClassification,
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS
): BillClassificationResult {
  const netSales = Math.round(Number(order.net_sales || 0) * 100) / 100;
  const pax = Math.max(0, Number(order.covers_pax || 0));
  const rawStatus = (order.status || 'Success').trim();
  const phone = normalizePhone(order.customer_phone);
  const hour = order.hour_of_day ?? (order.order_timestamp ? new Date(order.order_timestamp).getHours() : 12);
  const daypart = getDaypart(hour);

  // Business Unit classification
  const isLancho = isLanchoOrder({
    order_type: order.order_type,
    area: order.area,
    payment_type: order.payment_type,
    customer_phone: phone,
  });
  const isDineIn = !isLancho && isDineInOrder({
    order_type: order.order_type,
    area: order.area,
    payment_type: order.payment_type,
  });

  // Calculate Dine-In Spend Per Pax (APC)
  const spendPerPax = isDineIn && pax > 0 ? netSales / pax : 0;

  // Primary table resolution
  let primaryTable: string | null = null;
  if (order.items && order.items.length > 0) {
    const tableCounts = new Map<string, number>();
    for (const it of order.items) {
      if (it.table_no) {
        tableCounts.set(it.table_no, (tableCounts.get(it.table_no) || 0) + 1);
      }
    }
    let maxCount = 0;
    for (const [tbl, cnt] of tableCounts.entries()) {
      if (cnt > maxCount) {
        maxCount = cnt;
        primaryTable = tbl;
      }
    }
  }

  // Decompose items into Outside Activities vs Kitchen Food
  let outsideNet = 0;
  let outsideQty = 0;
  let totalQty = 0;
  let allZeroKnown = true;

  if (order.items && order.items.length > 0) {
    for (const it of order.items) {
      const q = Number(it.quantity || 0);
      const ns = Number(it.net_sales || 0);
      totalQty += q;
      if (EXCLUDED_NON_RESTAURANT_ITEMS.has(it.item_name)) {
        outsideNet += ns;
        outsideQty += q;
      }
      if (!isKnownZeroPriceItem(it.item_name) && ns > 0) {
        allZeroKnown = false;
      }
    }
  }

  // Zero double-counting on mixed bills
  outsideNet = Math.round(outsideNet * 100) / 100;
  outsideQty = Math.round(outsideQty * 100) / 100;
  totalQty = Math.round(totalQty * 100) / 100;
  const foodNet = Math.max(0, Math.round((netSales - outsideNet) * 100) / 100);
  const foodQty = Math.max(0, Math.round((totalQty - outsideQty) * 100) / 100);

  // 0. Handle Cancelled Orders Cleanly
  if (rawStatus === 'Cancelled') {
    return {
      sales_order_id: order.id,
      business_date: order.business_date,
      invoice_no: order.invoice_no,
      primary_table_no: primaryTable,
      bill_status: rawStatus,
      bill_class: 'cancelled',
      is_group_member: false,
      group_cluster_id: null,
      group_type: null,
      group_association_tier: null,
      bill_net_amount: netSales,
      bill_pax: pax,
      bill_apc: 0,
      daypart,
      outside_activities_net: outsideNet,
      outside_activities_qty: outsideQty,
      restaurant_food_net: 0,
      restaurant_food_qty: 0,
      classification_reason: 'Cancelled order excluded from forecasting and BOM explosion.',
    };
  }

  // 1. Data Anomaly Evaluation
  // Negative sales
  if (netSales < 0) {
    return {
      sales_order_id: order.id,
      business_date: order.business_date,
      invoice_no: order.invoice_no,
      primary_table_no: primaryTable,
      bill_status: rawStatus,
      bill_class: 'data_anomaly',
      is_group_member: false,
      group_cluster_id: null,
      group_type: null,
      group_association_tier: null,
      bill_net_amount: netSales,
      bill_pax: pax,
      bill_apc: spendPerPax,
      daypart,
      outside_activities_net: outsideNet,
      outside_activities_qty: outsideQty,
      restaurant_food_net: foodNet,
      restaurant_food_qty: foodQty,
      classification_reason: `Negative net sales (₹${netSales.toFixed(2)})`,
    };
  }

  // Zero net sales on Success that is NOT known driver/complimentary line
  if (rawStatus === 'Success' && netSales === 0 && !allZeroKnown) {
    return {
      sales_order_id: order.id,
      business_date: order.business_date,
      invoice_no: order.invoice_no,
      primary_table_no: primaryTable,
      bill_status: rawStatus,
      bill_class: 'data_anomaly',
      is_group_member: false,
      group_cluster_id: null,
      group_type: null,
      group_association_tier: null,
      bill_net_amount: netSales,
      bill_pax: pax,
      bill_apc: 0,
      daypart,
      outside_activities_net: outsideNet,
      outside_activities_qty: outsideQty,
      restaurant_food_net: 0,
      restaurant_food_qty: foodQty,
      classification_reason: 'Zero net sales on regular successful order (unexplained)',
    };
  }

  // PAX-typo guard on Dine In: covers_pax >= 10 and spend_per_pax < 30 (e.g. 34 PAX / ₹205 or 21 PAX / ₹185)
  if (isDineIn && pax >= 10 && spendPerPax < 30.0 && rawStatus !== 'Complimentary') {
    return {
      sales_order_id: order.id,
      business_date: order.business_date,
      invoice_no: order.invoice_no,
      primary_table_no: primaryTable,
      bill_status: rawStatus,
      bill_class: 'data_anomaly',
      is_group_member: false,
      group_cluster_id: null,
      group_type: null,
      group_association_tier: null,
      bill_net_amount: netSales,
      bill_pax: pax,
      bill_apc: spendPerPax,
      daypart,
      outside_activities_net: outsideNet,
      outside_activities_qty: outsideQty,
      restaurant_food_net: foodNet,
      restaurant_food_qty: foodQty,
      classification_reason: `PAX-typo detected: ${pax} covers with only ₹${netSales.toFixed(2)} spend (₹${spendPerPax.toFixed(2)}/PAX)`,
    };
  }

  // 2. Large Group Evaluation (MUST evaluate before high_value_anomaly)
  const groupKw = matchGroupKeyword(order.customer_name);
  const isSchoolPicnic = hasSchoolPicnicItems(order.items);
  const isPaxGroup = isDineIn && pax >= thresholds.pax_large_group_threshold;

  if (isPaxGroup || isSchoolPicnic || groupKw !== null) {
    let resolvedGroupType: GroupType = 'standard_group';
    if (isSchoolPicnic || groupKw === 'school_group') {
      resolvedGroupType = 'school_group';
    } else if (groupKw === 'corporate') {
      resolvedGroupType = 'corporate';
    } else if (groupKw === 'tour_bus') {
      resolvedGroupType = 'tour_bus';
    }

    return {
      sales_order_id: order.id,
      business_date: order.business_date,
      invoice_no: order.invoice_no,
      primary_table_no: primaryTable,
      bill_status: rawStatus,
      bill_class: 'large_group',
      is_group_member: true,
      group_cluster_id: null, // Populated during multi-bill group linking pass
      group_type: resolvedGroupType,
      group_association_tier: 'tier1_auto_explicit',
      bill_net_amount: netSales,
      bill_pax: pax,
      bill_apc: spendPerPax,
      daypart,
      outside_activities_net: outsideNet,
      outside_activities_qty: outsideQty,
      restaurant_food_net: foodNet,
      restaurant_food_qty: foodQty,
      classification_reason: isSchoolPicnic
        ? 'Contains School Picnic set packages'
        : groupKw
        ? `Explicit group booking name (${order.customer_name})`
        : `Dine-In covers (${pax}) exceeded group threshold (${thresholds.pax_large_group_threshold})`,
    };
  }

  // 3. High Value Anomaly Evaluation
  // Dine In: spend_per_pax > spend_per_pax_anomaly_threshold
  if (isDineIn && spendPerPax > thresholds.spend_per_pax_anomaly_threshold) {
    return {
      sales_order_id: order.id,
      business_date: order.business_date,
      invoice_no: order.invoice_no,
      primary_table_no: primaryTable,
      bill_status: rawStatus,
      bill_class: 'high_value_anomaly',
      is_group_member: false,
      group_cluster_id: null,
      group_type: null,
      group_association_tier: null,
      bill_net_amount: netSales,
      bill_pax: pax,
      bill_apc: spendPerPax,
      daypart,
      outside_activities_net: outsideNet,
      outside_activities_qty: outsideQty,
      restaurant_food_net: foodNet,
      restaurant_food_qty: foodQty,
      classification_reason: `Spend/PAX (₹${spendPerPax.toFixed(2)}) exceeded anomaly threshold (₹${thresholds.spend_per_pax_anomaly_threshold})`,
    };
  }

  // Non-Dine In (Counter, Pick Up, Delivery(Parcel), Lancho):
  // ONLY flag when net_sales >= bill_net_sales_anomaly_threshold (e.g. ₹10,000+ lump-sum settlements)
  // NEVER apply Dine-In Spend/PAX thresholds to takeaway/parcel orders with placeholder covers 0 or 1
  if (!isDineIn && netSales >= thresholds.bill_net_sales_anomaly_threshold) {
    return {
      sales_order_id: order.id,
      business_date: order.business_date,
      invoice_no: order.invoice_no,
      primary_table_no: primaryTable,
      bill_status: rawStatus,
      bill_class: 'high_value_anomaly',
      is_group_member: false,
      group_cluster_id: null,
      group_type: null,
      group_association_tier: null,
      bill_net_amount: netSales,
      bill_pax: pax,
      bill_apc: 0,
      daypart,
      outside_activities_net: outsideNet,
      outside_activities_qty: outsideQty,
      restaurant_food_net: foodNet,
      restaurant_food_qty: foodQty,
      classification_reason: `Counter/Takeaway bill net sales (₹${netSales.toFixed(2)}) exceeded bulk anomaly threshold (₹${thresholds.bill_net_sales_anomaly_threshold})`,
    };
  }

  // 4. Normal Bill (including normal Complimentary bills and regular walk-ins)
  return {
    sales_order_id: order.id,
    business_date: order.business_date,
    invoice_no: order.invoice_no,
    primary_table_no: primaryTable,
    bill_status: rawStatus,
    bill_class: 'normal',
    is_group_member: false,
    group_cluster_id: null,
    group_type: null,
    group_association_tier: null,
    bill_net_amount: netSales,
    bill_pax: pax,
    bill_apc: spendPerPax,
    daypart,
    outside_activities_net: outsideNet,
    outside_activities_qty: outsideQty,
    restaurant_food_net: foodNet,
    restaurant_food_qty: foodQty,
    classification_reason: rawStatus === 'Complimentary' ? 'Complimentary bill (₹0 revenue realized, volume retained)' : 'Standard dining transaction',
  };
}

/**
 * Runs multi-bill group association across a list of classified bills for a business date.
 * - Tier 1: Links bills sharing the same non-blacklisted phone and matching customer name,
 *   or sharing verified group names.
 * - Tier 2: Flags candidate clusters if bills share identical primary_table_no within 15 mins
 *   and order set/banquet menus.
 */
export function associateGroupClusters(
  bills: BillClassificationResult[],
  rawOrders: RawOrderForClassification[]
): BillClassificationResult[] {
  const orderMap = new Map<string, RawOrderForClassification>(rawOrders.map((o) => [o.id, o]));
  const phoneClusters = new Map<string, string[]>(); // phone -> orderIds
  const nameClusters = new Map<string, string[]>(); // normalized group name -> orderIds

  for (const b of bills) {
    if (b.bill_class === 'cancelled') continue;
    const raw = orderMap.get(b.sales_order_id);
    if (!raw) continue;

    const phone = normalizePhone(raw.customer_phone);
    const name = (raw.customer_name || '').trim().toLowerCase();

    // Check verified group name
    const groupKw = matchGroupKeyword(name);
    if (groupKw && name.length >= 4) {
      const existing = nameClusters.get(name) || [];
      existing.push(b.sales_order_id);
      nameClusters.set(name, existing);
    }

    // Check non-blacklisted phone
    if (phone && !PHONE_AUTO_LINK_BLACKLIST.has(phone)) {
      const existing = phoneClusters.get(phone) || [];
      existing.push(b.sales_order_id);
      phoneClusters.set(phone, existing);
    }
  }

  const billMap = new Map<string, BillClassificationResult>(bills.map((b) => [b.sales_order_id, { ...b }]));

  // Auto-link Tier 1 Phone Clusters (only if customer name is consistent or missing)
  for (const [phone, orderIds] of phoneClusters.entries()) {
    if (orderIds.length < 2) continue;
    const names = new Set(
      orderIds
        .map((id) => (orderMap.get(id)?.customer_name || '').trim().toLowerCase())
        .filter((n) => n.length > 0)
    );

    // If multiple completely distinct customer names share this phone, block auto-link
    if (names.size > 1) {
      continue;
    }

    const clusterId = crypto.randomUUID();
    for (const id of orderIds) {
      const b = billMap.get(id);
      if (b) {
        b.is_group_member = true;
        b.group_cluster_id = clusterId;
        b.group_type = b.group_type || 'standard_group';
        b.group_association_tier = 'tier1_auto_explicit';
        if (b.bill_class === 'normal') {
          b.bill_class = 'large_group';
          b.classification_reason = `Linked via verified phone cluster (${phone})`;
        }
      }
    }
  }

  // Auto-link Tier 1 Name Clusters (schools / groups)
  for (const [grpName, orderIds] of nameClusters.entries()) {
    if (orderIds.length < 2) continue;
    const clusterId = crypto.randomUUID();
    for (const id of orderIds) {
      const b = billMap.get(id);
      if (b) {
        b.is_group_member = true;
        b.group_cluster_id = clusterId;
        b.group_type = b.group_type || matchGroupKeyword(grpName) || 'standard_group';
        b.group_association_tier = 'tier1_auto_explicit';
        if (b.bill_class === 'normal') {
          b.bill_class = 'large_group';
          b.classification_reason = `Linked via shared group booking name (${grpName})`;
        }
      }
    }
  }

  // Tier 2 Candidate Flagging: Identical table within 15 minutes with set-menus
  // Group by primary_table_no
  const tableBills = new Map<string, Array<{ bill: BillClassificationResult; raw: RawOrderForClassification }>>();
  for (const b of billMap.values()) {
    if (!b.primary_table_no || b.bill_class === 'cancelled') continue;
    const raw = orderMap.get(b.sales_order_id);
    if (!raw || !raw.order_timestamp) continue;
    const list = tableBills.get(b.primary_table_no) || [];
    list.push({ bill: b, raw });
    tableBills.set(b.primary_table_no, list);
  }

  for (const [, entries] of tableBills.entries()) {
    if (entries.length < 2) continue;
    // Sort by timestamp
    entries.sort((a, b) => new Date(a.raw.order_timestamp!).getTime() - new Date(b.raw.order_timestamp!).getTime());
    for (let i = 0; i < entries.length - 1; i++) {
      const current = entries[i];
      const next = entries[i + 1];
      const timeDiffMs = Math.abs(
        new Date(next.raw.order_timestamp!).getTime() - new Date(current.raw.order_timestamp!).getTime()
      );
      if (timeDiffMs <= 15 * 60 * 1000) {
        // Both share same table within 15 mins. Check if either has set menu items or group keywords
        const currHasSet = hasSchoolPicnicItems(current.raw.items);
        const nextHasSet = hasSchoolPicnicItems(next.raw.items);
        if (currHasSet && nextHasSet && !current.bill.group_cluster_id && !next.bill.group_cluster_id) {
          const candidateClusterId = crypto.randomUUID();
          current.bill.is_group_member = true;
          current.bill.group_cluster_id = candidateClusterId;
          current.bill.group_association_tier = 'tier2_candidate_flag';
          next.bill.is_group_member = true;
          next.bill.group_cluster_id = candidateClusterId;
          next.bill.group_association_tier = 'tier2_candidate_flag';
        }
      }
    }
  }

  return Array.from(billMap.values());
}
