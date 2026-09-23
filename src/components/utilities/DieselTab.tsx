'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, formatNumber } from '@/lib/utils';
import { Fuel, Plus, AlertTriangle, CheckCircle2, RefreshCw, History, Flame, ArrowDownRight, Truck } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';

interface DieselTabProps {
  businessDate: string;
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error'; text: string }) => void;
}

const DIESEL_ITEM_ID = 'd1e5e100-0001-4000-a000-000000000001';
const CENTRAL_STORE_ID = 'a89335e9-01b4-4edd-bee5-a894053d798d';
const GENERATOR_TANK_CAPACITY_L = 160;

export function DieselTab({ businessDate, onRefresh, setMessage }: DieselTabProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();

  const [dieselItem, setDieselItem] = useState<any>(null);
  const [storeStock, setStoreStock] = useState<number>(0);
  const [vendors, setVendors] = useState<any[]>([]);
  const [recentMovements, setRecentMovements] = useState<any[]>([]);
  const [todayConsumptionLiters, setTodayConsumptionLiters] = useState<number>(0);
  const [todayConsumptionValue, setTodayConsumptionValue] = useState<number>(0);

  // Form Mode
  const [mode, setMode] = useState<'refill' | 'purchase'>('refill');

  // Generator Refill Form State
  const [refillLiters, setRefillLiters] = useState<string>('');
  const [generatorHours, setGeneratorHours] = useState<string>('');
  const [refillNotes, setRefillNotes] = useState('');

  // Purchase Form State
  const [purchaseLiters, setPurchaseLiters] = useState<string>('');
  const [purchaseRate, setPurchaseRate] = useState<string>('');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [purchaseNotes, setPurchaseNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadDieselData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Diesel Item Position, Location Stock, Vendors, and Direct Stock Movements
      const [itemRes, locRes, vRes, movsRes] = await Promise.all([
        supabase.from('inventory_items').select('*').eq('id', DIESEL_ITEM_ID).single(),
        supabase.from('item_location_stocks').select('quantity').eq('item_id', DIESEL_ITEM_ID).eq('location_id', CENTRAL_STORE_ID).maybeSingle(),
        supabase.from('vendors').select('id, name, name_hi').eq('is_active', true).order('name'),
        supabase.from('stock_movements')
          .select('*')
          .eq('item_id', DIESEL_ITEM_ID)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (itemRes.error) {
        console.error('Failed to load diesel item:', itemRes.error);
        setMessage({ type: 'error', text: `Failed to load diesel master: ${itemRes.error.message}` });
      }
      if (locRes.error) {
        console.error('Failed to load diesel location stock:', locRes.error);
      }
      if (movsRes.error) {
        console.error('Failed to load diesel movements:', movsRes.error);
        setMessage({ type: 'error', text: `Failed to load stock movements: ${movsRes.error.message}` });
      }

      setDieselItem(itemRes.data);
      setStoreStock(Number(locRes.data?.quantity) || Number(itemRes.data?.current_stock) || 0);
      setVendors(vRes.data || []);
      setRecentMovements(movsRes.data || []);

      // Calculate Today's Consumption on selected business date
      const todayMovs = (movsRes.data || []).filter(
        (m: any) => m.business_date === businessDate && m.movement_type === 'consumption'
      );
      const todayLiters = todayMovs.reduce((sum: number, m: any) => sum + (Number(m.quantity) || 0), 0);
      const todayVal = todayMovs.reduce((sum: number, m: any) => sum + (Number(m.total_value) || 0), 0);
      setTodayConsumptionLiters(todayLiters);
      setTodayConsumptionValue(todayVal);
    } catch (err: any) {
      console.error('Failed to load diesel inventory:', err);
      setMessage({ type: 'error', text: err.message || t('finance.utilities.dieselTab.errorRefill') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDieselData();
  }, [businessDate]);

  const minReserve = Number(dieselItem?.minimum_stock) || 25;
  const currentWac = Number(dieselItem?.current_weighted_average_cost) || 0;
  const isLowStock = storeStock <= minReserve;

  // Handle Generator Refill (Consumption)
  const handleRefillSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(refillLiters);
    if (isNaN(qty) || qty <= 0) {
      alert(t('finance.utilities.dieselTab.alertValidLiters'));
      return;
    }

    if (qty > storeStock) {
      alert(t('finance.utilities.dieselTab.alertInsufficientStock', { available: storeStock.toFixed(1), requested: qty.toFixed(1) }));
      return;
    }

    setSaving(true);
    try {
      const hoursStr = generatorHours ? ` [Gen Runtime: ${generatorHours} hrs]` : '';
      const finalNotes = `${refillNotes.trim()}${hoursStr}`.trim();

      const { data: movementId, error } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: DIESEL_ITEM_ID,
        p_business_date: businessDate,
        p_movement_type: 'consumption',
        p_quantity: qty,
        p_unit_cost: currentWac,
        p_source_location_id: CENTRAL_STORE_ID,
        p_destination_location_id: null,
        p_department_id: null,
        p_responsible_person_id: null,
        p_purpose: 'Generator Fuel',
        p_reference_id: null,
        p_reference_type: 'generator_refill',
        p_notes: finalNotes || null,
        p_batch_number: null,
        p_expiry_date: null,
        p_created_by: null,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text: t('finance.utilities.dieselTab.successRefill', { qty: qty.toFixed(1), balance: (storeStock - qty).toFixed(1) }),
      });

      setRefillLiters('');
      setGeneratorHours('');
      setRefillNotes('');
      loadDieselData();
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || t('finance.utilities.dieselTab.errorRefill') });
    } finally {
      setSaving(false);
    }
  };

  // Handle Diesel Purchase (Inventory Receipt)
  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(purchaseLiters);
    const rate = parseFloat(purchaseRate);

    if (isNaN(qty) || qty <= 0) {
      alert(t('finance.utilities.dieselTab.alertValidLiters'));
      return;
    }
    if (isNaN(rate) || rate <= 0) {
      alert(t('finance.utilities.dieselTab.alertValidPrice'));
      return;
    }

    setSaving(true);
    try {
      const refNotes = [
        invoiceNo ? `Invoice: ${invoiceNo.trim()}` : '',
        purchaseNotes.trim(),
      ].filter(Boolean).join(' | ');

      const { data: movementId, error } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: DIESEL_ITEM_ID,
        p_business_date: businessDate,
        p_movement_type: 'purchase',
        p_quantity: qty,
        p_unit_cost: rate,
        p_source_location_id: null,
        p_destination_location_id: CENTRAL_STORE_ID,
        p_department_id: null,
        p_responsible_person_id: null,
        p_purpose: 'Diesel Inward',
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
        text: t('finance.utilities.dieselTab.successPurchase', { qty: qty.toFixed(1), rate: formatINR(rate), stock: (storeStock + qty).toFixed(1) }),
      });

      setPurchaseLiters('');
      setPurchaseRate('');
      setSelectedVendorId('');
      setInvoiceNo('');
      setPurchaseNotes('');
      loadDieselData();
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to record diesel purchase.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {/* Central Store Balance */}
        <Card className={`relative overflow-hidden ${isLowStock ? 'border-rose-300 bg-rose-50/20' : ''}`}>
          <CardDescription>{t('finance.utilities.dieselTab.stockTitle')}</CardDescription>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-2xl font-bold font-mono ${isLowStock ? 'text-rose-600' : 'text-stone-900'}`}>
              {storeStock.toFixed(1)} L
            </span>
            {isLowStock && (
              <Badge variant="danger" className="text-[10px]">
                {t('finance.utilities.dieselTab.lowReserve')}
              </Badge>
            )}
          </div>
        </Card>

        {/* Minimum Reserve Alert */}
        <Card>
          <CardDescription>{t('finance.utilities.dieselTab.minimumReserve')}</CardDescription>
          <div className="text-2xl font-bold text-amber-700 mt-1 font-mono">{minReserve.toFixed(0)} L</div>
        </Card>

        {/* Current WAC Cost */}
        <Card>
          <CardDescription>{t('finance.utilities.dieselTab.avgCost')}</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1 font-mono">
            {currentWac > 0 ? `${formatINR(currentWac)} / L` : '—'}
          </div>
        </Card>

        {/* Informational Generator Metadata */}
        <Card className="bg-stone-50/50">
          <CardDescription>{t('finance.utilities.dieselTab.tankCapacity')}</CardDescription>
          <div className="text-2xl font-bold text-stone-700 mt-1 font-mono">
            {GENERATOR_TANK_CAPACITY_L} L
          </div>
        </Card>
      </div>

      {/* Low Stock Warning Banner */}
      {isLowStock && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-xs text-rose-800">
          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">{t('finance.utilities.dieselTab.lowStockWarningTitle')}</div>
            <div className="text-rose-700 mt-0.5">
              {t('finance.utilities.dieselTab.lowStockWarningText', {
                storeStock: storeStock.toFixed(1),
                minReserve: minReserve.toFixed(0),
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Actions Card: Refill vs Purchase */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Fuel className="h-4 w-4 text-amber-600" />
                {t('finance.utilities.dieselTab.fuelAction')}
              </CardTitle>
            </div>
            {/* Mode Switch Tabs */}
            <div className="flex border-b border-stone-200 mt-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setMode('refill')}
                className={`pb-2 px-3 border-b-2 transition-colors cursor-pointer ${
                  mode === 'refill'
                    ? 'border-amber-600 text-amber-700 font-bold'
                    : 'border-transparent text-stone-500 hover:text-stone-800'
                }`}
              >
                {t('finance.utilities.dieselTab.tabRefill')}
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
                {t('finance.utilities.dieselTab.tabPurchase')}
              </button>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            {mode === 'refill' ? (
              /* Generator Refill Form (Consumption) */
              <form onSubmit={handleRefillSubmit} className="space-y-3 text-xs">
                <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-100 text-[11px] text-stone-600 space-y-1">
                  <div className="flex justify-between">
                    <span>{t('finance.utilities.dieselTab.availableInStore')}</span>
                    <strong className="font-mono text-stone-900">{storeStock.toFixed(1)} L</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('finance.utilities.dieselTab.applicableWac')}</span>
                    <strong className="font-mono text-stone-900">{formatINR(currentWac)} / L</strong>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.litersTransferred')} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-lg shadow-2xs">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max={storeStock}
                      value={refillLiters}
                      onChange={(e) => setRefillLiters(e.target.value)}
                      placeholder={t('finance.utilities.dieselTab.litersPlaceholder')}
                      required
                      className="w-full rounded-lg border border-stone-300 p-2.5 font-bold text-base text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none pr-10"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                      L
                    </div>
                  </div>
                  {parseFloat(refillLiters) > storeStock && (
                    <p className="text-[11px] text-rose-600 mt-1 font-medium">
                      {t('finance.utilities.dieselTab.exceedsStock', { stock: storeStock.toFixed(1) })}
                    </p>
                  )}
                </div>

                {parseFloat(refillLiters) > 0 && currentWac > 0 && (
                  <div className="p-2 bg-amber-50/70 rounded-lg border border-amber-200/60 flex justify-between items-center text-xs">
                    <span className="text-amber-900">{t('finance.utilities.dieselTab.consumptionCost')}</span>
                    <strong className="font-mono text-amber-950">
                      {formatINR(parseFloat(refillLiters) * currentWac)}
                    </strong>
                  </div>
                )}

                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.runningHours')}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={generatorHours}
                    onChange={(e) => setGeneratorHours(e.target.value)}
                    placeholder={t('finance.utilities.dieselTab.runningHoursPlaceholder')}
                    className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t('finance.utilities.dieselTab.notes')}</label>
                  <input
                    type="text"
                    value={refillNotes}
                    onChange={(e) => setRefillNotes(e.target.value)}
                    placeholder={t('finance.utilities.dieselTab.refillNotesPlaceholder')}
                    className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <Button
                  type="submit"
                  variant="amber"
                  disabled={saving || storeStock <= 0 || parseFloat(refillLiters) > storeStock}
                  className="w-full mt-2 gap-1.5"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" /> {t('finance.utilities.dieselTab.recordingRefill')}
                    </>
                  ) : (
                    <>
                      <Flame className="h-4 w-4" /> {t('finance.utilities.dieselTab.transferToGenerator')}
                    </>
                  )}
                </Button>
              </form>
            ) : (
              /* Diesel Purchase Form (Inventory Inward) */
              <form onSubmit={handlePurchaseSubmit} className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.qtyPurchased')} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-lg shadow-2xs">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={purchaseLiters}
                      onChange={(e) => setPurchaseLiters(e.target.value)}
                      placeholder={t('finance.utilities.dieselTab.purchaseLitersPlaceholder')}
                      required
                      className="w-full rounded-lg border border-stone-300 p-2.5 font-bold text-base text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none pr-10"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                      L
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.pricePerLiter')} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-lg shadow-2xs">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400 font-bold">
                      ₹
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      value={purchaseRate}
                      onChange={(e) => setPurchaseRate(e.target.value)}
                      placeholder={t('finance.utilities.dieselTab.pricePlaceholder')}
                      required
                      className="w-full rounded-lg border border-stone-300 p-2.5 font-bold text-base text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none pl-8"
                    />
                  </div>
                </div>

                {parseFloat(purchaseLiters) > 0 && parseFloat(purchaseRate) > 0 && (
                  <div className="p-2.5 bg-stone-50 rounded-lg border border-stone-200/70 flex justify-between items-center text-xs">
                    <span className="text-stone-600 font-medium">{t('finance.utilities.dieselTab.totalPurchaseAmount')}</span>
                    <strong className="font-mono text-stone-900 text-sm">
                      {formatINR(parseFloat(purchaseLiters) * parseFloat(purchaseRate))}
                    </strong>
                  </div>
                )}

                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t('finance.utilities.dieselTab.vendor')}</label>
                  <select
                    value={selectedVendorId}
                    onChange={(e) => setSelectedVendorId(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none bg-white"
                  >
                    <option value="">{t('finance.utilities.dieselTab.selectVendor')}</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {getLocalizedMasterName(v, locale)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t('finance.utilities.dieselTab.invoiceNo')}</label>
                  <input
                    type="text"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder={t('finance.utilities.dieselTab.invoicePlaceholder')}
                    className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t('finance.utilities.dieselTab.notes')}</label>
                  <input
                    type="text"
                    value={purchaseNotes}
                    onChange={(e) => setPurchaseNotes(e.target.value)}
                    placeholder={t('finance.utilities.dieselTab.purchaseNotesPlaceholder')}
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
                      <RefreshCw className="h-4 w-4 animate-spin" /> {t('finance.utilities.dieselTab.inwardingStock')}
                    </>
                  ) : (
                    <>
                      <Truck className="h-4 w-4" /> {t('finance.utilities.dieselTab.recordPurchase')}
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
              <CardTitle className="text-base font-bold">{t('finance.utilities.dieselTab.movementsTitle')}</CardTitle>
            </div>
            {todayConsumptionLiters > 0 && (
              <Badge variant="warning">
                {t('finance.utilities.dieselTab.todaySummary', {
                  liters: todayConsumptionLiters.toFixed(1),
                  cost: formatINR(todayConsumptionValue),
                })}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            {recentMovements.length === 0 ? (
              <div className="py-16 text-center text-stone-400 text-xs space-y-2">
                <History className="h-8 w-8 mx-auto text-stone-300" />
                <div>{t('finance.utilities.dieselTab.noMovements')}</div>
                <div className="text-[11px] text-stone-400">
                  {t('finance.utilities.dieselTab.noMovementsSub')}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">{t('finance.utilities.dieselTab.colDateTime')}</th>
                      <th className="py-2.5 px-3">{t('finance.utilities.dieselTab.colAction')}</th>
                      <th className="py-2.5 px-3 text-right">{t('finance.utilities.dieselTab.colQuantity')}</th>
                      <th className="py-2.5 px-3 text-right">{t('finance.utilities.dieselTab.colRate')}</th>
                      <th className="py-2.5 px-3 text-right">{t('finance.utilities.dieselTab.colTotalValue')}</th>
                      <th className="py-2.5 px-3">{t('finance.utilities.dieselTab.colNotes')}</th>
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
                              {isPurchase ? t('finance.utilities.dieselTab.actionPurchase') : isConsumption ? t('finance.utilities.dieselTab.actionConsumption') : m.movement_type}
                            </Badge>
                          </td>
                          <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                            isPurchase ? 'text-sky-700' : 'text-amber-800'
                          }`}>
                            {isPurchase ? `+${Number(m.quantity).toFixed(1)} L` : `−${Number(m.quantity).toFixed(1)} L`}
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
