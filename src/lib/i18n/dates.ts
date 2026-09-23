import { Locale } from '@/locales';

/**
 * Localized date and time formatting utilities
 */

export function formatDisplayDateLocalized(
  dateStr: string | null | undefined,
  format: 'short' | 'medium' | 'long' = 'medium',
  locale: Locale = 'en'
): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts.map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return dateStr;
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dateObj.getTime())) return dateStr;

  const intlLocale = locale === 'hi' ? 'hi-IN' : 'en-IN';

  if (format === 'long') {
    return dateObj.toLocaleDateString(intlLocale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  return dateObj.toLocaleDateString(intlLocale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatTimeAgoLocalized(
  dateInput: string | Date | null | undefined,
  locale: Locale = 'en'
): string {
  if (!dateInput) return locale === 'hi' ? 'कभी नहीं' : 'Never';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) {
    return locale === 'hi' ? 'अभी-अभी' : 'Just now';
  }
  if (diffMinutes < 60) {
    return locale === 'hi' ? `${diffMinutes} मिनट पहले` : `${diffMinutes}m ago`;
  }

  const intlLocale = locale === 'hi' ? 'hi-IN' : 'en-IN';
  return date.toLocaleTimeString(intlLocale, {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
