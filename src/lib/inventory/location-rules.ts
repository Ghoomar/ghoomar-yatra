const MANDATORY_LOCATION_CODES = new Set(['STORE', 'KITCHEN-MAIN']);

export function isMandatoryInventoryLocation(code: string | null | undefined): boolean {
  return MANDATORY_LOCATION_CODES.has((code || '').trim().toUpperCase());
}

export function isNonZeroStockBalance(quantity: number | string | null | undefined): boolean {
  const value = Number(quantity);
  return Number.isFinite(value) && value !== 0;
}
