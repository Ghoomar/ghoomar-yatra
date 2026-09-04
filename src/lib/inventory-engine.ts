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

export function calculateStockFromMovements(movements: Array<{ movement_type: string; quantity: number }>): number {
  return movements.reduce((acc, m) => {
    switch (m.movement_type) {
      case 'opening':
      case 'purchase':
      case 'adjustment_inc':
        return acc + m.quantity;
      case 'issue':
      case 'staff_food':
      case 'wastage':
      case 'spoilage':
      case 'breakage':
      case 'adjustment_dec':
        return acc - m.quantity;
      case 'count_adjustment':
        return acc + m.quantity; // positive or negative
      default:
        return acc;
    }
  }, 0);
}

export function calculatePhysicalCountVariance(expected: number, actual: number, wac: number) {
  const varianceQuantity = actual - expected;
  const varianceValue = Number((varianceQuantity * wac).toFixed(2));
  return {
    varianceQuantity,
    varianceValue,
    isShortage: varianceQuantity < 0,
    isSurplus: varianceQuantity > 0,
  };
}
