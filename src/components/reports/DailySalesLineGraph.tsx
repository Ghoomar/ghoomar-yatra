'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate, formatDisplayDate } from '@/lib/utils';
import {
  TrendingUp,
  Calendar,
  RefreshCw,
  ArrowUpRight,
  Receipt,
  Layers,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export interface DailySalesDataPoint {
  date: string;
  displayDate: string;
  dayNumber: number;
  dayOfWeek: string;
  netSales: number;
  grossSales: number;
  discounts: number;
  taxAmount: number;
  isReported: boolean;
  billCount: number;
  customerCount: number;
}

interface DailySalesLineGraphProps {
  onSelectDate?: (date: string) => void;
  selectedDate?: string;
}

function generateDateRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);

  const current = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));

  while (current <= end) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, '0');
    const d = String(current.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function formatAxisDate(dateStr: string, locale: string = 'en'): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
}

function getDayOfWeek(dateStr: string, locale: string = 'en'): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short' });
}

function getMonthBoundaries(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

export function DailySalesLineGraph({ onSelectDate, selectedDate }: DailySalesLineGraphProps) {
  const { t, locale } = useI18n();
  const supabase = createClient();
  const todayIST = getTodayBusinessDate();
  const currentYearMonth = todayIST.substring(0, 7); // e.g. "2026-09"

  // Filter Mode: 'month' or 'custom'
  const [filterMode, setFilterMode] = useState<'month' | 'custom'>('month');
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);
  const [customStartDate, setCustomStartDate] = useState(getMonthBoundaries(currentYearMonth).startDate);
  const [customEndDate, setCustomEndDate] = useState(todayIST);

  const [loading, setLoading] = useState(true);
  const [dailyPoints, setDailyPoints] = useState<DailySalesDataPoint[]>([]);
  const [hoveredPoint, setHoveredPoint] = useState<DailySalesDataPoint | null>(null);

  // Responsive state for screen width (to rotate labels on mobile)
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Determine current active date range
  const { activeStartDate, activeEndDate } = useMemo(() => {
    if (filterMode === 'month') {
      const b = getMonthBoundaries(selectedMonth);
      return { activeStartDate: b.startDate, activeEndDate: b.endDate };
    }
    return {
      activeStartDate: customStartDate <= customEndDate ? customStartDate : customEndDate,
      activeEndDate: customStartDate <= customEndDate ? customEndDate : customStartDate,
    };
  }, [filterMode, selectedMonth, customStartDate, customEndDate]);

  // Available Month options
  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const [currY, currM] = currentYearMonth.split('-').map(Number);

    for (let offset = -5; offset <= 2; offset++) {
      let m = currM + offset;
      let y = currY;
      while (m < 1) {
        m += 12;
        y -= 1;
      }
      while (m > 12) {
        m -= 12;
        y += 1;
      }
      const val = `${y}-${String(m).padStart(2, '0')}`;
      const d = new Date(Date.UTC(y, m - 1, 1));
      const label = d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric' });
      options.push({
        value: val,
        label,
      });
    }
    return options;
  }, [currentYearMonth, locale]);

  const fetchSalesData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch Authoritative Daily Sales Summaries
      const { data: salesRows, error } = await supabase
        .from('daily_sales_summary')
        .select('*')
        .gte('business_date', activeStartDate)
        .lte('business_date', activeEndDate)
        .order('business_date', { ascending: true });

      if (error) {
        console.error('Error fetching daily sales summary:', error);
      }

      // Map rows by business_date for O(1) lookup
      const salesMap = new Map<string, any>();
      (salesRows || []).forEach((row) => {
        salesMap.set(row.business_date, row);
      });

      // 2. Generate EVERY single calendar day in the selected period (including zero-sales days)
      const allDates = generateDateRange(activeStartDate, activeEndDate);
      const points: DailySalesDataPoint[] = allDates.map((dateStr) => {
        const row = salesMap.get(dateStr);
        const dayNum = parseInt(dateStr.split('-')[2], 10);
        return {
          date: dateStr,
          displayDate: formatAxisDate(dateStr, locale),
          dayNumber: dayNum,
          dayOfWeek: getDayOfWeek(dateStr, locale),
          netSales: Number(row?.net_sales || 0),
          grossSales: Number(row?.gross_sales || 0),
          discounts: Number(row?.discounts || 0),
          taxAmount: Number(row?.tax_amount || 0),
          isReported: Boolean(row?.is_reported),
          billCount: Number(row?.bill_count || 0),
          customerCount: Number(row?.customer_count || 0),
        };
      });

      setDailyPoints(points);
    } catch (err) {
      console.error('Unexpected error loading sales line graph data:', err);
    } finally {
      setLoading(false);
    }
  }, [activeStartDate, activeEndDate, supabase, locale]);

  useEffect(() => {
    fetchSalesData();
  }, [fetchSalesData]);

  // Aggregate Metrics for Selected Period (Primary: Gross Sales)
  const totalGrossSales = useMemo(() => {
    return dailyPoints.reduce((sum, p) => sum + p.grossSales, 0);
  }, [dailyPoints]);

  const totalNetSales = useMemo(() => {
    return dailyPoints.reduce((sum, p) => sum + p.netSales, 0);
  }, [dailyPoints]);

  const activeSalesDays = useMemo(() => {
    return dailyPoints.filter((p) => p.grossSales > 0).length;
  }, [dailyPoints]);

  const dailyAverageGross = useMemo(() => {
    if (dailyPoints.length === 0) return 0;
    return totalGrossSales / dailyPoints.length;
  }, [totalGrossSales, dailyPoints.length]);

  const peakGrossDay = useMemo(() => {
    if (dailyPoints.length === 0) return null;
    return dailyPoints.reduce((max, p) => (p.grossSales > max.grossSales ? p : max), dailyPoints[0]);
  }, [dailyPoints]);

  // SVG Chart Geometry & Responsiveness
  // If dense/mobile, compute an expanded SVG width so touch slices are wide enough to tap cleanly
  const minPointSpacing = isMobile ? 32 : 24;
  const computedSvgWidth = Math.max(800, dailyPoints.length * minPointSpacing + 100);
  const svgWidth = computedSvgWidth;
  const svgHeight = isMobile ? 270 : 250;
  const padLeft = 75;
  const padRight = 35;
  const padTop = 25;
  const padBottom = isMobile ? 55 : 35;
  const graphW = svgWidth - padLeft - padRight;
  const graphH = svgHeight - padTop - padBottom;

  // Maximum value for primary metric: Gross Sales
  const maxVal = useMemo(() => {
    const maxData = Math.max(...dailyPoints.map((p) => p.grossSales), 0);
    if (maxData === 0) return 10000;
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxData)));
    return Math.ceil((maxData * 1.15) / magnitude) * magnitude;
  }, [dailyPoints]);

  // Y-axis ticks (4 divisions)
  const yTicks = useMemo(() => {
    const count = 4;
    const ticks: { val: number; y: number }[] = [];
    for (let i = 0; i <= count; i++) {
      const val = (maxVal / count) * i;
      const y = padTop + graphH - (val / maxVal) * graphH;
      ticks.push({ val, y });
    }
    return ticks;
  }, [maxVal, graphH, padTop]);

  // Calculate coordinates for points
  const pointCoords = useMemo(() => {
    const N = dailyPoints.length;
    if (N === 0) return [];
    return dailyPoints.map((p, idx) => {
      const x = N === 1 ? padLeft + graphW / 2 : padLeft + (idx / (N - 1)) * graphW;
      const grossY = padTop + graphH - (p.grossSales / maxVal) * graphH;
      const netY = padTop + graphH - (p.netSales / maxVal) * graphH;
      return { ...p, x, grossY, netY };
    });
  }, [dailyPoints, graphW, graphH, padLeft, padTop, maxVal]);

  // Path for Primary Metric: Gross Sales
  const grossLinePath = useMemo(() => {
    if (pointCoords.length === 0) return '';
    return pointCoords
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.grossY.toFixed(1)}`)
      .join(' ');
  }, [pointCoords]);

  const grossAreaPath = useMemo(() => {
    if (pointCoords.length === 0) return '';
    const firstX = pointCoords[0].x.toFixed(1);
    const lastX = pointCoords[pointCoords.length - 1].x.toFixed(1);
    const bottomY = (padTop + graphH).toFixed(1);
    return `${grossLinePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  }, [grossLinePath, pointCoords, padTop, graphH]);

  // Secondary dashed path for Net Sales
  const netLinePath = useMemo(() => {
    if (pointCoords.length === 0) return '';
    return pointCoords
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.netY.toFixed(1)}`)
      .join(' ');
  }, [pointCoords]);

  // Handle touch / drag interaction across the chart
  const handlePointerInteraction = (clientX: number) => {
    if (!containerRef.current || pointCoords.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const relX = clientX - rect.left + scrollLeft;

    // Find closest point by x coordinate
    let closest = pointCoords[0];
    let minDist = Infinity;
    for (const pt of pointCoords) {
      const dist = Math.abs(pt.x - relX);
      if (dist < minDist) {
        minDist = dist;
        closest = pt;
      }
    }
    setHoveredPoint(closest);
    if (onSelectDate && closest.date !== selectedDate) {
      onSelectDate(closest.date);
    }
  };

  return (
    <Card className="overflow-hidden border-[#E7E2D8] shadow-xs bg-white rounded-xl">
      <CardHeader className="pb-3 border-b border-[#E7E2D8] bg-[#FAF8F5]/60">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2 text-stone-900">
              <TrendingUp className="h-5 w-5 text-[#6B162E]" />
              {t('reports.salesLineGraph.title')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {t('reports.salesLineGraph.subtitle', {
                start: formatDisplayDate(activeStartDate, 'short'),
                end: formatDisplayDate(activeEndDate, 'short'),
              })}
            </CardDescription>
          </div>

          {/* Filtering Controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Mode switch */}
            <div className="flex items-center bg-[#E7E2D8]/60 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setFilterMode('month')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  filterMode === 'month'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t('reports.salesLineGraph.monthly')}
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('custom')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  filterMode === 'custom'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t('reports.salesLineGraph.customRange')}
              </button>
            </div>

            {/* Month selector dropdown */}
            {filterMode === 'month' && (
              <div className="flex items-center gap-1.5 bg-white border border-[#E7E2D8] rounded-lg px-2.5 py-1 shadow-xs">
                <Calendar className="h-3.5 w-3.5 text-[#D97706]" />
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-transparent font-medium text-stone-900 focus:outline-none cursor-pointer text-xs"
                >
                  {monthOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Custom range date pickers */}
            {filterMode === 'custom' && (
              <div className="flex items-center gap-1.5 bg-white border border-[#E7E2D8] rounded-lg px-2.5 py-1 shadow-xs">
                <span className="text-stone-400 font-medium text-[11px]">{t('reports.salesLineGraph.from')}</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer text-xs"
                />
                <span className="text-stone-400 font-medium text-[11px]">{t('reports.salesLineGraph.to')}</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer text-xs"
                />
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={fetchSalesData}
              disabled={loading}
              className="h-8 px-2.5 text-xs text-stone-600 hover:text-stone-900 rounded-lg border-[#E7E2D8]"
              title={t('reports.salesLineGraph.refreshTitle')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-[#6B162E]' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Summary Metrics Bar for the Selected Period */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 mt-3 border-t border-[#E7E2D8]">
          <div className="bg-white p-3 rounded-xl border border-[#E7E2D8] shadow-xs">
            <span className="text-[11px] font-medium text-stone-500 block">{t('reports.salesLineGraph.periodGross')}</span>
            <span className="text-base sm:text-lg font-bold text-[#6B162E] block mt-0.5 tabular-nums">
              {formatINR(totalGrossSales)}
            </span>
            <span className="text-[10px] text-stone-400 block mt-0.5">{t('reports.salesLineGraph.netLabel', { amount: formatINR(totalNetSales) })}</span>
          </div>

          <div className="bg-white p-3 rounded-xl border border-[#E7E2D8] shadow-xs">
            <span className="text-[11px] font-medium text-stone-500 block">{t('reports.salesLineGraph.dailyAvgGross')}</span>
            <span className="text-base sm:text-lg font-bold text-amber-700 block mt-0.5 tabular-nums">
              {formatINR(dailyAverageGross)}
            </span>
            <span className="text-[10px] text-stone-400 block mt-0.5">{t('reports.salesLineGraph.overDays', { count: dailyPoints.length })}</span>
          </div>

          <div className="bg-white p-3 rounded-xl border border-[#E7E2D8] shadow-xs">
            <span className="text-[11px] font-medium text-stone-500 block">{t('reports.salesLineGraph.peakDayGross')}</span>
            <span className="text-base sm:text-lg font-bold text-emerald-700 block mt-0.5 tabular-nums">
              {peakGrossDay && peakGrossDay.grossSales > 0 ? formatINR(peakGrossDay.grossSales) : '—'}
            </span>
            {peakGrossDay && peakGrossDay.grossSales > 0 && (
              <span className="text-[10px] text-stone-400 block truncate">{peakGrossDay.displayDate} ({peakGrossDay.dayOfWeek})</span>
            )}
          </div>

          <div className="bg-white p-3 rounded-xl border border-[#E7E2D8] shadow-xs">
            <span className="text-[11px] font-medium text-stone-500 block">{t('reports.salesLineGraph.activeSalesDays')}</span>
            <span className="text-base sm:text-lg font-bold text-stone-900 block mt-0.5 tabular-nums">
              {activeSalesDays}{' '}
              <span className="text-xs font-normal text-stone-500">{t('reports.salesLineGraph.daysSuffix', { count: dailyPoints.length })}</span>
            </span>
            <span className="text-[10px] text-stone-400 block mt-0.5">{t('reports.salesLineGraph.reportedRevenue')}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 pb-2">
        {loading && dailyPoints.length === 0 ? (
          <div className="h-60 flex flex-col items-center justify-center gap-2 text-stone-400 text-xs">
            <RefreshCw className="h-5 w-5 animate-spin text-amber-600" />
            <span>{t('reports.salesLineGraph.loadingCurve')}</span>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="relative w-full overflow-x-auto overflow-y-hidden touch-pan-x select-none scrollbar-thin pb-2"
          >
            {/* Interactive Tooltip Card */}
            {hoveredPoint && (
              <div
                className="absolute z-20 pointer-events-none bg-stone-900/95 text-white rounded-lg p-2.5 shadow-xl text-xs backdrop-blur-xs border border-stone-700 min-w-[190px]"
                style={{
                  left: `${Math.min(Math.max(10, (hoveredPoint as any).x - 95), svgWidth - 200)}px`,
                  top: `${Math.max(5, Math.min((hoveredPoint as any).grossY - 80, svgHeight - 120))}px`,
                }}
              >
                <div className="flex items-center justify-between gap-2 border-b border-stone-700/80 pb-1 mb-1">
                  <span className="font-bold text-amber-400">
                    {hoveredPoint.displayDate} ({hoveredPoint.dayOfWeek})
                  </span>
                  {hoveredPoint.isReported ? (
                    <span className="text-[9px] bg-emerald-950 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-800">
                      {t('reports.salesLineGraph.reported')}
                    </span>
                  ) : (
                    <span className="text-[9px] bg-stone-800 text-stone-400 px-1.5 py-0.2 rounded">
                      {t('reports.salesLineGraph.zeroSales')}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-amber-300 font-semibold">{t('reports.salesLineGraph.grossSales')}</span>
                  <span className="font-bold text-white text-sm">{formatINR(hoveredPoint.grossSales)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-[10px] text-stone-300">
                  <span>{t('reports.salesLineGraph.netSales')}</span>
                  <span>{formatINR(hoveredPoint.netSales)}</span>
                </div>
                {hoveredPoint.discounts > 0 && (
                  <div className="flex items-baseline justify-between gap-2 text-[10px] text-rose-400">
                    <span>{t('reports.salesLineGraph.discounts')}</span>
                    <span>-{formatINR(hoveredPoint.discounts)}</span>
                  </div>
                )}
                {hoveredPoint.taxAmount > 0 && (
                  <div className="flex items-baseline justify-between gap-2 text-[10px] text-stone-400">
                    <span>{t('reports.salesLineGraph.gstTax')}</span>
                    <span>{formatINR(hoveredPoint.taxAmount)}</span>
                  </div>
                )}
                {(hoveredPoint.billCount > 0 || hoveredPoint.customerCount > 0) && (
                  <div className="flex items-center justify-between text-[10px] text-stone-400 mt-1 pt-1 border-t border-stone-800">
                    <span>{t('reports.salesLineGraph.billsPax', { bills: hoveredPoint.billCount, pax: hoveredPoint.customerCount })}</span>
                  </div>
                )}
                {onSelectDate && (
                  <div className="text-[10px] text-amber-400 mt-1 pt-1 border-t border-stone-800 flex items-center gap-1 font-medium">
                    <ArrowUpRight className="h-3 w-3" /> {t('reports.salesLineGraph.dateSynced')}
                  </div>
                )}
              </div>
            )}

            {/* SVG Chart with Touch & Click Interaction */}
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-auto select-none overflow-visible"
              style={{ minWidth: `${svgWidth}px`, height: `${svgHeight}px` }}
              onPointerDown={(e) => handlePointerInteraction(e.clientX)}
              onPointerMove={(e) => {
                if (e.buttons === 1) {
                  handlePointerInteraction(e.clientX);
                }
              }}
              onTouchMove={(e) => {
                if (e.touches.length > 0) {
                  handlePointerInteraction(e.touches[0].clientX);
                }
              }}
            >
              <defs>
                {/* Gradient for area fill under Gross Sales line */}
                <linearGradient id="grossSalesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d97706" stopOpacity="0.28" />
                  <stop offset="75%" stopColor="#d97706" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="#d97706" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Y-axis Grid Lines & Tick Labels */}
              {yTicks.map((tick) => (
                <g key={tick.val}>
                  <line
                    x1={padLeft}
                    y1={tick.y}
                    x2={padLeft + graphW}
                    y2={tick.y}
                    stroke="#e7e5e4"
                    strokeDasharray={tick.val === 0 ? 'none' : '3 3'}
                    strokeWidth={tick.val === 0 ? 1.5 : 1}
                  />
                  <text
                    x={padLeft - 10}
                    y={tick.y + 4}
                    textAnchor="end"
                    fontSize="10"
                    fill="#78716c"
                    fontFamily="monospace"
                  >
                    {formatINR(tick.val, true)}
                  </text>
                </g>
              ))}

              {/* Area Fill for Gross Sales */}
              {grossAreaPath && (
                <path d={grossAreaPath} fill="url(#grossSalesGradient)" />
              )}

              {/* Secondary Dashed Line for Net Sales */}
              {netLinePath && (
                <path
                  d={netLinePath}
                  fill="none"
                  stroke="#78716c"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  strokeOpacity="0.6"
                />
              )}

              {/* Primary Line Curve for Gross Sales */}
              {grossLinePath && (
                <path
                  d={grossLinePath}
                  fill="none"
                  stroke="#d97706"
                  strokeWidth="2.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Data Points, Selected Highlighting, and Full-Height Touch Slices */}
              {pointCoords.map((pt) => {
                const isSelected = selectedDate === pt.date;
                const isHovered = hoveredPoint?.date === pt.date;
                const hasSales = pt.grossSales > 0;
                const colWidth = Math.max(16, graphW / Math.max(1, pointCoords.length - 1));

                return (
                  <g key={pt.date}>
                    {/* Selected Day Vertical Glowing Column Band */}
                    {isSelected && (
                      <rect
                        x={pt.x - colWidth / 2}
                        y={padTop}
                        width={colWidth}
                        height={graphH}
                        fill="#d97706"
                        fillOpacity="0.1"
                        stroke="#d97706"
                        strokeWidth="1.25"
                        strokeDasharray="3 2"
                      />
                    )}

                    {/* Active/Hover Vertical Guideline */}
                    {isHovered && !isSelected && (
                      <line
                        x1={pt.x}
                        y1={padTop}
                        x2={pt.x}
                        y2={padTop + graphH}
                        stroke="#a8a29e"
                        strokeWidth={1}
                        strokeDasharray="2 2"
                      />
                    )}

                    {/* X-axis Date Labels: Rotated 90° on mobile, horizontal on desktop */}
                    {isMobile ? (
                      <g transform={`translate(${pt.x}, ${padTop + graphH + 8})`}>
                        <text
                          transform="rotate(90)"
                          x="0"
                          y="3"
                          textAnchor="start"
                          fontSize="9"
                          fontFamily="sans-serif"
                          fill={isSelected ? '#b45309' : '#78716c'}
                          fontWeight={isSelected ? 'bold' : 'normal'}
                        >
                          {pt.dayNumber} {pt.displayDate.split(' ')[1]}
                        </text>
                      </g>
                    ) : (
                      <text
                        x={pt.x}
                        y={padTop + graphH + 20}
                        textAnchor="middle"
                        fontSize="10"
                        fill={isSelected ? '#b45309' : '#78716c'}
                        fontWeight={isSelected ? 'bold' : 'normal'}
                      >
                        {pt.dayNumber}
                      </text>
                    )}

                    {/* Circle Dot for Data Point */}
                    <circle
                      cx={pt.x}
                      cy={pt.grossY}
                      r={isSelected ? 6 : isHovered ? 5.5 : hasSales ? 3.5 : 2}
                      fill={hasSales ? (isSelected ? '#b45309' : '#d97706') : '#d6d3d1'}
                      stroke="#ffffff"
                      strokeWidth={isSelected || isHovered ? 2.5 : 1.5}
                      className="transition-all duration-150"
                    />

                    {/* Full-Height Touch / Click Slice Hitbox */}
                    <rect
                      x={pt.x - colWidth / 2}
                      y={0}
                      width={colWidth}
                      height={svgHeight}
                      fill="transparent"
                      className="cursor-pointer"
                      onPointerEnter={() => setHoveredPoint(pt)}
                      onPointerLeave={() => setHoveredPoint(null)}
                      onClick={() => onSelectDate && onSelectDate(pt.date)}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Legend & Help Text */}
        <div className="flex flex-wrap items-center justify-between text-[11px] text-stone-500 mt-2 px-1 border-t border-stone-100 pt-2 gap-2">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 font-medium text-stone-700">
              <span className="w-3 h-1 bg-amber-600 rounded-full inline-block" />
              {t('reports.salesLineGraph.legendGross')}
            </span>
            <span className="flex items-center gap-1.5 font-medium text-stone-500">
              <span className="w-3 h-0.5 bg-stone-400 border-b border-dashed border-stone-500 inline-block" />
              {t('reports.salesLineGraph.legendNet')}
            </span>
            <span className="flex items-center gap-1.5 text-stone-400">
              <span className="w-2 h-2 rounded-full bg-stone-300 inline-block" />
              {t('reports.salesLineGraph.legendZero')}
            </span>
          </div>
          <span className="text-[10px] text-stone-400">
            {t('reports.salesLineGraph.swipeHint')}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
