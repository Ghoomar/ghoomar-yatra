'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { logAuditAction } from '@/lib/audit-logger';
import { Banknote, X, AlertCircle } from 'lucide-react';

interface SalaryPayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: any;
  outstandingAdvance?: number;
  onSuccess?: () => void;
}

export function SalaryPayoutModal({
  isOpen,
  onClose,
  employee,
  outstandingAdvance = 0,
  onSuccess,
}: SalaryPayoutModalProps) {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  
  // Current month default: e.g. "2026-09"
  const currentMonthStr = () => {
    const today = getTodayBusinessDate();
    return today.substring(0, 7);
  };

  const [salaryMonth, setSalaryMonth] = useState(currentMonthStr());
  const [baseSalary, setBaseSalary] = useState<number>(0);
  const [advanceDeduction, setAdvanceDeduction] = useState<number>(0);
  const [otherDeductions, setOtherDeductions] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [approvedById, setApprovedById] = useState('');
  const [notes, setNotes] = useState('');

  const [profiles, setProfiles] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && employee) {
      const sal = Number(employee.monthly_salary || 0);
      setBaseSalary(sal);
      const adv = Math.min(Number(outstandingAdvance || 0), sal);
      setAdvanceDeduction(adv > 0 ? adv : 0);
      setOtherDeductions(0);
      setNotes('');
      setReferenceNumber('');
      setError(null);

      // Load admin profiles for approval dropdown
      supabase.from('profiles').select('id, full_name, role:roles(name)').then(({ data }) => {
        setProfiles(data || []);
      });
    }
  }, [isOpen, employee, outstandingAdvance]);

  if (!isOpen || !employee) return null;

  const netAmount = Math.max(0, baseSalary - advanceDeduction - otherDeductions);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (baseSalary <= 0) {
      setError('Base salary must be greater than 0.');
      return;
    }
    if (advanceDeduction > outstandingAdvance) {
      setError(`Advance deduction (₹${advanceDeduction}) cannot exceed outstanding advance (₹${outstandingAdvance}).`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // 1. Insert formal salary payout record
      const { data: payout, error: pErr } = await supabase
        .from('employee_salary_payouts')
        .insert({
          employee_id: employee.id,
          business_date: businessDate,
          salary_month: salaryMonth,
          base_salary: baseSalary,
          advance_deduction: advanceDeduction,
          other_deductions: otherDeductions,
          net_amount: netAmount,
          payment_method: paymentMethod,
          reference_number: referenceNumber || null,
          approved_by_id: approvedById || null,
          notes: notes || `Salary payout for ${salaryMonth}`,
        })
        .select()
        .single();

      if (pErr) throw pErr;

      // 2. If advance deduction occurred, record recovery in employee_financial_transactions
      if (advanceDeduction > 0) {
        await supabase.from('employee_financial_transactions').insert({
          employee_id: employee.id,
          business_date: businessDate,
          transaction_type: 'Salary Deduction',
          amount: advanceDeduction,
          notes: `Payroll recovery for month ${salaryMonth} (Payout ID: ${payout.id})`,
        });
      }

      // 3. Record Salary Payout in financial ledger
      await supabase.from('employee_financial_transactions').insert({
        employee_id: employee.id,
        business_date: businessDate,
        transaction_type: 'Salary Payout',
        amount: netAmount,
        notes: `Net salary disbursed for ${salaryMonth} via ${paymentMethod}${referenceNumber ? ` (Ref: ${referenceNumber})` : ''}`,
      });

      // 4. Central Audit Log
      await logAuditAction({
        action: 'CREATE',
        entity: 'Salary Payout',
        entityId: payout.id,
        details: {
          employee_id: employee.id,
          employee_name: employee.name,
          salary_month: salaryMonth,
          base_salary: baseSalary,
          advance_deduction: advanceDeduction,
          net_amount: netAmount,
          payment_method: paymentMethod,
        },
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to record salary payout.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 text-xs space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-100 text-emerald-800 rounded-lg">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">Record Salary Payout</h2>
              <p className="text-[11px] text-stone-500">
                Staff: <span className="font-semibold text-stone-800">{employee.name}</span> ({employee.employee_code || 'EMP'})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-stone-700 mb-1">Disbursement Date</label>
              <input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                required
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-stone-700 mb-1">Salary Month Period</label>
              <input
                type="month"
                value={salaryMonth}
                onChange={(e) => setSalaryMonth(e.target.value)}
                required
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-stone-700 mb-1">Gross Salary (₹)</label>
              <input
                type="number"
                value={baseSalary || ''}
                onChange={(e) => setBaseSalary(parseFloat(e.target.value) || 0)}
                required
                className="w-full rounded-md border border-stone-300 p-2 font-bold text-stone-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-stone-700 mb-1">
                Advance Deduction
                {outstandingAdvance > 0 && (
                  <span className="text-[10px] text-amber-600 block">Due: ₹{outstandingAdvance}</span>
                )}
              </label>
              <input
                type="number"
                value={advanceDeduction || ''}
                onChange={(e) => setAdvanceDeduction(parseFloat(e.target.value) || 0)}
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-stone-700 mb-1">Other Deductions</label>
              <input
                type="number"
                value={otherDeductions || ''}
                onChange={(e) => setOtherDeductions(parseFloat(e.target.value) || 0)}
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 flex items-center justify-between">
            <span className="font-bold text-emerald-900">Net Disbursed Amount:</span>
            <span className="text-xl font-extrabold text-emerald-800">{formatINR(netAmount)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-stone-700 mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
              >
                <option value="Bank Transfer">Bank Transfer (NEFT/IMPS)</option>
                <option value="UPI">UPI</option>
                <option value="Cash">Cash</option>
                <option value="Cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-stone-700 mb-1">Ref / UTR / Cheque #</label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="e.g. UTR128394029"
                className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-stone-700 mb-1">Approved By (Profile)</label>
            <select
              value={approvedById}
              onChange={(e) => setApprovedById(e.target.value)}
              className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
            >
              <option value="">Select Approver...</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || 'Admin'} {p.role?.name ? `(${p.role.name})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-stone-700 mb-1">Notes / Remarks</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Monthly salary disbursed after 1 advance installment deduction"
              className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving} className="bg-emerald-700 hover:bg-emerald-800 text-white">
              {saving ? 'Processing...' : 'Confirm Salary Payout'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
