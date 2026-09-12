'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { logAuditAction } from '@/lib/audit-logger';
import { SalaryPayoutModal } from './SalaryPayoutModal';
import {
  X,
  Wallet,
  Shirt,
  Banknote,
  Plus,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Calendar,
  Phone,
  Building,
  UserCheck,
} from 'lucide-react';

interface StaffLedgerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string | null;
  onUpdated?: () => void;
}

export function StaffLedgerDrawer({
  isOpen,
  onClose,
  employeeId,
  onUpdated,
}: StaffLedgerDrawerProps) {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<'financial' | 'uniform'>('financial');
  const [employee, setEmployee] = useState<any | null>(null);
  const [financialBalance, setFinancialBalance] = useState<any | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [uniformItems, setUniformItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals & Action Forms
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txType, setTxType] = useState('Advance');
  const [txAmount, setTxAmount] = useState<number>(0);
  const [txNotes, setTxNotes] = useState('');
  const [txSaving, setTxSaving] = useState(false);

  const loadData = async () => {
    if (!employeeId) return;
    setLoading(true);
    setMessage(null);

    try {
      // 1. Employee profile details
      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .select(`
          *,
          department:departments(name),
          team:teams(name),
          role:employee_roles(name)
        `)
        .eq('id', employeeId)
        .single();

      if (empErr) throw empErr;

      // 2. Derived balance
      const { data: bal } = await supabase
        .from('employee_financial_balance')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle();

      // 3. Transactions
      const { data: txs } = await supabase
        .from('employee_financial_transactions')
        .select('*')
        .eq('employee_id', employeeId)
        .order('business_date', { ascending: false })
        .order('created_at', { ascending: false });

      // 4. Salary Payouts
      const { data: salPayouts } = await supabase
        .from('employee_salary_payouts')
        .select('*, approver:profiles!employee_salary_payouts_approved_by_id_fkey(full_name)')
        .eq('employee_id', employeeId)
        .order('business_date', { ascending: false })
        .order('created_at', { ascending: false });

      // 5. Uniform issues & custody
      const { data: uIssues } = await supabase
        .from('employee_uniform_issues')
        .select(`
          id, business_date, notes, created_at,
          items:employee_uniform_issue_items(
            id, quantity, status, item_id, uniform_item_id, returned_at, notes,
            item:inventory_items!employee_uniform_issue_items_item_id_fkey(name, item_code, current_stock, current_weighted_average_cost),
            legacy_uniform:uniform_items(name, size)
          )
        `)
        .eq('employee_id', employeeId)
        .order('business_date', { ascending: false });

      // Flatten uniform items with parent issue date
      const flatUniforms: any[] = [];
      (uIssues || []).forEach((iss: any) => {
        (iss.items || []).forEach((it: any) => {
          flatUniforms.push({
            ...it,
            issue_date: iss.business_date,
            issue_notes: iss.notes,
          });
        });
      });

      setEmployee(emp);
      setFinancialBalance(bal);
      setTransactions(txs || []);
      setPayouts(salPayouts || []);
      setUniformItems(flatUniforms);
    } catch (err: any) {
      console.error('Error loading employee ledger:', err);
      setMessage({ type: 'error', text: err.message || 'Error loading staff ledger.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && employeeId) {
      loadData();
    }
  }, [isOpen, employeeId]);

  const handleRecordTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || txAmount <= 0) return;
    setTxSaving(true);
    try {
      const today = getTodayBusinessDate();
      const { error } = await supabase.from('employee_financial_transactions').insert({
        employee_id: employeeId,
        business_date: today,
        transaction_type: txType,
        amount: txAmount,
        notes: txNotes,
      });

      if (error) throw error;

      await logAuditAction({
        action: 'CREATE',
        entity: 'Staff Financial Transaction',
        entityId: employeeId,
        details: { type: txType, amount: txAmount, notes: txNotes },
      });

      setMessage({ type: 'success', text: `${txType} of ${formatINR(txAmount)} recorded.` });
      setShowTxModal(false);
      setTxAmount(0);
      setTxNotes('');
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error logging transaction.' });
    } finally {
      setTxSaving(false);
    }
  };

  const handleReturnUniformItem = async (issueItemId: string, itemId: string, qty: number) => {
    if (!confirm(`Mark ${qty} piece(s) as returned to central inventory?`)) return;
    setLoading(true);
    try {
      const today = getTodayBusinessDate();

      // 1. Update issue item
      const { error: updErr } = await supabase
        .from('employee_uniform_issue_items')
        .update({
          status: 'Returned',
          returned_at: new Date().toISOString(),
        })
        .eq('id', issueItemId);
      if (updErr) throw updErr;

      // 2. Fetch destination location (Central Store)
      const { data: defLoc } = await supabase
        .from('inventory_locations')
        .select('id')
        .ilike('name', '%Store%')
        .limit(1)
        .maybeSingle();

      const { data: itemData } = await supabase
        .from('inventory_items')
        .select('current_weighted_average_cost')
        .eq('id', itemId)
        .maybeSingle();

      const unitCost = Number(itemData?.current_weighted_average_cost || 0);

      // 3. Authoritative atomic inventory transaction
      const { error: txErr } = await supabase.rpc('execute_inventory_transaction', {
        p_item_id: itemId,
        p_movement_type: 'return',
        p_quantity: qty,
        p_source_location_id: null,
        p_destination_location_id: defLoc?.id || null,
        p_unit_cost: unitCost,
        p_purpose: 'Uniform Return by Staff',
        p_notes: `Returned by staff member ${employee?.name || ''} (${employee?.employee_code || ''})`.trim(),
        p_business_date: today,
      });
      if (txErr) throw txErr;

      await logAuditAction({
        action: 'UPDATE',
        entity: 'Uniform Return',
        entityId: issueItemId,
        details: { employee_id: employeeId, item_id: itemId, quantity: qty },
      });

      setMessage({ type: 'success', text: 'Uniform return logged successfully.' });
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to record return.' });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const totalIssuedUniforms = uniformItems
    .filter((u) => u.status === 'Issued')
    .reduce((sum, u) => sum + Number(u.quantity || 0), 0);

  const outstandingAdv = Number(financialBalance?.outstanding_advance_balance || 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-opacity">
      <div className="w-full max-w-2xl bg-white h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-stone-900">{employee?.name || 'Staff Member'}</h2>
                {employee?.employee_code && (
                  <span className="font-mono text-xs font-bold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded">
                    {employee.employee_code}
                  </span>
                )}
                <Badge variant={employee?.employment_status === 'Active' ? 'success' : 'default'} className="text-[10px]">
                  {employee?.employment_status || 'Active'}
                </Badge>
              </div>
              <div className="text-[11px] text-stone-500 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                <span>{employee?.department?.name || 'General Staff'}</span>
                {employee?.team?.name && <span>• {employee.team.name}</span>}
                {employee?.role?.name && <span>• {employee.role.name}</span>}
                {employee?.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {employee.phone}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadData} title="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200/60"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-stone-200 bg-white px-4">
          <button
            type="button"
            onClick={() => setActiveTab('financial')}
            className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'financial'
                ? 'border-amber-600 text-amber-700'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            <Wallet className="h-4 w-4" />
            Financial Ledger &amp; Payroll
            {outstandingAdv > 0 && (
              <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                ₹{outstandingAdv} due
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('uniform')}
            className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'uniform'
                ? 'border-amber-600 text-amber-700'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            <Shirt className="h-4 w-4" />
            Uniform Custody &amp; Exit Clearance
            {totalIssuedUniforms > 0 && (
              <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {totalIssuedUniforms} pcs
              </span>
            )}
          </button>
        </div>

        {/* Alert message */}
        {message && (
          <div
            className={`mx-4 mt-3 p-2.5 rounded-lg text-xs font-medium flex items-center gap-2 ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {message.type === 'success' ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-rose-600" />}
            <span>{message.text}</span>
          </div>
        )}

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* TAB 1: FINANCIAL LEDGER */}
          {activeTab === 'financial' && (
            <div className="space-y-4">
              {/* Financial KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="text-stone-500 text-[11px] block">Monthly Base Salary</span>
                  <span className="text-sm font-bold text-stone-900 mt-1 block">
                    {formatINR(Number(employee?.monthly_salary || 0))}
                  </span>
                </div>
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="text-stone-500 text-[11px] block">Total Advances Taken</span>
                  <span className="text-sm font-bold text-amber-700 mt-1 block">
                    {formatINR(Number(financialBalance?.total_advances_taken || 0))}
                  </span>
                </div>
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="text-stone-500 text-[11px] block">Recovered / Deducted</span>
                  <span className="text-sm font-bold text-emerald-700 mt-1 block">
                    {formatINR(Number(financialBalance?.total_repayments || 0) + Number(financialBalance?.total_salary_deductions || 0))}
                  </span>
                </div>
                <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200">
                  <span className="text-amber-800 text-[11px] font-semibold block">Outstanding Advance</span>
                  <span className="text-base font-extrabold text-amber-900 mt-1 block">
                    {formatINR(outstandingAdv)}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setShowPayoutModal(true)}
                  className="gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs"
                >
                  <Banknote className="h-3.5 w-3.5" /> Record Salary Payout
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowTxModal(true)}
                  className="gap-1.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" /> Log Advance / Penalty / Deduction
                </Button>
              </div>

              {/* Salary Payout History */}
              <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
                <div className="bg-stone-50 p-3 border-b border-stone-200 flex items-center justify-between">
                  <h3 className="font-bold text-stone-900 text-xs">Salary Disbursement History</h3>
                  <span className="text-[11px] text-stone-500">{payouts.length} Payouts</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Month</th>
                        <th className="py-2 px-3 text-right">Gross</th>
                        <th className="py-2 px-3 text-right">Adv Deducted</th>
                        <th className="py-2 px-3 text-right">Net Paid</th>
                        <th className="py-2 px-3">Method / Ref</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {payouts.map((p) => (
                        <tr key={p.id} className="hover:bg-stone-50/80">
                          <td className="py-2 px-3 font-mono text-stone-600 whitespace-nowrap">{p.business_date}</td>
                          <td className="py-2 px-3 font-bold text-stone-800">{p.salary_month}</td>
                          <td className="py-2 px-3 text-right font-medium text-stone-700">{formatINR(p.base_salary)}</td>
                          <td className="py-2 px-3 text-right font-bold text-amber-700">
                            {p.advance_deduction > 0 ? `− ${formatINR(p.advance_deduction)}` : '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-extrabold text-emerald-800 text-sm">
                            {formatINR(p.net_amount)}
                          </td>
                          <td className="py-2 px-3 text-stone-600">
                            <div>{p.payment_method}</div>
                            {p.reference_number && (
                              <span className="font-mono text-[10px] text-stone-400 block">{p.reference_number}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {payouts.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-stone-400 text-xs">
                            No formal salary payouts recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Transactions Ledger */}
              <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
                <div className="bg-stone-50 p-3 border-b border-stone-200 flex items-center justify-between">
                  <h3 className="font-bold text-stone-900 text-xs">Complete Financial Transaction Ledger</h3>
                  <span className="text-[11px] text-stone-500">{transactions.length} Entries</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3 text-right">Amount</th>
                        <th className="py-2 px-3">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {transactions.map((tx) => {
                        const isDeduction =
                          tx.transaction_type === 'Salary Deduction' ||
                          tx.transaction_type === 'Repayment' ||
                          tx.transaction_type === 'Uniform Recovery' ||
                          tx.transaction_type === 'Damage Recovery';

                        return (
                          <tr key={tx.id} className="hover:bg-stone-50/80">
                            <td className="py-2 px-3 font-mono text-stone-600 whitespace-nowrap">{tx.business_date}</td>
                            <td className="py-2 px-3">
                              <Badge
                                variant={
                                  tx.transaction_type === 'Advance'
                                    ? 'warning'
                                    : tx.transaction_type === 'Salary Payout'
                                    ? 'success'
                                    : tx.transaction_type === 'Salary Deduction'
                                    ? 'info'
                                    : 'outline'
                                }
                                className="text-[10px] py-0"
                              >
                                {tx.transaction_type}
                              </Badge>
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-bold ${
                                isDeduction ? 'text-emerald-700' : 'text-stone-900'
                              }`}
                            >
                              {isDeduction ? `− ${formatINR(tx.amount)}` : formatINR(tx.amount)}
                            </td>
                            <td className="py-2 px-3 text-stone-500 max-w-xs truncate">{tx.notes || '—'}</td>
                          </tr>
                        );
                      })}
                      {transactions.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-stone-400 text-xs">
                            No transactions logged for this employee.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: UNIFORM LEDGER */}
          {activeTab === 'uniform' && (
            <div className="space-y-4">
              {/* Uniform KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="text-stone-500 text-[11px] block">Currently Issued Sets</span>
                  <span className="text-xl font-bold text-amber-700 mt-1 block">
                    {totalIssuedUniforms} Pieces
                  </span>
                </div>
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="text-stone-500 text-[11px] block">Returned Sets</span>
                  <span className="text-xl font-bold text-emerald-700 mt-1 block">
                    {uniformItems.filter((u) => u.status === 'Returned').reduce((s, u) => s + Number(u.quantity || 0), 0)} Pieces
                  </span>
                </div>
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="text-stone-500 text-[11px] block">Exit Clearance Status</span>
                  <div className="mt-1 flex items-center gap-1.5 font-bold">
                    {totalIssuedUniforms === 0 ? (
                      <span className="text-emerald-700 flex items-center gap-1 text-sm">
                        <ShieldCheck className="h-4 w-4" /> Cleared
                      </span>
                    ) : (
                      <span className="text-rose-700 flex items-center gap-1 text-sm">
                        <ShieldAlert className="h-4 w-4" /> Pending Return ({totalIssuedUniforms} pcs)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Uniform Items Table */}
              <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
                <div className="bg-stone-50 p-3 border-b border-stone-200 flex items-center justify-between">
                  <h3 className="font-bold text-stone-900 text-xs">Uniform Items Issued &amp; In Custody</h3>
                  <span className="text-[11px] text-stone-500">{uniformItems.length} Issue Items</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Uniform Item</th>
                        <th className="py-2 px-3 text-center">Qty</th>
                        <th className="py-2 px-3 text-center">Status</th>
                        <th className="py-2 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {uniformItems.map((u) => {
                        const itemName = u.item?.name || u.legacy_uniform?.name || 'Uniform Item';
                        const itemCode = u.item?.item_code || '';
                        const targetId = u.item_id || u.uniform_item_id;

                        return (
                          <tr key={u.id} className="hover:bg-stone-50/80">
                            <td className="py-2 px-3 font-mono text-stone-600 whitespace-nowrap">{u.issue_date}</td>
                            <td className="py-2 px-3">
                              <div className="font-semibold text-stone-900">{itemName}</div>
                              {itemCode && (
                                <span className="font-mono text-[10px] text-amber-700">{itemCode}</span>
                              )}
                              {u.notes && (
                                <div className="text-[10px] text-stone-400 italic mt-0.5">{u.notes}</div>
                              )}
                            </td>
                            <td className="py-2 px-3 text-center font-bold text-stone-800">{u.quantity} pcs</td>
                            <td className="py-2 px-3 text-center">
                              <Badge variant={u.status === 'Issued' ? 'warning' : 'outline'} className="text-[10px]">
                                {u.status}
                              </Badge>
                            </td>
                            <td className="py-2 px-3 text-right">
                              {u.status === 'Issued' && targetId ? (
                                <button
                                  onClick={() => handleReturnUniformItem(u.id, targetId, u.quantity)}
                                  className="text-[11px] text-amber-700 hover:text-amber-900 font-semibold underline flex items-center gap-1 ml-auto"
                                >
                                  <RotateCcw className="h-3 w-3" /> Mark Returned
                                </button>
                              ) : (
                                <span className="text-[10px] text-stone-400">
                                  {u.returned_at ? `Returned ${new Date(u.returned_at).toLocaleDateString('en-GB')}` : '—'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {uniformItems.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-stone-400 text-xs">
                            No uniforms currently issued or logged for this employee.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal: Quick Advance/Deduction */}
        {showTxModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl max-w-sm w-full p-5 space-y-3 shadow-2xl text-xs border border-stone-200">
              <div className="flex items-center justify-between border-b pb-2">
                <h4 className="font-bold text-stone-900">Record Advance / Deduction</h4>
                <button onClick={() => setShowTxModal(false)} className="text-stone-400 hover:text-stone-700">✕</button>
              </div>
              <form onSubmit={handleRecordTx} className="space-y-2.5">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Transaction Type</label>
                  <select
                    value={txType}
                    onChange={(e) => setTxType(e.target.value)}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  >
                    <option value="Advance">Salary Advance</option>
                    <option value="Loan">Emergency Loan</option>
                    <option value="Penalty">Fine / Penalty</option>
                    <option value="Repayment">Cash Repayment from Staff</option>
                    <option value="Salary Deduction">Salary Deduction</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Amount (₹)</label>
                  <input
                    type="number"
                    value={txAmount || ''}
                    onChange={(e) => setTxAmount(parseFloat(e.target.value) || 0)}
                    placeholder="e.g. 2000"
                    required
                    className="w-full rounded-md border border-stone-300 p-2 font-bold text-stone-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Notes / Reason</label>
                  <input
                    type="text"
                    value={txNotes}
                    onChange={(e) => setTxNotes(e.target.value)}
                    placeholder="e.g. Festival advance request"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowTxModal(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" size="sm" disabled={txSaving} className="bg-amber-600 hover:bg-amber-700 text-white">
                    {txSaving ? 'Saving...' : 'Save Transaction'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Salary Payout */}
        {showPayoutModal && employee && (
          <SalaryPayoutModal
            isOpen={showPayoutModal}
            onClose={() => setShowPayoutModal(false)}
            employee={employee}
            outstandingAdvance={outstandingAdv}
            onSuccess={() => {
              setMessage({ type: 'success', text: 'Salary payout recorded successfully!' });
              loadData();
              if (onUpdated) onUpdated();
            }}
          />
        )}
      </div>
    </div>
  );
}
