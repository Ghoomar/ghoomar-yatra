'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import { logAuditAction } from '@/lib/audit-logger';
import { SalaryPaymentModal } from './SalaryPaymentModal';
import { EmployeeSalarySummaryRow, EmployeeSalaryPayment } from '@/lib/types/database';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';
import {
  X,
  Wallet,
  Shirt,
  Banknote,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Phone,
  UserCheck,
  CreditCard,
  History,
  Lock,
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
  const { t, locale } = useI18n();
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<'financial' | 'uniform'>('financial');
  const [employee, setEmployee] = useState<any | null>(null);
  const [salaryPeriods, setSalaryPeriods] = useState<EmployeeSalarySummaryRow[]>([]);
  const [payments, setPayments] = useState<EmployeeSalaryPayment[]>([]);
  const [uniformItems, setUniformItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal State
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPeriodForPayment, setSelectedPeriodForPayment] = useState<EmployeeSalarySummaryRow | null>(null);

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
          department:departments(name, name_hi),
          team:teams(name, name_hi),
          role:employee_roles(name, name_hi)
        `)
        .eq('id', employeeId)
        .single();

      if (empErr) throw empErr;

      // 2. Salary summary / periods from authoritative view
      const { data: periods, error: periodsErr } = await supabase
        .from('employee_salary_summary')
        .select('*')
        .eq('employee_id', employeeId)
        .order('salary_month', { ascending: false });

      if (periodsErr) throw periodsErr;

      // 3. Payment history
      const { data: payHistory, error: payErr } = await supabase
        .from('employee_salary_payments')
        .select('*')
        .eq('employee_id', employeeId)
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (payErr) throw payErr;

      // 4. Uniform issues & custody
      const { data: uIssues } = await supabase
        .from('employee_uniform_issues')
        .select(`
          id, business_date, notes, created_at,
          items:employee_uniform_issue_items(
            id, quantity, status, item_id, uniform_item_id, returned_at, notes,
            item:inventory_items!employee_uniform_issue_items_item_id_fkey(name, name_hi, item_code, current_stock, current_weighted_average_cost)
          )
        `)
        .eq('employee_id', employeeId)
        .order('business_date', { ascending: false });

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
      setSalaryPeriods(periods || []);
      setPayments(payHistory || []);
      setUniformItems(flatUniforms);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || (locale === 'hi' ? 'स्टाफ लेजर लोड करने में विफल।' : 'Failed to load staff ledger.') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && employeeId) {
      loadData();
    }
  }, [isOpen, employeeId]);

  const handleReturnUniformItem = async (issueItemId: string, itemId: string | null, qty: number) => {
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];

      // Update issue item status
      const { error: updErr } = await supabase
        .from('employee_uniform_issue_items')
        .update({
          status: 'Returned',
          returned_at: new Date().toISOString(),
        })
        .eq('id', issueItemId);

      if (updErr) throw updErr;

      // If tied to inventory_items, add stock back to central store
      if (itemId) {
        const { data: centralLoc } = await supabase
          .from('inventory_locations')
          .select('id')
          .ilike('name', '%central%')
          .single();

        if (centralLoc) {
          await supabase.from('stock_movements').insert({
            business_date: today,
            movement_type: 'return',
            item_id: itemId,
            destination_location_id: centralLoc.id,
            quantity: qty,
            notes: `Uniform return from ${employee?.name || 'employee'}`,
            created_at: new Date().toISOString(),
          });
        }
      }

      await logAuditAction({
        action: 'UPDATE',
        entityType: 'Uniform Return',
        entityId: issueItemId,
        newValues: { employee_id: employeeId, item_id: itemId, quantity: qty },
      });

      setMessage({ type: 'success', text: locale === 'hi' ? 'यूनिफॉर्म वापसी सफलतापूर्वक दर्ज की गई।' : 'Uniform return logged successfully.' });
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || (locale === 'hi' ? 'यूनिफॉर्म वापसी दर्ज करने में विफल।' : 'Failed to record return.') });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const latestPeriod = salaryPeriods[0] || null;
  const currentPending = latestPeriod ? Number(latestPeriod.pending_salary_balance) : 0;
  const totalIssuedUniforms = uniformItems
    .filter((u) => u.status === 'Issued')
    .reduce((sum, u) => sum + Number(u.quantity || 0), 0);

  const openPaymentForPeriod = (period: EmployeeSalarySummaryRow) => {
    setSelectedPeriodForPayment(period);
    setShowPaymentModal(true);
  };

  const formatPaymentType = (type: string) => {
    if (locale !== 'hi') return type;
    if (type === 'Salary Payment') return 'वेतन भुगतान';
    if (type === 'Advance Salary') return 'अग्रिम वेतन';
    if (type === 'Settlement') return 'हिसाब चुकता';
    return type;
  };

  const formatPaymentMethod = (method: string) => {
    if (locale !== 'hi') return method;
    if (method === 'Bank Transfer') return 'बैंक ट्रांसफर';
    if (method === 'UPI') return 'यूपीआई';
    if (method === 'Cash') return 'नकद';
    if (method === 'Cheque') return 'चेक';
    return method;
  };

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
                <h2 className="text-base font-bold text-stone-900">{employee?.name || (locale === 'hi' ? 'स्टाफ सदस्य' : 'Staff Member')}</h2>
                {employee?.employee_code && (
                  <span className="font-mono text-xs font-bold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded">
                    {employee.employee_code}
                  </span>
                )}
                <Badge variant={employee?.employment_status === 'Active' ? 'success' : 'default'} className="text-[10px]">
                  {employee?.employment_status === 'Active' ? (locale === 'hi' ? 'सक्रिय' : 'Active') : (locale === 'hi' ? 'निष्क्रिय' : 'Inactive')}
                </Badge>
              </div>
              <div className="text-[11px] text-stone-500 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                <span>{getLocalizedMasterName(employee?.department, locale) || (locale === 'hi' ? 'सामान्य स्टाफ' : 'General Staff')}</span>
                {employee?.team && <span>• {getLocalizedMasterName(employee.team, locale)}</span>}
                {employee?.role && <span>• {getLocalizedMasterName(employee.role, locale)}</span>}
                {employee?.contractor_name && <span>• {locale === 'hi' ? `ठेकेदार: ${employee.contractor_name}` : `Contractor: ${employee.contractor_name}`}</span>}
                {employee?.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {employee.phone}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadData} title={locale === 'hi' ? 'रिफ्रेश करें' : 'Refresh'}>
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
            {locale === 'hi' ? 'वेतन देय लेजर' : 'Salary Payable Ledger'}
            {currentPending > 0 && (
              <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {formatINR(currentPending)} {locale === 'hi' ? 'बाकी' : 'pending'}
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
            {locale === 'hi' ? 'यूनिफॉर्म हिसाब व एग्जिट' : 'Uniform Custody & Exit Clearance'}
            {totalIssuedUniforms > 0 && (
              <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {totalIssuedUniforms} {locale === 'hi' ? 'पीस' : 'pcs'}
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
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* TAB 1: SALARY PAYABLE LEDGER */}
          {activeTab === 'financial' && (
            <div className="space-y-5">
              {/* Latest Period Snapshot Card */}
              {latestPeriod ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                        {locale === 'hi' ? `वर्तमान अवधि (${latestPeriod.salary_month})` : `Current Period (${latestPeriod.salary_month})`}
                      </span>
                      <h4 className="text-sm font-semibold text-stone-900 mt-0.5">
                        {locale === 'hi'
                          ? `मूल: ${formatINR(latestPeriod.monthly_salary)} / माह • ${latestPeriod.pay_days} देय दिन`
                          : `Base: ${formatINR(latestPeriod.monthly_salary)} / mo • ${latestPeriod.pay_days} Pay Days`}
                      </h4>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => openPaymentForPeriod(latestPeriod)}
                      className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                    >
                      <Banknote className="h-3.5 w-3.5 mr-1.5" />
                      {locale === 'hi' ? 'भुगतान दर्ज करें' : 'Record Payment'}
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-amber-200/70 text-xs">
                    <div>
                      <span className="text-stone-500 block">{t('people.paymentModal.prevPending')}</span>
                      <span className="font-semibold text-stone-800">{formatINR(latestPeriod.previous_pending_salary)}</span>
                    </div>
                    <div>
                      <span className="text-stone-500 block">{t('people.paymentModal.earnedMonth')}</span>
                      <span className="font-semibold text-stone-800">{formatINR(latestPeriod.net_earned_salary)}</span>
                    </div>
                    <div>
                      <span className="text-stone-500 block">{t('people.paymentModal.totalDue')}</span>
                      <span className="font-bold text-stone-900">{formatINR(latestPeriod.total_salary_due)}</span>
                    </div>
                    <div>
                      <span className="text-stone-500 block">{t('people.paymentModal.alreadyGiven')}</span>
                      <span className="font-semibold text-emerald-700">{formatINR(latestPeriod.total_salary_given)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-amber-200/70 bg-amber-100/60 -mx-4 -mb-4 px-4 py-2.5 rounded-b-xl">
                    <span className="text-xs font-bold text-amber-900">
                      {t('people.paymentModal.outstandingBalance')}:
                    </span>
                    <span className="text-base font-extrabold text-amber-800">
                      {formatINR(latestPeriod.pending_salary_balance)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-center text-xs text-stone-500">
                  {locale === 'hi' ? 'इस कर्मचारी के लिए अभी कोई वेतन अवधि रिकॉर्ड नहीं बना है।' : 'No salary period records generated for this employee yet.'}
                </div>
              )}

              {/* SECTION: Recent Salary Payments / Disbursements */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wider flex items-center gap-1.5">
                    <CreditCard className="h-4 w-4 text-stone-500" />
                    {locale === 'hi' ? `वेतन संवितरण (${payments.length})` : `Salary Disbursements (${payments.length})`}
                  </h3>
                </div>

                {payments.length === 0 ? (
                  <div className="text-center py-6 text-xs text-stone-400 border border-dashed border-stone-200 rounded-xl">
                    {locale === 'hi' ? 'इस कर्मचारी के लिए कोई भुगतान रिकॉर्ड नहीं है।' : 'No disbursements recorded for this employee yet.'}
                  </div>
                ) : (
                  <div className="border border-stone-200 rounded-xl overflow-hidden shadow-xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                        <tr>
                          <th className="p-2.5">{locale === 'hi' ? 'दिनांक' : 'Date'}</th>
                          <th className="p-2.5">{locale === 'hi' ? 'अवधि' : 'Period'}</th>
                          <th className="p-2.5">{locale === 'hi' ? 'प्रकार एवं माध्यम' : 'Type & Method'}</th>
                          <th className="p-2.5">{locale === 'hi' ? 'संदर्भ / यूटीआर' : 'Ref / UTR'}</th>
                          <th className="p-2.5 text-right">{locale === 'hi' ? 'राशि' : 'Amount'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {payments.map((p) => (
                          <tr key={p.id} className="hover:bg-stone-50/60">
                            <td className="p-2.5 font-medium text-stone-900 whitespace-nowrap">
                              {p.payment_date}
                            </td>
                            <td className="p-2.5 text-stone-600 whitespace-nowrap">
                              {p.salary_month}
                            </td>
                            <td className="p-2.5">
                              <span className="font-medium text-stone-800">{formatPaymentType(p.payment_type)}</span>
                              <span className="text-[11px] text-stone-500 block">{formatPaymentMethod(p.payment_method)}</span>
                            </td>
                            <td className="p-2.5 font-mono text-[11px] text-stone-500">
                              {p.reference_number || '—'}
                            </td>
                            <td className="p-2.5 text-right font-bold text-emerald-700 whitespace-nowrap">
                              {formatINR(p.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* SECTION: Period Roll-Over History */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wider flex items-center gap-1.5">
                    <History className="h-4 w-4 text-stone-500" />
                    {locale === 'hi' ? `अवधि कैरी-फॉरवर्ड इतिहास (${salaryPeriods.length})` : `Period Carry-Forward History (${salaryPeriods.length})`}
                  </h3>
                </div>

                <div className="space-y-2">
                  {salaryPeriods.map((p) => (
                    <div
                      key={p.period_id}
                      className="border border-stone-200 rounded-xl p-3 bg-white hover:border-stone-300 transition text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-stone-900">{p.salary_month}</span>
                          <Badge variant={p.period_status === 'closed' ? 'default' : 'outline'} className="text-[10px]">
                            {p.period_status === 'closed' ? (
                              <span className="flex items-center gap-1">
                                <Lock className="h-2.5 w-2.5" /> {locale === 'hi' ? 'बंद' : 'Closed'}
                              </span>
                            ) : (
                              locale === 'hi' ? 'ड्राफ्ट' : 'Draft'
                            )}
                          </Badge>
                          <span className="text-stone-400">•</span>
                          <span className="text-stone-600">{p.pay_days} {locale === 'hi' ? 'देय दिन' : 'Pay Days'}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[11px] text-stone-500 mr-1">{locale === 'hi' ? 'बाकी:' : 'Pending:'}</span>
                          <span className="font-bold text-amber-800">{formatINR(p.pending_salary_balance)}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 pt-1.5 border-t border-stone-100 text-[11px]">
                        <div>
                          <span className="text-stone-400 block">{t('people.paymentModal.prevPending')}</span>
                          <span className="text-stone-700 font-medium">{formatINR(p.previous_pending_salary)}</span>
                        </div>
                        <div>
                          <span className="text-stone-400 block">{t('people.paymentModal.earnedMonth')}</span>
                          <span className="text-stone-700 font-medium">{formatINR(p.net_earned_salary)}</span>
                        </div>
                        <div>
                          <span className="text-stone-400 block">{t('people.paymentModal.totalDue')}</span>
                          <span className="text-stone-900 font-semibold">{formatINR(p.total_salary_due)}</span>
                        </div>
                        <div>
                          <span className="text-stone-400 block">{t('people.paymentModal.alreadyGiven')}</span>
                          <span className="text-emerald-700 font-semibold">{formatINR(p.total_salary_given)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: UNIFORM CUSTODY & EXIT CLEARANCE */}
          {activeTab === 'uniform' && (
            <div className="space-y-4">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-between text-xs">
                <div>
                  <span className="text-stone-500 block text-[11px]">
                    {locale === 'hi' ? 'स्टाफ के पास जारी कुल यूनिफॉर्म' : 'Total Issued Pieces in Custody'}
                  </span>
                  <span className="text-base font-bold text-stone-900 mt-0.5 block">
                    {totalIssuedUniforms} {locale === 'hi' ? 'आइटम' : 'Items'}
                  </span>
                </div>
                <Badge variant={totalIssuedUniforms === 0 ? 'success' : 'default'}>
                  {totalIssuedUniforms === 0
                    ? locale === 'hi' ? 'एग्जिट मंज़ूर' : 'Clear for Exit'
                    : locale === 'hi' ? 'वापसी बाकी' : 'Pending Return'}
                </Badge>
              </div>

              {uniformItems.length === 0 ? (
                <div className="text-center py-8 text-xs text-stone-400 border border-dashed border-stone-200 rounded-xl">
                  {locale === 'hi' ? 'इस स्टाफ सदस्य को कोई यूनिफॉर्म जारी नहीं की गई है।' : 'No uniforms issued to this staff member.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {uniformItems.map((u) => (
                    <div
                      key={u.id}
                      className="p-3 bg-white border border-stone-200 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-stone-900">
                          {getLocalizedMasterName(u.item, locale) || (locale === 'hi' ? 'यूनिफॉर्म आइटम' : 'Uniform Item')}
                        </span>
                        <div className="text-[11px] text-stone-500 mt-0.5">
                          {locale === 'hi' ? `जारी दिनांक: ${u.issue_date} • मात्रा: ${u.quantity}` : `Issued: ${u.issue_date} • Qty: ${u.quantity}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={u.status === 'Issued' ? 'warning' : 'outline'} className="text-[10px]">
                          {u.status === 'Issued' ? (locale === 'hi' ? 'जारी' : 'Issued') : (locale === 'hi' ? 'वापस प्राप्त' : u.status)}
                        </Badge>
                        {u.status === 'Issued' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleReturnUniformItem(u.id, u.item_id, u.quantity)}
                            className="text-xs h-7"
                          >
                            {locale === 'hi' ? 'वापसी दर्ज करें' : 'Return'}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Salary Payment Modal */}
      {showPaymentModal && selectedPeriodForPayment && (
        <SalaryPaymentModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          record={selectedPeriodForPayment}
          onSuccess={() => {
            loadData();
            if (onUpdated) onUpdated();
          }}
        />
      )}
    </div>
  );
}
