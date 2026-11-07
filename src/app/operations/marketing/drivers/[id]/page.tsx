"use client";

import React, { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type {
  Card as DomainCard,
  Driver,
  Punch,
  Vehicle,
  Visit,
} from "@/lib/marketing/domain";
import {
  ActionForm,
  ErrorMessage,
  marketingRead,
  Status,
  useMarketingConfig,
} from "@/components/marketing/shared";
import { VisitEditor } from "@/components/marketing/VisitEditor";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  ArrowLeft,
  Car,
  Award,
  Calendar,
  Phone,
  CheckCircle2,
  Clock,
  AlertTriangle,
  X,
  Edit3,
  ChevronLeft,
  ChevronRight,
  Gift,
  ShieldCheck,
  History,
  Check,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type Profile = Driver & {
  vehicles: Vehicle[];
  cards: DomainCard[];
  punches: Punch[];
  visits: Visit[];
  visit_total: number;
  openings: {
    id: string;
    reference: string;
    evidence: string;
    saved_cards: number;
    partial_credits: number;
  }[];
  redemptions: {
    id: string;
    created_at: string;
    reference: string;
    reward_code: string;
    cards: string[];
  }[];
  history: {
    id: string;
    action: string;
    reason: string | null;
    created_at: string;
  }[];
};

type ActiveModal =
  | "edit_driver"
  | "edit_vehicle"
  | "end_association"
  | "redeem"
  | "opening"
  | "adjust_opening"
  | "resolve_exception"
  | "correct_opening"
  | null;

export default function DriverProfile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { config, error: configError } = useMarketingConfig();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);

  // Modal states
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [selectedPunch, setSelectedPunch] = useState<Punch | null>(null);

  // Accordion toggles
  const [showCreditHistory, setShowCreditHistory] = useState(false);
  const [showRedemptions, setShowRedemptions] = useState(false);
  const [showAuditHistory, setShowAuditHistory] = useState(false);

  const load = useCallback(() => {
    marketingRead<Profile>("profile", { driver_id: id, page: String(page) })
      .then((p) => {
        setProfile(p);
        setError(p ? "" : "DRIVER_UNAVAILABLE");
      })
      .catch((e) => setError(e.message));
  }, [id, page]);

  useEffect(load, [load]);

  if (!profile || !config) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 pb-12">
        <Link
          href="/operations/marketing/drivers"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t("marketing.backToDrivers")}</span>
        </Link>
        <ErrorMessage code={error || configError} />
        <div className="py-20 flex flex-col items-center justify-center space-y-3 text-stone-500">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
          <p className="text-xs font-semibold">{t("marketing.loading")}</p>
        </div>
      </main>
    );
  }

  const canManage = config.permissions["marketing.manage"];
  const canLoyalty = config.permissions["marketing.loyalty"];
  const canRedeem = config.permissions["marketing.redeem"];

  const available = profile.redemption_exception
    ? 0
    : profile.cards.filter(
        (c) => c.credits === 12 && c.held === 0 && !c.redeemed
      ).length;

  const initials = profile.name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const totalPages = Math.ceil(profile.visit_total / 25) || 1;

  // Helper for vehicle rates
  const getRateForCategory = (code: string): string => {
    if (!config?.rates) return "";
    const r = config.rates.find((rate) => rate.category_code === code);
    return r ? ` (₹${r.amount})` : "";
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 pb-12">
      {/* 1. TOP BREADCRUMB & BACK */}
      <div className="flex items-center justify-between">
        <Link
          href="/operations/marketing/drivers"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t("marketing.backToDrivers")}</span>
        </Link>
        {!config.enabled && (
          <Badge variant="warning" className="text-xs">
            {t("marketing.disabled")}
          </Badge>
        )}
      </div>

      <ErrorMessage code={error} />

      {/* 2. DRIVER HEADER CARD */}
      <Card className="p-6 border-[#E7E2D8] shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            {/* Avatar Initials */}
            <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-stone-950 font-black text-xl sm:text-2xl flex items-center justify-center shrink-0 shadow-sm border border-amber-300">
              {initials || "DR"}
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight">
                  {profile.name}
                </h1>
                {profile.is_active ? (
                  <Badge variant="success">{t("marketing.active")}</Badge>
                ) : (
                  <Badge variant="outline">{t("marketing.archived")}</Badge>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs sm:text-sm text-stone-600">
                <a
                  href={`tel:${profile.phone}`}
                  className="flex items-center gap-1.5 font-mono text-stone-700 hover:text-amber-800 transition-colors"
                >
                  <Phone className="h-3.5 w-3.5 text-stone-400" />
                  <span>{profile.phone}</span>
                </a>
                <span className="text-stone-300">·</span>
                <span className="text-stone-500 font-mono text-xs">
                  ID: {profile.id.slice(0, 8)}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Metrics & Actions */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 shrink-0">
            <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
              <div className="bg-stone-50 border border-stone-200/80 rounded-xl px-3 py-2 min-w-[70px]">
                <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                  {locale === "hi" ? "विज़िट" : "Visits"}
                </p>
                <p className="text-base sm:text-lg font-black text-stone-900">
                  {profile.visit_total}
                </p>
              </div>

              <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl px-3 py-2 min-w-[70px]">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                  {locale === "hi" ? "इनाम कार्ड" : "Cards"}
                </p>
                <p className="text-base sm:text-lg font-black text-amber-800">
                  {available}
                </p>
              </div>

              <div className="bg-stone-50 border border-stone-200/80 rounded-xl px-3 py-2 min-w-[70px]">
                <p className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                  {locale === "hi" ? "वाहन" : "Vehicles"}
                </p>
                <p className="text-base sm:text-lg font-black text-stone-900">
                  {profile.vehicles.length}
                </p>
              </div>
            </div>

            {canManage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveModal("edit_driver")}
                className="gap-1.5"
              >
                <Edit3 className="h-3.5 w-3.5 text-amber-600" />
                <span>{t("marketing.editDriver")}</span>
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* 3. ASSOCIATED VEHICLES */}
      <Card className="p-5 border-[#E7E2D8] shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-[#E7E2D8] pb-3">
          <div className="flex items-center gap-2">
            <Car className="h-4 w-4 text-amber-600" />
            <h2 className="text-base font-bold text-stone-900">
              {t("marketing.vehicles")}
            </h2>
            <Badge variant="outline" className="font-mono text-xs">
              {profile.vehicles.length}
            </Badge>
          </div>
        </div>

        {profile.vehicles.length === 0 ? (
          <p className="text-xs text-stone-500 py-4 text-center">
            {t("marketing.noVehicles")}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {profile.vehicles.map((v) => (
              <div
                key={v.id}
                className="flex flex-col justify-between p-4 rounded-xl border border-stone-200 bg-stone-50/50 hover:bg-stone-50 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    {/* Commercial Taxi Number Plate Badge */}
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FACC15] border border-[#CA8A04] text-stone-950 font-mono font-black text-xs tracking-wider shadow-2xs">
                      <span>{v.registration}</span>
                    </div>

                    {v.effective_to ? (
                      <Badge variant="outline" className="text-[10px]">
                        {t("marketing.associationEnded")}
                      </Badge>
                    ) : (
                      <Badge variant="success" className="text-[10px]">
                        {t("marketing.associated")}
                      </Badge>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-bold text-stone-800">
                      {v.make_model}
                    </p>
                    <p className="text-xs text-stone-500">
                      {t(`marketing.categories.${v.category_code}`)}
                      <span className="font-medium text-amber-800">
                        {getRateForCategory(v.category_code)}
                      </span>
                    </p>
                  </div>
                </div>

                {canManage && (
                  <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-stone-200/80">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedVehicle(v);
                        setActiveModal("edit_vehicle");
                      }}
                      className="text-xs h-8 px-2.5"
                    >
                      {t("marketing.editVehicle")}
                    </Button>
                    {!v.effective_to && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedVehicle(v);
                          setActiveModal("end_association");
                        }}
                        className="text-xs h-8 px-2.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                      >
                        {t("marketing.endAssociation")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 4. LOYALTY CARDS & REWARDS */}
      <Card className="p-5 border-[#E7E2D8] shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E7E2D8] pb-3">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-amber-600" />
            <h2 className="text-base font-bold text-stone-900">
              {t("marketing.loyalty")}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {canLoyalty && profile.punches.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveModal("opening")}
                className="text-xs gap-1.5"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                <span>{t("marketing.opening")}</span>
              </Button>
            )}
            {canLoyalty && profile.openings.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveModal("adjust_opening")}
                className="text-xs gap-1.5"
              >
                <Edit3 className="h-3.5 w-3.5 text-amber-600" />
                <span>{t("marketing.adjustOpening")}</span>
              </Button>
            )}
          </div>
        </div>

        {/* Exception alert if any */}
        {profile.redemption_exception && (
          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 flex items-start justify-between gap-3 text-rose-900">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-bold">
                  {t("marketing.errors.REDEMPTION_HELD")}
                </p>
                <p className="text-xs text-rose-700">
                  {locale === "hi"
                    ? "मैनेजर द्वारा समीक्षा होने तक इनाम भुनाने पर रोक लगाई गई है।"
                    : "Redemptions are temporarily held pending manager resolution."}
                </p>
              </div>
            </div>
            {canLoyalty && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setActiveModal("resolve_exception")}
                className="bg-white text-rose-800 border-rose-300 hover:bg-rose-100/50 shrink-0"
              >
                {t("marketing.resolveException")}
              </Button>
            )}
          </div>
        )}

        {/* Available Reward Banner */}
        {available > 0 && (
          <div className="p-4 rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 via-amber-100/50 to-amber-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500 text-stone-950 flex items-center justify-center shrink-0 shadow-xs">
                <Gift className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-bold text-amber-950">
                  {t("marketing.rewardReady")}
                </p>
                <p className="text-xs text-amber-800">
                  {t("marketing.rewardReadyHelp")}
                </p>
              </div>
            </div>

            {canRedeem && (
              <Button
                size="sm"
                onClick={() => setActiveModal("redeem")}
                className="bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold shrink-0 gap-1.5 shadow-xs"
              >
                <Award className="h-4 w-4" />
                <span>{t("marketing.redeemNow")}</span>
              </Button>
            )}
          </div>
        )}

        {/* 12-Punch Loyalty Cards Visual Grid */}
        <div className="space-y-3">
          <p className="text-xs text-stone-500">
            {t("marketing.loyaltyHelp")}
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profile.cards.map((c) => {
              const isReady = c.credits === 12 && c.held === 0 && !c.redeemed;
              return (
                <div
                  key={c.id}
                  className={`p-4 rounded-xl border transition-all ${
                    c.redeemed
                      ? "border-stone-200 bg-stone-50/50 opacity-80"
                      : isReady
                      ? "border-amber-400 bg-amber-50/40 shadow-xs ring-1 ring-amber-400/50"
                      : "border-stone-200 bg-white shadow-2xs"
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5 mb-3">
                    <span className="font-bold text-stone-800 text-sm">
                      {t("marketing.card", { cycle: c.cycle })}
                    </span>
                    {c.redeemed ? (
                      <Badge variant="outline" className="text-[10px]">
                        {t("marketing.cardRedeemed")}
                      </Badge>
                    ) : isReady ? (
                      <Badge variant="success" className="text-[10px]">
                        {t("marketing.cardReady")}
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="text-[10px]">
                        {t("marketing.cardInProgress")}
                      </Badge>
                    )}
                  </div>

                  {/* 12 Punch Slots (6 columns x 2 rows) */}
                  <div className="grid grid-cols-6 gap-2 my-2 py-1">
                    {Array.from({ length: 12 }, (_, index) => {
                      const punchNum = index + 1;
                      const isStamped = punchNum <= c.credits - c.held;
                      const isHeld =
                        punchNum > c.credits - c.held && punchNum <= c.credits;

                      if (isStamped) {
                        return (
                          <div
                            key={punchNum}
                            title={`Punch #${punchNum}: Verified`}
                            className="aspect-square rounded-full bg-amber-500 border border-amber-600 text-stone-950 flex items-center justify-center font-bold text-xs shadow-2xs"
                          >
                            <Check className="h-3 w-3 stroke-[3]" />
                          </div>
                        );
                      }
                      if (isHeld) {
                        return (
                          <div
                            key={punchNum}
                            title={`Punch #${punchNum}: Held pending review`}
                            className="aspect-square rounded-full bg-amber-100 border border-amber-300 text-amber-800 flex items-center justify-center font-bold text-[10px]"
                          >
                            <Clock className="h-3 w-3" />
                          </div>
                        );
                      }
                      return (
                        <div
                          key={punchNum}
                          title={`Punch #${punchNum}: Unearned`}
                          className="aspect-square rounded-full border border-dashed border-stone-300 bg-stone-50/50 text-stone-400 flex items-center justify-center text-[10px] font-mono"
                        >
                          {punchNum}
                        </div>
                      );
                    })}
                  </div>

                  {/* Card Summary Footer */}
                  <div className="mt-3 pt-2 border-t border-stone-100 flex items-center justify-between text-xs text-stone-600">
                    <span className="font-medium">
                      {t("marketing.punchesProgress", { credits: c.credits })}
                    </span>
                    {c.held > 0 && (
                      <span className="text-[11px] font-semibold text-amber-800">
                        {t("marketing.heldCredits", { count: c.held })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Collapsible History Drawers */}
        <div className="space-y-2 pt-2 border-t border-stone-100">
          {/* Credit & Punch History */}
          <div className="rounded-xl border border-stone-200 overflow-hidden bg-white">
            <button
              type="button"
              onClick={() => setShowCreditHistory((prev) => !prev)}
              className="w-full flex items-center justify-between p-3.5 text-left text-xs font-bold text-stone-800 hover:bg-stone-50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-stone-500" />
                <span>{t("marketing.creditHistory")}</span>
                <span className="text-stone-400 font-normal">
                  ({profile.punches.length})
                </span>
              </div>
              {showCreditHistory ? (
                <ChevronUp className="h-4 w-4 text-stone-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-stone-400" />
              )}
            </button>

            {showCreditHistory && (
              <div className="p-3.5 border-t border-stone-100 bg-stone-50/50 space-y-2 text-xs">
                {profile.punches.length === 0 ? (
                  <p className="text-stone-400 py-2 text-center">
                    {t("marketing.empty")}
                  </p>
                ) : (
                  profile.punches.map((p) => (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-lg border border-stone-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-stone-800">
                            {new Date(p.created_at).toLocaleString()}
                          </span>
                          <Status value={p.source} />
                          <Status value={p.status} />
                        </div>
                        {p.review_reason && (
                          <p className="text-stone-500 italic">
                            {p.review_reason}
                          </p>
                        )}
                      </div>

                      {canLoyalty &&
                        p.source === "OPENING_BALANCE" &&
                        p.status !== "REVERSED" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedPunch(p);
                              setActiveModal("correct_opening");
                            }}
                            className="text-xs h-7 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          >
                            {t("marketing.correctOpening")}
                          </Button>
                        )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Redemption History */}
          <div className="rounded-xl border border-stone-200 overflow-hidden bg-white">
            <button
              type="button"
              onClick={() => setShowRedemptions((prev) => !prev)}
              className="w-full flex items-center justify-between p-3.5 text-left text-xs font-bold text-stone-800 hover:bg-stone-50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-stone-500" />
                <span>{t("marketing.redemptionHistory")}</span>
                <span className="text-stone-400 font-normal">
                  ({profile.redemptions.length})
                </span>
              </div>
              {showRedemptions ? (
                <ChevronUp className="h-4 w-4 text-stone-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-stone-400" />
              )}
            </button>

            {showRedemptions && (
              <div className="p-3.5 border-t border-stone-100 bg-stone-50/50 space-y-2 text-xs">
                {profile.redemptions.length === 0 ? (
                  <p className="text-stone-400 py-2 text-center">
                    {t("marketing.empty")}
                  </p>
                ) : (
                  profile.redemptions.map((r) => (
                    <div
                      key={r.id}
                      className="p-2.5 rounded-lg border border-stone-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <p className="font-bold text-stone-800">
                          {t(`marketing.rewards.${r.reward_code}`)}
                        </p>
                        <p className="text-stone-500">
                          {new Date(r.created_at).toLocaleString()} ·{" "}
                          {locale === "hi" ? "कार्ड्स" : "Cards"}: {r.cards.length} ·{" "}
                          {locale === "hi" ? "संदर्भ" : "Ref"}: {r.reference}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 5. VISIT HISTORY */}
      <Card className="p-5 border-[#E7E2D8] shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-[#E7E2D8] pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-amber-600" />
            <h2 className="text-base font-bold text-stone-900">
              {t("marketing.visitHistory")}
            </h2>
            <Badge variant="outline" className="font-mono text-xs">
              {profile.visit_total}
            </Badge>
          </div>
        </div>

        {profile.visits.length === 0 ? (
          <p className="text-xs text-stone-500 py-6 text-center">
            {t("marketing.noVisits")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50/80 font-bold text-stone-600 uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3.5">{t("marketing.fields.business_date")}</th>
                  <th className="py-3 px-3.5">{t("marketing.fields.registration")}</th>
                  <th className="py-3 px-3.5">{t("marketing.fields.guests")}</th>
                  <th className="py-3 px-3.5">{t("marketing.fields.revenue")}</th>
                  <th className="py-3 px-3.5">{t("marketing.fields.status")}</th>
                  <th className="py-3 px-3.5 text-right">{t("marketing.actionsHeader")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {profile.visits.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => setSelectedVisitId(v.id)}
                    className="hover:bg-amber-50/40 transition-colors cursor-pointer group"
                  >
                    <td className="py-2.5 px-3.5 font-medium text-stone-800">
                      {v.business_date}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono font-bold text-stone-900">
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
                        {v.registration_snapshot}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 font-medium text-stone-700">
                      {v.guests}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono font-semibold text-stone-900">
                      ₹{v.confirmed_revenue}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <Status value={v.reconciliation_state} />
                    </td>
                    <td className="py-2.5 px-3.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedVisitId(v.id);
                        }}
                        className="text-xs h-7 px-2 text-amber-700 hover:text-amber-800"
                      >
                        {t("marketing.visitDetails")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {profile.visit_total > 25 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-stone-500">
              {t("marketing.page", { page, total: profile.visit_total })}
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

      {/* 6. AUDIT HISTORY (Collapsible) */}
      <div className="rounded-xl border border-stone-200 overflow-hidden bg-white">
        <button
          type="button"
          onClick={() => setShowAuditHistory((prev) => !prev)}
          className="w-full flex items-center justify-between p-4 text-left text-xs font-bold text-stone-800 hover:bg-stone-50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-stone-500" />
            <span>{t("marketing.auditHistory")}</span>
            <span className="text-stone-400 font-normal">
              ({profile.history.length})
            </span>
          </div>
          {showAuditHistory ? (
            <ChevronUp className="h-4 w-4 text-stone-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-stone-400" />
          )}
        </button>

        {showAuditHistory && (
          <div className="p-4 border-t border-stone-100 bg-stone-50/50 space-y-2 text-xs">
            {profile.history.length === 0 ? (
              <p className="text-stone-400 py-2 text-center">
                {t("marketing.empty")}
              </p>
            ) : (
              profile.history.map((e) => (
                <div
                  key={e.id}
                  className="p-2.5 rounded-lg border border-stone-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
                >
                  <div className="space-y-0.5">
                    <span className="font-semibold text-stone-800">
                      {t(`marketing.actions.${e.action}`)}
                    </span>
                    {e.reason && (
                      <p className="text-stone-500 italic">{e.reason}</p>
                    )}
                  </div>
                  <span className="text-[11px] text-stone-400 font-mono">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ================= MODAL DIALOGS ================= */}

      {/* 1. Edit Driver Modal */}
      {activeModal === "edit_driver" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-stone-900 text-base">
                {t("marketing.editDriver")}
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ActionForm
              key={profile.version}
              action="driver"
              title="editDriver"
              base={{ id, version: profile.version }}
              disabled={!config.enabled}
              onSaved={() => {
                load();
                setActiveModal(null);
              }}
              fields={[
                { name: "name", value: profile.name },
                { name: "phone", value: profile.phone },
                {
                  name: "is_active",
                  value: String(profile.is_active),
                  options: [
                    { value: "true", label: t("marketing.active") },
                    { value: "false", label: t("marketing.archived") },
                  ],
                },
                { name: "reason" },
              ]}
            />
          </div>
        </div>
      )}

      {/* 2. Edit Vehicle Modal */}
      {activeModal === "edit_vehicle" && selectedVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-stone-900 text-base">
                {t("marketing.editVehicle")} · {selectedVehicle.registration}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setActiveModal(null);
                  setSelectedVehicle(null);
                }}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ActionForm
              key={selectedVehicle.version}
              action="vehicle"
              title="editVehicle"
              base={{ id: selectedVehicle.id, version: selectedVehicle.version }}
              disabled={!config.enabled}
              onSaved={() => {
                load();
                setActiveModal(null);
                setSelectedVehicle(null);
              }}
              fields={[
                { name: "registration", value: selectedVehicle.registration },
                { name: "make_model", value: selectedVehicle.make_model },
                {
                  name: "category_code",
                  value: selectedVehicle.category_code,
                  options: config.categories.map((c) => ({
                    value: c.code,
                    label: t(`marketing.categories.${c.code}`),
                  })),
                },
                {
                  name: "is_active",
                  value: String(selectedVehicle.is_active),
                  options: [
                    { value: "true", label: t("marketing.active") },
                    { value: "false", label: t("marketing.archived") },
                  ],
                },
                { name: "reason" },
              ]}
            />
          </div>
        </div>
      )}

      {/* 3. End Association Modal */}
      {activeModal === "end_association" && selectedVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-stone-900 text-base text-rose-800">
                {t("marketing.endAssociation")} · {selectedVehicle.registration}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setActiveModal(null);
                  setSelectedVehicle(null);
                }}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ActionForm
              action="associate"
              title="endAssociation"
              base={{ driver_id: id, vehicle_id: selectedVehicle.id, end: true }}
              fields={[{ name: "reason" }]}
              onSaved={() => {
                load();
                setActiveModal(null);
                setSelectedVehicle(null);
              }}
              disabled={!config.enabled}
            />
          </div>
        </div>
      )}

      {/* 4. Redeem Reward Modal */}
      {activeModal === "redeem" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-stone-900 text-base">
                {t("marketing.redeem")}
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ActionForm
              action="redeem"
              title="redeem"
              base={{ driver_id: id }}
              onSaved={() => {
                load();
                setActiveModal(null);
              }}
              disabled={!config.enabled || available === 0}
              fields={[
                {
                  name: "reward_code",
                  options: config.rewards
                    .filter((r) => r.cards_required <= available)
                    .map((r) => ({
                      value: r.code,
                      label: `${locale === "hi" ? r.name_hi : r.name} (${r.cards_required} ${locale === "hi" ? "कार्ड्स" : "cards"})`,
                    })),
                },
                { name: "reference" },
              ]}
            />
          </div>
        </div>
      )}

      {/* 5. Opening Balance Modal */}
      {activeModal === "opening" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-stone-900 text-base">
                {t("marketing.opening")}
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ActionForm
              action="opening"
              title="opening"
              base={{ driver_id: id }}
              onSaved={() => {
                load();
                setActiveModal(null);
              }}
              disabled={!config.enabled}
              fields={[
                {
                  name: "saved_cards",
                  type: "number",
                  value: "0",
                  min: 0,
                  max: 100,
                },
                {
                  name: "partial_credits",
                  type: "number",
                  value: "0",
                  min: 0,
                  max: 11,
                },
                { name: "reference" },
                { name: "evidence" },
              ]}
            />
          </div>
        </div>
      )}

      {/* 6. Adjust Opening Modal */}
      {activeModal === "adjust_opening" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-stone-900 text-base">
                {t("marketing.adjustOpening")}
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ActionForm
              action="adjust_opening"
              title="adjustOpening"
              base={{ driver_id: id }}
              onSaved={() => {
                load();
                setActiveModal(null);
              }}
              disabled={!config.enabled}
              fields={[
                {
                  name: "saved_cards",
                  type: "number",
                  value: "0",
                  min: 0,
                  max: 100,
                },
                {
                  name: "partial_credits",
                  type: "number",
                  value: "0",
                  min: 0,
                  max: 11,
                },
                { name: "reference" },
                { name: "evidence" },
                { name: "reason" },
              ]}
            />
          </div>
        </div>
      )}

      {/* 7. Resolve Exception Modal */}
      {activeModal === "resolve_exception" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-stone-900 text-base">
                {t("marketing.resolveException")}
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ActionForm
              action="resolve_exception"
              title="resolveException"
              base={{ driver_id: id }}
              fields={[{ name: "reason" }]}
              onSaved={() => {
                load();
                setActiveModal(null);
              }}
              disabled={!config.enabled}
            />
          </div>
        </div>
      )}

      {/* 8. Correct Opening Credit Modal */}
      {activeModal === "correct_opening" && selectedPunch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-stone-900 text-base">
                {t("marketing.correctOpening")}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setActiveModal(null);
                  setSelectedPunch(null);
                }}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ActionForm
              action="review_punch"
              title="correctOpening"
              base={{
                punch_id: selectedPunch.id,
                version: selectedPunch.version,
                status: "REVERSED",
              }}
              fields={[{ name: "reason" }]}
              onSaved={() => {
                load();
                setActiveModal(null);
                setSelectedPunch(null);
              }}
              disabled={!config.enabled}
            />
          </div>
        </div>
      )}

      {/* 9. Visit Editor Modal Dialog */}
      {selectedVisitId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-stone-200">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <h3 className="font-bold text-stone-900 text-base">
                {t("marketing.visitDetails")}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedVisitId(null)}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <VisitEditor
              key={selectedVisitId}
              id={selectedVisitId}
              config={config}
              onChanged={() => {
                load();
                setSelectedVisitId(null);
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}
