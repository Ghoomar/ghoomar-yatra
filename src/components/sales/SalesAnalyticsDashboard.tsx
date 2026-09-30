'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatINR, getTodayBusinessDate, formatDisplayDate } from '@/lib/utils';
import { SalesAnalyticsResponse } from '@/lib/types/sales';
import { useI18n } from '@/lib/i18n/context';
import { getCategoryColor, getCategoryBadgeClasses } from '@/lib/constants/category-colors';
import { getOrderBusinessUnit } from '@/lib/sales/business-units';
import { HourlyCategoryStackedBarChart } from './HourlyCategoryStackedBarChart';
import { SalesReconciliationBanner } from './SalesReconciliationBanner';
import {
  TrendingUp,
  Receipt,
  UtensilsCrossed,
  Layers,
  CreditCard,
  UserCheck,
  Calendar,
  Filter,
  RefreshCw,
  Search,
  X,
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  Eye,
} from 'lucide-react';

export interface SalesAnalyticsDashboardProps {
  initialDate?: string;
  onDateChange?: (date: string) => void;
  hideDatePicker?: boolean;

  startDate?: string;
  endDate?: string;
  selectedDate?: string | null;
  filterMode?: 'month' | 'custom';
  selectedMonth?: string;
  onPeriodChange?: (start: string, end: string, mode: 'month' | 'custom', month: string) => void;
  onSelectDate?: (date: string | null) => void;
}

function getMonthBoundaries(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

export function SalesAnalyticsDashboard({
  initialDate,
  onDateChange,
  hideDatePicker,
  startDate: parentStartDate,
  endDate: parentEndDate,
  selectedDate: parentSelectedDate,
  filterMode: parentFilterMode,
  selectedMonth: parentSelectedMonth,
  onPeriodChange,
  onSelectDate,
}: SalesAnalyticsDashboardProps) {
  const { t, locale } = useI18n();
  const todayIST = getTodayBusinessDate();
  const currentYearMonth = todayIST.substring(0, 7);

  // Period / Filter mode
  const [filterMode, setFilterMode] = useState<'month' | 'custom'>(parentFilterMode || 'month');
  const [selectedMonth, setSelectedMonth] = useState<string>(parentSelectedMonth || currentYearMonth);
  const [customStartDate, setCustomStartDate] = useState<string>(
    parentStartDate || getMonthBoundaries(currentYearMonth).startDate
  );
  const [customEndDate, setCustomEndDate] = useState<string>(parentEndDate || todayIST);
  const [drilldownDate, setDrilldownDate] = useState<string | null>(
    parentSelectedDate !== undefined ? parentSelectedDate : (initialDate || null)
  );

  // Sync with parent props
  useEffect(() => {
    if (parentFilterMode && parentFilterMode !== filterMode) setFilterMode(parentFilterMode);
  }, [parentFilterMode]);

  useEffect(() => {
    if (parentSelectedMonth && parentSelectedMonth !== selectedMonth) setSelectedMonth(parentSelectedMonth);
  }, [parentSelectedMonth]);

  useEffect(() => {
    if (parentStartDate && parentStartDate !== customStartDate) setCustomStartDate(parentStartDate);
  }, [parentStartDate]);

  useEffect(() => {
    if (parentEndDate && parentEndDate !== customEndDate) setCustomEndDate(parentEndDate);
  }, [parentEndDate]);

  useEffect(() => {
    if (parentSelectedDate !== undefined && parentSelectedDate !== drilldownDate) {
      setDrilldownDate(parentSelectedDate);
    }
  }, [parentSelectedDate]);

  // Determine current active date range
  const { activeStartDate, activeEndDate } = useMemo(() => {
    if (filterMode === 'month') {
      const b = getMonthBoundaries(selectedMonth);
      return { activeStartDate: b.startDate, activeEndDate: b.endDate };
    }
    return {
      activeStartDate: customStartDate <= customEndDate ? customStartDate : customEndDate,
      activeEndDate: customStartDate <= customEndDate ? customEndDate : customStartDate,
    };
  }, [filterMode, selectedMonth, customStartDate, customEndDate]);

  const isDrilldown = Boolean(drilldownDate);

  // Month options for dropdown
  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const [currY, currM] = currentYearMonth.split('-').map(Number);

    for (let offset = -5; offset <= 2; offset++) {
      let m = currM + offset;
      let y = currY;
      while (m < 1) {
        m += 12;
        y -= 1;
      }
      while (m > 12) {
        m -= 12;
        y += 1;
      }
      const val = `${y}-${String(m).padStart(2, '0')}`;
      const d = new Date(Date.UTC(y, m - 1, 1));
      const label = d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric' });
      options.push({ value: val, label });
    }
    return options;
  }, [currentYearMonth, locale]);

  // 6 Filter States
  const [parentCategory, setParentCategory] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [itemSearch, setItemSearch] = useState<string>('');
  const [captain, setCaptain] = useState<string>('');
  const [paymentType, setPaymentType] = useState<string>('');
  const [orderType, setOrderType] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'categories' | 'items' | 'payments' | 'captains' | 'orders' | 'bills'>('categories');

  // Bills Pagination States
  const [bills, setBills] = useState<any[]>([]);
  const [billsPage, setBillsPage] = useState<number>(1);
  const [billsPageSize, setBillsPageSize] = useState<number>(25);
  const [billsTotalCount, setBillsTotalCount] = useState<number>(0);
  const [billsTotalPages, setBillsTotalPages] = useState<number>(0);
  const [billsTotalNet, setBillsTotalNet] = useState<number>(0);
  const [billsTotalGrand, setBillsTotalGrand] = useState<number>(0);
  const [billsTotalCovers, setBillsTotalCovers] = useState<number>(0);
  const [billsLoading, setBillsLoading] = useState<boolean>(false);
  const [billSearchTerm, setBillSearchTerm] = useState<string>('');
  const [billOrderTypeFilter, setBillOrderTypeFilter] = useState<string>('ALL');

  const [data, setData] = useState<SalesAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Period / Date Handlers
  const handleMonthChange = (newMonth: string) => {
    setSelectedMonth(newMonth);
    const b = getMonthBoundaries(newMonth);
    setDrilldownDate(null);
    onSelectDate?.(null);
    onPeriodChange?.(b.startDate, b.endDate, 'month', newMonth);
    setBillsPage(1);
  };

  const handleCustomStartChange = (newStart: string) => {
    setCustomStartDate(newStart);
    setDrilldownDate(null);
    onSelectDate?.(null);
    onPeriodChange?.(newStart, customEndDate, 'custom', selectedMonth);
    setBillsPage(1);
  };

  const handleCustomEndChange = (newEnd: string) => {
    setCustomEndDate(newEnd);
    setDrilldownDate(null);
    onSelectDate?.(null);
    onPeriodChange?.(customStartDate, newEnd, 'custom', selectedMonth);
    setBillsPage(1);
  };

  const handleModeChange = (newMode: 'month' | 'custom') => {
    setFilterMode(newMode);
    setDrilldownDate(null);
    onSelectDate?.(null);
    if (newMode === 'month') {
      const b = getMonthBoundaries(selectedMonth);
      onPeriodChange?.(b.startDate, b.endDate, 'month', selectedMonth);
    } else {
      onPeriodChange?.(customStartDate, customEndDate, 'custom', selectedMonth);
    }
    setBillsPage(1);
  };

  const handleClearDrilldown = () => {
    setDrilldownDate(null);
    onSelectDate?.(null);
    setBillsPage(1);
  };

  // Main Analytics Loader
  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (isDrilldown && drilldownDate) {
        params.set('start_date', drilldownDate);
        params.set('end_date', drilldownDate);
        params.set('selected_date', drilldownDate);
      } else {
        params.set('start_date', activeStartDate);
        params.set('end_date', activeEndDate);
      }
      if (parentCategory) params.set('parent_category', parentCategory);
      if (category) params.set('category', category);
      if (itemSearch) params.set('item', itemSearch);
      if (captain) params.set('captain', captain);
      if (paymentType) params.set('payment_type', paymentType);
      if (orderType) params.set('order_type', orderType);

      const res = await fetch(`/api/finance/sales/analytics?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load sales analytics.');

      setData(json);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [
    isDrilldown,
    drilldownDate,
    activeStartDate,
    activeEndDate,
    parentCategory,
    category,
    itemSearch,
    captain,
    paymentType,
    orderType,
  ]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Paginated Bills Loader
  const loadBills = useCallback(async () => {
    setBillsLoading(true);
    try {
      const params = new URLSearchParams();
      if (isDrilldown && drilldownDate) {
        params.set('start_date', drilldownDate);
        params.set('end_date', drilldownDate);
        params.set('selected_date', drilldownDate);
      } else {
        params.set('start_date', activeStartDate);
        params.set('end_date', activeEndDate);
      }
      if (parentCategory) params.set('parent_category', parentCategory);
      if (category) params.set('category', category);
      if (itemSearch) params.set('item', itemSearch);
      if (captain) params.set('captain', captain);
      if (paymentType) params.set('payment_type', paymentType);

      const effectiveOrderType = billOrderTypeFilter !== 'ALL' ? billOrderTypeFilter : orderType;
      if (effectiveOrderType) params.set('order_type', effectiveOrderType);
      if (billSearchTerm) params.set('search', billSearchTerm);

      params.set('page', String(billsPage));
      params.set('page_size', String(billsPageSize));

      const res = await fetch(`/api/finance/sales/bills?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load bills.');

      setBills(json.rows || []);
      setBillsTotalCount(json.totalCount || 0);
      setBillsTotalPages(json.totalPages || 0);
      setBillsTotalNet(json.totalNetSales || 0);
      setBillsTotalGrand(json.totalGrandTotal || 0);
      setBillsTotalCovers(json.totalCovers || 0);
    } catch (err: any) {
      console.error('Error fetching bills:', err);
    } finally {
      setBillsLoading(false);
    }
  }, [
    isDrilldown,
    drilldownDate,
    activeStartDate,
    activeEndDate,
    parentCategory,
    category,
    itemSearch,
    captain,
    paymentType,
    orderType,
    billOrderTypeFilter,
    billSearchTerm,
    billsPage,
    billsPageSize,
  ]);

  useEffect(() => {
    if (activeTab === 'bills') {
      loadBills();
    }
  }, [loadBills, activeTab]);

  // Debounce search on item name & reset bills page
  useEffect(() => {
    const timer = setTimeout(() => {
      loadAnalytics();
      setBillsPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [itemSearch]);

  const hasActiveFilters = Boolean(
    parentCategory || category || itemSearch || captain || paymentType || orderType
  );

  const resetFilters = () => {
    setParentCategory('');
    setCategory('');
    setItemSearch('');
    setCaptain('');
    setPaymentType('');
    setOrderType('');
    setBillOrderTypeFilter('ALL');
    setBillsPage(1);
  };

  const getLocalizedParentCategory = (pName: string) => {
    if (locale !== 'hi' || !pName) return pName;
    return data?.parentCategoryTranslations?.[pName] || pName;
  };

  const getLocalizedCategory = (cName: string) => {
    if (locale !== 'hi' || !cName) return cName;
    return data?.categoryTranslations?.[cName] || cName;
  };

  const getLocalizedPaymentMode = (pm: string) => {
    if (locale !== 'hi' || !pm) return pm;
    const pmLower = pm.toLowerCase();
    if (pmLower.includes('cash')) return 'नकद';
    if (pmLower.includes('card')) return 'कार्ड';
    if (pmLower.includes('upi')) return 'यूपीआई';
    if (pmLower.includes('lancho')) return 'लाँचो';
    if (pmLower.includes('complimentary')) return 'कॉम्प्लिमेंटरी';
    return pm;
  };

  const getLocalizedOrderType = (ot: string) => {
    if (locale !== 'hi' || !ot) return ot;
    switch (ot) {
      case 'Dine In':
        return 'डाइन-इन';
      case 'Snacks Stall':
        return 'स्नैक्स स्टॉल';
      case 'Takeaway':
      case 'Take Away':
        return 'टेकअवे';
      case 'Lancho':
        return 'लाँचो';
      case 'Delivery (Parcel)':
        return 'डिलीवरी (पार्सल)';
      default:
        return ot;
    }
  };

  return (
    <div className="space-y-6">
      {/* Drill-down Banner or Synchronized Period Selector */}
      {isDrilldown && drilldownDate ? (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-900 font-bold shrink-0">
              <Eye className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-amber-950">
                  {t('finance.sales.analytics.drilldownBanner.viewingSingleDate', {
                    date: formatDisplayDate(drilldownDate, 'long'),
                  })}
                </span>
                <Badge className="bg-amber-600 text-white text-[9px] uppercase font-bold px-1.5 py-0.5">
                  {t('reports.salesLineGraph.reported')}
                </Badge>
              </div>
              <div className="text-[11px] text-amber-800 font-medium">
                {t('finance.sales.analytics.drilldownBanner.drilldownFromPeriod', {
                  start: formatDisplayDate(activeStartDate, 'short'),
                  end: formatDisplayDate(activeEndDate, 'short'),
                })}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearDrilldown}
            className="h-8 text-xs bg-white hover:bg-amber-50 border-amber-300 text-amber-900 font-semibold gap-1.5 shadow-2xs cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            {t('finance.sales.analytics.drilldownBanner.clearDrilldown')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white border border-[#E7E2D8] p-3 rounded-xl shadow-2xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Filter Mode Toggle */}
            <div className="inline-flex rounded-lg bg-stone-100 p-0.5 border border-stone-200 text-xs">
              <button
                type="button"
                onClick={() => handleModeChange('month')}
                className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                  filterMode === 'month' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t('finance.sales.analytics.drilldownBanner.monthly')}
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('custom')}
                className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                  filterMode === 'custom' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t('finance.sales.analytics.drilldownBanner.customRange')}
              </button>
            </div>

            {/* Mode-Specific Date Inputs */}
            {filterMode === 'month' ? (
              <div className="flex items-center bg-[#FAF8F5] border border-stone-200 rounded-lg px-2 py-1 shadow-2xs">
                <Calendar className="h-3.5 w-3.5 text-stone-500 mr-1.5" />
                <select
                  value={selectedMonth}
                  onChange={(e) => handleMonthChange(e.target.value)}
                  className="text-xs font-semibold text-stone-800 bg-transparent border-0 focus:outline-none cursor-pointer"
                >
                  {monthOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs">
                <div className="flex items-center bg-[#FAF8F5] border border-stone-200 rounded-lg px-2 py-1 shadow-2xs">
                  <span className="text-[10px] font-semibold text-stone-500 mr-1">
                    {t('finance.sales.analytics.drilldownBanner.from')}
                  </span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => handleCustomStartChange(e.target.value)}
                    className="text-xs font-semibold text-stone-800 bg-transparent border-0 focus:outline-none cursor-pointer"
                  />
                </div>
                <div className="flex items-center bg-[#FAF8F5] border border-stone-200 rounded-lg px-2 py-1 shadow-2xs">
                  <span className="text-[10px] font-semibold text-stone-500 mr-1">
                    {t('finance.sales.analytics.drilldownBanner.to')}
                  </span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => handleCustomEndChange(e.target.value)}
                    className="text-xs font-semibold text-stone-800 bg-transparent border-0 focus:outline-none cursor-pointer"
                  />
                </div>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                loadAnalytics();
                if (activeTab === 'bills') loadBills();
              }}
              disabled={loading || billsLoading}
              className="h-8 text-xs cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading || billsLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Quick Filter Status */}
          {hasActiveFilters && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-stone-500 font-medium">
                {t('finance.sales.analytics.filteredViewActive')}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={resetFilters}
                className="h-7 text-xs text-stone-600 hover:text-stone-900 gap-1 cursor-pointer"
              >
                <X className="h-3 w-3" /> {t('finance.sales.analytics.resetFilters')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Reconciliation Banner */}
      {data && (
        <SalesReconciliationBanner
          reconciliation={data.reconciliation}
          businessDate={isDrilldown && drilldownDate ? drilldownDate : activeStartDate}
        />
      )}

      {/* Top Executive KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {/* Net Sales */}
        <Card className="border-amber-300 bg-amber-50/30 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
              {t('finance.sales.analytics.kpis.netSales')}
            </span>
            <div className="text-2xl font-extrabold text-amber-900 mt-0.5">
              {formatINR(data?.kpis.netSales || 0)}
            </div>
            <span className="text-[10px] text-amber-700 block mt-0.5">
              {t('finance.sales.analytics.kpis.netOfDiscounts')}
            </span>
          </CardContent>
        </Card>

        {/* Gross / Grand Total */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 block">
              {t('finance.sales.analytics.kpis.grandTotal')}
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-0.5">
              {formatINR(data?.kpis.grossSales || 0)}
            </div>
            <span className="text-[10px] text-stone-400 block mt-0.5">
              {t('finance.sales.analytics.kpis.inclusiveTaxes')}
            </span>
          </CardContent>
        </Card>

        {/* Total Bills */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 block">
              {t('finance.sales.analytics.kpis.totalBills')}
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-0.5">
              {data?.kpis.totalBills || 0}
            </div>
            <span className="text-[10px] text-stone-400 block mt-0.5">
              {t('finance.sales.analytics.kpis.aov', {
                amount: formatINR(data?.kpis.averageOrderValue || 0),
              })}
            </span>
          </CardContent>
        </Card>

        {/* Items Sold */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 block">
              {t('finance.sales.analytics.kpis.itemsSold')}
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-0.5">
              {data?.kpis.totalItemsSold || 0}
            </div>
            <span className="text-[10px] text-stone-400 block mt-0.5">
              {t('finance.sales.analytics.kpis.unitsAcrossMenu')}
            </span>
          </CardContent>
        </Card>

        {/* Total Tax */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 block">
              {t('finance.sales.analytics.kpis.gstTaxes')}
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-0.5">
              {formatINR(data?.kpis.totalTax || 0)}
            </div>
            <span className="text-[10px] text-stone-400 block mt-0.5">
              {t('finance.sales.analytics.kpis.taxesCollected')}
            </span>
          </CardContent>
        </Card>

        {/* Total Discounts */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 block">
              {t('finance.sales.analytics.kpis.discounts')}
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-0.5">
              {formatINR(data?.kpis.totalDiscounts || 0)}
            </div>
            <span className="text-[10px] text-stone-400 block mt-0.5">
              {t('finance.sales.analytics.kpis.specialOffers')}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Hourly Stacked Bar Chart */}
      <Card className="border-stone-200 shadow-xs">
        <CardHeader className="pb-2 border-b border-stone-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-amber-600" />
              {t('finance.sales.analytics.hourlyChart.title')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {t('finance.sales.analytics.hourlyChart.subtitle')}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {loading ? (
            <div className="py-20 text-center text-xs text-stone-400">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
              {t('finance.sales.analytics.hourlyChart.loading')}
            </div>
          ) : !data || data.hourly.length === 0 || data.hourly.every((h) => h.total_sales === 0) ? (
            <div className="py-20 text-center text-xs text-stone-400">
              {t('finance.sales.analytics.hourlyChart.noData', {
                date: isDrilldown && drilldownDate ? drilldownDate : `${activeStartDate} – ${activeEndDate}`,
              })}
            </div>
          ) : (
            <HourlyCategoryStackedBarChart
              hourlyData={data.hourly}
              parentCategoriesList={data.parentCategoriesList}
              categoryColors={data.parentCategoryColors}
              parentCategoryTranslations={data.parentCategoryTranslations}
            />
          )}
        </CardContent>
      </Card>

      {/* Granular Filters Bar */}
      {data?.activeFilterOptions && (
        <div className="bg-white border border-stone-200 rounded-xl p-3 shadow-2xs space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
            <Filter className="h-3.5 w-3.5 text-stone-400" />
            <span>{t('finance.sales.analytics.filters.title')}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            {/* Parent Category Filter */}
            <select
              value={parentCategory}
              onChange={(e) => {
                setParentCategory(e.target.value);
                setBillsPage(1);
              }}
              className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            >
              <option value="">{t('finance.sales.analytics.filters.allParents')}</option>
              {data.activeFilterOptions.parentCategories.map((p) => (
                <option key={p} value={p}>
                  {getLocalizedParentCategory(p)}
                </option>
              ))}
            </select>

            {/* Subcategory Filter */}
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setBillsPage(1);
              }}
              className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            >
              <option value="">{t('finance.sales.analytics.filters.allCategories')}</option>
              {data.activeFilterOptions.categories.map((c) => (
                <option key={c} value={c}>
                  {getLocalizedCategory(c)}
                </option>
              ))}
            </select>

            {/* Captain Filter */}
            <select
              value={captain}
              onChange={(e) => {
                setCaptain(e.target.value);
                setBillsPage(1);
              }}
              className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            >
              <option value="">{t('finance.sales.analytics.filters.allCaptains')}</option>
              {data.activeFilterOptions.captains.map((cap) => (
                <option key={cap} value={cap}>
                  {cap}
                </option>
              ))}
            </select>

            {/* Payment Type Filter */}
            <select
              value={paymentType}
              onChange={(e) => {
                setPaymentType(e.target.value);
                setBillsPage(1);
              }}
              className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            >
              <option value="">{t('finance.sales.analytics.filters.allPayments')}</option>
              {data.activeFilterOptions.paymentTypes.map((pm) => (
                <option key={pm} value={pm}>
                  {getLocalizedPaymentMode(pm)}
                </option>
              ))}
            </select>

            {/* Order Type Filter */}
            <select
              value={orderType}
              onChange={(e) => {
                setOrderType(e.target.value);
                setBillsPage(1);
              }}
              className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            >
              <option value="">{t('finance.sales.analytics.filters.allOrderTypes')}</option>
              {data.activeFilterOptions.orderTypes.map((ot) => (
                <option key={ot} value={ot}>
                  {getLocalizedOrderType(ot)}
                </option>
              ))}
            </select>

            {/* Item Name Search */}
            <div className="relative">
              <input
                type="text"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder={t('finance.sales.analytics.filters.searchItem')}
                className="w-full rounded-lg border border-stone-200 pl-2 pr-7 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
              />
              {itemSearch && (
                <button
                  onClick={() => setItemSearch('')}
                  className="absolute right-2 top-2 text-stone-400 hover:text-stone-600"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs Navigation */}
      <Card className="border-stone-200 shadow-xs">
        <CardHeader className="p-0 border-b border-stone-200">
          <div className="flex items-center overflow-x-auto">
            <button
              onClick={() => setActiveTab('categories')}
              className={`px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'categories'
                  ? 'border-amber-600 text-amber-800 bg-amber-50/30'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              {t('finance.sales.analytics.tabs.categories', {
                count: data?.breakdowns.byParentCategory.length || 0,
              })}
            </button>

            <button
              onClick={() => setActiveTab('items')}
              className={`px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'items'
                  ? 'border-amber-600 text-amber-800 bg-amber-50/30'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <UtensilsCrossed className="h-3.5 w-3.5" />
              {t('finance.sales.analytics.tabs.items')}
            </button>

            <button
              onClick={() => setActiveTab('payments')}
              className={`px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'payments'
                  ? 'border-amber-600 text-amber-800 bg-amber-50/30'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <CreditCard className="h-3.5 w-3.5" />
              {t('finance.sales.analytics.tabs.payments')}
            </button>

            <button
              onClick={() => setActiveTab('captains')}
              className={`px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'captains'
                  ? 'border-amber-600 text-amber-800 bg-amber-50/30'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <UserCheck className="h-3.5 w-3.5" />
              {t('finance.sales.analytics.tabs.captains')}
            </button>

            <button
              onClick={() => setActiveTab('orders')}
              className={`px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'orders'
                  ? 'border-amber-600 text-amber-800 bg-amber-50/30'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              {t('finance.sales.analytics.tabs.orders')}
            </button>

            <button
              onClick={() => setActiveTab('bills')}
              className={`px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'bills'
                  ? 'border-amber-600 text-amber-800 bg-amber-50/30'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <Receipt className="h-3.5 w-3.5" />
              {t('finance.sales.analytics.tabs.bills', {
                count: billsTotalCount || data?.kpis.totalBills || 0,
              })}
            </button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* TAB 1: CATEGORIES */}
          {activeTab === 'categories' && (
            <div className="p-4 space-y-4">
              {/* Parent Category Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                {data?.breakdowns.byParentCategory.map((pc) => {
                  const color =
                    (data?.parentCategoryColors && data.parentCategoryColors[pc.name.trim().toLowerCase()]) ||
                    getCategoryColor(pc.name);
                  return (
                    <div
                      key={pc.name}
                      onClick={() => {
                        setParentCategory(parentCategory === pc.name ? '' : pc.name);
                        setBillsPage(1);
                      }}
                      className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                        parentCategory === pc.name
                          ? 'border-amber-500 bg-amber-50/50 shadow-xs'
                          : 'border-stone-200 hover:border-stone-300 bg-stone-50/30'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-xs font-semibold text-stone-800 truncate">
                          {getLocalizedParentCategory(pc.name)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between">
                        <span className="text-sm font-bold text-stone-900">
                          {formatINR(pc.amount)}
                        </span>
                        <span className="text-[10px] text-stone-500 font-mono">
                          {pc.sharePercent}%
                        </span>
                      </div>
                      <div className="text-[10px] text-stone-400 mt-0.5">
                        {pc.quantity} items sold
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Subcategories Table */}
              <div className="overflow-x-auto border border-stone-200 rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                    <tr>
                      <th className="p-3">{t('finance.sales.analytics.tables.colCategory')}</th>
                      <th className="p-3">{t('finance.sales.analytics.tables.colParent')}</th>
                      <th className="p-3 text-center">{t('finance.sales.analytics.tables.colQty')}</th>
                      <th className="p-3 text-right">{t('finance.sales.analytics.tables.colNetSales')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {data?.breakdowns.byCategory.map((cat) => (
                      <tr key={cat.name} className="hover:bg-stone-50/50">
                        <td className="p-3 font-semibold text-stone-900">
                          {getLocalizedCategory(cat.name)}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className={getCategoryBadgeClasses(cat.parent)}>
                            {getLocalizedParentCategory(cat.parent)}
                          </Badge>
                        </td>
                        <td className="p-3 text-center font-mono text-stone-600">
                          {cat.quantity}
                        </td>
                        <td className="p-3 text-right font-bold text-stone-900">
                          {formatINR(cat.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: TOP SELLING ITEMS */}
          {activeTab === 'items' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">{t('finance.sales.analytics.tables.colItem')}</th>
                    <th className="p-3">{t('finance.sales.analytics.tables.colParent')}</th>
                    <th className="p-3 text-center">{t('finance.sales.analytics.tables.colQty')}</th>
                    <th className="p-3 text-right">{t('finance.sales.analytics.tables.colAvgPrice')}</th>
                    <th className="p-3 text-right">{t('finance.sales.analytics.tables.colNetSales')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.breakdowns.byTopItems.map((item, idx) => {
                    const avgPrice = item.quantity > 0 ? Math.round(item.amount / item.quantity) : 0;
                    return (
                      <tr key={item.name} className="hover:bg-stone-50/50">
                        <td className="p-3 font-mono text-stone-400 text-[11px]">{idx + 1}</td>
                        <td className="p-3 font-semibold text-stone-900">{item.name}</td>
                        <td className="p-3">
                          <Badge variant="outline" className={getCategoryBadgeClasses(item.parentCategory)}>
                            {getLocalizedParentCategory(item.parentCategory)}
                          </Badge>
                        </td>
                        <td className="p-3 text-center font-bold text-stone-800">{item.quantity}</td>
                        <td className="p-3 text-right font-mono text-stone-600">{formatINR(avgPrice)}</td>
                        <td className="p-3 text-right font-bold text-stone-900">{formatINR(item.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: PAYMENTS */}
          {activeTab === 'payments' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="p-3">{t('finance.sales.analytics.tables.colPaymentMode')}</th>
                    <th className="p-3 text-right">{t('finance.sales.analytics.tables.colTotalCollected')}</th>
                    <th className="p-3 text-right">{t('finance.sales.analytics.tables.colShare')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.breakdowns.byPaymentMode.map((pm) => (
                    <tr key={pm.name} className="hover:bg-stone-50/50">
                      <td className="p-3 font-semibold text-stone-900">
                        <Badge variant="outline" className="text-xs">
                          {getLocalizedPaymentMode(pm.name)}
                        </Badge>
                      </td>
                      <td className="p-3 text-right font-bold text-stone-900">{formatINR(pm.amount)}</td>
                      <td className="p-3 text-right font-mono text-stone-600">{pm.sharePercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 4: CAPTAINS */}
          {activeTab === 'captains' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="p-3">{t('finance.sales.analytics.tables.colCaptain')}</th>
                    <th className="p-3 text-center">{t('finance.sales.analytics.tables.colBillCount')}</th>
                    <th className="p-3 text-center">{t('finance.sales.analytics.tables.colCovers')}</th>
                    <th className="p-3 text-right">{t('finance.sales.analytics.tables.colNetSales')}</th>
                    <th className="p-3 text-right">{t('finance.sales.analytics.kpis.aov', { amount: '' }).replace(': ', '')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.breakdowns.byCaptain.map((cap) => (
                    <tr key={cap.name} className="hover:bg-stone-50/50">
                      <td className="p-3 font-semibold text-stone-900">{cap.name}</td>
                      <td className="p-3 text-center font-medium text-stone-700">{cap.ordersCount}</td>
                      <td className="p-3 text-center font-mono text-stone-600">{cap.coversPax}</td>
                      <td className="p-3 text-right font-bold text-stone-900">{formatINR(cap.netSales)}</td>
                      <td className="p-3 text-right font-mono text-stone-600">{formatINR(cap.avgOrder)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 5: ORDER TYPES */}
          {activeTab === 'orders' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="p-3">{t('finance.sales.analytics.tables.colOrderType')}</th>
                    <th className="p-3 text-center">{t('finance.sales.analytics.tables.colBillCount')}</th>
                    <th className="p-3 text-right">{t('finance.sales.analytics.tables.colNetSales')}</th>
                    <th className="p-3 text-right">{t('finance.sales.analytics.tables.colShare')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.breakdowns.byOrderType.map((ot) => (
                    <tr key={ot.name} className="hover:bg-stone-50/50">
                      <td className="p-3 font-semibold text-stone-900">
                        {getLocalizedOrderType(ot.name)}
                      </td>
                      <td className="p-3 text-center font-medium text-stone-700">{ot.count}</td>
                      <td className="p-3 text-right font-bold text-stone-900">{formatINR(ot.netSales)}</td>
                      <td className="p-3 text-right font-mono text-stone-600">{ot.sharePercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 6: INDIVIDUAL BILLS (SERVER-SIDE PAGINATED) */}
          {activeTab === 'bills' && (
            <div className="space-y-3 p-3">
              {/* Search, Order Type Filter & Info Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 flex-1">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-stone-400" />
                    <input
                      type="text"
                      value={billSearchTerm}
                      onChange={(e) => {
                        setBillSearchTerm(e.target.value);
                        setBillsPage(1);
                      }}
                      placeholder={
                        locale === 'hi'
                          ? 'बिल नं, ग्राहक, कैप्टन, एरिया खोजें...'
                          : 'Search invoice #, customer, captain, area...'
                      }
                      className="w-full pl-8 pr-7 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium"
                    />
                    {billSearchTerm && (
                      <button
                        onClick={() => {
                          setBillSearchTerm('');
                          setBillsPage(1);
                        }}
                        className="absolute right-2 top-2 text-stone-400 hover:text-stone-600 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1 overflow-x-auto text-[11px]">
                    <button
                      onClick={() => {
                        setBillOrderTypeFilter('ALL');
                        setBillsPage(1);
                      }}
                      className={`px-2 py-1 rounded-md font-semibold transition cursor-pointer ${
                        billOrderTypeFilter === 'ALL'
                          ? 'bg-amber-600 text-white shadow-2xs'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}
                    >
                      {locale === 'hi' ? 'सभी' : 'All'}
                    </button>
                    {['Dine In', 'Snacks Stall', 'Takeaway', 'Lancho'].map((ot) => (
                      <button
                        key={ot}
                        onClick={() => {
                          setBillOrderTypeFilter(ot);
                          setBillsPage(1);
                        }}
                        className={`px-2 py-1 rounded-md font-semibold transition cursor-pointer whitespace-nowrap ${
                          billOrderTypeFilter === ot
                            ? 'bg-amber-600 text-white shadow-2xs'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                      >
                        {getLocalizedOrderType(ot)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-[11px] text-stone-500 font-medium self-end sm:self-center">
                  {t('finance.sales.analytics.pagination.showingBills', {
                    showing: bills.length,
                    total: billsTotalCount,
                  })}
                  <span className="font-bold text-amber-800">{formatINR(billsTotalGrand)}</span>
                </div>
              </div>

              {/* Bills Table */}
              <div className="overflow-x-auto border border-stone-200 rounded-lg">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                    <tr>
                      <th className="p-2.5">{t('finance.sales.analytics.tables.colBillNo')}</th>
                      <th className="p-2.5">{t('finance.sales.analytics.tables.colOrderTime')}</th>
                      <th className="p-2.5">{t('finance.sales.analytics.tables.colOrderType')}</th>
                      <th className="p-2.5 text-center">{t('finance.sales.analytics.tables.colPax')}</th>
                      <th className="p-2.5">{t('finance.sales.analytics.tables.colCaptain')}</th>
                      <th className="p-2.5">{locale === 'hi' ? 'ग्राहक' : 'Customer'}</th>
                      <th className="p-2.5">{t('finance.sales.analytics.tables.colPayment')}</th>
                      <th className="p-2.5 text-right">{t('finance.sales.analytics.tables.colGross')}</th>
                      <th className="p-2.5 text-right">{t('finance.sales.analytics.tables.colDiscounts')}</th>
                      <th className="p-2.5 text-right">{t('finance.sales.analytics.tables.colNet')}</th>
                      <th className="p-2.5 text-right">{t('finance.sales.analytics.tables.colTaxes')}</th>
                      <th className="p-2.5 text-right">{t('finance.sales.analytics.kpis.grandTotal')}</th>
                      <th className="p-2.5 text-center">{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {billsLoading ? (
                      <tr>
                        <td colSpan={13} className="p-10 text-center text-stone-400">
                          <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-amber-500" />
                          {t('finance.sales.analytics.pagination.loadingBills')}
                        </td>
                      </tr>
                    ) : bills.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="p-8 text-center text-stone-400">
                          {t('finance.sales.analytics.tables.noData')}
                        </td>
                      </tr>
                    ) : (
                      bills.map((bill) => {
                        const timeStr = bill.order_timestamp
                          ? new Date(bill.order_timestamp).toLocaleTimeString(
                              locale === 'hi' ? 'hi-IN' : 'en-IN',
                              {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true,
                              }
                            )
                          : '—';

                        const bu = getOrderBusinessUnit(bill);
                        const badgeClass =
                          bu === 'Dine In'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                            : bu === 'Snacks Stall'
                            ? 'border-amber-300 bg-amber-50 text-amber-800'
                            : bu === 'Lancho'
                            ? 'border-purple-300 bg-purple-50 text-purple-800'
                            : 'border-sky-300 bg-sky-50 text-sky-800';

                        return (
                          <tr key={bill.id} className="hover:bg-stone-50/70 transition-colors">
                            <td className="p-2.5 font-bold text-stone-900 font-mono">
                              #{bill.invoice_no}
                            </td>
                            <td className="p-2.5 text-stone-500 whitespace-nowrap">
                              {timeStr}
                            </td>
                            <td className="p-2.5">
                              <Badge variant="outline" className={`text-[10px] font-semibold ${badgeClass}`}>
                                {getLocalizedOrderType(bu)}
                              </Badge>
                              {bill.order_type && bill.order_type !== bu && (
                                <span className="block text-[9px] text-stone-400 mt-0.5">
                                  POS: {bill.order_type}
                                </span>
                              )}
                              {bill.area && (
                                <span className="block text-[10px] text-stone-400 mt-0.5">
                                  {bill.area}
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 text-center font-semibold text-stone-700">
                              {bill.covers_pax || 1}
                            </td>
                            <td className="p-2.5 text-stone-800 font-medium">
                              <div>{bill.captain_name || bill.biller || '—'}</div>
                              {bill.biller && bill.captain_name && (
                                <div className="text-[9px] text-stone-400">Biller: {bill.biller}</div>
                              )}
                            </td>
                            <td className="p-2.5 text-stone-700">
                              {bill.customer_name ? (
                                <div>
                                  <span className="font-medium text-stone-900">{bill.customer_name}</span>
                                  {bill.customer_phone && (
                                    <span className="block text-[9px] text-stone-400 font-mono">
                                      {bill.customer_phone}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-stone-300">—</span>
                              )}
                            </td>
                            <td className="p-2.5">
                              <Badge variant="outline" className="text-[10px] font-medium">
                                {getLocalizedPaymentMode(bill.payment_type || 'Cash')}
                              </Badge>
                            </td>
                            <td className="p-2.5 text-right font-mono text-stone-600">
                              {formatINR(Number(bill.gross_amount) || 0)}
                            </td>
                            <td className="p-2.5 text-right font-mono text-stone-500">
                              {Number(bill.discount_amount) > 0 ? (
                                <span className="text-amber-700">
                                  -{formatINR(Number(bill.discount_amount))}
                                </span>
                              ) : (
                                '₹0'
                              )}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-stone-900">
                              {formatINR(Number(bill.net_sales) || 0)}
                            </td>
                            <td className="p-2.5 text-right font-mono text-stone-500">
                              {formatINR(Number(bill.tax_amount) || 0)}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-amber-800">
                              {formatINR(Number(bill.grand_total) || 0)}
                            </td>
                            <td className="p-2.5 text-center">
                              <Badge
                                className={`text-[9px] font-bold ${
                                  bill.status === 'Success'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : bill.status === 'Complimentary'
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {bill.status}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {bills.length > 0 && (
                    <tfoot className="bg-stone-100/80 font-bold text-stone-900 border-t border-stone-200">
                      <tr>
                        <td colSpan={3} className="p-2.5">
                          {locale === 'hi'
                            ? `कुल योग (${billsTotalCount} बिल)`
                            : `Total (${billsTotalCount} Bills)`}
                        </td>
                        <td className="p-2.5 text-center">{billsTotalCovers}</td>
                        <td colSpan={5}></td>
                        <td className="p-2.5 text-right font-mono">{formatINR(billsTotalNet)}</td>
                        <td className="p-2.5 text-right font-mono"></td>
                        <td className="p-2.5 text-right font-mono text-amber-800">
                          {formatINR(billsTotalGrand)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Pagination Controls */}
              {billsTotalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-500 font-medium">
                      {t('finance.sales.analytics.pagination.pageInfo', {
                        page: billsPage,
                        totalPages: billsTotalPages,
                        totalCount: billsTotalCount,
                      })}
                    </span>
                    <select
                      value={billsPageSize}
                      onChange={(e) => {
                        setBillsPageSize(Number(e.target.value));
                        setBillsPage(1);
                      }}
                      className="text-xs bg-stone-50 border border-stone-200 rounded-md px-2 py-1 text-stone-700 focus:outline-none"
                    >
                      <option value={25}>{t('finance.sales.analytics.pagination.perPage', { count: 25 })}</option>
                      <option value={50}>{t('finance.sales.analytics.pagination.perPage', { count: 50 })}</option>
                      <option value={100}>{t('finance.sales.analytics.pagination.perPage', { count: 100 })}</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBillsPage((p) => Math.max(1, p - 1))}
                      disabled={billsPage <= 1 || billsLoading}
                      className="h-7 text-xs px-2.5 gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      {t('finance.sales.analytics.pagination.previous')}
                    </Button>
                    <span className="text-xs font-semibold px-2 text-stone-700">
                      {billsPage} / {billsTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBillsPage((p) => Math.min(billsTotalPages, p + 1))}
                      disabled={billsPage >= billsTotalPages || billsLoading}
                      className="h-7 text-xs px-2.5 gap-1 cursor-pointer"
                    >
                      {t('finance.sales.analytics.pagination.next')}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
