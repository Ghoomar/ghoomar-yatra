"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type { Driver } from "@/lib/marketing/domain";
import {
  ActionForm,
  ErrorMessage,
  useRemoteJson,
  useMarketingConfig,
} from "@/components/marketing/shared";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Users,
  Search,
  X,
  Phone,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Calendar,
  IndianRupee,
  Car,
  ArrowRight,
  Loader2,
} from "lucide-react";

export default function DriversPage() {
  const { t, locale } = useI18n();
  const { config, loading: configLoading, error: configError } = useMarketingConfig();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("all");
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);

  const { data, error, loading } = useRemoteJson<{
    drivers: Driver[];
    total: number;
  }>(
    `/api/operations/marketing?${new URLSearchParams({
      mode: "directory",
      search,
      page: String(page),
    })}`,
    200
  );

  // Filter by status if specified
  const filteredDrivers = useMemo(() => {
    if (!data?.drivers) return [];
    if (statusFilter === "all") return data.drivers;
    return data.drivers.filter((d) => (statusFilter === "active" ? d.is_active : !d.is_active));
  }, [data?.drivers, statusFilter]);

  const totalDrivers = data?.total ?? 0;
  const totalPages = Math.ceil(totalDrivers / 25) || 1;

  // Rate lookup helper
  const getRateForCategory = (code: string): string => {
    if (!config?.rates) return "—";
    const r = config.rates.find((rate) => rate.category_code === code);
    return r ? `₹${r.amount}` : "—";
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* 1. PAGE HEADER & ACTIONS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-200/80 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight">
              {t("marketing.drivers")}
            </h1>
            <Badge variant="purple" className="font-mono font-bold">
              {totalDrivers} {t("marketing.drivers").toLowerCase()}
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-stone-500">
            {t("marketing.directoryHelp")}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Link href="/operations/marketing/drivers/report">
            <Button variant="outline" size="sm" className="gap-2">
              <BarChart3 className="h-4 w-4 text-amber-600" />
              <span>{t("marketing.report")}</span>
            </Button>
          </Link>
        </div>
      </div>

      <ErrorMessage code={error || configError} />

      {/* 2. SEARCH & FILTER CONTROLS */}
      <Card className="p-4 shadow-2xs border-[#E7E2D8]">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("marketing.search")}
              className="w-full h-10 pl-10 pr-9 text-sm rounded-xl border border-stone-300 bg-stone-50/50 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 p-0.5 rounded cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Status Filter Pills */}
          <div className="flex items-center gap-1.5 p-1 bg-stone-100 rounded-xl shrink-0 self-stretch sm:self-auto justify-center">
            {(["all", "active", "archived"] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  statusFilter === status
                    ? "bg-white text-stone-900 shadow-2xs"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                {status === "all"
                  ? locale === "hi"
                    ? "सभी"
                    : "All"
                  : t(`marketing.${status}`)}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* 3. DRIVER DIRECTORY TABLE */}
      <Card className="p-0 overflow-hidden shadow-xs border-[#E7E2D8]">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center space-y-3 text-stone-500">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="text-xs font-semibold">{t("marketing.loading")}</p>
          </div>
        ) : filteredDrivers.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center space-y-3 text-center px-4">
            <div className="h-12 w-12 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600">
              <Users className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-stone-800">
                {t("marketing.empty")}
              </h3>
              <p className="text-xs text-stone-500 max-w-sm">
                {search
                  ? locale === "hi"
                    ? `"${search}" से मेल खाता कोई ड्राइवर नहीं मिला। खोज रीसेट करने का प्रयास करें।`
                    : `No drivers matched your search for "${search}". Try clearing your filters.`
                  : t("marketing.directoryHelp")}
              </p>
            </div>
            {search && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
              >
                {locale === "hi" ? "खोज रीसेट करें" : "Clear Search"}
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E7E2D8] bg-[#F8F5F0]/80 text-[11px] font-bold text-stone-500 uppercase tracking-wider">
                  <th className="py-3.5 px-4">{t("marketing.fields.name")}</th>
                  <th className="py-3.5 px-4">{t("marketing.fields.phone")}</th>
                  <th className="py-3.5 px-4">{t("marketing.fields.is_active")}</th>
                  <th className="py-3.5 px-4 text-right">{locale === "hi" ? "कार्यवाही" : "Action"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E2D8]/60 text-sm">
                {filteredDrivers.map((d) => {
                  const initials = d.name
                    .split(" ")
                    .map((n) => n[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();

                  return (
                    <tr
                      key={d.id}
                      className="hover:bg-[#FAF8F5] transition-colors group"
                    >
                      {/* Driver Name & Avatar */}
                      <td className="py-3 px-4">
                        <Link
                          href={`/operations/marketing/drivers/${d.id}`}
                          className="flex items-center gap-3 group-hover:text-amber-800 transition-colors"
                        >
                          <div className="h-9 w-9 rounded-full bg-amber-100 border border-amber-300/80 text-amber-900 font-black text-xs flex items-center justify-center shrink-0">
                            {initials || "DR"}
                          </div>
                          <div>
                            <span className="font-bold text-stone-900 group-hover:text-amber-800 block text-sm">
                              {d.name}
                            </span>
                            <span className="text-[11px] text-stone-400 font-mono">
                              ID: {d.id.slice(0, 8)}
                            </span>
                          </div>
                        </Link>
                      </td>

                      {/* Phone */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 text-stone-700 font-mono text-xs">
                          <Phone className="h-3.5 w-3.5 text-stone-400" />
                          <span>{d.phone}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        {d.is_active ? (
                          <Badge variant="success">
                            {t("marketing.active")}
                          </Badge>
                        ) : (
                          <Badge variant="default">
                            {t("marketing.archived")}
                          </Badge>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <Link href={`/operations/marketing/drivers/${d.id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-xs text-amber-800 hover:text-amber-900"
                          >
                            <span>{locale === "hi" ? "प्रोफ़ाइल देखें" : "View Profile"}</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 4. PAGINATION FOOTER */}
        {totalDrivers > 0 && (
          <div className="p-3.5 border-t border-[#E7E2D8] bg-[#F8F5F0]/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-stone-600">
            <div>
              <span>
                {t("marketing.page", { page, total: totalDrivers })} ·{" "}
                {locale === "hi"
                  ? `कुल ${totalPages} पृष्ठ`
                  : `${totalPages} page(s)`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="gap-1 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>{t("marketing.previous")}</span>
              </Button>

              <span className="px-2 font-mono font-bold text-stone-800">
                {page} / {totalPages}
              </span>

              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="gap-1 text-xs"
              >
                <span>{t("marketing.next")}</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* 5. AUTHORITATIVE INCENTIVE RATES SUMMARY CARD */}
      <Card className="border-[#E7E2D8] shadow-xs">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E7E2D8]/80">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Car className="h-4 w-4 text-amber-600" />
              <span>{locale === "hi" ? "मान्य टैक्सी प्रोत्साहन दरें" : "Authoritative Taxi Incentive Rates"}</span>
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              {locale === "hi"
                ? "वर्तमान में लागू प्रति वाहन आगमन प्रोत्साहन राशि"
                : "Authoritative incentive amounts applied to taxi arrivals based on vehicle category"}
            </CardDescription>
          </div>

          {config?.permissions["marketing.manage"] && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsRateModalOpen(!isRateModalOpen)}
              className="gap-1.5 shrink-0"
            >
              <Calendar className="h-3.5 w-3.5 text-amber-600" />
              <span>{t("marketing.futureRates")}</span>
            </Button>
          )}
        </CardHeader>

        <CardContent className="pt-4 space-y-4">
          {/* Rate Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {config?.categories?.map((cat) => {
              const rate = getRateForCategory(cat.code);
              return (
                <div
                  key={cat.code}
                  className="p-3.5 rounded-xl border border-stone-200/90 bg-[#FAF8F5] space-y-1"
                >
                  <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider block truncate">
                    {locale === "hi" ? cat.name_hi : cat.name}
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl sm:text-2xl font-black font-mono text-stone-900">
                      {rate}
                    </span>
                    <span className="text-[11px] text-stone-400 font-semibold">
                      {locale === "hi" ? "/ आगमन" : "/ visit"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Collapsible Rate Schedule Form */}
          {isRateModalOpen && config?.permissions["marketing.manage"] && (
            <div className="pt-2 border-t border-[#E7E2D8]/60 animate-in fade-in duration-150">
              <h4 className="text-xs font-bold text-stone-800 mb-3 flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-amber-600" />
                <span>{t("marketing.futureRates")}</span>
              </h4>
              <ActionForm
                action="rate"
                title="futureRates"
                base={{}}
                disabled={!config.enabled}
                onSaved={() => setIsRateModalOpen(false)}
                fields={[
                  {
                    name: "category_code",
                    options: config.categories.map((c) => ({
                      value: c.code,
                      label: `${locale === "hi" ? c.name_hi : c.name} (${getRateForCategory(c.code)})`,
                    })),
                  },
                  { name: "valid_from", type: "date" },
                  { name: "amount" },
                  { name: "reason" },
                ]}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
