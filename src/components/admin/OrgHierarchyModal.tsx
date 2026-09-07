'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { Department, Team, EmployeeRole } from '@/lib/types/database';
import { X, Plus, Edit2, Check, Power, AlertCircle, RefreshCw, Network, ChevronRight } from 'lucide-react';

interface OrgHierarchyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  defaultTab?: 'departments' | 'teams' | 'roles';
}

export function OrgHierarchyModal({
  isOpen,
  onClose,
  onUpdated,
  defaultTab = 'departments',
}: OrgHierarchyModalProps) {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<'departments' | 'teams' | 'roles'>(defaultTab);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Department Form
  const [deptId, setDeptId] = useState<string | null>(null);
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');

  // Team Form
  const [teamFormId, setTeamFormId] = useState<string | null>(null);
  const [teamDeptId, setTeamDeptId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamCode, setTeamCode] = useState('');

  // Role Form
  const [roleFormId, setRoleFormId] = useState<string | null>(null);
  const [roleTeamId, setRoleTeamId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleCanReceiveIssues, setRoleCanReceiveIssues] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [{ data: dData }, { data: tData }, { data: rData }] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('teams').select('*, department:departments(id, name)').order('name'),
        supabase
          .from('employee_roles')
          .select('*, team:teams(id, name, department_id, department:departments(id, name))')
          .order('name'),
      ]);

      setDepartments(dData || []);
      setTeams(tData || []);
      setRoles(rData || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load organization hierarchy.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      setActiveTab(defaultTab);
      resetForms();
    }
  }, [isOpen, defaultTab]);

  const resetForms = () => {
    setDeptId(null);
    setDeptName('');
    setDeptCode('');

    setTeamFormId(null);
    setTeamDeptId('');
    setTeamName('');
    setTeamCode('');

    setRoleFormId(null);
    setRoleTeamId('');
    setRoleName('');
    setRoleCanReceiveIssues(false);
    setErrorMessage(null);
  };

  // Department Handlers
  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptName.trim()) return;
    setSaving(true);
    try {
      if (deptId) {
        const { error } = await supabase
          .from('departments')
          .update({ name: deptName.trim(), code: deptCode.trim() || null })
          .eq('id', deptId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('departments').insert({
          name: deptName.trim(),
          code: deptCode.trim() || null,
          is_active: true,
        });
        if (error) throw error;
      }
      resetForms();
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save department.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDept = async (d: Department) => {
    try {
      const { error } = await supabase
        .from('departments')
        .update({ is_active: !d.is_active })
        .eq('id', d.id);
      if (error) throw error;
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update department status.');
    }
  };

  // Team Handlers
  const handleSaveTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim() || !teamDeptId) return;
    setSaving(true);
    try {
      if (teamFormId) {
        const { error } = await supabase
          .from('teams')
          .update({
            department_id: teamDeptId,
            name: teamName.trim(),
            code: teamCode.trim() || null,
          })
          .eq('id', teamFormId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('teams').insert({
          department_id: teamDeptId,
          name: teamName.trim(),
          code: teamCode.trim() || null,
          is_active: true,
        });
        if (error) throw error;
      }
      resetForms();
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save team.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleTeam = async (t: Team) => {
    try {
      const { error } = await supabase
        .from('teams')
        .update({ is_active: !t.is_active })
        .eq('id', t.id);
      if (error) throw error;
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update team status.');
    }
  };

  // Role Handlers
  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName.trim() || !roleTeamId) return;
    setSaving(true);
    try {
      if (roleFormId) {
        const { error } = await supabase
          .from('employee_roles')
          .update({
            team_id: roleTeamId,
            name: roleName.trim(),
            can_receive_store_issues: roleCanReceiveIssues,
          })
          .eq('id', roleFormId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('employee_roles').insert({
          team_id: roleTeamId,
          name: roleName.trim(),
          can_receive_store_issues: roleCanReceiveIssues,
          is_active: true,
        });
        if (error) throw error;
      }
      resetForms();
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save role.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRole = async (r: EmployeeRole) => {
    try {
      const { error } = await supabase
        .from('employee_roles')
        .update({ is_active: !r.is_active })
        .eq('id', r.id);
      if (error) throw error;
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update role status.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-stone-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">Organization Structure Master</h2>
              <p className="text-xs text-stone-500">
                Manage Departments → Teams/Functions → Operational Roles &amp; Capabilities
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

        {/* Tab Selector */}
        <div className="flex border-b border-stone-200 px-6 bg-stone-50/50 text-xs font-semibold gap-6">
          <button
            onClick={() => {
              setActiveTab('departments');
              resetForms();
            }}
            className={`py-3 border-b-2 transition-colors ${
              activeTab === 'departments'
                ? 'border-amber-600 text-amber-700'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            1. Departments ({departments.length})
          </button>
          <button
            onClick={() => {
              setActiveTab('teams');
              resetForms();
            }}
            className={`py-3 border-b-2 transition-colors ${
              activeTab === 'teams'
                ? 'border-amber-600 text-amber-700'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            2. Teams &amp; Functions ({teams.length})
          </button>
          <button
            onClick={() => {
              setActiveTab('roles');
              resetForms();
            }}
            className={`py-3 border-b-2 transition-colors ${
              activeTab === 'roles'
                ? 'border-amber-600 text-amber-700'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            3. Operational Roles ({roles.length})
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* TAB 1: DEPARTMENTS */}
          {activeTab === 'departments' && (
            <div className="space-y-4">
              <form
                onSubmit={handleSaveDepartment}
                className="p-4 bg-stone-50 rounded-lg border border-stone-200 space-y-3"
              >
                <div className="font-semibold text-stone-800 flex items-center justify-between">
                  <span>{deptId ? 'Edit Department' : 'Add Department'}</span>
                  {deptId && (
                    <button
                      type="button"
                      onClick={resetForms}
                      className="text-stone-500 text-[11px] underline"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">
                      Department Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={deptName}
                      onChange={(e) => setDeptName(e.target.value)}
                      placeholder="e.g. Kitchen & Production"
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">Code</label>
                    <input
                      type="text"
                      value={deptCode}
                      onChange={(e) => setDeptCode(e.target.value)}
                      placeholder="e.g. KITCHEN"
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Button type="submit" variant="amber" size="sm" disabled={saving}>
                    {saving ? 'Saving...' : deptId ? 'Save Changes' : '+ Add Department'}
                  </Button>
                </div>
              </form>

              <div className="divide-y divide-stone-100 border rounded-lg overflow-hidden bg-white">
                {departments.map((d) => (
                  <div
                    key={d.id}
                    className={`p-3 flex items-center justify-between hover:bg-stone-50/80 transition-colors ${
                      !d.is_active ? 'opacity-60 bg-stone-50/50' : ''
                    }`}
                  >
                    <div>
                      <span className="font-semibold text-stone-900 mr-2">{d.name}</span>
                      {d.code && (
                        <span className="font-mono text-stone-500 text-[11px] bg-stone-100 px-1.5 py-0.5 rounded">
                          {d.code}
                        </span>
                      )}
                      <Badge variant={d.is_active ? 'success' : 'default'} className="ml-2">
                        {d.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setDeptId(d.id);
                          setDeptName(d.name);
                          setDeptCode(d.code || '');
                        }}
                        className="p-1.5 rounded text-stone-500 hover:text-amber-600 hover:bg-stone-100"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleDept(d)}
                        className={`p-1.5 rounded ${
                          d.is_active ? 'text-stone-400 hover:text-rose-600' : 'text-stone-400 hover:text-emerald-600'
                        }`}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: TEAMS */}
          {activeTab === 'teams' && (
            <div className="space-y-4">
              <form
                onSubmit={handleSaveTeam}
                className="p-4 bg-stone-50 rounded-lg border border-stone-200 space-y-3"
              >
                <div className="font-semibold text-stone-800 flex items-center justify-between">
                  <span>{teamFormId ? 'Edit Team' : 'Add Team'}</span>
                  {teamFormId && (
                    <button
                      type="button"
                      onClick={resetForms}
                      className="text-stone-500 text-[11px] underline"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">
                      Parent Department <span className="text-rose-500">*</span>
                    </label>
                    <select
                      required
                      value={teamDeptId}
                      onChange={(e) => setTeamDeptId(e.target.value)}
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="">Select Department...</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">
                      Team Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="e.g. North Indian Kitchen"
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">Code</label>
                    <input
                      type="text"
                      value={teamCode}
                      onChange={(e) => setTeamCode(e.target.value)}
                      placeholder="e.g. NIK"
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Button type="submit" variant="amber" size="sm" disabled={saving}>
                    {saving ? 'Saving...' : teamFormId ? 'Save Changes' : '+ Add Team'}
                  </Button>
                </div>
              </form>

              <div className="divide-y divide-stone-100 border rounded-lg overflow-hidden bg-white">
                {teams.map((t) => (
                  <div
                    key={t.id}
                    className={`p-3 flex items-center justify-between hover:bg-stone-50/80 transition-colors ${
                      !t.is_active ? 'opacity-60 bg-stone-50/50' : ''
                    }`}
                  >
                    <div>
                      <span className="text-stone-500 text-[11px] mr-1">
                        {t.department?.name || 'Dept'} &rarr;
                      </span>
                      <span className="font-semibold text-stone-900 mr-2">{t.name}</span>
                      {t.code && (
                        <span className="font-mono text-stone-500 text-[11px] bg-stone-100 px-1.5 py-0.5 rounded">
                          {t.code}
                        </span>
                      )}
                      <Badge variant={t.is_active ? 'success' : 'default'} className="ml-2">
                        {t.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setTeamFormId(t.id);
                          setTeamDeptId(t.department_id);
                          setTeamName(t.name);
                          setTeamCode(t.code || '');
                        }}
                        className="p-1.5 rounded text-stone-500 hover:text-amber-600 hover:bg-stone-100"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleTeam(t)}
                        className={`p-1.5 rounded ${
                          t.is_active ? 'text-stone-400 hover:text-rose-600' : 'text-stone-400 hover:text-emerald-600'
                        }`}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: ROLES */}
          {activeTab === 'roles' && (
            <div className="space-y-4">
              <form
                onSubmit={handleSaveRole}
                className="p-4 bg-stone-50 rounded-lg border border-stone-200 space-y-3"
              >
                <div className="font-semibold text-stone-800 flex items-center justify-between">
                  <span>{roleFormId ? 'Edit Operational Role' : 'Add Operational Role'}</span>
                  {roleFormId && (
                    <button
                      type="button"
                      onClick={resetForms}
                      className="text-stone-500 text-[11px] underline"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">
                      Assigned Team <span className="text-rose-500">*</span>
                    </label>
                    <select
                      required
                      value={roleTeamId}
                      onChange={(e) => setRoleTeamId(e.target.value)}
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="">Select Team...</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.department?.name ? `${t.department.name} • ` : ''}
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">
                      Role Title <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={roleName}
                      onChange={(e) => setRoleName(e.target.value)}
                      placeholder="e.g. Head Chef, Captain, Cook"
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-200/80 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-stone-800">
                      Can Receive Store Issues (Kitchen/Raw Materials)
                    </div>
                    <div className="text-[11px] text-stone-500">
                      When enabled, active employees with this role appear in the Store Issue &quot;Responsible Chef&quot; selector.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={roleCanReceiveIssues}
                    onChange={(e) => setRoleCanReceiveIssues(e.target.checked)}
                    className="h-4 w-4 text-amber-600 rounded border-stone-300 focus:ring-amber-500 cursor-pointer"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <Button type="submit" variant="amber" size="sm" disabled={saving}>
                    {saving ? 'Saving...' : roleFormId ? 'Save Changes' : '+ Add Role'}
                  </Button>
                </div>
              </form>

              <div className="divide-y divide-stone-100 border rounded-lg overflow-hidden bg-white">
                {roles.map((r) => (
                  <div
                    key={r.id}
                    className={`p-3 flex items-center justify-between hover:bg-stone-50/80 transition-colors ${
                      !r.is_active ? 'opacity-60 bg-stone-50/50' : ''
                    }`}
                  >
                    <div>
                      <span className="text-stone-500 text-[11px] mr-1">
                        {r.team?.department?.name || 'Dept'} &rarr; {r.team?.name || 'Team'} &rarr;
                      </span>
                      <span className="font-semibold text-stone-900 mr-2">{r.name}</span>
                      {r.can_receive_store_issues && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200">
                          Store Issue Receiver
                        </span>
                      )}
                      <Badge variant={r.is_active ? 'success' : 'default'} className="ml-2">
                        {r.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRoleFormId(r.id);
                          setRoleTeamId(r.team_id);
                          setRoleName(r.name);
                          setRoleCanReceiveIssues(Boolean(r.can_receive_store_issues));
                        }}
                        className="p-1.5 rounded text-stone-500 hover:text-amber-600 hover:bg-stone-100"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleRole(r)}
                        className={`p-1.5 rounded ${
                          r.is_active ? 'text-stone-400 hover:text-rose-600' : 'text-stone-400 hover:text-emerald-600'
                        }`}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 flex justify-end bg-stone-50">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
