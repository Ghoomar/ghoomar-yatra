'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { Department, Team, EmployeeRole, EmploymentStatus } from '@/lib/types/database';
import { X, User, Plus, AlertCircle, Phone, Calendar, IndianRupee } from 'lucide-react';
import { OrgHierarchyModal } from '@/components/admin/OrgHierarchyModal';

interface EmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee?: any | null; // existing employee if edit mode
  onSaved?: (emp: any) => void;
}

const EMPLOYMENT_STATUSES: EmploymentStatus[] = ['Active', 'On Leave', 'Resigned', 'Terminated'];

export function EmployeeModal({ isOpen, onClose, employee, onSaved }: EmployeeModalProps) {
  const supabase = createClient();
  const isEdit = Boolean(employee?.id);

  const [employeeCode, setEmployeeCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [joiningDate, setJoiningDate] = useState(new Date().toISOString().split('T')[0]);
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [salary, setSalary] = useState<number>(18000);
  const [employmentStatus, setEmploymentStatus] = useState('Active');
  const [bankAccount, setBankAccount] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [bankName, setBankName] = useState('');

  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Quick Add Org Modal
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgModalTab, setOrgModalTab] = useState<'departments' | 'teams' | 'roles'>('departments');

  const loadOrgData = async () => {
    try {
      const [{ data: dData }, { data: tData }, { data: rData }] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('teams').select('*').order('name'),
        supabase.from('employee_roles').select('*').order('name'),
      ]);
      setDepartments(dData || []);
      setTeams(tData || []);
      setRoles(rData || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadOrgData();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage(null);

    if (employee) {
      setEmployeeCode(employee.employee_code || '');
      setName(employee.name || '');
      setPhone(employee.phone || '');
      setJoiningDate(employee.joining_date || new Date().toISOString().split('T')[0]);
      setDepartmentId(employee.department_id || '');
      setTeamId(employee.team_id || '');
      setRoleId(employee.role_id || '');
      setSalary(Number(employee.monthly_salary) || 0);
      setEmploymentStatus(employee.employment_status || 'Active');

      const bank = employee.bank_details || {};
      setBankAccount(bank.account_number || '');
      setBankIfsc(bank.ifsc_code || '');
      setBankName(bank.bank_name || '');
    } else {
      setName('');
      setPhone('');
      setJoiningDate(new Date().toISOString().split('T')[0]);
      setDepartmentId('');
      setTeamId('');
      setRoleId('');
      setSalary(18000);
      setEmploymentStatus('Active');
      setBankAccount('');
      setBankIfsc('');
      setBankName('');

      generateNextEmployeeCode();
    }
  }, [isOpen, employee]);

  const generateNextEmployeeCode = async () => {
    try {
      const { data } = await supabase.from('employees').select('employee_code');
      let maxNum = 100;
      if (data) {
        for (const row of data) {
          if (!row.employee_code) continue;
          const match = row.employee_code.match(/(\d+)/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
          }
        }
      }
      setEmployeeCode(`GY-EMP-${maxNum + 1}`);
    } catch {
      setEmployeeCode(`GY-EMP-${Date.now().toString().slice(-4)}`);
    }
  };

  // Filter teams by department and roles by team
  const filteredTeams = teams.filter((t) => t.is_active && (!departmentId || t.department_id === departmentId));
  const filteredRoles = roles.filter((r) => r.is_active && (!teamId || r.team_id === teamId));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Employee name is required.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        employee_code: employeeCode.trim() || null,
        name: name.trim(),
        phone: phone.trim() || null,
        joining_date: joiningDate,
        department_id: departmentId || null,
        team_id: teamId || null,
        role_id: roleId || null,
        monthly_salary: salary,
        employment_status: employmentStatus,
        bank_details: {
          account_number: bankAccount.trim() || null,
          ifsc_code: bankIfsc.trim() || null,
          bank_name: bankName.trim() || null,
        },
        updated_at: new Date().toISOString(),
      };

      let result;
      if (isEdit && employee?.id) {
        const { data, error } = await supabase
          .from('employees')
          .update(payload)
          .eq('id', employee.id)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from('employees')
          .insert({
            ...payload,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      if (onSaved) onSaved(result);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save employee.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto">
        <div className="bg-white rounded-xl max-w-2xl w-full my-8 shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
                <User className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-stone-900">
                  {isEdit ? `Edit Staff Member: ${employee?.name}` : 'Register New Staff Member'}
                </h2>
                <p className="text-xs text-stone-500">
                  Maintain employee profiles, organizational roles, and compensation details
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/60"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Basic Info */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-stone-700 mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">Employee Code</label>
                  <input
                    type="text"
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value)}
                    className="w-full rounded-md border border-stone-300 bg-stone-50 p-2 font-mono text-stone-900 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Contact Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">Joining Date</label>
                  <input
                    type="date"
                    required
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>

            {/* Org Structure with Quick-Add */}
            <div className="space-y-3 pt-2 border-t border-stone-100">
              <h3 className="font-semibold text-stone-800">Operational Hierarchy &amp; Role</h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-stone-700">Department</label>
                    <button
                      type="button"
                      onClick={() => {
                        setOrgModalTab('departments');
                        setOrgModalOpen(true);
                      }}
                      className="text-[10px] text-amber-600 hover:text-amber-800 font-semibold"
                    >
                      + Add Dept
                    </button>
                  </div>
                  <select
                    value={departmentId}
                    onChange={(e) => {
                      setDepartmentId(e.target.value);
                      setTeamId('');
                      setRoleId('');
                    }}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  >
                    <option value="">Select Department...</option>
                    {departments
                      .filter((d) => d.is_active || d.id === departmentId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-stone-700">Team / Function</label>
                    <button
                      type="button"
                      onClick={() => {
                        setOrgModalTab('teams');
                        setOrgModalOpen(true);
                      }}
                      className="text-[10px] text-amber-600 hover:text-amber-800 font-semibold"
                    >
                      + Add Team
                    </button>
                  </div>
                  <select
                    value={teamId}
                    onChange={(e) => {
                      setTeamId(e.target.value);
                      setRoleId('');
                    }}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  >
                    <option value="">Select Team...</option>
                    {filteredTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-stone-700">Operational Role</label>
                    <button
                      type="button"
                      onClick={() => {
                        setOrgModalTab('roles');
                        setOrgModalOpen(true);
                      }}
                      className="text-[10px] text-amber-600 hover:text-amber-800 font-semibold"
                    >
                      + Add Role
                    </button>
                  </div>
                  <select
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value)}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  >
                    <option value="">Select Role...</option>
                    {filteredRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} {r.can_receive_store_issues ? ' (Issue Receiver)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Compensation & Status */}
            <div className="space-y-3 pt-2 border-t border-stone-100">
              <h3 className="font-semibold text-stone-800">Compensation &amp; Employment Status</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Monthly Gross Salary (₹)</label>
                  <input
                    type="number"
                    step="500"
                    value={salary || ''}
                    onChange={(e) => setSalary(parseFloat(e.target.value) || 0)}
                    placeholder="18000"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 font-bold focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">Employment Status</label>
                  <select
                    value={employmentStatus}
                    onChange={(e) => setEmploymentStatus(e.target.value)}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                  >
                    {EMPLOYMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Bank Details */}
            <div className="space-y-3 pt-2 border-t border-stone-100">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-stone-800">Bank Disbursement Account</h3>
                <span className="text-[11px] text-stone-400 font-normal">(Optional)</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-stone-700 mb-1">
                    Account Number <span className="text-stone-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={bankAccount}
                    onChange={(e) => setBankAccount(e.target.value)}
                    placeholder="e.g. 5010049281729"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    IFSC Code <span className="text-stone-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={bankIfsc}
                    onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                    placeholder="e.g. HDFC0001234"
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 font-mono uppercase focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
              <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="amber" disabled={saving}>
                {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Register Employee'}
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Embedded Org Hierarchy Modal for Quick-Add */}
      <OrgHierarchyModal
        isOpen={orgModalOpen}
        onClose={() => {
          setOrgModalOpen(false);
          loadOrgData();
        }}
        onUpdated={loadOrgData}
        defaultTab={orgModalTab}
      />
    </>
  );
}
