'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';
import { useAppRole } from '@/components/layout/AppShell';
import { canViewCosting } from '@/lib/rbac';
import { formatINR, formatNumber, formatNullablePrice } from '@/lib/utils';
import { getBusinessDateRange } from '@/lib/business-date-ranges';
import { compareNullableNumbers } from '@/lib/sops/menu-sort';
import { MENU_SALES_CHANNELS, menuSalesChannelTranslationKey, type MenuSalesChannel } from '@/lib/sales/menu-channels';
import type { YatraComboThali } from '@/lib/sops/costing/types';
import { getCategoryColor } from '@/lib/constants/category-colors';
import {
  UtensilsCrossed,
  Sparkles,
  TrendingUp,
  DollarSign,
  Search,
  RefreshCw,
  AlertTriangle,
  Lock,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Filter,
  Layers,
  Star,
  Activity,
  HelpCircle,
  Flame,
  ArrowRight,
  ShoppingBag,
  Calendar,
} from 'lucide-react';

type MenuSortField =
  | 'name'
  | 'category'
  | 'price'
  | 'variant'
  | 'food_cost'
  | 'food_cost_pct'
  | 'margin'
  | 'units_sold'
  | 'revenue'
  | 'quadrant';

type SortOrder = 'asc' | 'desc';

interface MenuCatalogMatrixSource {
  id: string;
  name: string;
  quadrant?: string | null;
  unitsSold?: number | null;
  netRevenue?: number | null;
  defaultVariant?: { food_cost?: number | null } | null;
  foodCostPct?: number | null;
  unitContributionMargin?: number | null;
}

/**
 * Natural BCG Domain Rank Ordering:
 * STAR (1) -> PLOWHORSE (2) -> PUZZLE (3) -> DOG (4) ->
 * COSTING_INCOMPLETE (5) -> UNCOSTED (6) -> INELIGIBLE (7) -> null / unclassified (8)
 */
const BCG_RANK: Record<string, number> = {
  STAR: 1,
  PLOWHORSE: 2,
  PUZZLE: 3,
  DOG: 4,
  COSTING_INCOMPLETE: 5,
  UNCOSTED: 6,
  INELIGIBLE: 7,
};

const UNCLASSIFIED_RANK = 8;

/**
 * Numeric and financial fields default to 'desc' (highest to lowest) on first click.
 * Text and domain rank fields default to 'asc' (A-Z or Stars-first) on first click.
 */
const NUMERIC_FINANCIAL_SORT_FIELDS: ReadonlySet<MenuSortField> = new Set([
  'price',
  'food_cost',
  'food_cost_pct',
  'margin',
  'units_sold',
  'revenue',
]);

interface ColumnDefinition {
  key: MenuSortField;
  labelKey: string;
  align: 'left' | 'right';
  className?: string;
}

const CATALOG_COLUMNS: ColumnDefinition[] = [
  { key: 'name', labelKey: 'sops.menu.colItem', align: 'left', className: 'min-w-[180px]' },
  { key: 'category', labelKey: 'sops.menu.colCategory', align: 'left', className: 'min-w-[130px]' },
  { key: 'price', labelKey: 'sops.menu.colPrice', align: 'right', className: 'min-w-[100px]' },
  { key: 'variant', labelKey: 'sops.menu.colVariant', align: 'left', className: 'min-w-[140px]' },
  { key: 'food_cost', labelKey: 'sops.menu.colFoodCost', align: 'right', className: 'min-w-[100px]' },
  { key: 'food_cost_pct', labelKey: 'sops.menu.colFoodCostPct', align: 'right', className: 'min-w-[90px]' },
  { key: 'margin', labelKey: 'sops.menu.colMargin', align: 'right', className: 'min-w-[100px]' },
  { key: 'units_sold', labelKey: 'sops.menu.colUnitsSold', align: 'right', className: 'min-w-[90px]' },
  { key: 'revenue', labelKey: 'sops.menu.colNetRevenue', align: 'right', className: 'min-w-[110px]' },
  { key: 'quadrant', labelKey: 'sops.menu.colQuadrant', align: 'left', className: 'min-w-[110px]' },
];

/**
 * Compares two nullable numbers with deterministic NULLS_LAST semantics.
 * In both 'asc' and 'desc', items with null/undefined values are sorted to the bottom.
 */
/**
 * Compares two nullable strings with deterministic NULLS_LAST semantics.
 * In both 'asc' and 'desc', items with null/undefined/empty values are sorted to the bottom.
 */
function compareNullableStrings(
  aStr: string | null | undefined,
  bStr: string | null | undefined,
  sortOrder: SortOrder,
  locale?: string
): number {
  const aValid = aStr != null && aStr.trim().length > 0;
  const bValid = bStr != null && bStr.trim().length > 0;
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;  // nulls sort to bottom in both asc and desc
  if (!bValid) return -1; // nulls sort to bottom in both asc and desc
  const diff = aStr!.trim().localeCompare(bStr!.trim(), locale || 'en', {
    sensitivity: 'base',
    numeric: true,
  });
  return sortOrder === 'asc' ? diff : -diff;
}

/**
 * Compares two strings with natural collation and locale awareness.
 */
function compareStrings(
  aStr: string | null | undefined,
  bStr: string | null | undefined,
  sortOrder: SortOrder,
  locale?: string
): number {
  const aVal = aStr?.trim() || '';
  const bVal = bStr?.trim() || '';
  const diff = aVal.localeCompare(bVal, locale || 'en', {
    sensitivity: 'base',
    numeric: true,
  });
  return sortOrder === 'asc' ? diff : -diff;
}

/**
 * Compares categories: Parent Category first, then Subcategory.
 */
function compareCategories(
  a: any,
  b: any,
  sortOrder: SortOrder,
  locale?: string
): number {
  const pA = a.parent_category?.trim() || '';
  const pB = b.parent_category?.trim() || '';
  let diff = pA.localeCompare(pB, locale || 'en', { sensitivity: 'base' });

  if (diff === 0) {
    const cA = a.category?.trim() || '';
    const cB = b.category?.trim() || '';
    diff = cA.localeCompare(cB, locale || 'en', { sensitivity: 'base' });
  }

  return sortOrder === 'asc' ? diff : -diff;
}

/**
 * Compares BCG Quadrants according to domain hierarchy:
 * STAR (1) -> PLOWHORSE (2) -> PUZZLE (3) -> DOG (4) ->
 * COSTING_INCOMPLETE (5) -> UNCOSTED (6) -> INELIGIBLE (7) -> null (8)
 *
 * In both 'asc' and 'desc', non-matrix / unclassified items (ranks > 4) sort to the bottom
 * (preserving their natural secondary order: incomplete -> uncosted -> ineligible -> null).
 * Only classified matrix items (STAR -> PLOWHORSE -> PUZZLE -> DOG) invert in 'desc'.
 */
function compareQuadrants(
  a: any,
  b: any,
  sortOrder: SortOrder
): number {
  const rankA = BCG_RANK[a.quadrant] ?? UNCLASSIFIED_RANK;
  const rankB = BCG_RANK[b.quadrant] ?? UNCLASSIFIED_RANK;
  const aIsClassified = rankA <= 4;
  const bIsClassified = rankB <= 4;

  if (!aIsClassified && !bIsClassified) {
    return rankA - rankB; // secondary natural order (5->6->7->8) at the bottom
  }
  if (!aIsClassified) return 1;  // non-matrix sorts to bottom in both asc and desc
  if (!bIsClassified) return -1; // non-matrix sorts to bottom in both asc and desc

  const diff = rankA - rankB;
  return sortOrder === 'asc' ? diff : -diff;
}

/**
 * Master multi-column item comparator with stable tie-breaking.
 */
function compareCatalogItems(
  a: any,
  b: any,
  sortField: MenuSortField,
  sortOrder: SortOrder,
  locale?: string
): number {
  let diff = 0;

  switch (sortField) {
    case 'name':
      diff = compareStrings(a.name, b.name, sortOrder, locale);
      break;

    case 'category':
      diff = compareCategories(a, b, sortOrder, locale);
      break;

    case 'price': {
      const pA = a.price != null && !isNaN(Number(a.price)) ? Number(a.price) : null;
      const pB = b.price != null && !isNaN(Number(b.price)) ? Number(b.price) : null;
      diff = compareNullableNumbers(pA, pB, sortOrder);
      break;
    }

    case 'variant':
      diff = compareNullableStrings(
        a.defaultVariant?.variant_name,
        b.defaultVariant?.variant_name,
        sortOrder,
        locale
      );
      break;

    case 'food_cost':
      diff = compareNullableNumbers(
        a.defaultVariant?.food_cost,
        b.defaultVariant?.food_cost,
        sortOrder
      );
      break;

    case 'food_cost_pct':
      diff = compareNullableNumbers(
        a.defaultVariant?.food_cost_pct,
        b.defaultVariant?.food_cost_pct,
        sortOrder
      );
      break;

    case 'margin':
      diff = compareNullableNumbers(
        a.defaultVariant?.margin_amount,
        b.defaultVariant?.margin_amount,
        sortOrder
      );
      break;

    case 'units_sold':
      diff = compareNullableNumbers(
        Number(a.unitsSold) || 0,
        Number(b.unitsSold) || 0,
        sortOrder
      );
      break;

    case 'revenue':
      diff = compareNullableNumbers(
        Number(a.netRevenue) || 0,
        Number(b.netRevenue) || 0,
        sortOrder
      );
      break;

    case 'quadrant':
      diff = compareQuadrants(a, b, sortOrder);
      break;
  }

  // Stable Tie-Breaker 1: Item Name A-Z
  if (diff === 0) {
    diff = (a.name || '').localeCompare(b.name || '', locale || 'en', {
      sensitivity: 'base',
      numeric: true,
    });
  }

  // Stable Tie-Breaker 2: Item ID (Guarantees 100% strict total order)
  if (diff === 0) {
    diff = (a.id || '').localeCompare(b.id || '');
  }

  return diff;
}

function MenuMasterContent() {
  const { t, locale } = useI18n();
  const { hasPermission, role: activeRole, permissions } = useAppRole();
  const router = useRouter();
  const searchParams = useSearchParams();

  const canManage = hasPermission('sops.recipes.manage');
  const hasCostAccess = canViewCosting(activeRole, permissions);

  // Active top tab: catalog vs matrix vs combos
  const [activeTab, setActiveTab] = useState<'catalog' | 'matrix' | 'combos'>('catalog');

  // Channel toggle: DINE_IN vs TAKEAWAY
  const [channel, setChannel] = useState<MenuSalesChannel>('ALL');

  // Date range presets for matrix and sales
  type DatePreset = 'yesterday' | '7d' | '30d' | 'this_month' | 'all' | 'custom';
  const [datePreset, setDatePreset] = useState<DatePreset>('yesterday');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [dateRangeStatus, setDateRangeStatus] = useState<'ready' | 'empty' | 'needs-range' | 'invalid'>('ready');

  // Data state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [combos, setCombos] = useState<YatraComboThali[]>([]);
  const [combosErrorChannel, setCombosErrorChannel] = useState<MenuSalesChannel | null>(null);
  const [combosLoadedChannel, setCombosLoadedChannel] = useState<MenuSalesChannel | null>(null);
  const [matrix, setMatrix] = useState<any>(null);
  const combosLoading = activeTab === 'combos'
    && dateRangeStatus === 'ready'
    && combosLoadedChannel !== channel
    && combosErrorChannel !== channel;
  const combosError = combosErrorChannel === channel;

  // Search & filters
  const [searchTerm, setSearchTerm] = useState('');
  const [parentCatFilter, setParentCatFilter] = useState('ALL');
  const [quadrantFilter, setQuadrantFilter] = useState('ALL');

  // Sort state: defaults to Item Name ascending on load
  const [sortField, setSortField] = useState<MenuSortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const fetchSequence = useRef(0);
  const combosFetchSequence = useRef(0);

  const handleSort = (field: MenuSortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(NUMERIC_FINANCIAL_SORT_FIELDS.has(field) ? 'desc' : 'asc');
    }
  };

  const openMenuItem = (menuItemId: string) => {
    const params = new URLSearchParams();
    params.set('channel', channel);
    params.set('date_preset', datePreset);
    const dateRange = getBusinessDateRange(datePreset, new Date(), customFrom, customTo);
    if (dateRange.from) params.set('date_from', dateRange.from);
    if (dateRange.to) params.set('date_to', dateRange.to);
    router.push(`/sops/menu/${menuItemId}?${params.toString()}`);
  };

  const fetchMenuData = async () => {
    const sequence = ++fetchSequence.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('channel', channel);

      const dateRange = getBusinessDateRange(datePreset, new Date(), customFrom, customTo);
      setDateRangeStatus(dateRange.status);
      if (dateRange.status !== 'ready') {
        combosFetchSequence.current++;
        setItems([]);
        setCombos([]);
        setCombosErrorChannel(null);
        setCombosLoadedChannel(null);
        setMatrix(null);
        return;
      }
      if (dateRange.from) params.set('date_from', dateRange.from);
      if (dateRange.to) params.set('date_to', dateRange.to);
      params.set('view', 'catalog');

      const res = await fetch(`/api/sops/menu?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to fetch menu items');
      }

      const data = await res.json();
      if (sequence !== fetchSequence.current) return;
      const loadedItems = (data.items || []) as MenuCatalogMatrixSource[];
      setItems(loadedItems);
      setMatrix(data.matrix ? {
        ...data.matrix,
        items: loadedItems.map((item) => ({
          menuItemId: item.id,
          name: item.name,
          quadrant: item.quadrant,
          unitsSold: item.unitsSold,
          netRevenue: item.netRevenue,
          foodCost: item.defaultVariant?.food_cost ?? null,
          foodCostPct: item.foodCostPct ?? null,
          unitContributionMargin: item.unitContributionMargin ?? null,
        })),
      } : null);
    } catch (err: any) {
      if (sequence !== fetchSequence.current) return;
      console.error('Fetch menu data error:', err);
      setError(err.message || 'Error fetching menu master');
    } finally {
      if (sequence === fetchSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchMenuData();
  }, [channel, datePreset, customFrom, customTo]);

  useEffect(() => {
    if (
      activeTab !== 'combos'
      || dateRangeStatus !== 'ready'
      || combosLoadedChannel === channel
      || combosErrorChannel === channel
    ) return;

    const sequence = ++combosFetchSequence.current;
    const controller = new AbortController();

    const fetchCombos = async () => {
      try {
        const params = new URLSearchParams({ channel, view: 'combos' });
        const res = await fetch(`/api/sops/menu?${params.toString()}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to fetch combos');
        if (sequence !== combosFetchSequence.current) return;
        setCombos(data.combos || []);
        setCombosErrorChannel(null);
        setCombosLoadedChannel(channel);
      } catch (err: unknown) {
        if (sequence !== combosFetchSequence.current) return;
        console.error('Fetch menu combos error:', err);
        setCombosErrorChannel(channel);
      }
    };

    void fetchCombos();
    return () => {
      controller.abort();
      if (sequence === combosFetchSequence.current) combosFetchSequence.current++;
    };
  }, [activeTab, channel, dateRangeStatus, combosLoadedChannel, combosErrorChannel]);

  // Unique parent categories for filtering
  const parentCategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      if (i.parent_category) set.add(i.parent_category);
    });
    return Array.from(set).sort();
  }, [items]);

  // Filtered menu items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (parentCatFilter !== 'ALL' && item.parent_category !== parentCatFilter) return false;
      if (quadrantFilter !== 'ALL' && item.quadrant !== quadrantFilter) return false;
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const nameMatch = item.name?.toLowerCase().includes(query);
        const nameHiMatch = item.name_hi?.toLowerCase().includes(query);
        if (!nameMatch && !nameHiMatch) return false;
      }
      return true;
    });
  }, [items, parentCatFilter, quadrantFilter, searchTerm]);

  // Stage 2: Sort filtered items (preserves active filters and tie-breaks stably)
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      return compareCatalogItems(a, b, sortField, sortOrder, locale);
    });
  }, [filteredItems, sortField, sortOrder, locale]);

  const getQuadrantBadge = (quadrant?: string) => {
    switch (quadrant) {
      case 'STAR':
        return (
          <Badge variant="success" className="gap-1 font-mono text-[11px] bg-emerald-100 text-emerald-900 border-emerald-300">
            <Star className="h-3 w-3 fill-emerald-600 text-emerald-600" /> Star
          </Badge>
        );
      case 'PLOWHORSE':
        return (
          <Badge variant="warning" className="gap-1 font-mono text-[11px] bg-amber-100 text-amber-900 border-amber-300">
            <TrendingUp className="h-3 w-3 text-amber-700" /> Plowhorse
          </Badge>
        );
      case 'PUZZLE':
        return (
          <Badge variant="purple" className="gap-1 font-mono text-[11px] bg-purple-100 text-purple-900 border-purple-300">
            <Sparkles className="h-3 w-3 text-purple-700" /> Puzzle
          </Badge>
        );
      case 'DOG':
        return (
          <Badge variant="danger" className="gap-1 font-mono text-[11px] bg-rose-100 text-rose-900 border-rose-300">
            <Activity className="h-3 w-3 text-rose-700" /> Dog
          </Badge>
        );
      case 'COSTING_INCOMPLETE':
        return (
          <Badge variant="danger" className="text-[10px]">
            Incomplete
          </Badge>
        );
      case 'UNCOSTED':
        return (
          <Badge variant="warning" className="text-[10px]">
            Uncosted
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[10px]">
            Ineligible
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-stone-900">
              {t('sops.menu.title')}
            </h1>
            <Badge variant="outline" className="font-mono text-xs text-stone-600 bg-stone-50">
              {items.length} {locale === 'hi' ? 'आइटम' : 'Items'}
            </Badge>
          </div>
          <p className="text-sm text-stone-500 mt-1">
            {t('sops.menu.description')}
          </p>
        </div>

        {/* Header Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/admin/menu-master">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs text-stone-700">
              <UtensilsCrossed className="h-3.5 w-3.5 text-amber-600" />
              <span>Menu Master</span>
            </Button>
          </Link>
          <Link href="/sops/recipes">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs text-stone-700">
              <Layers className="h-3.5 w-3.5 text-amber-600" />
              <span>Recipe Book</span>
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchMenuData}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('common.actions.refresh')}
          </Button>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex overflow-x-auto gap-2 border-b border-[#E7E2D8] pb-px">
        <button
          onClick={() => setActiveTab('catalog')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === 'catalog'
              ? 'border-amber-600 text-amber-700 font-semibold'
              : 'border-transparent text-stone-600 hover:text-stone-900 hover:border-stone-300'
          }`}
        >
          {t('sops.menu.tabCatalog')}
        </button>
        <button
          onClick={() => setActiveTab('matrix')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'matrix'
              ? 'border-amber-600 text-amber-700 font-semibold'
              : 'border-transparent text-stone-600 hover:text-stone-900 hover:border-stone-300'
          }`}
        >
          <Sparkles className="h-4 w-4 text-amber-600" />
          {t('sops.menu.tabMatrix')}
        </button>
      </div>

      {/* Date Presets & Channel Filter Bar */}
      <div className="bg-[#FAF8F5] border border-[#E7E2D8] rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-stone-700 mr-1 flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 text-stone-500" />
            {locale === 'hi' ? 'अवधि चुनें:' : 'Date Presets:'}
          </span>
          {[
            { key: 'yesterday', label: t('common.labels.yesterday') },
            { key: '7d', label: locale === 'hi' ? 'पिछले 7 दिन' : 'Last 7 Days' },
            { key: '30d', label: locale === 'hi' ? 'पिछले 30 दिन' : 'Last 30 Days' },
            { key: 'this_month', label: locale === 'hi' ? 'इस माह' : 'This Month' },
            { key: 'all', label: locale === 'hi' ? 'समस्त काल' : 'All Time' },
            { key: 'custom', label: locale === 'hi' ? 'कस्टम अवधि' : 'Custom Range' },
          ].map((preset) => (
            <button
              key={preset.key}
              onClick={() => setDatePreset(preset.key as DatePreset)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                datePreset === preset.key
                  ? 'bg-amber-600 text-white shadow-2xs font-semibold'
                  : 'bg-white border border-[#E7E2D8] text-stone-700 hover:bg-stone-50'
              }`}
            >
              {preset.label}
            </button>
          ))}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-1 ml-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-0.5 border border-[#E7E2D8] rounded text-xs bg-white text-stone-800"
              />
              <span className="text-stone-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-0.5 border border-[#E7E2D8] rounded text-xs bg-white text-stone-800"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 bg-white p-1 rounded-lg border border-[#E7E2D8]" aria-label={t('sops.menu.channelFilter')}>
          {MENU_SALES_CHANNELS.map((salesChannel) => (
            <button
              key={salesChannel}
              type="button"
              aria-pressed={channel === salesChannel}
              onClick={() => {
                setCombosErrorChannel(null);
                setChannel(salesChannel);
              }}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                channel === salesChannel
                  ? 'bg-amber-600 text-white font-semibold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {t(menuSalesChannelTranslationKey(salesChannel))}
            </button>
          ))}
        </div>
      </div>

      {dateRangeStatus !== 'ready' && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t(
            dateRangeStatus === 'empty'
              ? 'sops.menu.emptyBusinessMonth'
              : dateRangeStatus === 'needs-range'
              ? 'sops.menu.customRangeRequired'
              : 'sops.menu.customRangeInvalid',
          )}
        </div>
      )}

      {/* TAB 1: MENU CATALOG & CHANNEL COSTS */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
              <input
                type="text"
                placeholder={t('sops.menu.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-[#E7E2D8] rounded-lg text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-stone-400" />
              <select
                value={parentCatFilter}
                onChange={(e) => setParentCatFilter(e.target.value)}
                className="px-3 py-2 bg-white border border-[#E7E2D8] rounded-lg text-sm text-stone-700 focus:outline-none cursor-pointer"
              >
                <option value="ALL">{locale === 'hi' ? 'सभी मूल श्रेणियां' : 'All Parent Categories'}</option>
                {parentCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={quadrantFilter}
                onChange={(e) => setQuadrantFilter(e.target.value)}
                className="px-3 py-2 bg-white border border-[#E7E2D8] rounded-lg text-sm text-stone-700 focus:outline-none cursor-pointer"
              >
                <option value="ALL">{locale === 'hi' ? 'सभी क्वाड्रंट' : 'All BCG Quadrants'}</option>
                <option value="STAR">Star</option>
                <option value="PLOWHORSE">Plowhorse</option>
                <option value="PUZZLE">Puzzle</option>
                <option value="DOG">Dog</option>
                <option value="UNCOSTED">Uncosted</option>
              </select>
            </div>
          </div>

          {/* Catalog Table */}
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-12 text-center text-stone-500 flex flex-col items-center gap-2">
                  <RefreshCw className="h-6 w-6 animate-spin text-amber-600" />
                  <span>Loading catalog...</span>
                </div>
              ) : sortedItems.length === 0 ? (
                <div className="p-12 text-center text-stone-400">
                  {t('sops.menu.noItemsFound')}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#E7E2D8] bg-[#FAF8F5] text-xs font-semibold text-stone-600 select-none">
                        {CATALOG_COLUMNS.map((col) => {
                          const isActive = sortField === col.key;
                          const ariaSortValue = isActive
                            ? sortOrder === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none';

                          return (
                            <th
                              key={col.key}
                              scope="col"
                              aria-sort={ariaSortValue}
                              onClick={() => handleSort(col.key)}
                              className={`py-3 px-4 cursor-pointer hover:bg-stone-100 transition-colors group ${
                                col.align === 'right' ? 'text-right' : 'text-left'
                              } ${col.className || ''}`}
                            >
                              <div
                                className={`flex items-center gap-1.5 ${
                                  col.align === 'right' ? 'justify-end' : 'justify-start'
                                }`}
                              >
                                <span>{t(col.labelKey)}</span>
                                <span
                                  className={`transition-colors ${
                                    isActive ? 'text-amber-600' : 'text-stone-400 group-hover:text-stone-600'
                                  }`}
                                >
                                  {isActive ? (
                                    sortOrder === 'asc' ? (
                                      <ChevronUp className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    )
                                  ) : (
                                    <ChevronsUpDown className="h-3.5 w-3.5 opacity-40 group-hover:opacity-100 transition-opacity" />
                                  )}
                                </span>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E7E2D8]">
                      {sortedItems.map((item) => {
                        const v = item.defaultVariant;
                        const parentColor = getCategoryColor(item.parent_category);

                        return (
                          <tr
                            key={item.id}
                            onClick={() => openMenuItem(item.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openMenuItem(item.id);
                              }
                            }}
                            tabIndex={0}
                            role="link"
                            aria-label={`${item.name} - ${item.parent_category || ''}`}
                            className="hover:bg-amber-50/50 cursor-pointer transition-colors focus:outline-none focus:bg-amber-50/60 focus:ring-1 focus:ring-amber-500/30 group"
                          >
                            {/* 1. Item Name */}
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-stone-900 group-hover:text-amber-700 transition-colors">
                                  {item.name}
                                </span>
                                {item.product_type && (
                                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border ${
                                    item.product_type === 'COMBO' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                    item.product_type === 'THALI' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                    item.product_type === 'STANDALONE_PURCHASED' ? 'bg-cyan-50 text-cyan-700 border-cyan-200' :
                                    'bg-amber-50 text-amber-700 border-amber-200'
                                  }`}>
                                    {item.product_type === 'INDIVIDUAL_DISH' ? 'Dish' :
                                     item.product_type === 'STANDALONE_PURCHASED' ? 'Packaged' :
                                     item.product_type}
                                  </span>
                                )}
                              </div>
                              {item.name_hi && (
                                <div className="text-xs text-stone-500 font-sans">{item.name_hi}</div>
                              )}
                            </td>

                            {/* 2. Category */}
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="h-2.5 w-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: parentColor }}
                                />
                                <span className="text-xs text-stone-700 font-medium">
                                  {item.parent_category || 'Other'}
                                </span>
                              </div>
                              <div className="text-[11px] text-stone-400 ml-4">{item.category}</div>
                            </td>

                            {/* 3. Selling Price */}
                            <td className="py-3.5 px-4 text-right font-mono font-medium text-stone-900">
                              {formatNullablePrice(item.price)}
                            </td>

                            {/* 4. Active Recipe / Variant */}
                            <td className="py-3.5 px-4">
                              {v ? (
                                <div>
                                  <span className="text-xs font-medium text-stone-800">
                                    {v.variant_name}
                                  </span>
                                  {v.serving_quantity != null && (
                                    <div className="text-[10px] text-stone-500 font-mono">
                                      {v.serving_quantity} {v.serving_unit}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-stone-400 italic">No variant</span>
                              )}
                            </td>

                            {/* 5. Food Cost */}
                            <td className="py-3.5 px-4 text-right font-mono text-sm">
                              {!hasCostAccess ? (
                                <Lock className="h-3 w-3 inline text-stone-400" />
                              ) : v?.food_cost != null ? (
                                <span className="text-stone-800 font-medium">
                                  {formatINR(v.food_cost)}
                                </span>
                              ) : (
                                <span className="text-stone-400">—</span>
                              )}
                            </td>

                            {/* 6. Food Cost % */}
                            <td className="py-3.5 px-4 text-right font-mono text-xs">
                              {!hasCostAccess ? (
                                <Lock className="h-3 w-3 inline text-stone-400" />
                              ) : v?.food_cost_pct != null ? (
                                <span
                                  className={`font-semibold ${
                                    v.food_cost_pct <= 30
                                      ? 'text-emerald-700'
                                      : v.food_cost_pct <= 40
                                      ? 'text-amber-700'
                                      : 'text-rose-700'
                                  }`}
                                >
                                  {v.food_cost_pct.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-stone-400">—</span>
                              )}
                            </td>

                            {/* 7. Contribution Margin */}
                            <td className="py-3.5 px-4 text-right font-mono text-sm">
                              {!hasCostAccess ? (
                                <Lock className="h-3 w-3 inline text-stone-400" />
                              ) : v?.margin_amount != null ? (
                                <span className="font-semibold text-emerald-800">
                                  {formatINR(v.margin_amount)}
                                </span>
                              ) : (
                                <span className="text-stone-400">—</span>
                              )}
                            </td>

                            {/* 8. Units Sold */}
                            <td className="py-3.5 px-4 text-right font-mono text-sm text-stone-900">
                              {item.unitsSold ? formatNumber(item.unitsSold) : '0'}
                            </td>

                            {/* 9. Net Revenue */}
                            <td className="py-3.5 px-4 text-right font-mono font-medium text-stone-900">
                              {item.netRevenue ? formatINR(item.netRevenue) : '₹0'}
                            </td>

                            {/* 10. BCG Quadrant */}
                            <td className="py-3.5 px-4">
                              {getQuadrantBadge(item.quadrant)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: BCG MENU ENGINEERING MATRIX */}
      {activeTab === 'matrix' && matrix && (
        <div className="space-y-6">
          {/* Empty-State Banner for NO_SALES_DATA / NO_ELIGIBLE_COSTED_SALES */}
          {matrix.state === 'NO_SALES_DATA' || Number(matrix.totalUnitsSold || 0) === 0 ? (
            <div className="p-5 bg-amber-50/80 border border-amber-200 rounded-xl flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-amber-950">
                  {locale === 'hi' ? 'चयनित अवधि के लिए कोई बिक्री डेटा नहीं मिला' : 'No Sales Data Available for Selected Date Range'}
                </h3>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  {locale === 'hi'
                    ? 'बीसीजी मेनू इंजीनियरिंग मैट्रिक्स को लोकप्रियता और अंशदान मार्जिन की गणना के लिए पीओएस बिक्री की आवश्यकता होती है। कृपया अन्य तिथि सीमा चुनें या बिक्री दर्ज होने की प्रतीक्षा करें।'
                    : 'The Boston Consulting Group (BCG) Menu Engineering Matrix requires actual sales transactions from POS orders to calculate volume share and contribution margin quadrants. Select a different date range or record sales to activate matrix classification.'}
                </p>
              </div>
            </div>
          ) : matrix.state === 'NO_ELIGIBLE_COSTED_SALES' ? (
            <div className="p-5 bg-blue-50/80 border border-blue-200 rounded-xl flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-blue-950">
                  {locale === 'hi' ? 'बिक्री उपलब्ध है, लेकिन किसी लागत गणना व्यंजन की बिक्री नहीं हुई' : 'Sales Orders Found, But No Costed Items Sold'}
                </h3>
                <p className="text-xs text-blue-800 mt-1 leading-relaxed">
                  {locale === 'hi'
                    ? 'इस अवधि में बिक्री ऑर्डर मौजूद हैं, लेकिन बेचे गए किसी भी व्यंजन में लागत गणना पूर्ण नहीं है। बीसीज मैट्रिक्स सक्रिय करने के लिए व्यंजनों की रेसिपी और लागत जोड़ें।'
                    : 'Sales transactions exist for this period, but none of the sold items have active costed formulations. Link recipes and establish inventory valuations to activate BCG profitability quadrants.'}
                </p>
              </div>
            </div>
          ) : null}

          {/* Matrix Top Summary & Thresholds Banner */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-emerald-50/60 border-emerald-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-900 text-sm">
                    <Star className="h-4 w-4 fill-emerald-600 text-emerald-600" />
                    {t('sops.matrix.star')}
                  </div>
                  <Badge variant="success" className="font-mono text-xs">
                    {matrix.items.filter((i: any) => i.quadrant === 'STAR').length}
                  </Badge>
                </div>
                <p className="text-xs text-emerald-800 mt-1">
                  {t('sops.matrix.starDesc')}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-amber-50/60 border-amber-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-amber-900 text-sm">
                    <TrendingUp className="h-4 w-4 text-amber-700" />
                    {t('sops.matrix.plowhorse')}
                  </div>
                  <Badge variant="warning" className="font-mono text-xs">
                    {matrix.items.filter((i: any) => i.quadrant === 'PLOWHORSE').length}
                  </Badge>
                </div>
                <p className="text-xs text-amber-800 mt-1">
                  {t('sops.matrix.plowhorseDesc')}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-purple-50/60 border-purple-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-purple-900 text-sm">
                    <Sparkles className="h-4 w-4 text-purple-700" />
                    {t('sops.matrix.puzzle')}
                  </div>
                  <Badge variant="purple" className="font-mono text-xs">
                    {matrix.items.filter((i: any) => i.quadrant === 'PUZZLE').length}
                  </Badge>
                </div>
                <p className="text-xs text-purple-800 mt-1">
                  {t('sops.matrix.puzzleDesc')}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-rose-50/60 border-rose-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-rose-900 text-sm">
                    <Activity className="h-4 w-4 text-rose-700" />
                    {t('sops.matrix.dog')}
                  </div>
                  <Badge variant="danger" className="font-mono text-xs">
                    {matrix.items.filter((i: any) => i.quadrant === 'DOG').length}
                  </Badge>
                </div>
                <p className="text-xs text-rose-800 mt-1">
                  {t('sops.matrix.dogDesc')}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Thresholds Strip */}
          <div className="bg-[#FAF8F5] border border-[#E7E2D8] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div>
              <span className="text-stone-500 mr-1">{t('sops.matrix.thresholdPopularity')}:</span>
              <span className="font-mono font-bold text-stone-900">
                {matrix.popularityThresholdPct?.toFixed(2)}% of sales mix
              </span>
            </div>

            <div>
              <span className="text-stone-500 mr-1">{t('sops.matrix.thresholdMargin')}:</span>
              <span className="font-mono font-bold text-emerald-800">
                {!hasCostAccess ? (
                  <Lock className="h-3 w-3 inline text-stone-400" />
                ) : matrix.salesWeightedContributionThreshold != null ? (
                  formatINR(matrix.salesWeightedContributionThreshold)
                ) : (
                  '—'
                )}
              </span>
            </div>

            <div>
              <span className="text-stone-500 mr-1">{t('sops.matrix.totalSold')}:</span>
              <span className="font-mono font-bold text-stone-900">
                {Number(matrix.totalUnitsSold || 0).toLocaleString()} pcs
              </span>
            </div>

            <div>
              <span className="text-stone-500 mr-1">{t('sops.matrix.eligibleItems')}:</span>
              <span className="font-mono font-bold text-stone-900">
                {matrix.eligibleItemsCount} / {matrix.totalItemsCount}
              </span>
            </div>
          </div>

          {/* 4 Quadrants Interactive Display */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Top-Right: STARS */}
            <Card className="border-emerald-200 shadow-sm">
              <CardHeader className="bg-emerald-50/50 border-b border-emerald-100 py-3">
                <CardTitle className="text-sm font-bold text-emerald-950 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Star className="h-4 w-4 fill-emerald-600 text-emerald-600" />
                    <span>Stars (High Popularity, High Margin)</span>
                  </div>
                  <Badge variant="success" className="font-mono text-xs">
                    {matrix.items.filter((i: any) => i.quadrant === 'STAR').length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-y-auto divide-y divide-[#E7E2D8]">
                  {matrix.items
                    .filter((i: any) => i.quadrant === 'STAR')
                    .map((item: any) => (
                      <div key={item.menuItemId} className="p-3 hover:bg-emerald-50/20 flex items-center justify-between">
                        <div>
                          <Link href={`/sops/menu/${item.menuItemId}`} className="font-medium text-stone-900 hover:text-emerald-700">
                            {item.name}
                          </Link>
                          <div className="text-[11px] text-stone-500">
                            {item.unitsSold} sold ({item.salesMixPct?.toFixed(1)}% mix)
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-xs font-semibold text-emerald-800">
                            {!hasCostAccess ? <Lock className="h-3 w-3" /> : item.unitContributionMargin ? formatINR(item.unitContributionMargin) : '—'}
                          </div>
                          {hasCostAccess && item.foodCostPct != null && (
                            <div className="text-[10px] text-stone-400 font-mono">
                              FC: {item.foodCostPct.toFixed(1)}%
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* Top-Left: PUZZLES */}
            <Card className="border-purple-200 shadow-sm">
              <CardHeader className="bg-purple-50/50 border-b border-purple-100 py-3">
                <CardTitle className="text-sm font-bold text-purple-950 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-purple-700" />
                    <span>Puzzles (Low Popularity, High Margin)</span>
                  </div>
                  <Badge variant="purple" className="font-mono text-xs">
                    {matrix.items.filter((i: any) => i.quadrant === 'PUZZLE').length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-y-auto divide-y divide-[#E7E2D8]">
                  {matrix.items
                    .filter((i: any) => i.quadrant === 'PUZZLE')
                    .map((item: any) => (
                      <div key={item.menuItemId} className="p-3 hover:bg-purple-50/20 flex items-center justify-between">
                        <div>
                          <Link href={`/sops/menu/${item.menuItemId}`} className="font-medium text-stone-900 hover:text-purple-700">
                            {item.name}
                          </Link>
                          <div className="text-[11px] text-stone-500">
                            {item.unitsSold} sold ({item.salesMixPct?.toFixed(1)}% mix)
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-xs font-semibold text-purple-800">
                            {!hasCostAccess ? <Lock className="h-3 w-3" /> : item.unitContributionMargin ? formatINR(item.unitContributionMargin) : '—'}
                          </div>
                          {hasCostAccess && item.foodCostPct != null && (
                            <div className="text-[10px] text-stone-400 font-mono">
                              FC: {item.foodCostPct.toFixed(1)}%
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* Bottom-Right: PLOWHORSES */}
            <Card className="border-amber-200 shadow-sm">
              <CardHeader className="bg-amber-50/50 border-b border-amber-100 py-3">
                <CardTitle className="text-sm font-bold text-amber-950 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4 text-amber-700" />
                    <span>Plowhorses (High Popularity, Low Margin)</span>
                  </div>
                  <Badge variant="warning" className="font-mono text-xs">
                    {matrix.items.filter((i: any) => i.quadrant === 'PLOWHORSE').length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-y-auto divide-y divide-[#E7E2D8]">
                  {matrix.items
                    .filter((i: any) => i.quadrant === 'PLOWHORSE')
                    .map((item: any) => (
                      <div key={item.menuItemId} className="p-3 hover:bg-amber-50/20 flex items-center justify-between">
                        <div>
                          <Link href={`/sops/menu/${item.menuItemId}`} className="font-medium text-stone-900 hover:text-amber-700">
                            {item.name}
                          </Link>
                          <div className="text-[11px] text-stone-500">
                            {item.unitsSold} sold ({item.salesMixPct?.toFixed(1)}% mix)
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-xs font-semibold text-amber-900">
                            {!hasCostAccess ? <Lock className="h-3 w-3" /> : item.unitContributionMargin ? formatINR(item.unitContributionMargin) : '—'}
                          </div>
                          {hasCostAccess && item.foodCostPct != null && (
                            <div className="text-[10px] text-stone-400 font-mono">
                              FC: {item.foodCostPct.toFixed(1)}%
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* Bottom-Left: DOGS */}
            <Card className="border-rose-200 shadow-sm">
              <CardHeader className="bg-rose-50/50 border-b border-rose-100 py-3">
                <CardTitle className="text-sm font-bold text-rose-950 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-rose-700" />
                    <span>Dogs (Low Popularity, Low Margin)</span>
                  </div>
                  <Badge variant="danger" className="font-mono text-xs">
                    {matrix.items.filter((i: any) => i.quadrant === 'DOG').length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-y-auto divide-y divide-[#E7E2D8]">
                  {matrix.items
                    .filter((i: any) => i.quadrant === 'DOG')
                    .map((item: any) => (
                      <div key={item.menuItemId} className="p-3 hover:bg-rose-50/20 flex items-center justify-between">
                        <div>
                          <Link href={`/sops/menu/${item.menuItemId}`} className="font-medium text-stone-900 hover:text-rose-700">
                            {item.name}
                          </Link>
                          <div className="text-[11px] text-stone-500">
                            {item.unitsSold} sold ({item.salesMixPct?.toFixed(1)}% mix)
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-xs font-semibold text-rose-800">
                            {!hasCostAccess ? <Lock className="h-3 w-3" /> : item.unitContributionMargin ? formatINR(item.unitContributionMargin) : '—'}
                          </div>
                          {hasCostAccess && item.foodCostPct != null && (
                            <div className="text-[10px] text-stone-400 font-mono">
                              FC: {item.foodCostPct.toFixed(1)}%
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MenuMasterPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-stone-500">Loading Menu Master...</div>}>
      <MenuMasterContent />
    </Suspense>
  );
}
