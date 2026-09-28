'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { Department, Team, EmployeeRole } from '@/lib/types/database';
import { useI18n } from '@/lib/i18n/context';
import { getLocalizedMasterName } from '@/lib/i18n/master-data';
import { BilingualNameInput } from '@/components/admin/BilingualNameInput';
import { X, Edit2, Power, AlertCircle, Network, Trash2 } from 'lucide-react';

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
  const { locale } = useI18n();
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
  const [deptNameHi, setDeptNameHi] = useState('');
  const [deptCode, setDeptCode] = useState('');

  // Team Form
  const [teamFormId, setTeamFormId] = useState<string | null>(null);
  const [teamDeptId, setTeamDeptId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamNameHi, setTeamNameHi] = useState('');
  const [teamCode, setTeamCode] = useState('');

  // Role Form
  const [roleFormId, setRoleFormId] = useState<string | null>(null);
  const [roleTeamId, setRoleTeamId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleNameHi, setRoleNameHi] = useState('');
  const [roleCanReceiveIssues, setRoleCanReceiveIssues] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [{ data: dData }, { data: tData }, { data: rData }] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('teams').select('*, department:departments(id, name, name_hi)').order('name'),
        supabase
          .from('employee_roles')
          .select('*, team:teams(id, name, name_hi, department_id, department:departments(id, name, name_hi))')
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
    setDeptNameHi('');
    setDeptCode('');

    setTeamFormId(null);
    setTeamDeptId('');
    setTeamName('');
    setTeamNameHi('');
    setTeamCode('');

    setRoleFormId(null);
    setRoleTeamId('');
    setRoleName('');
    setRoleNameHi('');
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
          .update({
            name: deptName.trim(),
            name_hi: deptNameHi.trim() || null,
            code: deptCode.trim() || null,
          })
          .eq('id', deptId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('departments').insert({
          name: deptName.trim(),
          name_hi: deptNameHi.trim() || null,
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

  const handleDeleteDept = async (d: Department) => {
    const confirmMsg =
      locale === 'hi'
        ? `क्या आप वाकई "${getLocalizedMasterName(d, locale)}" विभाग को हटाना चाहते हैं?`
        : `Are you sure you want to delete department "${d.name}"?`;
    if (!confirm(confirmMsg)) return;
    try {
      const { error } = await supabase.from('departments').delete().eq('id', d.id);
      if (error) throw error;
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(
        locale === 'hi'
          ? 'विभाग हटाया नहीं जा सकता। यदि इसमें टीमें या कर्मचारी जुड़े हैं, तो इसे निष्क्रिय करें।'
          : (err.message || 'Cannot delete department. Please deactivate it instead if it has linked teams or employees.')
      );
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
            name_hi: teamNameHi.trim() || null,
            code: teamCode.trim() || null,
          })
          .eq('id', teamFormId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('teams').insert({
          department_id: teamDeptId,
          name: teamName.trim(),
          name_hi: teamNameHi.trim() || null,
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

  const handleDeleteTeam = async (t: Team) => {
    const confirmMsg =
      locale === 'hi'
        ? `क्या आप वाकई "${getLocalizedMasterName(t, locale)}" टीम को हटाना चाहते हैं?`
        : `Are you sure you want to delete kitchen section/team "${t.name}"?`;
    if (!confirm(confirmMsg)) return;
    try {
      const { error } = await supabase.from('teams').delete().eq('id', t.id);
      if (error) throw error;
      loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(
        locale === 'hi'
          ? 'टीम हटाई नहीं जा सकती। यदि इसमें कर्मचारी या सामग्री निकासी जुड़ी है, तो इसे निष्क्रिय करें।'
          : (err.message || 'Cannot delete team. Please deactivate it instead if it has linked employees or store issues.')
      );
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
            name_hi: roleNameHi.trim() || null,
            can_receive_store_issues: roleCanReceiveIssues,
          })
          .eq('id', roleFormId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('employee_roles').insert({
          team_id: roleTeamId,
          name: roleName.trim(),
          name_hi: roleNameHi.trim() || null,
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
              <h2 className="text-base font-bold text-stone-900">
                {locale === 'hi' ? 'संगठनात्मक ढांचा मास्टर' : 'Organization Structure Master'}
              </h2>
              <p className="text-xs text-stone-500">
                {locale === 'hi'
                  ? 'विभाग → टीमें/कार्य → परिचालन भूमिकाएँ व अनुमतियाँ प्रबंधित करें'
                  : 'Manage Departments → Teams/Functions → Operational Roles & Capabilities'}
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
            {locale === 'hi' ? `1. विभाग (${departments.length})` : `1. Departments (${departments.length})`}
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
            {locale === 'hi' ? `2. टीमें व कार्य (${teams.length})` : `2. Teams & Functions (${teams.length})`}
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
            {locale === 'hi' ? `3. परिचालन भूमिकाएँ (${roles.length})` : `3. Operational Roles (${roles.length})`}
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
                  <span>
                    {deptId
                      ? locale === 'hi' ? 'विभाग संपादित करें' : 'Edit Department'
                      : locale === 'hi' ? 'नया विभाग जोड़ें' : 'Add Department'}
                  </span>
                  {deptId && (
                    <button
                      type="button"
                      onClick={resetForms}
                      className="text-stone-500 text-[11px] underline"
                    >
                      {locale === 'hi' ? 'रद्द करें' : 'Cancel'}
                    </button>
                  )}
                </div>
                <BilingualNameInput
                  englishName={deptName}
                  onChangeEnglish={setDeptName}
                  hindiName={deptNameHi}
                  onChangeHindi={(val) => setDeptNameHi(val)}
                  entityType="department"
                  englishLabel={locale === 'hi' ? 'विभाग का नाम (अंग्रेज़ी)' : 'Department Name (English)'}
                  hindiLabel={locale === 'hi' ? 'विभाग का नाम (हिंदी)' : 'Department Name (Hindi)'}
                  placeholderEnglish="e.g. Kitchen & Production"
                  placeholderHindi="उदा. रसोई एवं उत्पादन"
                  required
                />
                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    {locale === 'hi' ? 'कोड' : 'Code'}
                  </label>
                  <input
                    type="text"
                    value={deptCode}
                    onChange={(e) => setDeptCode(e.target.value)}
                    placeholder="e.g. KITCHEN"
                    className="w-full sm:w-1/3 rounded-md border border-stone-300 p-2 text-stone-900 bg-white font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <Button type="submit" variant="amber" size="sm" disabled={saving}>
                    {saving
                      ? locale === 'hi' ? 'सहेजा जा रहा है...' : 'Saving...'
                      : deptId
                      ? locale === 'hi' ? 'बदलाव सहेजें' : 'Save Changes'
                      : locale === 'hi' ? '+ विभाग जोड़ें' : '+ Add Department'}
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
                      <span className="font-semibold text-stone-900 mr-2">
                        {getLocalizedMasterName(d, locale)}
                      </span>
                      {locale === 'hi' && d.name_hi && (
                        <span className="text-stone-400 text-[11px] mr-2">({d.name})</span>
                      )}
                      {d.code && (
                        <span className="font-mono text-stone-500 text-[11px] bg-stone-100 px-1.5 py-0.5 rounded">
                          {d.code}
                        </span>
                      )}
                      <Badge variant={d.is_active ? 'success' : 'default'} className="ml-2">
                        {d.is_active
                          ? locale === 'hi' ? 'सक्रिय' : 'Active'
                          : locale === 'hi' ? 'निष्क्रिय' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setDeptId(d.id);
                          setDeptName(d.name);
                          setDeptNameHi(d.name_hi || '');
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
                        title={
                          d.is_active
                            ? locale === 'hi' ? 'विभाग निष्क्रिय करें' : 'Deactivate department'
                            : locale === 'hi' ? 'विभाग सक्रिय करें' : 'Activate department'
                        }
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDept(d)}
                        className="p-1.5 rounded text-stone-400 hover:text-rose-600 hover:bg-stone-100"
                        title={locale === 'hi' ? 'विभाग हटाएं' : 'Delete department'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
                  <span>
                    {teamFormId
                      ? locale === 'hi' ? 'टीम संपादित करें' : 'Edit Team'
                      : locale === 'hi' ? 'नई टीम जोड़ें' : 'Add Team'}
                  </span>
                  {teamFormId && (
                    <button
                      type="button"
                      onClick={resetForms}
                      className="text-stone-500 text-[11px] underline"
                    >
                      {locale === 'hi' ? 'रद्द करें' : 'Cancel'}
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">
                      {locale === 'hi' ? 'मूल विभाग' : 'Parent Department'}{' '}
                      <span className="text-rose-500">*</span>
                    </label>
                    <select
                      required
                      value={teamDeptId}
                      onChange={(e) => setTeamDeptId(e.target.value)}
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="">{locale === 'hi' ? 'विभाग चुनें...' : 'Select Department...'}</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {getLocalizedMasterName(d, locale)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <BilingualNameInput
                    englishName={teamName}
                    onChangeEnglish={setTeamName}
                    hindiName={teamNameHi}
                    onChangeHindi={(val) => setTeamNameHi(val)}
                    entityType="department"
                    englishLabel={locale === 'hi' ? 'टीम का नाम (अंग्रेज़ी)' : 'Team Name (English)'}
                    hindiLabel={locale === 'hi' ? 'टीम का नाम (हिंदी)' : 'Team Name (Hindi)'}
                    placeholderEnglish="e.g. North Indian Kitchen"
                    placeholderHindi="उदा. नॉर्थ इंडियन किचन"
                    required
                  />
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">
                      {locale === 'hi' ? 'कोड' : 'Code'}
                    </label>
                    <input
                      type="text"
                      value={teamCode}
                      onChange={(e) => setTeamCode(e.target.value)}
                      placeholder="e.g. NIK"
                      className="w-full sm:w-1/3 rounded-md border border-stone-300 p-2 text-stone-900 bg-white font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Button type="submit" variant="amber" size="sm" disabled={saving}>
                    {saving
                      ? locale === 'hi' ? 'सहेजा जा रहा है...' : 'Saving...'
                      : teamFormId
                      ? locale === 'hi' ? 'बदलाव सहेजें' : 'Save Changes'
                      : locale === 'hi' ? '+ टीम जोड़ें' : '+ Add Team'}
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
                        {getLocalizedMasterName(t.department, locale) || (locale === 'hi' ? 'विभाग' : 'Dept')} &rarr;
                      </span>
                      <span className="font-semibold text-stone-900 mr-2">
                        {getLocalizedMasterName(t, locale)}
                      </span>
                      {locale === 'hi' && t.name_hi && (
                        <span className="text-stone-400 text-[11px] mr-2">({t.name})</span>
                      )}
                      {t.code && (
                        <span className="font-mono text-stone-500 text-[11px] bg-stone-100 px-1.5 py-0.5 rounded">
                          {t.code}
                        </span>
                      )}
                      <Badge variant={t.is_active ? 'success' : 'default'} className="ml-2">
                        {t.is_active
                          ? locale === 'hi' ? 'सक्रिय' : 'Active'
                          : locale === 'hi' ? 'निष्क्रिय' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setTeamFormId(t.id);
                          setTeamDeptId(t.department_id);
                          setTeamName(t.name);
                          setTeamNameHi(t.name_hi || '');
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
                        title={
                          t.is_active
                            ? locale === 'hi' ? 'टीम निष्क्रिय करें' : 'Deactivate section'
                            : locale === 'hi' ? 'टीम सक्रिय करें' : 'Activate section'
                        }
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTeam(t)}
                        className="p-1.5 rounded text-stone-400 hover:text-rose-600 hover:bg-stone-100"
                        title={locale === 'hi' ? 'टीम हटाएं' : 'Delete section'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
                  <span>
                    {roleFormId
                      ? locale === 'hi' ? 'परिचालन भूमिका संपादित करें' : 'Edit Operational Role'
                      : locale === 'hi' ? 'नई परिचालन भूमिका जोड़ें' : 'Add Operational Role'}
                  </span>
                  {roleFormId && (
                    <button
                      type="button"
                      onClick={resetForms}
                      className="text-stone-500 text-[11px] underline"
                    >
                      {locale === 'hi' ? 'रद्द करें' : 'Cancel'}
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block font-medium text-stone-700 mb-1">
                      {locale === 'hi' ? 'निर्धारित टीम' : 'Assigned Team'}{' '}
                      <span className="text-rose-500">*</span>
                    </label>
                    <select
                      required
                      value={roleTeamId}
                      onChange={(e) => setRoleTeamId(e.target.value)}
                      className="w-full rounded-md border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="">{locale === 'hi' ? 'टीम चुनें...' : 'Select Team...'}</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {getLocalizedMasterName(t.department, locale)
                            ? `${getLocalizedMasterName(t.department, locale)} • `
                            : ''}
                          {getLocalizedMasterName(t, locale)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <BilingualNameInput
                    englishName={roleName}
                    onChangeEnglish={setRoleName}
                    hindiName={roleNameHi}
                    onChangeHindi={(val) => setRoleNameHi(val)}
                    entityType="role"
                    englishLabel={locale === 'hi' ? 'भूमिका का नाम (अंग्रेज़ी)' : 'Role Title (English)'}
                    hindiLabel={locale === 'hi' ? 'भूमिका का नाम (हिंदी)' : 'Role Title (Hindi)'}
                    placeholderEnglish="e.g. Head Chef, Captain, Cook"
                    placeholderHindi="उदा. हेड शेफ, कैप्टन, कुक"
                    required
                  />
                </div>

                <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-200/80 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-stone-800">
                      {locale === 'hi'
                        ? 'स्टोर से सामग्री ले सकते हैं (रसोई/कच्चा माल)'
                        : 'Can Receive Store Issues (Kitchen/Raw Materials)'}
                    </div>
                    <div className="text-[11px] text-stone-500">
                      {locale === 'hi'
                        ? 'सक्रिय होने पर, इस भूमिका के कर्मचारी स्टोर निकासी में "जिम्मेदार शेफ" चयनकर्ता में दिखेंगे।'
                        : 'When enabled, active employees with this role appear in the Store Issue "Responsible Chef" selector.'}
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
                    {saving
                      ? locale === 'hi' ? 'सहेजा जा रहा है...' : 'Saving...'
                      : roleFormId
                      ? locale === 'hi' ? 'बदलाव सहेजें' : 'Save Changes'
                      : locale === 'hi' ? '+ भूमिका जोड़ें' : '+ Add Role'}
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
                        {getLocalizedMasterName(r.team?.department, locale) || (locale === 'hi' ? 'विभाग' : 'Dept')} &rarr;{' '}
                        {getLocalizedMasterName(r.team, locale) || (locale === 'hi' ? 'टीम' : 'Team')} &rarr;
                      </span>
                      <span className="font-semibold text-stone-900 mr-2">
                        {getLocalizedMasterName(r, locale)}
                      </span>
                      {locale === 'hi' && r.name_hi && (
                        <span className="text-stone-400 text-[11px] mr-2">({r.name})</span>
                      )}
                      {r.can_receive_store_issues && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200">
                          {locale === 'hi' ? 'स्टोर निकासी प्राप्तकर्ता' : 'Store Issue Receiver'}
                        </span>
                      )}
                      <Badge variant={r.is_active ? 'success' : 'default'} className="ml-2">
                        {r.is_active
                          ? locale === 'hi' ? 'सक्रिय' : 'Active'
                          : locale === 'hi' ? 'निष्क्रिय' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRoleFormId(r.id);
                          setRoleTeamId(r.team_id);
                          setRoleName(r.name);
                          setRoleNameHi(r.name_hi || '');
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
                        title={
                          r.is_active
                            ? locale === 'hi' ? 'भूमिका निष्क्रिय करें' : 'Deactivate role'
                            : locale === 'hi' ? 'भूमिका सक्रिय करें' : 'Activate role'
                        }
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
            {locale === 'hi' ? 'पूर्ण' : 'Done'}
          </Button>
        </div>
      </div>
    </div>
  );
}
