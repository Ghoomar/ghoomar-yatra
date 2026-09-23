import enCommon from './en/common.json';
import enNavigation from './en/navigation.json';
import enGate from './en/gate.json';
import enStatuses from './en/statuses.json';
import enErrors from './en/errors.json';
import enAttendance from './en/attendance.json';
import enPeople from './en/people.json';
import enInventory from './en/inventory.json';
import enPurchases from './en/purchases.json';
import enOperations from './en/operations.json';

import hiCommon from './hi/common.json';
import hiNavigation from './hi/navigation.json';
import hiGate from './hi/gate.json';
import hiStatuses from './hi/statuses.json';
import hiErrors from './hi/errors.json';
import hiAttendance from './hi/attendance.json';
import hiPeople from './hi/people.json';
import hiInventory from './hi/inventory.json';
import hiPurchases from './hi/purchases.json';
import hiOperations from './hi/operations.json';

export type Locale = 'en' | 'hi';

export const LOCALES: { code: Locale; label: string; nativeLabel: string }[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिंदी' },
];

export const DEFAULT_LOCALE: Locale = 'en';

export const enTranslations = {
  common: enCommon,
  navigation: enNavigation,
  gate: enGate,
  statuses: enStatuses,
  errors: enErrors,
  attendance: enAttendance,
  people: enPeople,
  inventory: enInventory,
  purchases: enPurchases,
  operations: enOperations,
};

export const hiTranslations = {
  common: hiCommon,
  navigation: hiNavigation,
  gate: hiGate,
  statuses: hiStatuses,
  errors: hiErrors,
  attendance: hiAttendance,
  people: hiPeople,
  inventory: hiInventory,
  purchases: hiPurchases,
  operations: hiOperations,
};

export const translations: Record<Locale, typeof enTranslations> = {
  en: enTranslations,
  hi: hiTranslations,
};

export type TranslationsSchema = typeof enTranslations;
