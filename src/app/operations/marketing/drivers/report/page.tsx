"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import {
  getBusinessDateRange,
  type BusinessDatePreset,
} from "@/lib/business-date-ranges";
import type { Visit } from "@/lib/marketing/domain";
import {
  buttonClass,
  downloadCsv,
  ErrorMessage,
  Field,
  inputClass,
  useRemoteJson,
  Status,
} from "@/components/marketing/shared";
interface Report {
  from: string;
  to: string;
  generated_at: string;
  visits: number;
  guest_visits: number;
  guests: number;
  revenue: string;
  eligible: string;
  given: string;
  awaiting: number;
  complete: number;
  avg_guests: string | null;
  avg_billing: string | null;
  avg_incentive: string | null;
  avg_complete_billing: string | null;
  active_drivers: number;
  saved_cards_current: number;
  redeemable_cards_current: number;
  completed_in_period: number;
  redemptions_in_period: number;
  exceptions: Record<string, number>;
  rows: Visit[];
}
const metrics = [
  "visits",
  "guests",
  "revenue",
  "eligible",
  "given",
  "avg_guests",
  "avg_billing",
  "avg_incentive",
  "avg_complete_billing",
  "active_drivers",
  "saved_cards_current",
  "redeemable_cards_current",
  "completed_in_period",
  "redemptions_in_period",
] as const;
export default function TaxiReport() {
  const { t } = useI18n();
  const [preset, setPreset] = useState<BusinessDatePreset>("7d"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1);
  const range = getBusinessDateRange(preset, new Date(), from, to);
  const { data, error, loading } = useRemoteJson<Report>(
    range.status === "ready" && range.from && range.to
      ? `/api/operations/marketing?${new URLSearchParams({ mode: "report", from: range.from, to: range.to, page: String(page) })}`
      : null,
  );
  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <Link href="/operations/marketing/drivers" className="underline">
        {t("marketing.drivers")}
      </Link>
      <h1 className="text-2xl font-bold">{t("marketing.report")}</h1>
      <p>{t("marketing.arrivalBasis")}</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={t("marketing.period")}>
          <select
            className={inputClass}
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value as BusinessDatePreset);
              setPage(1);
            }}
          >
            {["today", "yesterday", "7d", "30d", "this_month", "custom"].map(
              (p) => (
                <option key={p} value={p}>
                  {t(`marketing.periods.${p}`)}
                </option>
              ),
            )}
          </select>
        </Field>
        {preset === "custom" && (
          <>
            <Field label={t("marketing.from")}>
              <input
                type="date"
                className={inputClass}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
            <Field label={t("marketing.to")}>
              <input
                type="date"
                className={inputClass}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
          </>
        )}
      </div>
      <ErrorMessage code={error} />
      {range.status !== "ready" && <p>{t("marketing.emptyRange")}</p>}
      {loading && <p role="status">{t("marketing.loading")}</p>}
      {data && (
        <>
          <p>
            {data.from} — {data.to} ·{" "}
            {t("marketing.coverage", {
              complete: data.complete,
              total: data.guest_visits,
              awaiting: data.awaiting,
            })}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {metrics.map((key) => (
              <div className="rounded-xl border bg-white p-4" key={key}>
                <p className="text-sm text-stone-600">
                  {t(`marketing.reportMetrics.${key}`)}
                </p>
                <p className="text-xl font-bold">{data[key] ?? "—"}</p>
              </div>
            ))}
          </div>
          <p className="text-sm">{t("marketing.currentBalanceHelp")}</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(data.exceptions).map(([state, count]) => (
              <span key={state}>
                <Status value={state} /> {count}
              </span>
            ))}
          </div>
          <button
            className={buttonClass}
            onClick={() =>
              downloadCsv(`taxi-summary-${data.from}-${data.to}.csv`, [
                [t("marketing.from"), data.from],
                [t("marketing.to"), data.to],
                [t("marketing.dateBasis"), t("marketing.arrivalBasis")],
                [t("marketing.generatedAt"), data.generated_at],
                [
                  t("marketing.coverageLabel"),
                  `${data.complete}/${data.guest_visits}`,
                ],
                ...metrics.map((key) => [
                  t(`marketing.reportMetrics.${key}`),
                  data[key],
                ]),
              ])
            }
          >
            {t("marketing.exportSummary")}
          </button>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm text-left">
              <thead>
                <tr>
                  {[
                    "business_date",
                    "name",
                    "registration",
                    "guests",
                    "revenue",
                    "status",
                  ].map((k) => (
                    <th key={k} className="p-3">
                      {t(`marketing.fields.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="p-3">{v.business_date}</td>
                    <td className="p-3">
                      <Link
                        className="underline"
                        href={`/operations/marketing/drivers/${v.driver_id}`}
                      >
                        {v.driver_name_snapshot}
                      </Link>
                    </td>
                    <td className="p-3">{v.registration_snapshot}</td>
                    <td className="p-3">{v.guests}</td>
                    <td className="p-3">₹{v.confirmed_revenue}</td>
                    <td className="p-3">
                      <Status value={v.reconciliation_state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="flex gap-3">
            <button
              className={buttonClass}
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("marketing.previous")}
            </button>
            <span>{t("marketing.page", { page, total: data.visits })}</span>
            <button
              className={buttonClass}
              disabled={page * 100 >= data.visits}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("marketing.next")}
            </button>
          </nav>
        </>
      )}
    </main>
  );
}
