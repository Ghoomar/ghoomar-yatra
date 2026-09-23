/**
 * Runtime Missing-Key Detection and Audit Registry
 */

const missingKeys = new Set<string>();

export function recordMissingKey(locale: string, key: string): string {
  const identifier = `[${locale}] ${key}`;
  missingKeys.add(identifier);

  if (typeof window !== 'undefined') {
    (window as any).__ghoomar_missing_keys = Array.from(missingKeys);
  }

  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[i18n:missing] Missing translation key for locale "${locale}": "${key}"`);
    return `[MISSING: ${key}]`;
  }

  return key;
}

export function getMissingKeys(): string[] {
  return Array.from(missingKeys);
}

export function clearMissingKeys(): void {
  missingKeys.clear();
  if (typeof window !== 'undefined') {
    (window as any).__ghoomar_missing_keys = [];
  }
}
