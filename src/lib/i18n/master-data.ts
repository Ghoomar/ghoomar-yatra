import { Locale } from '@/locales';

/**
 * Helper to retrieve localized names from controlled bilingual master data tables.
 * Safe fallback: if Hindi name is not yet specified, gracefully returns English name.
 */

export interface BilingualNamedEntity {
  name?: string | null;
  name_hi?: string | null;
}

export interface BilingualUnitEntity {
  symbol?: string | null;
  symbol_hi?: string | null;
  name?: string | null;
  name_hi?: string | null;
}

export function getLocalizedMasterName(
  entity: BilingualNamedEntity | BilingualNamedEntity[] | null | undefined,
  locale: Locale = 'en'
): string {
  if (!entity) return '';
  const target = Array.isArray(entity) ? entity[0] : entity;
  if (!target) return '';
  if (locale === 'hi' && target.name_hi && target.name_hi.trim() !== '') {
    return target.name_hi;
  }
  return target.name || '';
}

export function getLocalizedMasterSymbol(
  unit: BilingualUnitEntity | BilingualUnitEntity[] | null | undefined,
  locale: Locale = 'en'
): string {
  if (!unit) return '';
  const target = Array.isArray(unit) ? unit[0] : unit;
  if (!target) return '';
  if (locale === 'hi' && target.symbol_hi && target.symbol_hi.trim() !== '') {
    return target.symbol_hi;
  }
  return target.symbol || '';
}
