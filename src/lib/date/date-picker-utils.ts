/**
 * Date Picker utility functions for Ghoomar Yatra ERP.
 * Strictly maintains DD-MM-YYYY display and YYYY-MM-DD ISO storage without timezone shifts.
 */

export interface CalendarDay {
  year: number;
  month: number; // 1 - 12
  day: number;
  iso: string; // YYYY-MM-DD
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDisabled: boolean;
}

export function padZero(num: number): string {
  return num < 10 ? `0${num}` : `${num}`;
}

/**
 * Converts a YYYY-MM-DD ISO string to DD-MM-YYYY display string.
 */
export function formatToDisplay(isoDate?: string | null): string {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const clean = isoDate.trim().slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3 && parts[0].length === 4 && parts[1].length === 2 && parts[2].length === 2) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return isoDate;
}

/**
 * Converts a DD-MM-YYYY (or DD/MM/YYYY, DD.MM.YYYY, DDMMYYYY) display string to YYYY-MM-DD.
 * Returns null if invalid.
 */
export function parseDisplayToISO(input?: string | null): string | null {
  if (!input || typeof input !== 'string') return null;
  const clean = input.trim();
  if (!clean) return null;

  // Handle DDMMYYYY continuous digits
  if (/^\d{8}$/.test(clean)) {
    const d = parseInt(clean.slice(0, 2), 10);
    const m = parseInt(clean.slice(2, 4), 10);
    const y = parseInt(clean.slice(4, 8), 10);
    return validateAndBuildISO(y, m, d);
  }

  // Handle delimiter separated (-, /, .)
  const parts = clean.split(/[-/.]/);
  if (parts.length === 3) {
    // Check if input is already YYYY-MM-DD
    if (parts[0].length === 4 && parts[1].length <= 2 && parts[2].length <= 2) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      return validateAndBuildISO(y, m, d);
    }
    // Otherwise expect DD-MM-YYYY
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    return validateAndBuildISO(y, m, d);
  }

  return null;
}

/**
 * Validates year, month, day and builds YYYY-MM-DD string.
 */
export function validateAndBuildISO(year: number, month: number, day: number): string | null {
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;

  const daysInMonth = getDaysInMonth(year, month);
  if (day < 1 || day > daysInMonth) return null;

  return `${year}-${padZero(month)}-${padZero(day)}`;
}

/**
 * Returns the number of days in a given year and month (1-12).
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Returns today's date in YYYY-MM-DD format (local time).
 */
export function getTodayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${padZero(now.getMonth() + 1)}-${padZero(now.getDate())}`;
}

/**
 * Returns yesterday's date in YYYY-MM-DD format (local time).
 */
export function getYesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`;
}

/**
 * Builds a 42-cell Monday-first calendar grid for a given year and month (1-12).
 */
export function getCalendarGrid(
  viewYear: number,
  viewMonth: number,
  selectedISO?: string | null,
  minISO?: string | null,
  maxISO?: string | null
): CalendarDay[] {
  const todayISO = getTodayISO();
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);

  // Determine starting weekday of the 1st of this month
  // In JS: 0=Sun, 1=Mon, ..., 6=Sat
  const firstDay = new Date(viewYear, viewMonth - 1, 1);
  // Monday-first offset: Mon=0, Tue=1, ..., Sun=6
  const startOffset = (firstDay.getDay() + 6) % 7;

  // Previous month details
  const prevMonth = viewMonth === 1 ? 12 : viewMonth - 1;
  const prevYear = viewMonth === 1 ? viewYear - 1 : viewYear;
  const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);

  // Next month details
  const nextMonth = viewMonth === 12 ? 1 : viewMonth + 1;
  const nextYear = viewMonth === 12 ? viewYear + 1 : viewYear;

  const cells: CalendarDay[] = [];

  // 1. Previous month padding cells
  for (let i = startOffset - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const iso = `${prevYear}-${padZero(prevMonth)}-${padZero(day)}`;
    cells.push({
      year: prevYear,
      month: prevMonth,
      day,
      iso,
      isCurrentMonth: false,
      isToday: iso === todayISO,
      isSelected: iso === selectedISO,
      isDisabled: isDateDisabled(iso, minISO, maxISO),
    });
  }

  // 2. Current month cells
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${viewYear}-${padZero(viewMonth)}-${padZero(day)}`;
    cells.push({
      year: viewYear,
      month: viewMonth,
      day,
      iso,
      isCurrentMonth: true,
      isToday: iso === todayISO,
      isSelected: iso === selectedISO,
      isDisabled: isDateDisabled(iso, minISO, maxISO),
    });
  }

  // 3. Next month padding cells to complete 42 cells (6 full weeks)
  const remaining = 42 - cells.length;
  for (let day = 1; day <= remaining; day++) {
    const iso = `${nextYear}-${padZero(nextMonth)}-${padZero(day)}`;
    cells.push({
      year: nextYear,
      month: nextMonth,
      day,
      iso,
      isCurrentMonth: false,
      isToday: iso === todayISO,
      isSelected: iso === selectedISO,
      isDisabled: isDateDisabled(iso, minISO, maxISO),
    });
  }

  return cells;
}

export function isDateDisabled(iso: string, minISO?: string | null, maxISO?: string | null): boolean {
  if (minISO && iso < minISO) return true;
  if (maxISO && iso > maxISO) return true;
  return false;
}

/**
 * Formats a time string HH:mm or HH:mm:ss to HH:mm
 */
export function formatTime24(timeStr?: string | null): string {
  if (!timeStr) return '12:00';
  const clean = timeStr.trim();
  const match = clean.match(/^(\d{1,2}):(\d{2})/);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${padZero(h)}:${padZero(m)}`;
    }
  }
  return '12:00';
}
