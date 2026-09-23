'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { EmployeeSalarySummaryRow, SalaryPaymentMethod, SalaryPaymentType } from '@/lib/types/database';
import { Banknote, X, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

interface SalaryPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: EmployeeSalarySummaryRow | null;
  onSuccess?: () => void;
}

export function SalaryPaymentModal({
  isOpen,
  onClose,
  record,
  onSuccess,
}: SalaryPaymentModalProps) {
  const { t } = useI18n();
  const [paymentDate, setPaymentDate] = useState(getTodayBusinessDate());
  const [amount, setAmount] = useState<number | string>('');
  const [paymentMethod, setPaymentMethod] = useState<SalaryPaymentMethod>('Bank Transfer');
  const [paymentType, setPaymentType] = useState<SalaryPaymentType>('Salary Payment');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && record) {
      setPaymentDate(getTodayBusinessDate());
      const pending = Number(record.pending_salary_balance) || 0;
      setAmount(pending > 0 ? pending : '');
      setPaymentMethod('Bank Transfer');
      setPaymentType('Salary Payment');
      setReferenceNumber('');
      setNotes('');
      setError(null);
    }
  }, [isOpen, record]);

  if (!isOpen || !record) return null;

  const numAmount = Number(amount) || 0;
  const pendingBal = Number(record.pending_salary_balance) || 0;
  const isOverpayment = numAmount > pendingBal && pendingBal > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (numAmount <= 0) {
      setError(t('people.paymentModal.errorAmount'));
      return;
    }
    if (!paymentDate) {
      setError(t('people.paymentModal.errorDate'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/people/salary/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: record.employee_id,
          salary_period_id: record.period_id,
          salary_month: record.salary_month,
          payment_date: paymentDate,
          amount: numAmount,
          payment_method: paymentMethod,
          reference_number: referenceNumber,
          payment_type: paymentType,
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to disburse salary payment.');
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Payment error:', err);
      setError(err.message || 'Failed to record payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4 bg-stone-50/50">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-stone-900">{t('people.paymentModal.title')}</h2>
              <p className="text-xs text-stone-500">
                {t('people.paymentModal.subtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content & Live Position */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Employee & Period Position Card */}
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-stone-900 text-base">{record.employee_name}</h3>
                <p className="text-xs text-stone-500">
                  {record.department_name || 'General'} • {record.role_name || 'Staff'} {record.employee_code && `(${record.employee_code})`}
                </p>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-stone-200 text-stone-800">
                  {record.salary_month}
                </span>
                <p className="text-xs text-stone-500 mt-0.5">
                  Salary: {formatINR(record.monthly_salary)}/mo
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-stone-200 text-xs">
              <div>
                <span className="text-stone-500 block">{t('people.paymentModal.earnedMonth')}</span>
                <span className="font-medium text-stone-800">{formatINR(record.net_earned_salary)}</span>
              </div>
              <div>
                <span className="text-stone-500 block">{t('people.paymentModal.prevPending')}</span>
                <span className="font-medium text-stone-800">{formatINR(record.previous_pending_salary)}</span>
              </div>
              <div>
                <span className="text-stone-500 block">{t('people.paymentModal.totalDue')}</span>
                <span className="font-bold text-stone-900">{formatINR(record.total_salary_due)}</span>
              </div>
              <div>
                <span className="text-stone-500 block">{t('people.paymentModal.alreadyGiven')}</span>
                <span className="font-medium text-emerald-700">{formatINR(record.total_salary_given)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-stone-200 bg-amber-50/60 -mx-4 -mb-4 px-4 py-2.5 rounded-b-xl">
              <span className="text-xs font-semibold text-amber-900">{t('people.paymentModal.outstandingBalance')}</span>
              <span className="text-base font-bold text-amber-700">
                {formatINR(record.pending_salary_balance)}
              </span>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  {t('people.paymentModal.date')}
                </label>
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  {t('people.paymentModal.amount')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-900 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            </div>

            {isOverpayment && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  {t('people.paymentModal.overpaymentWarning')}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  {t('people.paymentModal.paymentType')}
                </label>
                <select
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value as SalaryPaymentType)}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="Salary Payment">{t('people.paymentModal.types.Salary Payment')}</option>
                  <option value="Advance Salary">{t('people.paymentModal.types.Advance Salary')}</option>
                  <option value="Settlement">{t('people.paymentModal.types.Settlement')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  {t('people.paymentModal.paymentMethod')}
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as SalaryPaymentMethod)}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="Bank Transfer">{t('people.paymentModal.methods.Bank Transfer')}</option>
                  <option value="UPI">{t('people.paymentModal.methods.UPI')}</option>
                  <option value="Cash">{t('people.paymentModal.methods.Cash')}</option>
                  <option value="Cheque">{t('people.paymentModal.methods.Cheque')}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                {t('people.paymentModal.referenceNumber')}
              </label>
              <input
                type="text"
                placeholder="e.g. UTR-98213892 or Chq #00129"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                {t('people.paymentModal.notes')}
              </label>
              <textarea
                rows={2}
                placeholder="Optional notes or remarks regarding this payout..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-stone-100">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t('people.paymentModal.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={saving || numAmount <= 0}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
            >
              {saving
                ? t('people.paymentModal.disbursing')
                : (numAmount > 0
                    ? t('people.paymentModal.disburse', { amount: formatINR(numAmount) })
                    : t('people.paymentModal.disburseNoAmount'))}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
