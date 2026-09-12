'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import {
  TrendingUp,
  Calendar,
  Filter,
  RefreshCw,
  ArrowUpRight,
  CheckCircle2,
  CalendarDays,
  Sparkles,
} from 'lucide-react';

interface DailySalesDataPoint {
  date: string;
  displayDate: string;
  dayNumber: number;
  netSales: number;
  grossSales: number;
  discounts: number;
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

function formatAxisDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${monthNames[m - 1]}`;
}

function getMonthBoundaries(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

export function DailySalesLineGraph({ onSelectDate, selectedDate }: DailySalesLineGraphProps) {
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

  // Available Month options (last 6 months and next 3 months around current)
  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const [currY, currM] = currentYearMonth.split('-').map(Number);
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];

    for (let offset = -4; offset <= 2; offset++) {
      const d = new Date(currY, currM - 1 + offset, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const val = `${y}-${String(m).padStart(2, '0')}`;
      const label = `${monthNames[m - 1]} ${y}`;
      options.push({ value: val, label });
    }
    return options;
  }, [currentYearMonth]);

  const fetchSalesData = async () => {
    setLoading(true);
    try {
      // 1. Fetch sales reports for the range using the single authoritative sales source
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
          displayDate: formatAxisDate(dateStr),
          dayNumber: dayNum,
          netSales: Number(row?.net_sales || 0),
          grossSales: Number(row?.gross_sales || 0),
          discounts: Number(row?.discounts || 0),
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
  };

  useEffect(() => {
    fetchSalesData();
  }, [activeStartDate, activeEndDate]);

  // Aggregate Metrics for Selected Period
  const totalSales = useMemo(() => {
    return dailyPoints.reduce((sum, p) => sum + p.netSales, 0);
  }, [dailyPoints]);

  const activeSalesDays = useMemo(() => {
    return dailyPoints.filter((p) => p.netSales > 0).length;
  }, [dailyPoints]);

  const dailyAverage = useMemo(() => {
    if (dailyPoints.length === 0) return 0;
    return totalSales / dailyPoints.length;
  }, [totalSales, dailyPoints.length]);

  const peakDay = useMemo(() => {
    if (dailyPoints.length === 0) return null;
    return dailyPoints.reduce((max, p) => (p.netSales > max.netSales ? p : max), dailyPoints[0]);
  }, [dailyPoints]);

  // SVG Chart Geometry
  const svgWidth = 800;
  const svgHeight = 240;
  const padLeft = 70;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 35;
  const graphW = svgWidth - padLeft - padRight;
  const graphH = svgHeight - padTop - padBottom;

  const maxVal = useMemo(() => {
    const maxData = Math.max(...dailyPoints.map((p) => p.netSales), 0);
    if (maxData === 0) return 10000;
    // Round up nicely
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
      const y = padTop + graphH - (p.netSales / maxVal) * graphH;
      return { ...p, x, y };
    });
  }, [dailyPoints, graphW, graphH, padLeft, padTop, maxVal]);

  // Generate SVG Line and Area path
  const linePath = useMemo(() => {
    if (pointCoords.length === 0) return '';
    return pointCoords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
  }, [pointCoords]);

  const areaPath = useMemo(() => {
    if (pointCoords.length === 0) return '';
    const firstX = pointCoords[0].x.toFixed(1);
    const lastX = pointCoords[pointCoords.length - 1].x.toFixed(1);
    const bottomY = (padTop + graphH).toFixed(1);
    return `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  }, [linePath, pointCoords, padTop, graphH]);

  // X-axis label step (show fewer labels on dense ranges)
  const xLabelInterval = useMemo(() => {
    const count = dailyPoints.length;
    if (count <= 10) return 1;
    if (count <= 20) return 2;
    if (count <= 31) return 3;
    return Math.ceil(count / 10);
  }, [dailyPoints.length]);

  return (
    <Card className="overflow-hidden border-stone-200/80 shadow-xs">
      <CardHeader className="pb-3 border-b border-stone-100 bg-stone-50/40">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2 text-stone-900">
              <TrendingUp className="h-5 w-5 text-amber-600" />
              Daily Sales Trend &amp; Performance
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              Official sales ledger curve for {activeStartDate} through {activeEndDate} (IST)
            </CardDescription>
          </div>

          {/* Filtering Controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Mode switch */}
            <div className="flex items-center bg-stone-200/70 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setFilterMode('month')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  filterMode === 'month'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Monthly
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
                Custom Range
              </button>
            </div>

            {/* Month selector dropdown */}
            {filterMode === 'month' && (
              <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-2.5 py-1 shadow-xs">
                <Calendar className="h-3.5 w-3.5 text-amber-600" />
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
              <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-2.5 py-1 shadow-xs">
                <span className="text-stone-400 font-medium text-[11px]">From:</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="bg-transparent font-semibold text-stone-900 focus:outline-none cursor-pointer text-xs"
                />
                <span className="text-stone-400 font-medium text-[11px]">To:</span>
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
              className="h-8 px-2.5 text-xs text-stone-600 hover:text-stone-900"
              title="Refresh sales trend data"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-amber-600' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Summary Metrics Bar for the Selected Period */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 mt-3 border-t border-stone-200/60">
          <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs">
            <span className="text-[11px] font-medium text-stone-500 block">Period Total Sales</span>
            <span className="text-base sm:text-lg font-bold text-stone-900 block mt-0.5">
              {formatINR(totalSales)}
            </span>
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs">
            <span className="text-[11px] font-medium text-stone-500 block">Daily Average</span>
            <span className="text-base sm:text-lg font-bold text-amber-700 block mt-0.5">
              {formatINR(dailyAverage)}
            </span>
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs">
            <span className="text-[11px] font-medium text-stone-500 block">Peak Day Sales</span>
            <span className="text-base sm:text-lg font-bold text-emerald-700 block mt-0.5">
              {peakDay && peakDay.netSales > 0 ? formatINR(peakDay.netSales) : '—'}
            </span>
            {peakDay && peakDay.netSales > 0 && (
              <span className="text-[10px] text-stone-400 block truncate">{peakDay.displayDate}</span>
            )}
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs">
            <span className="text-[11px] font-medium text-stone-500 block">Active Sales Days</span>
            <span className="text-base sm:text-lg font-bold text-stone-900 block mt-0.5">
              {activeSalesDays}{' '}
              <span className="text-xs font-normal text-stone-500">/ {dailyPoints.length} days</span>
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 pb-2">
        {loading && dailyPoints.length === 0 ? (
          <div className="h-60 flex flex-col items-center justify-center gap-2 text-stone-400 text-xs">
            <RefreshCw className="h-5 w-5 animate-spin text-amber-600" />
            <span>Loading daily sales performance curve...</span>
          </div>
        ) : (
          <div className="relative w-full overflow-x-auto">
            {/* Interactive Tooltip Card */}
            {hoveredPoint && (
              <div
                className="absolute z-20 pointer-events-none bg-stone-900/95 text-white rounded-lg p-2.5 shadow-xl text-xs backdrop-blur-xs border border-stone-700 min-w-[170px]"
                style={{
                  left: `${Math.min(Math.max(10, (hoveredPoint as any).x - 85), svgWidth - 180)}px`,
                  top: `${Math.max(5, (hoveredPoint as any).y - 75)}px`,
                }}
              >
                <div className="flex items-center justify-between gap-2 border-b border-stone-700/80 pb-1 mb-1">
                  <span className="font-bold text-amber-400">{hoveredPoint.displayDate}</span>
                  {hoveredPoint.isReported ? (
                    <span className="text-[9px] bg-emerald-950 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-800">
                      Reported
                    </span>
                  ) : (
                    <span className="text-[9px] bg-stone-800 text-stone-400 px-1.5 py-0.2 rounded">
                      Zero Sales
                    </span>
                  )}
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-stone-400">Net Sales:</span>
                  <span className="font-bold text-white text-sm">{formatINR(hoveredPoint.netSales)}</span>
                </div>
                {hoveredPoint.billCount > 0 && (
                  <div className="flex items-center justify-between text-[10px] text-stone-400 mt-0.5">
                    <span>Bills: {hoveredPoint.billCount}</span>
                    <span>Guests: {hoveredPoint.customerCount}</span>
                  </div>
                )}
                {onSelectDate && (
                  <div className="text-[10px] text-amber-300/80 mt-1 pt-1 border-t border-stone-800 flex items-center gap-1">
                    <ArrowUpRight className="h-3 w-3" /> Click to view flash report
                  </div>
                )}
              </div>
            )}

            {/* SVG Chart */}
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-auto select-none overflow-visible"
              style={{ minWidth: '600px', maxHeight: '280px' }}
            >
              <defs>
                {/* Gradient for area fill under line */}
                <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d97706" stopOpacity="0.32" />
                  <stop offset="80%" stopColor="#d97706" stopOpacity="0.04" />
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

              {/* Area Fill */}
              {areaPath && (
                <path d={areaPath} fill="url(#salesGradient)" />
              )}

              {/* Sales Line Curve */}
              {linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="#d97706"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Data Points and Invisible Hover Columns */}
              {pointCoords.map((pt, idx) => {
                const isSelected = selectedDate === pt.date;
                const isHovered = hoveredPoint?.date === pt.date;
                const hasSales = pt.netSales > 0;

                // X-axis label visibility
                const showLabel =
                  idx === 0 ||
                  idx === pointCoords.length - 1 ||
                  idx % xLabelInterval === 0;

                return (
                  <g key={pt.date}>
                    {/* X-axis Tick Label */}
                    {showLabel && (
                      <text
                        x={pt.x}
                        y={padTop + graphH + 20}
                        textAnchor="middle"
                        fontSize="10"
                        fill={isSelected ? '#d97706' : '#78716c'}
                        fontWeight={isSelected ? 'bold' : 'normal'}
                      >
                        {pt.displayDate}
                      </text>
                    )}

                    {/* Active/Hover Vertical Guideline */}
                    {(isHovered || isSelected) && (
                      <line
                        x1={pt.x}
                        y1={padTop}
                        x2={pt.x}
                        y2={padTop + graphH}
                        stroke={isSelected ? '#d97706' : '#a8a29e'}
                        strokeWidth={1}
                        strokeDasharray="2 2"
                      />
                    )}

                    {/* Circle Dot for Data Point */}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered || isSelected ? 5.5 : hasSales ? 3.5 : 2}
                      fill={hasSales ? (isSelected ? '#b45309' : '#d97706') : '#d6d3d1'}
                      stroke="#ffffff"
                      strokeWidth={isHovered || isSelected ? 2 : 1.5}
                      className="transition-all duration-150"
                    />

                    {/* Invisible 넓은 Hover Capture Zone */}
                    <rect
                      x={pt.x - graphW / (pointCoords.length * 2)}
                      y={padTop}
                      width={graphW / pointCoords.length}
                      height={graphH}
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredPoint(pt)}
                      onMouseLeave={() => setHoveredPoint(null)}
                      onClick={() => onSelectDate && onSelectDate(pt.date)}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between text-[11px] text-stone-400 mt-2 px-2">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block" />
              Reported Net Sales
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-stone-300 inline-block" />
              Zero Sales Day (Plotted at ₹0)
            </span>
          </div>
          <span>Tip: Hover or tap any point to view exact figures; click to sync flash report</span>
        </div>
      </CardContent>
    </Card>
  );
}
