'use client';

import React, { useEffect, useState } from 'react';
import { X, Save, RotateCcw, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/lib/i18n/context';

export interface EditableBillData {
  id: string;
  business_date: string;
  invoice_no: string;
  covers_pax: number;
  status: string;
  order_type: string | null;
  area: string | null;
  payment_type: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  net_sales: number;
  manual_edit?: {
    override_covers_pax?: number | null;
    override_order_type?: string | null;
    override_area?: string | null;
    override_payment_type?: string | null;
    override_customer_name?: string | null;
    override_customer_phone?: string | null;
    override_status?: string | null;
    override_notes?: string | null;
    reason?: string;
    edited_at?: string;
    original_snapshot_json?: Record<string, any>;
  } | null;
}

interface EditBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  bill: EditableBillData | null;
  onSaved: () => void;
}

export function EditBillModal({ isOpen, onClose, bill, onSaved }: EditBillModalProps) {
  const { t } = useI18n();

  const [coversPax, setCoversPax] = useState<string>('1');
  const [status, setStatus] = useState<string>('Success');
  const [orderType, setOrderType] = useState<string>('Dine In');
  const [area, setArea] = useState<string>('');
  const [paymentType, setPaymentType] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !bill) return;
    setCoversPax(String(bill.covers_pax ?? 0));
    setStatus(bill.status || 'Success');
    setOrderType(bill.order_type || 'Dine In');
    setArea(bill.area || '');
    setPaymentType(bill.payment_type || '');
    setCustomerName(bill.customer_name || '');
    setCustomerPhone(bill.customer_phone || '');
    setReason(bill.manual_edit?.reason || '');
    setNotes(bill.manual_edit?.override_notes || '');
    setError(null);
  }, [isOpen, bill]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !reverting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, saving, reverting, onClose]);

  if (!isOpen || !bill) return null;

  const paxNum = Number(coversPax);
  const netNum = Number(bill.net_sales || 0);
  const liveApc = Number.isFinite(paxNum) && paxNum > 0 ? netNum / paxNum : 0;
  const rawPos = bill.manual_edit?.original_snapshot_json;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isInteger(paxNum) || paxNum < 0 || paxNum > 2000) {
      setError(t('finance.sales.editBill.invalidPax'));
      return;
    }
    if (reason.trim().length < 3) {
      setError(t('finance.sales.editBill.reasonRequired'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/sales/bills/${bill.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          covers_pax: paxNum,
          status,
          order_type: orderType || null,
          area: area || null,
          payment_type: paymentType || null,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          notes: notes || null,
          reason: reason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || t('finance.sales.editBill.saveFailed'));
        return;
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || t('finance.sales.editBill.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = async () => {
    if (!bill.manual_edit) return;
    setReverting(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/sales/bills/${bill.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || t('finance.sales.editBill.revertFailed'));
        return;
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || t('finance.sales.editBill.revertFailed'));
    } finally {
      setReverting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4 overflow-y-auto"
      onClick={() => !saving && !reverting && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-stone-700 bg-stone-900 text-stone-100 shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-800 px-5 py-4 bg-stone-950/60">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              {t('finance.sales.editBill.title', { invoice: bill.invoice_no })}
            </h3>
            <p className="text-xs text-stone-400 mt-0.5">
              {bill.business_date} · ₹{netNum.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              {liveApc > 0 ? ` · ${t('finance.sales.spendPerPax')}: ₹${liveApc.toFixed(0)}/PAX` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving || reverting}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          {bill.manual_edit && rawPos && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200 flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-amber-400" />
                  {t('finance.sales.editBill.activeOverrideBadge')}
                </div>
                <div className="text-[11px] text-amber-200/80 mt-1">
                  {t('finance.sales.editBill.rawPosSummary', {
                    pax: String(rawPos.covers_pax ?? 0),
                    status: String(rawPos.status || 'Success'),
                    orderType: String(rawPos.order_type || '—'),
                  })}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRevert}
                disabled={reverting || saving}
                className="shrink-0 border-amber-500/50 text-amber-300 hover:bg-amber-900/40 text-xs"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                {reverting ? t('common.loading') : t('finance.sales.editBill.revertButton')}
              </Button>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-300 mb-1">
                {t('finance.sales.editBill.coversPaxLabel')}
              </label>
              <input
                type="number"
                min={0}
                max={2000}
                value={coversPax}
                onChange={(e) => setCoversPax(e.target.value)}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-300 mb-1">
                {t('finance.sales.editBill.statusLabel')}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              >
                <option value="Success">Success</option>
                <option value="Complimentary">Complimentary</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-300 mb-1">
                {t('finance.sales.editBill.orderTypeLabel')}
              </label>
              <select
                value={orderType}
                onChange={(e) => setOrderType(e.target.value)}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              >
                <option value="Dine In">Dine In</option>
                <option value="Pick Up">Pick Up</option>
                <option value="Delivery(Parcel)">Delivery(Parcel)</option>
                <option value="LANCHO">LANCHO</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-300 mb-1">
                {t('finance.sales.editBill.areaLabel')}
              </label>
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="Restaurant / Parcel / LANCHO"
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-300 mb-1">
                {t('finance.sales.editBill.paymentTypeLabel')}
              </label>
              <input
                type="text"
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value)}
                placeholder="UPI / Cash / CARD / LANCHO"
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-300 mb-1">
                {t('finance.sales.editBill.customerPhoneLabel')}
              </label>
              <input
                type="text"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-300 mb-1">
              {t('finance.sales.editBill.customerNameLabel')}
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-300 mb-1">
              {t('finance.sales.editBill.reasonLabel')} *
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('finance.sales.editBill.reasonPlaceholder')}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-800">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving || reverting}
              className="border-stone-700 text-stone-300 hover:bg-stone-800"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={saving || reverting}
              className="bg-amber-600 hover:bg-amber-500 text-white font-semibold"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {saving ? t('common.actions.saving') : t('finance.sales.editBill.saveAndRegrade')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
