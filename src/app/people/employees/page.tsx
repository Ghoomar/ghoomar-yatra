'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import { Users, Plus, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

interface Employee {
  id: string;
  employee_code?: string;
  name: string;
  phone?: string;
  department_name?: string;
  team_name?: string;
  role_name?: string;
  joining_date: string;
  employment_status: string;
  monthly_salary: number;
}

export default function EmployeesPage() {
  const supabase = createClient();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [salary, setSalary] = useState<number>(18000);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: empData } = await supabase
        .from('employees')
        .select('*, department:departments(name), team:teams(name), role:employee_roles(name)')
        .order('name');

      const { data: dData } = await supabase.from('departments').select('*').order('name');
      const { data: tData } = await supabase.from('teams').select('*').order('name');
      const { data: rData } = await supabase.from('employee_roles').select('*').order('name');

      setDepartments(dData || []);
      setTeams(tData || []);
      setRoles(rData || []);
      setEmployees(
        (empData || []).map((e: any) => ({
          ...e,
          department_name: e.department?.name,
          team_name: e.team?.name,
          role_name: e.role?.name,
        }))
      );
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Failed to load employee directory.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredTeams = teams.filter((t) => !departmentId || t.department_id === departmentId);
  const filteredRoles = roles.filter((r) => !teamId || r.team_id === teamId);

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const code = `GY-EMP-${Date.now().toString().slice(-4)}`;
      const { error } = await supabase.from('employees').insert({
        employee_code: code,
        name,
        phone,
        department_id: departmentId || null,
        team_id: teamId || null,
        role_id: roleId || null,
        monthly_salary: salary,
        employment_status: 'Active',
      });

      if (error) throw error;

      setMessage({ type: 'success', text: `Employee ${name} (${code}) added successfully.` });
      setShowAddModal(false);
      setName('');
      setPhone('');
      setSalary(18000);
      loadData();
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'Failed to add employee.' });
    } finally {
      setSaving(false);
    }
  };

  const totalMonthlyPayroll = employees
    .filter((e) => e.employment_status === 'Active')
    .reduce((sum, e) => sum + (Number(e.monthly_salary) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Users className="h-6 w-6 text-amber-600" />
            Staff Directory & Hierarchy
          </h1>
          <p className="text-sm text-stone-500">
            Departmental roster of operational personnel across Food & Beverage, Kitchen, Stores & Gate.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="amber" size="sm" onClick={() => setShowAddModal(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add Employee
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
          <CardDescription>Total Active Employees</CardDescription>
          <div className="text-2xl font-bold text-stone-900 mt-1">
            {employees.filter((e) => e.employment_status === 'Active').length}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Across {departments.length} departments</div>
        </Card>

        <Card>
          <CardDescription>Monthly Payroll Commitment</CardDescription>
          <div className="text-2xl font-bold text-amber-600 mt-1">
            {formatINR(totalMonthlyPayroll)}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            Daily fixed cost allocation: {formatINR(totalMonthlyPayroll / 30)}/day
          </div>
        </Card>

        <Card>
          <CardDescription>Operational Hierarchy</CardDescription>
          <div className="text-base font-semibold text-stone-800 mt-1">
            Department → Team → Role
          </div>
          <div className="text-[11px] text-stone-500 mt-1">Configurable organizational structure</div>
        </Card>
      </div>

      {/* Employees Table */}
      <Card>
        <CardHeader>
          <CardTitle>Staff Members ({employees.length})</CardTitle>
          <CardDescription>Operational roles, departments and compensation</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {employees.length === 0 ? (
            <div className="py-12 text-center text-stone-400 text-xs">
              No employees registered yet. Click &quot;Add Employee&quot; to seed initial staff.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 font-semibold">
                    <th className="py-2.5 px-3">Code</th>
                    <th className="py-2.5 px-3">Employee Name</th>
                    <th className="py-2.5 px-3">Department / Team</th>
                    <th className="py-2.5 px-3">Role</th>
                    <th className="py-2.5 px-3">Phone</th>
                    <th className="py-2.5 px-3 text-right">Monthly Salary</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {employees.map((e) => (
                    <tr key={e.id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="py-3 px-3 font-mono text-stone-500">{e.employee_code || 'EMP'}</td>
                      <td className="py-3 px-3 font-medium text-stone-900">{e.name}</td>
                      <td className="py-3 px-3 text-stone-700">
                        {e.department_name || 'General'} {e.team_name && `• ${e.team_name}`}
                      </td>
                      <td className="py-3 px-3 text-stone-800 font-medium">{e.role_name || 'Staff'}</td>
                      <td className="py-3 px-3 text-stone-600">{e.phone || '—'}</td>
                      <td className="py-3 px-3 text-right font-medium text-stone-900">
                        {formatINR(Number(e.monthly_salary))}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <Badge variant={e.employment_status === 'Active' ? 'success' : 'outline'}>
                          {e.employment_status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-base font-bold text-stone-900">Add New Employee</h2>
              <button onClick={() => setShowAddModal(false)} className="text-stone-400 hover:text-stone-700 text-lg">✕</button>
            </div>

            <form onSubmit={handleAddEmployee} className="space-y-3">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rajesh Kumar"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Contact Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 9876543210"
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Department</label>
                  <select
                    value={departmentId}
                    onChange={(e) => {
                      setDepartmentId(e.target.value);
                      setTeamId('');
                      setRoleId('');
                    }}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  >
                    <option value="">Select Dept...</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Team</label>
                  <select
                    value={teamId}
                    onChange={(e) => {
                      setTeamId(e.target.value);
                      setRoleId('');
                    }}
                    className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                  >
                    <option value="">Select Team...</option>
                    {filteredTeams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Designated Role</label>
                <select
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 focus:outline-none"
                >
                  <option value="">Select Role...</option>
                  {filteredRoles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Monthly Salary (₹)</label>
                <input
                  type="number"
                  step="100"
                  value={salary}
                  onChange={(e) => setSalary(parseFloat(e.target.value) || 0)}
                  placeholder="18000"
                  required
                  className="w-full rounded-md border border-stone-300 p-2 text-stone-900 font-bold focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button type="submit" variant="amber" disabled={saving}>
                  {saving ? 'Saving...' : 'Add Employee'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
