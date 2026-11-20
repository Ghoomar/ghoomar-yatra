'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import { DateTimePicker } from '@/components/ui/DateTimePicker';
import { SimpleSelect } from '@/components/ui/Select';
import { formatDisplayDate } from '@/components/ui/DatePicker';
import { createClient } from '@/lib/supabase/client';
import { formatINR, formatNumber } from '@/lib/utils';
import {
  Fuel,
  Plus,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  History,
  Flame,
  Truck,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';

interface DieselTabProps {
  businessDate: string;
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error'; text: string }) => void;
}

const DIESEL_ITEM_ID = 'd1e5e100-0001-4000-a000-000000000001';
const GENERATOR_TANK_CAPACITY_L = 160;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function getCurrentTimeHHMM(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function DieselTab({ businessDate, onRefresh, setMessage }: DieselTabProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();

  const [dieselItem, setDieselItem] = useState<any>(null);
  const [storeStock, setStoreStock] = useState<number>(0);
  const [centralStoreLocationId, setCentralStoreLocationId] = useState<string | null>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [recentMovements, setRecentMovements] = useState<any[]>([]);
  const [todayConsumptionLiters, setTodayConsumptionLiters] = useState<number>(0);
  const [todayConsumptionValue, setTodayConsumptionValue] = useState<number>(0);

  // Form Mode: refill vs purchase
  const [mode, setMode] = useState<'refill' | 'purchase'>('refill');

  // Generator Refill Form State
  const [refillLiters, setRefillLiters] = useState<string>('');
  const [generatorHours, setGeneratorHours] = useState<string>('');
  const [refillNotes, setRefillNotes] = useState('');
  const [showRefillExtras, setShowRefillExtras] = useState(false);

  // Purchase Form State
  const [purchaseDateTime, setPurchaseDateTime] = useState<string>(() => `${businessDate}T${getCurrentTimeHHMM()}`);
  const [purchaseLiters, setPurchaseLiters] = useState<string>('');
  const [purchaseRate, setPurchaseRate] = useState<string>('');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [purchaseNotes, setPurchaseNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Sync purchase date default when businessDate changes
  useEffect(() => {
    setPurchaseDateTime(`${businessDate}T${getCurrentTimeHHMM()}`);
  }, [businessDate]);

  const loadDieselData = useCallback(async () => {
    setLoading(true);
    setCentralStoreLocationId(null);
    try {
      const [itemRes, vRes, movsRes, locationsRes] = await Promise.all([
        supabase.from('inventory_items').select('*').eq('id', DIESEL_ITEM_ID).single(),
        supabase.from('vendors').select('id, name, name_hi').eq('is_active', true).order('name'),
        supabase
          .from('stock_movements')
          .select('*')
          .eq('item_id', DIESEL_ITEM_ID)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('inventory_locations')
          .select('id')
          .eq('code', 'STORE')
          .eq('is_active', true)
          .maybeSingle(),
      ]);

      if (locationsRes.error) throw locationsRes.error;
      const resolvedStoreId = locationsRes.data?.id || null;
      setCentralStoreLocationId(resolvedStoreId);
      if (!resolvedStoreId) {
        setMessage({
          type: 'error',
          text: t('finance.utilities.dieselTab.storeLocationUnavailable') || 'Central store location unavailable.',
        });
      }

      const locRes = resolvedStoreId
        ? await supabase
            .from('item_location_stocks')
            .select('quantity')
            .eq('item_id', DIESEL_ITEM_ID)
            .eq('location_id', resolvedStoreId)
            .maybeSingle()
        : { data: null, error: null };

      if (itemRes.error) {
        console.error('Failed to load diesel item:', itemRes.error);
      }

      setDieselItem(itemRes.data);
      setStoreStock(locRes.error ? 0 : Number(locRes.data?.quantity) || 0);
      setVendors(vRes.data || []);
      setRecentMovements(movsRes.data || []);

      const todayMovs = (movsRes.data || []).filter(
        (m: any) => m.business_date === businessDate && m.movement_type === 'consumption'
      );
      const todayLiters = todayMovs.reduce((sum: number, m: any) => sum + (Number(m.quantity) || 0), 0);
      const todayVal = todayMovs.reduce((sum: number, m: any) => sum + (Number(m.total_value) || 0), 0);
      setTodayConsumptionLiters(todayLiters);
      setTodayConsumptionValue(todayVal);
    } catch (err: any) {
      console.error('Failed to load diesel inventory:', err);
      setMessage({ type: 'error', text: err.message || 'Error loading diesel data.' });
    } finally {
      setLoading(false);
    }
  }, [supabase, businessDate, setMessage, t]);

  useEffect(() => {
    loadDieselData();
  }, [loadDieselData]);

  const minReserve = Number(dieselItem?.minimum_stock) || 25;
  const currentWac = Number(dieselItem?.current_weighted_average_cost) || 0;
  const isLowStock = storeStock <= minReserve;
  const stockPercentage = Math.min(100, Math.max(0, (storeStock / GENERATOR_TANK_CAPACITY_L) * 100));

  // Handle Generator Refill (Consumption)
  const handleRefillSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(refillLiters);
    if (isNaN(qty) || qty <= 0) {
      alert(t('finance.utilities.dieselTab.alertValidLiters') || 'Please enter valid liters transferred.');
      return;
    }

    if (qty > storeStock) {
      alert(
        t('finance.utilities.dieselTab.alertInsufficientStock', {
          available: storeStock.toFixed(1),
          requested: qty.toFixed(1),
        }) || `Insufficient stock in store (${storeStock.toFixed(1)} L available).`
      );
      return;
    }
    if (!centralStoreLocationId) {
      setMessage({
        type: 'error',
        text: t('finance.utilities.dieselTab.storeLocationUnavailable') || 'Store location unavailable.',
      });
      return;
    }

    setSaving(true);
    try {
      const hoursStr = generatorHours ? ` [Gen Runtime: ${generatorHours} hrs]` : '';
      const finalNotes = `${refillNotes.trim()}${hoursStr}`.trim();

      const { error } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: DIESEL_ITEM_ID,
        p_business_date: businessDate,
        p_movement_type: 'consumption',
        p_quantity: qty,
        p_unit_cost: currentWac,
        p_source_location_id: centralStoreLocationId,
        p_destination_location_id: null,
        p_department_id: null,
        p_responsible_person_id: null,
        p_purpose: 'Generator Fuel',
        p_reference_id: null,
        p_reference_type: 'generator_refill',
        p_notes: finalNotes || null,
        p_created_by: null,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text:
          t('finance.utilities.dieselTab.successRefill', {
            qty: qty.toFixed(1),
            balance: (storeStock - qty).toFixed(1),
          }) || `Transferred ${qty.toFixed(1)} L to Generator successfully.`,
      });

      setRefillLiters('');
      setGeneratorHours('');
      setRefillNotes('');
      setShowRefillExtras(false);
      loadDieselData();
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to record generator refill.' });
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
      alert(t('finance.utilities.dieselTab.alertValidLiters') || 'Please enter valid liters purchased.');
      return;
    }
    if (isNaN(rate) || rate <= 0) {
      alert(t('finance.utilities.dieselTab.alertValidPrice') || 'Please enter valid price per liter.');
      return;
    }
    if (!centralStoreLocationId) {
      setMessage({
        type: 'error',
        text: t('finance.utilities.dieselTab.storeLocationUnavailable') || 'Store location unavailable.',
      });
      return;
    }

    setSaving(true);
    try {
      const purchaseDatePart = purchaseDateTime ? purchaseDateTime.split('T')[0] : businessDate;

      const refNotesParts = [
        `[Purchased: ${new Date(purchaseDateTime || businessDate).toLocaleString('en-IN', {
          dateStyle: 'short',
          timeStyle: 'short',
        })}]`,
        invoiceNo ? `Invoice: ${invoiceNo.trim()}` : '',
        purchaseNotes.trim(),
      ].filter(Boolean);

      const refNotes = refNotesParts.join(' | ');

      const { error } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: DIESEL_ITEM_ID,
        p_business_date: purchaseDatePart,
        p_movement_type: 'purchase',
        p_quantity: qty,
        p_unit_cost: rate,
        p_source_location_id: null,
        p_destination_location_id: centralStoreLocationId,
        p_department_id: null,
        p_responsible_person_id: null,
        p_purpose: 'Diesel Inward',
        p_reference_id: selectedVendorId || null,
        p_reference_type: 'vendor_purchase',
        p_notes: refNotes || null,
        p_created_by: null,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text:
          t('finance.utilities.dieselTab.successPurchase', {
            qty: qty.toFixed(1),
            rate: formatINR(rate),
            stock: (storeStock + qty).toFixed(1),
          }) || `Inwarded ${qty.toFixed(1)} L diesel successfully.`,
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

  const parsedRefillQty = parseFloat(refillLiters) || 0;
  const parsedPurchQty = parseFloat(purchaseLiters) || 0;
  const parsedPurchRate = parseFloat(purchaseRate) || 0;

  const vendorOptions = useMemo(() => {
    return [
      { value: '', label: t('finance.utilities.dieselTab.selectVendor') || '— Select Fuel Vendor —' },
      ...vendors.map((v) => ({
        value: v.id,
        label: getLocalizedMasterName(v, locale),
      })),
    ];
  }, [vendors, locale, t]);

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 1. Sleek Interactive Stock Status Card (~72px tall) */}
      <div
        className={`relative rounded-2xl border bg-white p-3 sm:p-3.5 shadow-2xs overflow-hidden transition-all ${
          isLowStock ? 'border-rose-300 ring-1 ring-rose-200' : 'border-stone-200/90'
        }`}
      >
        {/* Top Row: Title + Status Badge + Restock Link */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] sm:text-xs font-semibold text-stone-500 uppercase tracking-wide">
              {t('finance.utilities.dieselTab.stockTitle') || 'Diesel Stock'}
            </span>
            {isLowStock ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                <AlertTriangle className="h-3 w-3" />
                {t('finance.utilities.dieselTab.lowMinReserve', { min: minReserve }) || `Low · Min ${minReserve} L`}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                {t('finance.utilities.dieselTab.inStock') || 'In Stock'}
              </span>
            )}
          </div>

          {isLowStock && (
            <button
              type="button"
              onClick={() => {
                setMode('purchase');
                setTimeout(() => {
                  document.getElementById('diesel-action-card')?.scrollIntoView({ behavior: 'smooth' });
                }, 50);
              }}
              className="text-xs font-bold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200/80 flex items-center gap-1 transition-all cursor-pointer"
            >
              <span>{t('finance.utilities.dieselTab.restock') || 'Restock'}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Main Row: Big Bold Balance | Muted WAC & Tank Cap */}
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <div className="text-xl sm:text-2xl font-black font-mono text-stone-900">
            {storeStock.toFixed(1)} <span className="text-sm font-bold text-stone-500">L</span>
          </div>
          <div className="text-[11px] text-stone-500 font-medium text-right">
            <span>Avg {currentWac > 0 ? formatINR(currentWac) : '—'}/L</span>
            <span className="mx-1.5 text-stone-300">·</span>
            <span>Tank {GENERATOR_TANK_CAPACITY_L} L</span>
          </div>
        </div>

        {/* Bottom edge: 4px stock progress bar */}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-stone-100">
          <div
            className={`h-full transition-all duration-300 ${isLowStock ? 'bg-rose-500' : 'bg-amber-500'}`}
            style={{ width: `${stockPercentage}%` }}
          />
        </div>
      </div>

      {/* 2. Main Form & Ledger Grid (Desktop 12 cols: 5 form / 7 ledger) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Compact Action Card (5 cols on lg:) */}
        <div id="diesel-action-card" className="lg:col-span-5 bg-white p-3.5 sm:p-4 rounded-2xl border border-stone-200/90 shadow-2xs flex flex-col justify-between">
          <div className="space-y-3">
            {/* Segmented Mode Toggle */}
            <div className="bg-stone-100/90 p-1 rounded-xl border border-stone-200/80 grid grid-cols-2 gap-1 text-xs font-bold shadow-2xs">
              <button
                type="button"
                onClick={() => setMode('refill')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none ${
                  mode === 'refill' ? 'bg-white text-amber-900 shadow-2xs' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Flame className={`h-3.5 w-3.5 ${mode === 'refill' ? 'text-amber-600' : 'text-stone-400'}`} />
                <span>{t('finance.utilities.dieselTab.tabRefill') || 'Generator Refill'}</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('purchase')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none ${
                  mode === 'purchase' ? 'bg-white text-amber-900 shadow-2xs' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Truck className={`h-3.5 w-3.5 ${mode === 'purchase' ? 'text-amber-600' : 'text-stone-400'}`} />
                <span>{t('finance.utilities.dieselTab.tabPurchase') || 'Purchase Inward'}</span>
              </button>
            </div>

            {/* Mode 1: Generator Refill */}
            {mode === 'refill' ? (
              <form onSubmit={handleRefillSubmit} className="space-y-3">
                {/* Liters Input + Quick-fill chips */}
                <div>
                  <label className="block text-[11px] font-bold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.litersTransferred') || 'Liters Transferred'}{' '}
                    <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-xl">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max={storeStock}
                      inputMode="decimal"
                      value={refillLiters}
                      onChange={(e) => setRefillLiters(e.target.value)}
                      placeholder="e.g. 20.0"
                      required
                      className="w-full h-11 rounded-xl border border-stone-300 p-2.5 font-bold font-mono text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 pr-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-2xs bg-white"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                      L
                    </div>
                  </div>

                  {/* 1-tap quick fill chips */}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {[20, 40, 60].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        onClick={() => setRefillLiters(String(qty))}
                        className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                          parsedRefillQty === qty
                            ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                            : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                        }`}
                      >
                        {qty} L
                      </button>
                    ))}
                  </div>

                  {parsedRefillQty > storeStock && (
                    <p className="text-[11px] text-rose-600 mt-1 font-semibold">
                      {t('finance.utilities.dieselTab.exceedsStock', { stock: storeStock.toFixed(1) }) ||
                        `Exceeds store stock (${storeStock.toFixed(1)} L).`}
                    </p>
                  )}
                </div>

                {/* Live Preview Pill */}
                {parsedRefillQty > 0 && currentWac > 0 && (
                  <div className="p-2 bg-amber-50/80 rounded-xl border border-amber-200/80 flex items-center justify-between text-xs text-amber-950 font-medium">
                    <span>
                      Est. {formatINR(parsedRefillQty * currentWac)}
                    </span>
                    <span className="font-mono text-stone-600 text-[11px]">
                      Remaining: {Math.max(0, storeStock - parsedRefillQty).toFixed(1)} L
                    </span>
                  </div>
                )}

                {/* Collapsible Runtime & Notes */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowRefillExtras(!showRefillExtras)}
                    className="text-[11px] font-bold text-stone-500 hover:text-stone-800 flex items-center gap-1 py-0.5 cursor-pointer select-none"
                  >
                    {showRefillExtras ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span>
                      {showRefillExtras
                        ? (t('finance.utilities.dieselTab.hideRuntimeNotes') || 'Hide optional details')
                        : (t('finance.utilities.dieselTab.addRuntimeNotes') || '+ Add runtime / notes')}
                    </span>
                  </button>

                  {showRefillExtras && (
                    <div className="pt-2 space-y-2 animate-in fade-in duration-150">
                      <div>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          inputMode="decimal"
                          value={generatorHours}
                          onChange={(e) => setGeneratorHours(e.target.value)}
                          placeholder="Generator Runtime (hrs, e.g. 3.5)"
                          className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          value={refillNotes}
                          onChange={(e) => setRefillNotes(e.target.value)}
                          placeholder="Notes (e.g. Evening peak load backup)"
                          className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={saving || storeStock <= 0 || parsedRefillQty > storeStock}
                  className="w-full h-11 rounded-xl font-bold text-xs sm:text-sm text-white bg-amber-600 hover:bg-amber-700 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>{t('finance.utilities.dieselTab.recordingRefill') || 'Recording Refill...'}</span>
                    </>
                  ) : (
                    <>
                      <Flame className="h-4 w-4" />
                      <span>{t('finance.utilities.dieselTab.transferToGenerator') || 'Transfer to Generator'}</span>
                    </>
                  )}
                </button>
              </form>
            ) : (
              /* Mode 2: Diesel Purchase Inward */
              <form onSubmit={handlePurchaseSubmit} className="space-y-3">
                {/* Row 1: Quantity & Rate side-by-side */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      {t('finance.utilities.dieselTab.qtyPurchased') || 'Quantity (L)'}{' '}
                      <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      inputMode="decimal"
                      value={purchaseLiters}
                      onChange={(e) => setPurchaseLiters(e.target.value)}
                      placeholder="e.g. 100"
                      required
                      className="w-full h-11 rounded-xl border border-stone-300 px-2.5 font-bold font-mono text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-2xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      {t('finance.utilities.dieselTab.pricePerLiter') || 'Rate (₹/L)'}{' '}
                      <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      inputMode="decimal"
                      value={purchaseRate}
                      onChange={(e) => setPurchaseRate(e.target.value)}
                      placeholder="e.g. 89.50"
                      required
                      className="w-full h-11 rounded-xl border border-stone-300 px-2.5 font-bold font-mono text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-2xs"
                    />
                  </div>
                </div>

                {/* Total amount summary pill */}
                {parsedPurchQty > 0 && parsedPurchRate > 0 && (
                  <div className="p-2 bg-stone-50 rounded-xl border border-stone-200/80 flex items-center justify-between text-xs">
                    <span className="text-stone-600 font-medium">{t('finance.utilities.dieselTab.totalAmount') || 'Total Amount'}:</span>
                    <strong className="font-mono text-sm font-black text-stone-900">
                      {formatINR(parsedPurchQty * parsedPurchRate)}
                    </strong>
                  </div>
                )}

                {/* Row 2: Full-Width Purchase Date & Time */}
                <div>
                  <label className="block text-[11px] font-bold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.purchaseDateTime') || 'Purchase Date & Time'}{' '}
                    <span className="text-rose-500">*</span>
                  </label>
                  <DateTimePicker
                    value={purchaseDateTime}
                    onChange={setPurchaseDateTime}
                    required
                    clearable={false}
                    className="w-full"
                  />
                </div>

                {/* Row 3: Vendor (Radix Select) + Bill No */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      {t('finance.utilities.dieselTab.vendor') || 'Vendor'}
                    </label>
                    <SimpleSelect
                      value={selectedVendorId}
                      onChange={setSelectedVendorId}
                      options={vendorOptions}
                      placeholder={t('finance.utilities.dieselTab.selectVendor') || '— Select Fuel Vendor —'}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      {t('finance.utilities.dieselTab.invoiceNo') || 'Bill / Invoice No.'}
                    </label>
                    <input
                      type="text"
                      value={invoiceNo}
                      onChange={(e) => setInvoiceNo(e.target.value)}
                      placeholder="e.g. INV-1049"
                      className="w-full h-11 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white shadow-2xs"
                    />
                  </div>
                </div>

                {/* Row 4: Compact Notes */}
                <div>
                  <input
                    type="text"
                    value={purchaseNotes}
                    onChange={(e) => setPurchaseNotes(e.target.value)}
                    placeholder={t('finance.utilities.dieselTab.purchaseNotesPlaceholder') || 'Notes (optional)'}
                    className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                  />
                </div>

                {/* Record Purchase CTA */}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full h-11 rounded-xl font-bold text-xs sm:text-sm text-white bg-amber-600 hover:bg-amber-700 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>{t('finance.utilities.dieselTab.savingPurchase') || t('finance.utilities.dieselTab.inwardingStock') || 'Saving Purchase...'}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{t('finance.utilities.dieselTab.recordPurchase') || 'Record Purchase'}</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Activity Ledger (7 cols on lg:) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-stone-200/90 shadow-2xs overflow-hidden flex flex-col">
          <div className="px-3.5 sm:px-4 py-3 border-b border-stone-100 flex items-center justify-between">
            <div>
              <div className="font-bold text-xs sm:text-sm text-stone-900">
                {t('finance.utilities.dieselTab.movementsTitle') || 'Diesel Movements'}
              </div>
              <div className="text-[11px] text-stone-400">
                {t('finance.utilities.dieselTab.recentTransfersCount', { count: recentMovements.length }) ||
                  `${recentMovements.length} recent transfers & purchases`}
              </div>
            </div>
            <Badge variant="outline" className="text-[10px]">
              {recentMovements.length}
            </Badge>
          </div>

          <div className="flex-1">
            {recentMovements.length === 0 ? (
              <div className="py-8 px-4 text-center text-stone-400 text-xs space-y-1.5">
                <History className="h-7 w-7 mx-auto text-stone-300" />
                <div className="font-semibold text-stone-600">
                  {t('finance.utilities.dieselTab.noMovements') || 'No diesel stock movements recorded yet.'}
                </div>
                <div className="text-[11px] text-stone-400">
                  {t('finance.utilities.dieselTab.noMovementsSub') ||
                    'Record a generator refill or purchase inward to start the log.'}
                </div>
              </div>
            ) : (
              <>
                {/* Mobile View: Clean hairline rows */}
                <div className="divide-y divide-stone-100 md:hidden">
                  {recentMovements.slice(0, 20).map((m) => {
                    const isConsumption = m.movement_type === 'consumption';
                    const qty = Number(m.quantity) || 0;
                    const val = Number(m.total_value) || 0;
                    const formattedDate = formatDisplayDate(m.business_date, locale);

                    return (
                      <div key={m.id} className="p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-stone-900 flex items-center gap-1.5">
                            {isConsumption ? (
                              <Flame className="h-3.5 w-3.5 text-amber-600" />
                            ) : (
                              <Truck className="h-3.5 w-3.5 text-emerald-600" />
                            )}
                            <span>{formattedDate}</span>
                          </span>
                          <span
                            className={`font-mono font-black text-xs ${
                              isConsumption ? 'text-amber-800' : 'text-emerald-700'
                            }`}
                          >
                            {isConsumption ? `-${qty.toFixed(1)} L` : `+${qty.toFixed(1)} L`}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-stone-500">
                          <span>{m.purpose || (isConsumption ? 'Generator Fuel' : 'Diesel Inward')}</span>
                          <span className="font-mono font-bold text-stone-800">{formatINR(val)}</span>
                        </div>

                        {m.notes && (
                          <div className="text-[10px] text-stone-400 truncate pt-0.5">
                            {m.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop View: Clean Table */}
                <div className="hidden md:block overflow-x-auto text-xs">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                        <th className="py-2.5 px-3">{t('common.labels.date') || 'Date'}</th>
                        <th className="py-2.5 px-3">{t('finance.utilities.dieselTab.colAction') || 'Action'}</th>
                        <th className="py-2.5 px-3 text-right">{t('common.labels.quantity') || 'Quantity'}</th>
                        <th className="py-2.5 px-3 text-right">{t('common.labels.total') || 'Value'}</th>
                        <th className="py-2.5 px-3">{t('finance.utilities.dieselTab.colNotes') || 'Details / Notes'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {recentMovements.slice(0, 25).map((m) => {
                        const isConsumption = m.movement_type === 'consumption';
                        const qty = Number(m.quantity) || 0;
                        const val = Number(m.total_value) || 0;

                        return (
                          <tr key={m.id} className="hover:bg-stone-50/80 transition-colors">
                            <td className="py-2 px-3 text-stone-700 whitespace-nowrap font-medium">
                              {formatDisplayDate(m.business_date, locale)}
                            </td>
                            <td className="py-2 px-3">
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  isConsumption
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                }`}
                              >
                                {isConsumption
                                  ? (t('finance.utilities.dieselTab.tabRefill') || 'Refill')
                                  : (t('finance.utilities.dieselTab.tabPurchase') || 'Purchase')}
                              </span>
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono font-bold ${
                                isConsumption ? 'text-amber-800' : 'text-emerald-700'
                              }`}
                            >
                              {isConsumption ? `-${qty.toFixed(1)} L` : `+${qty.toFixed(1)} L`}
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-stone-900 font-mono">
                              {formatINR(val)}
                            </td>
                            <td className="py-2 px-3 text-stone-500 max-w-xs truncate">
                              {m.notes || m.purpose || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
