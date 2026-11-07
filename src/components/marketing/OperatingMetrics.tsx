"use client";

import React from "react";
import { useI18n } from "@/lib/i18n/context";
import type { OperatingMetrics as Metrics } from "@/lib/marketing/domain";
import { downloadCsv, ErrorMessage, useRemoteJson } from "./shared";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatINR, formatNumber, formatNullablePrice } from "@/lib/utils";
import {
  TrendingUp,
  Download,
  UtensilsCrossed,
  Users,
  Receipt,
  Car,
  Bike,
  Bus,
  Calculator,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface OperatingMetricsProps {
  from: string;
  to: string;
  className?: string;
}

export function OperatingMetrics({ from, to, className }: OperatingMetricsProps) {
  const { t, locale } = useI18n();
  const { data, error, loading } = useRemoteJson<Metrics>(
    `/api/operations/metrics?${new URLSearchParams({ from, to })}`
  );

  const handleExportCsv = () => {
    if (!data) return;
    const isHindi = locale === "hi";

    downloadCsv(`operating-metrics-${from}-${to}.csv`, [
      [isHindi ? "प्रारंभ तिथि" : "From Date", from],
      [isHindi ? "समाप्ति तिथि" : "To Date", to],
      [isHindi ? "तैयार किया गया" : "Generated At", new Date().toISOString()],
      [isHindi ? "डेटा कवरेज" : "Data Coverage", `${data.imported_days}/${data.expected_days} days`],
      [isHindi ? "पूर्णतः रिपोर्टेड" : "Complete Coverage", data.complete ? "Yes" : "No"],
      ["", ""],
      [isHindi ? "मीट्रिक" : "Metric", isHindi ? "मान" : "Value"],
      [isHindi ? "भोजन शुद्ध बिक्री (₹)" : "Dining Net Sales (₹)", data.net_sales],
      [isHindi ? "भोजन कवर (लोग)" : "Dining Covers (pax)", data.covers],
      [isHindi ? "भोजन बिल" : "Dining Bills", data.bills],
      [isHindi ? "प्रति व्यक्ति खर्च (₹)" : "Spend per Cover (₹)", data.spend_per_cover ?? "—"],
      [isHindi ? "कार (टैक्सी सहित)" : "Cars (incl. Taxis)", data.cars],
      [isHindi ? "बाइक" : "Bikes", data.bikes],
      [isHindi ? "ट्रैवलर / मिनी बस" : "Travellers / Mini Buses", data.travellers],
      [isHindi ? "बड़ी बस" : "Large Buses", data.buses],
      [isHindi ? "प्रति बिल खर्च (₹)" : "Spend per Bill (₹)", data.spend_per_bill ?? "—"],
      [isHindi ? "प्रति बिल कवर (लोग)" : "Covers per Bill", data.covers_per_bill ?? "—"],
      [isHindi ? "प्रति कार कवर (लोग)" : "Covers per Car", data.covers_per_car ?? "—"],
      [isHindi ? "प्रति कार खर्च (₹)" : "Spend per Car (₹)", data.spend_per_car ?? "—"],
    ]);
  };

  return (
    <Card className={`border-[#E7E2D8] shadow-xs overflow-hidden ${className || ""}`}>
      {/* 1. COMPONENT HEADER */}
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E7E2D8]/80">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-600" />
            <CardTitle className="text-base font-bold text-stone-900">
              {t("marketing.operatingMetrics")}
            </CardTitle>
            {data && (
              <>
                {data.live ? (
                  <Badge variant="warning" className="text-[10px] font-bold">
                    {t("marketing.periods.today")} (Live) · {data.imported_days}/{data.expected_days}d
                  </Badge>
                ) : data.complete ? (
                  <Badge variant="success" className="text-[10px] font-bold">
                    ✓ 100% Reconciled
                  </Badge>
                ) : (
                  <Badge variant="warning" className="text-[10px] font-bold">
                    {data.imported_days}/{data.expected_days} {locale === "hi" ? "दिन आयातित" : "days imported"}
                  </Badge>
                )}
              </>
            )}
          </div>
          <CardDescription className="text-xs text-stone-500">
            {t("marketing.operatingScope")}
          </CardDescription>
        </div>

        {data && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="gap-1.5 self-start sm:self-auto text-xs"
          >
            <Download className="h-3.5 w-3.5 text-stone-500" />
            <span>{t("marketing.exportSummary")}</span>
          </Button>
        )}
      </CardHeader>

      <CardContent className="pt-4 space-y-5">
        <ErrorMessage code={error} />

        {loading && !data && (
          <div className="py-12 flex flex-col items-center justify-center space-y-2 text-stone-500">
            <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
            <span className="text-xs font-semibold">{t("marketing.loading")}</span>
          </div>
        )}

        {data && (
          <>
            {/* GROUP 1: DINING & REVENUE */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                <UtensilsCrossed className="h-3.5 w-3.5 text-amber-600" />
                <span>{locale === "hi" ? "भोजन व बिक्री" : "Dining & Revenue"}</span>
              </span>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {/* Net Sales */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-[#FAF8F5] space-y-1">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.net_sales")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 block truncate">
                    {formatINR(Number(data.net_sales))}
                  </span>
                </div>

                {/* Covers */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-[#FAF8F5] space-y-1">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.covers")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 block truncate">
                    {formatNumber(data.covers)}
                  </span>
                </div>

                {/* Bills */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-[#FAF8F5] space-y-1">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.bills")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 block truncate">
                    {formatNumber(data.bills)}
                  </span>
                </div>

                {/* Spend per Cover */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-[#FAF8F5] space-y-1">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.spend_per_cover")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 block truncate">
                    {data.spend_per_cover ? formatNullablePrice(data.spend_per_cover) : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* GROUP 2: VEHICLE VOLUMES */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                <Car className="h-3.5 w-3.5 text-sky-600" />
                <span>{locale === "hi" ? "वाहन आवक" : "Vehicle Volumes"}</span>
              </span>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {/* Cars */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-white space-y-1 shadow-2xs">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.cars")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-sky-700 block truncate">
                    {formatNumber(data.cars)}
                  </span>
                </div>

                {/* Bikes */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-white space-y-1 shadow-2xs">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.bikes")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-emerald-700 block truncate">
                    {formatNumber(data.bikes)}
                  </span>
                </div>

                {/* Travellers */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-white space-y-1 shadow-2xs">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.travellers")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-amber-700 block truncate">
                    {formatNumber(data.travellers)}
                  </span>
                </div>

                {/* Large Buses */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-white space-y-1 shadow-2xs">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.buses")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-purple-700 block truncate">
                    {formatNumber(data.buses)}
                  </span>
                </div>
              </div>
            </div>

            {/* GROUP 3: UNIT ECONOMICS */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                <Calculator className="h-3.5 w-3.5 text-purple-600" />
                <span>{locale === "hi" ? "इकाई अर्थशास्त्र" : "Unit Economics"}</span>
              </span>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {/* Spend per Bill */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-[#FAF8F5] space-y-1">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.spend_per_bill")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 block truncate">
                    {data.spend_per_bill ? formatNullablePrice(data.spend_per_bill) : "—"}
                  </span>
                </div>

                {/* Covers per Bill */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-[#FAF8F5] space-y-1">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.covers_per_bill")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 block truncate">
                    {data.covers_per_bill ? `${data.covers_per_bill} pax` : "—"}
                  </span>
                </div>

                {/* Covers per Car */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-[#FAF8F5] space-y-1">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.covers_per_car")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 block truncate">
                    {data.covers_per_car ? `${data.covers_per_car} pax` : "—"}
                  </span>
                </div>

                {/* Spend per Car */}
                <div className="p-3.5 rounded-xl border border-stone-200/80 bg-[#FAF8F5] space-y-1">
                  <span className="text-[11px] font-semibold text-stone-500 block truncate">
                    {t("marketing.operating.spend_per_car")}
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 block truncate">
                    {data.spend_per_car ? formatNullablePrice(data.spend_per_car) : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Helper Note */}
            <p className="text-[11px] text-stone-400 italic pt-1">
              * {t("marketing.ratioHelp")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
