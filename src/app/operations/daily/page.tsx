'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate, formatNumber } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName, getLocalizedMasterSymbol } from '@/lib/i18n/master-data';
import { MonthlyReportCalendar } from '@/components/sales/MonthlyReportCalendar';
import {
  ClipboardList,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Users,
  Car,
  Receipt,
  UploadCloud,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Package,
  Zap,
  MessageSquareWarning,
  Save,
  Clock,
  ArrowRight,
  Check,
} from 'lucide-react';

interface EntryStatusState {
  attendance: boolean;
  store: boolean;
  utilities: boolean;
  handover: boolean;
}

interface CarOriginItem {
  prefix: string;
  count: number;
}

interface GateTrafficState {
  visitors: number;
  cars: number;
  bikes: number;
  totalVehicles: number;
  origins: CarOriginItem[];
}

interface PetpoojaReportingState {
  previousDate: string;
  uploadedCount: number;
  missingTypes: string[];
  isFullyUploaded: boolean;
  status: 'uploaded' | 'dueToday' | 'overdue' | 'upcoming';
  netSales: number;
}

interface KeyConsumptionItem {
  itemId: string;
  name: string;
  quantity: number;
  unitSymbol: string;
  totalValue: number;
}

// 4 Authoritative Petpooja daily reports required for completeness
const REQUIRED_DAILY_REPORTS = [
  { key: 'EXECUTIVE_SUMMARY', labelKey: 'finance.sales.import.reportTypes.executiveSummary' },
  { key: 'ORDERS_MASTER', labelKey: 'finance.sales.import.reportTypes.ordersMaster' },
  { key: 'ITEM_ORDER_DETAILS', labelKey: 'finance.sales.import.reportTypes.itemOrderDetails' },
  { key: 'HOURLY_ITEM_SALES', labelKey: 'finance.sales.import.reportTypes.hourlyItemSales' },
] as const;

// Non-consumption stock movement types (to be excluded from consumption valuation)
const NON_CONSUMPTION_MOVEMENTS = new Set([
  'transfer',
  'purchase',
  'opening',
  'return',
  'count_adjustment',
  'physical_count_adjustment',
]);

function getPreviousDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dObj = new Date(Date.UTC(y, m - 1, d - 1));
  const year = dObj.getUTCFullYear();
  const month = String(dObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dObj.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dObj = new Date(Date.UTC(y, m - 1, d + 1));
  const year = dObj.getUTCFullYear();
  const month = String(dObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dObj.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function DailyOperationsPage() {
  const supabase = createClient();
  const { t, locale, formatDate } = useI18n();

  const [businessDate, setBusinessDate] = useState(() => getTodayBusinessDate());
  const [loading, setLoading] = useState(true);
  const [savingNotes, setSavingNotes] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Section 1: Compact Daily Entry Status
  const [entryStatus, setEntryStatus] = useState<EntryStatusState>({
    attendance: false,
    store: false,
    utilities: false,
    handover: false,
  });

  // Section 2: Gate Traffic (Origins First)
  const [gateTraffic, setGateTraffic] = useState<GateTrafficState>({
    visitors: 0,
    cars: 0,
    bikes: 0,
    totalVehicles: 0,
    origins: [],
  });

  // Section 3: Petpooja Reporting (Previous Day Status + Collapsible Calendar)
  const [petpoojaReporting, setPetpoojaReporting] = useState<PetpoojaReportingState>({
    previousDate: getPreviousDate(getTodayBusinessDate()),
    uploadedCount: 0,
    missingTypes: [],
    isFullyUploaded: false,
    status: 'dueToday',
    netSales: 0,
  });
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);

  // Section 4: Key Store Consumption (Ranked Dynamically by Value)
  const [keyConsumption, setKeyConsumption] = useState<KeyConsumptionItem[]>([]);

  // Section 5: Shift Handover & Notes
  const [complaints, setComplaints] = useState('');
  const [workOrders, setWorkOrders] = useState('');
  const [requirements, setRequirements] = useState('');
  const [operationalNotes, setOperationalNotes] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const loadAllDailyOperations = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    const previousDate = getPreviousDate(businessDate);
    const today = getTodayBusinessDate();

    try {
      // Execute consolidated parallel queries across existing authoritative tables
      const [
        attendanceRes,
        storeStatusRes,
        utilitiesStatusRes,
        visitorEventsRes,
        vehicleEventsRes,
        petpoojaBatchesRes,
        petpoojaSummaryRes,
        stockMovementsRes,
        handoverNotesRes,
      ] = await Promise.all([
        // 1. Attendance check for businessDate
        supabase
          .from('attendance')
          .select('id', { count: 'exact', head: true })
          .eq('business_date', businessDate),

        // 2. Store update check for businessDate
        supabase
          .from('stock_movements')
          .select('id', { count: 'exact', head: true })
          .eq('business_date', businessDate),

        // 3. Utilities check for businessDate
        supabase
          .from('meter_readings')
          .select('id', { count: 'exact', head: true })
          .eq('business_date', businessDate),

        // 4. Gate visitors for businessDate
        supabase
          .from('visitor_counter_events')
          .select('increment')
          .eq('business_date', businessDate),

        // 5. Gate vehicles & origins for businessDate
        supabase
          .from('vehicle_counter_events')
          .select('increment, vehicle_prefix, location:vehicle_origin_locations(id, name)')
          .eq('business_date', businessDate),

        // 6. Petpooja batches for previousDate
        supabase
          .from('sales_import_batches')
          .select('report_type, total_net_sales')
          .eq('business_date', previousDate),

        // 7. Petpooja sales summary for previousDate (authoritative net sales)
        supabase
          .from('sales_executive_summaries')
          .select('net_sales')
          .eq('business_date', previousDate)
          .maybeSingle(),

        // 8. Stock movements with valuation for Key Store Consumption on businessDate
        supabase
          .from('stock_movements')
          .select(`
            id, movement_type, purpose, quantity, unit_cost, total_value,
            item:inventory_items(
              id, name, name_hi, item_code, current_weighted_average_cost,
              unit:units!inventory_items_unit_id_fkey(symbol, symbol_hi)
            )
          `)
          .eq('business_date', businessDate),

        // 9. Shift handover notes for businessDate
        supabase
          .from('daily_operational_notes')
          .select('*')
          .eq('business_date', businessDate)
          .maybeSingle(),
      ]);

      // --- SECTION 1: ENTRY STATUS DERIVATION ---
      const hasAttendance = (attendanceRes.count || 0) > 0;
      const hasStore = (storeStatusRes.count || 0) > 0;
      const hasUtilities = (utilitiesStatusRes.count || 0) > 0;
      const handoverData = handoverNotesRes.data;
      const hasHandover = Boolean(
        handoverData &&
          (handoverData.complaints?.trim() ||
            handoverData.work_orders?.trim() ||
            handoverData.requirements?.trim() ||
            handoverData.operational_notes?.trim())
      );

      setEntryStatus({
        attendance: hasAttendance,
        store: hasStore,
        utilities: hasUtilities,
        handover: hasHandover,
      });

      // --- SECTION 2: GATE TRAFFIC DERIVATION ---
      const visitors = (visitorEventsRes.data || []).reduce(
        (sum: number, ev: any) => sum + (Number(ev.increment) || 0),
        0
      );

      let cars = 0;
      let bikes = 0;
      const originCounts: Record<string, number> = {};

      (vehicleEventsRes.data || []).forEach((ev: any) => {
        const inc = Number(ev.increment) || 1;
        const isBike =
          (ev.location?.name || '').toLowerCase() === 'bike' ||
          (ev.vehicle_prefix || '').toLowerCase() === 'bike';

        if (isBike) {
          bikes += inc;
        } else {
          cars += inc;
          const originName = ev.vehicle_prefix || ev.location?.name || 'Others';
          originCounts[originName] = (originCounts[originName] || 0) + inc;
        }
      });

      const sortedOrigins: CarOriginItem[] = Object.entries(originCounts)
        .map(([prefix, count]) => ({ prefix, count }))
        .sort((a, b) => b.count - a.count);

      setGateTraffic({
        visitors,
        cars,
        bikes,
        totalVehicles: cars + bikes,
        origins: sortedOrigins,
      });

      // --- SECTION 3: PETPOOJA REPORTING (PREVIOUS-DAY LOGIC) ---
      const batches = petpoojaBatchesRes.data || [];
      const uploadedReportTypes = new Set(batches.map((b: any) => b.report_type));

      const missingTypes = REQUIRED_DAILY_REPORTS.filter((r) => !uploadedReportTypes.has(r.key)).map(
        (r) => t(r.labelKey as any)
      );

      const uploadedCount = REQUIRED_DAILY_REPORTS.filter((r) => uploadedReportTypes.has(r.key)).length;
      const isFullyUploaded = uploadedCount === REQUIRED_DAILY_REPORTS.length;

      let status: 'uploaded' | 'dueToday' | 'overdue' | 'upcoming' = 'upcoming';
      if (businessDate > today) {
        status = 'upcoming';
      } else if (isFullyUploaded) {
        status = 'uploaded';
      } else if (businessDate === today) {
        status = 'dueToday';
      } else {
        status = 'overdue';
      }

      const netSales =
        Number(petpoojaSummaryRes.data?.net_sales) ||
        batches.reduce((sum: number, b: any) => sum + (Number(b.total_net_sales) || 0), 0);

      setPetpoojaReporting({
        previousDate,
        uploadedCount,
        missingTypes,
        isFullyUploaded,
        status,
        netSales,
      });

      // --- SECTION 4: KEY STORE CONSUMPTION (VALUATION RANKING) ---
      const movements = stockMovementsRes.data || [];
      const consumptionMap: Record<string, KeyConsumptionItem> = {};

      movements.forEach((m: any) => {
        if (NON_CONSUMPTION_MOVEMENTS.has(m.movement_type)) return;

        const item = m.item;
        if (!item) return;

        const qty = Math.abs(Number(m.quantity) || 0);
        const wac = Number(item.current_weighted_average_cost) || 0;
        const lineVal =
          Number(m.total_value) > 0 ? Number(m.total_value) : qty * wac;

        const localizedName = getLocalizedMasterName(item, locale) || item.name || 'Store Item';
        const localizedUnit = getLocalizedMasterSymbol(item.unit, locale) || 'pcs';

        if (!consumptionMap[item.id]) {
          consumptionMap[item.id] = {
            itemId: item.id,
            name: localizedName,
            quantity: 0,
            unitSymbol: localizedUnit,
            totalValue: 0,
          };
        }

        consumptionMap[item.id].quantity += qty;
        consumptionMap[item.id].totalValue += lineVal;
      });

      const sortedConsumption = Object.values(consumptionMap)
        .filter((item) => item.quantity > 0 || item.totalValue > 0)
        .sort((a, b) => b.totalValue - a.totalValue);

      setKeyConsumption(sortedConsumption);

      // --- SECTION 5: SHIFT HANDOVER & NOTES ---
      if (handoverData) {
        setComplaints(handoverData.complaints || '');
        setWorkOrders(handoverData.work_orders || '');
        setRequirements(handoverData.requirements || '');
        setOperationalNotes(handoverData.operational_notes || '');
        setLastSavedAt(handoverData.updated_at || null);
      } else {
        setComplaints('');
        setWorkOrders('');
        setRequirements('');
        setOperationalNotes('');
        setLastSavedAt(null);
      }
    } catch (err: any) {
      console.error('Error loading consolidated daily operations:', err);
      setMessage({ type: 'error', text: t('operations.daily.loadError') });
    } finally {
      setLoading(false);
    }
  }, [businessDate, locale, supabase, t]);

  useEffect(() => {
    loadAllDailyOperations();
  }, [loadAllDailyOperations]);

  // Handle Save Shift Operational Notes
  const handleSaveOperationalNotes = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNotes(true);
    setMessage(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from('daily_operational_notes').upsert(
        {
          business_date: businessDate,
          complaints,
          work_orders: workOrders,
          requirements,
          operational_notes: operationalNotes,
          entered_by: user?.id || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'business_date' }
      );

      if (error) throw error;

      setLastSavedAt(new Date().toISOString());
      setEntryStatus((prev) => ({
        ...prev,
        handover: Boolean(
          complaints.trim() ||
            workOrders.trim() ||
            requirements.trim() ||
            operationalNotes.trim()
        ),
      }));
      setMessage({ type: 'success', text: t('operations.daily.saveSuccess') });
    } catch (err: any) {
      console.error('Error saving shift notes:', err);
      setMessage({ type: 'error', text: err.message || t('operations.daily.saveError') });
    } finally {
      setSavingNotes(false);
    }
  };

  const formattedDate = useMemo(() => {
    return formatDate(businessDate, 'short');
  }, [businessDate, formatDate]);

  const formattedPreviousDate = useMemo(() => {
    return formatDate(petpoojaReporting.previousDate, 'short');
  }, [petpoojaReporting.previousDate, formatDate]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Top Header & Business Date Controller */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-amber-600" />
            {t('operations.daily.title')}
          </h1>
          <p className="text-xs sm:text-sm text-stone-500 mt-0.5">
            {t('operations.daily.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Day Navigation */}
          <div className="flex items-center bg-white border border-stone-200 rounded-lg shadow-2xs p-0.5">
            <button
              type="button"
              onClick={() => setBusinessDate(getPreviousDate(businessDate))}
              className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
              title={t('operations.daily.prevDay')}
              aria-label={t('operations.daily.prevDay')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center px-2 py-1 text-xs font-semibold text-stone-800">
              <input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                className="bg-transparent focus:outline-none cursor-pointer text-xs font-semibold"
              />
            </div>
            <button
              type="button"
              onClick={() => setBusinessDate(getNextDate(businessDate))}
              className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
              title={t('operations.daily.nextDay')}
              aria-label={t('operations.daily.nextDay')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={loadAllDailyOperations}
            disabled={loading}
            className="h-8.5 px-2.5 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {message.text}
        </div>
      )}

      {/* =========================================================================
          SECTION 1: DAILY ENTRY STATUS BAR (One compact bar, no second checklist)
          ========================================================================= */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block px-0.5">
          {t('operations.daily.entryStatus.title')}
        </span>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {/* Attendance */}
          <Link
            href="/people/attendance"
            className="group flex items-center justify-between p-3 rounded-xl border border-stone-200/80 bg-white hover:border-amber-300 hover:shadow-xs transition-all"
          >
            <div className="space-y-0.5 min-w-0">
              <span className="text-xs font-medium text-stone-600 block truncate group-hover:text-stone-900">
                {t('operations.daily.entryStatus.attendance')}
              </span>
              <div className="flex items-center gap-1.5">
                {entryStatus.attendance ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                    <Check className="h-3 w-3 text-emerald-600" />
                    {t('operations.daily.entryStatus.marked')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                    {t('operations.daily.entryStatus.pending')}
                  </span>
                )}
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-stone-400 group-hover:text-amber-600 transition-colors shrink-0 ml-1.5" />
          </Link>

          {/* Store / Inventory */}
          <Link
            href="/inventory/issues"
            className="group flex items-center justify-between p-3 rounded-xl border border-stone-200/80 bg-white hover:border-amber-300 hover:shadow-xs transition-all"
          >
            <div className="space-y-0.5 min-w-0">
              <span className="text-xs font-medium text-stone-600 block truncate group-hover:text-stone-900">
                {t('operations.daily.entryStatus.store')}
              </span>
              <div className="flex items-center gap-1.5">
                {entryStatus.store ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                    <Check className="h-3 w-3 text-emerald-600" />
                    {t('operations.daily.entryStatus.updated')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                    {t('operations.daily.entryStatus.pending')}
                  </span>
                )}
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-stone-400 group-hover:text-amber-600 transition-colors shrink-0 ml-1.5" />
          </Link>

          {/* Utilities & Fuel */}
          <Link
            href="/finance/utilities"
            className="group flex items-center justify-between p-3 rounded-xl border border-stone-200/80 bg-white hover:border-amber-300 hover:shadow-xs transition-all"
          >
            <div className="space-y-0.5 min-w-0">
              <span className="text-xs font-medium text-stone-600 block truncate group-hover:text-stone-900">
                {t('operations.daily.entryStatus.utilities')}
              </span>
              <div className="flex items-center gap-1.5">
                {entryStatus.utilities ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                    <Check className="h-3 w-3 text-emerald-600" />
                    {t('operations.daily.entryStatus.logged')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                    {t('operations.daily.entryStatus.pending')}
                  </span>
                )}
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-stone-400 group-hover:text-amber-600 transition-colors shrink-0 ml-1.5" />
          </Link>

          {/* Shift Handover */}
          <a
            href="#shift-handover"
            className="group flex items-center justify-between p-3 rounded-xl border border-stone-200/80 bg-white hover:border-amber-300 hover:shadow-xs transition-all"
          >
            <div className="space-y-0.5 min-w-0">
              <span className="text-xs font-medium text-stone-600 block truncate group-hover:text-stone-900">
                {t('operations.daily.entryStatus.handover')}
              </span>
              <div className="flex items-center gap-1.5">
                {entryStatus.handover ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                    <Check className="h-3 w-3 text-emerald-600" />
                    {t('operations.daily.entryStatus.updated')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                    {t('operations.daily.entryStatus.pending')}
                  </span>
                )}
              </div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-stone-400 group-hover:text-amber-600 transition-colors shrink-0 ml-1.5" />
          </a>
        </div>
      </div>

      {/* =========================================================================
          SECTION 2: GATE TRAFFIC (Origin Prominence First, NO View Gate Link)
          ========================================================================= */}
      <Card className="border-stone-200/80 shadow-xs overflow-hidden">
        <CardHeader className="pb-3 border-b border-stone-100">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-stone-900">
            <Car className="h-4 w-4 text-amber-600" />
            {t('operations.daily.gate.title')}
          </CardTitle>
          <CardDescription className="text-xs text-stone-500">
            {t('operations.daily.gate.subtitle', { date: formattedDate })}
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-4 space-y-4">
          {/* Prominent Car Origins Display (State codes remain in English per Rule 6) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-800 uppercase tracking-wide">
                {t('operations.daily.gate.carOrigins')}
              </span>
              <span className="text-[11px] text-stone-400">
                {gateTraffic.cars} {t('operations.daily.gate.cars').toLowerCase()}
              </span>
            </div>

            {gateTraffic.origins.length === 0 ? (
              <div className="text-xs text-stone-400 py-3 text-center bg-stone-50/60 rounded-xl border border-dashed border-stone-200">
                {t('operations.daily.gate.noVehicles')}
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                {gateTraffic.origins.map(({ prefix, count }) => (
                  <div
                    key={prefix}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-stone-50 border border-stone-200/90 shadow-2xs hover:border-amber-300 transition-colors"
                  >
                    <span className="font-bold text-stone-950 text-xs tracking-tight">
                      {prefix}
                    </span>
                    <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-white border border-stone-200 text-xs font-black text-amber-700 min-w-[20px]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Compact Gate Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-3 border-t border-stone-100">
            <div className="bg-stone-50/70 p-2.5 rounded-xl border border-stone-200/60">
              <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block">
                {t('operations.daily.gate.visitors')}
              </span>
              <span className="text-xl font-black text-stone-900 block mt-0.5">
                {formatNumber(gateTraffic.visitors)}
              </span>
            </div>

            <div className="bg-stone-50/70 p-2.5 rounded-xl border border-stone-200/60">
              <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block">
                {t('operations.daily.gate.cars')}
              </span>
              <span className="text-xl font-black text-sky-700 block mt-0.5">
                {formatNumber(gateTraffic.cars)}
              </span>
            </div>

            <div className="bg-stone-50/70 p-2.5 rounded-xl border border-stone-200/60">
              <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block">
                {t('operations.daily.gate.bikes')}
              </span>
              <span className="text-xl font-black text-emerald-700 block mt-0.5">
                {formatNumber(gateTraffic.bikes)}
              </span>
            </div>

            <div className="bg-stone-50/70 p-2.5 rounded-xl border border-stone-200/60">
              <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block">
                {t('operations.daily.gate.totalVehicles')}
              </span>
              <span className="text-xl font-black text-stone-900 block mt-0.5">
                {formatNumber(gateTraffic.totalVehicles)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* =========================================================================
          SECTION 3: PETPOOJA REPORTING (Previous-Day Logic + Collapsible Calendar)
          ========================================================================= */}
      <Card className="border-stone-200/80 shadow-xs">
        <CardHeader className="pb-3 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-stone-900">
              <Receipt className="h-4 w-4 text-emerald-600" />
              {t('operations.daily.petpooja.title')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {t('operations.daily.petpooja.subtitle', { date: formattedPreviousDate })}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/finance/sales">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 h-8 font-semibold cursor-pointer"
              >
                <UploadCloud className="h-3.5 w-3.5 text-amber-700" />
                <span>{t('operations.daily.petpooja.uploadAction')}</span>
              </Button>
            </Link>
          </div>
        </CardHeader>

        <CardContent className="pt-4 space-y-4">
          {/* Previous-Day Operational Status Card */}
          <div className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <strong className="text-stone-900 text-xs sm:text-sm font-bold">
                  {t('operations.daily.petpooja.reportFor', { date: formattedPreviousDate })}
                </strong>
                {/* Status Badges */}
                {petpoojaReporting.status === 'uploaded' && (
                  <Badge variant="success" className="text-[11px] font-bold gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {t('operations.daily.petpooja.uploaded')}
                  </Badge>
                )}
                {petpoojaReporting.status === 'dueToday' && (
                  <Badge variant="warning" className="text-[11px] font-bold gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {t('operations.daily.petpooja.dueToday')}
                  </Badge>
                )}
                {petpoojaReporting.status === 'overdue' && (
                  <Badge variant="danger" className="text-[11px] font-bold gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {t('operations.daily.petpooja.overdue')}
                  </Badge>
                )}
                {petpoojaReporting.status === 'upcoming' && (
                  <Badge variant="outline" className="text-[11px] text-stone-500">
                    {t('operations.daily.petpooja.upcoming')}
                  </Badge>
                )}
              </div>

              <p className="text-xs text-stone-600">
                {petpoojaReporting.isFullyUploaded ? (
                  <span>
                    {t('operations.daily.petpooja.allUploaded')}
                    {petpoojaReporting.netSales > 0 && (
                      <span className="font-semibold text-stone-900 ml-1">
                        • {formatINR(petpoojaReporting.netSales)}
                      </span>
                    )}
                  </span>
                ) : (
                  <span>
                    {t('operations.daily.petpooja.reportsCount', {
                      count: petpoojaReporting.uploadedCount,
                    })}
                    {petpoojaReporting.missingTypes.length > 0 && (
                      <span className="text-stone-500 ml-1">
                        ({t('operations.daily.petpooja.missingReports', {
                          missing: petpoojaReporting.missingTypes.join(', '),
                        })})
                      </span>
                    )}
                  </span>
                )}
              </p>
            </div>

            <Link href="/finance/sales">
              <Button size="sm" variant="outline" className="h-7.5 text-xs text-stone-700 border-stone-300">
                <span>{t('operations.daily.petpooja.uploadAction')}</span>
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>

          {/* Collapsible Monthly Calendar Toggle Button */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setIsCalendarExpanded(!isCalendarExpanded)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-700 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Receipt className="h-3.5 w-3.5 text-stone-500" />
                <span>{t('operations.daily.petpooja.calendarToggle')}</span>
              </div>
              <div className="flex items-center gap-1 text-stone-400">
                <span className="text-[11px]">
                  {isCalendarExpanded
                    ? locale === 'hi'
                      ? 'छुपाएं'
                      : 'Hide'
                    : locale === 'hi'
                    ? 'देखें'
                    : 'Show'}
                </span>
                {isCalendarExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </button>
          </div>

          {/* Embedded Collapsible Monthly Completeness Calendar */}
          {isCalendarExpanded && (
            <div className="pt-2 animate-in fade-in duration-200">
              <MonthlyReportCalendar />
            </div>
          )}
        </CardContent>
      </Card>

      {/* =========================================================================
          SECTION 4: KEY STORE CONSUMPTION (Ranked Dynamically by Value)
          ========================================================================= */}
      <Card className="border-stone-200/80 shadow-xs">
        <CardHeader className="pb-3 border-b border-stone-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-stone-900">
              <Package className="h-4 w-4 text-amber-600" />
              {t('operations.daily.consumption.title')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {t('operations.daily.consumption.subtitle', { date: formattedDate })}
            </CardDescription>
          </div>

          <Link href="/inventory/issues">
            <Button variant="ghost" size="sm" className="text-xs text-amber-700 hover:text-amber-800 gap-1 h-7">
              <span>{t('operations.daily.consumption.viewStoreIssues')}</span>
              <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>

        <CardContent className="pt-3">
          {keyConsumption.length === 0 ? (
            <div className="text-xs text-stone-400 py-6 text-center bg-stone-50/50 rounded-xl border border-dashed border-stone-200">
              {t('operations.daily.consumption.noConsumption')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold text-[11px] uppercase tracking-wider">
                    <th className="pb-2.5 px-2">{t('operations.daily.consumption.colItem')}</th>
                    <th className="pb-2.5 px-2 text-right">{t('operations.daily.consumption.colQuantity')}</th>
                    <th className="pb-2.5 px-2 text-right">{t('operations.daily.consumption.colValue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {keyConsumption.slice(0, 8).map((item) => (
                    <tr key={item.itemId} className="hover:bg-stone-50/50 transition-colors">
                      <td className="py-2.5 px-2 font-semibold text-stone-900">
                        {item.name}
                      </td>
                      <td className="py-2.5 px-2 text-right text-stone-600 font-medium">
                        {formatNumber(item.quantity)} {item.unitSymbol}
                      </td>
                      <td className="py-2.5 px-2 text-right font-bold text-stone-900">
                        {formatINR(item.totalValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* =========================================================================
          SECTION 5: SHIFT HANDOVER & NOTES (Anchor: #shift-handover)
          ========================================================================= */}
      <Card id="shift-handover" className="border-stone-200/80 shadow-xs">
        <CardHeader className="pb-3 border-b border-stone-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-stone-900">
              <MessageSquareWarning className="h-4 w-4 text-indigo-600" />
              {t('operations.daily.shiftLog.title')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {t('operations.daily.shiftLog.subtitle')}
            </CardDescription>
          </div>
          {lastSavedAt && (
            <span className="text-[10px] text-stone-400">
              {t('operations.daily.lastSaved', {
                time: new Date(lastSavedAt).toLocaleTimeString(
                  locale === 'hi' ? 'hi-IN' : 'en-IN',
                  { hour: '2-digit', minute: '2-digit' }
                ),
              })}
            </span>
          )}
        </CardHeader>

        <CardContent className="pt-4">
          <form onSubmit={handleSaveOperationalNotes} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Complaints */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                  {t('operations.daily.shiftLog.complaints')}
                </label>
                <textarea
                  rows={3}
                  value={complaints}
                  onChange={(e) => setComplaints(e.target.value)}
                  placeholder={t('operations.daily.shiftLog.complaintsPlaceholder')}
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* Work Orders */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                  {t('operations.daily.shiftLog.workOrders')}
                </label>
                <textarea
                  rows={3}
                  value={workOrders}
                  onChange={(e) => setWorkOrders(e.target.value)}
                  placeholder={t('operations.daily.shiftLog.workOrdersPlaceholder')}
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* Requirements */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-500 inline-block" />
                  {t('operations.daily.shiftLog.requirements')}
                </label>
                <textarea
                  rows={3}
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder={t('operations.daily.shiftLog.requirementsPlaceholder')}
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* General Operational Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  {t('operations.daily.shiftLog.operationalNotes')}
                </label>
                <textarea
                  rows={3}
                  value={operationalNotes}
                  onChange={(e) => setOperationalNotes(e.target.value)}
                  placeholder={t('operations.daily.shiftLog.operationalNotesPlaceholder')}
                  className="w-full text-xs p-2.5 rounded-xl border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={savingNotes} className="gap-1.5 text-xs font-semibold cursor-pointer">
                <Save className="h-3.5 w-3.5" />
                {savingNotes ? t('operations.daily.saving') : t('operations.daily.saveAction')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
