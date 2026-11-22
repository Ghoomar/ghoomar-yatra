'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TimePicker } from '@/components/ui/TimePicker';
import { SimpleSelect } from '@/components/ui/Select';
import { formatDisplayDate } from '@/components/ui/DatePicker';
import { createClient } from '@/lib/supabase/client';
import { formatNumber, formatINR } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import {
  ElectricityBillReconciliation,
  DailyElectricityAllocation,
} from '@/lib/types/database';
import {
  Zap,
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  History,
  TrendingUp,
  Activity,
  Plus,
  ChevronDown,
  ChevronUp,
  FileText,
  ShieldCheck,
  Scale,
  Calendar,
  AlertTriangle,
  Trash2,
} from 'lucide-react';

interface ElectricityTabProps {
  businessDate: string;
  meters: any[];
  readings: any[];
  selectedMeterId: string;
  setSelectedMeterId: (id: string) => void;
  onRefresh: () => void;
  setMessage: (msg: { type: 'success' | 'error' | 'warning' | 'info'; text: string }) => void;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function getCurrentTimeHHMM(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function ElectricityTab({
  businessDate,
  meters,
  readings,
  selectedMeterId,
  setSelectedMeterId,
  onRefresh,
  setMessage,
}: ElectricityTabProps) {
  const supabase = createClient();
  const { t, locale } = useI18n();

  // Top sub-tab mode: 'readings' (meter readings log) or 'reconciliation' (monthly bill reconciliation)
  const [subTab, setSubTab] = useState<'readings' | 'reconciliation'>('readings');

  // Form & Input States for Readings
  const [newReading, setNewReading] = useState<string>('');
  const [readingTime, setReadingTime] = useState<string>(() => getCurrentTimeHHMM());
  const [isReset, setIsReset] = useState(false);
  const [notes, setNotes] = useState('');
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [costPerUnit, setCostPerUnit] = useState<number>(10.0);
  const [latestPriorReading, setLatestPriorReading] = useState<number | null>(null);
  const [latestPriorTimestamp, setLatestPriorTimestamp] = useState<string | null>(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);

  // Proportional Daily Allocation State for the active business date
  const [dailyAllocation, setDailyAllocation] = useState<DailyElectricityAllocation | null>(null);

  // Deletion Modal State
  const [deleteModalReading, setDeleteModalReading] = useState<any | null>(null);
  const [deletingReading, setDeletingReading] = useState(false);

  // Monthly Bill Reconciliations State
  const [bills, setBills] = useState<ElectricityBillReconciliation[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const [showAddBill, setShowAddBill] = useState(false);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [billSaving, setBillSaving] = useState(false);

  // New Bill Form States
  const [billMonth, setBillMonth] = useState('DEC-2026');
  const [billNumber, setBillNumber] = useState('');
  const [billingPeriodStart, setBillingPeriodStart] = useState('');
  const [billingPeriodEnd, setBillingPeriodEnd] = useState('');
  const [billedKvah, setBilledKvah] = useState('');
  const [energyCharges, setEnergyCharges] = useState('');
  const [demandCharges, setDemandCharges] = useState('');
  const [electricityDuty, setElectricityDuty] = useState('');
  const [fppaCharges, setFppaCharges] = useState('');
  const [otherCharges, setOtherCharges] = useState('');
  const [lpscCharges, setLpscCharges] = useState('');
  const [arrearsCharges, setArrearsCharges] = useState('');
  const [billNotes, setBillNotes] = useState('');

  const selectedMeter = meters.find((m) => m.id === selectedMeterId) || meters[0];
  const multiplier = Number(selectedMeter?.meter_multiplier) || 40;
  // Electricity display unit is strictly standardized to kVAh across the entire application
  const displayUnit = 'kVAh';

  // Auto-select first meter if not set
  useEffect(() => {
    if (meters.length > 0 && (!selectedMeterId || !meters.some((m) => m.id === selectedMeterId))) {
      setSelectedMeterId(meters[0].id);
    }
  }, [meters, selectedMeterId, setSelectedMeterId]);

  // 1. Fetch Configured Electricity Cost Rule
  useEffect(() => {
    const fetchCostRule = async () => {
      try {
        const { data } = await supabase
          .from('financial_cost_rules')
          .select('amount_or_rate')
          .eq('category', 'Utilities')
          .eq('calculation_method', 'meter_based')
          .eq('is_active', true)
          .maybeSingle();

        if (data?.amount_or_rate) {
          setCostPerUnit(Number(data.amount_or_rate));
        }
      } catch (err) {
        console.error('Failed to load electricity cost rule:', err);
      }
    };
    fetchCostRule();
  }, [supabase]);

  // 2. Fetch Timezone-Safe Chronological Predecessor Reading (Asia/Kolkata aware)
  useEffect(() => {
    const fetchBaseline = async () => {
      if (!selectedMeter?.id) return;
      setLoadingBaseline(true);
      try {
        const timePart = readingTime || '12:00';
        const istDateTimeStr = `${businessDate}T${timePart}:00+05:30`;
        const proposedTimestamp = new Date(istDateTimeStr).toISOString();

        const { data } = await supabase
          .from('meter_readings')
          .select('reading_value, reading_timestamp, business_date, is_reset')
          .eq('meter_id', selectedMeter.id)
          .lt('reading_timestamp', proposedTimestamp)
          .order('reading_timestamp', { ascending: false })
          .limit(1);

        if (data && data.length > 0) {
          setLatestPriorReading(Number(data[0].reading_value));
          setLatestPriorTimestamp(data[0].reading_timestamp || null);
        } else {
          setLatestPriorReading(null);
          setLatestPriorTimestamp(null);
        }
      } catch (err) {
        console.error('Failed to load meter baseline:', err);
      } finally {
        setLoadingBaseline(false);
      }
    };

    fetchBaseline();
  }, [selectedMeter?.id, businessDate, readingTime, readings, supabase]);

  // 3. Fetch Proportional Daily Allocation for Current Date
  const fetchDailyAllocation = async () => {
    try {
      const { data } = await supabase
        .from('daily_electricity_allocations')
        .select('*')
        .eq('business_date', businessDate)
        .maybeSingle();

      setDailyAllocation(data || null);
    } catch (err) {
      console.error('Failed to load daily allocation:', err);
    }
  };

  useEffect(() => {
    fetchDailyAllocation();
  }, [businessDate, readings]);

  // 4. Fetch Monthly Bill Reconciliations
  const fetchBills = async () => {
    setLoadingBills(true);
    try {
      const { data } = await supabase
        .from('electricity_bill_reconciliations')
        .select('*')
        .order('billing_period_start', { ascending: false });

      setBills(data || []);
    } catch (err) {
      console.error('Failed to load electricity bills:', err);
    } finally {
      setLoadingBills(false);
    }
  };

  useEffect(() => {
    fetchBills();
  }, []);

  const meterReadings = useMemo(() => {
    if (!selectedMeter?.id) return [];
    return readings.filter((r) => r.meter_id === selectedMeter.id);
  }, [readings, selectedMeter?.id]);

  // Consumption for Status Strip: Prioritize proportional daily allocated kVAh
  const displayDailyConsumption = dailyAllocation != null
    ? Number(dailyAllocation.daily_kvah) || 0
    : meterReadings.reduce((sum, r) => sum + (Number(r.delta_consumption) || 0), 0);

  const displayDailyCost = dailyAllocation?.operational_cost != null
    ? Number(dailyAllocation.operational_cost)
    : displayDailyConsumption * costPerUnit;

  const displayDailyRate = dailyAllocation?.effective_rate_per_kvah != null && dailyAllocation.cost_type === 'reconciled'
    ? Number(dailyAllocation.effective_rate_per_kvah)
    : costPerUnit;

  const isReconciledDay = dailyAllocation?.cost_type === 'reconciled';

  const todayIst = useMemo(() => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }, []);
  const isToday = businessDate === todayIst;

  const formattedPriorTime = useMemo(() => {
    if (!latestPriorTimestamp) return '';
    const d = new Date(latestPriorTimestamp);
    const priorDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);

    const timeStr = d.toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    if (priorDateStr === businessDate) {
      return timeStr;
    }

    const dateStr = d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
    });

    return `${dateStr}, ${timeStr}`;
  }, [latestPriorTimestamp, businessDate, locale]);

  const getPriorInfo = (r: any) => {
    const prevVal =
      r.previous_reading_value !== null && r.previous_reading_value !== undefined
        ? Number(r.previous_reading_value)
        : null;

    let priorTimeFormatted = '';
    let spanDays = 0;

    if (r.previous_reading_timestamp) {
      const prevD = new Date(r.previous_reading_timestamp);
      const currD = new Date(r.reading_timestamp);
      const prevDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(prevD);
      const currDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(currD);

      const pTime = prevD.toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      if (prevDateStr === currDateStr) {
        priorTimeFormatted = pTime;
      } else {
        const pDate = prevD.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
          timeZone: 'Asia/Kolkata',
          day: 'numeric',
          month: 'short',
        });
        priorTimeFormatted = `${pDate}, ${pTime}`;
      }

      const diffMs = currD.getTime() - prevD.getTime();
      spanDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    }

    const isBillAnchor = Boolean(
      r.notes &&
        (r.notes.toLowerCase().includes('uppcl') ||
          r.notes.toLowerCase().includes('reconciliation') ||
          r.notes.toLowerCase().includes('anchor'))
    );

    return { prevVal, priorTimeFormatted, spanDays, isBillAnchor };
  };

  const handleDeleteReading = async () => {
    if (!deleteModalReading?.id) return;
    setDeletingReading(true);
    try {
      const { error } = await supabase
        .from('meter_readings')
        .delete()
        .eq('id', deleteModalReading.id);

      if (error) throw error;

      setMessage({
        type: 'success',
        text: t('finance.utilities.readingDeleted') || 'Meter reading deleted successfully.',
      });
      setDeleteModalReading(null);
      onRefresh();
      fetchDailyAllocation();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to delete meter reading.' });
    } finally {
      setDeletingReading(false);
    }
  };

  // Preview Calculations for New Reading Input: Raw difference × Meter Multiplier (40)
  const parsedNewReading = parseFloat(newReading);
  const isInputValid = !isNaN(parsedNewReading) && parsedNewReading > 0;

  let previewConsumption = 0;
  let isLowerThanPrevious = false;

  if (isInputValid && latestPriorReading !== null) {
    if (isReset) {
      previewConsumption = 0;
    } else {
      const rawDiff = parsedNewReading - latestPriorReading;
      if (rawDiff < 0) {
        isLowerThanPrevious = true;
      } else {
        previewConsumption = rawDiff * multiplier;
      }
    }
  }

  // Auto-expand reset option if lower than prior reading
  useEffect(() => {
    if (isLowerThanPrevious) {
      setShowOptionalFields(true);
    }
  }, [isLowerThanPrevious]);

  const previewCost = previewConsumption * costPerUnit;

  const scrollToHistory = () => {
    const el = document.getElementById('electricity-history-ledger');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Submit New Meter Reading (Stores RAW REGISTER VALUE)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMeter?.id || !isInputValid) return;

    if (isLowerThanPrevious && !isReset) {
      alert(
        t('finance.utilities.alertLowerWithoutReset', {
          reading: parsedNewReading,
          prior: latestPriorReading,
          unit: displayUnit,
        }) ||
          `Invalid reading: ${parsedNewReading} < ${latestPriorReading} ${displayUnit}.\n\nIf the meter rolled over or was replaced, check "Meter Replaced / Rolled Over" to establish a new baseline.`
      );
      return;
    }

    setSaving(true);

    try {
      const timePart = readingTime || getCurrentTimeHHMM();
      const istDateTimeStr = `${businessDate}T${timePart}:00+05:30`;
      const readingTimestamp = new Date(istDateTimeStr).toISOString();

      const { error } = await supabase.from('meter_readings').insert({
        meter_id: selectedMeter.id,
        business_date: businessDate,
        reading_timestamp: readingTimestamp,
        reading_value: parsedNewReading, // Stored as raw register reading
        is_reset: isReset,
        notes: notes.trim() || null,
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text: t('finance.utilities.savedSuccess') || 'Meter reading logged successfully!',
      });

      setNewReading('');
      setIsReset(false);
      setNotes('');
      setShowOptionalFields(false);
      setReadingTime(getCurrentTimeHHMM());
      onRefresh();
      fetchDailyAllocation();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save reading.' });
    } finally {
      setSaving(false);
    }
  };

  // Live Bill Form Calculated Totals
  const parsedBilledKvah = parseFloat(billedKvah) || 0;
  const parsedEnergy = parseFloat(energyCharges) || 0;
  const parsedDemand = parseFloat(demandCharges) || 0;
  const parsedDuty = parseFloat(electricityDuty) || 0;
  const parsedFppa = parseFloat(fppaCharges) || 0;
  const parsedOther = parseFloat(otherCharges) || 0;
  const parsedLpsc = parseFloat(lpscCharges) || 0;
  const parsedArrears = parseFloat(arrearsCharges) || 0;

  const derivedOperationalCost = parsedEnergy + parsedDemand + parsedDuty + parsedFppa + parsedOther;
  const derivedBillAmount = derivedOperationalCost + parsedLpsc;
  const derivedPayableAmount = derivedBillAmount + parsedArrears;
  const derivedEffectiveRate = parsedBilledKvah > 0 ? derivedOperationalCost / parsedBilledKvah : 0;

  // Submit New Bill Reconciliation
  const handleSaveBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMeter?.id || parsedBilledKvah <= 0 || !billingPeriodStart || !billingPeriodEnd) {
      setMessage({ type: 'error', text: 'Please fill in all required billing fields.' });
      return;
    }

    setBillSaving(true);
    try {
      const { error } = await supabase.from('electricity_bill_reconciliations').insert({
        meter_id: selectedMeter.id,
        bill_month: billMonth.trim().toUpperCase(),
        bill_number: billNumber.trim() || null,
        billing_period_start: billingPeriodStart,
        billing_period_end: billingPeriodEnd,
        billed_kvah: parsedBilledKvah,
        energy_charges: parsedEnergy,
        demand_charges: parsedDemand,
        electricity_duty: parsedDuty,
        fppa_charges: parsedFppa,
        other_operational_charges: parsedOther,
        lpsc_charges: parsedLpsc,
        arrears_charges: parsedArrears,
        source_reference: billNumber ? `UPPCL Bill No: ${billNumber}` : null,
        notes: billNotes.trim() || null,
        status: 'RECONCILED',
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text: 'UPPCL Bill reconciliation recorded successfully!',
      });

      setShowAddBill(false);
      setBillNumber('');
      setBilledKvah('');
      setEnergyCharges('');
      setDemandCharges('');
      setElectricityDuty('');
      setFppaCharges('');
      setOtherCharges('');
      setLpscCharges('');
      setArrearsCharges('');
      setBillNotes('');
      fetchBills();
      fetchDailyAllocation();
      onRefresh();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save bill reconciliation.' });
    } finally {
      setBillSaving(false);
    }
  };

  // Reconciled Totals Across All Recorded Bills
  const totalReconciledKvah = bills.reduce((sum, b) => sum + Number(b.billed_kvah || 0), 0);
  const totalOperationalCost = bills.reduce((sum, b) => sum + Number(b.operational_bill_cost || 0), 0);
  const combinedEffectiveRate = totalReconciledKvah > 0 ? totalOperationalCost / totalReconciledKvah : 0;

  const meterOptions = useMemo(() => {
    return meters.map((m) => ({
      value: m.id,
      label: `${m.meter_name} (${displayUnit})`,
    }));
  }, [meters]);

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Sub-Navigation Switcher: Meter Readings vs Monthly Bill Reconciliation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-0.5">
        <div className="w-full sm:w-auto grid grid-cols-2 gap-1.5 p-1 bg-stone-100/90 rounded-xl border border-stone-200/80 shadow-2xs">
          <button
            type="button"
            onClick={() => setSubTab('readings')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              subTab === 'readings'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <span className="truncate">{t('finance.utilities.readingsTab') || 'Readings'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('reconciliation')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              subTab === 'reconciliation'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <FileText className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <span className="truncate">{t('finance.utilities.billsTab') || 'Monthly Bills'}</span>
            <Badge variant="success" className="text-[10px] py-0 px-1.5 shrink-0">
              {bills.length}
            </Badge>
          </button>
        </div>

        {/* Meter Info Pill */}
        <div className="hidden sm:flex items-center gap-2 text-xs text-stone-500 font-medium px-2 py-1 bg-white rounded-xl border border-stone-200">
          <span className="font-bold text-stone-800">{selectedMeter?.meter_name || 'Main Meter'}</span>
          <span>•</span>
          <span className="font-mono text-stone-600">No: {selectedMeter?.meter_number || 'AL0057395'}</span>
          <span>•</span>
          <span className="font-mono text-amber-700 font-bold">MF: ×{multiplier}</span>
        </div>
      </div>

      {subTab === 'readings' ? (
        <>
          {/* Single Full-Width Daily Summary Card */}
          <div className="bg-white rounded-2xl border border-stone-200/90 shadow-2xs p-3.5 sm:p-4">
            {/* Top row: Dynamic title + Plain-English status badge + Icon */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-stone-700 uppercase tracking-wide">
                  {isToday
                    ? (t('finance.utilities.todayUsage') || "Today's Usage")
                    : (t('finance.utilities.dailyUsage', { date: formatDisplayDate(businessDate, locale) }) || `Daily Usage · ${formatDisplayDate(businessDate, locale)}`)}
                </span>
                {dailyAllocation?.allocation_status === 'allocated' && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-stone-100 text-stone-700 border border-stone-200">
                    {t('finance.utilities.statusDailyAvg') || 'Daily Avg'}
                  </span>
                )}
                {dailyAllocation?.allocation_status === 'partial' && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                    {isToday
                      ? (t('finance.utilities.statusSoFarToday') || 'So far today')
                      : (t('finance.utilities.statusPartialDay') || 'Partial day')}
                  </span>
                )}
                {dailyAllocation?.allocation_status === 'measured' && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    {t('finance.utilities.statusExact') || 'Exact'}
                  </span>
                )}
                {isReconciledDay && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    {dailyAllocation?.bill_month
                      ? (t('finance.utilities.statusActualBill', { month: dailyAllocation.bill_month }) || `Actual Bill · ${dailyAllocation.bill_month}`)
                      : 'Actual Bill'}
                  </span>
                )}
              </div>
              <div className="p-1 rounded-md bg-amber-50 text-amber-700 shrink-0">
                <TrendingUp className="h-4 w-4" />
              </div>
            </div>

            {/* Main row: Big bold usage (1 decimal) on left, Daily cost + rate on right */}
            <div className="pt-2.5 flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <span className="text-2xl sm:text-3xl font-black font-mono text-amber-600 tracking-tight">
                  {displayDailyConsumption > 0
                    ? `${displayDailyConsumption.toFixed(1)} ${displayUnit}`
                    : `0.0 ${displayUnit}`}
                </span>
              </div>
              <div className="flex flex-col sm:items-end">
                <span className="text-lg sm:text-xl font-black font-mono text-stone-900">
                  {formatINR(displayDailyCost)}
                </span>
                <span className="text-xs text-stone-500 font-medium">
                  @{formatINR(displayDailyRate)}/{displayUnit}
                  {isReconciledDay && (
                    <span className="text-emerald-700 font-semibold ml-1">(Actual Bill)</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Main Form & Ledger Grid (Desktop 12 cols: 5 form / 7 ledger) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
            {/* Meter Reading Form */}
            <div className="lg:col-span-5 bg-white p-3.5 sm:p-4 rounded-2xl border border-stone-200/90 shadow-2xs flex flex-col justify-between">
              <form onSubmit={handleSubmit} className="space-y-3">
                {/* Card Header: Title + Optional Meter Picker */}
                <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-stone-900">
                    <Zap className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>{t('finance.utilities.meterReading') || 'Record Meter Reading'}</span>
                  </div>
                  {meters.length > 1 && (
                    <div className="w-48">
                      <SimpleSelect
                        value={selectedMeterId}
                        onChange={setSelectedMeterId}
                        options={meterOptions}
                        triggerClassName="h-8 text-xs py-1 px-2 border-stone-200 bg-stone-50 font-medium"
                      />
                    </div>
                  )}
                </div>

                {/* Row 1: Current Reading + Time */}
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-7">
                    <div className="flex items-center gap-1.5 mb-1">
                      <label className="block text-[11px] font-bold text-stone-700">
                        {t('finance.utilities.currentReading') || 'Meter Reading'}{' '}
                        <span className="text-rose-500">*</span>
                      </label>
                      <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-1 py-0.2 rounded border border-amber-200/80">
                        ×{multiplier}
                      </span>
                    </div>
                    <div className="relative rounded-xl">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        value={newReading}
                        onChange={(e) => setNewReading(e.target.value)}
                        placeholder={t('finance.utilities.enterReadingPlaceholder') || 'Enter reading'}
                        required
                        className={`w-full h-11 rounded-xl border p-2.5 font-bold font-mono text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none shadow-2xs transition-all ${
                          isLowerThanPrevious && !isReset
                            ? 'border-rose-400 bg-rose-50/30 focus:border-rose-500'
                            : 'border-stone-300 focus:border-amber-500 bg-white'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="col-span-5">
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-bold text-stone-700">
                        {t('finance.utilities.colTime') || 'Time'}
                      </label>
                      <button
                        type="button"
                        onClick={() => setReadingTime(getCurrentTimeHHMM())}
                        className="text-[10px] text-amber-700 font-bold hover:text-amber-900 cursor-pointer"
                      >
                        {t('common.datePicker.now') || 'Now'}
                      </button>
                    </div>
                    <TimePicker
                      value={readingTime}
                      onChange={setReadingTime}
                      hideIcon={true}
                      hideNow={true}
                      triggerClassName="h-11 rounded-xl text-xs py-1"
                    />
                  </div>
                </div>

                {/* Single concise helper line below input */}
                <div className="text-[11px] text-stone-500">
                  {latestPriorReading !== null ? (
                    <span>
                      {t('finance.utilities.lastReadingHelper', {
                        value: latestPriorReading.toFixed(2),
                        time: formattedPriorTime,
                      }) || `Last reading: ${latestPriorReading.toFixed(2)} (${formattedPriorTime})`}
                    </span>
                  ) : (
                    <span>{t('finance.utilities.noPriorReadingHelper') || 'No prior reading recorded'}</span>
                  )}
                </div>

                {/* Clean live result preview banner */}
                {isInputValid && latestPriorReading !== null && (
                  <div
                    className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all animate-in fade-in duration-150 ${
                      isLowerThanPrevious && !isReset
                        ? 'bg-rose-50 border-rose-200'
                        : 'bg-amber-50/70 border-amber-200/80'
                    }`}
                  >
                    {isLowerThanPrevious && !isReset ? (
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-700">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
                        <span>
                          {t('finance.utilities.readingLowerWarning', { reading: latestPriorReading.toFixed(2), unit: '' }) ||
                            `Reading is lower than prior (${latestPriorReading.toFixed(2)})`}
                        </span>
                      </div>
                    ) : (
                      <>
                        <span className="font-mono font-bold text-amber-900 text-sm">
                          {isReset
                            ? `0.0 ${displayUnit} (Reset)`
                            : `+${previewConsumption.toFixed(1)} ${displayUnit}`}
                        </span>
                        <span className="font-mono font-bold text-stone-900 text-xs">
                          {formatINR(previewCost)}
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* Progressive Disclosure Toggle for Optional Fields */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowOptionalFields(!showOptionalFields)}
                    className={`text-[11px] font-bold flex items-center gap-1 py-1 transition-colors cursor-pointer select-none ${
                      isLowerThanPrevious && !isReset ? 'text-rose-600 font-extrabold' : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    {showOptionalFields ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span>
                      {showOptionalFields
                        ? (t('finance.utilities.hideOptional') || 'Hide optional fields')
                        : isLowerThanPrevious && !isReset
                        ? (t('finance.utilities.meterResetRequired') || '+ Meter Reset / Rolled Over (Required for lower reading)')
                        : (t('finance.utilities.addNoteOrReset') || '+ Add note or meter reset')}
                    </span>
                  </button>

                  {showOptionalFields && (
                    <div className="pt-2 pb-1 space-y-2.5 animate-in fade-in duration-150">
                      {/* Meter Replaced / Rolled Over Checkbox */}
                      <div
                        className={`flex items-start gap-2 p-2 rounded-xl border ${
                          isLowerThanPrevious && !isReset
                            ? 'bg-amber-50/90 border-amber-300 ring-1 ring-amber-300'
                            : 'bg-stone-50/70 border-stone-200/80'
                        }`}
                      >
                        <input
                          type="checkbox"
                          id="isReset"
                          checked={isReset}
                          onChange={(e) => setIsReset(e.target.checked)}
                          className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer h-4 w-4"
                        />
                        <label htmlFor="isReset" className="text-xs text-stone-700 cursor-pointer select-none font-medium">
                          <span className="font-bold text-stone-900 block">
                            {t('finance.utilities.meterReset') || 'Meter Replaced / Rolled Over'}
                          </span>
                          <span className="text-[10px] text-stone-500 block">
                            {t('finance.utilities.meterResetDesc') || 'Establishes this reading as the new starting baseline (delta = 0).'}
                          </span>
                        </label>
                      </div>

                      {/* Notes input */}
                      <div>
                        <input
                          type="text"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder={t('finance.utilities.notesPlaceholder') || 'e.g. Evening shift closing reading'}
                          className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Primary Full-Width Save CTA */}
                <button
                  type="submit"
                  disabled={saving || (isLowerThanPrevious && !isReset)}
                  className="w-full h-11 rounded-xl font-bold text-xs sm:text-sm text-white bg-amber-600 hover:bg-amber-700 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>{t('finance.utilities.saving') || 'Saving Reading...'}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{t('finance.utilities.saveReading') || 'Save Reading'}</span>
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Activity Ledger (7 cols on lg:) */}
            <div
              id="electricity-history-ledger"
              className="lg:col-span-7 bg-white rounded-2xl border border-stone-200/90 shadow-2xs overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="px-3.5 sm:px-4 py-3 border-b border-stone-100 flex items-center justify-between">
                <div>
                  <div className="font-bold text-xs sm:text-sm text-stone-900">
                    {t('finance.utilities.historyTitle', { date: formatDisplayDate(businessDate, locale) }) ||
                      `Readings Log — ${formatDisplayDate(businessDate, locale)}`}
                  </div>
                  <div className="text-[11px] text-stone-400">
                    {meterReadings.length === 1
                      ? (t('finance.utilities.entryRecorded') || '1 entry recorded')
                      : (t('finance.utilities.entriesRecorded', { count: meterReadings.length }) || `${meterReadings.length} entries recorded`)}
                  </div>
                </div>
                <Badge variant={meterReadings.length > 0 ? 'success' : 'outline'} className="text-[10px]">
                  {meterReadings.length}
                </Badge>
              </div>

              <div className="flex-1">
                {meterReadings.length === 0 ? (
                  <div className="py-8 px-4 text-center text-stone-400 text-xs space-y-1.5">
                    <History className="h-7 w-7 mx-auto text-stone-300" />
                    <div className="font-semibold text-stone-600">
                      {t('finance.utilities.noReadings', { date: formatDisplayDate(businessDate, locale) }) ||
                        `No readings logged for ${formatDisplayDate(businessDate, locale)} yet.`}
                    </div>
                    <div className="text-[11px] text-stone-400">
                      {t('finance.utilities.noReadingsSub') || "Record your first meter reading to start today's log."}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Mobile View: Scannable Rows */}
                    <div className="divide-y divide-stone-100 md:hidden">
                      {meterReadings.map((r) => {
                        const { prevVal, priorTimeFormatted, spanDays, isBillAnchor } = getPriorInfo(r);
                        const readingVal = Number(r.reading_value);
                        const deltaVal = Number(r.delta_consumption || 0);
                        const costVal = deltaVal * costPerUnit;
                        const timeFormatted = new Date(r.reading_timestamp).toLocaleTimeString(
                          locale === 'hi' ? 'hi-IN' : 'en-IN',
                          { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }
                        );

                        return (
                          <div key={r.id} className="p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-xs text-stone-900 flex items-center gap-1.5">
                                  <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                  {timeFormatted}
                                </span>
                                {isBillAnchor && (
                                  <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                    {t('finance.utilities.billClosingAnchor') || 'Bill closing anchor'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-xs text-stone-900">
                                  {formatINR(costVal)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setDeleteModalReading(r)}
                                  className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title={t('finance.utilities.deleteReading') || 'Delete reading'}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>

                            <div className="flex items-baseline justify-between text-xs">
                              <div>
                                <span className="text-[11px] text-stone-400 mr-1.5">{t('finance.utilities.readingLabel') || 'Reading'}:</span>
                                <span className="font-mono font-black text-stone-900 text-sm">
                                  {readingVal.toFixed(2)}
                                </span>
                              </div>
                              <div>
                                {r.is_reset ? (
                                  <Badge variant="info" className="text-[10px] font-semibold">
                                    RESET
                                  </Badge>
                                ) : (
                                  <span className="font-mono font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60 text-xs">
                                    +{deltaVal.toFixed(1)} {displayUnit}
                                  </span>
                                )}
                              </div>
                            </div>

                            {prevVal !== null && (
                              <div className="text-[11px] text-stone-500 flex items-center gap-1.5 flex-wrap pt-0.5">
                                <span>
                                  {priorTimeFormatted
                                    ? (t('finance.utilities.fromPrior', { value: prevVal.toFixed(2), time: priorTimeFormatted }) || `From ${prevVal.toFixed(2)} (${priorTimeFormatted})`)
                                    : `${t('finance.utilities.colPrior') || 'Prior'}: ${prevVal.toFixed(2)}`}
                                </span>
                                {spanDays >= 2 && (
                                  <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-stone-100 text-stone-600 border border-stone-200">
                                    {t('finance.utilities.daySpan', { count: spanDays }) || `${spanDays}-day span`}
                                  </span>
                                )}
                              </div>
                            )}

                            {r.notes && (
                              <div className="text-[11px] text-stone-500 italic break-words line-clamp-2 pt-0.5">
                                {r.notes}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop View: Responsive Table */}
                    <div className="hidden md:block overflow-x-auto text-xs">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                            <th className="py-2.5 px-3">{t('finance.utilities.colTime') || 'Time'}</th>
                            <th className="py-2.5 px-3 text-right">{t('finance.utilities.colPrior') || 'Prior'}</th>
                            <th className="py-2.5 px-3 text-right">{t('finance.utilities.readingLabel') || 'Reading'}</th>
                            <th className="py-2.5 px-3 text-right">{t('finance.utilities.colDelta') || 'Delta'}</th>
                            <th className="py-2.5 px-3 text-right">{t('finance.utilities.colCost') || 'Cost'}</th>
                            <th className="py-2.5 px-3">{t('finance.utilities.colNotes') || 'Notes'}</th>
                            <th className="py-2.5 px-3 text-center w-10"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {meterReadings.map((r) => {
                            const { prevVal, priorTimeFormatted, spanDays, isBillAnchor } = getPriorInfo(r);
                            const readingVal = Number(r.reading_value);
                            const deltaVal = Number(r.delta_consumption || 0);
                            const costVal = deltaVal * costPerUnit;
                            const timeFormatted = new Date(r.reading_timestamp).toLocaleTimeString(
                              locale === 'hi' ? 'hi-IN' : 'en-IN',
                              { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }
                            );

                            return (
                              <tr key={r.id} className="hover:bg-stone-50/80 transition-colors">
                                <td className="py-2 px-3 text-stone-700 whitespace-nowrap font-medium">
                                  <div className="flex items-center gap-1.5">
                                    <span>{timeFormatted}</span>
                                    {isBillAnchor && (
                                      <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                        {t('finance.utilities.billClosingAnchor') || 'Bill anchor'}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-stone-500">
                                  {prevVal !== null ? (
                                    <div className="flex flex-col items-end">
                                      <span>{prevVal.toFixed(2)}</span>
                                      {priorTimeFormatted && (
                                        <span className="text-[10px] text-stone-400">({priorTimeFormatted})</span>
                                      )}
                                      {spanDays >= 2 && (
                                        <span className="text-[9px] text-amber-700 font-sans font-semibold">
                                          {t('finance.utilities.daySpan', { count: spanDays }) || `${spanDays}-day span`}
                                        </span>
                                      )}
                                    </div>
                                  ) : '—'}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-stone-900">
                                  {readingVal.toFixed(2)}
                                  {r.is_reset && (
                                    <span className="ml-1.5 text-[9px] bg-sky-100 text-sky-800 px-1 py-0.2 rounded font-sans font-semibold">
                                      RESET
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right font-bold text-amber-700 font-mono">
                                  {r.is_reset ? (
                                    <span className="text-sky-700 font-normal">{t('common.actions.reset') || 'Reset'}</span>
                                  ) : deltaVal > 0 ? (
                                    `+${deltaVal.toFixed(1)} ${displayUnit}`
                                  ) : (
                                    `0.0 ${displayUnit}`
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right font-bold text-stone-900 font-mono">
                                  {formatINR(costVal)}
                                </td>
                                <td className="py-2 px-3 text-stone-500 max-w-xs break-words line-clamp-2">
                                  {r.notes || '—'}
                                </td>
                                <td className="py-2 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => setDeleteModalReading(r)}
                                    className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                    title={t('finance.utilities.deleteReading') || 'Delete reading'}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
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
        </>
      ) : (
        /* Monthly Bill Reconciliation Tab */
        <div className="space-y-3 sm:space-y-4">
          {/* Summary KPI Cards across all reconciled bills */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            <div className="bg-white p-3 sm:p-3.5 rounded-2xl border border-stone-200/90 shadow-2xs">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide block">
                {t('finance.utilities.totalReconciledUnits') || 'Total Reconciled Units'}
              </span>
              <span className="text-lg sm:text-2xl font-black font-mono text-stone-900 mt-1 block">
                {formatNumber(totalReconciledKvah)} {displayUnit}
              </span>
            </div>

            <div className="bg-white p-3 sm:p-3.5 rounded-2xl border border-stone-200/90 shadow-2xs">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide block">
                {t('finance.utilities.totalOperationalCost') || 'Total Operational Cost'}
              </span>
              <span className="text-lg sm:text-2xl font-black font-mono text-amber-700 mt-1 block">
                {formatINR(totalOperationalCost)}
              </span>
            </div>

            <div className="bg-white p-3 sm:p-3.5 rounded-2xl border border-stone-200/90 shadow-2xs">
              <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide block">
                {t('finance.utilities.combinedEffectiveRate') || 'Combined Effective Rate'}
              </span>
              <span className="text-lg sm:text-2xl font-black font-mono text-stone-900 mt-1 block">
                {formatINR(combinedEffectiveRate)}/{displayUnit}
              </span>
            </div>

            <div className="bg-white p-3 sm:p-3.5 rounded-2xl border border-stone-200/90 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide block">
                  {t('finance.utilities.reconciledBills') || 'Reconciled Bills'}
                </span>
                <span className="text-lg sm:text-2xl font-black font-mono text-emerald-700 mt-1 block">
                  {bills.length} Periods
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddBill(!showAddBill)}
                className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{showAddBill ? 'Cancel' : (t('finance.utilities.reconcileBill') || 'Reconcile Bill')}</span>
              </button>
            </div>
          </div>

          {/* Collapsible "+ Reconcile UPPCL Bill" Form */}
          {showAddBill && (
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-amber-200 shadow-xs space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-amber-600" />
                  <h3 className="font-bold text-sm text-stone-900">
                    {t('finance.utilities.reconcileBill') || 'Reconcile UPPCL Monthly Bill'}
                  </h3>
                </div>
                <span className="text-xs text-stone-500 font-mono">
                  Meter: {selectedMeter?.meter_number || 'AL0057395'}
                </span>
              </div>

              <form onSubmit={handleSaveBill} className="space-y-4">
                {/* Row 1: Bill Month, Bill No, Period Start, Period End */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      {t('finance.utilities.billMonth') || 'Bill Month'} <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={billMonth}
                      onChange={(e) => setBillMonth(e.target.value)}
                      placeholder="e.g. DEC-2026"
                      required
                      className="w-full h-10 rounded-xl border border-stone-300 px-3 text-xs font-bold uppercase text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      {t('finance.utilities.billNumber') || 'Bill Number'}
                    </label>
                    <input
                      type="text"
                      value={billNumber}
                      onChange={(e) => setBillNumber(e.target.value)}
                      placeholder="e.g. 915-xxx-xxx-xxx"
                      className="w-full h-10 rounded-xl border border-stone-300 px-3 text-xs font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Period Start <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={billingPeriodStart}
                      onChange={(e) => setBillingPeriodStart(e.target.value)}
                      required
                      className="w-full h-10 rounded-xl border border-stone-300 px-3 text-xs font-medium text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">
                      Period End <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={billingPeriodEnd}
                      onChange={(e) => setBillingPeriodEnd(e.target.value)}
                      required
                      className="w-full h-10 rounded-xl border border-stone-300 px-3 text-xs font-medium text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                    />
                  </div>
                </div>

                {/* Row 2: Billed Units & Eligible Operational Charges */}
                <div className="bg-stone-50/70 p-3.5 rounded-xl border border-stone-200/80 space-y-3">
                  <span className="text-[11px] font-bold text-stone-600 uppercase tracking-wide block">
                    {t('finance.utilities.eligibleCharges') || 'Eligible Operational Charges (Allocated to Daily P&L)'}
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        Billed kVAh <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={billedKvah}
                        onChange={(e) => setBilledKvah(e.target.value)}
                        placeholder="e.g. 8118.40"
                        required
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs font-bold font-mono text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        Energy (₹) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={energyCharges}
                        onChange={(e) => setEnergyCharges(e.target.value)}
                        placeholder="62675.72"
                        required
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs font-mono text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        Demand (₹) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={demandCharges}
                        onChange={(e) => setDemandCharges(e.target.value)}
                        placeholder="13668.75"
                        required
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs font-mono text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        Duty (₹) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={electricityDuty}
                        onChange={(e) => setElectricityDuty(e.target.value)}
                        placeholder="5200.78"
                        required
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs font-mono text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        FPPA (₹ / ±)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={fppaCharges}
                        onChange={(e) => setFppaCharges(e.target.value)}
                        placeholder="-7000.79"
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs font-mono text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        Other (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={otherCharges}
                        onChange={(e) => setOtherCharges(e.target.value)}
                        placeholder="0.00"
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs font-mono text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Row 3: Non-Operational Charges */}
                <div className="bg-stone-50/70 p-3.5 rounded-xl border border-stone-200/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-stone-600 uppercase tracking-wide">
                      {t('finance.utilities.nonOperationalCharges') || 'Non-Operational Charges (Excluded from P&L)'}
                    </span>
                    <span className="text-[10px] text-stone-400">
                      {t('finance.utilities.lpscExcludedNote') || 'LPSC is excluded from operational cost'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        Current LPSC / Surcharge (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={lpscCharges}
                        onChange={(e) => setLpscCharges(e.target.value)}
                        placeholder="e.g. 175.21"
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs font-mono text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-stone-700 mb-1">
                        Arrears / Previous Dues (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={arrearsCharges}
                        onChange={(e) => setArrearsCharges(e.target.value)}
                        placeholder="0.00"
                        className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs font-mono text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Live Real-time Derivation Strip */}
                <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] text-stone-500 font-semibold block">Operational Cost (P&L)</span>
                    <span className="font-mono font-black text-amber-800 text-sm">{formatINR(derivedOperationalCost)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-500 font-semibold block">Effective Rate (₹/kVAh)</span>
                    <span className="font-mono font-black text-stone-900 text-sm">₹{derivedEffectiveRate.toFixed(4)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-500 font-semibold block">Current Bill Amount</span>
                    <span className="font-mono font-bold text-stone-900 text-sm">{formatINR(derivedBillAmount)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-500 font-semibold block">Final Payable Amount</span>
                    <span className="font-mono font-bold text-stone-900 text-sm">{formatINR(derivedPayableAmount)}</span>
                  </div>
                </div>

                {/* Notes & Actions */}
                <div>
                  <input
                    type="text"
                    value={billNotes}
                    onChange={(e) => setBillNotes(e.target.value)}
                    placeholder="Notes, receipt numbers, cheque details..."
                    className="w-full h-9 rounded-xl border border-stone-300 px-2.5 text-xs text-stone-900 bg-white"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddBill(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={billSaving || parsedBilledKvah <= 0}
                    className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                  >
                    {billSaving ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>{t('finance.utilities.savingBill') || 'Saving Bill...'}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{t('finance.utilities.saveBillReconciliation') || 'Save Bill Reconciliation'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Reconciled Bills Ledger Table */}
          <div className="bg-white rounded-2xl border border-stone-200/90 shadow-2xs overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-stone-900">
                  {t('finance.utilities.billReconciliation') || 'Monthly UPPCL Bill Reconciliation Ledger'}
                </h3>
                <p className="text-[11px] text-stone-400">
                  Official utility bills reconciled with proportional daily ledger consumption
                </p>
              </div>
              <Badge variant="success" className="text-[10px]">
                {bills.length} Verified
              </Badge>
            </div>

            <div className="overflow-x-auto text-xs">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                    <th className="py-2.5 px-3">{t('finance.utilities.billMonth') || 'Month'}</th>
                    <th className="py-2.5 px-3">{t('finance.utilities.billingPeriod') || 'Billing Period'}</th>
                    <th className="py-2.5 px-3 text-right">{t('finance.utilities.billedKvah') || 'Billed kVAh'}</th>
                    <th className="py-2.5 px-3 text-right">{t('finance.utilities.operationalBillCost') || 'Operational Cost'}</th>
                    <th className="py-2.5 px-3 text-right">{t('finance.utilities.effectiveRate') || 'Effective Rate'}</th>
                    <th className="py-2.5 px-3 text-right">{t('finance.utilities.variance') || 'Est. Variance'}</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3 text-center">Breakdown</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {loadingBills ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-stone-400">
                        Loading bills...
                      </td>
                    </tr>
                  ) : bills.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-stone-400">
                        No monthly bills reconciled yet. Click &quot;Reconcile Bill&quot; to add one.
                      </td>
                    </tr>
                  ) : (
                    bills.map((b) => {
                      const isExpanded = expandedBillId === b.id;
                      const billedVal = Number(b.billed_kvah);
                      const opCostVal = Number(b.operational_bill_cost);
                      const estimatedAt10 = billedVal * 10.0;
                      const variance = opCostVal - estimatedAt10;
                      const effRate = Number(b.effective_rate_per_kvah);

                      return (
                        <React.Fragment key={b.id}>
                          <tr className="hover:bg-stone-50/80 transition-colors">
                            <td className="py-3 px-3 font-bold text-stone-900 font-mono">
                              {b.bill_month}
                            </td>
                            <td className="py-3 px-3 text-stone-600 font-medium">
                              {new Date(b.billing_period_start).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
                                timeZone: 'Asia/Kolkata',
                                day: 'numeric',
                                month: 'short',
                              })}{' '}
                              –{' '}
                              {new Date(b.billing_period_end).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
                                timeZone: 'Asia/Kolkata',
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-stone-900">
                              {formatNumber(billedVal)} {displayUnit}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-amber-800">
                              {formatINR(opCostVal)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-stone-700">
                              ₹{effRate.toFixed(4)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-semibold">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[11px] ${
                                  variance <= 0
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                                }`}
                              >
                                {variance > 0 ? `+${formatINR(variance)}` : formatINR(variance)}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-center">
                              <Badge variant="success" className="text-[10px]">
                                {b.status}
                              </Badge>
                            </td>
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => setExpandedBillId(isExpanded ? null : b.id)}
                                className="p-1 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
                                aria-label="Toggle details"
                              >
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>
                            </td>
                          </tr>

                          {/* Expandable Breakdown Drawer */}
                          {isExpanded && (
                            <tr className="bg-stone-50/70 border-b border-stone-200">
                              <td colSpan={8} className="p-4">
                                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
                                  <div className="p-2 bg-white rounded-xl border border-stone-200">
                                    <span className="text-[10px] text-stone-400 font-semibold block">Energy Charges</span>
                                    <span className="font-mono font-bold text-stone-800">{formatINR(Number(b.energy_charges))}</span>
                                  </div>
                                  <div className="p-2 bg-white rounded-xl border border-stone-200">
                                    <span className="text-[10px] text-stone-400 font-semibold block">Demand Charges</span>
                                    <span className="font-mono font-bold text-stone-800">{formatINR(Number(b.demand_charges))}</span>
                                  </div>
                                  <div className="p-2 bg-white rounded-xl border border-stone-200">
                                    <span className="text-[10px] text-stone-400 font-semibold block">Electricity Duty</span>
                                    <span className="font-mono font-bold text-stone-800">{formatINR(Number(b.electricity_duty))}</span>
                                  </div>
                                  <div className="p-2 bg-white rounded-xl border border-stone-200">
                                    <span className="text-[10px] text-stone-400 font-semibold block">FPPA Adjustment</span>
                                    <span className="font-mono font-bold text-emerald-700">{formatINR(Number(b.fppa_charges))}</span>
                                  </div>
                                  <div className="p-2 bg-white rounded-xl border border-stone-200">
                                    <span className="text-[10px] text-stone-400 font-semibold block">LPSC (Excluded)</span>
                                    <span className="font-mono font-bold text-stone-600">{formatINR(Number(b.lpsc_charges))}</span>
                                  </div>
                                  <div className="p-2 bg-white rounded-xl border border-stone-200">
                                    <span className="text-[10px] text-stone-400 font-semibold block">Current Bill Amount</span>
                                    <span className="font-mono font-bold text-stone-900">{formatINR(Number(b.current_bill_amount))}</span>
                                  </div>
                                </div>
                                {b.notes && (
                                  <div className="mt-2 text-[11px] text-stone-500 italic">
                                    Note: {b.notes}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Delete Meter Reading Confirmation Modal */}
      {deleteModalReading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-md w-full p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
              <div className="flex items-center gap-2 text-rose-600">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <h3 className="font-bold text-sm text-stone-900">
                  {t('finance.utilities.deleteReadingTitle') || 'Delete Meter Reading'}
                </h3>
              </div>
            </div>

            <div className="space-y-3 text-xs text-stone-600">
              <p>
                {t('finance.utilities.deleteReadingConfirm', {
                  value: Number(deleteModalReading.reading_value).toFixed(2),
                  time: new Date(deleteModalReading.reading_timestamp).toLocaleTimeString(
                    locale === 'hi' ? 'hi-IN' : 'en-IN',
                    { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }
                  ),
                }) ||
                  `Are you sure you want to delete the reading of ${Number(deleteModalReading.reading_value).toFixed(2)}?`}
              </p>

              {deleteModalReading.notes &&
                (deleteModalReading.notes.toLowerCase().includes('uppcl') ||
                  deleteModalReading.notes.toLowerCase().includes('reconciliation') ||
                  deleteModalReading.notes.toLowerCase().includes('anchor')) && (
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                    <span>
                      {t('finance.utilities.deleteAnchorWarning') ||
                        'Warning: This reading is an official monthly bill reconciliation anchor. Deleting it will affect reconciled consumption figures.'}
                    </span>
                  </div>
                )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                disabled={deletingReading}
                onClick={() => setDeleteModalReading(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors cursor-pointer disabled:opacity-50"
              >
                {t('common.actions.cancel') || 'Cancel'}
              </button>
              <button
                type="button"
                disabled={deletingReading}
                onClick={handleDeleteReading}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
              >
                {deletingReading ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>{t('finance.utilities.deleting') || 'Deleting...'}</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{t('finance.utilities.deleteAction') || 'Delete Reading'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
