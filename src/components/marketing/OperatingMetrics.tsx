"use client";
import React from "react";
import { useI18n } from "@/lib/i18n/context";
import type { OperatingMetrics as Metrics } from "@/lib/marketing/domain";
import {
  buttonClass,
  downloadCsv,
  ErrorMessage,
  useRemoteJson,
} from "./shared";
const keys = [
  "covers",
  "bills",
  "net_sales",
  "spend_per_cover",
  "spend_per_bill",
  "covers_per_bill",
  "cars",
  "bikes",
  "travellers",
  "buses",
  "covers_per_car",
  "spend_per_car",
] as const;
export function OperatingMetrics({ from, to }: { from: string; to: string }) {
  const { t } = useI18n();
  const { data, error } = useRemoteJson<Metrics>(
    `/api/operations/metrics?${new URLSearchParams({ from, to })}`,
  );
  return (
    <section className="rounded-xl border bg-white p-4 space-y-3">
      <h2 className="text-lg font-bold">{t("marketing.operatingMetrics")}</h2>
      <p className="text-sm text-stone-600">{t("marketing.operatingScope")}</p>
      <ErrorMessage code={error} />
      {!data && !error && <p>{t("marketing.loading")}</p>}
      {data && (
        <>
          {!data.complete && (
            <p role="status" className="rounded bg-amber-50 p-2">
              {t(data.live ? "marketing.liveData" : "marketing.pendingSales")} ·{" "}
              {t("marketing.importCoverage", {
                imported: data.imported_days,
                total: data.expected_days,
              })}
            </p>
          )}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {keys.map((k) => (
              <div key={k}>
                <dt className="text-xs text-stone-500">
                  {t(`marketing.operating.${k}`)}
                </dt>
                <dd className="text-lg font-semibold">
                  {data.imported_days === 0 &&
                  !["cars", "bikes", "buses", "travellers"].includes(k)
                    ? "—"
                    : (data[k] ?? "—")}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-stone-500">{t("marketing.ratioHelp")}</p>
          <button
            className={buttonClass}
            onClick={() =>
              downloadCsv(`operating-metrics-${from}-${to}.csv`, [
                [t("marketing.from"), from],
                [t("marketing.to"), to],
                [t("marketing.generatedAt"), new Date().toISOString()],
                [
                  t("marketing.coverageLabel"),
                  `${data.imported_days}/${data.expected_days}`,
                ],
                [t("marketing.complete"), data.complete],
                ...keys.map((k) => [
                  t(`marketing.operating.${k}`),
                  data.imported_days === 0 &&
                  !["cars", "bikes", "buses", "travellers"].includes(k)
                    ? null
                    : data[k],
                ]),
              ])
            }
          >
            {t("marketing.exportSummary")}
          </button>
        </>
      )}
    </section>
  );
}
