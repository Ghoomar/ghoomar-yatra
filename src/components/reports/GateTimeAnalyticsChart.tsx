"use client";

import React, { useState, useMemo } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { GateAnalyticsResponse } from "@/app/api/operations/gate/analytics/route";
import { ErrorMessage, useRemoteJson } from "@/components/marketing/shared";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatNumber } from "@/lib/utils";
import {
  Car,
  Bike,
  Bus,
  Clock,
  Moon,
  TrendingUp,
  MapPin,
  ChevronDown,
  ChevronUp,
  Loader2,
  Calendar,
} from "lucide-react";

interface Props {
  selectedDate: string;
  startDate?: string;
  endDate?: string;
  onDateChange?: (date: string) => void;
}

const groups = ["cars", "bikes", "travellers", "buses"] as const;

const colors = {
  cars: "#0284c7",       // Sky blue
  bikes: "#059669",      // Emerald green
  travellers: "#d97706", // Amber
  buses: "#7c3aed",      // Purple
};

export function GateTimeAnalyticsChart({
  selectedDate,
  startDate,
  endDate,
}: Props) {
  const { t, locale } = useI18n();
  const [nightStart, setNightStart] = useState(23);
  const [nightEnd, setNightEnd] = useState(6);
  const [showAllOrigins, setShowAllOrigins] = useState(false);
  const [isHourlyTableOpen, setIsHourlyTableOpen] = useState(false);

  const { data, error, loading } = useRemoteJson<GateAnalyticsResponse>(
    `/api/operations/gate/analytics?${new URLSearchParams({
      start_date: startDate || selectedDate,
      end_date: endDate || selectedDate,
      locale,
      night_start: String(nightStart),
      night_end: String(nightEnd),
    })}`
  );

  const maxVehicles = Math.max(
    1,
    ...(data?.hourly_data.map((h) => h.total_vehicles) || [])
  );

  // Group prefixes for display
  const allPrefixes = useMemo(() => {
    return data?.summary?.prefixes || [];
  }, [data?.summary?.prefixes]);

  const displayedPrefixes = useMemo(() => {
    if (showAllOrigins) return allPrefixes;
    return allPrefixes.slice(0, 14);
  }, [allPrefixes, showAllOrigins]);

  return (
    <Card className="border-[#E7E2D8] shadow-xs overflow-hidden mt-4">
      {/* 1. HEADER */}
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E7E2D8]/80">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Car className="h-4 w-4 text-amber-600" />
            <CardTitle className="text-base font-bold text-stone-900">
              {t("marketing.hourlyVehicles")}
            </CardTitle>
            {data && (
              <Badge variant="purple" className="font-mono text-[10px] font-bold">
                {formatNumber(data.summary.total_vehicles)} {locale === "hi" ? "कुल वाहन" : "total"}
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs text-stone-500">
            {locale === "hi"
              ? "गेट पर 24 घंटे की वाहन आवक, श्रेणी विभाजन व कार उत्पत्ति क्षेत्र"
              : "24-hour gate vehicle arrival pattern, vehicle fleet breakdown and origin distribution"}
          </CardDescription>
        </div>

        {/* Night Window Selectors */}
        <div className="flex items-center gap-2 bg-[#FAF8F5] border border-stone-200/80 rounded-xl p-1.5 self-start sm:self-auto text-xs">
          <div className="flex items-center gap-1.5 px-1.5 text-stone-600">
            <Moon className="h-3.5 w-3.5 text-indigo-600" />
            <span className="font-semibold text-[11px]">{locale === "hi" ? "रात्रि समय:" : "Night Window:"}</span>
          </div>

          <div className="flex items-center gap-1 text-xs">
            <select
              value={nightStart}
              onChange={(e) => setNightStart(Number(e.target.value))}
              className="h-8 px-2 rounded-lg border border-stone-300 bg-white font-mono text-xs font-bold text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option value={h} key={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            <span className="text-stone-400 font-bold">−</span>
            <select
              value={nightEnd}
              onChange={(e) => setNightEnd(Number(e.target.value))}
              className="h-8 px-2 rounded-lg border border-stone-300 bg-white font-mono text-xs font-bold text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option value={h} key={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-6">
        <ErrorMessage code={error} />

        {loading && !data && (
          <div className="py-16 flex flex-col items-center justify-center space-y-2 text-stone-500">
            <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
            <span className="text-xs font-semibold">{t("marketing.loading")}</span>
          </div>
        )}

        {data && (
          <>
            {/* 2. FLEET VOLUME SUMMARY CARDS */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* Cars */}
              <div className="p-3.5 rounded-xl border border-sky-200/80 bg-sky-50/40 space-y-1">
                <div className="flex items-center justify-between text-sky-800">
                  <span className="text-[11px] font-bold uppercase tracking-wider">
                    {t("marketing.operating.cars")}
                  </span>
                  <Car className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl sm:text-2xl font-black font-mono text-sky-950">
                    {formatNumber(data.summary.total_cars)}
                  </span>
                </div>
              </div>

              {/* Bikes */}
              <div className="p-3.5 rounded-xl border border-emerald-200/80 bg-emerald-50/40 space-y-1">
                <div className="flex items-center justify-between text-emerald-800">
                  <span className="text-[11px] font-bold uppercase tracking-wider">
                    {t("marketing.operating.bikes")}
                  </span>
                  <Bike className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl sm:text-2xl font-black font-mono text-emerald-950">
                    {formatNumber(data.summary.total_bikes)}
                  </span>
                </div>
              </div>

              {/* Travellers */}
              <div className="p-3.5 rounded-xl border border-amber-200/80 bg-amber-50/40 space-y-1">
                <div className="flex items-center justify-between text-amber-800">
                  <span className="text-[11px] font-bold uppercase tracking-wider truncate">
                    {t("marketing.operating.travellers")}
                  </span>
                  <Bus className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl sm:text-2xl font-black font-mono text-amber-950">
                    {formatNumber(data.summary.total_travellers)}
                  </span>
                </div>
              </div>

              {/* Large Buses */}
              <div className="p-3.5 rounded-xl border border-purple-200/80 bg-purple-50/40 space-y-1">
                <div className="flex items-center justify-between text-purple-800">
                  <span className="text-[11px] font-bold uppercase tracking-wider">
                    {t("marketing.operating.buses")}
                  </span>
                  <Bus className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl sm:text-2xl font-black font-mono text-purple-950">
                    {formatNumber(data.summary.total_buses)}
                  </span>
                </div>
              </div>
            </div>

            {/* Highlights Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[#FAF8F5] border border-stone-200/80 text-xs text-stone-600">
              <div className="flex items-center gap-1.5">
                <Moon className="h-3.5 w-3.5 text-indigo-600" />
                <span>
                  {t("marketing.nightVehicles", {
                    count: data.summary.nighttime.total_vehicles,
                    percent: data.summary.nighttime.vehicles_percent,
                  })}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
                <span>
                  {t("marketing.peakVehicles", {
                    hour: data.summary.peak_vehicle_hour.label,
                    count: data.summary.peak_vehicle_hour.count,
                  })}
                </span>
              </div>
            </div>

            {/* 3. HOURLY STACKED BAR CHART */}
            <div className="space-y-3">
              <div className="overflow-x-auto pb-2">
                <svg
                  viewBox="0 0 760 220"
                  className="min-w-[660px] w-full"
                  role="img"
                  aria-label={t("marketing.hourlyVehicles")}
                >
                  {/* Subtle Grid Lines */}
                  {[0.25, 0.5, 0.75, 1].map((pct) => {
                    const y = 190 - pct * 160;
                    return (
                      <line
                        key={pct}
                        x1={20}
                        y1={y}
                        x2={740}
                        y2={y}
                        stroke="#E7E2D8"
                        strokeDasharray="3 3"
                        strokeWidth="0.8"
                      />
                    );
                  })}

                  {/* 24-Hour Stacked Bars */}
                  {data.hourly_data.map((h) => {
                    let bottom = 190;
                    return (
                      <g key={h.hour} className="group cursor-pointer">
                        <title>
                          {h.hour_label}:{" "}
                          {groups
                            .map((g) => `${t(`marketing.operating.${g}`)} ${h[g]}`)
                            .join(", ")}
                        </title>

                        {/* Nighttime Shading Band */}
                        {h.is_nighttime && (
                          <rect
                            x={h.hour * 30 + 19}
                            y={15}
                            width={26}
                            height={175}
                            fill="#EEF2FF"
                            fillOpacity="0.8"
                            rx={4}
                          />
                        )}

                        {/* Stacked Categories */}
                        {groups.map((g) => {
                          const height = maxVehicles > 0 ? (h[g] / maxVehicles) * 160 : 0;
                          bottom -= height;
                          return (
                            <rect
                              key={g}
                              x={h.hour * 30 + 22}
                              y={bottom}
                              width={20}
                              height={height}
                              fill={colors[g]}
                              rx={1.5}
                              className="transition-opacity hover:opacity-85"
                            />
                          );
                        })}

                        {/* Hour Label */}
                        <text
                          x={h.hour * 30 + 32}
                          y={208}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight={h.hour % 3 === 0 ? "bold" : "normal"}
                          fill="#78716C"
                          className="font-mono"
                        >
                          {String(h.hour).padStart(2, "0")}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Chart Legend */}
              <div className="flex flex-wrap items-center justify-center gap-4 pt-1 border-t border-stone-100 text-xs">
                {groups.map((g) => (
                  <span key={g} className="inline-flex items-center gap-1.5 font-medium text-stone-700">
                    <span
                      className="h-3 w-3 rounded-sm shadow-2xs"
                      style={{ background: colors[g] }}
                    />
                    <span>{t(`marketing.operating.${g}`)}</span>
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5 font-medium text-stone-500 ml-2">
                  <span className="h-3 w-3 rounded-sm bg-indigo-100 border border-indigo-200" />
                  <span>{locale === "hi" ? "रात्रि घंटे" : "Night Hours"}</span>
                </span>
              </div>
            </div>

            {/* 4. CAR ORIGINS BREAKDOWN (FIXING THE 15-LINE TEXT WALL) */}
            <div className="space-y-3 pt-2 border-t border-[#E7E2D8]/80">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-amber-600" />
                  <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                    {locale === "hi" ? "कार आगमन उत्पत्ति क्षेत्र" : "Car Origins Breakdown"}
                  </h4>
                </div>
                <span className="text-[11px] text-stone-400 font-medium">
                  {allPrefixes.length} {locale === "hi" ? "क्षेत्र दर्ज" : "origins recorded"}
                </span>
              </div>

              {allPrefixes.length === 0 ? (
                <div className="py-4 text-center text-xs text-stone-400 bg-stone-50 rounded-xl border border-dashed border-stone-200">
                  {locale === "hi" ? "कोई कार आगमन डेटा उपलब्ध नहीं है" : "No car origin events recorded"}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {/* Clean Badge Grid */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {displayedPrefixes.map((p) => {
                      const isHighVolume = Number(p.percent) >= 5;
                      return (
                        <div
                          key={p.name}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border shadow-2xs transition-colors ${
                            isHighVolume
                              ? "bg-amber-50/80 border-amber-300 text-stone-900 font-bold"
                              : "bg-white border-stone-200/90 text-stone-800 hover:border-amber-300"
                          }`}
                        >
                          <span className="text-xs">{p.name}</span>
                          <span className="text-xs font-black font-mono text-amber-700">
                            {p.count}
                          </span>
                          <span className="text-[10px] text-stone-400 font-mono">
                            ({p.percent}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Toggle to expand remaining origins if > 14 */}
                  {allPrefixes.length > 14 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllOrigins(!showAllOrigins)}
                      className="gap-1 text-xs text-amber-800 hover:text-amber-900"
                    >
                      <span>
                        {showAllOrigins
                          ? locale === "hi"
                            ? "संक्षिप्त सूची दिखाएं"
                            : "Show less"
                          : locale === "hi"
                          ? `अन्य सभी ${allPrefixes.length - 14} क्षेत्र देखें`
                          : `View all remaining ${allPrefixes.length - 14} origins`}
                      </span>
                      {showAllOrigins ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* 5. HOURLY BREAKDOWN TABLE (Clean Collapsible Card) */}
            <div className="pt-2 border-t border-[#E7E2D8]/80">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsHourlyTableOpen(!isHourlyTableOpen)}
                className="w-full justify-between text-xs font-semibold text-stone-700 bg-stone-50/60"
              >
                <span className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-stone-500" />
                  <span>{t("marketing.hourlyTable")} (24 Hours)</span>
                </span>
                {isHourlyTableOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>

              {isHourlyTableOpen && (
                <div className="mt-3 overflow-x-auto rounded-xl border border-[#E7E2D8] bg-white animate-in fade-in duration-150">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-[#E7E2D8] bg-[#F8F5F0]/80 font-bold text-stone-500 uppercase tracking-wider">
                        <th className="py-2.5 px-3">{t("marketing.hour")}</th>
                        {groups.map((g) => (
                          <th key={g} className="py-2.5 px-3 text-right">
                            {t(`marketing.operating.${g}`)}
                          </th>
                        ))}
                        <th className="py-2.5 px-3 text-right font-black">
                          {locale === "hi" ? "कुल वाहन" : "Total"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 font-mono">
                      {data.hourly_data.map((h) => (
                        <tr
                          key={h.hour}
                          className={`hover:bg-[#FAF8F5] transition-colors ${
                            h.is_nighttime ? "bg-indigo-50/20" : ""
                          }`}
                        >
                          <td className="py-2 px-3 font-semibold text-stone-800">
                            {h.hour_label}
                          </td>
                          {groups.map((g) => (
                            <td key={g} className="py-2 px-3 text-right text-stone-700">
                              {h[g] > 0 ? h[g] : "—"}
                            </td>
                          ))}
                          <td className="py-2 px-3 text-right font-black text-stone-900">
                            {h.total_vehicles > 0 ? h.total_vehicles : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
