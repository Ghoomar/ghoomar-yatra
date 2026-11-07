"use client";
import React, { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { GateAnalyticsResponse } from "@/app/api/operations/gate/analytics/route";
import {
  ErrorMessage,
  inputClass,
  Field,
  useRemoteJson,
} from "@/components/marketing/shared";
interface Props {
  selectedDate: string;
  startDate?: string;
  endDate?: string;
  onDateChange?: (date: string) => void;
}
const groups = ["cars", "bikes", "travellers", "buses"] as const;
const colors = {
  cars: "#0284c7",
  bikes: "#059669",
  travellers: "#d97706",
  buses: "#7c3aed",
};
export function GateTimeAnalyticsChart({
  selectedDate,
  startDate,
  endDate,
}: Props) {
  const { t, locale } = useI18n();
  const [nightStart, setNightStart] = useState(23),
    [nightEnd, setNightEnd] = useState(6);
  const { data, error } = useRemoteJson<GateAnalyticsResponse>(
    `/api/operations/gate/analytics?${new URLSearchParams({ start_date: startDate || selectedDate, end_date: endDate || selectedDate, locale, night_start: String(nightStart), night_end: String(nightEnd) })}`,
  );
  const max = Math.max(
    1,
    ...(data?.hourly_data.map((h) => h.total_vehicles) || []),
  );
  return (
    <section className="space-y-4 mt-3">
      <h3 className="font-bold">{t("marketing.hourlyVehicles")}</h3>
      <div className="grid grid-cols-2 gap-3 max-w-sm">
        {[
          ["nightStart", nightStart, setNightStart],
          ["nightEnd", nightEnd, setNightEnd],
        ].map(([key, value, setter]) => (
          <Field key={String(key)} label={t(`marketing.${key}`)}>
            <select
              className={inputClass}
              value={value as number}
              onChange={(e) =>
                (setter as (n: number) => void)(Number(e.target.value))
              }
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option value={h} key={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      <ErrorMessage code={error} />
      {!data && !error && <p>{t("marketing.loading")}</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {groups.map((g) => (
              <p key={g}>
                {t(`marketing.operating.${g}`)}:{" "}
                <strong>{data.summary[`total_${g}`]}</strong>
              </p>
            ))}
          </div>
          <p>
            {t("marketing.nightVehicles", {
              count: data.summary.nighttime.total_vehicles,
              percent: data.summary.nighttime.vehicles_percent,
            })}{" "}
            ·{" "}
            {t("marketing.peakVehicles", {
              hour: data.summary.peak_vehicle_hour.label,
              count: data.summary.peak_vehicle_hour.count,
            })}
          </p>
          <div className="overflow-x-auto">
            <svg
              viewBox="0 0 760 220"
              className="min-w-[620px] w-full"
              role="img"
              aria-label={t("marketing.hourlyVehicles")}
            >
              {data.hourly_data.map((h) => {
                let bottom = 190;
                return (
                  <g key={h.hour}>
                    <title>
                      {h.hour_label}:{" "}
                      {groups
                        .map((g) => `${t(`marketing.operating.${g}`)} ${h[g]}`)
                        .join(", ")}
                    </title>
                    {h.is_nighttime && (
                      <rect
                        x={h.hour * 30 + 20}
                        y={10}
                        width={28}
                        height={180}
                        fill="#eef2ff"
                      />
                    )}
                    {groups.map((g) => {
                      const height = (h[g] / max) * 170;
                      bottom -= height;
                      return (
                        <rect
                          key={g}
                          x={h.hour * 30 + 24}
                          y={bottom}
                          width={20}
                          height={height}
                          fill={colors[g]}
                        />
                      );
                    })}
                    <text
                      x={h.hour * 30 + 34}
                      y={210}
                      textAnchor="middle"
                      fontSize={9}
                    >
                      {h.hour}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="flex flex-wrap gap-4">
            {groups.map((g) => (
              <span key={g} className="flex items-center gap-1 text-xs">
                <i
                  className="h-3 w-3 rounded"
                  style={{ background: colors[g] }}
                />
                {t(`marketing.operating.${g}`)}
              </span>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer py-2">
              {t("marketing.hourlyTable")}
            </summary>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>{t("marketing.hour")}</th>
                  {groups.map((g) => (
                    <th key={g}>{t(`marketing.operating.${g}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.hourly_data.map((h) => (
                  <tr key={h.hour}>
                    <td>{h.hour_label}</td>
                    {groups.map((g) => (
                      <td key={g} className="text-center">
                        {h[g]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <div className="flex flex-wrap gap-3">
            {data.summary.prefixes.map((p) => (
              <span key={p.name}>
                {p.name}: {p.count} ({p.percent}%)
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
