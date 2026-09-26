/**
 * Canonical Parent Category Color System for Ghoomar Yatra
 * Single source of truth for charts, progress bars, badges, legends, and tables.
 */

export interface CategoryColorDefinition {
  hex: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  dotClass: string;
}

export const CATEGORY_COLORS: Record<string, CategoryColorDefinition> = {
  // Beverages: Sky Blue
  'beverages': {
    hex: '#0284c7', // sky-600
    bgClass: 'bg-sky-50',
    textClass: 'text-sky-700',
    borderClass: 'border-sky-200',
    dotClass: 'bg-sky-500',
  },
  // Indian Main Course: Warm Amber / Saffron
  'indian': {
    hex: '#d97706', // amber-600
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-200',
    dotClass: 'bg-amber-500',
  },
  'indian main course': {
    hex: '#d97706',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-200',
    dotClass: 'bg-amber-500',
  },
  // Main Course
  'main course': {
    hex: '#b45309', // amber-700
    bgClass: 'bg-amber-100/70',
    textClass: 'text-amber-800',
    borderClass: 'border-amber-300',
    dotClass: 'bg-amber-700',
  },
  // Rajasthani Heritage: Rich Terracotta Orange
  'rajasthani': {
    hex: '#ea580c', // orange-600
    bgClass: 'bg-orange-50',
    textClass: 'text-orange-700',
    borderClass: 'border-orange-200',
    dotClass: 'bg-orange-500',
  },
  'rajasthani special': {
    hex: '#ea580c',
    bgClass: 'bg-orange-50',
    textClass: 'text-orange-700',
    borderClass: 'border-orange-200',
    dotClass: 'bg-orange-500',
  },
  // All Day Breakfast: Morning Sunny Gold
  'all day breakfast': {
    hex: '#ca8a04', // yellow-600
    bgClass: 'bg-yellow-50',
    textClass: 'text-yellow-700',
    borderClass: 'border-yellow-200',
    dotClass: 'bg-yellow-500',
  },
  'breakfast': {
    hex: '#ca8a04',
    bgClass: 'bg-yellow-50',
    textClass: 'text-yellow-700',
    borderClass: 'border-yellow-200',
    dotClass: 'bg-yellow-500',
  },
  // Chinese: Szechuan Crimson Red
  'chinese': {
    hex: '#dc2626', // red-600
    bgClass: 'bg-rose-50',
    textClass: 'text-rose-700',
    borderClass: 'border-rose-200',
    dotClass: 'bg-rose-500',
  },
  // Italian: Bistro Herbal Rose
  'italian': {
    hex: '#e11d48', // rose-600
    bgClass: 'bg-pink-50',
    textClass: 'text-pink-700',
    borderClass: 'border-pink-200',
    dotClass: 'bg-pink-500',
  },
  // Soya Specials: Vegetarian Green
  'soya specials': {
    hex: '#16a34a', // green-600
    bgClass: 'bg-emerald-50',
    textClass: 'text-emerald-700',
    borderClass: 'border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  'soya': {
    hex: '#16a34a',
    bgClass: 'bg-emerald-50',
    textClass: 'text-emerald-700',
    borderClass: 'border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  // Royal Thali: Purple
  'thali': {
    hex: '#7c3aed', // purple-600
    bgClass: 'bg-purple-50',
    textClass: 'text-purple-700',
    borderClass: 'border-purple-200',
    dotClass: 'bg-purple-500',
  },
  // Desserts: Mint Emerald
  'desserts': {
    hex: '#059669', // emerald-600
    bgClass: 'bg-emerald-50',
    textClass: 'text-emerald-700',
    borderClass: 'border-emerald-200',
    dotClass: 'bg-emerald-600',
  },
  // Soups & Starters: Deep Teal
  'soups & starters': {
    hex: '#0d9488', // teal-600
    bgClass: 'bg-teal-50',
    textClass: 'text-teal-700',
    borderClass: 'border-teal-200',
    dotClass: 'bg-teal-500',
  },
  'starters': {
    hex: '#0d9488',
    bgClass: 'bg-teal-50',
    textClass: 'text-teal-700',
    borderClass: 'border-teal-200',
    dotClass: 'bg-teal-500',
  },
  // Tandoori Breads: Baked Brown
  'tandoori breads': {
    hex: '#92400e', // amber-800
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-900',
    borderClass: 'border-amber-300',
    dotClass: 'bg-amber-800',
  },
  'breads': {
    hex: '#92400e',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-900',
    borderClass: 'border-amber-300',
    dotClass: 'bg-amber-800',
  },
  // Raita & Salads: Garden Indigo
  'raita & salads': {
    hex: '#4f46e5', // indigo-600
    bgClass: 'bg-indigo-50',
    textClass: 'text-indigo-700',
    borderClass: 'border-indigo-200',
    dotClass: 'bg-indigo-500',
  },
  // Snacks / Street Food: Tangerine Orange
  'snacks': {
    hex: '#f59e0b', // amber-500
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-800',
    borderClass: 'border-amber-200',
    dotClass: 'bg-amber-500',
  },
  'street food': {
    hex: '#f59e0b',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-800',
    borderClass: 'border-amber-200',
    dotClass: 'bg-amber-500',
  },
  // Neutral Stone
  'other': {
    hex: '#78716c', // stone-500
    bgClass: 'bg-stone-100',
    textClass: 'text-stone-700',
    borderClass: 'border-stone-200',
    dotClass: 'bg-stone-500',
  },
  'uncategorized': {
    hex: '#a8a29e', // stone-400
    bgClass: 'bg-stone-100',
    textClass: 'text-stone-600',
    borderClass: 'border-stone-200',
    dotClass: 'bg-stone-400',
  },
};

export const FALLBACK_COLOR_PALETTE = [
  '#0284c7', // sky-600
  '#d97706', // amber-600
  '#ea580c', // orange-600
  '#7c3aed', // purple-600
  '#16a34a', // green-600
  '#dc2626', // red-600
  '#0d9488', // teal-600
  '#e11d48', // rose-600
  '#ca8a04', // yellow-600
  '#4f46e5', // indigo-600
];

/**
 * Returns the hex color string for a given parent category name.
 * Resolves colors strictly from:
 * 1. Database-configured Parent Category master mapping (`colorOverrides`)
 * 2. Canonical CATEGORY_COLORS dictionary
 * 3. Deterministic string-based hash fallback into palette (NO array indexing or chart order fallbacks)
 */
export function getCategoryColor(
  categoryName?: string | null,
  colorOverrides?: Record<string, string> | number | null
): string {
  if (!categoryName) return '#78716c';
  const key = categoryName.trim().toLowerCase();

  // 1. Database-driven Parent Category color override (from pos_parent_categories)
  if (typeof colorOverrides === 'object' && colorOverrides !== null && colorOverrides[key]) {
    return colorOverrides[key];
  }

  // 2. Canonical color definition
  if (CATEGORY_COLORS[key]) {
    return CATEGORY_COLORS[key].hex;
  }

  // 3. Fallback to clean deterministic palette based strictly on string hashing (NO array index or chart order)
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return FALLBACK_COLOR_PALETTE[Math.abs(hash) % FALLBACK_COLOR_PALETTE.length];
}

/**
 * Returns Tailwind class strings for rendering a consistent category badge
 */
export function getCategoryBadgeClasses(categoryName?: string | null): string {
  if (!categoryName) return 'bg-stone-100 text-stone-600 border-stone-200';
  const key = categoryName.trim().toLowerCase();
  const def = CATEGORY_COLORS[key];
  if (def) {
    return `${def.bgClass} ${def.textClass} ${def.borderClass}`;
  }
  return 'bg-stone-100 text-stone-700 border-stone-200';
}

/**
 * Returns Tailwind class for dot indicator
 */
export function getCategoryDotClass(categoryName?: string | null): string {
  if (!categoryName) return 'bg-stone-400';
  const key = categoryName.trim().toLowerCase();
  const def = CATEGORY_COLORS[key];
  if (def) {
    return def.dotClass;
  }
  return 'bg-stone-400';
}
