'use client';

import React, { useState, useMemo } from 'react';
import { HourlyCategoryDataPoint } from '@/lib/types/sales';
import { formatINR } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { getCategoryColor } from '@/lib/constants/category-colors';

interface HourlyCategoryStackedBarChartProps {
  hourlyData: HourlyCategoryDataPoint[];
  parentCategoriesList: string[];
  categoryColors?: Record<string, string>;
}

export function HourlyCategoryStackedBarChart({
  hourlyData,
  parentCategoriesList,
  categoryColors,
}: HourlyCategoryStackedBarChartProps) {
  const { t } = useI18n();
  const [hoveredHour, setHoveredHour] = useState<HourlyCategoryDataPoint | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Filter hours to display: only show hours between 11 AM and 1 AM (or hours with sales)
  const activeHours = useMemo(() => {
    // Check if there are any non-zero hours
    const hasSales = hourlyData.some((h) => h.total_sales > 0);
    if (!hasSales) return hourlyData.slice(10, 24); // default 10 AM to 11 PM
    
    // Find min and max hour with sales, with 1 hr buffer
    const hoursWithSales = hourlyData.filter((h) => h.total_sales > 0).map((h) => h.hour);
    const minH = Math.max(0, Math.min(...hoursWithSales) - 1);
    const maxH = Math.min(23, Math.max(...hoursWithSales) + 1);

    return hourlyData.filter((h) => h.hour >= minH && h.hour <= maxH);
  }, [hourlyData]);

  const maxHourlySales = useMemo(() => {
    const maxVal = Math.max(...activeHours.map((h) => h.total_sales), 1000);
    return Math.ceil(maxVal / 1000) * 1000;
  }, [activeHours]);

  // SVG dimensions
  const height = 260;
  const paddingLeft = 55;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 40;

  return (
    <div className="relative w-full select-none">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 800 ${height}`}
          className="w-full h-auto min-w-[650px] font-sans"
          preserveAspectRatio="none"
        >
          {/* Y-Axis Grid Lines & Ticks */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const val = maxHourlySales * ratio;
            const y = height - paddingBottom - ratio * (height - paddingTop - paddingBottom);
            return (
              <g key={ratio}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={800 - paddingRight}
                  y2={y}
                  stroke="#e7e5e4"
                  strokeDasharray={ratio === 0 ? undefined : '3 3'}
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-stone-400 text-[10px] font-mono"
                >
                  {ratio === 0 ? '₹0' : formatINR(val, true)}
                </text>
              </g>
            );
          })}

          {/* Stacked Columns */}
          {activeHours.map((hData, colIdx) => {
            const numCols = activeHours.length;
            const availableWidth = 800 - paddingLeft - paddingRight;
            const colWidth = (availableWidth / numCols) * 0.65;
            const colX = paddingLeft + (colIdx + 0.5) * (availableWidth / numCols) - colWidth / 2;

            const chartHeight = height - paddingTop - paddingBottom;
            let currentBottomY = height - paddingBottom;

            // Segment categories
            const categoryEntries = Object.entries(hData.categories);

            return (
              <g
                key={hData.hour}
                className="cursor-pointer transition-opacity"
                onMouseEnter={(e) => {
                  setHoveredHour(hData);
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMousePos({ x: rect.x + colWidth / 2, y: rect.y });
                }}
                onMouseLeave={() => setHoveredHour(null)}
              >
                {/* Background hover bar */}
                <rect
                  x={paddingLeft + colIdx * (availableWidth / numCols)}
                  y={paddingTop}
                  width={availableWidth / numCols}
                  height={chartHeight}
                  fill="transparent"
                  className="hover:fill-stone-100/50 transition-colors"
                />

                {/* Stacked Segments */}
                {categoryEntries.map(([catName, catData], segIdx) => {
                  const segHeight = (catData.amount / maxHourlySales) * chartHeight;
                  const segY = currentBottomY - segHeight;
                  currentBottomY = segY;

                  return (
                    <rect
                      key={catName}
                      x={colX}
                      y={segY}
                      width={colWidth}
                      height={Math.max(1, segHeight)}
                      fill={getCategoryColor(catName, categoryColors)}
                      rx={segIdx === categoryEntries.length - 1 ? 3 : 0}
                      className="transition-all duration-200"
                    />
                  );
                })}

                {/* Total amount on top of bar if space permits */}
                {hData.total_sales > 0 && (
                  <text
                    x={colX + colWidth / 2}
                    y={currentBottomY - 5}
                    textAnchor="middle"
                    className="fill-stone-700 text-[9px] font-bold font-mono"
                  >
                    {formatINR(hData.total_sales, true)}
                  </text>
                )}

                {/* X-Axis Hour Label */}
                <text
                  x={colX + colWidth / 2}
                  y={height - paddingBottom + 16}
                  textAnchor="middle"
                  className="fill-stone-500 text-[10px] font-medium"
                >
                  {hData.hour_label.replace(':00', '')}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Floating Tooltip */}
      {hoveredHour && hoveredHour.total_sales > 0 && (
        <div className="absolute top-2 right-4 z-20 bg-stone-900/95 text-white rounded-xl p-3 shadow-xl text-xs backdrop-blur-sm border border-stone-700 max-w-xs pointer-events-none animate-in fade-in">
          <div className="flex items-center justify-between border-b border-stone-700 pb-1.5 mb-2 gap-4">
            <span className="font-bold text-amber-400">{hoveredHour.hour_label}</span>
            <span className="font-mono font-bold text-sm">{formatINR(hoveredHour.total_sales)}</span>
          </div>
          <div className="text-[11px] text-stone-300 mb-2">
            {t('finance.sales.analytics.hourlyChart.tooltipSold')}{' '}
            <span className="font-semibold text-white">{hoveredHour.total_quantity}</span>
          </div>

          <div className="space-y-1">
            {Object.entries(hoveredHour.categories)
              .sort(([, a], [, b]) => b.amount - a.amount)
              .map(([cat, d], idx) => {
                const percent = Math.round((d.amount / hoveredHour.total_sales) * 100);
                return (
                  <div key={cat} className="flex items-center justify-between text-[11px] gap-3">
                    <div className="flex items-center gap-1.5 truncate">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: getCategoryColor(cat, categoryColors) }}
                      />
                      <span className="truncate">{cat}</span>
                    </div>
                    <div className="text-right shrink-0 font-mono text-stone-300">
                      <span>{formatINR(d.amount)}</span>
                      <span className="text-[10px] text-stone-400 ml-1">({percent}%)</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Category Legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-3 border-t border-stone-100 text-xs">
        {parentCategoriesList.slice(0, 10).map((cat) => (
          <div key={cat} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: getCategoryColor(cat, categoryColors) }}
            />
            <span className="text-stone-600 font-medium text-[11px]">{cat}</span>
          </div>
        ))}
        {parentCategoriesList.length > 10 && (
          <span className="text-stone-400 text-[11px]">
            {t('finance.sales.analytics.hourlyChart.moreCategories', {
              count: parentCategoriesList.length - 10,
            })}
          </span>
        )}
      </div>
    </div>
  );
}
