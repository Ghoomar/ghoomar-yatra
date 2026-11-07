"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type { Driver } from "@/lib/marketing/domain";
import { TaxiArrival } from "@/components/marketing/TaxiArrival";
import {
  ActionForm,
  buttonClass,
  ErrorMessage,
  Field,
  inputClass,
  useRemoteJson,
  useMarketingConfig,
} from "@/components/marketing/shared";
export default function DriversPage() {
  const { t } = useI18n();
  const { config, error: configError } = useMarketingConfig();
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const { data, error, loading } = useRemoteJson<{
    drivers: Driver[];
    total: number;
  }>(
    `/api/operations/marketing?${new URLSearchParams({ mode: "directory", search, page: String(page) })}`,
    200,
  );
  return (
    <main className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("marketing.drivers")}</h1>
        <Link
          className={buttonClass}
          href="/operations/marketing/drivers/report"
        >
          {t("marketing.report")}
        </Link>
      </div>
      {config?.permissions["marketing.capture"] && <TaxiArrival onCountChanged={() => {}} />}
      <p>{t("marketing.directoryHelp")}</p>
      <Field label={t("marketing.search")}>
        <input
          className={inputClass}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <ErrorMessage code={error || configError} />
      {config && !config.enabled && (
        <p role="status">{t("marketing.disabled")}</p>
      )}
      {loading ? (
        <p role="status">{t("marketing.loading")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left">
            <thead>
              <tr>
                {["name", "phone", "is_active"].map((k) => (
                  <th className="p-3" key={k}>
                    {t(`marketing.fields.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.drivers.map((d) => (
                <tr key={d.id} className="border-t">
                  <td>
                    <Link
                      className="block min-h-12 p-3 font-semibold text-amber-800 underline"
                      href={`/operations/marketing/drivers/${d.id}`}
                    >
                      {d.name}
                    </Link>
                  </td>
                  <td className="p-3">{d.phone}</td>
                  <td className="p-3">
                    {t(d.is_active ? "marketing.active" : "marketing.archived")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.drivers.length === 0 && (
            <p className="p-4">{t("marketing.empty")}</p>
          )}
        </div>
      )}
      <nav
        className="flex gap-3 items-center"
        aria-label={t("marketing.pagination")}
      >
        <button
          className={buttonClass}
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          {t("marketing.previous")}
        </button>
        <span>{t("marketing.page", { page, total: data?.total ?? 0 })}</span>
        <button
          className={buttonClass}
          disabled={page * 25 >= (data?.total ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("marketing.next")}
        </button>
      </nav>
      {config?.permissions["marketing.manage"] && (
        <details>
          <summary className="py-3 cursor-pointer">
            {t("marketing.futureRates")}
          </summary>
          <ActionForm
            action="rate"
            title="futureRates"
            base={{}}
            disabled={!config.enabled}
            onSaved={() => {}}
            fields={[
              {
                name: "category_code",
                options: config.categories.map((c) => ({
                  value: c.code,
                  label: t(`marketing.categories.${c.code}`),
                })),
              },
              { name: "valid_from", type: "date" },
              { name: "amount" },
              { name: "reason" },
            ]}
          />
        </details>
      )}
    </main>
  );
}
