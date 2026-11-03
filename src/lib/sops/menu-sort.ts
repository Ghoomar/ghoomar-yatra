export type MenuSortOrder = 'asc' | 'desc';

/** Sorts finite numeric values numerically and consistently keeps missing values last. */
export function compareNullableNumbers(
  aNum: number | null | undefined,
  bNum: number | null | undefined,
  sortOrder: MenuSortOrder,
): number {
  const aValid = aNum != null && !Number.isNaN(aNum);
  const bValid = bNum != null && !Number.isNaN(bNum);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return sortOrder === 'asc' ? aNum - bNum : bNum - aNum;
}
