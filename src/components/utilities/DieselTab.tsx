'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import { DateTimePicker } from '@/components/ui/DateTimePicker';
import { TimePicker, formatTime, time12To24 } from '@/components/ui/TimePicker';
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
  Zap,
  Clock,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';
import type { GeneratorDiagnosticLog } from '@/lib/types/database';

interface DieselTabProps {
  businessDate: string;
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error' | 'warning' | 'info'; text: string }) => void;
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

  // Form Mode: refill vs purchase vs log
  const [mode, setMode] = useState<'refill' | 'purchase' | 'log'>('refill');

  // Generator Refill Form State
  const [refillLiters, setRefillLiters] = useState<string>('');
  const [refillNotes, setRefillNotes] = useState('');
  const [showRefillExtras, setShowRefillExtras] = useState(false);

  // Purchase Form State
  const [purchaseDateTime, setPurchaseDateTime] = useState<string>(() => `${businessDate}T${getCurrentTimeHHMM()}`);
  const [purchaseLiters, setPurchaseLiters] = useState<string>('');
  const [purchaseRate, setPurchaseRate] = useState<string>('');
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [showBillDetails, setShowBillDetails] = useState(false);
  const [showPurchaseNotes, setShowPurchaseNotes] = useState(false);

  // Generator Log Form State
  const [logTime, setLogTime] = useState<string>(() => {
    const now = new Date();
    return formatTime(now.getHours(), now.getMinutes(), 12);
  });
  const [runtimeHours, setRuntimeHours] = useState<string>('');
  const [runtimeMinutes, setRuntimeMinutes] = useState<string>('');
  const [totalStarts, setTotalStarts] = useState<string>('');
  const [fuelLevelPct, setFuelLevelPct] = useState<string>('');
  const [energyAccKwh, setEnergyAccKwh] = useState<string>('');
  const [logNotes, setLogNotes] = useState('');
  const [showLogNotes, setShowLogNotes] = useState(false);

  // Generator Logs Data & Graceful Migration State
  const [genLogs, setGenLogs] = useState<GeneratorDiagnosticLog[]>([]);
  const [latestPriorLog, setLatestPriorLog] = useState<GeneratorDiagnosticLog | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Sync purchase date default when businessDate changes
  useEffect(() => {
    setPurchaseDateTime(`${businessDate}T${getCurrentTimeHHMM()}`);
  }, [businessDate]);

  // Load Diesel inventory data
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

  // Load Generator Diagnostic Logs
  const loadGenLogs = useCallback(async () => {
    try {
      const [todayLogsRes, priorLogRes] = await Promise.all([
        supabase
          .from('generator_diagnostic_logs')
          .select('*')
          .eq('business_date', businessDate)
          .order('recorded_at', { ascending: false }),
        supabase
          .from('generator_diagnostic_logs')
          .select('*')
          .order('recorded_at', { ascending: false })
          .limit(1),
      ]);

      if (todayLogsRes.error) {
        const err = todayLogsRes.error;
        if (
          err.code === '42P01' ||
          err.code === 'PGRST205' ||
          err.message?.includes('does not exist') ||
          err.message?.includes('Could not find')
        ) {
          setGenLogs([]);
          setLatestPriorLog(null);
          setMigrationPending(true);
          return;
        }
        throw err;
      }

      setGenLogs((todayLogsRes.data as GeneratorDiagnosticLog[]) || []);
      setMigrationPending(false);

      if (priorLogRes.data && priorLogRes.data.length > 0) {
        setLatestPriorLog(priorLogRes.data[0] as GeneratorDiagnosticLog);
      } else {
        setLatestPriorLog(null);
      }
    } catch (err) {
      console.error('Failed to load generator diagnostic logs:', err);
    }
  }, [supabase, businessDate]);

  useEffect(() => {
    loadDieselData();
    loadGenLogs();
  }, [loadDieselData, loadGenLogs]);

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
      const finalNotes = refillNotes.trim();

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
      setShowBillDetails(false);
      setShowPurchaseNotes(false);
      loadDieselData();
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to record diesel purchase.' });
    } finally {
      setSaving(false);
    }
  };

  // Handle Generator Diagnostic Log Save
  const handleLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (migrationPending) {
      setMessage({
        type: 'warning',
        text:
          t('finance.utilities.dieselTab.migrationNotice') ||
          'Database migration pending: Staged migration 20261121000000_create_generator_diagnostic_logs.sql must be applied by an operator before saving logs.',
      });
      return;
    }

    const h = parseInt(runtimeHours, 10);
    const m = runtimeMinutes === '' ? 0 : parseInt(runtimeMinutes, 10);
    const starts = parseInt(totalStarts, 10);
    const fuel = parseInt(fuelLevelPct, 10);
    const energy = parseFloat(energyAccKwh);

    if (isNaN(h) || h < 0) {
      alert(t('finance.utilities.dieselTab.alertRuntime') || 'Please enter valid runtime hours.');
      return;
    }
    if (isNaN(m) || m < 0 || m > 59) {
      alert(t('finance.utilities.dieselTab.alertMinutes') || 'Please enter valid runtime minutes (0–59).');
      return;
    }
    if (isNaN(starts) || starts < 0) {
      alert(t('finance.utilities.dieselTab.alertStarts') || 'Please enter valid total engine starts.');
      return;
    }
    if (isNaN(fuel) || fuel < 0 || fuel > 100) {
      alert(t('finance.utilities.dieselTab.alertFuel') || 'Please enter valid fuel level percentage (0–100%).');
      return;
    }
    if (isNaN(energy) || energy < 0) {
      alert(t('finance.utilities.dieselTab.alertEnergy') || 'Please enter valid energy accumulation in kWh.');
      return;
    }

    setSaving(true);
    try {
      const time24 = time12To24(logTime);
      const localIso = `${businessDate}T${time24}:00`;
      const recordedAt = new Date(localIso).toISOString();

      const { error } = await supabase.from('generator_diagnostic_logs').insert({
        business_date: businessDate,
        recorded_at: recordedAt,
        runtime_hours: h,
        runtime_minutes: m,
        total_starts: starts,
        fuel_level_pct: fuel,
        energy_acc_kwh: energy,
        notes: logNotes.trim() || null,
      });

      if (error) {
        if (
          error.code === '42P01' ||
          error.code === 'PGRST205' ||
          error.message?.includes('does not exist') ||
          error.message?.includes('Could not find')
        ) {
          setMigrationPending(true);
          setMessage({
            type: 'warning',
            text:
              t('finance.utilities.dieselTab.migrationNotice') ||
              'Database migration pending: Staged migration 20261121000000_create_generator_diagnostic_logs.sql must be applied by an operator before saving logs.',
          });
          return;
        }
        throw error;
      }

      setMessage({
        type: 'success',
        text: t('finance.utilities.dieselTab.logSavedSuccess') || 'Generator diagnostic log recorded successfully!',
      });

      setRuntimeHours('');
      setRuntimeMinutes('');
      setTotalStarts('');
      setFuelLevelPct('');
      setEnergyAccKwh('');
      setLogNotes('');
      setShowLogNotes(false);
      const now = new Date();
      setLogTime(formatTime(now.getHours(), now.getMinutes(), 12));
      loadGenLogs();
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save generator log.' });
    } finally {
      setSaving(false);
    }
  };

  const parsedRefillQty = parseFloat(refillLiters) || 0;
  const parsedPurchQty = parseFloat(purchaseLiters) || 0;
  const parsedPurchRate = parseFloat(purchaseRate) || 0;

  // Generator Log live delta derivations
  const enteredRuntimeMinutes = useMemo(() => {
    if (runtimeHours === '') return null;
    const h = parseInt(runtimeHours, 10) || 0;
    const m = parseInt(runtimeMinutes, 10) || 0;
    return h * 60 + m;
  }, [runtimeHours, runtimeMinutes]);

  const isRuntimeLower = useMemo(() => {
    if (!latestPriorLog || enteredRuntimeMinutes === null) return false;
    const prevTotal =
      latestPriorLog.total_runtime_minutes ??
      latestPriorLog.runtime_hours * 60 + latestPriorLog.runtime_minutes;
    return enteredRuntimeMinutes < prevTotal;
  }, [latestPriorLog, enteredRuntimeMinutes]);

  const runtimeDeltaStr = useMemo(() => {
    if (!latestPriorLog || enteredRuntimeMinutes === null) return null;
    const prevTotal =
      latestPriorLog.total_runtime_minutes ??
      latestPriorLog.runtime_hours * 60 + latestPriorLog.runtime_minutes;
    const diff = enteredRuntimeMinutes - prevTotal;
    if (diff < 0) return t('finance.utilities.dieselTab.lowerThanPrior') || 'Lower than prior';
    const dh = Math.floor(diff / 60);
    const dm = diff % 60;
    return `+${dh}h ${dm}m`;
  }, [latestPriorLog, enteredRuntimeMinutes, t]);

  const isStartsLower = useMemo(() => {
    if (!latestPriorLog || totalStarts === '') return false;
    const current = parseInt(totalStarts, 10);
    return !isNaN(current) && current < latestPriorLog.total_starts;
  }, [latestPriorLog, totalStarts]);

  const startsWarning = useMemo(() => {
    if (!isStartsLower || !latestPriorLog) return null;
    return (
      t('finance.utilities.dieselTab.lowerThanPriorVal', { val: latestPriorLog.total_starts }) ||
      `Lower than prior (${latestPriorLog.total_starts})`
    );
  }, [isStartsLower, latestPriorLog, t]);

  const clampedFuel = useMemo(() => {
    if (fuelLevelPct === '') return 0;
    const num = parseInt(fuelLevelPct, 10);
    return isNaN(num) ? 0 : Math.min(100, Math.max(0, num));
  }, [fuelLevelPct]);

  const fuelBarColor = useMemo(() => {
    if (clampedFuel < 20) return 'bg-rose-500';
    if (clampedFuel <= 40) return 'bg-amber-500';
    return 'bg-emerald-500';
  }, [clampedFuel]);

  const isEnergyLower = useMemo(() => {
    if (!latestPriorLog || energyAccKwh === '') return false;
    const current = parseFloat(energyAccKwh);
    if (isNaN(current)) return false;
    const prev = Number(latestPriorLog.energy_acc_kwh);
    return current < prev;
  }, [latestPriorLog, energyAccKwh]);

  const energyDeltaStr = useMemo(() => {
    if (!latestPriorLog || energyAccKwh === '') return null;
    const current = parseFloat(energyAccKwh);
    if (isNaN(current)) return null;
    const prev = Number(latestPriorLog.energy_acc_kwh);
    const diff = current - prev;
    if (diff < 0) {
      return (
        t('finance.utilities.dieselTab.lowerThanPriorVal', { val: prev.toFixed(1) }) ||
        `Lower than prior (${prev.toFixed(1)})`
      );
    }
    return `+${diff.toFixed(1)} kWh`;
  }, [latestPriorLog, energyAccKwh, t]);

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

        {/* Bottom edge: 4px stock progress bar (bg-stone-200 track visible even at 0.0 L) */}
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
        <div id="diesel-action-card" className="lg:col-span-5 bg-white p-3.5 sm:p-4 rounded-2xl border border-stone-200/90 shadow-2xs flex flex-col justify-between">
          <div className="space-y-3">
            {/* Segmented Mode Toggle: 3 Modes (Refill | Purchase | Generator Log) */}
            <div className="bg-stone-100/90 p-1 rounded-xl border border-stone-200/80 grid grid-cols-3 gap-1 text-[11px] sm:text-xs font-bold shadow-2xs">
              <button
                type="button"
                onClick={() => setMode('refill')}
                className={`py-1.5 px-1 sm:px-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer select-none ${
                  mode === 'refill' ? 'bg-white text-amber-900 shadow-2xs font-extrabold' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Flame className={`h-3.5 w-3.5 shrink-0 ${mode === 'refill' ? 'text-amber-600' : 'text-stone-400'}`} />
                <span className="hidden sm:inline whitespace-nowrap">{t('finance.utilities.dieselTab.tabRefill') || 'Generator Refill'}</span>
                <span className="sm:hidden whitespace-nowrap">{t('finance.utilities.dieselTab.refillConcise') || 'Refill'}</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('purchase')}
                className={`py-1.5 px-1 sm:px-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer select-none ${
                  mode === 'purchase' ? 'bg-white text-amber-900 shadow-2xs font-extrabold' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Truck className={`h-3.5 w-3.5 shrink-0 ${mode === 'purchase' ? 'text-amber-600' : 'text-stone-400'}`} />
                <span className="hidden sm:inline whitespace-nowrap">{t('finance.utilities.dieselTab.tabPurchase') || 'Purchase Inward'}</span>
                <span className="sm:hidden whitespace-nowrap">{t('finance.utilities.dieselTab.purchaseConcise') || 'Purchase'}</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('log')}
                className={`py-1.5 px-1 sm:px-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer select-none ${
                  mode === 'log' ? 'bg-white text-amber-900 shadow-2xs font-extrabold' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Zap className={`h-3.5 w-3.5 shrink-0 ${mode === 'log' ? 'text-amber-600' : 'text-stone-400'}`} />
                <span className="whitespace-nowrap">{t('finance.utilities.dieselTab.tabLog') || 'Generator Log'}</span>
              </button>
            </div>

            {/* Mode 1: Generator Refill */}
            {mode === 'refill' && (
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

                {/* Collapsible Notes */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowRefillExtras(!showRefillExtras)}
                    className="text-[11px] font-bold text-stone-500 hover:text-stone-800 flex items-center gap-1 py-0.5 cursor-pointer select-none"
                  >
                    {showRefillExtras ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span>
                      {showRefillExtras
                        ? (t('finance.utilities.hideNotes') || 'Hide notes')
                        : (t('finance.utilities.addNotes') || '+ Add notes')}
                    </span>
                  </button>

                  {showRefillExtras && (
                    <div className="pt-2 animate-in fade-in duration-150">
                      <input
                        type="text"
                        value={refillNotes}
                        onChange={(e) => setRefillNotes(e.target.value)}
                        placeholder={t('finance.utilities.dieselTab.refillNotesPlaceholder') || 'Notes (e.g. Evening peak load backup)'}
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                      />
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
            )}

            {/* Mode 2: Diesel Purchase Inward */}
            {mode === 'purchase' && (
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
                        ? (t('finance.utilities.hideNotes') || 'Hide notes')
                        : (t('finance.utilities.addNotes') || '+ Add notes')}
                    </span>
                    {!showPurchaseNotes && purchaseNotes.trim() ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-600 ml-0.5" />
                    ) : null}
                  </button>
                </div>

                {/* Collapsible Bill Details (Vendor + Bill No) */}
                {showBillDetails && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 animate-in fade-in duration-150">
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
                        placeholder="e.g. HPCL-98421"
                        className="w-full h-11 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white shadow-2xs"
                      />
                    </div>
                  </div>
                )}

                {/* Collapsible Purchase Notes */}
                {showPurchaseNotes && (
                  <div className="pt-1 animate-in fade-in duration-150">
                    <input
                      type="text"
                      value={purchaseNotes}
                      onChange={(e) => setPurchaseNotes(e.target.value)}
                      placeholder={t('finance.utilities.dieselTab.purchaseNotesPlaceholder') || 'Notes (optional)'}
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
                      <span>{t('finance.utilities.dieselTab.savingPurchase') || 'Saving Purchase...'}</span>
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

            {/* Mode 3: Generator Log (LCD Diagnostic Readings) */}
            {mode === 'log' && (
              <form onSubmit={handleLogSubmit} className="space-y-3">
                {/* 1. Time (12h format e.g. 11:57 PM) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-stone-700">
                      {t('finance.utilities.readingTimestamp') || 'Time'} <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const now = new Date();
                        setLogTime(formatTime(now.getHours(), now.getMinutes(), 12));
                      }}
                      className="px-2 py-0.5 text-[10px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 rounded border border-amber-200/70 transition-colors cursor-pointer select-none"
                      title={t('common.datePicker.now') || 'Set current time'}
                    >
                      {t('common.datePicker.now') || 'Now'}
                    </button>
                  </div>
                  <TimePicker
                    value={logTime}
                    onChange={setLogTime}
                    hourCycle={12}
                    hideIcon={true}
                    hideNow={true}
                    required
                    triggerClassName="h-11 px-2.5"
                  />
                </div>

                {/* 2. Runtime (55 h 23 m compound input) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-stone-700">
                      {t('finance.utilities.dieselTab.runtimeLabel') || 'Runtime'} <span className="text-rose-500">*</span>
                    </label>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      {latestPriorLog && (
                        <span className="text-stone-400 font-medium">
                          {t('finance.utilities.dieselTab.prevRuntime', {
                            hours: latestPriorLog.runtime_hours,
                            minutes: latestPriorLog.runtime_minutes,
                          }) || `(Prev: ${latestPriorLog.runtime_hours}h ${latestPriorLog.runtime_minutes}m)`}
                        </span>
                      )}
                      {runtimeDeltaStr && (
                        <span
                          className={`font-mono font-bold text-[10px] px-1 py-0.2 rounded border ${
                            isRuntimeLower
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200/70'
                          }`}
                        >
                          {runtimeDeltaStr}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Compound Split Input */}
                  <div className="flex items-center h-11 rounded-xl border border-stone-300 bg-white focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/20 shadow-2xs overflow-hidden">
                    {/* Hours */}
                    <div className="relative flex-1 h-full">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        value={runtimeHours}
                        onChange={(e) => setRuntimeHours(e.target.value.replace(/\D/g, '').slice(0, 5))}
                        placeholder="55"
                        required
                        className="w-full h-full pl-3 pr-7 font-mono font-bold text-sm text-stone-900 bg-transparent focus:outline-none"
                      />
                      <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                        h
                      </div>
                    </div>

                    {/* Hairline Divider */}
                    <div className="w-[1px] h-6 bg-stone-200 shrink-0" />

                    {/* Minutes */}
                    <div className="relative flex-1 h-full">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={2}
                        value={runtimeMinutes}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          if (val === '') {
                            setRuntimeMinutes('');
                            return;
                          }
                          const num = parseInt(val, 10);
                          if (num > 59) {
                            setRuntimeMinutes('59');
                          } else {
                            setRuntimeMinutes(val);
                          }
                        }}
                        onBlur={() => {
                          if (runtimeMinutes !== '') {
                            const num = parseInt(runtimeMinutes, 10);
                            setRuntimeMinutes(pad2(Math.min(59, Math.max(0, num))));
                          }
                        }}
                        placeholder="23"
                        required
                        className="w-full h-full pl-3 pr-8 font-mono font-bold text-sm text-stone-900 bg-transparent focus:outline-none"
                      />
                      <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                        m
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3 & 4. Total Starts & Fuel Level (2-Column Grid) */}
                <div className="grid grid-cols-2 gap-2.5">
                  {/* Total Starts */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-stone-700">
                        {t('finance.utilities.dieselTab.totalStarts') || 'Total Starts'} <span className="text-rose-500">*</span>
                      </label>
                      {startsWarning && (
                        <span className="text-[10px] text-amber-700 font-semibold" title={startsWarning}>
                          ⚠
                        </span>
                      )}
                    </div>
                    <div className="relative rounded-xl">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={8}
                        value={totalStarts}
                        onChange={(e) => setTotalStarts(e.target.value.replace(/\D/g, '').slice(0, 8))}
                        placeholder="169"
                        required
                        className="w-full h-11 rounded-xl border border-stone-300 px-3 font-mono font-bold text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white shadow-2xs"
                      />
                    </div>
                    {startsWarning && (
                      <p className="text-[10px] text-amber-700 mt-1 font-semibold truncate">
                        {startsWarning}
                      </p>
                    )}
                  </div>

                  {/* Fuel Level */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-stone-700">
                        {t('finance.utilities.dieselTab.fuelLevel') || 'Fuel Level'} <span className="text-rose-500">*</span>
                      </label>
                      {fuelLevelPct !== '' && (
                        <span className="text-[10px] font-mono font-bold text-stone-500">
                          {clampedFuel}%
                        </span>
                      )}
                    </div>
                    <div className="relative rounded-xl overflow-hidden">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={3}
                        value={fuelLevelPct}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 3);
                          if (val === '') {
                            setFuelLevelPct('');
                            return;
                          }
                          const num = parseInt(val, 10);
                          setFuelLevelPct(String(Math.min(100, Math.max(0, num))));
                        }}
                        placeholder="37"
                        required
                        className="w-full h-11 rounded-xl border border-stone-300 pl-3 pr-7 font-mono font-bold text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white shadow-2xs"
                      />
                      <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                        %
                      </div>
                      {/* 4px dynamic fuel level indicator bar directly beneath input */}
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-stone-200">
                        <div
                          className={`h-full transition-all duration-200 ${fuelBarColor}`}
                          style={{ width: `${clampedFuel}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Energy Acc. (758 kWh) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-stone-700">
                      {t('finance.utilities.dieselTab.energyAcc') || 'Energy Acc.'} <span className="text-rose-500">*</span>
                    </label>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      {latestPriorLog && (
                        <span className="text-stone-400 font-medium">
                          {t('finance.utilities.dieselTab.prevEnergy', {
                            val: Number(latestPriorLog.energy_acc_kwh).toFixed(0),
                          }) || `(Prev: ${Number(latestPriorLog.energy_acc_kwh).toFixed(0)} kWh)`}
                        </span>
                      )}
                      {energyDeltaStr && (
                        <span
                          className={`font-mono font-bold text-[10px] px-1 py-0.2 rounded border ${
                            isEnergyLower
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200/70'
                          }`}
                        >
                          {energyDeltaStr}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative rounded-xl">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      inputMode="decimal"
                      value={energyAccKwh}
                      onChange={(e) => setEnergyAccKwh(e.target.value)}
                      placeholder="758"
                      required
                      className="w-full h-11 rounded-xl border border-stone-300 pl-3 pr-12 font-mono font-bold text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white shadow-2xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-stone-400 font-bold text-xs">
                      kWh
                    </div>
                  </div>
                </div>

                {/* 6. Optional Notes */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowLogNotes(!showLogNotes)}
                    className="text-[11px] font-bold text-stone-500 hover:text-stone-800 flex items-center gap-1 py-0.5 cursor-pointer select-none"
                  >
                    {showLogNotes ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span>
                      {showLogNotes
                        ? (t('finance.utilities.hideNotes') || 'Hide notes')
                        : (t('finance.utilities.addNotes') || '+ Add notes')}
                    </span>
                  </button>
                  {showLogNotes && (
                    <div className="pt-2 animate-in fade-in duration-150">
                      <input
                        type="text"
                        value={logNotes}
                        onChange={(e) => setLogNotes(e.target.value)}
                        placeholder={t('finance.utilities.dieselTab.logNotesPlaceholder') || 'e.g. End of day generator reading'}
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                      />
                    </div>
                  )}
                </div>

                {/* 7. Save Generator Log CTA */}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full h-11 rounded-xl font-bold text-xs sm:text-sm text-white bg-amber-600 hover:bg-amber-700 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>{t('finance.utilities.dieselTab.savingLog') || 'Saving Generator Log...'}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{t('finance.utilities.dieselTab.saveLog') || 'Save Generator Log'}</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Activity Ledger (7 cols on lg:) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-stone-200/90 shadow-2xs overflow-hidden flex flex-col">
          {mode === 'log' ? (
            /* Sub-View A: Generator Diagnostic Logs Ledger */
            <>
              <div className="px-3.5 sm:px-4 py-3 border-b border-stone-100 flex items-center justify-between">
                <div>
                  <div className="font-bold text-xs sm:text-sm text-stone-900">
                    {t('finance.utilities.dieselTab.genLogsTitle') || 'Generator Diagnostic Logs'}
                  </div>
                  <div className="text-[11px] text-stone-400">
                    {genLogs.length === 1
                      ? (t('finance.utilities.dieselTab.oneLogRecorded') || '1 log entry for today')
                      : (t('finance.utilities.dieselTab.logsCount', { count: genLogs.length }) || `${genLogs.length} log entries for today`)}
                  </div>
                </div>
                <Badge variant={genLogs.length > 0 ? 'success' : 'outline'} className="text-[10px]">
                  {genLogs.length}
                </Badge>
              </div>

              <div className="flex-1">
                {genLogs.length === 0 ? (
                  <div className="py-8 px-4 text-center text-stone-400 text-xs space-y-1.5">
                    <Zap className="h-7 w-7 mx-auto text-stone-300" />
                    <div className="font-semibold text-stone-600">
                      {t('finance.utilities.dieselTab.noGenLogs') || 'No generator logs recorded for today yet.'}
                    </div>
                    <div className="text-[11px] text-stone-400">
                      {t('finance.utilities.dieselTab.noGenLogsSub') ||
                        'Record LCD panel readings to track runtime and generator energy output.'}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Mobile View: Scannable compact cards */}
                    <div className="divide-y divide-stone-100 md:hidden">
                      {genLogs.map((log) => {
                        const timeFormatted = new Date(log.recorded_at).toLocaleTimeString(
                          locale === 'hi' ? 'hi-IN' : 'en-IN',
                          { hour: 'numeric', minute: '2-digit', hour12: true }
                        );
                        const fuelPillClass =
                          log.fuel_level_pct < 20
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : log.fuel_level_pct <= 40
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200';

                        return (
                          <div key={log.id} className="p-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-xs text-stone-900 flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-amber-600" />
                                <span>{timeFormatted}</span>
                              </span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black font-mono border ${fuelPillClass}`}>
                                {t('finance.utilities.dieselTab.fuelBadge', { pct: log.fuel_level_pct }) || `${log.fuel_level_pct}% Fuel`}
                              </span>
                            </div>

                            <div className="grid grid-cols-3 gap-1 pt-0.5 text-xs">
                              <div>
                                <span className="text-[10px] text-stone-400 block">{t('finance.utilities.dieselTab.colRuntime') || 'Runtime'}</span>
                                <span className="font-mono font-bold text-stone-900 text-xs">
                                  {log.runtime_hours}h {log.runtime_minutes}m
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-stone-400 block">{t('finance.utilities.dieselTab.colStarts') || 'Starts'}</span>
                                <span className="font-mono font-bold text-stone-900 text-xs">
                                  {log.total_starts}
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] text-stone-400 block">{t('finance.utilities.dieselTab.colEnergy') || 'Energy'}</span>
                                <span className="font-mono font-bold text-amber-900 text-xs">
                                  {Number(log.energy_acc_kwh).toFixed(1)} kWh
                                </span>
                              </div>
                            </div>

                            {log.notes && (
                              <div className="text-[10px] text-stone-500 italic truncate pt-0.5">
                                {log.notes}
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
                            <th className="py-2.5 px-3">{t('finance.utilities.colTime') || 'Time'}</th>
                            <th className="py-2.5 px-3 text-right">{t('finance.utilities.dieselTab.colRuntime') || 'Runtime'}</th>
                            <th className="py-2.5 px-3 text-right">{t('finance.utilities.dieselTab.colStarts') || 'Total Starts'}</th>
                            <th className="py-2.5 px-3 text-center">{t('finance.utilities.dieselTab.colFuel') || 'Fuel Level'}</th>
                            <th className="py-2.5 px-3 text-right">{t('finance.utilities.dieselTab.colEnergy') || 'Energy Acc.'}</th>
                            <th className="py-2.5 px-3">{t('finance.utilities.colNotes') || 'Notes'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {genLogs.map((log) => {
                            const timeFormatted = new Date(log.recorded_at).toLocaleTimeString(
                              locale === 'hi' ? 'hi-IN' : 'en-IN',
                              { hour: 'numeric', minute: '2-digit', hour12: true }
                            );
                            const fuelPillClass =
                              log.fuel_level_pct < 20
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : log.fuel_level_pct <= 40
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200';

                            return (
                              <tr key={log.id} className="hover:bg-stone-50/80 transition-colors">
                                <td className="py-2 px-3 text-stone-700 whitespace-nowrap font-medium">
                                  {timeFormatted}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-stone-900">
                                  {log.runtime_hours}h {log.runtime_minutes}m
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-stone-700">
                                  {log.total_starts}
                                </td>
                                <td className="py-2 px-3 text-center">
                                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-black font-mono border ${fuelPillClass}`}>
                                    {log.fuel_level_pct}%
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-amber-900">
                                  {Number(log.energy_acc_kwh).toFixed(1)} kWh
                                </td>
                                <td className="py-2 px-3 text-stone-500 max-w-xs truncate">
                                  {log.notes || '—'}
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
            </>
          ) : (
            /* Sub-View B: Fuel Movements Ledger (Refill & Purchase) */
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
