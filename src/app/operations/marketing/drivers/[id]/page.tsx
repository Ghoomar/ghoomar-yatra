"use client";
import React, { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type {
  Card,
  Driver,
  Punch,
  Vehicle,
  Visit,
} from "@/lib/marketing/domain";
import {
  ActionForm,
  buttonClass,
  ErrorMessage,
  marketingRead,
  Status,
  useMarketingConfig,
} from "@/components/marketing/shared";
import { VisitEditor } from "@/components/marketing/VisitEditor";
type Profile = Driver & {
  vehicles: Vehicle[];
  cards: Card[];
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
export default function DriverProfile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { config, error: configError } = useMarketingConfig();
  const [profile, setProfile] = useState<Profile | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState("");
  const load = useCallback(() => {
    marketingRead<Profile>("profile", { driver_id: id, page: String(page) })
      .then((p) => {
        setProfile(p);
        setError(p ? "" : "DRIVER_UNAVAILABLE");
      })
      .catch((e) => setError(e.message));
  }, [id, page]);
  useEffect(load, [load]);
  if (!profile || !config)
    return (
      <>
        <ErrorMessage code={error || configError} />
        <p>{t("marketing.loading")}</p>
      </>
    );
  const canManage = config.permissions["marketing.manage"],
    canLoyalty = config.permissions["marketing.loyalty"];
  const available = profile.redemption_exception
    ? 0
    : profile.cards.filter(
        (c) => c.credits === 12 && c.held === 0 && !c.redeemed,
      ).length;
  return (
    <main className="mx-auto max-w-5xl space-y-5">
      <Link href="/operations/marketing/drivers" className="underline">
        {t("marketing.drivers")}
      </Link>
      <header>
        <h1 className="text-2xl font-bold">{profile.name}</h1>
        <p>
          {profile.phone} ·{" "}
          {t(profile.is_active ? "marketing.active" : "marketing.archived")}
        </p>
      </header>
      <ErrorMessage code={error} />
      {!config.enabled && <p role="status">{t("marketing.disabled")}</p>}
      {canManage && (
        <details>
          <summary className="cursor-pointer py-3">
            {t("marketing.editDriver")}
          </summary>
          <ActionForm
            key={profile.version}
            action="driver"
            title="editDriver"
            base={{ id, version: profile.version }}
            disabled={!config.enabled}
            onSaved={load}
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
        </details>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{t("marketing.vehicles")}</h2>
        {profile.vehicles.map((v, i) => (
          <article
            key={`${v.id}-${i}`}
            className="rounded-xl border bg-white p-4"
          >
            <h3 className="font-bold">
              {v.registration} · {v.make_model}
            </h3>
            <p>
              {t(`marketing.categories.${v.category_code}`)} ·{" "}
              {t(
                v.effective_to
                  ? "marketing.associationEnded"
                  : "marketing.associated",
              )}
            </p>
            {canManage && (
              <details>
                <summary className="cursor-pointer py-2">
                  {t("marketing.editVehicle")}
                </summary>
                <ActionForm
                  key={v.version}
                  action="vehicle"
                  title="editVehicle"
                  base={{ id: v.id, version: v.version }}
                  disabled={!config.enabled}
                  onSaved={load}
                  fields={[
                    { name: "registration", value: v.registration },
                    { name: "make_model", value: v.make_model },
                    {
                      name: "category_code",
                      value: v.category_code,
                      options: config.categories.map((c) => ({
                        value: c.code,
                        label: t(`marketing.categories.${c.code}`),
                      })),
                    },
                    {
                      name: "is_active",
                      value: String(v.is_active),
                      options: [
                        { value: "true", label: t("marketing.active") },
                        { value: "false", label: t("marketing.archived") },
                      ],
                    },
                    { name: "reason" },
                  ]}
                />
                {!v.effective_to && (
                  <ActionForm
                    action="associate"
                    title="endAssociation"
                    base={{ driver_id: id, vehicle_id: v.id, end: true }}
                    fields={[{ name: "reason" }]}
                    onSaved={load}
                    disabled={!config.enabled}
                  />
                )}
              </details>
            )}
          </article>
        ))}
      </section>
      <section className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="text-lg font-bold">{t("marketing.loyalty")}</h2>
        <p>{t("marketing.availableCards", { count: available })}</p>
        {profile.redemption_exception && (
          <ErrorMessage code="REDEMPTION_HELD" />
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          {profile.cards.map((c) => (
            <div className="rounded-lg border p-3" key={c.id}>
              <strong>{t("marketing.card", { cycle: c.cycle })}</strong>
              <p>
                {c.credits}/12 · {t("marketing.heldCredits", { count: c.held })}
              </p>
              <Status
                value={
                  c.redeemed
                    ? "REDEEMED"
                    : c.credits === 12
                      ? "SAVED"
                      : "INCOMPLETE"
                }
              />
            </div>
          ))}
        </div>
        <p className="text-sm text-stone-600">{t("marketing.loyaltyHelp")}</p>
        {config.permissions["marketing.redeem"] && (
          <ActionForm
            action="redeem"
            title="redeem"
            base={{ driver_id: id }}
            onSaved={load}
            disabled={!config.enabled || available === 0}
            fields={[
              {
                name: "reward_code",
                options: config.rewards
                  .filter((r) => r.cards_required <= available)
                  .map((r) => ({
                    value: r.code,
                    label: `${locale === "hi" ? r.name_hi : r.name} (${r.cards_required})`,
                  })),
              },
              { name: "reference" },
            ]}
          />
        )}
        {canLoyalty && profile.punches.length === 0 && (
          <ActionForm
            action="opening"
            title="opening"
            base={{ driver_id: id }}
            onSaved={load}
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
        )}
        {canLoyalty && profile.redemption_exception && (
          <ActionForm
            action="resolve_exception"
            title="resolveException"
            base={{ driver_id: id }}
            fields={[{ name: "reason" }]}
            onSaved={load}
            disabled={!config.enabled}
          />
        )}
        {canLoyalty && profile.openings.length > 0 && (
          <details>
            <summary className="py-2 cursor-pointer">
              {t("marketing.adjustOpening")}
            </summary>
            <ActionForm
              action="adjust_opening"
              title="adjustOpening"
              base={{ driver_id: id }}
              onSaved={load}
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
          </details>
        )}
        <details>
          <summary className="py-2 cursor-pointer">
            {t("marketing.creditHistory")}
          </summary>
          <div className="space-y-3">
            {profile.punches.map((p) => (
              <div key={p.id} className="rounded-lg border p-3">
                <p>
                  {new Date(p.created_at).toLocaleString()} ·{" "}
                  <Status value={p.source} /> · <Status value={p.status} />
                </p>
                {p.review_reason && <p>{p.review_reason}</p>}
                {canLoyalty &&
                  p.source === "OPENING_BALANCE" &&
                  p.status !== "REVERSED" && (
                    <ActionForm
                      action="review_punch"
                      title="correctOpening"
                      base={{
                        punch_id: p.id,
                        version: p.version,
                        status: "REVERSED",
                      }}
                      fields={[{ name: "reason" }]}
                      onSaved={load}
                      disabled={!config.enabled}
                    />
                  )}
              </div>
            ))}
          </div>
        </details>
        {profile.openings.map((o) => (
          <p key={o.id}>
            {t("marketing.opening")}: {o.saved_cards} + {o.partial_credits}/12 ·{" "}
            {o.reference} · {o.evidence}
          </p>
        ))}
        <h3 className="font-bold">{t("marketing.redemptionHistory")}</h3>
        {profile.redemptions.map((r) => (
          <p key={r.id}>
            {new Date(r.created_at).toLocaleString()} ·{" "}
            {t(`marketing.rewards.${r.reward_code}`)} · {r.cards.length} ·{" "}
            {r.reference}
          </p>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-bold">{t("marketing.visitHistory")}</h2>
        {profile.visits.map((v) => (
          <button
            key={v.id}
            onClick={() => setSelected(v.id)}
            className="w-full min-h-14 rounded-xl border bg-white p-3 text-left"
          >
            {v.business_date} · {v.registration_snapshot} ·{" "}
            <Status value={v.reconciliation_state} /> · ₹{v.confirmed_revenue}
          </button>
        ))}
        <nav className="flex gap-3">
          <button
            className={buttonClass}
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("marketing.previous")}
          </button>
          <button
            className={buttonClass}
            disabled={page * 25 >= profile.visit_total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("marketing.next")}
          </button>
        </nav>
        {selected && (
          <VisitEditor
            key={selected}
            id={selected}
            config={config}
            onChanged={load}
          />
        )}
      </section>
      <details>
        <summary className="py-2 cursor-pointer">
          {t("marketing.auditHistory")}
        </summary>
        {profile.history.map((e) => (
          <p key={e.id}>
            {new Date(e.created_at).toLocaleString()} ·{" "}
            {t(`marketing.actions.${e.action}`)} · {e.reason}
          </p>
        ))}
      </details>
    </main>
  );
}
