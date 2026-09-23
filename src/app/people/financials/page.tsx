'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatINR, getTodayBusinessDate } from '@/lib/utils';
import { EmployeeSalarySummaryRow } from '@/lib/types/database';
import { StaffLedgerDrawer } from '@/components/people/StaffLedgerDrawer';
import { SalaryPaymentModal } from '@/components/people/SalaryPaymentModal';
import {
  Wallet,
  Banknote,
  RefreshCw,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Lock,
  LockOpen,
  Eye,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export default function StaffFinancialsPage() {
  const { t } = useI18n();
  // Current month default: e.g. "2026-05"
  const defaultMonth = () => {
    return '2026-05'; // Default to reference month with rich authentic data
  };

  const [salaryMonth, setSalaryMonth] = useState(defaultMonth());
  const [rows, setRows] = useState<EmployeeSalarySummaryRow[]>([]);
  const [summary, setSummary] = useState<{
    totalDue: number;
    totalGiven: number;
    pendingBalance: number;
    netEarned: number;
    totalDeductions: number;
    staffCount: number;
  }>({
    totalDue: 0,
    totalGiven: 0,
    pendingBalance: 0,
    netEarned: 0,
    totalDeductions: 0,
    staffCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPendingOnly, setFilterPendingOnly] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals
  const [paymentRecord, setPaymentRecord] = useState<EmployeeSalarySummaryRow | null>(null);
  const [drawerEmployeeId, setDrawerEmployeeId] = useState<string | null>(null);
  const [editingPeriod, setEditingPeriod] = useState<EmployeeSalarySummaryRow | null>(null);
  const [editDeductions, setEditDeductions] = useState<number>(0);
  const [editNotes, setEditNotes] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/people/salary/periods?salary_month=${salaryMonth}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load salary data.');

      setRows(data.rows || []);
      setSummary(data.summary || {
        totalDue: 0,
        totalGiven: 0,
        pendingBalance: 0,
        netEarned: 0,
        totalDeductions: 0,
        staffCount: 0,
      });
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Error loading staff financials.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [salaryMonth]);

  const handlePrevMonth = () => {
    const [yearStr, monthStr] = salaryMonth.split('-');
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10);
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    setSalaryMonth(`${year}-${String(month).padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
    const [yearStr, monthStr] = salaryMonth.split('-');
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    setSalaryMonth(`${year}-${String(month).padStart(2, '0')}`);
  };

  const handleSyncAttendance = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/people/salary/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', salary_month: salaryMonth }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed.');

      setMessage({ type: 'success', text: data.message || 'Attendance synced successfully.' });
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to sync attendance.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleClosePeriod = async () => {
    if (!confirm(`Are you sure you want to close the salary period for ${salaryMonth}? This will lock the historical closing balance and carry remaining pending balances into next month.`)) {
      return;
    }
    setClosing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/people/salary/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', salary_month: salaryMonth }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Close period failed.');

      setMessage({ type: 'success', text: data.message || `Salary period ${salaryMonth} closed.` });
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to close period.' });
    } finally {
      setClosing(false);
    }
  };

  const handleSaveEditPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPeriod) return;
    setSavingEdit(true);
    try {
      const res = await fetch('/api/people/salary/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          period_id: editingPeriod.period_id,
          manual_deductions: editDeductions,
          notes: editNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed.');

      setMessage({ type: 'success', text: `Deductions updated for ${editingPeriod.employee_name}.` });
      setEditingPeriod(null);
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to update period.' });
    } finally {
      setSavingEdit(false);
    }
  };

  // Filter rows
  const filteredRows = rows.filter((r) => {
    const matchesSearch =
      r.employee_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.employee_code && r.employee_code.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (r.department_name && r.department_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (r.contractor_name && r.contractor_name.toLowerCase().includes(searchQuery.toLowerCase()));

    if (filterPendingOnly) {
      return matchesSearch && Number(r.pending_salary_balance) > 0;
    }
    return matchesSearch;
  });

  const isPeriodClosed = rows.length > 0 && rows.every((r) => r.period_status === 'closed');

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Wallet className="h-6 w-6 text-amber-600" />
            {t('people.financials.title')}
          </h1>
          <p className="text-sm text-stone-500">
            {t('people.financials.subtitle')}
          </p>
        </div>

        {/* Month Navigator & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-white border border-stone-200 rounded-lg p-1 shadow-xs">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevMonth}
              className="h-7 w-7 p-0 border-0 hover:bg-stone-100"
              title="Previous Month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="month"
              value={salaryMonth}
              onChange={(e) => setSalaryMonth(e.target.value)}
              className="px-2 text-xs font-bold text-stone-900 bg-transparent border-0 focus:outline-none cursor-pointer"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextMonth}
              className="h-7 w-7 p-0 border-0 hover:bg-stone-100"
              title="Next Month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncAttendance}
            disabled={syncing || isPeriodClosed}
            className="text-xs font-semibold"
            title="Roll up attendance and recalculate periods"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? t('people.financials.syncing') : t('people.financials.syncAttendance')}
          </Button>

          {!isPeriodClosed ? (
            <Button
              size="sm"
              onClick={handleClosePeriod}
              disabled={closing || rows.length === 0}
              className="bg-stone-800 hover:bg-stone-900 text-white text-xs font-semibold"
            >
              <Lock className="h-3.5 w-3.5 mr-1.5" />
              {closing ? t('people.financials.closing') : t('people.financials.closePeriod')}
            </Button>
          ) : (
            <Badge variant="default" className="py-1 px-2.5 text-xs bg-stone-100 text-stone-700 border border-stone-300">
              <Lock className="h-3 w-3 mr-1 text-stone-500" />
              {t('people.financials.periodClosed')}
            </Badge>
          )}
        </div>
      </div>

      {/* Notifications */}
      {message && (
        <div
          className={`p-3 rounded-xl text-sm font-medium flex items-center justify-between gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="text-stone-400 hover:text-stone-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Top Executive KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Salary Due */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs font-semibold text-stone-500 block uppercase tracking-wider">
              {t('people.financials.kpi.totalDue')}
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-1">
              {formatINR(summary.totalDue)}
            </div>
            <span className="text-[11px] text-stone-500 block mt-0.5">
              {t('people.financials.accruedFor', { count: summary.staffCount })}
            </span>
          </CardContent>
        </Card>

        {/* Total Salary Given */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs font-semibold text-stone-500 block uppercase tracking-wider">
              {t('people.financials.kpi.totalDisbursed')}
            </span>
            <div className="text-2xl font-bold text-emerald-700 mt-1">
              {formatINR(summary.totalGiven)}
            </div>
            <span className="text-[11px] text-stone-500 block mt-0.5">
              {t('people.financials.disbursedIn', { month: salaryMonth })}
            </span>
          </CardContent>
        </Card>

        {/* Pending Salary Balance (Primary Metric) */}
        <Card className="border-amber-300 bg-amber-50/40 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                {t('people.financials.kpi.pendingBalance')}
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-900">
                {t('people.financials.payableBadge')}
              </span>
            </div>
            <div className="text-2xl font-extrabold text-amber-800 mt-1">
              {formatINR(summary.pendingBalance)}
            </div>
            <span className="text-[11px] text-amber-700 block mt-0.5 font-medium">
              {t('people.financials.outstandingDesc')}
            </span>
          </CardContent>
        </Card>

        {/* Month Earned Salary */}
        <Card className="border-stone-200 shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs font-semibold text-stone-500 block uppercase tracking-wider">
              {t('people.financials.table.net')}
            </span>
            <div className="text-2xl font-bold text-stone-900 mt-1">
              {formatINR(summary.netEarned)}
            </div>
            <span className="text-[11px] text-stone-500 block mt-0.5">
              {t('people.financials.netOfDeductions', { amount: formatINR(summary.totalDeductions) })}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Table Section */}
      <Card className="border-stone-200 shadow-xs">
        <CardHeader className="pb-3 border-b border-stone-100">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-bold text-stone-900">
                {t('people.financials.registerTitle')}
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                {t('people.financials.employeeCount', { count: filteredRows.length })}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search Bar */}
              <div className="relative min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  placeholder={t('people.financials.searchStaff')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 pl-8 pr-3 py-1.5 text-xs focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-stone-50/50"
                />
              </div>

              {/* Pending Toggle */}
              <button
                onClick={() => setFilterPendingOnly(!filterPendingOnly)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                  filterPendingOnly
                    ? 'bg-amber-100/70 border-amber-300 text-amber-900 font-semibold'
                    : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
              >
                <Filter className="h-3 w-3" />
                {t('people.financials.pendingOnly')}
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-stone-400">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
              <p className="text-sm">{t('people.financials.loading')}</p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="py-16 text-center text-stone-400">
              <p className="text-sm">{t('people.financials.noRecords')}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncAttendance}
                className="mt-3 text-xs"
              >
                {t('people.financials.syncAttendance')}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="p-3">{t('people.financials.table.employee')}</th>
                    <th className="p-3">{t('people.financials.table.deptRole')}</th>
                    <th className="p-3 text-right">{t('people.financials.table.monthlyBase')}</th>
                    <th className="p-3 text-center">{t('people.financials.table.days')}</th>
                    <th className="p-3 text-right">{t('people.financials.table.net')}</th>
                    <th className="p-3 text-right">{t('people.financials.table.prevPending')}</th>
                    <th className="p-3 text-right font-bold text-stone-900">{t('people.financials.table.totalDue')}</th>
                    <th className="p-3 text-right text-emerald-700">{t('people.financials.table.paid')}</th>
                    <th className="p-3 text-right font-extrabold text-amber-800">{t('people.financials.table.balance')}</th>
                    <th className="p-3 text-center">{t('people.financials.table.status')}</th>
                    <th className="p-3 text-right">{t('people.financials.table.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredRows.map((r) => {
                    const isZeroPending = Number(r.pending_salary_balance) === 0;
                    return (
                      <tr
                        key={r.period_id}
                        className="hover:bg-amber-50/20 transition-colors cursor-pointer group"
                        onClick={() => setDrawerEmployeeId(r.employee_id)}
                      >
                        {/* Employee Name & Code */}
                        <td className="p-3 font-semibold text-stone-900 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>{r.employee_name}</span>
                            {r.contractor_name && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1 text-purple-700 border-purple-200 bg-purple-50">
                                {t('people.financials.contractor')}
                              </Badge>
                            )}
                          </div>
                          {r.employee_code && (
                            <span className="font-mono text-[11px] text-stone-400 block font-normal">
                              {r.employee_code}
                            </span>
                          )}
                        </td>

                        {/* Dept & Role */}
                        <td className="p-3 text-stone-600 whitespace-nowrap">
                          <span className="block">{r.department_name || 'General'}</span>
                          <span className="text-[11px] text-stone-400 block">{r.role_name || 'Staff'}</span>
                        </td>

                        {/* Monthly Base Salary */}
                        <td className="p-3 text-right font-medium text-stone-700 whitespace-nowrap">
                          {formatINR(r.monthly_salary)}
                        </td>

                        {/* Pay Days */}
                        <td className="p-3 text-center whitespace-nowrap">
                          <span className="font-semibold text-stone-800">{r.pay_days}</span>
                          <span className="text-[10px] text-stone-400 block">
                            ({r.present_days}P + {r.allotted_weekly_off}WO)
                          </span>
                        </td>

                        {/* Earned Salary */}
                        <td className="p-3 text-right font-medium text-stone-800 whitespace-nowrap">
                          {formatINR(r.net_earned_salary)}
                          {Number(r.total_deductions) > 0 && (
                            <span className="text-[10px] text-rose-600 block">
                              -{formatINR(r.total_deductions)}
                            </span>
                          )}
                        </td>

                        {/* Prev Pending */}
                        <td className="p-3 text-right font-medium text-stone-600 whitespace-nowrap">
                          {formatINR(r.previous_pending_salary)}
                        </td>

                        {/* Total Due */}
                        <td className="p-3 text-right font-bold text-stone-900 whitespace-nowrap bg-stone-50/50">
                          {formatINR(r.total_salary_due)}
                        </td>

                        {/* Given */}
                        <td className="p-3 text-right font-semibold text-emerald-700 whitespace-nowrap">
                          {formatINR(r.total_salary_given)}
                          {r.payments_count > 0 && (
                            <span className="text-[10px] text-stone-400 block">
                              ({r.payments_count} {r.payments_count === 1 ? 'txn' : 'txns'})
                            </span>
                          )}
                        </td>

                        {/* Pending Balance */}
                        <td className="p-3 text-right whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                              isZeroPending
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-100 text-amber-900 border border-amber-300'
                            }`}
                          >
                            {formatINR(r.pending_salary_balance)}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="p-3 text-center whitespace-nowrap">
                          <Badge
                            variant={r.period_status === 'closed' ? 'default' : 'outline'}
                            className="text-[10px]"
                          >
                            {r.period_status === 'closed' ? (
                              <span className="flex items-center gap-1">
                                <Lock className="h-2.5 w-2.5" /> {t('people.financials.closed')}
                              </span>
                            ) : (
                              t('people.financials.draft')
                            )}
                          </Badge>
                        </td>

                        {/* Actions */}
                        <td className="p-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => setPaymentRecord(r)}
                              className="h-7 px-2.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white"
                              title="Record salary payment"
                            >
                              <Banknote className="h-3.5 w-3.5 mr-1" />
                              {t('people.financials.table.pay')}
                            </Button>

                            {r.period_status === 'draft' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingPeriod(r);
                                  setEditDeductions(Number(r.manual_deductions) || 0);
                                  setEditNotes(r.notes || '');
                                }}
                                className="h-7 w-7 p-0 text-stone-500 hover:text-stone-800"
                                title="Adjust manual deductions"
                              >
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDrawerEmployeeId(r.employee_id)}
                              className="h-7 w-7 p-0 text-stone-500 hover:text-stone-800"
                              title="View employee ledger drawer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Modal */}
      {paymentRecord && (
        <SalaryPaymentModal
          isOpen={!!paymentRecord}
          onClose={() => setPaymentRecord(null)}
          record={paymentRecord}
          onSuccess={() => {
            loadData();
            setMessage({ type: 'success', text: t('people.paymentModal.success') });
          }}
        />
      )}

      {/* Staff Ledger Drawer */}
      {drawerEmployeeId && (
        <StaffLedgerDrawer
          isOpen={!!drawerEmployeeId}
          onClose={() => setDrawerEmployeeId(null)}
          employeeId={drawerEmployeeId}
          onUpdated={loadData}
        />
      )}

      {/* Edit Deductions Modal */}
      {editingPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-stone-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4 bg-stone-50">
              <div>
                <h3 className="text-base font-bold text-stone-900">{t('people.financials.editDeductionModal.title')}</h3>
                <p className="text-xs text-stone-500">{t('people.financials.editDeductionModal.employeeSubtitle', { name: editingPeriod.employee_name, month: editingPeriod.salary_month })}</p>
              </div>
              <button
                onClick={() => setEditingPeriod(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditPeriod} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  {t('people.financials.editDeductionModal.penalty')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editDeductions}
                  onChange={(e) => setEditDeductions(Number(e.target.value))}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 font-semibold"
                />
                <p className="text-[11px] text-stone-400 mt-1">
                  {t('people.financials.editDeductionModal.penaltyDesc')}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  {t('people.financials.editDeductionModal.notes')}
                </label>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder={t('people.financials.editDeductionModal.notesPlaceholder')}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-stone-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingPeriod(null)}
                  disabled={savingEdit}
                >
                  {t('people.financials.editDeductionModal.cancel')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={savingEdit}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {savingEdit ? t('people.financials.editDeductionModal.saving') : t('people.financials.editDeductionModal.save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
