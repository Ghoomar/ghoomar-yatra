"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type { Driver, Vehicle, Visit } from "@/lib/marketing/domain";
import { normalizePhone, validRegistration } from "@/lib/marketing/domain";
import {
  buttonClass,
  ErrorMessage,
  Field,
  inputClass,
  marketingRead,
  Status,
  useMarketingConfig,
  useMarketingMutation,
} from "./shared";
import { VisitEditor } from "./VisitEditor";
export function TaxiArrival({
  onCountChanged,
}: {
  onCountChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const { config, error: configError } = useMarketingConfig();
  const { mutate, busy, error } = useMarketingMutation();
  const [open, setOpen] = useState(false),
    [registration, setRegistration] = useState(""),
    [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]),
    [driverId, setDriverId] = useState(""),
    [phone, setPhone] = useState(""),
    [name, setName] = useState("");
  const [category, setCategory] = useState("CAR_5"),
    [model, setModel] = useState(""),
    [guests, setGuests] = useState("true"),
    [lookupDone, setLookupDone] = useState(false);
  const [queue, setQueue] = useState<Visit[]>([]),
    [selected, setSelected] = useState(""),
    [localError, setLocalError] = useState(""),
    [lookupBusy, setLookupBusy] = useState(false);
  const [manualEvents, setManualEvents] = useState<
      { id: string; timestamp: string; vehicle_prefix: string | null }[]
    >([]),
    [manualEvent, setManualEvent] = useState("");
  const refresh = useCallback(() => {
    marketingRead<Visit[]>("queue")
      .then(setQueue)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (config?.enabled) refresh();
  }, [config, refresh]);
  useEffect(() => {
    if (open && config?.enabled) {
      marketingRead<typeof manualEvents>("manual_events")
        .then(setManualEvents)
        .catch(() => setManualEvents([]));
    }
  }, [open, config]);
  if (configError === "AUTH_REQUIRED")
    return (
      <section className="rounded-xl border p-4 space-y-3">
        <h2 className="font-bold">{t("marketing.taxiArrival")}</h2>
        <ErrorMessage code={configError} />
        <Link href="/login" className={buttonClass}>
          {t("marketing.signIn")}
        </Link>
      </section>
    );
  if (!config?.enabled)
    return configError && configError !== "FORBIDDEN" ? (
      <ErrorMessage code={configError} />
    ) : null;
  if (!config.permissions["marketing.capture"]) return null;
  return (
    <section className="space-y-3">
      <button
        type="button"
        className={`${buttonClass} w-full text-xl min-h-16`}
        onClick={() => {
          setManualEvent("");
          setOpen(!open);
        }}
        aria-expanded={open}
      >
        {t("marketing.taxiArrival")}
      </button>
      {open && (
        <form
          className="rounded-xl border bg-white p-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLocalError("");
            try {
              if (!lookupDone || !validRegistration(registration))
                throw new Error("LOOKUP_REQUIRED");
              let selectedVehicle = vehicle,
                selectedDriver = driverId;
              if (!selectedDriver && !name.trim())
                throw new Error("SELECT_ASSOCIATED_DRIVER");
              if (!selectedDriver) normalizePhone(phone);
              if (
                !selectedVehicle ||
                !selectedDriver ||
                !selectedVehicle.drivers?.some((d) => d.id === selectedDriver)
              ) {
                const registered = await mutate<{
                  driver: Driver;
                  vehicle: Vehicle;
                }>("register", {
                  ...(selectedDriver
                    ? { driver_id: selectedDriver }
                    : { name, phone }),
                  ...(selectedVehicle
                    ? { vehicle_id: selectedVehicle.id }
                    : {
                        registration,
                        make_model: model,
                        category_code: category,
                      }),
                });
                selectedDriver = registered.driver.id;
                selectedVehicle = {
                  ...registered.vehicle,
                  drivers: [registered.driver],
                };
                setDriverId(selectedDriver);
                setVehicle(selectedVehicle);
                setDrivers([registered.driver]);
              }
              const arrived = await mutate<Visit>("arrival", {
                driver_id: selectedDriver,
                vehicle_id: selectedVehicle!.id,
                brought_guests: guests === "true",
                ...(manualEvent ? { manual_event_id: manualEvent } : {}),
              });
              setSelected(arrived.id);
              setOpen(false);
              setRegistration("");
              setLookupDone(false);
              setVehicle(null);
              setDrivers([]);
              setDriverId("");
              setName("");
              setPhone("");
              refresh();
              onCountChanged();
            } catch (e) {
              setLocalError(e instanceof Error ? e.message : "REQUEST_FAILED");
            }
          }}
        >
          <p className="text-sm text-stone-600">{t("marketing.onlineHelp")}</p>
          <Field label={t("marketing.fields.registration")}>
            <input
              autoFocus
              value={registration}
              onChange={(e) => {
                setRegistration(e.target.value);
                setLookupDone(false);
                setVehicle(null);
                setDriverId("");
                setDrivers([]);
              }}
              className={inputClass}
              required
              autoCapitalize="characters"
              maxLength={30}
            />
          </Field>
          <button
            type="button"
            disabled={busy || lookupBusy}
            className={buttonClass}
            onClick={async () => {
              setLookupBusy(true);
              setLocalError("");
              try {
                if (!validRegistration(registration))
                  throw new Error("INVALID_REGISTRATION");
                const found = await marketingRead<{ vehicles: Vehicle[] }>(
                  "lookup",
                  { search: registration },
                );
                const v = found.vehicles[0] || null;
                if (v && !v.is_active) throw new Error("VEHICLE_UNAVAILABLE");
                setVehicle(v);
                setDrivers(v?.drivers?.filter((d) => d.is_active) || []);
                setDriverId("");
                setLookupDone(true);
              } catch (e) {
                setLocalError((e as Error).message);
              } finally {
                setLookupBusy(false);
              }
            }}
          >
            {t("marketing.lookup")}
          </button>
          {lookupDone && (
            <>
              {vehicle ? (
                <p className="font-semibold">
                  {vehicle.make_model} ·{" "}
                  {t(`marketing.categories.${vehicle.category_code}`)}
                </p>
              ) : (
                <>
                  <Field label={t("marketing.fields.make_model")}>
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className={inputClass}
                      required
                    />
                  </Field>
                  <Field label={t("marketing.fields.category_code")}>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className={inputClass}
                    >
                      {config.categories.map((c) => (
                        <option key={c.code} value={c.code}>
                          {locale === "hi" ? c.name_hi : c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              <Field label={t("marketing.arrivingDriver")}>
                <select
                  className={inputClass}
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                >
                  <option value="">{t("marketing.selectOrRegister")}</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.phone}
                    </option>
                  ))}
                </select>
              </Field>
              {!driverId && (
                <>
                  <Field label={t("marketing.fields.phone")}>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={inputClass}
                      required
                    />
                  </Field>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={lookupBusy}
                    onClick={async () => {
                      setLookupBusy(true);
                      try {
                        normalizePhone(phone);
                        const found = await marketingRead<{
                          drivers: Driver[];
                        }>("lookup", { search: phone });
                        setDrivers(found.drivers.filter((d) => d.is_active));
                        if (!found.drivers.length) setLocalError("");
                      } catch (e) {
                        setLocalError((e as Error).message);
                      } finally {
                        setLookupBusy(false);
                      }
                    }}
                  >
                    {t("marketing.findPhone")}
                  </button>
                  <Field label={t("marketing.fields.name")}>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={inputClass}
                      required
                      maxLength={160}
                    />
                  </Field>
                  <p className="text-xs text-stone-600">
                    {t("marketing.explicitDriverHelp")}
                  </p>
                </>
              )}
              <Field label={t("marketing.fields.brought_guests")}>
                <select
                  value={guests}
                  onChange={(e) => setGuests(e.target.value)}
                  className={inputClass}
                >
                  <option value="true">{t("marketing.yes")}</option>
                  <option value="false">{t("marketing.no")}</option>
                </select>
              </Field>
              <Field label={t("marketing.alreadyCounted")}>
                <select
                  value={manualEvent}
                  onChange={(e) => setManualEvent(e.target.value)}
                  className={inputClass}
                >
                  <option value="">{t("marketing.newCount")}</option>
                  {manualEvents.map((e) => (
                    <option key={e.id} value={e.id}>
                      {new Date(e.timestamp).toLocaleTimeString(
                        locale === "hi" ? "hi-IN" : "en-IN",
                        { timeZone: "Asia/Kolkata" },
                      )}{" "}
                      · {e.vehicle_prefix}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                className={`${buttonClass} w-full`}
                disabled={busy || lookupBusy}
              >
                {t(busy ? "marketing.saving" : "marketing.saveArrival")}
              </button>
            </>
          )}
          <ErrorMessage code={localError || error} />
        </form>
      )}
      <div className="space-y-2">
        <h2 className="font-bold">{t("marketing.openVisits")}</h2>
        {queue.map((v) => (
          <button
            type="button"
            className="w-full rounded-xl border bg-white p-3 text-left min-h-14"
            key={v.id}
            onClick={() => setSelected(v.id)}
          >
            {v.registration_snapshot} · {v.driver_name_snapshot} ·{" "}
            <Status value={v.reconciliation_state} />
          </button>
        ))}
      </div>
      {selected && (
        <VisitEditor
          key={selected}
          id={selected}
          config={config}
          onChanged={() => {
            refresh();
            onCountChanged();
          }}
        />
      )}
    </section>
  );
}
