export interface WACCalculationInput {
  currentStock: number;
  currentWAC: number;
  receivedQuantity: number;
  purchaseRate: number;
}

export function calculateNewWAC({
  currentStock,
  currentWAC,
  receivedQuantity,
  purchaseRate,
}: WACCalculationInput): number {
  if (receivedQuantity <= 0) return currentWAC;
  
  const existingStock = Math.max(0, currentStock);
  const existingTotalValue = existingStock * currentWAC;
  const newReceiptValue = receivedQuantity * purchaseRate;
  const newTotalQuantity = existingStock + receivedQuantity;

  if (newTotalQuantity <= 0) return 0;
  return Number(( (existingTotalValue + newReceiptValue) / newTotalQuantity ).toFixed(2));
}

export function calculateStockFromMovements(
  movements: Array<{ 
    movement_type: string; 
    quantity: number; 
    source_location_id?: string | null; 
    destination_location_id?: string | null; 
  }>,
  locationId?: string | null
): number {
  return movements.reduce((acc, m) => {
    const absQty = Math.abs(Number(m.quantity) || 0);

    // If filtering by specific location
    if (locationId) {
      if (m.destination_location_id === locationId) {
        if (m.movement_type === 'count_adjustment' || m.movement_type === 'physical_count_adjustment') {
          return acc + Number(m.quantity);
        }
        return acc + absQty;
      }
      if (m.source_location_id === locationId) {
        return acc - absQty;
      }
      return acc;
    }

    // Business-wide consolidation
    switch (m.movement_type) {
      case 'opening':
      case 'purchase':
      case 'return':
      case 'adjustment_inc':
        return acc + absQty;
      case 'issue':
      case 'sale':
      case 'consumption':
      case 'staff_food':
      case 'wastage':
      case 'spoilage':
      case 'breakage':
      case 'loss':
      case 'adjustment_dec':
        return acc - absQty;
      case 'count_adjustment':
      case 'physical_count_adjustment':
        return acc + Number(m.quantity); // positive or negative variance
      case 'transfer':
        return acc; // Inter-location transfer has 0 net effect on total business-wide stock
      default:
        return acc;
    }
  }, 0);
}

export function calculatePhysicalCountVariance(expected: number, actual: number, wac: number) {
  const varianceQuantity = Number((actual - expected).toFixed(3));
  const varianceValue = Number((varianceQuantity * wac).toFixed(2));
  return {
    varianceQuantity,
    varianceValue,
    isShortage: varianceQuantity < 0,
    isSurplus: varianceQuantity > 0,
  };
}

export function convertPackQuantity(
  quantity: number,
  conversionFactor: number = 1,
  isPackToUnit: boolean = true
): number {
  const factor = Number(conversionFactor) || 1;
  if (factor <= 0) return quantity;
  return isPackToUnit ? Number((quantity * factor).toFixed(3)) : Number((quantity / factor).toFixed(3));
}
