'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import { EmployeeModal } from '@/components/people/EmployeeModal';
import { OrgHierarchyModal } from '@/components/admin/OrgHierarchyModal';
import { StaffLedgerDrawer } from '@/components/people/StaffLedgerDrawer';
import { Users, Plus, RefreshCw, Network, Edit2, AlertCircle, CheckCircle, BookOpen } from 'lucide-react';
import { EmploymentStatus } from '@/lib/types/database';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';

interface Employee {
  id: string;
  employee_code?: string;
  name: string;
  phone?: string;
  department_id?: string;
  team_id?: string;
  role_id?: string;
  department_name?: string;
  team_name?: string;
  role_name?: string;
  joining_date: string;
  employment_status: EmploymentStatus;
  monthly_salary: number;
  allotted_weekly_off?: number;
  contractor_name?: string;
  bank_details?: any;
}

export default function EmployeesPage() {
  const supabase = createClient();
  const { t, locale } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | EmploymentStatus>('ALL');

  // Modals
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [orgHierarchyModalOpen, setOrgHierarchyModalOpen] = useState(false);
  const [drawerEmpId, setDrawerEmpId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: empData, error: empErr } = await supabase
        .from('employees')
        .select('*, department:departments(name, name_hi), team:teams(name, name_hi), role:employee_roles(name, name_hi)')
        .order('name');

      if (empErr) throw empErr;

      const [{ data: dData }, { data: tData }, { data: rData }] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('teams').select('*').order('name'),
        supabase.from('employee_roles').select('*').order('name'),
      ]);

      setDepartments(dData || []);
      setTeams(tData || []);
      setRoles(rData || []);
      setEmployees(
        (empData || []).map((e: any) => ({
          ...e,
          department_name: getLocalizedMasterName(e.department, locale),
          team_name: getLocalizedMasterName(e.team, locale),
          role_name: getLocalizedMasterName(e.role, locale),
        }))
      );
    } catch (err: any) {
      console.error('Error loading employees:', err);
      setMessage({ type: 'error', text: t('people.employees.loadFailed', { error: err.message }) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [locale]);

  const handleUpdateStatus = async (employeeId: string, nextStatus: EmploymentStatus) => {
    try {
      const { error } = await supabase
        .from('employees')
        .update({
          employment_status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', employeeId);

      if (error) throw error;
      const statusLabel = t(`people.employees.statuses.${nextStatus}` as any);
      setMessage({
        type: 'success',
        text: t('people.employees.statusUpdated', { status: statusLabel }),
      });
      loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: t('people.employees.updateStatusFailed', { error: err.message }) });
    }
  };

  const filteredEmployees = employees.filter((e) => {
    const matchesDept = selectedDept === 'ALL' || e.department_id === selectedDept;
    const matchesStatus =
      statusFilter === 'ALL' || e.employment_status === statusFilter;
    const matchesSearch =
      !search ||
      e.name?.toLowerCase().includes(search.toLowerCase()) ||
      e.employee_code?.toLowerCase().includes(search.toLowerCase()) ||
      e.phone?.includes(search);
    return matchesDept && matchesStatus && matchesSearch;
  });

  const activeEmployees = employees.filter((e) => e.employment_status === 'Active');
  const inactiveEmployees = employees.filter((e) => e.employment_status !== 'Active');
  const totalMonthlyPayroll = activeEmployees.reduce(
    (sum, e) => sum + (Number(e.monthly_salary) || 0),
    0
  );

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Users className="h-6 w-6 text-amber-600" />
            {t('people.employees.title')}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setEditingEmployee(null);
              setEmployeeModalOpen(true);
            }}
            className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Plus className="h-4 w-4" /> {t('people.employees.addEmployee')}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setOrgHierarchyModalOpen(true)}
            className="gap-1.5"
          >
            <Network className="h-4 w-4 text-stone-500" /> {t('people.employees.orgHierarchy')}
          </Button>

          <Button variant="outline" size="sm" onClick={loadData} title={t('people.employees.refresh')}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
            message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>{t('people.employees.kpi.employees')}</CardDescription>
            <div className="text-2xl font-bold text-stone-900 mt-1">
              {activeEmployees.length}{' '}
              {inactiveEmployees.length > 0 && (
                <span className="text-xs font-normal text-stone-400">
                  {t('people.employees.kpi.inactive', { count: inactiveEmployees.length })}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            {t('people.employees.kpi.departmentsRoles', { departments: departments.length, roles: roles.length })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>{t('people.employees.kpi.payroll')}</CardDescription>
            <div className="text-2xl font-bold text-amber-600 mt-1">
              {formatINR(totalMonthlyPayroll)}
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            {t('people.employees.kpi.dailyCost', { cost: formatINR(totalMonthlyPayroll / 30) })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription>{t('people.employees.kpi.hierarchy')}</CardDescription>
            <div className="text-base font-semibold text-stone-800 mt-1">
              {t('people.employees.kpi.hierarchyFlow')}
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-[11px] text-stone-500">
            {t('people.employees.kpi.hierarchyDesc')}
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 border border-stone-200 rounded-xl text-xs shadow-xs">
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedDept('ALL')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer shrink-0 ${
              selectedDept === 'ALL'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
            }`}
          >
            {t('people.employees.allDepartments')}
          </button>
          {departments.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDept(d.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer shrink-0 ${
                selectedDept === d.id
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              {getLocalizedMasterName(d, locale)}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-stone-100 p-0.5 rounded-lg border border-stone-200 shrink-0 overflow-x-auto max-w-full scrollbar-none">
            {(['ALL', 'Active', 'On Leave', 'Resigned', 'Terminated'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                {st === 'ALL' ? t('people.employees.allStatuses') : t(`people.employees.statuses.${st}` as any)}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder={t('people.employees.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-56 rounded-lg border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Employees Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('people.employees.staffCount', { count: filteredEmployees.length })}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> {t('people.employees.loading')}
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="py-12 text-center text-stone-400 text-xs">
              {t('people.employees.noEmployeesFound')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                    <th className="py-2.5 px-3">{t('people.employees.table.code')}</th>
                    <th className="py-2.5 px-3">{t('people.employees.table.name')}</th>
                    <th className="py-2.5 px-3">{t('people.employees.table.department')}</th>
                    <th className="py-2.5 px-3">{t('people.employees.table.role')}</th>
                    <th className="py-2.5 px-3">{t('people.employees.table.phone')}</th>
                    <th className="py-2.5 px-3 text-right">{t('people.employees.table.salary')}</th>
                    <th className="py-2.5 px-3 text-center">{t('people.employees.table.status')}</th>
                    <th className="py-2.5 px-3 text-right">{t('people.employees.table.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredEmployees.map((e) => {
                    const isActive = e.employment_status === 'Active';
                    return (
                      <tr
                        key={e.id}
                        className={`hover:bg-stone-50/80 transition-colors ${
                          !isActive ? 'opacity-60 bg-stone-50/30' : ''
                        }`}
                      >
                        <td className="py-3 px-3 font-mono text-stone-500 font-medium">
                          {e.employee_code || 'EMP'}
                        </td>
                        <td
                          className="py-3 px-3 font-medium text-stone-900 cursor-pointer hover:text-amber-700 hover:underline"
                          onClick={() => setDrawerEmpId(e.id)}
                          title={t('people.employees.viewStaffLedger')}
                        >
                          <div>{e.name}</div>
                          {e.contractor_name && (
                            <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.2 rounded font-normal">
                              {t('people.employees.contractor', { name: e.contractor_name })}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-stone-700">
                          {e.department_name || 'General'} {e.team_name && <span className="text-stone-400">• {e.team_name}</span>}
                        </td>
                        <td className="py-3 px-3 text-stone-800 font-medium">{e.role_name || 'Staff'}</td>
                        <td className="py-3 px-3 text-stone-600">{e.phone || '—'}</td>
                        <td className="py-3 px-3 text-right font-medium text-stone-900">
                          <div>{formatINR(Number(e.monthly_salary))}</div>
                          <span className="text-[10px] text-stone-400 font-normal">
                            {t('people.employees.weeklyOff', { count: e.allotted_weekly_off ?? 4 })}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <select
                            value={e.employment_status}
                            onChange={(ev) => handleUpdateStatus(e.id, ev.target.value as EmploymentStatus)}
                            className={`text-[11px] font-semibold py-1 px-2.5 rounded-full border cursor-pointer transition-colors outline-none ${
                              e.employment_status === 'Active'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                                : e.employment_status === 'On Leave'
                                ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                                : e.employment_status === 'Resigned'
                                ? 'bg-stone-100 text-stone-700 border-stone-300 hover:bg-stone-200'
                                : 'bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100'
                            }`}
                            title={t('people.employees.changeStatus')}
                          >
                            <option value="Active">{t('people.employees.statuses.Active')}</option>
                            <option value="On Leave">{t('people.employees.statuses.On Leave')}</option>
                            <option value="Resigned">{t('people.employees.statuses.Resigned')}</option>
                            <option value="Terminated">{t('people.employees.statuses.Terminated')}</option>
                          </select>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDrawerEmpId(e.id)}
                              className="h-7 px-2 text-stone-700 hover:text-amber-700 gap-1 text-xs"
                              title={t('people.drawer.title')}
                            >
                              <BookOpen className="h-3.5 w-3.5" /> {t('people.employees.table.viewLedger')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingEmployee(e);
                                setEmployeeModalOpen(true);
                              }}
                              className="h-7 px-2 text-stone-600 hover:text-stone-900 gap-1 text-xs"
                              title={t('people.employees.table.edit')}
                            >
                              <Edit2 className="h-3.5 w-3.5" /> {t('people.employees.table.edit')}
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

      {/* Employee Modal (Add & Edit) */}
      <EmployeeModal
        isOpen={employeeModalOpen}
        onClose={() => {
          setEmployeeModalOpen(false);
          setEditingEmployee(null);
        }}
        employee={editingEmployee}
        onSaved={() => {
          setEmployeeModalOpen(false);
          setEditingEmployee(null);
          loadData();
        }}
      />

      {/* Org Hierarchy Modal */}
      <OrgHierarchyModal
        isOpen={orgHierarchyModalOpen}
        onClose={() => setOrgHierarchyModalOpen(false)}
        onUpdated={loadData}
      />

      {/* Staff Ledger Drawer */}
      <StaffLedgerDrawer
        isOpen={Boolean(drawerEmpId)}
        employeeId={drawerEmpId}
        onClose={() => setDrawerEmpId(null)}
        onUpdated={loadData}
      />
    </div>
  );
}
