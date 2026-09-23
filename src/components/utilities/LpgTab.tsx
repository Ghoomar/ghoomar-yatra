'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, formatNumber } from '@/lib/utils';
import { Flame, Plus, AlertTriangle, CheckCircle2, RefreshCw, History, Utensils, Truck } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';

interface LpgTabProps {
  businessDate: string;
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error'; text: string }) => void;
}

const LPG_ITEM_ID = '195c1900-0002-4000-a000-000000000002';
const CENTRAL_STORE_ID = 'a89335e9-01b4-4edd-bee5-a894053d798d';
const KITCHEN_LOCATION_ID = 'a05329b1-941f-4d6d-a390-14cb16a7d42f';
const KITCHEN_DEPT_ID = '6e9e8b3b-0e62-4a4f-bd2c-fb5b7d5aebe1';

export function LpgTab({ businessDate, onRefresh, setMessage }: LpgTabProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();

  const [lpgItem, setLpgItem] = useState<any>(null);
  const [storeStock, setStoreStock] = useState<number>(0);
  const [vendors, setVendors] = useState<any[]>([]);
  const [recentMovements, setRecentMovements] = useState<any[]>([]);
  const [todayIssuesCylinders, setTodayIssuesCylinders] = useState<number>(0);
  const [todayIssuesValue, setTodayIssuesValue] = useState<number>(0);

  // Form Mode
  const [mode, setMode] = useState<'issue' | 'purchase'>('issue');

  // Kitchen Issue Form State
  const [issueQty, setIssueQty] = useState<string>('1');
  const [issueNotes, setIssueNotes] = useState('');

  // Purchase Form State
  const [purchaseQty, setPurchaseQty] = useState<string>('');
  const [purchaseRate, setPurchaseRate] = useState<string>('');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [purchaseNotes, setPurchaseNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadLpgData = async () => {
    setLoading(true);
    try {
      // 1. Fetch LPG Item Position, Location Stock, Vendors, and Direct Stock Movements
      const [itemRes, locRes, vRes, movsRes] = await Promise.all([
        supabase.from('inventory_items').select('*').eq('id', LPG_ITEM_ID).single(),
        supabase.from('item_location_stocks').select('quantity').eq('item_id', LPG_ITEM_ID).eq('location_id', CENTRAL_STORE_ID).maybeSingle(),
        supabase.from('vendors').select('id, name, name_hi').eq('is_active', true).order('name'),
        supabase.from('stock_movements')
          .select('*')
          .eq('item_id', LPG_ITEM_ID)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (itemRes.error) {
        console.error('Failed to load LPG item:', itemRes.error);
        setMessage({ type: 'error', text: `Failed to load LPG master: ${itemRes.error.message}` });
      }
      if (locRes.error) {
        console.error('Failed to load LPG location stock:', locRes.error);
      }
      if (movsRes.error) {
        console.error('Failed to load LPG movements:', movsRes.error);
        setMessage({ type: 'error', text: `Failed to load stock movements: ${movsRes.error.message}` });
      }

      setLpgItem(itemRes.data);
      setStoreStock(Number(locRes.data?.quantity) || Number(itemRes.data?.current_stock) || 0);
      setVendors(vRes.data || []);
      setRecentMovements(movsRes.data || []);

      // Calculate Today's Issues on selected business date
      const todayMovs = (movsRes.data || []).filter(
        (m: any) => m.business_date === businessDate && m.movement_type === 'consumption'
      );
      const todayCyls = todayMovs.reduce((sum: number, m: any) => sum + (Number(m.quantity) || 0), 0);
      const todayVal = todayMovs.reduce((sum: number, m: any) => sum + (Number(m.total_value) || 0), 0);
      setTodayIssuesCylinders(todayCyls);
      setTodayIssuesValue(todayVal);
    } catch (err: any) {
      console.error('Failed to load LPG inventory:', err);
      setMessage({ type: 'error', text: err.message || t('finance.utilities.lpgTab.errorIssue') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLpgData();
  }, [businessDate]);

  const minReserve = Number(lpgItem?.minimum_stock) || 2;
  const currentWac = Number(lpgItem?.current_weighted_average_cost) || 0;
  const isLowStock = storeStock <= minReserve;

  // Handle Kitchen Issue (Consumption)
  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseInt(issueQty, 10);
    if (isNaN(qty) || qty <= 0) {
      alert(t('finance.utilities.lpgTab.alertValidCount'));
      return;
    }

    if (qty > storeStock) {
      alert(t('finance.utilities.lpgTab.alertInsufficientStock', { available: storeStock, requested: qty }));
      return;
    }

    setSaving(true);
    try {
      const { data: movementId, error } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: LPG_ITEM_ID,
        p_business_date: businessDate,
        p_movement_type: 'consumption',
        p_quantity: qty,
        p_unit_cost: currentWac,
        p_source_location_id: CENTRAL_STORE_ID,
        p_destination_location_id: KITCHEN_LOCATION_ID,
        p_department_id: KITCHEN_DEPT_ID,
        p_responsible_person_id: null,
        p_purpose: 'Kitchen Gas',
        p_reference_id: null,
        p_reference_type: 'kitchen_issue',
        p_notes: issueNotes.trim() || 'Issued for kitchen cooking production',
        p_batch_number: null,
        p_expiry_date: null,
        p_created_by: null,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text: t('finance.utilities.lpgTab.successIssue', { qty, balance: storeStock - qty }),
      });

      setIssueQty('1');
      setIssueNotes('');
      loadLpgData();
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || t('finance.utilities.lpgTab.errorIssue') });
    } finally {
      setSaving(false);
    }
  };

  // Handle LPG Cylinder Purchase (Inventory Receipt)
  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseInt(purchaseQty, 10);
    const rate = parseFloat(purchaseRate);

    if (isNaN(qty) || qty <= 0) {
      alert(t('finance.utilities.lpgTab.alertValidCount'));
      return;
    }
    if (isNaN(rate) || rate <= 0) {
      alert(t('finance.utilities.lpgTab.alertValidPrice'));
      return;
    }

    setSaving(true);
    try {
      const refNotes = [
        invoiceNo ? `Invoice: ${invoiceNo.trim()}` : '',
        purchaseNotes.trim(),
      ].filter(Boolean).join(' | ');

      const { data: movementId, error } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: LPG_ITEM_ID,
        p_business_date: businessDate,
        p_movement_type: 'purchase',
        p_quantity: qty,
        p_unit_cost: rate,
        p_source_location_id: null,
        p_destination_location_id: CENTRAL_STORE_ID,
        p_department_id: null,
        p_responsible_person_id: null,
        p_purpose: 'LPG Inward',
        p_reference_id: selectedVendorId || null,
        p_reference_type: 'vendor_purchase',
        p_notes: refNotes || null,
        p_batch_number: invoiceNo.trim() || null,
        p_expiry_date: null,
        p_created_by: null,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text: t('finance.utilities.lpgTab.successPurchase', { qty, rate: formatINR(rate), balance: storeStock + qty }),
      });

      setPurchaseQty('');
      setPurchaseRate('');
      setSelectedVendorId('');
      setInvoiceNo('');
      setPurchaseNotes('');
      loadLpgData();
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to record LPG purchase.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {/* Central Store Cylinder Balance */}
        <Card className={`relative overflow-hidden ${isLowStock ? 'border-rose-300 bg-rose-50/20' : ''}`}>
          <CardDescription>{t('finance.utilities.lpgTab.stockTitle')}</CardDescription>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-2xl font-bold font-mono ${isLowStock ? 'text-rose-600' : 'text-stone-900'}`}>
              {storeStock} {storeStock === 1 ? t('finance.utilities.lpgTab.cylinderSingular') : t('finance.utilities.lpgTab.cylinderPlural')}
            </span>
            {isLowStock && (
              <Badge variant="danger" className="text-[10px]">
                {t('finance.utilities.lpgTab.lowReserve')}
              </Badge>
            )}
          </div>
        </Card>

        {/* Minimum Reserve */}
        <Card>
          <CardDescription>{t('finance.utilities.lpgTab.minimumReserve')}</CardDescription>
          <div className="text-2xl font-bold text-amber-700 mt-1 font-mono">{minReserve} {t('finance.utilities.lpgTab.cylinderPlural')}</div>
        </Card>

        {/* Current WAC */}
        <Card>
          <CardDescription>{t('finance.utilities.lpgTab.avgCost')}</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1 font-mono">
            {currentWac > 0 ? `${formatINR(currentWac)} / cyl` : '—'}
          </div>
        </Card>

        {/* Standard Commercial Spec */}
        <Card className="bg-stone-50/50">
          <CardDescription>{t('finance.utilities.lpgTab.cylinderSize')}</CardDescription>
          <div className="text-2xl font-bold text-stone-700 mt-1 font-mono">
            {t('finance.utilities.lpgTab.standardSize')}
          </div>
        </Card>
      </div>

      {/* Low Stock Warning Banner */}
      {isLowStock && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-xs text-rose-800">
          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">{t('finance.utilities.lpgTab.lowStockWarningTitle')}</div>
            <div className="text-rose-700 mt-0.5">
              {t('finance.utilities.lpgTab.lowStockWarningText', {
                storeStock,
                unit: storeStock === 1 ? t('finance.utilities.lpgTab.cylinderSingular') : t('finance.utilities.lpgTab.cylinderPlural'),
                minReserve,
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Actions Card: Issue vs Purchase */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Flame className="h-4 w-4 text-amber-600" />
                {t('finance.utilities.lpgTab.lpgAction')}
              </CardTitle>
            </div>
            {/* Mode Switch Tabs */}
            <div className="flex border-b border-stone-200 mt-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setMode('issue')}
                className={`pb-2 px-3 border-b-2 transition-colors cursor-pointer ${
                  mode === 'issue'
                    ? 'border-amber-600 text-amber-700 font-bold'
                    : 'border-transparent text-stone-500 hover:text-stone-800'
                }`}
              >
                {t('finance.utilities.lpgTab.tabIssue')}
              </button>
              <button
                type="button"
                onClick={() => setMode('purchase')}
                className={`pb-2 px-3 border-b-2 transition-colors cursor-pointer ${
                  mode === 'purchase'
                    ? 'border-amber-600 text-amber-700 font-bold'
                    : 'border-transparent text-stone-500 hover:text-stone-800'
                }`}
              >
                {t('finance.utilities.lpgTab.tabPurchase')}
              </button>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            {mode === 'issue' ? (
              /* Issue to Kitchen Form (Consumption) */
              <form onSubmit={handleIssueSubmit} className="space-y-3 text-xs">
                <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-100 text-[11px] text-stone-600 space-y-1">
                  <div className="flex justify-between">
                    <span>{t('finance.utilities.lpgTab.availableInStore')}</span>
                    <strong className="font-mono text-stone-900">{storeStock} {t('finance.utilities.lpgTab.cylinderPlural')}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('finance.utilities.lpgTab.applicableWac')}</span>
                    <strong className="font-mono text-stone-900">{formatINR(currentWac)} / cyl</strong>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    {t('finance.utilities.lpgTab.cylindersIssued')} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-lg shadow-2xs">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max={storeStock}
                      value={issueQty}
                      onChange={(e) => setIssueQty(e.target.value)}
                      placeholder={t('finance.utilities.lpgTab.cylindersPlaceholder')}
                      required
                      className="w-full rounded-lg border border-stone-300 p-2.5 font-bold text-base text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                      CYL
                    </div>
                  </div>
                  {parseInt(issueQty, 10) > storeStock && (
                    <p className="text-[11px] text-rose-600 mt-1 font-medium">
                      {t('finance.utilities.lpgTab.exceedsStock', { stock: storeStock })}
                    </p>
                  )}
                </div>

                {parseInt(issueQty, 10) > 0 && currentWac > 0 && (
                  <div className="p-2 bg-amber-50/70 rounded-lg border border-amber-200/60 flex justify-between items-center text-xs">
                    <span className="text-amber-900">{t('finance.utilities.lpgTab.consumptionCost')}</span>
                    <strong className="font-mono text-amber-950">
                      {formatINR(parseInt(issueQty, 10) * currentWac)}
                    </strong>
                  </div>
                )}

                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t('finance.utilities.lpgTab.notes')}</label>
                  <input
                    type="text"
                    value={issueNotes}
                    onChange={(e) => setIssueNotes(e.target.value)}
                    placeholder={t('finance.utilities.lpgTab.issueNotesPlaceholder')}
                    className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <Button
                  type="submit"
                  variant="amber"
                  disabled={saving || storeStock <= 0 || parseInt(issueQty, 10) > storeStock}
                  className="w-full mt-2 gap-1.5"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" /> {t('finance.utilities.lpgTab.issuingCylinders')}
                    </>
                  ) : (
                    <>
                      <Utensils className="h-4 w-4" /> {t('finance.utilities.lpgTab.issueToKitchen')}
                    </>
                  )}
                </Button>
              </form>
            ) : (
              /* LPG Purchase Form (Inventory Inward) */
              <form onSubmit={handlePurchaseSubmit} className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    {t('finance.utilities.lpgTab.qtyPurchased')} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-lg shadow-2xs">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={purchaseQty}
                      onChange={(e) => setPurchaseQty(e.target.value)}
                      placeholder={t('finance.utilities.lpgTab.purchaseQtyPlaceholder')}
                      required
                      className="w-full rounded-lg border border-stone-300 p-2.5 font-bold text-base text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                      CYL
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    {t('finance.utilities.lpgTab.pricePerCylinder')} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-lg shadow-2xs">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400 font-bold">
                      ₹
                    </div>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={purchaseRate}
                      onChange={(e) => setPurchaseRate(e.target.value)}
                      placeholder={t('finance.utilities.lpgTab.pricePlaceholder')}
                      required
                      className="w-full rounded-lg border border-stone-300 p-2.5 font-bold text-base text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none pl-8"
                    />
                  </div>
                </div>

                {parseInt(purchaseQty, 10) > 0 && parseFloat(purchaseRate) > 0 && (
                  <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/70 flex justify-between items-center text-xs">
                    <span className="text-stone-600 font-medium">{t('finance.utilities.lpgTab.totalPurchaseAmount')}</span>
                    <strong className="font-mono text-stone-900 text-sm">
                      {formatINR(parseInt(purchaseQty, 10) * parseFloat(purchaseRate))}
                    </strong>
                  </div>
                )}

                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t('finance.utilities.lpgTab.vendor')}</label>
                  <select
                    value={selectedVendorId}
                    onChange={(e) => setSelectedVendorId(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none bg-white"
                  >
                    <option value="">{t('finance.utilities.lpgTab.selectVendor')}</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {getLocalizedMasterName(v, locale)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t('finance.utilities.lpgTab.invoiceNo')}</label>
                  <input
                    type="text"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder={t('finance.utilities.lpgTab.invoicePlaceholder')}
                    className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t('finance.utilities.lpgTab.notes')}</label>
                  <input
                    type="text"
                    value={purchaseNotes}
                    onChange={(e) => setPurchaseNotes(e.target.value)}
                    placeholder={t('finance.utilities.lpgTab.purchaseNotesPlaceholder')}
                    className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={saving}
                  className="w-full mt-2 gap-1.5"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" /> {t('finance.utilities.lpgTab.inwardingStock')}
                    </>
                  ) : (
                    <>
                      <Truck className="h-4 w-4" /> {t('finance.utilities.lpgTab.recordPurchase')}
                    </>
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Activity Ledger Card */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-bold">{t('finance.utilities.lpgTab.movementsTitle')}</CardTitle>
            </div>
            {todayIssuesCylinders > 0 && (
              <Badge variant="warning">
                {t('finance.utilities.lpgTab.todaySummary', {
                  count: todayIssuesCylinders,
                  cost: formatINR(todayIssuesValue),
                })}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            {recentMovements.length === 0 ? (
              <div className="py-16 text-center text-stone-400 text-xs space-y-2">
                <History className="h-8 w-8 mx-auto text-stone-300" />
                <div>{t('finance.utilities.lpgTab.noMovements')}</div>
                <div className="text-[11px] text-stone-400">
                  {t('finance.utilities.lpgTab.noMovementsSub')}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">{t('finance.utilities.lpgTab.colDateTime')}</th>
                      <th className="py-2.5 px-3">{t('finance.utilities.lpgTab.colAction')}</th>
                      <th className="py-2.5 px-3 text-right">{t('finance.utilities.lpgTab.colQuantity')}</th>
                      <th className="py-2.5 px-3 text-right">{t('finance.utilities.lpgTab.colRate')}</th>
                      <th className="py-2.5 px-3 text-right">{t('finance.utilities.lpgTab.colTotalValue')}</th>
                      <th className="py-2.5 px-3">{t('finance.utilities.lpgTab.colNotes')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {recentMovements.map((m) => {
                      const isPurchase = m.movement_type === 'purchase';
                      const isConsumption = m.movement_type === 'consumption';
                      return (
                        <tr key={m.id} className="hover:bg-stone-50/80">
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="font-semibold text-stone-900">{m.business_date}</div>
                            <div className="text-[10px] text-stone-400">
                              {new Date(m.created_at).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true,
                              })}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <Badge variant={isPurchase ? 'info' : isConsumption ? 'warning' : 'outline'}>
                              {isPurchase ? t('finance.utilities.lpgTab.actionPurchase') : isConsumption ? t('finance.utilities.lpgTab.actionConsumption') : m.movement_type}
                            </Badge>
                          </td>
                          <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                            isPurchase ? 'text-sky-700' : 'text-amber-800'
                          }`}>
                            {isPurchase ? `+${Number(m.quantity)} Cyl` : `−${Number(m.quantity)} Cyl`}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-stone-600">
                            {formatINR(Number(m.unit_cost))}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-stone-900">
                            {formatINR(Number(m.total_value))}
                          </td>
                          <td className="py-2.5 px-3 text-stone-500 max-w-xs truncate">
                            {(() => {
                              const vendor = vendors.find((v) => v.id === m.reference_id);
                              const vendorName = vendor ? getLocalizedMasterName(vendor, locale) : '';
                              if (vendor && m.notes) return `${vendorName} • ${m.notes}`;
                              if (vendor) return vendorName;
                              return m.notes || m.purpose || '—';
                            })()}
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
    </div>
  );
}
