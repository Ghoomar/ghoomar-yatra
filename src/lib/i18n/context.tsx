'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Locale, DEFAULT_LOCALE, translations, LOCALES } from '@/locales';
import { recordMissingKey } from './missing-keys';
import { formatDisplayDateLocalized, formatTimeAgoLocalized } from './dates';
import { createClient } from '@/lib/supabase/client';

export interface I18nContextType {
  locale: Locale;
  setLocale: (newLocale: Locale) => Promise<void>;
  t: (path: string, params?: Record<string, string | number | null | undefined>) => string;
  formatDate: (dateStr: string | null | undefined, format?: 'short' | 'medium' | 'long') => string;
  formatTime: (dateInput: string | Date | null | undefined) => string;
  locales: typeof LOCALES;
}

const I18nContext = createContext<I18nContextType>({
  locale: DEFAULT_LOCALE,
  setLocale: async () => {},
  t: (path: string) => path,
  formatDate: () => '',
  formatTime: () => '',
  locales: LOCALES,
});

export const useI18n = () => useContext(I18nContext);

interface I18nProviderProps {
  children: React.ReactNode;
  initialLocale?: Locale;
  userId?: string | null;
  profileLocale?: Locale | null;
}

export function I18nProvider({
  children,
  initialLocale,
  userId,
  profileLocale,
}: I18nProviderProps) {
  const supabase = createClient();

  // 1. Initial State Resolution:
  // User profile locale -> prop initialLocale -> localStorage -> default
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (profileLocale && (profileLocale === 'en' || profileLocale === 'hi')) {
      return profileLocale;
    }
    if (initialLocale && (initialLocale === 'en' || initialLocale === 'hi')) {
      return initialLocale;
    }
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('ghoomar_locale') as Locale;
        if (stored === 'en' || stored === 'hi') {
          return stored;
        }
      } catch {}
    }
    return DEFAULT_LOCALE;
  });

  // Sync when profileLocale resolves after initial async auth fetch
  useEffect(() => {
    if (profileLocale && (profileLocale === 'en' || profileLocale === 'hi') && profileLocale !== locale) {
      setLocaleState(profileLocale);
      try {
        localStorage.setItem('ghoomar_locale', profileLocale);
        document.cookie = `ghoomar_locale=${profileLocale}; path=/; max-age=31536000; SameSite=Lax`;
        document.documentElement.lang = profileLocale;
      } catch {}
    }
  }, [profileLocale]);

  // Synchronize HTML lang attribute
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  // Switcher handler: immediate UI update + account persistence + offline cache
  const handleSetLocale = useCallback(
    async (newLocale: Locale) => {
      if (newLocale === locale) return;

      // 1. Instant local update
      setLocaleState(newLocale);

      // 2. Persist locally (localStorage + Cookie)
      try {
        localStorage.setItem('ghoomar_locale', newLocale);
        document.cookie = `ghoomar_locale=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;
        document.documentElement.lang = newLocale;
      } catch {}

      // 3. Persist to User Account in Supabase (if authenticated)
      if (userId) {
        try {
          await supabase
            .from('profiles')
            .update({ locale: newLocale })
            .eq('id', userId);
        } catch (err) {
          console.warn('[i18n] Failed to persist locale to user profile in Supabase:', err);
        }
      }
    },
    [locale, userId, supabase]
  );

  // Translation lookup function
  const t = useCallback(
    (path: string, params?: Record<string, string | number | null | undefined>): string => {
      const keys = path.split('.');
      const dict = translations[locale] as any;
      const fallbackDict = translations[DEFAULT_LOCALE] as any;

      let value: any = dict;
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          value = undefined;
          break;
        }
      }

      // If missing in current locale, attempt fallback to default (en)
      if (value === undefined || typeof value !== 'string') {
        let fallbackValue: any = fallbackDict;
        for (const k of keys) {
          if (fallbackValue && typeof fallbackValue === 'object' && k in fallbackValue) {
            fallbackValue = fallbackValue[k];
          } else {
            fallbackValue = undefined;
            break;
          }
        }

        // Record missing key
        recordMissingKey(locale, path);

        if (fallbackValue !== undefined && typeof fallbackValue === 'string') {
          value = fallbackValue;
        } else {
          return `[MISSING: ${path}]`;
        }
      }

      // Variable interpolation
      if (params) {
        return value.replace(/\{(\w+)\}/g, (_: string, match: string) => {
          return params[match] !== undefined ? String(params[match]) : `{${match}}`;
        });
      }

      return value;
    },
    [locale]
  );

  const formatDate = useCallback(
    (dateStr: string | null | undefined, format: 'short' | 'medium' | 'long' = 'medium') => {
      return formatDisplayDateLocalized(dateStr, format, locale);
    },
    [locale]
  );

  const formatTime = useCallback(
    (dateInput: string | Date | null | undefined) => {
      return formatTimeAgoLocalized(dateInput, locale);
    },
    [locale]
  );

  const contextValue = useMemo(
    () => ({
      locale,
      setLocale: handleSetLocale,
      t,
      formatDate,
      formatTime,
      locales: LOCALES,
    }),
    [locale, handleSetLocale, t, formatDate, formatTime]
  );

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}
