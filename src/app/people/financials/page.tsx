'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { Wallet, Plus, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

export default function StaffFinancialsPage() {
  const supabase = createClient();
  const [businessDate, setBusinessDate] = useState(getTodayBusinessDate());
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form State
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [txType, setTxType] = useState('Advance');
  const [amount, setAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('employee_financial_balance')
        .select('*')
        .order('employee_name');

      setBalances(data || []);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to load staff financial balances.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRecordTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmpId || amount <= 0) {
      alert('Please select employee and valid amount.');
      return;
    }
    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase.from('employee_financial_transactions').insert({
        employee_id: selectedEmpId,
        business_date: businessDate,
        transaction_type: txType,
        amount,
        notes,
      });

      if (error) throw error;

      setMessage({ type: 'success', text: `${txType} of ${formatINR(amount)} logged successfully.` });
      setShowModal(false);
      setAmount(0);
      setNotes('');
      loadData();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Failed to record transaction.' });
    } finally {
      setSaving(false);
    }
  };

  const totalAdvancesOutstanding = balances.reduce(
    (sum, b) => sum + (Number(b.outstanding_advance_balance) || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Wallet className="h-6 w-6 text-amber-600" />
            Staff Financial Ledger
          </h1>
          <p className="text-sm text-stone-500">
            Track employee advances, loans, recoveries, and penalties with authoritative derived ledger balances.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="amber" size="sm" onClick={() => setShowModal(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Log Advance / Deduction
          </Button>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardDescription>Total Company Advances Outstanding</CardDescription>
          <div className="text-2xl font-bold text-amber-600 mt-1">
            {formatINR(totalAdvancesOutstanding)}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Recoverable through payroll deductions</div>
        </Card>

        <Card>
          <CardDescription>Employees with Advances</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">
            {balances.filter((b) => Number(b.outstanding_advance_balance) > 0).length}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Active open ledger accounts</div>
        </Card>

        <Card>
          <CardDescription>Accounting Principle</CardDescription>
          <div className="text-base font-semibold text-stone-800 mt-1">Transaction Ledger Derivation</div>
          <div className="text-[11px] text-stone-500 mt-1">Never a single editable balance field</div>
        </Card>
      </div>

      {/* Balances Table */}
      <Card>
        <CardHeader>
          <CardTitle>Staff Outstanding Balances</CardTitle>
          <CardDescription>Advances + Loans + Penalties − Repayments − Deductions = Balance</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                  <th className="py-2.5 px-3">Staff Member</th>
                  <th className="py-2.5 px-3">Dept / Role</th>
                  <th className="py-2.5 px-3 text-right">Monthly Salary</th>
                  <th className="py-2.5 px-3 text-right">Outstanding Advance Balance</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {balances.map((b) => {
                  const bal = Number(b.outstanding_advance_balance) || 0;
                  return (
                    <tr key={b.employee_id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="py-3 px-3 font-semibold text-stone-900">
                        {b.employee_name}
                        {b.employment_status !== 'Active' && (
                          <span className="ml-2 inline-block text-[9px] font-semibold text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200">
                            {b.employment_status}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-stone-600">
                        {b.department_name || 'General'} • {b.role_name || 'Staff'}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-stone-900">
                        {formatINR(Number(b.monthly_salary))}
                      </td>
                      <td className={`py-3 px-3 text-right font-bold text-sm ${bal > 0 ? 'text-amber-700' : 'text-stone-400'}`}>
                        {formatINR(bal)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {bal > 0 ? (
                          <Badge variant="warning">Due</Badge>
                        ) : (
                          <Badge variant="success">Nil Balance</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-base font-bold text-stone-900">Record Staff Financial Transaction</h2>
              <button onClick={() => setShowModal(false)} className="text-stone-400 hover:text-stone-700 text-lg">✕</button>
            </div>

            <form onSubmit={handleRecordTransaction} className="space-y-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Active Employee</label>
                <select
                  value={selectedEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Staff...</option>
                  {balances
                    .filter((b) => b.employment_status === 'Active')
                    .map((b) => (
                      <option key={b.employee_id} value={b.employee_id}>
                        {b.employee_name} ({formatINR(Number(b.outstanding_advance_balance))})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Transaction Type</label>
                <select
                  value={txType}
                  onChange={(e) => setTxType(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="Advance">Salary Advance (Company lends)</option>
                  <option value="Loan">Emergency Loan</option>
                  <option value="Penalty">Misconduct / Discipline Penalty</option>
                  <option value="Uniform Recovery">Uniform Cost Recovery</option>
                  <option value="Damage Recovery">Property Damage Recovery</option>
                  <option value="Repayment">Cash Repayment by Staff</option>
                  <option value="Salary Deduction">Salary Deduction at Month End</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  step="50"
                  value={amount || ''}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 font-bold text-sm text-stone-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Notes / Reason</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Medical emergency advance, Festival advance"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button type="submit" variant="amber" disabled={saving}>
                  {saving ? 'Recording...' : 'Record Transaction'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
