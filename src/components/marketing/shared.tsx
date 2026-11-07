"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import {
  MARKETING_CLIENT_VERSION,
  type MarketingConfig,
} from "@/lib/marketing/domain";

export async function marketingRead<T>(
  mode: string,
  filter: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `/api/operations/marketing?${new URLSearchParams({ mode, ...filter })}`,
    { cache: "no-store", signal },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.code || "REQUEST_FAILED");
  return body as T;
}
export const MARKETING_CONFIG_CACHE_KEY = "ghoomar_marketing_config_cache";

export function getCachedMarketingConfig(): MarketingConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MARKETING_CONFIG_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MarketingConfig;
  } catch {
    return null;
  }
}

export function saveCachedMarketingConfig(config: MarketingConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MARKETING_CONFIG_CACHE_KEY, JSON.stringify(config));
  } catch {}
}

export function useMarketingConfig() {
  const [config, setConfig] = useState<MarketingConfig | null>(getCachedMarketingConfig);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (!config) setLoading(true);
    marketingRead<MarketingConfig>("config", {}, controller.signal)
      .then((fresh) => {
        setConfig(fresh);
        setLoading(false);
        saveCachedMarketingConfig(fresh);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  return { config, error, loading };
}
/** Key results to their request URL so filter changes never show stale values. */
export function useRemoteJson<T>(url: string | null, delay = 0) {
  const [result, setResult] = useState<{
    url: string;
    data: T | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(url, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.code || "REQUEST_FAILED");
          setResult({ url, data, error: "" });
        })
        .catch((error) => {
          if (error.name !== "AbortError")
            setResult({
              url,
              data: null,
              error: error.message || "REQUEST_FAILED",
            });
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, delay]);
  const current = result?.url === url ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? "",
    loading: Boolean(url && !current),
  };
}
export function useMarketingMutation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const inFlight = useRef(false);
  const retry = useRef<{ signature: string; id: string } | null>(null);
  const mutate = useCallback(
    async <T,>(action: string, data: Record<string, unknown>): Promise<T> => {
      if (inFlight.current) throw new Error("REQUEST_IN_PROGRESS");
      inFlight.current = true;
      setBusy(true);
      setError("");
      const signature = JSON.stringify({ action, data });
      if (retry.current?.signature !== signature)
        retry.current = { signature, id: crypto.randomUUID() };
      try {
        if (!navigator.onLine) throw new Error("ONLINE_REQUIRED");
        const response = await fetch("/api/operations/marketing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            data,
            request_id: retry.current.id,
            client_version: MARKETING_CLIENT_VERSION,
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.code || "REQUEST_FAILED");
        retry.current = null;
        return body as T;
      } catch (e) {
        const code = e instanceof Error ? e.message : "REQUEST_FAILED";
        setError(code);
        throw e;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );
  return { mutate, busy, error };
}
export function ErrorMessage({ code }: { code: string }) {
  const { t } = useI18n();
  if (!code) return null;
  const key = `marketing.errors.${code}`,
    message = t(key);
  return (
    <p
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800"
    >
      {message === key ? t("marketing.errors.REQUEST_FAILED") : message}
    </p>
  );
}
export const inputClass =
  "min-h-12 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 focus:ring-2 focus:ring-amber-500";
export const buttonClass =
  "min-h-12 rounded-lg bg-amber-500 px-4 py-2 font-semibold text-stone-950 disabled:opacity-50 touch-manipulation";
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Status({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <span className="rounded bg-stone-100 px-2 py-1 text-xs font-semibold">
      {t(`marketing.status.${value}`)}
    </span>
  );
}
export interface ActionField {
  name: string;
  type?: string;
  value?: string;
  required?: boolean;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
}
/** Small accessible forms for explicit, audited manager actions. */
export function ActionForm({
  action,
  title,
  fields,
  base,
  onSaved,
  disabled = false,
}: {
  action: string;
  title: string;
  fields: ActionField[];
  base: Record<string, unknown>;
  onSaved: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const { mutate, busy, error } = useMarketingMutation();
  const [done, setDone] = useState(false);
  return (
    <form
      className="space-y-3 rounded-xl border p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setDone(false);
        const form = event.currentTarget;
        const data = Object.fromEntries(new FormData(form));
        try {
          await mutate(action, { ...base, ...data });
          setDone(true);
          onSaved();
        } catch {
          /* localized below */
        }
      }}
    >
      <h3 className="font-semibold">{t(`marketing.${title}`)}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <Field key={field.name} label={t(`marketing.fields.${field.name}`)}>
            {field.options ? (
              <select
                name={field.name}
                defaultValue={field.value || ""}
                required={field.required ?? true}
                className={inputClass}
              >
                <option value="">{t("marketing.select")}</option>
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={field.name}
                type={field.type || "text"}
                defaultValue={field.value || ""}
                required={field.required ?? true}
                min={field.min}
                max={field.max}
                step={field.type === "number" ? "1" : undefined}
                maxLength={1000}
                className={inputClass}
              />
            )}
          </Field>
        ))}
      </div>
      <ErrorMessage code={error} />
      {done && <p role="status">{t("marketing.saved")}</p>}
      <button className={buttonClass} disabled={disabled || busy}>
        {t(busy ? "marketing.saving" : "marketing.save")}
      </button>
    </form>
  );
}
export function downloadCsv(filename: string, rows: unknown[][]) {
  const cell = (value: unknown) => {
    let s = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
