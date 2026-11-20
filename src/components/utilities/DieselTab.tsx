'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DateTimePicker } from '@/components/ui/DateTimePicker';
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
  ArrowDownRight,
  Truck,
  Gauge,
  Clock,
  Layers,
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
        setMessage({ type: 'error', text: t('finance.utilities.dieselTab.storeLocationUnavailable') || 'Central store location unavailable.' });
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
      // Derive purchase business date from purchaseDateTime
      const purchaseDatePart = purchaseDateTime ? purchaseDateTime.split('T')[0] : businessDate;
      const formattedTimestamp = purchaseDateTime ? new Date(purchaseDateTime).toISOString() : new Date().toISOString();

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

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPI Summary Grid (4 compact cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Available Stock */}
        <div
          className={`p-3.5 rounded-2xl border shadow-2xs flex flex-col justify-between ${
            isLowStock ? 'bg-rose-50/40 border-rose-300 ring-1 ring-rose-200' : 'bg-white border-stone-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide truncate">
              {t('finance.utilities.dieselTab.stockTitle') || 'Store Balance'}
            </span>
            <Fuel className={`h-4 w-4 ${isLowStock ? 'text-rose-600' : 'text-amber-600'}`} />
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span
                className={`text-xl sm:text-2xl font-black font-mono ${
                  isLowStock ? 'text-rose-600' : 'text-stone-900'
                }`}
              >
                {storeStock.toFixed(1)} L
              </span>
              {isLowStock && (
                <Badge variant="danger" className="text-[9px] px-1 py-0.2">
                  {t('finance.utilities.dieselTab.lowReserve') || 'LOW RESERVE'}
                </Badge>
              )}
            </div>
            <div className="text-[11px] text-stone-400 mt-0.5 truncate">Central Store (Drums)</div>
          </div>
        </div>

        {/* Minimum Reserve */}
        <div className="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide truncate">
              {t('finance.utilities.dieselTab.minimumReserve') || 'Min Reserve'}
            </span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-black font-mono text-amber-700">
              {minReserve.toFixed(0)} L
            </div>
            <div className="text-[11px] text-stone-400 mt-0.5 truncate">Safety threshold</div>
          </div>
        </div>

        {/* Average Cost per Litre (WAC) */}
        <div className="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide truncate">
              {t('finance.utilities.dieselTab.avgCost') || 'Avg Cost (WAC)'}
            </span>
            <Layers className="h-4 w-4 text-stone-400" />
          </div>
          <div className="mt-2">
            <div className="text-lg sm:text-2xl font-black font-mono text-stone-900">
              {currentWac > 0 ? `${formatINR(currentWac)} / L` : '—'}
            </div>
            <div className="text-[11px] text-stone-400 mt-0.5 truncate">Current valuation</div>
          </div>
        </div>

        {/* Generator Tank Capacity */}
        <div className="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide truncate">
              {t('finance.utilities.dieselTab.tankCapacity') || 'Gen Tank Cap'}
            </span>
            <Gauge className="h-4 w-4 text-stone-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-black font-mono text-stone-700">
              {GENERATOR_TANK_CAPACITY_L} L
            </div>
            <div className="text-[11px] text-stone-400 mt-0.5 truncate">Genset maximum</div>
          </div>
        </div>
      </div>

      {/* Low Stock Warning Banner */}
      {isLowStock && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800 shadow-2xs">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-rose-900">
              {t('finance.utilities.dieselTab.lowStockWarningTitle') || 'Diesel Reserve Alert'}
            </div>
            <div className="text-rose-700 text-[11px] mt-0.5">
              {t('finance.utilities.dieselTab.lowStockWarningText', {
                storeStock: storeStock.toFixed(1),
                minReserve: minReserve.toFixed(0),
              }) || `Current stock (${storeStock.toFixed(1)} L) is below reserve (${minReserve} L). Plan inward purchase.`}
            </div>
          </div>
        </div>
      )}

      {/* Actions and Ledger Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Actions Card (5 cols on Desktop, full on Mobile) */}
        <Card className="lg:col-span-5 rounded-2xl border-stone-200 shadow-2xs flex flex-col">
          <CardHeader className="pb-3 border-b border-stone-100">
            {/* Segmented Mode Toggle */}
            <div className="bg-stone-100 p-1 rounded-xl border border-stone-200/80 grid grid-cols-2 gap-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => setMode('refill')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  mode === 'refill'
                    ? 'bg-white text-amber-900 shadow-2xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Flame className={`h-3.5 w-3.5 ${mode === 'refill' ? 'text-amber-600' : 'text-stone-400'}`} />
                <span>{t('finance.utilities.dieselTab.tabRefill') || 'Generator Refill'}</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('purchase')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  mode === 'purchase'
                    ? 'bg-white text-amber-900 shadow-2xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Truck className={`h-3.5 w-3.5 ${mode === 'purchase' ? 'text-amber-600' : 'text-stone-400'}`} />
                <span>{t('finance.utilities.dieselTab.tabPurchase') || 'Purchase Inward'}</span>
              </button>
            </div>
          </CardHeader>

          <CardContent className="pt-4 flex-1">
            {mode === 'refill' ? (
              /* Mode 1: Generator Refill Form (Consumption) */
              <form onSubmit={handleRefillSubmit} className="space-y-3.5 text-xs">
                {/* Available & WAC info banner */}
                <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200/70 text-[11px] text-stone-600 space-y-1">
                  <div className="flex justify-between items-center">
                    <span>{t('finance.utilities.dieselTab.availableInStore') || 'Available in Store'}:</span>
                    <strong className="font-mono text-stone-900 text-xs">{storeStock.toFixed(1)} L</strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>{t('finance.utilities.dieselTab.applicableWac') || 'Cost Valuation (WAC)'}:</span>
                    <strong className="font-mono text-stone-900">{formatINR(currentWac)} / L</strong>
                  </div>
                </div>

                {/* Liters to transfer */}
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.litersTransferred') || 'Liters Transferred to Generator'}{' '}
                    <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-xl shadow-2xs">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max={storeStock}
                      value={refillLiters}
                      onChange={(e) => setRefillLiters(e.target.value)}
                      placeholder="e.g. 20.0"
                      required
                      className="w-full rounded-xl border border-stone-300 p-2.5 font-bold font-mono text-base text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none pr-10"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                      L
                    </div>
                  </div>
                  {parseFloat(refillLiters) > storeStock && (
                    <p className="text-[11px] text-rose-600 mt-1 font-semibold">
                      {t('finance.utilities.dieselTab.exceedsStock', { stock: storeStock.toFixed(1) }) ||
                        `Exceeds available store stock (${storeStock.toFixed(1)} L).`}
                    </p>
                  )}
                </div>

                {/* Live Cost Preview */}
                {parseFloat(refillLiters) > 0 && currentWac > 0 && (
                  <div className="p-2.5 bg-amber-50/70 rounded-xl border border-amber-200/60 flex justify-between items-center text-xs">
                    <span className="text-amber-900 font-medium">
                      {t('finance.utilities.dieselTab.consumptionCost') || 'Estimated Consumption Cost'}:
                    </span>
                    <strong className="font-mono text-amber-950 font-bold text-sm">
                      {formatINR(parseFloat(refillLiters) * currentWac)}
                    </strong>
                  </div>
                )}

                {/* Generator Running Hours */}
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.runningHours') || 'Generator Running Hours (Optional)'}
                  </label>
                  <div className="relative rounded-xl shadow-2xs">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={generatorHours}
                      onChange={(e) => setGeneratorHours(e.target.value)}
                      placeholder="e.g. 3.5"
                      className="w-full rounded-xl border border-stone-300 p-2 font-bold font-mono text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none pr-12"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-400 font-medium text-xs">
                      hrs
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.notes') || 'Notes (Optional)'}
                  </label>
                  <input
                    type="text"
                    value={refillNotes}
                    onChange={(e) => setRefillNotes(e.target.value)}
                    placeholder="e.g. Evening peak load power backup"
                    className="w-full rounded-xl border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <Button
                  type="submit"
                  variant="amber"
                  disabled={saving || storeStock <= 0 || parseFloat(refillLiters) > storeStock}
                  className="w-full rounded-xl mt-2 gap-1.5 py-2.5 font-bold shadow-xs cursor-pointer"
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
                </Button>
              </form>
            ) : (
              /* Mode 2: Diesel Purchase Form (Inventory Inward) */
              <form onSubmit={handlePurchaseSubmit} className="space-y-3.5 text-xs">
                {/* Independent Purchase Date & Time */}
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.purchaseDateTime') || 'Purchase Date & Time'}{' '}
                    <span className="text-rose-500">*</span>
                  </label>
                  <DateTimePicker
                    value={purchaseDateTime}
                    onChange={(val) => setPurchaseDateTime(val)}
                    required
                    clearable={false}
                    triggerClassName="w-full p-1 border-stone-300 rounded-xl"
                  />
                </div>

                {/* Liters Purchased */}
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.qtyPurchased') || 'Quantity Purchased (Liters)'}{' '}
                    <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-xl shadow-2xs">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={purchaseLiters}
                      onChange={(e) => setPurchaseLiters(e.target.value)}
                      placeholder="e.g. 100.0"
                      required
                      className="w-full rounded-xl border border-stone-300 p-2.5 font-bold font-mono text-base text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none pr-10"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                      L
                    </div>
                  </div>
                </div>

                {/* Price Per Liter */}
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.pricePerLiter') || 'Purchase Price per Liter'}{' '}
                    <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-xl shadow-2xs">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400 font-bold">
                      ₹
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      value={purchaseRate}
                      onChange={(e) => setPurchaseRate(e.target.value)}
                      placeholder="e.g. 89.50"
                      required
                      className="w-full rounded-xl border border-stone-300 p-2.5 font-bold font-mono text-base text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none pl-8"
                    />
                  </div>
                </div>

                {/* Live Total Amount */}
                {parseFloat(purchaseLiters) > 0 && parseFloat(purchaseRate) > 0 && (
                  <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200/80 flex justify-between items-center text-xs">
                    <span className="text-stone-600 font-medium">
                      {t('finance.utilities.dieselTab.totalPurchaseAmount') || 'Total Inward Amount'}:
                    </span>
                    <strong className="font-mono text-stone-900 text-sm font-black">
                      {formatINR(parseFloat(purchaseLiters) * parseFloat(purchaseRate))}
                    </strong>
                  </div>
                )}

                {/* Vendor Selector */}
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.vendor') || 'Fuel Supplier / Petrol Pump'}
                  </label>
                  <select
                    value={selectedVendorId}
                    onChange={(e) => setSelectedVendorId(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 bg-white font-medium"
                  >
                    <option value="">{t('finance.utilities.dieselTab.selectVendor') || '— Select Fuel Vendor —'}</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {getLocalizedMasterName(v, locale)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Invoice No */}
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.invoiceNo') || 'Bill / Invoice / Receipt No'}
                  </label>
                  <input
                    type="text"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder="e.g. INV-9842"
                    className="w-full rounded-xl border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                {/* Purchase Notes */}
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    {t('finance.utilities.dieselTab.notes') || 'Notes (Optional)'}
                  </label>
                  <input
                    type="text"
                    value={purchaseNotes}
                    onChange={(e) => setPurchaseNotes(e.target.value)}
                    placeholder="e.g. Paid via Indian Oil fuel card"
                    className="w-full rounded-xl border border-stone-300 p-2 text-stone-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={saving}
                  className="w-full rounded-xl mt-2 gap-1.5 py-2.5 font-bold shadow-xs cursor-pointer"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>{t('finance.utilities.dieselTab.inwardingStock') || 'Inwarding Stock...'}</span>
                    </>
                  ) : (
                    <>
                      <Truck className="h-4 w-4" />
                      <span>{t('finance.utilities.dieselTab.recordPurchase') || 'Record Purchase Inward'}</span>
                    </>
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Movement History Ledger (7 cols on Desktop, full on Mobile) */}
        <Card className="lg:col-span-7 rounded-2xl border-stone-200 shadow-2xs flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-stone-100">
            <div>
              <CardTitle className="text-sm sm:text-base font-bold text-stone-900">
                {t('finance.utilities.dieselTab.movementsTitle') || 'Diesel Movements & Audit Ledger'}
              </CardTitle>
              <CardDescription className="text-xs">
                Recent receipts, generator refills and operational history
              </CardDescription>
            </div>
            {todayConsumptionLiters > 0 && (
              <Badge variant="warning" className="text-[10px]">
                {t('finance.utilities.dieselTab.todaySummary', {
                  liters: todayConsumptionLiters.toFixed(1),
                  cost: formatINR(todayConsumptionValue),
                }) || `Today: ${todayConsumptionLiters.toFixed(1)} L (${formatINR(todayConsumptionValue)})`}
              </Badge>
            )}
          </CardHeader>

          <CardContent className="pt-3 flex-1">
            {recentMovements.length === 0 ? (
              <div className="py-14 text-center text-stone-400 text-xs space-y-2">
                <History className="h-8 w-8 mx-auto text-stone-300" />
                <div className="font-semibold text-stone-600">
                  {t('finance.utilities.dieselTab.noMovements') || 'No diesel transactions recorded.'}
                </div>
                <div className="text-[11px] text-stone-400">
                  {t('finance.utilities.dieselTab.noMovementsSub') || 'Use the forms on the left to record inward purchase or generator refill.'}
                </div>
              </div>
            ) : (
              <>
                {/* Mobile View: Compact History Cards (Zero horizontal scroll) */}
                <div className="space-y-2.5 md:hidden">
                  {recentMovements.map((m) => {
                    const isPurchase = m.movement_type === 'purchase';
                    const isConsumption = m.movement_type === 'consumption';
                    const qty = Number(m.quantity);
                    const cost = Number(m.total_value);
                    const rate = Number(m.unit_cost);

                    // Extract purchase date/time if recorded in notes
                    const purchaseMatch = m.notes ? m.notes.match(/\[Purchased:\s*([^\]]+)\]/) : null;
                    const displayTime = purchaseMatch
                      ? purchaseMatch[1]
                      : new Date(m.created_at).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        });

                    const vendor = vendors.find((v) => v.id === m.reference_id);
                    const vendorName = vendor ? getLocalizedMasterName(vendor, locale) : '';

                    return (
                      <div
                        key={m.id}
                        className="p-3 bg-stone-50/70 rounded-xl border border-stone-200/80 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant={isPurchase ? 'info' : isConsumption ? 'warning' : 'outline'}>
                            {isPurchase
                              ? t('finance.utilities.dieselTab.actionPurchase') || 'Purchase Inward'
                              : isConsumption
                              ? t('finance.utilities.dieselTab.actionConsumption') || 'Generator Refill'
                              : m.movement_type}
                          </Badge>
                          <span className="font-mono font-bold text-xs text-stone-900">
                            {formatINR(cost)}
                          </span>
                        </div>

                        <div className="flex items-baseline justify-between pt-1 border-t border-stone-200/50 text-xs">
                          <div>
                            <span className="text-[11px] text-stone-500 mr-1.5">{m.business_date}</span>
                            <span className="text-[10px] text-stone-400">({displayTime})</span>
                          </div>
                          <span
                            className={`font-mono font-bold text-sm ${
                              isPurchase ? 'text-sky-700' : 'text-amber-800'
                            }`}
                          >
                            {isPurchase ? `+${qty.toFixed(1)} L` : `−${qty.toFixed(1)} L`}
                          </span>
                        </div>

                        <div className="text-[11px] text-stone-500 pt-1 flex items-center justify-between border-t border-stone-200/40">
                          <span>Rate: {formatINR(rate)}/L</span>
                          <span className="italic text-stone-600 truncate max-w-[200px]">
                            {vendorName ? `${vendorName} • ` : ''}
                            {m.notes ? m.notes.replace(/\[Purchased:[^\]]+\]\s*\|?\s*/, '') : m.purpose || '—'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop View: Clean Responsive Table */}
                <div className="hidden md:block overflow-x-auto text-xs">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                        <th className="py-2.5 px-3">{t('finance.utilities.dieselTab.colDateTime') || 'Date / Time'}</th>
                        <th className="py-2.5 px-3">{t('finance.utilities.dieselTab.colAction') || 'Action'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.utilities.dieselTab.colQuantity') || 'Quantity'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.utilities.dieselTab.colRate') || 'Rate'}</th>
                        <th className="py-2.5 px-3 text-right">{t('finance.utilities.dieselTab.colTotalValue') || 'Total Value'}</th>
                        <th className="py-2.5 px-3">{t('finance.utilities.dieselTab.colNotes') || 'Vendor / Notes'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {recentMovements.map((m) => {
                        const isPurchase = m.movement_type === 'purchase';
                        const isConsumption = m.movement_type === 'consumption';
                        const purchaseMatch = m.notes ? m.notes.match(/\[Purchased:\s*([^\]]+)\]/) : null;
                        const displayTime = purchaseMatch
                          ? purchaseMatch[1]
                          : new Date(m.created_at).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            });

                        const vendor = vendors.find((v) => v.id === m.reference_id);
                        const vendorName = vendor ? getLocalizedMasterName(vendor, locale) : '';

                        return (
                          <tr key={m.id} className="hover:bg-stone-50/80 transition-colors">
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <div className="font-semibold text-stone-900">{m.business_date}</div>
                              <div className="text-[10px] text-stone-400">{displayTime}</div>
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge variant={isPurchase ? 'info' : isConsumption ? 'warning' : 'outline'}>
                                {isPurchase
                                  ? t('finance.utilities.dieselTab.actionPurchase') || 'Purchase Inward'
                                  : isConsumption
                                  ? t('finance.utilities.dieselTab.actionConsumption') || 'Generator Refill'
                                  : m.movement_type}
                              </Badge>
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-mono font-bold ${
                                isPurchase ? 'text-sky-700' : 'text-amber-800'
                              }`}
                            >
                              {isPurchase ? `+${Number(m.quantity).toFixed(1)} L` : `−${Number(m.quantity).toFixed(1)} L`}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-stone-600">
                              {formatINR(Number(m.unit_cost))}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-stone-900">
                              {formatINR(Number(m.total_value))}
                            </td>
                            <td className="py-2.5 px-3 text-stone-500 max-w-xs truncate">
                              {vendorName ? `${vendorName} • ` : ''}
                              {m.notes ? m.notes.replace(/\[Purchased:[^\]]+\]\s*\|?\s*/, '') : m.purpose || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
