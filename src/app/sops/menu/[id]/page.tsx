'use client';

import React, { useState, useEffect, use, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';
import { useAppRole } from '@/components/layout/AppShell';
import { canViewCosting } from '@/lib/rbac';
import { formatINR, formatNullablePrice } from '@/lib/utils';
import { getBusinessDateRange } from '@/lib/business-date-ranges';
import { MENU_SALES_CHANNELS, menuSalesChannelTranslationKey, parseMenuSalesChannel, type MenuSalesChannel } from '@/lib/sales/menu-channels';
import { getCategoryColor } from '@/lib/constants/category-colors';
import { createClient } from '@/lib/supabase/client';
import { getCompatibleUnitOptions, CentralUnit } from '@/lib/sops/costing/units';
import {
  ArrowLeft,
  UtensilsCrossed,
  DollarSign,
  AlertTriangle,
  Lock,
  Edit2,
  Save,
  X,
  RefreshCw,
  ShoppingBag,
  Flame,
  Package,
  Layers,
  CheckCircle2,
  ExternalLink,
  Calendar,
  TrendingUp,
} from 'lucide-react';

interface MenuItemDetailPageProps {
  params: Promise<{ id: string }>;
}

type DatePreset = 'all' | 'yesterday' | '7d' | '30d' | 'this_month' | 'custom';
const DATE_PRESETS: DatePreset[] = ['all', 'yesterday', '7d', '30d', 'this_month', 'custom'];

function parseDatePreset(value: string | null, dateFrom: string | null, dateTo: string | null): DatePreset {
  if (value && DATE_PRESETS.includes(value as DatePreset)) return value as DatePreset;
  return dateFrom || dateTo ? 'custom' : 'all';
}

export default function MenuItemDetailPage({ params }: MenuItemDetailPageProps) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { hasPermission, role: activeRole, permissions } = useAppRole();
  const router = useRouter();
  const searchParams = useSearchParams();
  const channel = parseMenuSalesChannel(searchParams.get('channel')) || 'ALL';
  const datePreset = parseDatePreset(searchParams.get('date_preset'), searchParams.get('date_from'), searchParams.get('date_to'));
  const customFrom = searchParams.get('date_from') || '';
  const customTo = searchParams.get('date_to') || '';

  const canManage = hasPermission('sops.recipes.manage');
  const hasCostAccess = canViewCosting(activeRole, permissions);

  const [loading, setLoading] = useState(true);
  const [savingVariantId, setSavingVariantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [menuItem, setMenuItem] = useState<any>(null);
  const [variants, setVariants] = useState<any[]>([]);
  const [compositions, setCompositions] = useState<any[]>([]);
  const [compositionCost, setCompositionCost] = useState<any>(null);
  const [canonicalDish, setCanonicalDish] = useState<any>(null);
  const [servingConfiguration, setServingConfiguration] = useState<any>(null);
  const [salesMetrics, setSalesMetrics] = useState<any>(null);
  const fetchSequence = useRef(0);

  // Date and channel filters are derived from a single URL state.
  const [dateRangeStatus, setDateRangeStatus] = useState<'ready' | 'empty' | 'needs-range' | 'invalid'>('ready');

  // Editing state for variant costs
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [overridePortion, setOverridePortion] = useState(false);
  const [centralUnits, setCentralUnits] = useState<CentralUnit[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('units')
      .select('id, name, name_hi, symbol, symbol_hi, is_active')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setCentralUnits(data as CentralUnit[]);
      });
  }, []);

  const fetchMenuItemDetail = async () => {
    const sequence = ++fetchSequence.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const dateRange = getBusinessDateRange(datePreset, new Date(), customFrom, customTo);
      setDateRangeStatus(dateRange.status);
      if (dateRange.status !== 'ready') {
        setSalesMetrics(null);
        return;
      }
      if (dateRange.from) params.set('date_from', dateRange.from);
      if (dateRange.to) params.set('date_to', dateRange.to);
      params.set('channel', channel);

      const res = await fetch(`/api/sops/menu/${id}?${params.toString()}`);
      if (sequence !== fetchSequence.current) return;
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to fetch menu item details');
      }
      const data = await res.json();
      setMenuItem(data.menuItem);
      setVariants(data.variants || []);
      setCompositions(data.compositions || []);
      setCompositionCost(data.compositionCost || null);
      setCanonicalDish(data.canonicalDish || null);
      setServingConfiguration(data.servingConfiguration || null);
      setSalesMetrics(data.salesMetrics || null);
    } catch (err: any) {
      if (sequence !== fetchSequence.current) return;
      console.error('Fetch menu item error:', err);
      setError(err.message || 'Error fetching menu item');
    } finally {
      if (sequence === fetchSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchMenuItemDetail();
  }, [id, datePreset, customFrom, customTo, channel]);

  const handleChannelChange = (nextChannel: MenuSalesChannel) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('channel', nextChannel);
    router.replace(`/sops/menu/${id}?${nextParams.toString()}`, { scroll: false });
  };

  const updateDateFilter = (nextPreset: DatePreset, nextFrom = customFrom, nextTo = customTo) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('channel', channel);
    nextParams.set('date_preset', nextPreset);
    const range = getBusinessDateRange(nextPreset, new Date(), nextFrom, nextTo);
    if (range.from) nextParams.set('date_from', range.from);
    else nextParams.delete('date_from');
    if (range.to) nextParams.set('date_to', range.to);
    else nextParams.delete('date_to');
    router.replace(`/sops/menu/${id}?${nextParams.toString()}`, { scroll: false });
  };

  const handleStartEdit = (v: any) => {
    setEditingVariantId(v.id);
    const hasOverride = v.is_portion_overridden ?? Boolean(v.serving_quantity !== null && v.serving_unit !== null);
    setOverridePortion(hasOverride);
    setEditForm({
      serving_quantity: v.serving_quantity != null ? v.serving_quantity : '',
      serving_unit: v.serving_unit || v.recipe?.portion_size_unit || 'g',
      gas_cost: v.gas_cost != null ? v.gas_cost : 0,
      other_operating_cost: v.other_operating_cost != null ? v.other_operating_cost : 0,
      packaging_cost_dine_in: v.packaging_cost_dine_in != null ? v.packaging_cost_dine_in : 0,
      packaging_cost_takeaway: v.packaging_cost_takeaway != null ? v.packaging_cost_takeaway : 0,
      default_service_channel: v.default_service_channel || 'DINE_IN',
      is_default: Boolean(v.is_default),
    });
  };

  const handleSaveVariant = async (variantId: string) => {
    const payloadServingQty = overridePortion
      ? editForm.serving_quantity ? Number(editForm.serving_quantity) : null
      : null;
    const payloadServingUnit = overridePortion
      ? editForm.serving_unit?.trim() || null
      : null;

    if (overridePortion && (!payloadServingQty || !payloadServingUnit)) {
      alert(locale === 'hi' ? 'ओवरराइड के लिए मात्रा और इकाई दोनों अनिवार्य हैं' : 'Both quantity and unit are required when overriding the recipe default portion.');
      return;
    }

    setSavingVariantId(variantId);
    try {
      const res = await fetch(`/api/sops/menu/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variant_id: variantId,
          serving_quantity: payloadServingQty,
          serving_unit: payloadServingUnit,
          gas_cost: Number(editForm.gas_cost) || 0,
          other_operating_cost: Number(editForm.other_operating_cost) || 0,
          packaging_cost_dine_in: Number(editForm.packaging_cost_dine_in) || 0,
          packaging_cost_takeaway: Number(editForm.packaging_cost_takeaway) || 0,
          default_service_channel: editForm.default_service_channel,
          is_default: editForm.is_default,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update variant');
      }

      setEditingVariantId(null);
      await fetchMenuItemDetail();
    } catch (err: any) {
      alert(`Error updating variant: ${err.message}`);
    } finally {
      setSavingVariantId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-stone-500 flex flex-col items-center gap-3">
        <RefreshCw className="h-8 w-8 animate-spin text-amber-600" />
        <p className="text-sm font-medium">Loading menu item...</p>
      </div>
    );
  }

  if (error || !menuItem) {
    return (
      <div className="space-y-4">
        <Link href="/sops/menu">
          <Button variant="ghost" size="sm" className="gap-1 text-stone-600">
            <ArrowLeft className="h-4 w-4" /> Back to Menu Master
          </Button>
        </Link>
        <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-xl border border-rose-200">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-rose-500" />
          <p className="font-semibold">{error || 'Menu item not found'}</p>
        </div>
      </div>
    );
  }

  const parentColor = getCategoryColor(menuItem.parent_category);

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Bidirectional Navigation */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link href="/sops/menu">
            <Button variant="ghost" size="sm" className="gap-1.5 text-stone-600 hover:text-stone-900">
              <ArrowLeft className="h-4 w-4" />
              Menu Engineering
            </Button>
          </Link>
          <Link href="/admin/menu-master">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs text-stone-600 hover:text-stone-900">
              <UtensilsCrossed className="h-3.5 w-3.5" />
              Menu Master
            </Button>
          </Link>
        </div>

        {(menuItem.canonical_dish_id || canonicalDish?.id) && (
          <Link href={`/sops/recipes/${menuItem.canonical_dish_id || canonicalDish?.id}`}>
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 text-xs">
              <ExternalLink className="h-3.5 w-3.5" />
              <span>View Recipe SOP: {canonicalDish?.name || 'Canonical Dish'}</span>
            </Button>
          </Link>
        )}
      </div>

      {/* Item Header Banner */}
      <div className="bg-white border border-[#E7E2D8] rounded-xl p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold text-stone-900 tracking-tight">
              {menuItem.name}
            </h1>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
              menuItem.product_type === 'COMBO' ? 'bg-purple-50 text-purple-700 border-purple-200' :
              menuItem.product_type === 'THALI' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
              menuItem.product_type === 'STANDALONE_PURCHASED' ? 'bg-cyan-50 text-cyan-700 border-cyan-200' :
              'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              {menuItem.product_type || 'INDIVIDUAL_DISH'}
            </span>
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-stone-50 border border-stone-200">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: parentColor }} />
              <span>{menuItem.parent_category || 'Other'}</span>
            </div>
            <Badge variant="outline" className="text-xs">
              {menuItem.category}
            </Badge>
          </div>
          {menuItem.name_hi && (
            <p className="text-base text-stone-600 mt-1 font-sans">
              {menuItem.name_hi}
            </p>
          )}
          {servingConfiguration && (
            <div className="text-xs text-stone-500 mt-1.5">
              Serving Configuration: <span className="font-semibold text-stone-700">{servingConfiguration.name} ({servingConfiguration.portion_size_quantity} {servingConfiguration.portion_size_unit})</span>
            </div>
          )}
        </div>

        <div className="bg-[#FAF8F5] border border-[#E7E2D8] rounded-lg p-3 text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
            POS Selling Price
          </div>
          <div className="text-2xl font-bold font-mono text-stone-900">
            {formatNullablePrice(menuItem.price)}
          </div>
        </div>
      </div>

      {/* Date Presets Strip */}
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
              onClick={() => {
                const nextPreset = preset.key as DatePreset;
                updateDateFilter(nextPreset);
              }}
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
                onChange={(e) => {
                  updateDateFilter('custom', e.target.value, customTo);
                }}
                className="px-2 py-0.5 border border-[#E7E2D8] rounded text-xs bg-white text-stone-800"
              />
              <span className="text-stone-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => {
                  updateDateFilter('custom', customFrom, e.target.value);
                }}
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
              onClick={() => handleChannelChange(salesChannel)}
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

      {/* Sales Volume, Net Revenue & Historical Trend Card */}
      <Card className="border-[#E7E2D8]">
        <CardHeader className="bg-[#FAF8F5] border-b border-[#E7E2D8] py-3.5 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <CardTitle className="text-sm font-bold text-stone-900">
              {locale === 'hi' ? 'बिक्री वॉल्यूम और दैनिक रुझान' : 'Sales Volume & Daily Performance Trend'}
            </CardTitle>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-stone-500 mr-1.5">{locale === 'hi' ? 'कुल बिक्री:' : 'Total Sold:'}</span>
              <span className="font-bold text-stone-900">{salesMetrics?.unitsSold || 0} pcs</span>
            </div>
            <div>
              <span className="text-stone-500 mr-1.5">{locale === 'hi' ? 'शुद्ध राजस्व:' : 'Net Revenue:'}</span>
              <span className="font-bold text-emerald-800">{formatINR(salesMetrics?.netRevenue || 0)}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {(!salesMetrics?.trend || salesMetrics.trend.length === 0) ? (
            <p className="text-xs text-stone-400 italic p-3 text-center">
              {locale === 'hi' ? 'इस अवधि में कोई बिक्री रिकॉर्ड नहीं है।' : 'No sales records found for the selected date range.'}
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-[#E7E2D8] rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-stone-50 text-stone-600 font-semibold border-b border-[#E7E2D8]">
                  <tr>
                    <th className="py-2 px-3 text-left">Business Date</th>
                    <th className="py-2 px-3 text-right">Units Sold</th>
                    <th className="py-2 px-3 text-right">Net Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E2D8]">
                  {salesMetrics.trend.map((d: any, idx: number) => (
                    <tr key={idx} className="hover:bg-amber-50/20">
                      <td className="py-2 px-3 font-mono text-stone-700">{d.businessDate}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-stone-900">{d.unitsSold} pcs</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-800">{formatINR(d.netSales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4-Tier Combo & Thali Compositions Breakdown */}
      {compositions.length > 0 && (
        <Card className="border border-purple-200 shadow-xs overflow-hidden">
          <CardHeader className="bg-purple-50/50 border-b border-purple-100 p-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base font-bold text-purple-950 flex items-center gap-2">
                  <Layers className="h-4 w-4 text-purple-700" />
                  Fixed Combo / Thali Compositions ({compositions.length} Components)
                </CardTitle>
                <CardDescription className="text-xs text-purple-800">
                  Authoritative multi-dish recipe portions linked to this commercial menu item.
                </CardDescription>
              </div>
              {hasCostAccess && compositionCost?.status && (
                <Badge variant={compositionCost.status === 'COSTED_ELIGIBLE' ? 'success' : 'outline'} className="text-xs">
                  {compositionCost.status}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-purple-50/30 text-purple-900 border-b border-purple-100">
                  <tr>
                    <th className="p-2.5">Component Dish</th>
                    <th className="p-2.5">Serving Configuration</th>
                    <th className="p-2.5 text-center">Qty</th>
                    {hasCostAccess && <th className="p-2.5 text-right">Serving Cost</th>}
                    {hasCostAccess && <th className="p-2.5 text-right">Total Line Cost</th>}
                    <th className="p-2.5 text-center">Recipe SOP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-50">
                  {compositions.map((c: any) => {
                    const snapCost = c.serving_cost;
                    const lineCost = snapCost !== null ? snapCost * (c.quantity || 1) : null;
                    const dish = c.component_dish;
                    return (
                      <tr key={c.id} className="hover:bg-purple-50/20">
                        <td className="p-2.5 font-semibold text-stone-900">
                          {dish?.name || 'Unnamed Dish'}
                        </td>
                        <td className="p-2.5 text-stone-700">
                          <span className="font-medium">{c.serving_configuration?.name || 'Default'}</span>
                          {c.serving_configuration?.portion_size_quantity && (
                            <span className="text-stone-400 ml-1">
                              ({c.serving_configuration.portion_size_quantity} {c.serving_configuration.portion_size_unit})
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-center font-bold text-stone-800">
                          {c.quantity || 1}
                        </td>
                        {hasCostAccess && (
                          <td className="p-2.5 text-right font-mono text-stone-700">
                            {formatNullablePrice(snapCost)}
                          </td>
                        )}
                        {hasCostAccess && (
                          <td className="p-2.5 text-right font-mono font-bold text-purple-900">
                            {formatNullablePrice(lineCost)}
                          </td>
                        )}
                        <td className="p-2.5 text-center">
                          {dish?.id ? (
                            <Link
                              href={`/sops/recipes/${dish.id}`}
                              className="inline-flex items-center gap-1 text-purple-700 hover:text-purple-900 font-semibold"
                            >
                              <span>SOP</span>
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {hasCostAccess && compositionCost && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-purple-50/40 p-3 rounded-xl border border-purple-100 text-xs">
                <div>
                  <span className="text-stone-500 block">Total Food Cost</span>
                  <span className="text-base font-bold text-stone-900 font-mono">
                    {formatNullablePrice(compositionCost.totalFoodCost)}
                  </span>
                  {compositionCost.foodCostPct !== null && (
                    <span className="text-[11px] text-stone-500 ml-1">({compositionCost.foodCostPct.toFixed(1)}%)</span>
                  )}
                </div>
                <div>
                  <span className="text-stone-500 block">Operating + Packaging</span>
                  <span className="text-base font-bold text-stone-900 font-mono">
                    {formatNullablePrice(compositionCost.operatingCost + compositionCost.packagingCost)}
                  </span>
                </div>
                <div>
                  <span className="text-stone-500 block">Selling Price</span>
                  <span className="text-base font-bold text-stone-900 font-mono">
                    {formatNullablePrice(menuItem.price)}
                  </span>
                </div>
                <div>
                  <span className="text-stone-500 block">Contribution Margin</span>
                  <span className="text-base font-bold text-emerald-700 font-mono">
                    {formatNullablePrice(compositionCost.contributionAmount)}
                  </span>
                  {compositionCost.contributionPct !== null && (
                    <span className="text-[11px] text-emerald-600 ml-1">({compositionCost.contributionPct.toFixed(1)}%)</span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Standalone Purchased Product Information */}
      {menuItem.product_type === 'STANDALONE_PURCHASED' && (
        <Card className="border border-cyan-200 bg-cyan-50/30">
          <CardContent className="p-4 flex items-center gap-3 text-xs text-cyan-900">
            <Package className="h-5 w-5 text-cyan-600 shrink-0" />
            <div>
              <span className="font-bold">Packaged / Retail Product</span>
              <p className="text-cyan-700 mt-0.5">
                This item is purchased ready-to-sell (e.g. packaged mineral water, canned cold drinks). It does not require a kitchen recipe formulation.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Variants List & Channel Comparison */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-stone-900">
              Culinary Variants & Channel Breakdown
            </h2>
            <p className="text-xs text-stone-500">
              Multi-chef variations, channel packaging allowances, and channel contribution margins
            </p>
          </div>
        </div>

        {variants.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-stone-400">
              <UtensilsCrossed className="h-8 w-8 mx-auto mb-2 text-stone-300" />
              <p className="text-sm font-medium text-stone-600">No recipe variants linked to this menu item yet.</p>
              <p className="text-xs text-stone-400 mt-1">Link an active recipe to enable multi-channel costing.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {variants.map((v) => {
              const isEditMode = editingVariantId === v.id;
              const dineIn = v.dine_in;
              const takeaway = v.takeaway;

              return (
                <Card key={v.id} className="overflow-hidden border-[#E7E2D8]">
                  <CardHeader className="bg-[#FAF8F5] border-b border-[#E7E2D8] py-3.5 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base font-bold text-stone-900">
                        {v.variant_name}
                      </CardTitle>
                      {v.is_default && (
                        <Badge variant="success" className="text-[10px] font-mono">
                          Default Variant
                        </Badge>
                      )}
                      <Link
                        href={`/sops/recipes/${v.recipe_id}`}
                        className="text-xs text-amber-700 hover:underline flex items-center gap-1 font-medium"
                      >
                        <span>Recipe: {v.recipe?.name}</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>

                    {canManage && (
                      <div>
                        {isEditMode ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditingVariantId(null)}
                              disabled={savingVariantId === v.id}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleSaveVariant(v.id)}
                              disabled={savingVariantId === v.id}
                              className="bg-amber-600 hover:bg-amber-700 text-white"
                            >
                              <Save className="h-3.5 w-3.5 mr-1" />
                              {savingVariantId === v.id ? 'Saving...' : 'Save Costs'}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStartEdit(v)}
                            className="gap-1.5"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                            Edit Channel Costs
                          </Button>
                        )}
                      </div>
                    )}
                  </CardHeader>

                  <CardContent className="p-6">
                    {/* Inline Editor if Editing */}
                    {isEditMode ? (
                      <div className="space-y-4 bg-amber-50/20 p-4 rounded-xl border border-amber-200/60 mb-6">
                        <div className="text-xs font-bold uppercase tracking-wider text-amber-900">
                          {t('sops.variantEditor.title')}
                        </div>

                        {/* Portion Size Inheritance vs Override Toggle */}
                        <div className="bg-white p-3.5 rounded-xl border border-amber-200 space-y-2.5">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={overridePortion}
                              onChange={(e) => setOverridePortion(e.target.checked)}
                              className="rounded border-[#E7E2D8] text-amber-600 focus:ring-amber-500 h-4 w-4 cursor-pointer"
                            />
                            <span className="text-xs font-semibold text-stone-800">
                              {t('sops.variantEditor.overrideRecipePortion')}
                            </span>
                          </label>

                          {!overridePortion ? (
                            <div className="text-xs text-stone-600 flex items-center gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-200">
                              <span>{t('sops.variantEditor.inheritedFromRecipe')}</span>
                              <Badge variant="outline" className="font-mono text-stone-800 bg-white text-xs">
                                {v.recipe_default_portion_display || `${v.recipe?.portion_size_quantity || '—'} ${v.recipe?.portion_size_unit || ''}`}
                              </Badge>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                              <div>
                                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                                  {t('sops.variantEditor.servingQuantity')} *
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  value={editForm.serving_quantity}
                                  onChange={(e) => setEditForm({ ...editForm, serving_quantity: e.target.value })}
                                  placeholder="e.g. 250"
                                  className="w-full px-3 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white"
                                  required
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                                  {t('sops.variantEditor.servingUnit')} *
                                </label>
                                <select
                                  value={editForm.serving_unit}
                                  onChange={(e) => setEditForm({ ...editForm, serving_unit: e.target.value })}
                                  className="w-full px-3 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white cursor-pointer"
                                  required
                                >
                                  {getCompatibleUnitOptions(v.recipe?.portion_size_unit || v.recipe?.batch_yield_unit || 'g', centralUnits, undefined, locale).map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

                          <div>
                            <label className="block text-xs font-semibold text-stone-700 mb-1">
                              {t('sops.variantEditor.gasCost')}
                            </label>
                            <input
                              type="number"
                              step="any"
                              value={editForm.gas_cost}
                              onChange={(e) => setEditForm({ ...editForm, gas_cost: e.target.value })}
                              className="w-full px-3 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-stone-700 mb-1">
                              {t('sops.variantEditor.otherOperatingCost')}
                            </label>
                            <input
                              type="number"
                              step="any"
                              value={editForm.other_operating_cost}
                              onChange={(e) => setEditForm({ ...editForm, other_operating_cost: e.target.value })}
                              className="w-full px-3 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-stone-700 mb-1">
                              {t('sops.variantEditor.packagingDineIn')}
                            </label>
                            <input
                              type="number"
                              step="any"
                              value={editForm.packaging_cost_dine_in}
                              onChange={(e) => setEditForm({ ...editForm, packaging_cost_dine_in: e.target.value })}
                              className="w-full px-3 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-stone-700 mb-1">
                              {t('sops.variantEditor.packagingTakeaway')}
                            </label>
                            <input
                              type="number"
                              step="any"
                              value={editForm.packaging_cost_takeaway}
                              onChange={(e) => setEditForm({ ...editForm, packaging_cost_takeaway: e.target.value })}
                              className="w-full px-3 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-stone-700 mb-1">
                              {t('sops.variantEditor.defaultChannel')}
                            </label>
                            <select
                              value={editForm.default_service_channel}
                              onChange={(e) => setEditForm({ ...editForm, default_service_channel: e.target.value })}
                              className="w-full px-3 py-1.5 border border-[#E7E2D8] rounded text-sm bg-white cursor-pointer"
                            >
                              <option value="DINE_IN">Dine In</option>
                              <option value="TAKEAWAY">Takeaway</option>
                            </select>
                          </div>

                          <div className="flex items-center pt-5">
                            <label className="flex items-center gap-2 text-xs font-semibold text-stone-800 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editForm.is_default}
                                onChange={(e) => setEditForm({ ...editForm, is_default: e.target.checked })}
                                className="rounded text-amber-600 focus:ring-amber-500"
                              />
                              <span>{t('sops.variantEditor.isDefaultVariant')}</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* Side-by-Side Channels: Dine In vs Takeaway */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Dine In Channel */}
                      <div className="border border-[#E7E2D8] rounded-xl p-5 bg-white shadow-2xs">
                        <div className="flex items-center justify-between pb-3 border-b border-[#E7E2D8] mb-4">
                          <div className="flex items-center gap-2">
                            <UtensilsCrossed className="h-4 w-4 text-amber-600" />
                            <h3 className="font-bold text-stone-900 text-sm">
                              Dine In Channel
                            </h3>
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {v.serving_quantity} {v.serving_unit || ''}
                          </Badge>
                        </div>

                        <div className="space-y-2.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-stone-500">Selling Price</span>
                            <span className="font-mono font-medium text-stone-900">
                              {formatNullablePrice(menuItem.price)}
                            </span>
                          </div>

                          <div className="flex justify-between">
                            <span className="text-stone-500">Food Cost</span>
                            <span className="font-mono font-medium text-stone-900">
                              {!hasCostAccess ? (
                                <Lock className="h-3 w-3 inline text-stone-400" />
                              ) : dineIn?.food_cost != null ? (
                                formatINR(dineIn.food_cost)
                              ) : (
                                '—'
                              )}
                            </span>
                          </div>

                          <div className="flex justify-between">
                            <span className="text-stone-500">Gas & Operating Cost</span>
                            <span className="font-mono text-stone-700">
                              {dineIn?.operating_cost != null ? formatINR(dineIn.operating_cost) : '—'}
                            </span>
                          </div>

                          <div className="flex justify-between">
                            <span className="text-stone-500">Packaging Cost</span>
                            <span className="font-mono text-stone-700">
                              {dineIn?.packaging_cost != null ? formatINR(dineIn.packaging_cost) : '—'}
                            </span>
                          </div>

                          <div className="flex justify-between pt-2 border-t border-[#E7E2D8] font-semibold">
                            <span className="text-stone-800">Total Direct Cost</span>
                            <span className="font-mono text-stone-900">
                              {!hasCostAccess ? (
                                <Lock className="h-3 w-3 inline text-stone-400" />
                              ) : dineIn?.total_cost != null ? (
                                formatINR(dineIn.total_cost)
                              ) : (
                                '—'
                              )}
                            </span>
                          </div>

                          <div className="flex justify-between pt-2 border-t border-[#E7E2D8] font-bold text-sm">
                            <span className="text-emerald-900">Contribution Margin</span>
                            <span className="font-mono text-emerald-800">
                              {!hasCostAccess ? (
                                <Lock className="h-3.5 w-3.5 inline text-stone-400" />
                              ) : dineIn?.contribution_amount != null ? (
                                formatINR(dineIn.contribution_amount)
                              ) : (
                                '—'
                              )}
                            </span>
                          </div>

                          <div className="flex justify-between text-[11px]">
                            <span className="text-stone-500">Food Cost %</span>
                            <span className="font-mono font-bold text-emerald-700">
                              {!hasCostAccess ? (
                                <Lock className="h-3 w-3 inline text-stone-400" />
                              ) : dineIn?.food_cost_pct != null ? (
                                `${dineIn.food_cost_pct.toFixed(1)}%`
                              ) : (
                                '—'
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Takeaway Channel */}
                      <div className="border border-[#E7E2D8] rounded-xl p-5 bg-white shadow-2xs">
                        <div className="flex items-center justify-between pb-3 border-b border-[#E7E2D8] mb-4">
                          <div className="flex items-center gap-2">
                            <ShoppingBag className="h-4 w-4 text-amber-600" />
                            <h3 className="font-bold text-stone-900 text-sm">
                              Takeaway Channel
                            </h3>
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {v.serving_quantity} {v.serving_unit || ''}
                          </Badge>
                        </div>

                        <div className="space-y-2.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-stone-500">Selling Price</span>
                            <span className="font-mono font-medium text-stone-900">
                              {formatNullablePrice(menuItem.price)}
                            </span>
                          </div>

                          <div className="flex justify-between">
                            <span className="text-stone-500">Food Cost</span>
                            <span className="font-mono font-medium text-stone-900">
                              {!hasCostAccess ? (
                                <Lock className="h-3 w-3 inline text-stone-400" />
                              ) : takeaway?.food_cost != null ? (
                                formatINR(takeaway.food_cost)
                              ) : (
                                '—'
                              )}
                            </span>
                          </div>

                          <div className="flex justify-between">
                            <span className="text-stone-500">Gas & Operating Cost</span>
                            <span className="font-mono text-stone-700">
                              {takeaway?.operating_cost != null ? formatINR(takeaway.operating_cost) : '—'}
                            </span>
                          </div>

                          <div className="flex justify-between">
                            <span className="text-stone-500">Packaging Cost</span>
                            <span className="font-mono text-stone-700 font-medium text-amber-800">
                              {takeaway?.packaging_cost != null ? formatINR(takeaway.packaging_cost) : '—'}
                            </span>
                          </div>

                          <div className="flex justify-between pt-2 border-t border-[#E7E2D8] font-semibold">
                            <span className="text-stone-800">Total Direct Cost</span>
                            <span className="font-mono text-stone-900">
                              {!hasCostAccess ? (
                                <Lock className="h-3 w-3 inline text-stone-400" />
                              ) : takeaway?.total_cost != null ? (
                                formatINR(takeaway.total_cost)
                              ) : (
                                '—'
                              )}
                            </span>
                          </div>

                          <div className="flex justify-between pt-2 border-t border-[#E7E2D8] font-bold text-sm">
                            <span className="text-emerald-900">Contribution Margin</span>
                            <span className="font-mono text-emerald-800">
                              {!hasCostAccess ? (
                                <Lock className="h-3.5 w-3.5 inline text-stone-400" />
                              ) : takeaway?.contribution_amount != null ? (
                                formatINR(takeaway.contribution_amount)
                              ) : (
                                '—'
                              )}
                            </span>
                          </div>

                          <div className="flex justify-between text-[11px]">
                            <span className="text-stone-500">Food Cost %</span>
                            <span className="font-mono font-bold text-emerald-700">
                              {!hasCostAccess ? (
                                <Lock className="h-3 w-3 inline text-stone-400" />
                              ) : takeaway?.food_cost_pct != null ? (
                                `${takeaway.food_cost_pct.toFixed(1)}%`
                              ) : (
                                '—'
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
