import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(amount: number | null | undefined, compact = false): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '₹0';
  
  if (compact) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    if (abs >= 10000000) {
      return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
    }
    if (abs >= 100000) {
      return `${sign}₹${(abs / 100000).toFixed(1)}L`;
    }
    if (abs >= 1000) {
      return `${sign}₹${(abs / 1000).toFixed(1)}K`;
    }
    return `${sign}₹${abs.toFixed(0)}`;
  }

  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const parts = absAmount.toFixed(2).split('.');
  const intPart = parts[0];
  const decPart = parts[1] === '00' ? '' : '.' + parts[1];

  const lastThree = intPart.substring(intPart.length - 3);
  const otherNumbers = intPart.substring(0, intPart.length - 3);
  const formatted = otherNumbers !== '' 
    ? otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree 
    : lastThree;

  return `${isNegative ? '-' : ''}₹${formatted}${decPart}`;
}

export function formatNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '0';
  return new Intl.NumberFormat('en-IN').format(val);
}

export function formatPercent(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '0%';
  return `${val.toFixed(1)}%`;
}

export function getTodayBusinessDate(): string {
  // Financial business day 12:00 AM - 11:59 PM in Indian Standard Time (IST, UTC+05:30)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

export function getDaysInMonth(year: number, month: number): number {
  // month is 1-indexed (1 = Jan, 2 = Feb, etc.)
  return new Date(year, month, 0).getDate();
}

export function getMonthDateRange(businessDate: string) {
  const [yearStr, monthStr, dayStr] = businessDate.split('-');
  const year = parseInt(yearStr, 10) || new Date().getFullYear();
  const month = parseInt(monthStr, 10) || (new Date().getMonth() + 1);
  const day = parseInt(dayStr, 10) || 1;

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = getDaysInMonth(year, month);
  const daysElapsed = Math.min(day, daysInMonth);
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

  return {
    monthStart,
    businessDate,
    year,
    month,
    day,
    daysInMonth,
    daysElapsed,
    daysRemaining,
  };
}

export function formatTimeAgo(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'Never';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}
