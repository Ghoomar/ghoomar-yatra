'use client';

import React, { useState, useEffect, useMemo, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatINR, formatNumber } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
import {
  ArrowLeft,
  Package,
  Layers,
  MapPin,
  Calendar,
  ShoppingBag,
  History,
  AlertTriangle,
  Lock,
  CheckCircle2,
  AlertCircle,
  Truck,
  Flame,
  UtensilsCrossed,
  Tag,
  Scale,
  RefreshCw,
  Clock,
  BookOpen,
} from 'lucide-react';

interface InventoryDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function InventoryDetailPage({ params }: InventoryDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { t, locale } = useI18n();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  // Filters for movement history
  const [movementFilter, setMovementFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadItemDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/${id}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to fetch inventory item details');
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading item details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItemDetail();
  }, [id]);

  const filteredMovements = useMemo(() => {
    if (!data?.stockMovements) return [];
    return data.stockMovements.filter((m: any) => {
      if (movementFilter !== 'ALL' && m.movement_type !== movementFilter) return false;
      if (dateFrom && m.business_date < dateFrom) return false;
      if (dateTo && m.business_date > dateTo) return false;
      return true;
    });
  }, [data?.stockMovements, movementFilter, dateFrom, dateTo]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-stone-500">
        <RefreshCw className="h-6 w-6 animate-spin text-amber-600" />
        <p className="text-sm font-medium">{t('inventory.stock.loadingInventory')}</p>
      </div>
    );
  }

  if (error || !data?.item) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {t('inventory.detail.backToCatalog')}
        </Link>
        <Card className="border-rose-200 bg-rose-50/50">
          <CardContent className="p-6 text-center text-rose-800 space-y-3">
            <AlertCircle className="h-8 w-8 mx-auto text-rose-600" />
            <h2 className="text-base font-bold">{error || 'Item not found'}</h2>
            <Button variant="outline" size="sm" onClick={() => router.push('/inventory')}>
              {t('inventory.detail.backToCatalog')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { item, locationStocks, aliases, packagingUnits, vendorItems, purchaseLines, countItems = [], hasCostAccess, recipeDependencies = {} } = data;
  const unitSymbol = getLocalizedMasterSymbol(item.unit, locale) || item.unit?.symbol || '';
  const isCosted = Boolean(item.is_costed);
  const wac = item.current_weighted_average_cost != null ? Number(item.current_weighted_average_cost) : null;
  const valuation = item.total_valuation != null ? Number(item.total_valuation) : null;
  const totalStock = Number(item.current_stock || 0);

  const riskBadgeVariant =
    item.abc_risk === 'High Control' ? 'danger' : item.abc_risk === 'Frequent Monitoring' ? 'warning' : 'outline';

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <Link
          href="/inventory"
          className="inline-flex items-center gap-2 text-xs font-bold text-stone-600 hover:text-amber-800 transition-colors bg-white px-3 py-1.5 rounded-lg border border-stone-200 shadow-2xs"
        >
          <ArrowLeft className="h-4 w-4 text-stone-500" />
          {t('inventory.detail.backToCatalog')}
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadItemDetail} className="gap-1.5 text-xs shadow-2xs">
            <RefreshCw className="h-3.5 w-3.5" />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Main Header Card */}
      <Card className="bg-gradient-to-r from-stone-900 to-stone-800 text-white border-0 shadow-md">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                  {item.item_code}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-stone-700/60 text-stone-300 border border-stone-600/50">
                  {item.inventory_class}
                </span>
                {item.category && (
                  <span className="text-xs px-2 py-0.5 rounded bg-stone-700/60 text-stone-300 border border-stone-600/50">
                    {getLocalizedMasterName(item.category, locale) || item.category.name}
                  </span>
                )}
                <Badge variant={riskBadgeVariant} className="text-[10px]">
                  {item.abc_risk || 'Routine Monitoring'}
                </Badge>
                {/* Costing Status Badge */}
                {isCosted ? (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                    <CheckCircle2 className="h-3 w-3" /> {t('inventory.detail.costed')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                    <AlertTriangle className="h-3 w-3" /> {t('inventory.detail.uncosted')}
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                {locale === 'hi' && item.name_hi ? item.name_hi : item.name}
              </h1>
              {locale === 'hi' && item.name && item.name_hi && (
                <p className="text-xs text-stone-400 font-mono">{item.name}</p>
              )}
            </div>

            {/* Quick Balance Header Stat */}
            <div className="flex items-center gap-4 bg-stone-800/80 p-3.5 rounded-xl border border-stone-700/50 shrink-0">
              <div>
                <span className="text-[11px] text-stone-400 uppercase tracking-wider block">
                  {t('inventory.detail.totalStock')}
                </span>
                <div className="text-2xl font-black font-mono text-white">
                  {formatNumber(totalStock)} <span className="text-sm font-normal text-stone-300">{unitSymbol}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Uncosted Notice Banner */}
      {!isCosted && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5 shadow-2xs">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <span className="font-bold">{t('inventory.detail.uncosted')}</span>
            <p className="text-[11px] text-amber-800">{t('inventory.detail.uncostedNotice')}</p>
          </div>
        </div>
      )}

      {/* 4 Primary Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CARD 1: Stock & Valuation */}
        <Card className="shadow-2xs">
          <CardHeader className="border-b border-stone-100 pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Package className="h-4 w-4 text-amber-600" />
              {t('inventory.detail.stockAndValuation')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                <span className="text-[11px] text-stone-500 block mb-0.5">{t('inventory.detail.wacCost')}</span>
                {!hasCostAccess ? (
                  <span className="text-xs font-semibold text-stone-400 flex items-center gap-1">
                    <Lock className="h-3 w-3" /> {t('inventory.detail.costRestricted')}
                  </span>
                ) : !isCosted ? (
                  <span className="text-xs font-mono font-bold text-amber-700 bg-amber-100/70 px-2 py-0.5 rounded">
                    {t('inventory.detail.uncosted')}
                  </span>
                ) : (
                  <span className="text-base font-mono font-bold text-stone-900">
                    {formatINR(wac || 0)} <span className="text-xs font-normal text-stone-500">/ {unitSymbol}</span>
                  </span>
                )}
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                <span className="text-[11px] text-stone-500 block mb-0.5">{t('inventory.detail.totalValuation')}</span>
                {!hasCostAccess ? (
                  <span className="text-xs font-semibold text-stone-400 flex items-center gap-1">
                    <Lock className="h-3 w-3" /> {t('inventory.detail.costRestricted')}
                  </span>
                ) : !isCosted ? (
                  <span className="text-xs font-mono font-bold text-amber-700 bg-amber-100/70 px-2 py-0.5 rounded">
                    {t('inventory.detail.uncosted')}
                  </span>
                ) : (
                  <span className="text-base font-mono font-bold text-emerald-700">
                    {formatINR(valuation || 0)}
                  </span>
                )}
              </div>
            </div>

            {/* Location Breakdown */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-stone-500" />
                {t('inventory.detail.locationBreakdown')}
              </span>
              {locationStocks.length === 0 ? (
                <p className="text-xs text-stone-400 italic p-3 bg-stone-50 rounded-lg">
                  {t('inventory.detail.noLocationStock')}
                </p>
              ) : (
                <div className="overflow-hidden border border-stone-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-stone-50 text-stone-600 font-semibold border-b border-stone-200">
                      <tr>
                        <th className="py-2 px-3 text-left">{t('inventory.detail.location')}</th>
                        <th className="py-2 px-3 text-right">{t('inventory.detail.quantity')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {locationStocks.map((ls: any, idx: number) => (
                        <tr key={idx} className="hover:bg-stone-50/50">
                          <td className="py-2 px-3 font-medium text-stone-800">
                            {getLocalizedMasterName(ls.location, locale) || ls.location?.name || 'Location'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-stone-900">
                            {formatNumber(Number(ls.quantity))} {unitSymbol}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* CARD 2: Purchase & Packaging History */}
        <Card className="shadow-2xs">
          <CardHeader className="border-b border-stone-100 pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-emerald-600" />
              {t('inventory.detail.purchaseHistory')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {/* Defined Packaging Options */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-stone-700 block">
                {t('purchases.bills.selectPackaging')} ({packagingUnits.length})
              </span>
              {packagingUnits.length === 0 ? (
                <p className="text-xs text-stone-400 italic p-2.5 bg-stone-50 rounded-lg">
                  {t('inventory.detail.noPackaging')}
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {packagingUnits.map((pkg: any) => (
                    <div
                      key={pkg.id}
                      className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/60 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-stone-900">{pkg.brand_name}</span>
                        {pkg.is_default && (
                          <Badge variant="success" className="text-[9px]">
                            Default
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-stone-600 font-mono">
                        1 {pkg.pack_unit_name} = {pkg.pack_size_in_base_units} {unitSymbol}
                      </div>
                      {pkg.vendor && (
                        <div className="text-[10px] text-stone-500">
                          {t('inventory.detail.supplier')}: {getLocalizedMasterName(pkg.vendor, locale) || pkg.vendor.name}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Linked Vendors */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-stone-700 block">{t('inventory.detail.linkedVendors')}</span>
              {vendorItems.length === 0 ? (
                <p className="text-xs text-stone-400 italic p-2.5 bg-stone-50 rounded-lg">
                  {t('inventory.detail.noVendors')}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {vendorItems.map((vi: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded-lg border border-stone-200 bg-white text-xs"
                    >
                      <span className="font-semibold text-stone-800">{vi.vendor?.name}</span>
                      <div className="flex items-center gap-2">
                        {vi.last_purchase_date && (
                          <span className="text-[10px] text-stone-400 font-mono">{vi.last_purchase_date}</span>
                        )}
                        {hasCostAccess && vi.last_purchase_rate != null ? (
                          <span className="font-mono font-bold text-stone-900">
                            {formatINR(vi.last_purchase_rate)} / {unitSymbol}
                          </span>
                        ) : (
                          <span className="text-[10px] text-stone-400">—</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Past Invoices Snapshot */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-stone-700 block">{t('inventory.detail.pastInvoices')}</span>
              {purchaseLines.length === 0 ? (
                <p className="text-xs text-stone-400 italic p-2.5 bg-stone-50 rounded-lg">
                  {t('inventory.detail.noPurchases')}
                </p>
              ) : (
                <div className="overflow-x-auto border border-stone-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-stone-50 text-stone-600 font-semibold border-b border-stone-200">
                      <tr>
                        <th className="py-2 px-2.5 text-left">{t('inventory.detail.invoice')}</th>
                        <th className="py-2 px-2 text-left">{t('inventory.detail.brandPack')}</th>
                        <th className="py-2 px-2 text-right">{t('inventory.detail.baseQty')}</th>
                        {hasCostAccess && <th className="py-2 px-2.5 text-right">{t('inventory.detail.rate')}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {purchaseLines.map((pl: any) => (
                        <tr key={pl.id} className="hover:bg-stone-50/50">
                          <td className="py-2 px-2.5">
                            <span className="font-mono font-bold text-stone-900 block">
                              {pl.purchase?.purchase_number || 'INV'}
                            </span>
                            <span className="text-[10px] text-stone-400 block font-mono">
                              {pl.purchase?.purchase_date}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-stone-700">
                            {pl.brand_name_snapshot ? (
                              <span>
                                {pl.brand_name_snapshot}{' '}
                                <span className="text-stone-400 font-mono text-[10px]">
                                  ({pl.pack_quantity} {pl.pack_unit_snapshot})
                                </span>
                              </span>
                            ) : (
                              <span className="text-stone-400 italic text-[11px]">{t('inventory.detail.standard')}</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-mono font-bold text-stone-800">
                            {formatNumber(Number(pl.quantity))} {unitSymbol}
                          </td>
                          {hasCostAccess && (
                            <td className="py-2 px-2.5 text-right font-mono text-stone-900">
                              {formatINR(pl.rate || 0)}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* CARD 3: Consumption & Movement History */}
        <Card className="shadow-2xs">
          <CardHeader className="border-b border-stone-100 pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <History className="h-4 w-4 text-blue-600" />
                {t('inventory.detail.movementHistory')}
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="text-xs bg-white border border-stone-200 rounded px-1.5 py-1 text-stone-700 focus:outline-none"
                    aria-label={t('inventory.detail.dateFrom')}
                    title={t('inventory.detail.dateFrom')}
                  />
                  <span className="text-stone-400 text-xs">→</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="text-xs bg-white border border-stone-200 rounded px-1.5 py-1 text-stone-700 focus:outline-none"
                    aria-label={t('inventory.detail.dateTo')}
                    title={t('inventory.detail.dateTo')}
                  />
                  {(dateFrom || dateTo) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDateFrom('');
                        setDateTo('');
                      }}
                      className="text-[10px] h-6 px-1 text-stone-500 hover:text-stone-800"
                    >
                      {t('inventory.detail.clearDates')}
                    </Button>
                  )}
                </div>
                <select
                  value={movementFilter}
                  onChange={(e) => setMovementFilter(e.target.value)}
                  className="text-xs bg-white border border-stone-200 rounded px-2 py-1 focus:outline-none"
                  aria-label="Filter movement type"
                >
                  <option value="ALL">{t('inventory.detail.allTypes')}</option>
                  <option value="purchase">{t('inventory.detail.purchase')}</option>
                  <option value="issue">{t('inventory.detail.issue')}</option>
                  <option value="transfer">{t('inventory.detail.transfer')}</option>
                  <option value="count_adjustment">{t('inventory.detail.audit')}</option>
                  <option value="wastage">{t('inventory.detail.wastage')}</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {filteredMovements.length === 0 ? (
              <p className="text-xs text-stone-400 italic p-4 bg-stone-50 rounded-lg text-center">
                {t('inventory.detail.noMovements')}
              </p>
            ) : (
              <div className="overflow-x-auto border border-stone-200 rounded-lg max-h-96">
                <table className="w-full text-xs">
                  <thead className="bg-stone-50 text-stone-600 font-semibold border-b border-stone-200 sticky top-0">
                    <tr>
                      <th className="py-2 px-2.5 text-left">{t('inventory.detail.date')}</th>
                      <th className="py-2 px-2 text-left">{t('inventory.detail.type')}</th>
                      <th className="py-2 px-2 text-right">{t('inventory.detail.qty')}</th>
                      {hasCostAccess && <th className="py-2 px-2 text-right">{t('inventory.detail.wac')}</th>}
                      <th className="py-2 px-2.5 text-left">{t('inventory.detail.purposeNotes')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredMovements.map((m: any) => (
                      <tr key={m.id} className="hover:bg-stone-50/50">
                        <td className="py-2 px-2.5 font-mono text-stone-600">{m.business_date}</td>
                        <td className="py-2 px-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-stone-100 text-stone-700">
                            {m.movement_type}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-bold text-stone-800">
                          {formatNumber(Number(m.quantity))} {unitSymbol}
                        </td>
                        {hasCostAccess && (
                          <td className="py-2 px-2 text-right font-mono text-stone-600">
                            {m.unit_cost ? formatINR(m.unit_cost) : '—'}
                          </td>
                        )}
                        <td className="py-2 px-2.5 text-stone-500 truncate max-w-[180px]">
                          {m.purpose || m.notes || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Physical Count Adjustments & Audits */}
            {countItems.length > 0 && (
              <div className="pt-3 border-t border-stone-100 space-y-2">
                <span className="text-xs font-bold text-stone-700 block flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5 text-amber-600" />
                  {t('inventory.detail.countAdjustments')} ({countItems.length})
                </span>
                <div className="overflow-x-auto border border-stone-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-stone-50 text-stone-600 font-semibold border-b border-stone-200">
                      <tr>
                        <th className="py-2 px-2.5 text-left">{t('inventory.detail.countDate')}</th>
                        <th className="py-2 px-2 text-right">{t('inventory.detail.expectedQty')}</th>
                        <th className="py-2 px-2 text-right">{t('inventory.detail.countedQty')}</th>
                        <th className="py-2 px-2 text-right">{t('inventory.detail.variance')}</th>
                        {hasCostAccess && <th className="py-2 px-2 text-right">{t('inventory.detail.varianceValue')}</th>}
                        <th className="py-2 px-2.5 text-left">{t('inventory.detail.purposeNotes')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {countItems.map((ci: any) => (
                        <tr key={ci.id} className="hover:bg-stone-50/50">
                          <td className="py-2 px-2.5 font-mono text-stone-700">{ci.count?.business_date || '—'}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatNumber(Number(ci.expected_quantity))} {unitSymbol}</td>
                          <td className="py-2 px-2 text-right font-mono font-bold text-stone-800">{formatNumber(Number(ci.physical_quantity))} {unitSymbol}</td>
                          <td className={`py-2 px-2 text-right font-mono font-bold ${Number(ci.variance_quantity) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {Number(ci.variance_quantity) > 0 ? `+${formatNumber(Number(ci.variance_quantity))}` : formatNumber(Number(ci.variance_quantity))} {unitSymbol}
                          </td>
                          {hasCostAccess && (
                            <td className="py-2 px-2 text-right font-mono text-stone-700">
                              {ci.variance_value != null ? formatINR(ci.variance_value) : '—'}
                            </td>
                          )}
                          <td className="py-2 px-2.5 text-stone-500 truncate max-w-[150px]">{ci.reason || ci.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* CARD 4: Recipe & Menu Dependencies */}
        <Card className="shadow-2xs">
          <CardHeader className="border-b border-stone-100 pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-stone-800">
              <BookOpen className="h-4 w-4 text-purple-600" />
              {t('inventory.detail.recipePlaceholderTitle')}
              {(recipeDependencies.directRecipes?.length > 0 || recipeDependencies.transitiveRecipes?.length > 0) && (
                <span className="text-xs font-mono font-normal text-stone-500">
                  ({(recipeDependencies.directRecipes?.length || 0) + (recipeDependencies.transitiveRecipes?.length || 0)})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {(!recipeDependencies?.directRecipes?.length && !recipeDependencies?.transitiveRecipes?.length) ? (
              <div className="p-6 text-center space-y-2 bg-stone-50 rounded-lg">
                <UtensilsCrossed className="h-8 w-8 text-stone-300 mx-auto" />
                <p className="text-xs text-stone-500">{t('inventory.detail.noRecipeUsages')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Direct Recipes */}
                {recipeDependencies.directRecipes?.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-stone-700 block">
                      {t('inventory.detail.directRecipes')} ({recipeDependencies.directRecipes.length})
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {recipeDependencies.directRecipes.map((r: any) => (
                        <Link
                          key={r.id}
                          href={`/sops/recipes/${r.id}`}
                          className="p-2.5 rounded-lg border border-purple-200/70 bg-purple-50/40 hover:bg-purple-100/50 transition-colors text-xs flex items-center justify-between group"
                        >
                          <div className="space-y-0.5 truncate mr-2">
                            <span className="font-bold text-purple-950 block truncate group-hover:text-purple-700">
                              {locale === 'hi' && r.name_hi ? r.name_hi : r.name}
                            </span>
                            <span className="text-[10px] text-purple-600 font-mono">
                              {r.category} • {formatNumber(Number(r.quantity))} {r.unit}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {r.costing_status === 'COSTED_ELIGIBLE' ? (
                              <Badge variant="success" className="text-[9px] font-mono">
                                Ready
                              </Badge>
                            ) : r.costing_status === 'COSTING_INCOMPLETE' ? (
                              <Badge variant="danger" className="text-[9px] font-mono">
                                Incomplete
                              </Badge>
                            ) : (
                              <Badge variant="warning" className="text-[9px] font-mono">
                                Uncosted
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-[9px] border-purple-300 text-purple-800">
                              {t('inventory.detail.viewRecipe')}
                            </Badge>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transitive Recipes & Dishes */}
                {recipeDependencies.transitiveRecipes?.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-stone-100">
                    <span className="text-xs font-bold text-stone-700 block">
                      {t('inventory.detail.transitiveRecipes')} ({recipeDependencies.transitiveRecipes.length})
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {recipeDependencies.transitiveRecipes.map((r: any) => (
                        <Link
                          key={r.id}
                          href={`/sops/recipes/${r.id}`}
                          className="p-2 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100/80 transition-colors text-xs flex items-center justify-between group"
                        >
                          <div className="space-y-0.5 truncate mr-2">
                            <span className="font-medium text-stone-800 block truncate group-hover:text-amber-800">
                              {locale === 'hi' && r.name_hi ? r.name_hi : r.name}
                            </span>
                            <span className="text-[10px] text-stone-500 font-mono">
                              {r.category} • Depth {r.depth}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {r.costing_status === 'COSTED_ELIGIBLE' ? (
                              <Badge variant="success" className="text-[9px] font-mono">
                                Ready
                              </Badge>
                            ) : r.costing_status === 'COSTING_INCOMPLETE' ? (
                              <Badge variant="danger" className="text-[9px] font-mono">
                                Incomplete
                              </Badge>
                            ) : (
                              <Badge variant="warning" className="text-[9px] font-mono">
                                Uncosted
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-[9px]">
                              {t('inventory.detail.viewRecipe')}
                            </Badge>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Linked POS Menu Items */}
                {recipeDependencies.linkedMenuItems?.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-stone-100">
                    <span className="text-xs font-bold text-stone-700 block">
                      POS Menu Items ({recipeDependencies.linkedMenuItems.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {recipeDependencies.linkedMenuItems.map((m: any) => (
                        <Link
                          key={m.id}
                          href={`/sops/menu/${m.menu_item?.id}`}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-stone-200 bg-white hover:border-amber-400 hover:text-amber-900 transition-colors shadow-2xs font-medium text-stone-800"
                        >
                          <UtensilsCrossed className="h-3 w-3 text-amber-600" />
                          <span>{m.menu_item?.name}</span>
                          <span className="text-[10px] font-mono text-stone-400">({m.variant_name})</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Linked Combos & Thalis */}
                {recipeDependencies.linkedCombos?.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-stone-100">
                    <span className="text-xs font-bold text-stone-700 block">
                      Combos & Thalis ({recipeDependencies.linkedCombos.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {recipeDependencies.linkedCombos.map((c: any) => (
                        <div
                          key={c.id}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-stone-200 bg-white shadow-2xs font-medium text-stone-800"
                        >
                          <BookOpen className="h-3 w-3 text-purple-600" />
                          <span>{c.combo?.name || c.component_name}</span>
                          <span className="text-[10px] font-mono text-stone-400">({c.component_name})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* CARD 5: Bilingual & Transliteration Aliases */}
      <Card className="shadow-2xs">
        <CardHeader className="border-b border-stone-100 pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Tag className="h-4 w-4 text-amber-600" />
            {t('inventory.detail.aliases')} ({aliases.length})
          </CardTitle>
          <CardDescription className="text-xs">
            Searchable synonyms and transliterations that route directly to this canonical item.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4">
          {aliases.length === 0 ? (
            <p className="text-xs text-stone-400 italic">{t('inventory.detail.noAliases')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {aliases.map((a: any) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-stone-200 bg-white text-xs text-stone-800 shadow-2xs font-medium"
                >
                  <span>{a.alias}</span>
                  <span className="text-[10px] text-stone-400 font-mono">({a.alias_type})</span>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
