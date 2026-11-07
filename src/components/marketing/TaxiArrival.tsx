"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { Visit } from "@/lib/marketing/domain";
import {
  marketingRead,
  Status,
  useMarketingConfig,
} from "./shared";
import { TaxiArrivalModal } from "./TaxiArrivalModal";
import { VisitEditor } from "./VisitEditor";
import { Car, Clock, ChevronRight, X } from "lucide-react";

export function TaxiArrival({
  onCountChanged,
}: {
  onCountChanged: () => void;
}) {
  const { t } = useI18n();
  const { config, loading: configLoading } = useMarketingConfig();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [queue, setQueue] = useState<Visit[]>([]);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);

  const refreshQueue = useCallback(() => {
    marketingRead<Visit[]>("queue")
      .then(setQueue)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshQueue();
  }, [refreshQueue]);

  return (
    <section className="space-y-3">
      {/* 1. INSTANT TOUCH TAXI ARRIVAL BUTTON (Zero Network-Blocking Delay) */}
      <button
        type="button"
        data-testid="btn-taxi-arrival"
        onClick={() => setIsModalOpen(true)}
        className="w-full h-15 sm:h-16 rounded-2xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-stone-950 font-black text-xl sm:text-2xl shadow-xs flex items-center justify-center gap-2.5 transition-transform active:scale-95 cursor-pointer touch-manipulation border border-amber-600/30"
      >
        <Car className="h-6 w-6 text-stone-950" />
        <span>{t("marketing.taxiArrival")}</span>
      </button>

      {/* 2. SMART TAXI ARRIVAL POP-UP MODAL */}
      <TaxiArrivalModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          refreshQueue();
          onCountChanged();
        }}
        config={config}
        configLoading={configLoading}
      />

      {/* 3. COMPACT VISITS TO COMPLETE QUEUE */}
      {queue.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-2xl p-3 sm:p-4 shadow-xs space-y-2.5">
          <div className="flex items-center justify-between border-b border-stone-100 pb-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              <h3 className="text-xs font-black text-stone-800 uppercase tracking-wider">
                {t("marketing.openVisits")}
              </h3>
            </div>
            <span className="text-xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full font-mono">
              {queue.length}
            </span>
          </div>

          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {queue.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedVisitId(v.id)}
                className="w-full p-2.5 rounded-xl border border-stone-200 hover:border-amber-300 bg-stone-50/60 hover:bg-amber-50/30 text-left flex items-center justify-between transition-all cursor-pointer group"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-sm text-stone-900">
                      {v.registration_snapshot}
                    </span>
                    <span className="text-xs text-stone-600 truncate">
                      · {v.driver_name_snapshot}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-stone-500">
                    <Status value={v.reconciliation_state} />
                    {v.eligible_amount && (
                      <span className="font-mono font-bold text-stone-700">
                        ₹{v.eligible_amount}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-stone-400 group-hover:text-amber-600 transition-colors shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 4. MODAL DIALOG FOR VISIT EDITOR (No layout pushdown) */}
      {selectedVisitId && config && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedVisitId(null);
          }}
        >
          <div className="bg-white rounded-2xl max-w-xl w-full p-4 sm:p-6 shadow-2xl border border-stone-200 max-h-[92vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-2">
              <h3 className="text-base font-bold text-stone-900">
                {t("marketing.visitDetails")}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedVisitId(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <VisitEditor
              key={selectedVisitId}
              id={selectedVisitId}
              config={config}
              onChanged={() => {
                refreshQueue();
                onCountChanged();
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
