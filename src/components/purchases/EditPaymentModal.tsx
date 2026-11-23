'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';
import { CreditCard, Calendar, AlertCircle, RefreshCw, X, FileText, Hash } from 'lucide-react';
import { formatINR } from '@/lib/utils';

export interface EditablePaymentRecord {
  id: string;
  payment_number: string;
  payment_date: string;
  amount: number;
  payment_method_id?: string;
  reference_number?: string;
  notes?: string;
}

interface EditPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentUpdated: (paymentNumber: string) => void;
  payment: EditablePaymentRecord | null;
  paymentMethods: { id: string; name: string; name_hi?: string; is_active?: boolean }[];
  vendorName?: string;
}

export function EditPaymentModal({
  isOpen,
  onClose,
  onPaymentUpdated,
  payment,
  paymentMethods,
  vendorName,
}: EditPaymentModalProps) {
  const { t, locale } = useI18n();
  const [paymentDate, setPaymentDate] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (payment && isOpen) {
      // Normalize date (YYYY-MM-DD)
      const rawDate = payment.payment_date ? payment.payment_date.split('T')[0] : '';
      setPaymentDate(rawDate);
      setAmount(String(payment.amount || ''));
      setPaymentMethodId(payment.payment_method_id || '');
      setReferenceNumber(payment.reference_number || '');
      setNotes(payment.notes || '');
      setError(null);
    }
  }, [payment, isOpen]);

  if (!isOpen || !payment) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError(locale === 'hi' ? 'कृपया एक वैध राशि दर्ज करें।' : 'Please enter a valid payment amount greater than zero.');
      return;
    }

    if (!paymentDate) {
      setError(locale === 'hi' ? 'कृपया भुगतान तिथि चुनें।' : 'Please select a valid payment date.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/finance/payments/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_id: payment.id,
          payment_date: paymentDate,
          amount: numAmount,
          payment_method_id: paymentMethodId || null,
          reference_number: referenceNumber,
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update payment');
      }

      onPaymentUpdated(payment.payment_number);
      onClose();
    } catch (err: any) {
      console.error('Error updating payment:', err);
      setError(err.message || 'An error occurred while updating payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-2xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-stone-200 overflow-hidden animate-fadeIn">
        {/* Modal Header */}
        <div className="bg-stone-50 px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-800">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                {t('purchases.payments.editPaymentTitle')}
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-amber-100/80 text-amber-900 border border-amber-200">
                  {payment.payment_number}
                </span>
              </h2>
              {vendorName && (
                <p className="text-[11px] text-stone-500 font-medium mt-0.5">
                  {vendorName}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 p-1 rounded-lg hover:bg-stone-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Payment Date */}
            <div>
              <label className="block text-stone-700 font-semibold mb-1 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-stone-500" />
                {t('purchases.bills.table.date')} <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full text-xs rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Payment Amount */}
            <div>
              <label className="block text-stone-700 font-semibold mb-1">
                {t('purchases.bills.amount')} (₹) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full text-xs rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900 font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Payment Method */}
            <div>
              <label className="block text-stone-700 font-semibold mb-1 flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-stone-500" />
                {t('purchases.bills.paymentMethod')}
              </label>
              <select
                value={paymentMethodId}
                onChange={(e) => setPaymentMethodId(e.target.value)}
                className="w-full text-xs rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">{t('purchases.bills.selectMethod')}</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {getLocalizedMasterName(pm, locale) || pm.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Reference Number */}
            <div>
              <label className="block text-stone-700 font-semibold mb-1 flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-stone-500" />
                {t('purchases.bills.referenceNo')}
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="UPI Ref / Cheque No / IMPS..."
                className="w-full text-xs rounded-xl border border-stone-300 bg-white px-3 py-2 text-stone-900 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Internal Notes */}
          <div>
            <label className="block text-stone-700 font-semibold mb-1 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-stone-500" />
              {t('purchases.vendors.modal.notes')}
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal remarks, bank details, or voucher remarks..."
              className="w-full text-xs rounded-xl border border-stone-300 bg-white p-3 text-stone-900 font-normal focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            />
          </div>

          {/* Notice */}
          <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
            {locale === 'hi'
              ? 'राशि बदलने पर इस वेंडर के सभी गैर-रद्द इनवॉइस पर FIFO अनुसार भुगतान स्वतः पुनः आवंटित हो जाएगा।'
              : 'Modifying the amount automatically re-allocates payments across this vendor\'s active non-cancelled invoices FIFO in chronological order.'}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stone-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              {t('purchases.bills.cancel')}
            </Button>
            <Button
              type="submit"
              variant="amber"
              size="sm"
              disabled={saving}
              className="font-bold gap-1.5"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {t('purchases.bills.updating')}
                </>
              ) : (
                t('purchases.payments.savePayment')
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
