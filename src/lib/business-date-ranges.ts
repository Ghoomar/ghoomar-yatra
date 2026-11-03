export type BusinessDatePreset = 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'all' | 'custom';

export type BusinessDateRange = {
  from: string | null;
  to: string | null;
  status: 'ready' | 'empty' | 'needs-range' | 'invalid';
};

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return formatDate(Number(part('year')), Number(part('month')), Number(part('day')));
}

function shiftDate(date: string, offsetDays: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

/** Calculate inclusive business-date boundaries in Asia/Kolkata. `now` is injectable for deterministic callers and tests. */
export function getBusinessDateRange(
  preset: BusinessDatePreset,
  now: Date = new Date(),
  customFrom = '',
  customTo = '',
): BusinessDateRange {
  const today = dateInTimezone(now, 'Asia/Kolkata');
  const yesterday = shiftDate(today, -1);

  if (preset === 'all') return { from: null, to: null, status: 'ready' };
  if (preset === 'today') return { from: today, to: today, status: 'ready' };
  if (preset === 'yesterday') return { from: yesterday, to: yesterday, status: 'ready' };

  if (preset === '7d' || preset === '30d') {
    const days = preset === '7d' ? 7 : 30;
    return { from: shiftDate(yesterday, -(days - 1)), to: yesterday, status: 'ready' };
  }

  if (preset === 'this_month') {
    const monthStart = `${today.slice(0, 7)}-01`;
    return monthStart > yesterday
      ? { from: monthStart, to: yesterday, status: 'empty' }
      : { from: monthStart, to: yesterday, status: 'ready' };
  }

  if (!customFrom || !customTo) return { from: customFrom || null, to: customTo || null, status: 'needs-range' };
  if (!isValidDate(customFrom) || !isValidDate(customTo) || customFrom > customTo) {
    return { from: customFrom, to: customTo, status: 'invalid' };
  }

  return { from: customFrom, to: customTo, status: 'ready' };
}
