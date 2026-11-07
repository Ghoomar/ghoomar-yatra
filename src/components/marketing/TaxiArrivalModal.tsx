"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import {
  type Driver,
  type Vehicle,
  type Visit,
  type MarketingConfig,
  normalizePhone,
  validRegistration,
  normalizeRegistration,
} from "@/lib/marketing/domain";
import {
  marketingRead,
  useMarketingMutation,
  ErrorMessage,
} from "./shared";
import {
  X,
  Car,
  UserCheck,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Phone,
  User,
  ShieldCheck,
  Users,
} from "lucide-react";

interface TaxiArrivalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  config: MarketingConfig | null;
  configLoading?: boolean;
}

const QUICK_PREFIXES = ["UP21", "UP22", "UP23", "UP16", "DL", "HR", "UK"];

export function TaxiArrivalModal({
  isOpen,
  onClose,
  onSuccess,
  config,
  configLoading = false,
}: TaxiArrivalModalProps) {
  const { t, locale } = useI18n();
  const { mutate, busy, error: mutationError } = useMarketingMutation();

  // License plate input state
  const [prefix, setPrefix] = useState("");
  const [number, setNumber] = useState("");

  const prefixRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);

  // Lookup state
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [associatedDrivers, setAssociatedDrivers] = useState<Driver[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [isNewDriverMode, setIsNewDriverMode] = useState(false);

  // New vehicle fields
  const [categoryCode, setCategoryCode] = useState("CAR_5");
  const [makeModel, setMakeModel] = useState("");

  // Driver fields (for new driver or unassociated driver)
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [phoneLookupBusy, setPhoneLookupBusy] = useState(false);
  const [phoneLookupMessage, setPhoneLookupMessage] = useState<string | null>(null);

  // Visit parameters
  const [broughtGuests, setBroughtGuests] = useState(true);
  const [manualEvents, setManualEvents] = useState<
    { id: string; timestamp: string; vehicle_prefix: string | null }[]
  >([]);
  const [selectedManualEvent, setSelectedManualEvent] = useState("");

  // Error handling
  const [localError, setLocalError] = useState("");

  // Generation counter to prevent race conditions during async lookups
  const lookupGeneration = useRef(0);

  // Auto-focus prefix on modal open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        prefixRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Load manual vehicle events if config is enabled
  useEffect(() => {
    if (isOpen && config?.enabled) {
      marketingRead<typeof manualEvents>("manual_events")
        .then(setManualEvents)
        .catch(() => setManualEvents([]));
    }
  }, [isOpen, config]);

  // Reset form when modal opens/closes
  const resetForm = useCallback(() => {
    setPrefix("");
    setNumber("");
    setLookupDone(false);
    setVehicle(null);
    setAssociatedDrivers([]);
    setSelectedDriverId("");
    setIsNewDriverMode(false);
    setCategoryCode("CAR_5");
    setMakeModel("");
    setPhone("");
    setName("");
    setPhoneLookupMessage(null);
    setBroughtGuests(true);
    setSelectedManualEvent("");
    setLocalError("");
  }, []);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Full normalized registration string
  const fullRegistration = useMemo(() => {
    return normalizeRegistration(`${prefix}${number}`);
  }, [prefix, number]);

  // Rate lookup helper based on category
  const getRateForCategory = useCallback(
    (code: string): string => {
      if (!config?.rates) return "";
      const r = config.rates.find((rate) => rate.category_code === code);
      return r ? `₹${r.amount}` : "";
    },
    [config]
  );

  // Debounced auto-lookup when registration becomes valid (>= 5 characters)
  useEffect(() => {
    if (!validRegistration(fullRegistration)) {
      setLookupDone(false);
      setVehicle(null);
      setAssociatedDrivers([]);
      setSelectedDriverId("");
      return;
    }

    const currentGen = ++lookupGeneration.current;
    const timer = setTimeout(async () => {
      setLookupBusy(true);
      setLocalError("");
      try {
        const found = await marketingRead<{ vehicles: Vehicle[] }>("lookup", {
          search: fullRegistration,
        });

        // Ignore stale responses
        if (currentGen !== lookupGeneration.current) return;

        const v = found.vehicles[0] || null;
        if (v && !v.is_active) {
          setLocalError("VEHICLE_UNAVAILABLE");
          setLookupDone(true);
          setVehicle(null);
          return;
        }

        setVehicle(v);
        const activeDrivers = v?.drivers?.filter((d) => d.is_active) || [];
        setAssociatedDrivers(activeDrivers);
        if (activeDrivers.length > 0) {
          setSelectedDriverId(activeDrivers[0].id);
          setIsNewDriverMode(false);
        } else {
          setSelectedDriverId("");
          setIsNewDriverMode(true);
        }
        setLookupDone(true);
      } catch (err) {
        if (currentGen === lookupGeneration.current) {
          setLocalError(err instanceof Error ? err.message : "LOOKUP_FAILED");
        }
      } finally {
        if (currentGen === lookupGeneration.current) {
          setLookupBusy(false);
        }
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [fullRegistration]);

  // Smart prefix input handler
  const handlePrefixChange = (raw: string) => {
    setLocalError("");
    const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

    // Smart paste handling (e.g. "UP16 T 1234" or "UP16T1234" pasted into prefix box)
    if (clean.length > 4) {
      // Split first 4 as prefix, rest as number
      const autoPrefix = clean.slice(0, 4);
      const autoNumber = clean.slice(4);
      setPrefix(autoPrefix);
      setNumber(autoNumber);
      numberRef.current?.focus();
      return;
    }

    setPrefix(clean.slice(0, 4));
    // Auto-advance if 4 characters reached (e.g. UP16 or DL01 or HR26)
    if (clean.length === 4) {
      numberRef.current?.focus();
    }
  };

  // Quick prefix chip click handler
  const handleQuickChipClick = (p: string) => {
    setPrefix(p);
    setLocalError("");
    numberRef.current?.focus();
  };

  // Smart number input handler
  const handleNumberChange = (raw: string) => {
    setLocalError("");
    const clean = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
    setNumber(clean.slice(0, 8));
  };

  // Phone lookup handler (to check if driver exists when registering new driver)
  const handlePhoneCheck = async (rawPhone: string) => {
    setPhone(rawPhone);
    setPhoneLookupMessage(null);
    const digitsOnly = rawPhone.replace(/\D/g, "");
    if (digitsOnly.length >= 10) {
      setPhoneLookupBusy(true);
      try {
        const normalized = normalizePhone(rawPhone);
        const found = await marketingRead<{ drivers: Driver[] }>("lookup", {
          search: normalized,
        });
        const activeDriver = found.drivers.find((d) => d.is_active);
        if (activeDriver) {
          setName(activeDriver.name);
          setSelectedDriverId(activeDriver.id);
          setPhoneLookupMessage(`Known Driver: ${activeDriver.name}`);
        } else {
          setPhoneLookupMessage(null);
        }
      } catch {
        // Not a full phone yet or invalid, keep typing
      } finally {
        setPhoneLookupBusy(false);
      }
    }
  };

  // Form submission handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");

    try {
      if (!validRegistration(fullRegistration)) {
        throw new Error("INVALID_REGISTRATION");
      }

      let targetVehicleId = vehicle?.id;
      let targetDriverId = selectedDriverId;

      // 1. If new driver details entered or new vehicle, register first
      if (!targetVehicleId || !targetDriverId || isNewDriverMode) {
        if (!targetDriverId && !name.trim()) {
          throw new Error("DRIVER_NAME_REQUIRED");
        }
        if (!targetDriverId) {
          normalizePhone(phone);
        }

        const registered = await mutate<{
          driver: Driver;
          vehicle: Vehicle;
        }>("register", {
          ...(targetDriverId ? { driver_id: targetDriverId } : { name: name.trim(), phone }),
          ...(targetVehicleId
            ? { vehicle_id: targetVehicleId }
            : {
                registration: fullRegistration,
                make_model: makeModel.trim(),
                category_code: categoryCode,
              }),
        });

        targetDriverId = registered.driver.id;
        targetVehicleId = registered.vehicle.id;
      }

      // 2. Record arrival transaction
      await mutate<Visit>("arrival", {
        driver_id: targetDriverId,
        vehicle_id: targetVehicleId,
        brought_guests: broughtGuests,
        ...(selectedManualEvent ? { manual_event_id: selectedManualEvent } : {}),
      });

      // 3. Close modal & notify parent
      handleClose();
      onSuccess();
    } catch (err: any) {
      setLocalError(err instanceof Error ? err.message : "REQUEST_FAILED");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="taxi-modal-title"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-white rounded-2xl max-w-lg w-full p-4 sm:p-6 shadow-2xl border border-stone-200 space-y-4 max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-stone-100 pb-3">
          <div className="space-y-0.5">
            <h2 id="taxi-modal-title" className="text-lg font-black text-stone-900 flex items-center gap-2">
              <Car className="h-5 w-5 text-amber-600" />
              <span>{t("marketing.taxiArrival")}</span>
            </h2>
            <p className="text-xs text-stone-500">
              {t("marketing.modalSubtitle") || "Quick-entry for commercial taxis & drivers"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Loading State when config is still loading in background */}
        {configLoading && !config ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-3 text-stone-500">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="text-xs font-semibold">{t("marketing.loadingConfig") || "Loading taxi configuration…"}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* SECTION 1: SMART DUAL-BOX LICENSE PLATE INPUT */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider">
                {t("marketing.fields.registration")}
              </label>

              {/* Two license plate input boxes styled like an Indian number plate */}
              <div className="flex items-center justify-center gap-2 sm:gap-3 py-1">
                {/* Box 1: State & RTO Prefix */}
                <div className="flex flex-col items-center">
                  <input
                    ref={prefixRef}
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={4}
                    value={prefix}
                    onChange={(e) => handlePrefixChange(e.target.value)}
                    placeholder="UP16"
                    className="w-24 sm:w-28 h-16 text-center font-mono text-2xl sm:text-3xl font-black rounded-xl border-2 border-amber-400 bg-amber-50/50 text-stone-900 focus:outline-none focus:ring-4 focus:ring-amber-500/20 uppercase tracking-widest"
                  />
                  <span className="text-[10px] text-stone-500 mt-1 font-bold uppercase tracking-wider">
                    {t("marketing.prefixLabel") || "Prefix (RTO)"}
                  </span>
                </div>

                <span className="text-2xl font-black text-stone-300 pb-5">−</span>

                {/* Box 2: Vehicle Series & Number */}
                <div className="flex flex-col items-center flex-1 max-w-[200px]">
                  <input
                    ref={numberRef}
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={8}
                    value={number}
                    onChange={(e) => handleNumberChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !number) {
                        prefixRef.current?.focus();
                      }
                    }}
                    placeholder="T 1234"
                    className="w-full h-16 text-center font-mono text-2xl sm:text-3xl font-black rounded-xl border-2 border-amber-400 bg-amber-50/50 text-stone-900 focus:outline-none focus:ring-4 focus:ring-amber-500/20 uppercase tracking-widest"
                  />
                  <span className="text-[10px] text-stone-500 mt-1 font-bold uppercase tracking-wider">
                    {t("marketing.numberLabel") || "Number"}
                  </span>
                </div>
              </div>

              {/* Quick Prefix Chips for 1-Tap Entry */}
              <div className="flex items-center gap-1.5 flex-wrap justify-center pt-0.5">
                <span className="text-[11px] font-bold text-stone-400 mr-1">
                  {t("marketing.quickPrefixes") || "Quick:"}
                </span>
                {QUICK_PREFIXES.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleQuickChipClick(chip)}
                    className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg border transition-all cursor-pointer ${
                      prefix === chip
                        ? "bg-amber-500 text-stone-950 border-amber-600 shadow-2xs scale-105"
                        : "bg-stone-50 text-stone-700 border-stone-200 hover:border-amber-300 hover:bg-amber-50/60"
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* AUTHENTIC INDIAN COMMERCIAL YELLOW NUMBER PLATE BANNER */}
              <div className="mt-2 bg-amber-400 border-2 border-stone-900 rounded-xl px-3 sm:px-4 py-2 flex items-center justify-between shadow-xs">
                {/* Blue IND Badge */}
                <div className="flex flex-col items-center justify-center bg-sky-900 text-white rounded px-1.5 py-1 text-[9px] font-black leading-none">
                  <span className="text-[8px] text-amber-300">●</span>
                  <span>IND</span>
                </div>

                {/* Formatted Number Display */}
                <span className="font-mono font-black text-xl sm:text-2xl text-stone-950 tracking-wider">
                  {prefix || "____"} {number || "____"}
                </span>

                {/* Status Indicator */}
                <div>
                  {lookupBusy ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-stone-800 bg-amber-300 px-2 py-0.5 rounded-md">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Checking</span>
                    </span>
                  ) : vehicle ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-950 bg-emerald-300 px-2 py-0.5 rounded-md">
                      <CheckCircle2 className="h-3 w-3 text-emerald-900" />
                      <span>{t("marketing.returningTaxi") || "Known"}</span>
                    </span>
                  ) : validRegistration(fullRegistration) && lookupDone ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-950 bg-amber-200 px-2 py-0.5 rounded-md">
                      <span>{t("marketing.newTaxi") || "New"}</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-amber-900/70 font-semibold font-mono">TAXI</span>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION 2: DYNAMIC TAXI RECOGNITION / REGISTRATION FLOW */}
            {lookupDone && validRegistration(fullRegistration) && (
              <div className="space-y-4 pt-1 animate-in fade-in duration-200">
                {/* CASE A: RETURNING REGISTERED TAXI */}
                {vehicle ? (
                  <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-3">
                    {/* Vehicle Info Badge */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span className="text-sm font-bold text-emerald-950">
                          {vehicle.make_model || t(`marketing.categories.${vehicle.category_code}`)}
                        </span>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-200/70 text-emerald-900 font-mono">
                        {t(`marketing.categories.${vehicle.category_code}`)} · {getRateForCategory(vehicle.category_code)}
                      </span>
                    </div>

                    {/* Associated Driver Selection */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-stone-700">
                        {t("marketing.arrivingDriver")}
                      </label>

                      {associatedDrivers.length > 0 && !isNewDriverMode ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-1 gap-2">
                            {associatedDrivers.map((d) => (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => setSelectedDriverId(d.id)}
                                className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                                  selectedDriverId === d.id
                                    ? "bg-amber-500/20 border-amber-500 text-stone-900 font-bold shadow-2xs"
                                    : "bg-white border-stone-200 text-stone-700 hover:border-amber-300"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <UserCheck className="h-4 w-4 text-amber-600" />
                                  <span className="text-sm">{d.name}</span>
                                </div>
                                <span className="text-xs text-stone-500 font-mono">{d.phone}</span>
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsNewDriverMode(true);
                              setSelectedDriverId("");
                            }}
                            className="text-xs font-bold text-amber-700 hover:text-amber-800 underline cursor-pointer"
                          >
                            + {t("marketing.differentDriver") || "Different driver operating today?"}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2.5 pt-1">
                          <div>
                            <label className="block text-[11px] font-semibold text-stone-600">
                              {t("marketing.fields.phone")}
                            </label>
                            <input
                              type="tel"
                              value={phone}
                              onChange={(e) => handlePhoneCheck(e.target.value)}
                              placeholder="9876543210"
                              className="w-full h-11 px-3 text-sm rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                              required
                            />
                            {phoneLookupMessage && (
                              <p className="text-xs text-emerald-700 font-semibold mt-1">
                                ✓ {phoneLookupMessage}
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-stone-600">
                              {t("marketing.fields.name")}
                            </label>
                            <input
                              type="text"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              placeholder="Driver full name"
                              className="w-full h-11 px-3 text-sm rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                              required
                            />
                          </div>
                          {associatedDrivers.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsNewDriverMode(false);
                                setSelectedDriverId(associatedDrivers[0].id);
                              }}
                              className="text-xs font-bold text-stone-600 hover:underline cursor-pointer"
                            >
                              ← {t("marketing.backToKnownDrivers") || "Back to registered drivers"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* CASE B: NEW TAXI REGISTRATION */
                  <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 space-y-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                      <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span>{t("marketing.newTaxiHelp") || "New taxi. Select category and record driver:"}</span>
                    </div>

                    {/* 4 Large Touch Category Buttons */}
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider">
                        {t("marketing.fields.category_code")}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {config?.categories?.map((cat) => {
                          const rateStr = getRateForCategory(cat.code);
                          const isSelected = categoryCode === cat.code;
                          return (
                            <button
                              key={cat.code}
                              type="button"
                              onClick={() => setCategoryCode(cat.code)}
                              className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-amber-500 text-stone-950 border-amber-600 shadow-2xs font-bold scale-[1.02]"
                                  : "bg-white text-stone-700 border-stone-200 hover:border-amber-300"
                              }`}
                            >
                              <span className="text-xs font-black truncate">
                                {locale === "hi" ? cat.name_hi : cat.name}
                              </span>
                              <span className={`text-sm font-mono font-black mt-1 ${isSelected ? "text-stone-950" : "text-amber-700"}`}>
                                {rateStr || "—"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Make / Model Input */}
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600">
                        {t("marketing.fields.make_model")} (Optional)
                      </label>
                      <input
                        type="text"
                        value={makeModel}
                        onChange={(e) => setMakeModel(e.target.value)}
                        placeholder="e.g. Dzire, Ertiga, Innova"
                        className="w-full h-10 px-3 text-sm rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    {/* Driver Phone & Name Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="block text-[11px] font-semibold text-stone-600 flex items-center gap-1">
                          <Phone className="h-3 w-3 text-stone-400" />
                          <span>{t("marketing.fields.phone")}</span>
                        </label>
                        <input
                          type="tel"
                          value={phone}
                          onChange={(e) => handlePhoneCheck(e.target.value)}
                          placeholder="9876543210"
                          className="w-full h-10 px-3 text-sm rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                          required
                        />
                        {phoneLookupMessage && (
                          <p className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                            ✓ {phoneLookupMessage}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-stone-600 flex items-center gap-1">
                          <User className="h-3 w-3 text-stone-400" />
                          <span>{t("marketing.fields.name")}</span>
                        </label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Driver Name"
                          className="w-full h-10 px-3 text-sm rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                          required
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Brought Guests Toggle */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider">
                    {t("marketing.fields.brought_guests")}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBroughtGuests(true)}
                      className={`h-12 rounded-xl border font-bold text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        broughtGuests
                          ? "bg-amber-500 text-stone-950 border-amber-600 shadow-2xs font-black"
                          : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100"
                      }`}
                    >
                      <Users className="h-4 w-4" />
                      <span>{t("marketing.withGuests") || "Yes · Brought Guests"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBroughtGuests(false)}
                      className={`h-12 rounded-xl border font-bold text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        !broughtGuests
                          ? "bg-stone-700 text-white border-stone-800 shadow-2xs font-black"
                          : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100"
                      }`}
                    >
                      <X className="h-4 w-4" />
                      <span>{t("marketing.emptyTaxi") || "No · Empty Taxi (₹0)"}</span>
                    </button>
                  </div>
                </div>

                {/* Optional Attach to Recent Car Tap */}
                {manualEvents.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-500">
                      {t("marketing.alreadyCounted")}
                    </label>
                    <select
                      value={selectedManualEvent}
                      onChange={(e) => setSelectedManualEvent(e.target.value)}
                      className="w-full h-10 px-3 text-xs rounded-lg border border-stone-300 bg-white text-stone-800"
                    >
                      <option value="">{t("marketing.newCount")}</option>
                      {manualEvents.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {new Date(ev.timestamp).toLocaleTimeString(
                            locale === "hi" ? "hi-IN" : "en-IN",
                            { timeZone: "Asia/Kolkata" }
                          )}{" "}
                          · {ev.vehicle_prefix || "Car"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Error Message Alert */}
            {(localError || mutationError) && (
              <ErrorMessage code={localError || mutationError} />
            )}

            {/* Modal Actions */}
            <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={handleClose}
                className="h-12 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-sm transition-transform active:scale-95 cursor-pointer"
              >
                {t("marketing.cancel") || "Cancel"}
              </button>

              <button
                type="submit"
                disabled={busy || lookupBusy || !validRegistration(fullRegistration)}
                className={`h-12 rounded-xl font-black text-sm transition-transform active:scale-95 cursor-pointer shadow-xs flex items-center justify-center gap-2 ${
                  validRegistration(fullRegistration) && !busy && !lookupBusy
                    ? "bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950"
                    : "bg-stone-200 text-stone-400 cursor-not-allowed opacity-60"
                }`}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("marketing.saving")}</span>
                  </>
                ) : (
                  <span>{t("marketing.saveArrival")}</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
