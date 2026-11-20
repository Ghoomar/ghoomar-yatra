'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import { DateTimePicker } from '@/components/ui/DateTimePicker';
import { SimpleSelect } from '@/components/ui/Select';
import { formatDisplayDate } from '@/components/ui/DatePicker';
import { createClient } from '@/lib/supabase/client';
import { formatINR, formatNumber } from '@/lib/utils';
import {
  Flame,
  Plus,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  History,
  Utensils,
  Truck,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';

interface LpgTabProps {
  businessDate: string;
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error' | 'warning' | 'info'; text: string }) => void;
}

const LPG_ITEM_ID = '195c1900-0002-4000-a000-000000000002';
const KITCHEN_DEPT_ID = '6e9e8b3b-0e62-4a4f-bd2c-fb5b7d5aebe1';
const CYLINDER_WEIGHT_KG = '19.0 kg';
const MAX_CYLINDERS_SCALE = 15;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function getCurrentTimeHHMM(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function LpgTab({ businessDate, onRefresh, setMessage }: LpgTabProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();

  const [lpgItem, setLpgItem] = useState<any>(null);
  const [storeStock, setStoreStock] = useState<number>(0);
  const [centralStoreLocationId, setCentralStoreLocationId] = useState<string | null>(null);
  const [kitchenLocationId, setKitchenLocationId] = useState<string | null>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [recentMovements, setRecentMovements] = useState<any[]>([]);
  const [todayIssuesCylinders, setTodayIssuesCylinders] = useState<number>(0);
  const [todayIssuesValue, setTodayIssuesValue] = useState<number>(0);

  // Form Mode: issue vs purchase
  const [mode, setMode] = useState<'issue' | 'purchase'>('issue');

  // Kitchen Issue Form State
  const [issueQty, setIssueQty] = useState<string>('1');
  const [issueNotes, setIssueNotes] = useState('');
  const [showIssueNotes, setShowIssueNotes] = useState(false);

  // Purchase Form State
  const [purchaseDateTime, setPurchaseDateTime] = useState<string>(() => `${businessDate}T${getCurrentTimeHHMM()}`);
  const [purchaseQty, setPurchaseQty] = useState<string>('');
  const [purchaseRate, setPurchaseRate] = useState<string>('');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [showBillDetails, setShowBillDetails] = useState(false);
  const [showPurchaseNotes, setShowPurchaseNotes] = useState(false);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Sync purchase date default when businessDate changes
  useEffect(() => {
    setPurchaseDateTime(`${businessDate}T${getCurrentTimeHHMM()}`);
  }, [businessDate]);

  const loadLpgData = useCallback(async () => {
    setLoading(true);
    setCentralStoreLocationId(null);
    setKitchenLocationId(null);
    try {
      const [itemRes, vRes, movsRes, locationsRes] = await Promise.all([
        supabase.from('inventory_items').select('*').eq('id', LPG_ITEM_ID).single(),
        supabase.from('vendors').select('id, name, name_hi').eq('is_active', true).order('name'),
        supabase
          .from('stock_movements')
          .select('*')
          .eq('item_id', LPG_ITEM_ID)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('inventory_locations')
          .select('id, code')
          .in('code', ['STORE', 'KITCHEN-MAIN'])
          .eq('is_active', true),
      ]);

      if (locationsRes.error) throw locationsRes.error;
      const locationsByCode = new Map((locationsRes.data || []).map((loc: any) => [loc.code, loc.id]));
      const resolvedStoreId = locationsByCode.get('STORE') || null;
      const resolvedKitchenId = locationsByCode.get('KITCHEN-MAIN') || null;
      setCentralStoreLocationId(resolvedStoreId);
      setKitchenLocationId(resolvedKitchenId);

      if (!resolvedStoreId) {
        setMessage({
          type: 'error',
          text: t('finance.utilities.lpgTab.storeLocationUnavailable') || 'Central store location unavailable.',
        });
        setStoreStock(0);
      }

      const locRes = resolvedStoreId
        ? await supabase
            .from('item_location_stocks')
            .select('quantity')
            .eq('item_id', LPG_ITEM_ID)
            .eq('location_id', resolvedStoreId)
            .maybeSingle()
        : { data: null, error: null };

      if (itemRes.error) {
        console.error('Failed to load LPG item:', itemRes.error);
      }

      setLpgItem(itemRes.data);
      setStoreStock(locRes.error ? 0 : Number(locRes.data?.quantity) || 0);
      setVendors(vRes.data || []);
      setRecentMovements(movsRes.data || []);

      const todayMovs = (movsRes.data || []).filter(
        (m: any) => m.business_date === businessDate && m.movement_type === 'consumption'
      );
      const todayCyls = todayMovs.reduce((sum: number, m: any) => sum + (Number(m.quantity) || 0), 0);
      const todayVal = todayMovs.reduce((sum: number, m: any) => sum + (Number(m.total_value) || 0), 0);
      setTodayIssuesCylinders(todayCyls);
      setTodayIssuesValue(todayVal);
    } catch (err: any) {
      console.error('Failed to load LPG inventory:', err);
      setMessage({ type: 'error', text: err.message || 'Error loading LPG data.' });
    } finally {
      setLoading(false);
    }
  }, [supabase, businessDate, setMessage, t]);

  useEffect(() => {
    loadLpgData();
  }, [loadLpgData]);

  const minReserve = Number(lpgItem?.minimum_stock) || 2;
  const currentWac = Number(lpgItem?.current_weighted_average_cost) || 0;
  const isLowStock = storeStock <= minReserve;
  const stockPercentage = Math.min(100, Math.max(0, (storeStock / MAX_CYLINDERS_SCALE) * 100));

  // Handle Kitchen Issue (Consumption)
  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseInt(issueQty, 10);
    if (isNaN(qty) || qty <= 0) {
      alert(t('finance.utilities.lpgTab.alertValidCount') || 'Please enter valid cylinder count.');
      return;
    }

    if (qty > storeStock) {
      alert(
        t('finance.utilities.lpgTab.alertInsufficientStock', {
          available: storeStock,
          requested: qty,
        }) || `Insufficient stock in store (${storeStock} cylinders available).`
      );
      return;
    }
    if (!centralStoreLocationId) {
      setMessage({
        type: 'error',
        text: t('finance.utilities.lpgTab.storeLocationUnavailable') || 'Store location unavailable.',
      });
      return;
    }
    if (!kitchenLocationId) {
      setMessage({
        type: 'error',
        text: t('finance.utilities.lpgTab.kitchenLocationUnavailable') || 'Kitchen location unavailable.',
      });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: LPG_ITEM_ID,
        p_business_date: businessDate,
        p_movement_type: 'consumption',
        p_quantity: qty,
        p_unit_cost: currentWac,
        p_source_location_id: centralStoreLocationId,
        p_destination_location_id: kitchenLocationId,
        p_department_id: KITCHEN_DEPT_ID,
        p_responsible_person_id: null,
        p_purpose: 'Kitchen Gas',
        p_reference_id: null,
        p_reference_type: 'kitchen_issue',
        p_notes: issueNotes.trim() || 'Issued for kitchen cooking production',
        p_created_by: null,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text:
          t('finance.utilities.lpgTab.successIssue', {
            qty,
            balance: storeStock - qty,
          }) || `Issued ${qty} LPG cylinder(s) to Kitchen successfully.`,
      });

      setIssueQty('1');
      setIssueNotes('');
      setShowIssueNotes(false);
      loadLpgData();
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to issue LPG cylinders.' });
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
      alert(t('finance.utilities.lpgTab.alertValidCount') || 'Please enter valid cylinder count.');
      return;
    }
    if (isNaN(rate) || rate <= 0) {
      alert(t('finance.utilities.lpgTab.alertValidPrice') || 'Please enter valid price per cylinder.');
      return;
    }
    if (!centralStoreLocationId) {
      setMessage({
        type: 'error',
        text: t('finance.utilities.lpgTab.storeLocationUnavailable') || 'Store location unavailable.',
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
        p_item_id: LPG_ITEM_ID,
        p_business_date: purchaseDatePart,
        p_movement_type: 'purchase',
        p_quantity: qty,
        p_unit_cost: rate,
        p_source_location_id: null,
        p_destination_location_id: centralStoreLocationId,
        p_department_id: null,
        p_responsible_person_id: null,
        p_purpose: 'LPG Inward',
        p_reference_id: selectedVendorId || null,
        p_reference_type: 'vendor_purchase',
        p_notes: refNotes || null,
        p_created_by: null,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text:
          t('finance.utilities.lpgTab.successPurchase', {
            qty,
            rate: formatINR(rate),
            balance: storeStock + qty,
          }) || `Inwarded ${qty} LPG cylinder(s) successfully.`,
      });

      setPurchaseQty('');
      setPurchaseRate('');
      setSelectedVendorId('');
      setInvoiceNo('');
      setPurchaseNotes('');
      setShowBillDetails(false);
      setShowPurchaseNotes(false);
      loadLpgData();
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to record LPG purchase.' });
    } finally {
      setSaving(false);
    }
  };

  const parsedIssueQty = parseInt(issueQty, 10) || 0;
  const parsedPurchQty = parseInt(purchaseQty, 10) || 0;
  const parsedPurchRate = parseFloat(purchaseRate) || 0;

  const vendorOptions = useMemo(() => {
    return [
      { value: '', label: t('finance.utilities.lpgTab.selectVendor') || '— Select Gas Agency —' },
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
              {t('finance.utilities.lpgTab.stockTitle') || 'LPG Stock (19 kg)'}
            </span>
            {isLowStock ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                <AlertTriangle className="h-3 w-3" />
                {t('finance.utilities.lpgTab.lowMinReserve', { min: minReserve }) || `Low · Min ${minReserve} Cyl`}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                {t('finance.utilities.lpgTab.inStock') || 'In Stock'}
              </span>
            )}
          </div>

          {isLowStock && (
            <button
              type="button"
              onClick={() => {
                setMode('purchase');
                setTimeout(() => {
                  document.getElementById('lpg-action-card')?.scrollIntoView({ behavior: 'smooth' });
                }, 50);
              }}
              className="text-xs font-bold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200/80 flex items-center gap-1 transition-all cursor-pointer"
            >
              <span>{t('finance.utilities.lpgTab.restock') || 'Restock'}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Main Row: Big Bold Balance | Muted WAC */}
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <div className="text-xl sm:text-2xl font-black font-mono text-stone-900">
            {storeStock} <span className="text-sm font-bold text-stone-500">Cyl</span>
          </div>
          <div className="text-[11px] text-stone-500 font-medium text-right">
            <span>Avg {currentWac > 0 ? formatINR(currentWac) : '—'}/Cyl</span>
            <span className="mx-1.5 text-stone-300">·</span>
            <span>Commercial {CYLINDER_WEIGHT_KG}</span>
          </div>
        </div>

        {/* Bottom edge: 4px stock progress bar */}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-stone-200">
          <div
            className={`h-full transition-all duration-300 ${isLowStock ? 'bg-rose-500' : 'bg-amber-500'}`}
            style={{ width: `${stockPercentage}%` }}
          />
        </div>
      </div>

      {/* 2. Main Form & Ledger Grid (Desktop 12 cols: 5 form / 7 ledger) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Compact Action Card (5 cols on lg:) */}
        <div id="lpg-action-card" className="lg:col-span-5 bg-white p-3.5 sm:p-4 rounded-2xl border border-stone-200/90 shadow-2xs flex flex-col justify-between">
          <div className="space-y-3">
            {/* Segmented Mode Toggle */}
            <div className="bg-stone-100/90 p-1 rounded-xl border border-stone-200/80 grid grid-cols-2 gap-1 text-xs font-bold shadow-2xs">
              <button
                type="button"
                onClick={() => setMode('issue')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none ${
                  mode === 'issue' ? 'bg-white text-amber-900 shadow-2xs' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Utensils className={`h-3.5 w-3.5 ${mode === 'issue' ? 'text-amber-600' : 'text-stone-400'}`} />
                <span>{t('finance.utilities.lpgTab.tabIssue') || 'Issue to Kitchen'}</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('purchase')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer select-none ${
                  mode === 'purchase' ? 'bg-white text-amber-900 shadow-2xs' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Truck className={`h-3.5 w-3.5 ${mode === 'purchase' ? 'text-amber-600' : 'text-stone-400'}`} />
                <span>{t('finance.utilities.lpgTab.tabPurchase') || 'Purchase Inward'}</span>
              </button>
            </div>

            {/* Mode 1: Kitchen Issue */}
            {mode === 'issue' ? (
              <form onSubmit={handleIssueSubmit} className="space-y-3">
                {/* Cylinders Input + Quick-fill chips */}
                <div>
                  <label className="block text-[11px] font-bold text-stone-700 mb-1">
                    {t('finance.utilities.lpgTab.qtyToIssue') || 'Cylinders to Kitchen'}{' '}
                    <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative rounded-xl">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max={storeStock}
                      inputMode="numeric"
                      value={issueQty}
                      onChange={(e) => setIssueQty(e.target.value)}
                      placeholder="e.g. 1"
                      required
                      className="w-full h-11 rounded-xl border border-stone-300 p-2.5 font-bold font-mono text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 pr-12 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-2xs bg-white"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                      Cyl
                    </div>
                  </div>

                  {/* 1-tap quick fill chips */}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {[1, 2, 3, 5].map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setIssueQty(String(cnt))}
                        className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                          parsedIssueQty === cnt
                            ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                            : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                        }`}
                      >
                        {cnt} Cyl
                      </button>
                    ))}
                  </div>

                  {parsedIssueQty > storeStock && (
                    <p className="text-[11px] text-rose-600 mt-1 font-semibold">
                      {t('finance.utilities.lpgTab.exceedsStock', { stock: storeStock }) ||
                        `Exceeds available store cylinders (${storeStock}).`}
                    </p>
                  )}
                </div>

                {/* Live Cost Preview */}
                {parsedIssueQty > 0 && currentWac > 0 && (
                  <div className="p-2 bg-amber-50/80 rounded-xl border border-amber-200/80 flex items-center justify-between text-xs text-amber-950 font-medium">
                    <span>
                      Est. {formatINR(parsedIssueQty * currentWac)}
                    </span>
                    <span className="font-mono text-stone-600 text-[11px]">
                      Remaining: {Math.max(0, storeStock - parsedIssueQty)} Cyl
                    </span>
                  </div>
                )}

                {/* Optional Notes */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowIssueNotes(!showIssueNotes)}
                    className="text-[11px] font-bold text-stone-500 hover:text-stone-800 flex items-center gap-1 py-0.5 cursor-pointer select-none"
                  >
                    {showIssueNotes ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span>
                      {showIssueNotes
                        ? (t('finance.utilities.lpgTab.hideNotes') || 'Hide notes')
                        : (t('finance.utilities.lpgTab.addNotes') || '+ Add notes')}
                    </span>
                  </button>

                  {showIssueNotes && (
                    <div className="pt-2 animate-in fade-in duration-150">
                      <input
                        type="text"
                        value={issueNotes}
                        onChange={(e) => setIssueNotes(e.target.value)}
                        placeholder="Notes (e.g. Main kitchen stove station)"
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                      />
                    </div>
                  )}
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={saving || storeStock <= 0 || parsedIssueQty > storeStock}
                  className="w-full h-11 rounded-xl font-bold text-xs sm:text-sm text-white bg-amber-600 hover:bg-amber-700 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>{t('finance.utilities.lpgTab.recordingIssue') || 'Recording Issue...'}</span>
                    </>
                  ) : (
                    <>
                      <Utensils className="h-4 w-4" />
                      <span>{t('finance.utilities.lpgTab.issueToKitchen') || 'Issue to Kitchen'}</span>
                    </>
                  )}
                </button>
              </form>
            ) : (
              /* Mode 2: LPG Purchase Inward */
              <form onSubmit={handlePurchaseSubmit} className="space-y-3">
                {/* Row 1: Quantity & Rate side-by-side */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      {t('finance.utilities.lpgTab.qtyPurchased') || 'Cylinders'}{' '}
                      <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      inputMode="numeric"
                      value={purchaseQty}
                      onChange={(e) => setPurchaseQty(e.target.value)}
                      placeholder="e.g. 5"
                      required
                      className="w-full h-11 rounded-xl border border-stone-300 px-2.5 font-bold font-mono text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-2xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-1">
                      {t('finance.utilities.lpgTab.pricePerCylinder') || 'Rate (₹/Cyl)'}{' '}
                      <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      inputMode="decimal"
                      value={purchaseRate}
                      onChange={(e) => setPurchaseRate(e.target.value)}
                      placeholder="e.g. 1850"
                      required
                      className="w-full h-11 rounded-xl border border-stone-300 px-2.5 font-bold font-mono text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-2xs"
                    />
                  </div>
                </div>

                {/* Total amount summary pill */}
                {parsedPurchQty > 0 && parsedPurchRate > 0 && (
                  <div className="p-2 bg-stone-50 rounded-xl border border-stone-200/80 flex items-center justify-between text-xs">
                    <span className="text-stone-600 font-medium">{t('finance.utilities.lpgTab.totalAmount') || 'Total'}:</span>
                    <strong className="font-mono text-sm font-black text-stone-900">
                      {formatINR(parsedPurchQty * parsedPurchRate)}
                    </strong>
                  </div>
                )}

                {/* Row 2: Full-Width Purchase Date & Time */}
                <div>
                  <label className="block text-[11px] font-bold text-stone-700 mb-1">
                    {t('finance.utilities.lpgTab.purchaseDateTime') || 'Purchase Date & Time'}{' '}
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

                {/* Collapsible Toggles: + Bill Details & + Add notes */}
                <div className="flex items-center gap-3 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowBillDetails(!showBillDetails)}
                    className="text-[11px] font-bold text-stone-500 hover:text-stone-800 flex items-center gap-1 py-0.5 cursor-pointer select-none"
                  >
                    {showBillDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span>
                      {showBillDetails
                        ? (t('finance.utilities.hideBillDetails') || 'Hide bill details')
                        : (t('finance.utilities.addBillDetails') || '+ Bill Details')}
                    </span>
                    {!showBillDetails && (selectedVendorId || invoiceNo.trim()) ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-600 ml-0.5" />
                    ) : null}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPurchaseNotes(!showPurchaseNotes)}
                    className="text-[11px] font-bold text-stone-500 hover:text-stone-800 flex items-center gap-1 py-0.5 cursor-pointer select-none"
                  >
                    {showPurchaseNotes ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span>
                      {showPurchaseNotes
                        ? (t('finance.utilities.lpgTab.hideNotes') || 'Hide notes')
                        : (t('finance.utilities.lpgTab.addNotes') || '+ Add notes')}
                    </span>
                    {!showPurchaseNotes && purchaseNotes.trim() ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-600 ml-0.5" />
                    ) : null}
                  </button>
                </div>

                {/* Collapsible Bill Details (Vendor + Challan No) */}
                {showBillDetails && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 animate-in fade-in duration-150">
                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        {t('finance.utilities.lpgTab.vendor') || 'Agency / Vendor'}
                      </label>
                      <SimpleSelect
                        value={selectedVendorId}
                        onChange={setSelectedVendorId}
                        options={vendorOptions}
                        placeholder={t('finance.utilities.lpgTab.selectVendor') || '— Select Gas Agency —'}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        {t('finance.utilities.lpgTab.invoiceNo') || 'Invoice / Challan No.'}
                      </label>
                      <input
                        type="text"
                        value={invoiceNo}
                        onChange={(e) => setInvoiceNo(e.target.value)}
                        placeholder="e.g. CH-2041"
                        className="w-full h-11 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white shadow-2xs"
                      />
                    </div>
                  </div>
                )}

                {/* Collapsible Notes */}
                {showPurchaseNotes && (
                  <div className="pt-1 animate-in fade-in duration-150">
                    <input
                      type="text"
                      value={purchaseNotes}
                      onChange={(e) => setPurchaseNotes(e.target.value)}
                      placeholder={t('finance.utilities.lpgTab.purchaseNotesPlaceholder') || 'Notes (optional)'}
                      className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                    />
                  </div>
                )}

                {/* Record Purchase CTA */}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full h-11 rounded-xl font-bold text-xs sm:text-sm text-white bg-amber-600 hover:bg-amber-700 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>{t('finance.utilities.lpgTab.savingPurchase') || t('finance.utilities.lpgTab.inwardingStock') || 'Saving Purchase...'}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{t('finance.utilities.lpgTab.recordPurchase') || 'Record Purchase'}</span>
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
                {t('finance.utilities.lpgTab.movementsTitle') || 'LPG Movements'}
              </div>
              <div className="text-[11px] text-stone-400">
                {t('finance.utilities.lpgTab.recentIssuesCount', { count: recentMovements.length }) ||
                  `${recentMovements.length} recent issues & purchases`}
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
                  {t('finance.utilities.lpgTab.noMovements') || 'No LPG movements recorded yet.'}
                </div>
                <div className="text-[11px] text-stone-400">
                  {t('finance.utilities.lpgTab.noMovementsSub') ||
                    'Record an issue to kitchen or purchase inward to start the log.'}
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
                              <Utensils className="h-3.5 w-3.5 text-amber-600" />
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
                            {isConsumption ? `-${qty} Cyl` : `+${qty} Cyl`}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-stone-500">
                          <span>{m.purpose || (isConsumption ? 'Kitchen Gas' : 'LPG Inward')}</span>
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
                        <th className="py-2.5 px-3">{t('finance.utilities.lpgTab.colAction') || 'Action'}</th>
                        <th className="py-2.5 px-3 text-right">{t('common.labels.quantity') || 'Quantity'}</th>
                        <th className="py-2.5 px-3 text-right">{t('common.labels.total') || 'Value'}</th>
                        <th className="py-2.5 px-3">{t('finance.utilities.lpgTab.colNotes') || 'Details / Notes'}</th>
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
                                  ? (t('finance.utilities.lpgTab.tabIssue') || 'Kitchen Issue')
                                  : (t('finance.utilities.lpgTab.tabPurchase') || 'Purchase')}
                              </span>
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono font-bold ${
                                isConsumption ? 'text-amber-800' : 'text-emerald-700'
                              }`}
                            >
                              {isConsumption ? `-${qty} Cyl` : `+${qty} Cyl`}
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
