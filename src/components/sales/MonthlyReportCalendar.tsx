'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';
import { getTodayBusinessDate, formatINR } from '@/lib/utils';
import { SalesImportBatch } from '@/lib/types/sales';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  FileSpreadsheet,
} from 'lucide-react';
import {
  DAILY_REPORT_CONFIG,
  DailyReportTypeKey,
  ReportStatus,
  evaluatePetpoojaReportStatus,
} from '@/lib/sales/petpooja-completeness';

export { DAILY_REPORT_CONFIG };
export type { DailyReportTypeKey, ReportStatus };

export interface DayReportStatus {
  key: DailyReportTypeKey;
  labelKey: string;
  fullTitleKey: string;
  status: ReportStatus;
  batch?: SalesImportBatch;
}

export interface DayCalendarData {
  dayNumber: number;
  dateStr: string;
  isToday: boolean;
  isFuture: boolean;
  isComplete: boolean;
  importedCount: number;
  reports: DayReportStatus[];
}

interface MonthlyReportCalendarProps {
  refreshKey?: number;
  onSelectDateToUpload?: (dateStr: string) => void;
}

export function MonthlyReportCalendar({ refreshKey = 0 }: MonthlyReportCalendarProps) {
  const { t, locale } = useI18n();
  const todayStr = useMemo(() => getTodayBusinessDate(), []);

  // Initialize to current month (YYYY-MM)
  const [currentMonth, setCurrentMonth] = useState<string>(() => {
    return todayStr.substring(0, 7);
  });

  const [batches, setBatches] = useState<SalesImportBatch[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedDay, setSelectedDay] = useState<DayCalendarData | null>(null);

  // Load batches for selected month
  const loadMonthBatches = useCallback(async (monthStr: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/sales/import?month=${monthStr}`);
      const data = await res.json();
      if (res.ok) {
        setBatches(data.batches || []);
      }
    } catch (err) {
      console.error('Failed to load month batches:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMonthBatches(currentMonth);
  }, [currentMonth, refreshKey, loadMonthBatches]);

  // Month navigation handlers
  const handlePrevMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevY = prevDate.getFullYear();
    const prevM = String(prevDate.getMonth() + 1).padStart(2, '0');
    setCurrentMonth(`${prevY}-${prevM}`);
  };

  const handleNextMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const nextDate = new Date(y, m, 1);
    const nextY = nextDate.getFullYear();
    const nextM = String(nextDate.getMonth() + 1).padStart(2, '0');
    setCurrentMonth(`${nextY}-${nextM}`);
  };

  // Parse current month coordinates
  const { year, monthNumber, daysInMonth, startOffset, monthLabel } = useMemo(() => {
    const [y, m] = currentMonth.split('-').map(Number);
    const dInM = new Date(y, m, 0).getDate();
    // Monday = 0, Tuesday = 1, ..., Sunday = 6
    const firstDayJs = new Date(y, m - 1, 1).getDay();
    const offset = firstDayJs === 0 ? 6 : firstDayJs - 1;

    // Localized month label
    const dateObj = new Date(y, m - 1, 1);
    const label = dateObj.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-US', {
      month: 'long',
      year: 'numeric',
    });

    return {
      year: y,
      monthNumber: m,
      daysInMonth: dInM,
      startOffset: offset,
      monthLabel: label,
    };
  }, [currentMonth, locale]);

  // Index batches by `${business_date}|${report_type}`
  const batchMap = useMemo(() => {
    const map = new Map<string, SalesImportBatch>();
    batches.forEach((b) => {
      if (b.business_date && b.report_type) {
        // Keep the latest or first
        map.set(`${b.business_date}|${b.report_type}`, b);
      }
    });
    return map;
  }, [batches]);

  // Construct calendar days matrix
  const { days, totalImportedReports, totalExpectedReports, totalCompleteDays, expectedDaysCount } = useMemo(() => {
    const dayList: DayCalendarData[] = [];
    let importedTotal = 0;
    let completeTotal = 0;
    let expectedDays = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(monthNumber).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;

      // Extract imported report types for this date from the batchMap
      const importedTypes = DAILY_REPORT_CONFIG
        .map((c) => c.key)
        .filter((key) => batchMap.has(`${dateStr}|${key}`));

      // Authoritative evaluation via shared helper
      const evaluation = evaluatePetpoojaReportStatus(dateStr, importedTypes, todayStr);

      if (!evaluation.isFuture) {
        expectedDays += 1;
      }

      importedTotal += evaluation.importedCount;

      const reportStatuses: DayReportStatus[] = DAILY_REPORT_CONFIG.map((cfg) => {
        const batch = batchMap.get(`${dateStr}|${cfg.key}`);
        const reportEval = evaluation.reports[cfg.key];

        return {
          key: cfg.key,
          labelKey: cfg.labelKey,
          fullTitleKey: cfg.fullTitleKey,
          status: reportEval.status,
          batch,
        };
      });

      if (evaluation.isComplete && !evaluation.isFuture) {
        completeTotal += 1;
      }

      dayList.push({
        dayNumber: d,
        dateStr,
        isToday,
        isFuture: evaluation.isFuture,
        isComplete: evaluation.isComplete,
        importedCount: evaluation.importedCount,
        reports: reportStatuses,
      });
    }

    return {
      days: dayList,
      totalImportedReports: importedTotal,
      totalExpectedReports: expectedDays * DAILY_REPORT_CONFIG.length,
      totalCompleteDays: completeTotal,
      expectedDaysCount: expectedDays,
    };
  }, [year, monthNumber, daysInMonth, todayStr, batchMap]);

  // Weekday column labels (Mon .. Sun)
  const weekdays = [
    t('finance.sales.import.weekdays.mon'),
    t('finance.sales.import.weekdays.tue'),
    t('finance.sales.import.weekdays.wed'),
    t('finance.sales.import.weekdays.thu'),
    t('finance.sales.import.weekdays.fri'),
    t('finance.sales.import.weekdays.sat'),
    t('finance.sales.import.weekdays.sun'),
  ];

  return (
    <Card className="border-stone-200 shadow-xs overflow-hidden">
      {/* 1. Header with Title & Legend */}
      <CardHeader className="pb-3 border-b border-stone-100 bg-stone-50/50">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <CardTitle className="text-base font-bold text-stone-900 flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-amber-600" />
              {t('finance.sales.import.calendarTitle')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500 mt-0.5">
              {t('finance.sales.import.calendarSubtitle')}
            </CardDescription>
          </div>

          {/* Compact Legend */}
          <div className="flex items-center gap-3 text-xs shrink-0 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-stone-700 font-medium">
              <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-100" />
              <span>{t('finance.sales.import.legendImported')}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-stone-700 font-medium">
              <span className="h-2 w-2 rounded-full bg-rose-500 ring-2 ring-rose-100" />
              <span>{t('finance.sales.import.legendPending')}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-stone-500 font-medium">
              <span className="h-2 w-2 rounded-full bg-stone-300" />
              <span>{t('finance.sales.import.legendNotApplicable')}</span>
            </span>
          </div>
        </div>

        {/* 2. Month Navigation & Summary Counters Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 mt-1 border-t border-stone-200/60">
          {/* Month Navigator */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrevMonth}
              className="h-8 px-2 text-xs font-semibold gap-1 text-stone-700 border-stone-300 hover:bg-stone-100"
              title={t('finance.sales.import.prevMonth')}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('finance.sales.import.prevMonth')}</span>
            </Button>

            <span className="min-w-[130px] sm:min-w-[150px] text-center font-black text-sm sm:text-base text-stone-900 capitalize tracking-tight px-2">
              {monthLabel}
            </span>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNextMonth}
              className="h-8 px-2 text-xs font-semibold gap-1 text-stone-700 border-stone-300 hover:bg-stone-100"
              title={t('finance.sales.import.nextMonth')}
            >
              <span className="hidden sm:inline">{t('finance.sales.import.nextMonth')}</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>

            {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-600 ml-1" />}
          </div>

          {/* Dynamic Month Summary Badges */}
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-950 font-semibold shadow-2xs">
              <FileSpreadsheet className="h-3.5 w-3.5 text-amber-600" />
              <span>
                {t('finance.sales.import.summaryReports', {
                  imported: totalImportedReports,
                  total: totalExpectedReports,
                })}
              </span>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold shadow-2xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>
                {t('finance.sales.import.summaryDays', {
                  complete: totalCompleteDays,
                  total: expectedDaysCount,
                })}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-3 sm:p-4">
        {/* Weekday Column Headers */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-1.5 sm:mb-2 text-center">
          {weekdays.map((wd, idx) => (
            <div
              key={idx}
              className="py-1 text-[11px] font-bold text-stone-500 uppercase tracking-wider bg-stone-100/70 rounded-lg"
            >
              {wd}
            </div>
          ))}
        </div>

        {/* =========================================================================
            DESKTOP CALENDAR GRID (Hidden on mobile, visible on md and up)
        ========================================================================== */}
        <div className="hidden md:grid grid-cols-7 gap-2">
          {/* Leading blank offset cells */}
          {Array.from({ length: startOffset }).map((_, idx) => (
            <div
              key={`offset-${idx}`}
              className="min-h-[108px] rounded-xl bg-stone-50/40 border border-dashed border-stone-200/50"
            />
          ))}

          {/* Month Day Cards */}
          {days.map((day) => (
            <div
              key={day.dateStr}
              onClick={() => setSelectedDay(day)}
              className={`min-h-[108px] p-2 rounded-xl border transition-all flex flex-col justify-between cursor-pointer hover:border-amber-400 hover:shadow-xs ${
                day.isToday
                  ? 'border-amber-400 bg-amber-50/20 ring-1 ring-amber-400'
                  : day.isComplete
                  ? 'border-emerald-200/80 bg-white hover:bg-emerald-50/10'
                  : day.isFuture
                  ? 'border-stone-200/60 bg-stone-50/30'
                  : 'border-stone-200 bg-white'
              }`}
            >
              {/* Day Card Header */}
              <div className="flex items-center justify-between pb-1 border-b border-stone-100">
                <span
                  className={`text-xs font-black ${
                    day.isToday
                      ? 'text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded-md font-mono'
                      : day.isFuture
                      ? 'text-stone-400'
                      : 'text-stone-900'
                  }`}
                >
                  {day.dayNumber}
                </span>

                {day.isComplete ? (
                  <Badge variant="success" className="h-4 px-1 text-[9px] font-bold bg-emerald-100 text-emerald-800 border-0">
                    <Check className="h-2.5 w-2.5 mr-0.5" /> {DAILY_REPORT_CONFIG.length}/{DAILY_REPORT_CONFIG.length}
                  </Badge>
                ) : day.isFuture ? (
                  <span className="text-[10px] text-stone-300 font-bold">—</span>
                ) : (
                  <span className="text-[10px] font-semibold text-rose-600">
                    {day.importedCount}/{DAILY_REPORT_CONFIG.length}
                  </span>
                )}
              </div>

              {/* 4 Report Status Indicators (2x2 Compact Grid) */}
              <div className="grid grid-cols-2 gap-1 pt-1.5">
                {day.reports.map((r) => {
                  const label = t(`finance.sales.import.${r.labelKey}`);

                  if (r.status === 'imported') {
                    return (
                      <span
                        key={r.key}
                        title={`${t(`finance.sales.import.${r.fullTitleKey}`)} (${t('finance.sales.import.statusImported')})`}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 truncate"
                      >
                        <Check className="h-2.5 w-2.5 text-emerald-600 shrink-0" />
                        <span className="truncate">{label}</span>
                      </span>
                    );
                  }

                  if (r.status === 'pending') {
                    return (
                      <span
                        key={r.key}
                        title={`${t(`finance.sales.import.${r.fullTitleKey}`)} (${t('finance.sales.import.statusMissing')})`}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium truncate ${
                          day.isToday
                            ? 'bg-amber-50 text-amber-800 border border-amber-200/80'
                            : 'bg-rose-50 text-rose-700 border border-rose-200/80'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                            day.isToday ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                        />
                        <span className="truncate">{label}</span>
                      </span>
                    );
                  }

                  // Future date (neutral grey with dash)
                  return (
                    <span
                      key={r.key}
                      title={`${t(`finance.sales.import.${r.fullTitleKey}`)} (${t('finance.sales.import.statusFuture')})`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-stone-50 text-stone-400 border border-stone-100 truncate"
                    >
                      <span className="text-stone-300 font-bold shrink-0 text-[10px]">—</span>
                      <span className="truncate">{label}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* =========================================================================
            MOBILE CALENDAR GRID (Visible on sm/xs, hidden on md and up)
        ========================================================================== */}
        <div className="grid md:hidden grid-cols-7 gap-1 sm:gap-1.5">
          {/* Leading blank offset cells */}
          {Array.from({ length: startOffset }).map((_, idx) => (
            <div
              key={`offset-mobile-${idx}`}
              className="h-14 sm:h-16 rounded-xl bg-stone-50/40 border border-dashed border-stone-200/50"
            />
          ))}

          {/* Month Day Cells */}
          {days.map((day) => (
            <button
              type="button"
              key={`mobile-${day.dateStr}`}
              onClick={() => setSelectedDay(day)}
              className={`h-14 sm:h-16 p-1 rounded-xl border flex flex-col items-center justify-between transition-transform active:scale-95 touch-manipulation cursor-pointer ${
                day.isToday
                  ? 'border-amber-400 bg-amber-50/40 ring-1 ring-amber-400'
                  : day.isComplete
                  ? 'border-emerald-200 bg-emerald-50/20'
                  : day.isFuture
                  ? 'border-stone-200/60 bg-stone-50/30'
                  : 'border-stone-200 bg-white'
              }`}
            >
              <span
                className={`text-xs font-black leading-none ${
                  day.isToday
                    ? 'text-amber-700 bg-amber-100 px-1 py-0.2 rounded font-mono'
                    : day.isFuture
                    ? 'text-stone-400'
                    : 'text-stone-900'
                }`}
              >
                {day.dayNumber}
              </span>

              {/* 4 Tiny Status Indicators Dots in a compact row */}
              <div className="flex items-center justify-center gap-0.5 sm:gap-1 py-1">
                {day.reports.map((r) => {
                  let dotColor = 'bg-stone-300';
                  if (r.status === 'imported') {
                    dotColor = 'bg-emerald-500';
                  } else if (r.status === 'pending') {
                    dotColor = day.isToday ? 'bg-amber-500' : 'bg-rose-500';
                  }
                  return (
                    <span
                      key={r.key}
                      className={`h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full ${dotColor}`}
                      title={t(`finance.sales.import.${r.labelKey}`)}
                    />
                  );
                })}
              </div>

              {/* Bottom tiny completion tag */}
              <span className="text-[8px] sm:text-[9px] font-bold text-stone-500 leading-none">
                {day.isComplete ? '✓' : day.isFuture ? '—' : `${day.importedCount}/${DAILY_REPORT_CONFIG.length}`}
              </span>
            </button>
          ))}
        </div>
      </CardContent>

      {/* =========================================================================
          DATE DETAILS MODAL / INSPECTOR (Responsive for Mobile & Desktop click)
      ========================================================================== */}
      {selectedDay && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedDay(null);
          }}
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-4 sm:p-5 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div>
                <h3 className="text-base font-black text-stone-900">
                  {t('finance.sales.import.mobileModalTitle', {
                    date: new Date(selectedDay.dateStr).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-US', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    }),
                  })}
                </h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  {selectedDay.isComplete
                    ? t('finance.sales.import.mobileStatusComplete')
                    : selectedDay.isFuture
                    ? t('finance.sales.import.mobileStatusFuture')
                    : t('finance.sales.import.mobileStatusIncomplete', { count: selectedDay.importedCount })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 4 Reports Status List */}
            <div className="space-y-2.5">
              {selectedDay.reports.map((r) => {
                const label = t(`finance.sales.import.${r.labelKey}`);
                const fullTitle = t(`finance.sales.import.${r.fullTitleKey}`);

                return (
                  <div
                    key={r.key}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                      r.status === 'imported'
                        ? 'bg-emerald-50/40 border-emerald-200/80 text-emerald-950'
                        : r.status === 'pending'
                        ? selectedDay.isToday
                          ? 'bg-amber-50/40 border-amber-200/80 text-amber-950'
                          : 'bg-rose-50/40 border-rose-200/80 text-rose-950'
                        : 'bg-stone-50/40 border-stone-200/60 text-stone-500'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <strong className="text-xs font-bold text-stone-900 truncate">
                          {fullTitle}
                        </strong>
                        <span className="text-[10px] text-stone-400 font-mono">({label})</span>
                      </div>
                      {r.batch && (
                        <p className="text-[11px] text-stone-500 font-mono truncate mt-0.5" title={r.batch.file_name}>
                          {r.batch.file_name} • {r.batch.record_count} records {r.batch.total_net_sales ? `• ${formatINR(r.batch.total_net_sales)}` : ''}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0">
                      {r.status === 'imported' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-bold">
                          <Check className="h-3.5 w-3.5" />
                          <span>{t('finance.sales.import.statusImported')}</span>
                        </span>
                      ) : r.status === 'pending' ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
                            selectedDay.isToday
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>{t('finance.sales.import.statusMissing')}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-100 text-stone-500 text-xs font-medium">
                          <span>—</span>
                          <span>{t('finance.sales.import.statusFuture')}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="w-full text-xs font-semibold"
                onClick={() => setSelectedDay(null)}
              >
                {t('finance.sales.import.close')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
