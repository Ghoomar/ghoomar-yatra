'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/lib/i18n/context';
import { X, Shield, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface PolicySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

export function PolicySettingsModal({ isOpen, onClose, onUpdated }: PolicySettingsModalProps) {
  const { t } = useI18n();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [autoApproveEnabled, setAutoApproveEnabled] = useState(true);
  const [lineLimit, setLineLimit] = useState('1500');
  const [dailyCap, setDailyCap] = useState('5000');
  const [highControlDays, setHighControlDays] = useState('7');
  const [frequentDays, setFrequentDays] = useState('15');

  const fetchSettings = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/finance/purchase-approval-settings');
      if (!res.ok) throw new Error('Failed to load settings');
      const data = await res.json();
      if (data.settings) {
        setAutoApproveEnabled(data.settings.auto_approve_enabled !== false);
        setLineLimit(String(data.settings.line_auto_approve_limit ?? 1500));
        setDailyCap(String(data.settings.daily_non_staple_auto_limit ?? 5000));
        setHighControlDays(String(data.settings.high_control_count_interval_days ?? 7));
        setFrequentDays(String(data.settings.frequent_monitoring_count_interval_days ?? 15));
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error loading settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
      setSuccessMessage(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/finance/purchase-approval-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_approve_enabled: autoApproveEnabled,
          line_auto_approve_limit: Number(lineLimit),
          daily_non_staple_auto_limit: Number(dailyCap),
          high_control_count_interval_days: parseInt(highControlDays, 10),
          frequent_monitoring_count_interval_days: parseInt(frequentDays, 10),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to update approval policy settings');
      }

      setSuccessMessage(t('purchases.policyModal.savedSuccess'));
      if (onUpdated) onUpdated();
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl max-w-lg w-full shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-100 text-purple-800 rounded-lg">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">{t('purchases.policyModal.title')}</h2>
              <p className="text-xs text-stone-500">{t('purchases.policyModal.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 flex items-center gap-2 text-xs">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {loading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-stone-400">
              <RefreshCw className="h-5 w-5 animate-spin text-purple-600" />
              <span>Loading policy settings...</span>
            </div>
          ) : (
            <>
              {/* Master Toggle */}
              <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50/70 flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-bold text-stone-900 text-xs block">
                    {t('purchases.policyModal.autoApproveEnabled')}
                  </span>
                  <p className="text-[11px] text-stone-500">
                    {t('purchases.policyModal.autoApproveEnabledDesc')}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={autoApproveEnabled}
                  onChange={(e) => setAutoApproveEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-stone-300 text-purple-600 focus:ring-purple-500 mt-1 cursor-pointer"
                />
              </div>

              {/* Per-Line Limit */}
              <div>
                <label className="block font-bold text-stone-800 mb-1">
                  {t('purchases.policyModal.lineLimit')}
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={lineLimit}
                  onChange={(e) => setLineLimit(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 p-2 text-xs text-stone-900 focus:outline-none focus:border-purple-600"
                />
              </div>

              {/* Daily Non-Staple Cap */}
              <div>
                <label className="block font-bold text-stone-800 mb-0.5">
                  {t('purchases.policyModal.dailyCap')}
                </label>
                <p className="text-[11px] text-stone-500 mb-1">
                  {t('purchases.policyModal.dailyCapDesc')}
                </p>
                <input
                  type="number"
                  min="0"
                  step="500"
                  value={dailyCap}
                  onChange={(e) => setDailyCap(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 p-2 text-xs text-stone-900 focus:outline-none focus:border-purple-600"
                />
              </div>

              {/* Intervals */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-stone-100">
                <div>
                  <label className="block font-bold text-stone-800 mb-1">
                    {t('purchases.policyModal.highControlInterval')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={highControlDays}
                    onChange={(e) => setHighControlDays(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 p-2 text-xs text-stone-900 focus:outline-none focus:border-purple-600"
                  />
                </div>

                <div>
                  <label className="block font-bold text-stone-800 mb-1">
                    {t('purchases.policyModal.frequentInterval')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={frequentDays}
                    onChange={(e) => setFrequentDays(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 p-2 text-xs text-stone-900 focus:outline-none focus:border-purple-600"
                  />
                </div>
              </div>
            </>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-stone-200">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              {t('purchases.policyModal.close')}
            </Button>
            <Button type="submit" variant="primary" disabled={saving || loading} className="gap-1.5 bg-purple-700 hover:bg-purple-800 text-white">
              {saving ? t('purchases.policyModal.saving') : t('purchases.policyModal.saveSettings')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
