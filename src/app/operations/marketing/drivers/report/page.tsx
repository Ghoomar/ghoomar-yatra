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
  downloadCsv,
  ErrorMessage,
  useRemoteJson,
  Status,
} from "@/components/marketing/shared";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatINR, formatNumber, formatNullablePrice } from "@/lib/utils";
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Download,
  Users,
  Car,
  TrendingUp,
  Award,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Layers,
  IndianRupee,
} from "lucide-react";

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

const PRESET_OPTIONS: { id: BusinessDatePreset; labelKey: string }[] = [
  { id: "today", labelKey: "marketing.periods.today" },
  { id: "yesterday", labelKey: "marketing.periods.yesterday" },
  { id: "7d", labelKey: "marketing.periods.7d" },
  { id: "30d", labelKey: "marketing.periods.30d" },
  { id: "this_month", labelKey: "marketing.periods.this_month" },
  { id: "custom", labelKey: "marketing.periods.custom" },
];

export default function TaxiReport() {
  const { t, locale } = useI18n();
  const [preset, setPreset] = useState<BusinessDatePreset>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const range = getBusinessDateRange(preset, new Date(), from, to);

  const { data, error, loading } = useRemoteJson<Report>(
    range.status === "ready" && range.from && range.to
      ? `/api/operations/marketing?${new URLSearchParams({
          mode: "report",
          from: range.from,
          to: range.to,
          page: String(page),
        })}`
      : null
  );

  const totalPages = data ? Math.ceil(data.visits / 100) || 1 : 1;

  return (
    <main className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* 1. BACK LINK & PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-200/80 pb-4">
        <div className="space-y-1">
          <Link
            href="/operations/marketing/drivers"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800 transition-colors mb-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t("marketing.backToDrivers")}</span>
          </Link>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight">
              {t("marketing.report")}
            </h1>
            <Badge variant="purple" className="gap-1 font-semibold text-xs">
              <BarChart3 className="h-3.5 w-3.5" />
              <span>{locale === "hi" ? "प्रदर्शन समीक्षा" : "Analytics"}</span>
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-stone-500 max-w-2xl">
            {t("marketing.arrivalBasis")}
          </p>
        </div>

        {data && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
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
              className="gap-2"
            >
              <Download className="h-4 w-4 text-amber-600" />
              <span>{t("marketing.exportSummary")}</span>
            </Button>
          </div>
        )}
      </div>

      {/* 2. DATE PRESET SELECTOR & CUSTOM RANGE */}
      <Card className="p-4 border-[#E7E2D8] shadow-xs space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setPreset(opt.id);
                setPage(1);
              }}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                preset === opt.id
                  ? "bg-amber-500 text-stone-950 shadow-xs"
                  : "bg-white border border-stone-200 text-stone-600 hover:text-stone-900 hover:bg-stone-50"
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="pt-2 border-t border-stone-200/80 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-medium text-stone-700">
              <span>{t("marketing.from")}:</span>
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                className="h-9 px-3 rounded-lg border border-stone-300 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>
            <div className="flex items-center gap-2 text-xs font-medium text-stone-700">
              <span>{t("marketing.to")}:</span>
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                className="h-9 px-3 rounded-lg border border-stone-300 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>
          </div>
        )}
      </Card>

      <ErrorMessage code={error} />
      {range.status !== "ready" && (
        <Card className="p-8 text-center text-stone-500 text-xs border-dashed">
          {t("marketing.emptyRange")}
        </Card>
      )}

      {loading && (
        <div className="py-20 flex flex-col items-center justify-center space-y-3 text-stone-500">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
          <p className="text-xs font-semibold">{t("marketing.loading")}</p>
        </div>
      )}

      {data && !loading && (
        <div className="space-y-6">
          {/* 3. COVERAGE & STATUS BANNER */}
          <div className="p-4 rounded-xl border border-stone-200 bg-stone-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-stone-900">
                {data.from} — {data.to}
              </span>
              <span className="text-stone-300">·</span>
              <span className="text-stone-600">
                {t("marketing.coverage", {
                  complete: data.complete,
                  total: data.guest_visits,
                  awaiting: data.awaiting,
                })}
              </span>
            </div>

            {/* Exception Badges */}
            <div className="flex flex-wrap items-center gap-1.5">
              {Object.entries(data.exceptions).map(([state, count]) => (
                <div
                  key={state}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-stone-200 text-[11px] font-semibold text-stone-700 shadow-2xs"
                >
                  <Status value={state} />
                  <span className="font-bold text-stone-900">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 4. GROUPED EXECUTIVE KPI METRIC CARDS */}
          <div className="space-y-4">
            {/* Group 1: Volume & Footfall */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-stone-700 uppercase tracking-wider">
                <Car className="h-3.5 w-3.5 text-amber-600" />
                <span>{locale === "hi" ? "आगमन व फुटफॉल" : "Volume & Arrivals"}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.visits")}
                  </p>
                  <p className="text-xl font-black text-stone-900">
                    {formatNumber(data.visits)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {locale === "hi" ? "सवारी वाली विज़िट" : "Guest Visits"}
                  </p>
                  <p className="text-xl font-black text-amber-700">
                    {formatNumber(data.guest_visits)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.guests")}
                  </p>
                  <p className="text-xl font-black text-stone-900">
                    {formatNumber(data.guests)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.active_drivers")}
                  </p>
                  <p className="text-xl font-black text-stone-900">
                    {formatNumber(data.active_drivers)}
                  </p>
                </div>
              </div>
            </div>

            {/* Group 2: Revenue & Incentives */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-stone-700 uppercase tracking-wider">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                <span>{locale === "hi" ? "राजस्व व इंसेंटिव" : "Revenue & Incentives"}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.revenue")}
                  </p>
                  <p className="text-xl font-black text-stone-900 font-mono">
                    {formatNullablePrice(data.revenue)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.eligible")}
                  </p>
                  <p className="text-xl font-black text-amber-800 font-mono">
                    {formatNullablePrice(data.eligible)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.given")}
                  </p>
                  <p className="text-xl font-black text-stone-900 font-mono">
                    {formatNullablePrice(data.given)}
                  </p>
                </div>
              </div>
            </div>

            {/* Group 3: Unit Economics & Averages */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-stone-700 uppercase tracking-wider">
                <Layers className="h-3.5 w-3.5 text-purple-600" />
                <span>{locale === "hi" ? "इकाई अर्थशास्त्र व औसत" : "Unit Economics & Averages"}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.avg_guests")}
                  </p>
                  <p className="text-xl font-black text-stone-900">
                    {data.avg_guests ? `${data.avg_guests} pax` : "—"}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.avg_billing")}
                  </p>
                  <p className="text-xl font-black text-stone-900 font-mono">
                    {formatNullablePrice(data.avg_billing)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.avg_incentive")}
                  </p>
                  <p className="text-xl font-black text-stone-900 font-mono">
                    {formatNullablePrice(data.avg_incentive)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.avg_complete_billing")}
                  </p>
                  <p className="text-xl font-black text-stone-900 font-mono">
                    {formatNullablePrice(data.avg_complete_billing)}
                  </p>
                </div>
              </div>
            </div>

            {/* Group 4: Loyalty Program Performance */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-stone-700 uppercase tracking-wider">
                <Award className="h-3.5 w-3.5 text-amber-600" />
                <span>{locale === "hi" ? "लॉयल्टी कार्ड मेट्रिक्स" : "Loyalty Cards Dynamics"}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.saved_cards_current")}
                  </p>
                  <p className="text-xl font-black text-stone-900">
                    {formatNumber(data.saved_cards_current)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.redeemable_cards_current")}
                  </p>
                  <p className="text-xl font-black text-amber-700">
                    {formatNumber(data.redeemable_cards_current)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.completed_in_period")}
                  </p>
                  <p className="text-xl font-black text-stone-900">
                    {formatNumber(data.completed_in_period)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-[#E7E2D8] bg-white shadow-2xs space-y-1">
                  <p className="text-xs text-stone-500 font-medium">
                    {t("marketing.reportMetrics.redemptions_in_period")}
                  </p>
                  <p className="text-xl font-black text-stone-900">
                    {formatNumber(data.redemptions_in_period)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-stone-400">
            {t("marketing.currentBalanceHelp")}
          </p>

          {/* 5. RECONCILED VISITS TABLE */}
          <Card className="p-0 overflow-hidden border-[#E7E2D8] shadow-xs">
            <div className="p-4 border-b border-[#E7E2D8] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-amber-600" />
                <h3 className="font-bold text-stone-900 text-sm">
                  {locale === "hi" ? "विज़िट विवरण" : "Reconciled Visits"}
                </h3>
                <Badge variant="outline" className="font-mono text-xs">
                  {data.visits}
                </Badge>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E7E2D8] bg-[#F8F5F0]/80 font-bold text-stone-500 uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">{t("marketing.fields.business_date")}</th>
                    <th className="py-3 px-4">{t("marketing.fields.name")}</th>
                    <th className="py-3 px-4">{t("marketing.fields.registration")}</th>
                    <th className="py-3 px-4">{t("marketing.fields.guests")}</th>
                    <th className="py-3 px-4">{t("marketing.fields.revenue")}</th>
                    <th className="py-3 px-4">{t("marketing.fields.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E2D8]/60">
                  {data.rows.map((v) => (
                    <tr
                      key={v.id}
                      className="hover:bg-[#FAF8F5] transition-colors group"
                    >
                      <td className="py-3 px-4 font-medium text-stone-800">
                        {v.business_date}
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          href={`/operations/marketing/drivers/${v.driver_id}`}
                          className="font-bold text-stone-900 hover:text-amber-800 transition-colors"
                        >
                          {v.driver_name_snapshot}
                        </Link>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex px-2 py-0.5 rounded bg-[#FACC15] border border-[#CA8A04] text-stone-950 font-mono font-bold text-[11px]">
                          {v.registration_snapshot}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium text-stone-700">
                        {v.guests}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-stone-900">
                        ₹{v.confirmed_revenue}
                      </td>
                      <td className="py-3 px-4">
                        <Status value={v.reconciliation_state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {data.visits > 100 && (
              <div className="p-4 border-t border-[#E7E2D8] flex items-center justify-between">
                <span className="text-xs text-stone-500">
                  {t("marketing.page", { page, total: data.visits })}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="gap-1 h-8 text-xs"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>{t("marketing.previous")}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="gap-1 h-8 text-xs"
                  >
                    <span>{t("marketing.next")}</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </main>
  );
}
