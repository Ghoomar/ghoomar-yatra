'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { SalesAnalyticsResponse } from '@/lib/types/sales';
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
  PieChart,
  ShoppingBag,
} from 'lucide-react';

interface SalesAnalyticsDashboardProps {
  initialDate?: string;
  onDateChange?: (date: string) => void;
  hideDatePicker?: boolean;
}

export function SalesAnalyticsDashboard({
  initialDate,
  onDateChange,
  hideDatePicker = false,
}: SalesAnalyticsDashboardProps) {
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || getTodayBusinessDate());

  useEffect(() => {
    if (initialDate && initialDate !== selectedDate) {
      setSelectedDate(initialDate);
    }
  }, [initialDate]);
  const [parentCategory, setParentCategory] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [itemSearch, setItemSearch] = useState<string>('');
  const [captain, setCaptain] = useState<string>('');
  const [paymentType, setPaymentType] = useState<string>('');
  const [orderType, setOrderType] = useState<string>('');

  const [activeTab, setActiveTab] = useState<'categories' | 'items' | 'payments' | 'captains' | 'orders' | 'bills'>('categories');
  const [billSearchTerm, setBillSearchTerm] = useState<string>('');
  const [billOrderTypeFilter, setBillOrderTypeFilter] = useState<string>('ALL');

  const [data, setData] = useState<SalesAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedDate) {
        params.set('start_date', selectedDate);
        params.set('end_date', selectedDate);
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
      setError(err.message || 'Error loading sales analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [selectedDate, parentCategory, category, captain, paymentType, orderType]);

  // Debounced search on item name
  useEffect(() => {
    const timer = setTimeout(() => {
      loadAnalytics();
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
  };

  return (
    <div className="space-y-6">
      {/* Date & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white border border-stone-200 rounded-xl p-1.5 shadow-2xs">
            <Calendar className="h-4 w-4 text-stone-400 ml-1.5 mr-1" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                const newDate = e.target.value;
                setSelectedDate(newDate);
                onDateChange?.(newDate);
              }}
              className="px-2 text-xs font-bold text-stone-900 bg-transparent border-0 focus:outline-none cursor-pointer"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={loadAnalytics}
            disabled={loading}
            className="h-8 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Quick Filter Status */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-stone-500 font-medium">Filtered View Active</span>
            <Button
              variant="outline"
              size="sm"
              onClick={resetFilters}
              className="h-7 text-xs text-stone-600 hover:text-stone-900 gap-1"
            >
              <X className="h-3 w-3" /> Reset Filters
            </Button>
          </div>
        )}
      </div>

      {/* Reconciliation Banner */}
      {data && (
        <SalesReconciliationBanner
          reconciliation={data.reconciliation}
          businessDate={selectedDate}
        />
      )}

      {/* Top Executive KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {/* Net Sales */}
        <Card className="border-amber-300 bg-amber-50/30 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
              Net Sales
            </span>
            <div className="text-2xl font-extrabold text-amber-900 mt-0.5">
              {formatINR(data?.kpis.netSales || 0)}
            </div>
            <span className="text-[10px] text-amber-700 block mt-0.5">
              Net of discounts
            </span>
          </CardContent>
        </Card>

        {/* Gross / Grand Total */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 block">
              Grand Total
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-0.5">
              {formatINR(data?.kpis.grossSales || 0)}
            </div>
            <span className="text-[10px] text-stone-400 block mt-0.5">
              Inclusive of taxes
            </span>
          </CardContent>
        </Card>

        {/* Total Bills */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 block">
              Total Bills
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-0.5">
              {data?.kpis.totalBills || 0}
            </div>
            <span className="text-[10px] text-stone-400 block mt-0.5">
              AOV: {formatINR(data?.kpis.averageOrderValue || 0)}
            </span>
          </CardContent>
        </Card>

        {/* Items Sold */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 block">
              Items Sold
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-0.5">
              {data?.kpis.totalItemsSold || 0}
            </div>
            <span className="text-[10px] text-stone-400 block mt-0.5">
              Units across menu
            </span>
          </CardContent>
        </Card>

        {/* Total Tax */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 block">
              GST / Taxes
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-0.5">
              {formatINR(data?.kpis.totalTax || 0)}
            </div>
            <span className="text-[10px] text-stone-400 block mt-0.5">
              CGST + SGST collected
            </span>
          </CardContent>
        </Card>

        {/* Total Discounts */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 block">
              Discounts
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-0.5">
              {formatINR(data?.kpis.totalDiscounts || 0)}
            </div>
            <span className="text-[10px] text-stone-400 block mt-0.5">
              Special offers / promos
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
              Hourly Sales by Parent Category
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              Hover over columns to view hourly revenue and category contribution breakdown
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {loading ? (
            <div className="py-20 text-center text-xs text-stone-400">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
              Loading hourly sales distribution...
            </div>
          ) : !data || data.hourly.length === 0 || data.hourly.every((h) => h.total_sales === 0) ? (
            <div className="py-20 text-center text-xs text-stone-400">
              No hourly sales data recorded for {selectedDate}. Upload an Hourly Item Sales report in the &quot;Import Reports&quot; tab.
            </div>
          ) : (
            <HourlyCategoryStackedBarChart
              hourlyData={data.hourly}
              parentCategoriesList={data.parentCategoriesList}
            />
          )}
        </CardContent>
      </Card>

      {/* Granular Filters Bar */}
      {data?.activeFilterOptions && (
        <div className="bg-white border border-stone-200 rounded-xl p-3 shadow-2xs space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
            <Filter className="h-3.5 w-3.5 text-stone-400" />
            <span>Filter Sales Analytics</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            {/* Parent Category Filter */}
            <select
              value={parentCategory}
              onChange={(e) => setParentCategory(e.target.value)}
              className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            >
              <option value="">All Parent Categories</option>
              {data.activeFilterOptions.parentCategories.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            {/* Subcategory Filter */}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            >
              <option value="">All Categories</option>
              {data.activeFilterOptions.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Captain Filter */}
            <select
              value={captain}
              onChange={(e) => setCaptain(e.target.value)}
              className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            >
              <option value="">All Captains</option>
              {data.activeFilterOptions.captains.map((cap) => (
                <option key={cap} value={cap}>
                  {cap}
                </option>
              ))}
            </select>

            {/* Payment Type Filter */}
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value)}
              className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            >
              <option value="">All Payment Modes</option>
              {data.activeFilterOptions.paymentTypes.map((pm) => (
                <option key={pm} value={pm}>
                  {pm}
                </option>
              ))}
            </select>

            {/* Order Type Filter */}
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
            >
              <option value="">All Order Types</option>
              {data.activeFilterOptions.orderTypes.map((ot) => (
                <option key={ot} value={ot}>
                  {ot}
                </option>
              ))}
            </select>

            {/* Item Search Input */}
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3 w-3 text-stone-400" />
              <input
                type="text"
                placeholder="Search Item..."
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="w-full rounded-lg border border-stone-200 pl-7 pr-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none bg-stone-50/50"
              />
            </div>
          </div>
        </div>
      )}

      {/* Derived Analytics Breakdowns Section */}
      <Card className="border-stone-200 shadow-xs">
        {/* Tab Headers */}
        <div className="flex border-b border-stone-200 bg-stone-50/50 px-4 overflow-x-auto">
          <button
            onClick={() => setActiveTab('categories')}
            className={`py-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
              activeTab === 'categories'
                ? 'border-amber-600 text-amber-700 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Layers className="h-4 w-4" />
            Category Sales ({data?.breakdowns.byParentCategory.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('items')}
            className={`py-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
              activeTab === 'items'
                ? 'border-amber-600 text-amber-700 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <UtensilsCrossed className="h-4 w-4" />
            Top Selling Items
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`py-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
              activeTab === 'payments'
                ? 'border-amber-600 text-amber-700 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <CreditCard className="h-4 w-4" />
            Payment Modes
          </button>
          <button
            onClick={() => setActiveTab('captains')}
            className={`py-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
              activeTab === 'captains'
                ? 'border-amber-600 text-amber-700 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <UserCheck className="h-4 w-4" />
            Captain Performance
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`py-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
              activeTab === 'orders'
                ? 'border-amber-600 text-amber-700 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <ShoppingBag className="h-4 w-4" />
            Order Types
          </button>
          <button
            onClick={() => setActiveTab('bills')}
            className={`py-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
              activeTab === 'bills'
                ? 'border-amber-600 text-amber-700 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Receipt className="h-4 w-4" />
            All Bills ({data?.allBills?.length || 0})
          </button>
        </div>

        <CardContent className="p-0">
          {/* TAB 1: CATEGORY BREAKDOWN */}
          {activeTab === 'categories' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="p-3">Parent Category</th>
                    <th className="p-3 text-center">Items Sold</th>
                    <th className="p-3 text-right">Net Sales</th>
                    <th className="p-3 text-right">Share %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.breakdowns.byParentCategory.map((cat) => (
                    <tr key={cat.name} className="hover:bg-stone-50/50">
                      <td className="p-3 font-semibold text-stone-900">
                        {cat.name}
                      </td>
                      <td className="p-3 text-center font-medium text-stone-700">
                        {cat.quantity}
                      </td>
                      <td className="p-3 text-right font-bold text-stone-900">
                        {formatINR(cat.amount)}
                      </td>
                      <td className="p-3 text-right font-mono text-stone-600">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-stone-100 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-amber-500 h-full rounded-full"
                              style={{ width: `${Math.min(100, cat.sharePercent)}%` }}
                            />
                          </div>
                          <span>{cat.sharePercent}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: TOP SELLING ITEMS */}
          {activeTab === 'items' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="p-3">Item Name</th>
                    <th className="p-3">Category</th>
                    <th className="p-3 text-center">Quantity Sold</th>
                    <th className="p-3 text-right">Net Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.breakdowns.byTopItems.map((item, idx) => (
                    <tr key={item.name} className="hover:bg-stone-50/50">
                      <td className="p-3 font-semibold text-stone-900 flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center text-[10px] font-bold">
                          {idx + 1}
                        </span>
                        {item.name}
                      </td>
                      <td className="p-3 text-stone-500">
                        <Badge variant="outline" className="text-[10px]">
                          {item.parentCategory}
                        </Badge>
                      </td>
                      <td className="p-3 text-center font-bold text-stone-800">
                        {item.quantity}
                      </td>
                      <td className="p-3 text-right font-bold text-amber-800">
                        {formatINR(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: PAYMENT MODES */}
          {activeTab === 'payments' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="p-3">Payment Mode</th>
                    <th className="p-3 text-right">Total Collected</th>
                    <th className="p-3 text-right">Share %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.breakdowns.byPaymentMode.map((p) => (
                    <tr key={p.name} className="hover:bg-stone-50/50">
                      <td className="p-3 font-semibold text-stone-900 flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-stone-400" />
                        {p.name}
                      </td>
                      <td className="p-3 text-right font-bold text-emerald-700">
                        {formatINR(p.amount)}
                      </td>
                      <td className="p-3 text-right font-mono text-stone-600">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-stone-100 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-emerald-600 h-full rounded-full"
                              style={{ width: `${Math.min(100, p.sharePercent)}%` }}
                            />
                          </div>
                          <span>{p.sharePercent}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 4: CAPTAIN PERFORMANCE */}
          {activeTab === 'captains' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="p-3">Captain Name</th>
                    <th className="p-3 text-center">Orders Handled</th>
                    <th className="p-3 text-center">Covers (Pax)</th>
                    <th className="p-3 text-right">Net Sales</th>
                    <th className="p-3 text-right">Avg Order Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.breakdowns.byCaptain.map((cap) => (
                    <tr key={cap.name} className="hover:bg-stone-50/50">
                      <td className="p-3 font-semibold text-stone-900">
                        {cap.name}
                      </td>
                      <td className="p-3 text-center font-medium text-stone-700">
                        {cap.ordersCount}
                      </td>
                      <td className="p-3 text-center font-medium text-stone-700">
                        {cap.coversPax}
                      </td>
                      <td className="p-3 text-right font-bold text-stone-900">
                        {formatINR(cap.netSales)}
                      </td>
                      <td className="p-3 text-right font-mono text-stone-600">
                        {formatINR(cap.avgOrder)}
                      </td>
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
                    <th className="p-3">Order Type</th>
                    <th className="p-3 text-center">Orders Count</th>
                    <th className="p-3 text-right">Net Sales</th>
                    <th className="p-3 text-right">Share %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data?.breakdowns.byOrderType.map((ot) => (
                    <tr key={ot.name} className="hover:bg-stone-50/50">
                      <td className="p-3 font-semibold text-stone-900">
                        {ot.name}
                      </td>
                      <td className="p-3 text-center font-medium text-stone-700">
                        {ot.count}
                      </td>
                      <td className="p-3 text-right font-bold text-stone-900">
                        {formatINR(ot.netSales)}
                      </td>
                      <td className="p-3 text-right font-mono text-stone-600">
                        {ot.sharePercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 6: ALL BILLS */}
          {activeTab === 'bills' && (() => {
            const allBills = data?.allBills || [];
            const filteredBills = allBills.filter((bill) => {
              const matchesSearch =
                !billSearchTerm ||
                bill.invoice_no?.toLowerCase().includes(billSearchTerm.toLowerCase()) ||
                bill.customer_name?.toLowerCase().includes(billSearchTerm.toLowerCase()) ||
                bill.customer_phone?.includes(billSearchTerm) ||
                bill.captain_name?.toLowerCase().includes(billSearchTerm.toLowerCase()) ||
                bill.biller?.toLowerCase().includes(billSearchTerm.toLowerCase()) ||
                bill.area?.toLowerCase().includes(billSearchTerm.toLowerCase());

              const matchesType =
                billOrderTypeFilter === 'ALL' || bill.order_type === billOrderTypeFilter;

              return matchesSearch && matchesType;
            });

            const totalFilteredNet = filteredBills.reduce((s, b) => s + (Number(b.net_sales) || 0), 0);
            const totalFilteredGrand = filteredBills.reduce((s, b) => s + (Number(b.grand_total) || 0), 0);
            const totalFilteredCovers = filteredBills.reduce((s, b) => s + (Number(b.covers_pax) || 0), 0);
            const distinctOrderTypes = Array.from(new Set(allBills.map((b) => b.order_type).filter(Boolean)));

            return (
              <div className="space-y-3 p-3">
                {/* Search & Order Type Filter */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="relative flex-1 max-w-sm">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-stone-400" />
                      <input
                        type="text"
                        value={billSearchTerm}
                        onChange={(e) => setBillSearchTerm(e.target.value)}
                        placeholder="Search invoice #, customer, captain, area..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium"
                      />
                      {billSearchTerm && (
                        <button
                          onClick={() => setBillSearchTerm('')}
                          className="absolute right-2 top-2 text-stone-400 hover:text-stone-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1 overflow-x-auto text-[11px]">
                      <button
                        onClick={() => setBillOrderTypeFilter('ALL')}
                        className={`px-2 py-1 rounded-md font-semibold transition cursor-pointer ${
                          billOrderTypeFilter === 'ALL'
                            ? 'bg-amber-600 text-white shadow-2xs'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                      >
                        All ({allBills.length})
                      </button>
                      {distinctOrderTypes.map((ot) => {
                        const count = allBills.filter((b) => b.order_type === ot).length;
                        return (
                          <button
                            key={ot}
                            onClick={() => setBillOrderTypeFilter(ot!)}
                            className={`px-2 py-1 rounded-md font-semibold transition cursor-pointer whitespace-nowrap ${
                              billOrderTypeFilter === ot
                                ? 'bg-amber-600 text-white shadow-2xs'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                            }`}
                          >
                            {ot} ({count})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="text-[11px] text-stone-500 font-medium self-end sm:self-center">
                    Showing <span className="font-bold text-stone-900">{filteredBills.length}</span> of {allBills.length} bills | Total: <span className="font-bold text-amber-800">{formatINR(totalFilteredGrand)}</span>
                  </div>
                </div>

                {/* Bills Table */}
                <div className="overflow-x-auto border border-stone-200 rounded-lg">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                      <tr>
                        <th className="p-2.5">Invoice #</th>
                        <th className="p-2.5">Time</th>
                        <th className="p-2.5">Type &amp; Area</th>
                        <th className="p-2.5 text-center">PAX</th>
                        <th className="p-2.5">Captain / Biller</th>
                        <th className="p-2.5">Customer</th>
                        <th className="p-2.5">Tender</th>
                        <th className="p-2.5 text-right">Gross</th>
                        <th className="p-2.5 text-right">Discount</th>
                        <th className="p-2.5 text-right">Net Sales</th>
                        <th className="p-2.5 text-right">Tax</th>
                        <th className="p-2.5 text-right">Grand Total</th>
                        <th className="p-2.5 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {filteredBills.length === 0 ? (
                        <tr>
                          <td colSpan={13} className="p-8 text-center text-stone-400">
                            No bills match the search filter.
                          </td>
                        </tr>
                      ) : (
                        filteredBills.map((bill) => {
                          const timeStr = bill.order_timestamp
                            ? new Date(bill.order_timestamp).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true,
                              })
                            : '—';

                          return (
                            <tr key={bill.id} className="hover:bg-stone-50/70 transition-colors">
                              <td className="p-2.5 font-bold text-stone-900 font-mono">
                                #{bill.invoice_no}
                              </td>
                              <td className="p-2.5 text-stone-500 whitespace-nowrap">
                                {timeStr}
                              </td>
                              <td className="p-2.5">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-semibold ${
                                    bill.order_type === 'Dine In'
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                      : bill.order_type === 'Snacks Stall'
                                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                                      : 'border-stone-300 bg-stone-50 text-stone-700'
                                  }`}
                                >
                                  {bill.order_type || 'General'}
                                </Badge>
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
                                      <span className="block text-[9px] text-stone-400 font-mono">{bill.customer_phone}</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-stone-300">—</span>
                                )}
                              </td>
                              <td className="p-2.5">
                                <Badge variant="outline" className="text-[10px] font-medium">
                                  {bill.payment_type || 'Cash'}
                                </Badge>
                              </td>
                              <td className="p-2.5 text-right font-mono text-stone-600">
                                {formatINR(Number(bill.gross_amount) || 0)}
                              </td>
                              <td className="p-2.5 text-right font-mono text-stone-500">
                                {Number(bill.discount_amount) > 0 ? (
                                  <span className="text-amber-700">-{formatINR(Number(bill.discount_amount))}</span>
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
                    {filteredBills.length > 0 && (
                      <tfoot className="bg-stone-100/80 font-bold text-stone-900 border-t border-stone-200">
                        <tr>
                          <td colSpan={3} className="p-2.5">Total ({filteredBills.length} Bills)</td>
                          <td className="p-2.5 text-center">{totalFilteredCovers}</td>
                          <td colSpan={3}></td>
                          <td className="p-2.5 text-right font-mono"></td>
                          <td className="p-2.5 text-right font-mono"></td>
                          <td className="p-2.5 text-right font-mono">{formatINR(totalFilteredNet)}</td>
                          <td className="p-2.5 text-right font-mono"></td>
                          <td className="p-2.5 text-right font-mono text-amber-800">{formatINR(totalFilteredGrand)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
