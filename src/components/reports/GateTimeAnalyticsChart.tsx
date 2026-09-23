'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatNumber } from '@/lib/utils';
import { GateAnalyticsResponse, GateHourlyPoint } from '@/app/api/operations/gate/analytics/route';
import {
  Users,
  Car,
  Bike,
  Moon,
  Sun,
  Clock,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Sliders,
  Flame,
  ArrowRight,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

interface GateTimeAnalyticsChartProps {
  selectedDate: string;
  onDateChange?: (date: string) => void;
}

export function GateTimeAnalyticsChart({ selectedDate, onDateChange }: GateTimeAnalyticsChartProps) {
  const { t } = useI18n();
  const [data, setData] = useState<GateAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [nightStart, setNightStart] = useState<number>(23);
  const [nightEnd, setNightEnd] = useState<number>(6);
  const [metricView, setMetricView] = useState<'all' | 'visitors' | 'vehicles'>('all');
  const [hoveredPoint, setHoveredPoint] = useState<GateHourlyPoint | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/operations/gate/analytics?date=${selectedDate}&night_start=${nightStart}&night_end=${nightEnd}`
      );
      const json = await res.json();
      if (res.ok) {
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load gate analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDate, nightStart, nightEnd]);

  const hourlyData = data?.hourly_data || [];
  const summary = data?.summary;

  // Max value calculation for SVG chart height scaling
  const maxMetricValue = useMemo(() => {
    if (hourlyData.length === 0) return 20;
    const maxVals = hourlyData.map((h) => {
      if (metricView === 'visitors') return h.visitors;
      if (metricView === 'vehicles') return h.total_vehicles;
      return Math.max(h.visitors, h.total_vehicles);
    });
    const max = Math.max(...maxVals, 10);
    return Math.ceil(max / 10) * 10;
  }, [hourlyData, metricView]);

  // SVG dimensions
  const height = 240;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 40;
  const plotWidth = 800 - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const colWidth = plotWidth / 24;

  return (
    <Card className="overflow-hidden border-stone-200/80 shadow-xs">
      <CardHeader className="pb-3 border-b border-stone-100 bg-stone-50/40">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2 text-stone-900">
              <Clock className="h-5 w-5 text-amber-600" />
              {t('reports.gateTimeChart.title')}
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {t('reports.gateTimeChart.subtitle')}
            </CardDescription>
          </div>

          {/* Filtering & View Controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Metric Mode Toggle */}
            <div className="flex items-center bg-stone-200/70 p-0.5 rounded-lg font-medium">
              <button
                type="button"
                onClick={() => setMetricView('all')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  metricView === 'all'
                    ? 'bg-white text-stone-900 shadow-2xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t('reports.gateTimeChart.combined')}
              </button>
              <button
                type="button"
                onClick={() => setMetricView('visitors')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  metricView === 'visitors'
                    ? 'bg-white text-stone-900 shadow-2xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t('reports.gateTimeChart.peopleOnly')}
              </button>
              <button
                type="button"
                onClick={() => setMetricView('vehicles')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  metricView === 'vehicles'
                    ? 'bg-white text-stone-900 shadow-2xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t('reports.gateTimeChart.vehiclesOnly')}
              </button>
            </div>

            {/* Nighttime Window Configurator */}
            <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-2.5 py-1 text-stone-700 shadow-2xs">
              <Moon className="h-3.5 w-3.5 text-indigo-600" />
              <span className="text-[11px] text-stone-400 font-medium">{t('reports.gateTimeChart.nightWindow')}</span>
              <select
                value={nightStart}
                onChange={(e) => setNightStart(parseInt(e.target.value, 10))}
                className="bg-transparent font-bold text-stone-900 focus:outline-none cursor-pointer text-xs"
              >
                {[20, 21, 22, 23, 0].map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? '00:00' : `${h}:00`}
                  </option>
                ))}
              </select>
              <span className="text-stone-300">{t('reports.gateTimeChart.to')}</span>
              <select
                value={nightEnd}
                onChange={(e) => setNightEnd(parseInt(e.target.value, 10))}
                className="bg-transparent font-bold text-stone-900 focus:outline-none cursor-pointer text-xs"
              >
                {[4, 5, 6, 7, 8].map((h) => (
                  <option key={h} value={h}>
                    {`0${h}:00`}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              disabled={loading}
              className="h-8 px-2.5 text-xs text-stone-600 hover:text-stone-900"
              title={t('reports.gateTimeChart.refreshTitle')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-amber-600' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Top KPI Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-3 mt-3 border-t border-stone-200/60">
          <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs">
            <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-amber-600" /> {t('reports.gateTimeChart.entryFootfall')}
            </span>
            <span className="text-xl font-black text-stone-900 block mt-0.5">
              {formatNumber(summary?.total_visitors || 0)}
            </span>
            <span className="text-[10px] text-stone-400">{t('reports.gateTimeChart.totalPersons')}</span>
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs">
            <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider flex items-center gap-1">
              <Car className="h-3.5 w-3.5 text-sky-600" /> {t('reports.gateTimeChart.cars')}
            </span>
            <span className="text-xl font-black text-stone-900 block mt-0.5">
              {formatNumber(summary?.total_cars || 0)}
            </span>
            <span className="text-[10px] text-stone-400">{t('reports.gateTimeChart.carEntries')}</span>
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-stone-200/80 shadow-2xs">
            <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider flex items-center gap-1">
              <Bike className="h-3.5 w-3.5 text-emerald-600" /> {t('reports.gateTimeChart.bikes')}
            </span>
            <span className="text-xl font-black text-stone-900 block mt-0.5">
              {formatNumber(summary?.total_bikes || 0)}
            </span>
            <span className="text-[10px] text-stone-400">{t('reports.gateTimeChart.bikeEntries')}</span>
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-indigo-200/60 shadow-2xs">
            <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider flex items-center gap-1">
              <Moon className="h-3.5 w-3.5 text-indigo-600" /> {t('reports.gateTimeChart.nightEntry')}
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl font-black text-indigo-900">
                {formatNumber(summary?.nighttime?.visitors || 0)}
              </span>
              <span className="text-xs font-bold text-indigo-600">
                ({summary?.nighttime?.visitors_percent || 0}%)
              </span>
            </div>
            <span className="text-[10px] text-indigo-500/80 font-medium">
              {t('reports.gateTimeChart.vehiclesNight', {
                count: summary?.nighttime?.total_vehicles || 0,
                percent: summary?.nighttime?.vehicles_percent || 0,
              })}
            </span>
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-amber-200/60 shadow-2xs">
            <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1">
              <Flame className="h-3.5 w-3.5 text-amber-600" /> {t('reports.gateTimeChart.peakHours')}
            </span>
            <div className="text-xs font-bold text-stone-900 mt-0.5 truncate">
              {t('reports.gateTimeChart.paxLabel')} <span className="text-amber-700 font-extrabold">{summary?.peak_visitor_hour?.label}</span> ({summary?.peak_visitor_hour?.count})
            </div>
            <div className="text-xs font-bold text-stone-900 mt-0.5 truncate">
              {t('reports.gateTimeChart.vehLabel')} <span className="text-sky-700 font-extrabold">{summary?.peak_vehicle_hour?.label}</span> ({summary?.peak_vehicle_hour?.count})
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {loading ? (
          <div className="py-20 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
            {t('reports.gateTimeChart.analyzingLogs')}
          </div>
        ) : (
          <>
            {/* SVG 24-Hour Time Distribution Chart */}
            <div className="relative w-full select-none">
              <div className="w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 800 ${height}`}
                  className="w-full h-auto min-w-[700px] font-sans"
                  preserveAspectRatio="none"
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }}
                  onMouseLeave={() => setHoveredPoint(null)}
                >
                  {/* Grid Lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = height - paddingBottom - ratio * plotHeight;
                    const val = Math.round(maxMetricValue * ratio);
                    return (
                      <g key={ratio}>
                        <line
                          x1={paddingLeft}
                          y1={y}
                          x2={800 - paddingRight}
                          y2={y}
                          stroke="#f5f5f4"
                          strokeDasharray={ratio === 0 ? undefined : '3 3'}
                          strokeWidth="1"
                        />
                        <text
                          x={paddingLeft - 8}
                          y={y + 3}
                          textAnchor="end"
                          fontSize="9"
                          fill="#a8a29e"
                          fontFamily="monospace"
                        >
                          {val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Hourly Columns */}
                  {hourlyData.map((point) => {
                    const x = paddingLeft + point.hour * colWidth;
                    const isNight = point.is_nighttime;

                    // Bar Heights
                    const visitorH = (point.visitors / maxMetricValue) * plotHeight;
                    const carH = (point.cars / maxMetricValue) * plotHeight;
                    const bikeH = (point.bikes / maxMetricValue) * plotHeight;

                    const baseY = height - paddingBottom;
                    const barW = Math.max(3, colWidth * 0.36);

                    return (
                      <g
                        key={point.hour}
                        className="cursor-pointer transition-opacity hover:opacity-90"
                        onMouseEnter={() => setHoveredPoint(point)}
                      >
                        {/* Nighttime Shaded Column Background */}
                        {isNight && (
                          <rect
                            x={x}
                            y={paddingTop}
                            width={colWidth}
                            height={plotHeight}
                            fill="#eef2ff"
                            opacity="0.6"
                          />
                        )}

                        {/* Hover Column Target Area */}
                        <rect
                          x={x}
                          y={paddingTop}
                          width={colWidth}
                          height={plotHeight}
                          fill="transparent"
                        />

                        {/* Visitors Bar (Amber) */}
                        {(metricView === 'all' || metricView === 'visitors') && point.visitors > 0 && (
                          <rect
                            x={metricView === 'all' ? x + colWidth * 0.12 : x + colWidth * 0.25}
                            y={baseY - visitorH}
                            width={metricView === 'all' ? barW : colWidth * 0.5}
                            height={visitorH}
                            rx="2"
                            fill="#f59e0b"
                          />
                        )}

                        {/* Vehicles Bar (Sky for Cars, Emerald for Bikes) */}
                        {(metricView === 'all' || metricView === 'vehicles') && (
                          <>
                            {point.cars > 0 && (
                              <rect
                                x={metricView === 'all' ? x + colWidth * 0.52 : x + colWidth * 0.25}
                                y={baseY - carH}
                                width={metricView === 'all' ? barW : colWidth * 0.35}
                                height={carH}
                                rx="2"
                                fill="#0284c7"
                              />
                            )}
                            {point.bikes > 0 && (
                              <rect
                                x={metricView === 'all' ? x + colWidth * 0.52 + barW : x + colWidth * 0.62}
                                y={baseY - bikeH}
                                width={metricView === 'all' ? Math.max(2, barW * 0.5) : colWidth * 0.2}
                                height={bikeH}
                                rx="1.5"
                                fill="#10b981"
                              />
                            )}
                          </>
                        )}

                        {/* X-Axis Hour Ticks (Every 2 hours for readability) */}
                        {point.hour % 2 === 0 && (
                          <text
                            x={x + colWidth / 2}
                            y={height - paddingBottom + 16}
                            textAnchor="middle"
                            fontSize="9"
                            fontWeight={isNight ? '700' : '500'}
                            fill={isNight ? '#4338ca' : '#78716c'}
                          >
                            {point.hour === 0 ? '12A' : point.hour === 12 ? '12P' : point.hour > 12 ? `${point.hour - 12}P` : `${point.hour}A`}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Floating Tooltip */}
              {hoveredPoint && (
                <div
                  className="absolute pointer-events-none z-30 bg-stone-900/95 backdrop-blur-xs text-white p-3 rounded-xl shadow-xl border border-stone-700 text-xs w-56"
                  style={{
                    left: `${Math.min(mousePos.x + 15, 540)}px`,
                    top: `${Math.max(10, mousePos.y - 120)}px`,
                  }}
                >
                  <div className="flex items-center justify-between border-b border-stone-800 pb-1.5 mb-2">
                    <span className="font-extrabold text-white text-xs">{hoveredPoint.hour_label}</span>
                    {hoveredPoint.is_nighttime ? (
                      <Badge variant="info" className="text-[10px] py-0 px-1.5 bg-indigo-950 text-indigo-300 border-indigo-700/50 gap-1">
                        <Moon className="h-2.5 w-2.5" /> {t('reports.gateTimeChart.nightWindowBadge')}
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-stone-400">{t('reports.gateTimeChart.daytimeBadge')}</span>
                    )}
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between items-center text-amber-300 font-semibold">
                      <span className="flex items-center gap-1.5"><Users className="h-3 w-3" /> {t('reports.gateTimeChart.peopleEntered')}</span>
                      <strong className="font-black text-sm">{hoveredPoint.visitors}</strong>
                    </div>

                    <div className="flex justify-between items-center text-sky-300">
                      <span className="flex items-center gap-1.5"><Car className="h-3 w-3" /> {t('reports.gateTimeChart.cars')}</span>
                      <strong className="font-bold">{hoveredPoint.cars}</strong>
                    </div>

                    <div className="flex justify-between items-center text-emerald-300">
                      <span className="flex items-center gap-1.5"><Bike className="h-3 w-3" /> {t('reports.gateTimeChart.bikes')}</span>
                      <strong className="font-bold">{hoveredPoint.bikes}</strong>
                    </div>

                    {Object.keys(hoveredPoint.prefixes).length > 0 && (
                      <div className="pt-1.5 mt-1 border-t border-stone-800 text-[11px] text-stone-300">
                        <span className="text-stone-400 block mb-0.5">{t('reports.gateTimeChart.carOrigins')}</span>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(hoveredPoint.prefixes).map(([pref, cnt]) => (
                            <span key={pref} className="bg-stone-800 px-1.5 py-0.5 rounded text-[10px] font-mono">
                              {pref}: {cnt}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Legend and Registration Prefix Distribution */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-stone-100 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-stone-600">
                  <span className="w-3 h-3 rounded-xs bg-amber-500 inline-block" />
                  <span>{t('reports.gateTimeChart.legendVisitors')}</span>
                </div>
                <div className="flex items-center gap-1.5 text-stone-600">
                  <span className="w-3 h-3 rounded-xs bg-sky-600 inline-block" />
                  <span>{t('reports.gateTimeChart.legendCars')}</span>
                </div>
                <div className="flex items-center gap-1.5 text-stone-600">
                  <span className="w-3 h-3 rounded-xs bg-emerald-500 inline-block" />
                  <span>{t('reports.gateTimeChart.legendBikes')}</span>
                </div>
                <div className="flex items-center gap-1.5 text-indigo-700">
                  <span className="w-3 h-3 rounded-xs bg-indigo-100 border border-indigo-200 inline-block" />
                  <span>{t('reports.gateTimeChart.legendNight', { label: data?.night_window?.label })}</span>
                </div>
              </div>

              {/* Registration Prefixes Quick Pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-stone-400">{t('reports.gateTimeChart.carsPrefix')}</span>
                {(summary?.prefixes || []).map((p) => (
                  <span
                    key={p.name}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-100 border border-stone-200 text-[11px] font-medium text-stone-700"
                  >
                    <strong className="text-stone-900">{p.name}</strong>
                    <span>{p.count}</span>
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
