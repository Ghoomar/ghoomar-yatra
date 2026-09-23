import { Locale } from '@/locales';

/**
 * Helper to retrieve localized names from controlled bilingual master data tables.
 * Safe fallback: if Hindi name is not yet specified, gracefully returns English name.
 */

export interface BilingualNamedEntity {
  name: string;
  name_hi?: string | null;
}

export interface BilingualUnitEntity extends BilingualNamedEntity {
  symbol: string;
  symbol_hi?: string | null;
}

export function getLocalizedMasterName(
  entity: BilingualNamedEntity | null | undefined,
  locale: Locale = 'en'
): string {
  if (!entity) return '';
  if (locale === 'hi' && entity.name_hi && entity.name_hi.trim() !== '') {
    return entity.name_hi;
  }
  return entity.name || '';
}

export function getLocalizedMasterSymbol(
  unit: BilingualUnitEntity | null | undefined,
  locale: Locale = 'en'
): string {
  if (!unit) return '';
  if (locale === 'hi' && unit.symbol_hi && unit.symbol_hi.trim() !== '') {
    return unit.symbol_hi;
  }
  return unit.symbol || '';
}
