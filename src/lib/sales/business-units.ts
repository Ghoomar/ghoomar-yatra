/**
 * Authoritative Business Unit and Channel classification rules for Ghoomar Yatra.
 *
 * Rules:
 * 1. Raw imported Petpooja data preserves original order_type verbatim (e.g. 'Delivery(Parcel)', 'Pick Up', 'Dine In', 'LANCHO').
 * 2. Petpooja order type 'Delivery (Parcel)' / 'Delivery(Parcel)' is EXCLUSIVELY used for Snacks Stall.
 *    -> Business Unit: 'Snacks Stall'
 * 3. Lancho is a separate delivery platform/service with variable commission (~15-20%).
 *    Lancho is NEVER Snacks Stall.
 *    Orders paid through Lancho or assigned to area 'LANCHO' or with order_type 'LANCHO' are classified as 'Lancho'.
 * 4. 'Pick Up' / 'Takeaway' -> 'Takeaway'
 * 5. 'Dine In' -> 'Dine In'
 */

export interface OrderClassificationFields {
  order_type?: string | null;
  area?: string | null;
  payment_type?: string | null;
}

/**
 * Checks if an order belongs to the Lancho delivery platform / channel.
 * Lancho is identified by:
 * - area === 'LANCHO' (case-insensitive)
 * - order_type === 'LANCHO' (case-insensitive)
 * - payment_type contains 'lancho' (case-insensitive)
 */
export function isLanchoOrder(order: OrderClassificationFields): boolean {
  if (!order) return false;
  const area = (order.area || '').trim().toUpperCase();
  const orderType = (order.order_type || '').trim().toUpperCase();
  const paymentType = (order.payment_type || '').trim().toLowerCase();

  return area === 'LANCHO' || orderType === 'LANCHO' || paymentType.includes('lancho');
}

/**
 * Checks if an order belongs to the Snacks Stall business unit.
 * Rule: Petpooja order type 'Delivery (Parcel)' is EXCLUSIVELY used for Snacks Stall.
 * CRITICAL CONSTRAINT: Lancho orders are strictly excluded.
 */
export function isSnacksStallOrder(order: OrderClassificationFields): boolean {
  if (!order || isLanchoOrder(order)) return false;
  const t = (order.order_type || '').trim().toLowerCase();
  return t === 'delivery(parcel)' || t === 'delivery (parcel)' || t === 'delivery' || t === 'snacks stall';
}

/**
 * Checks if an order belongs to Takeaway / Parcel.
 */
export function isTakeawayOrder(order: OrderClassificationFields): boolean {
  if (!order || isLanchoOrder(order) || isSnacksStallOrder(order)) return false;
  const t = (order.order_type || '').trim().toLowerCase();
  const area = (order.area || '').trim().toLowerCase();
  return t === 'pick up' || t === 'pickup' || t === 'takeaway' || area === 'parcel';
}

/**
 * Checks if an order is Dine In.
 */
export function isDineInOrder(order: OrderClassificationFields): boolean {
  if (!order || isLanchoOrder(order) || isSnacksStallOrder(order) || isTakeawayOrder(order)) return false;
  return true;
}

export type BusinessUnit = 'Dine In' | 'Snacks Stall' | 'Takeaway' | 'Lancho';

/**
 * Resolves the canonical business unit / channel for an order.
 */
export function getOrderBusinessUnit(order: OrderClassificationFields): BusinessUnit {
  if (isLanchoOrder(order)) return 'Lancho';
  if (isSnacksStallOrder(order)) return 'Snacks Stall';
  if (isTakeawayOrder(order)) return 'Takeaway';
  return 'Dine In';
}
