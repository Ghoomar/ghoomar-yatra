export const MENU_SALES_CHANNELS = [
  'ALL',
  'DINE_IN',
  'TAKEAWAY',
  'HOME_DELIVERY',
  'LANCHO',
  'UNKNOWN',
] as const;

export type MenuSalesChannel = (typeof MENU_SALES_CHANNELS)[number];

export function parseMenuSalesChannel(value: string | null | undefined): MenuSalesChannel | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return MENU_SALES_CHANNELS.includes(normalized as MenuSalesChannel)
    ? (normalized as MenuSalesChannel)
    : null;
}

/** Mirrors the source-value precedence used by the sales aggregation SQL. */
export function classifyMenuSalesChannel(order: {
  order_type?: string | null;
  area?: string | null;
  payment_type?: string | null;
}): Exclude<MenuSalesChannel, 'ALL'> {
  const orderType = (order.order_type || '').trim().toLowerCase();
  const area = (order.area || '').trim().toLowerCase();
  const paymentType = (order.payment_type || '').trim().toLowerCase();

  if (area.includes('lancho') || orderType.includes('lancho') || paymentType.includes('lancho')) return 'LANCHO';
  if (orderType === 'dine in') return 'DINE_IN';
  if (orderType === 'pick up' && area === 'parcel') return 'TAKEAWAY';
  if (orderType === 'delivery(parcel)' && area === 'home delivery') return 'HOME_DELIVERY';
  return 'UNKNOWN';
}

export function menuSalesChannelTranslationKey(channel: MenuSalesChannel): string {
  switch (channel) {
    case 'ALL': return 'sops.menu.channelAll';
    case 'DINE_IN': return 'sops.menu.channelDineIn';
    case 'TAKEAWAY': return 'sops.menu.channelTakeaway';
    case 'HOME_DELIVERY': return 'sops.menu.channelHomeDelivery';
    case 'LANCHO': return 'sops.menu.channelLancho';
    case 'UNKNOWN': return 'sops.menu.channelUnknown';
  }
}

/** Map reporting filters onto existing cost allocation choices without changing costing rules. */
export function menuSalesCostChannel(channel: MenuSalesChannel): 'DINE_IN' | 'TAKEAWAY' | undefined {
  if (channel === 'DINE_IN') return 'DINE_IN';
  if (channel === 'TAKEAWAY' || channel === 'HOME_DELIVERY') return 'TAKEAWAY';
  return undefined;
}
