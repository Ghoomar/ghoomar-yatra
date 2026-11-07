"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppRole } from "@/components/layout/AppShell";
import type {
  Bill,
  MarketingConfig,
  Punch,
  Visit,
} from "@/lib/marketing/domain";
import { ActionForm, ErrorMessage, marketingRead, Status } from "./shared";
type Detail = Visit & {
  bills: Bill[];
  punch: Punch | null;
  reconciliation_events: {
    id: string;
    created_at: string;
    before_state: string;
    after_state: string;
    amount: string | null;
  }[];
};
export function VisitEditor({
  id,
  config,
  onChanged,
}: {
  id: string;
  config: MarketingConfig;
  onChanged?: () => void;
}) {
  const { t, formatDate } = useI18n();
  const { user } = useAppRole();
  const [visit, setVisit] = useState<Detail | null>(null),
    [error, setError] = useState("");
  const load = useCallback(() => {
    marketingRead<Detail>("visit", { visit_id: id })
      .then((v) => {
        setVisit(v);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);
  const saved = () => {
    load();
    onChanged?.();
  };
  if (!visit) return <ErrorMessage code={error} />;
  const canManage = config.permissions["marketing.manage"];
  const canReconcile = config.permissions["marketing.reconcile"];
  const canEdit =
    config.enabled &&
    !visit.voided_at &&
    (canManage ||
      (!visit.finalized_at &&
        config.permissions["marketing.capture"] &&
        (user?.id === visit.created_by || !user)));
  const base = { visit_id: id, version: visit.version };
  const reason = { name: "reason", required: true };
  return (
    <section
      className="space-y-4 rounded-xl border bg-white p-4"
      aria-label={t("marketing.visitDetails")}
    >
      <div>
        <h2 className="font-bold text-lg">
          {visit.driver_name_snapshot} · {visit.registration_snapshot}
        </h2>
        <p>
          {formatDate(visit.business_date)} ·{" "}
          <Status value={visit.reconciliation_state} />
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["guests", visit.guests],
          ["confirmedRevenue", `₹${visit.confirmed_revenue}`],
          ["eligible", `₹${visit.eligible_amount}`],
          ["given", `₹${visit.actual_amount}`],
        ].map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-stone-500">{t(`marketing.${key}`)}</dt>
            <dd className="font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        {t("marketing.unresolved", { count: visit.unresolved })} ·{" "}
        <Status value={visit.collection_status} />
        {visit.punch && (
          <>
            {" "}
            · <Status value={visit.punch.status} />
          </>
        )}
      </p>
      <ErrorMessage code={error} />
      <button type="button" className="min-h-12 underline" onClick={load}>
        {t("marketing.refreshDetails")}
      </button>
      <div className="space-y-3">
        {visit.bills.map((bill) => (
          <article key={bill.id} className="rounded-lg border p-3 space-y-3">
            <p>
              <strong>{bill.invoice_no}</strong> ·{" "}
              {formatDate(bill.business_date)} · {bill.allocated_guests}{" "}
              {t("marketing.guests")} · <Status value={bill.state} />
            </p>
            {(canEdit || (canReconcile && !visit.finalized_at)) &&
              !bill.voided_at &&
              !visit.voided_at && (
                <details>
                  <summary className="cursor-pointer py-2">
                    {t("marketing.correctBill")}
                  </summary>
                  <ActionForm
                    key={`${bill.id}-${visit.version}`}
                    action="bill"
                    title="correctBill"
                    base={{ ...base, bill_id: bill.id }}
                    onSaved={saved}
                    disabled={!config.enabled}
                    fields={[
                      { name: "invoice_no", value: bill.invoice_no },
                      {
                        name: "business_date",
                        type: "date",
                        value: bill.business_date,
                      },
                      {
                        name: "allocated_guests",
                        type: "number",
                        value: String(bill.allocated_guests),
                        min: 0,
                        max: 1000,
                      },
                      reason,
                    ]}
                  />
                  <ActionForm
                    action="bill"
                    title="voidBill"
                    base={{ ...base, bill_id: bill.id, void: true }}
                    fields={[reason]}
                    onSaved={saved}
                    disabled={!config.enabled}
                  />
                  {canReconcile && bill.candidates.length > 0 && (
                    <ActionForm
                      action="resolve_bill"
                      title="resolveBill"
                      base={{ ...base, bill_id: bill.id }}
                      onSaved={saved}
                      disabled={!config.enabled}
                      fields={[
                        {
                          name: "sale_id",
                          options: bill.candidates.map((c) => ({
                            value: c.id,
                            label: `${c.invoice_no} · ${t(`marketing.status.${c.status.toUpperCase()}`)} · ₹${c.net_sales}`,
                          })),
                        },
                        reason,
                      ]}
                    />
                  )}
                </details>
              )}
          </article>
        ))}
      </div>
      {(canEdit || canReconcile) &&
        visit.brought_guests &&
        !visit.voided_at && (
          <ActionForm
            key={`bill-${visit.version}`}
            action="bill"
            title="addBill"
            base={base}
            onSaved={saved}
            disabled={!config.enabled}
            fields={[
              { name: "invoice_no" },
              {
                name: "business_date",
                type: "date",
                value: visit.business_date,
              },
              { name: "allocated_guests", type: "number", min: 0, max: 1000 },
              { name: "reason", required: false },
            ]}
          />
        )}
      {visit.brought_guests && (
        <p className="text-sm text-stone-600">
          {t("marketing.guestAllocationHelp")}
        </p>
      )}
      {canEdit && visit.brought_guests && (
        <ActionForm
          key={`cash-${visit.version}`}
          action="incentive"
          title="recordIncentive"
          base={base}
          onSaved={saved}
          fields={[
            {
              name: "collection_status",
              value: visit.collection_status,
              options: ["PENDING", "GIVEN", "NOT_COLLECTED"].map((value) => ({
                value,
                label: t(`marketing.status.${value}`),
              })),
            },
            { name: "actual_amount", value: visit.actual_amount },
            { name: "reason", required: false },
          ]}
        />
      )}
      {canEdit && !visit.finalized_at && (
        <ActionForm
          action="finalize"
          title="finalize"
          base={base}
          fields={[]}
          onSaved={saved}
        />
      )}
      {canManage && !visit.voided_at && (
        <details>
          <summary className="py-2 cursor-pointer">
            {t("marketing.voidVisit")}
          </summary>
          <ActionForm
            action="void_visit"
            title="voidVisit"
            base={base}
            fields={[reason]}
            onSaved={saved}
            disabled={!config.enabled}
          />
        </details>
      )}
      {config.permissions["marketing.loyalty"] && visit.punch && (
        <ActionForm
          action="review_punch"
          title="reviewPunch"
          base={{ punch_id: visit.punch.id, version: visit.punch.version }}
          onSaved={saved}
          disabled={!config.enabled}
          fields={[
            {
              name: "status",
              options: ["CONFIRMED", "REVERSED"].map((value) => ({
                value,
                label: t(`marketing.status.${value}`),
              })),
            },
            reason,
          ]}
        />
      )}
      <details>
        <summary className="cursor-pointer py-2">
          {t("marketing.reconciliationHistory")}
        </summary>
        <ul className="space-y-2 text-sm">
          {visit.reconciliation_events.map((e) => (
            <li key={e.id}>
              {new Date(e.created_at).toLocaleString()} ·{" "}
              <Status value={e.after_state} /> ·{" "}
              {e.amount === null ? "—" : `₹${e.amount}`}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
