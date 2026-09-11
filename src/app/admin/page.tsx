'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import { OrgHierarchyModal } from '@/components/admin/OrgHierarchyModal';
import { UnitModal } from '@/components/admin/UnitModal';
import { VendorCategoryModal } from '@/components/vendors/VendorCategoryModal';
import { InventoryCategoryModal } from '@/components/inventory/InventoryCategoryModal';
import { ActivityMasterModal } from '@/components/activities/ActivityMasterModal';
import { UserManagementModal } from '@/components/admin/UserManagementModal';
import { DeleteUserModal } from '@/components/admin/DeleteUserModal';
import { RolePermissionMatrix } from '@/components/admin/RolePermissionMatrix';
import { AuditLogsViewer } from '@/components/admin/AuditLogsViewer';
import { logAuditAction } from '@/lib/audit-logger';
import {
  Settings,
  Shield,
  Plus,
  RefreshCw,
  Network,
  Scale,
  Tag,
  CreditCard,
  Building2,
  Users2,
  Layers,
  Sparkles,
  History,
  UtensilsCrossed,
  UserCheck,
  Edit2,
  Power,
  Trash2
} from 'lucide-react';

export default function AdminSettingsPage() {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<'masters' | 'cost_rules' | 'targets' | 'users' | 'audit'>('masters');

  const [departments, setDepartments] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [employeeRoles, setEmployeeRoles] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [vendorCategories, setVendorCategories] = useState<any[]>([]);
  const [inventoryCategories, setInventoryCategories] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [costRules, setCostRules] = useState<any[]>([]);
  const [targets, setTargets] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgModalTab, setOrgModalTab] = useState<'departments' | 'teams' | 'roles'>('departments');
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [vendorCategoryModalOpen, setVendorCategoryModalOpen] = useState(false);
  const [inventoryCategoryModalOpen, setInventoryCategoryModalOpen] = useState(false);
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<any | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [
        { data: dData },
        { data: tData },
        { data: erData },
        { data: uData },
        { data: vcData },
        { data: pmData },
        { data: crData },
        { data: tgData },
        { data: rData },
        { data: icData },
        { data: pData },
      ] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('teams').select('*').order('name'),
        supabase.from('employee_roles').select('*').order('name'),
        supabase.from('units').select('*').order('name'),
        supabase.from('vendor_categories').select('*').order('name'),
        supabase.from('payment_methods').select('*').order('name'),
        supabase.from('financial_cost_rules').select('*').order('cost_name'),
        supabase.from('financial_targets').select('*').order('weekday'),
        supabase.from('roles').select('*').order('name'),
        supabase.from('inventory_categories').select('*').order('name'),
        supabase.from('profiles').select('*, role:roles(id, name)').order('full_name'),
      ]);

      setDepartments(dData || []);
      setTeams(tData || []);
      setEmployeeRoles(erData || []);
      setUnits(uData || []);
      setVendorCategories(vcData || []);
      setPaymentMethods(pmData || []);
      setCostRules(crData || []);
      setTargets(tgData || []);
      setRoles(rData || []);
      setInventoryCategories(icData || []);
      setProfiles(pData || []);
    } catch (err: any) {
      console.error('Error loading admin masters:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Settings className="h-6 w-6 text-amber-600" />
            System Administration &amp; Master Configuration
          </h1>
          <p className="text-sm text-stone-500">
            Configure operational master data, cost rules, targets, roles, and business structures without code changes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} title="Refresh configuration">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-stone-200 gap-6 text-sm font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab('masters')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'masters'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Operational Masters
        </button>
        <button
          onClick={() => setActiveTab('cost_rules')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'cost_rules'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Financial Cost Rules
        </button>
        <button
          onClick={() => setActiveTab('targets')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'targets'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          Daily &amp; Break-Even Targets
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'users'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          User Accounts &amp; RBAC ({profiles.length})
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-3 border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'audit'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-stone-500 hover:text-stone-700'
          }`}
        >
          System Audit Trail
        </button>
      </div>

      {/* TAB 1: OPERATIONAL MASTERS */}
      {activeTab === 'masters' && (
        <div className="space-y-6">
          {/* Quick Actions Bar */}
          <div className="flex flex-wrap items-center gap-2 bg-stone-50 p-3 rounded-xl border border-stone-200">
            <span className="text-xs font-bold text-stone-700 mr-2">Configure Masters:</span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setOrgModalTab('teams');
                setOrgModalOpen(true);
              }}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
            >
              <UtensilsCrossed className="h-4 w-4" /> Kitchen Sections &amp; Teams ({teams.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOrgModalTab('departments');
                setOrgModalOpen(true);
              }}
              className="gap-1.5 bg-white text-stone-700 hover:bg-stone-100"
            >
              <Network className="h-4 w-4 text-stone-500" /> Depts &amp; Roles
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInventoryCategoryModalOpen(true)}
              className="gap-1.5 bg-white text-stone-700 hover:bg-stone-100"
            >
              <Layers className="h-4 w-4 text-stone-500" /> Inventory Categories ({inventoryCategories.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActivityModalOpen(true)}
              className="gap-1.5 bg-white text-stone-700 hover:bg-stone-100"
            >
              <Sparkles className="h-4 w-4 text-stone-500" /> Activity Master
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUnitModalOpen(true)}
              className="gap-1.5 bg-white text-stone-700 hover:bg-stone-100"
            >
              <Scale className="h-4 w-4 text-stone-500" /> Units ({units.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVendorCategoryModalOpen(true)}
              className="gap-1.5 bg-white text-stone-700 hover:bg-stone-100"
            >
              <Tag className="h-4 w-4 text-stone-500" /> Vendor Categories ({vendorCategories.length})
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Org Structure Summary */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-amber-600" />
                    Organizational Structure
                  </CardTitle>
                  <CardDescription>Departments, operational teams, and roles</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOrgModalTab('departments');
                    setOrgModalOpen(true);
                  }}
                  className="h-7 text-xs"
                >
                  Manage
                </Button>
              </CardHeader>
              <CardContent className="pt-0 space-y-3 text-xs">
                <div className="grid grid-cols-3 gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-100 text-center">
                  <div>
                    <div className="font-bold text-base text-stone-900">{departments.length}</div>
                    <div className="text-[10px] text-stone-500">Departments</div>
                  </div>
                  <div>
                    <div className="font-bold text-base text-stone-900">{teams.length}</div>
                    <div className="text-[10px] text-stone-500">Teams</div>
                  </div>
                  <div>
                    <div className="font-bold text-base text-stone-900">{employeeRoles.length}</div>
                    <div className="text-[10px] text-stone-500">Roles</div>
                  </div>
                </div>

                <div className="divide-y divide-stone-100 max-h-48 overflow-y-auto pr-1">
                  {departments.map((d) => {
                    const dTeams = teams.filter((t) => t.department_id === d.id);
                    return (
                      <div key={d.id} className="py-2 flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-stone-900">{d.name}</span>
                          <span className="text-[10px] text-stone-400 ml-1.5">
                            ({dTeams.length} {dTeams.length === 1 ? 'team' : 'teams'})
                          </span>
                        </div>
                        <Badge variant={d.is_active !== false ? 'success' : 'outline'}>
                          {d.is_active !== false ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Units of Measurement */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Scale className="h-4 w-4 text-amber-600" />
                    Units of Measurement
                  </CardTitle>
                  <CardDescription>Authoritative metrics for store SKU inventory</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUnitModalOpen(true)}
                  className="h-7 text-xs"
                >
                  Manage
                </Button>
              </CardHeader>
              <CardContent className="pt-0 text-xs">
                {units.length === 0 ? (
                  <div className="py-6 text-center text-stone-400">No units defined.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto py-1">
                    {units.map((u) => (
                      <div
                        key={u.id}
                        className={`px-2.5 py-1 rounded-md border flex items-center gap-1.5 ${
                          u.is_active !== false
                            ? 'bg-stone-50 border-stone-200 text-stone-800'
                            : 'bg-stone-100/50 border-stone-200/50 text-stone-400 line-through'
                        }`}
                      >
                        <span className="font-semibold">{u.symbol}</span>
                        <span className="text-[10px] text-stone-500">({u.name})</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Vendor Categories */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Tag className="h-4 w-4 text-amber-600" />
                    Vendor Supplier Categories
                  </CardTitle>
                  <CardDescription>Procurement classifications for vendor onboarding</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVendorCategoryModalOpen(true)}
                  className="h-7 text-xs"
                >
                  Manage
                </Button>
              </CardHeader>
              <CardContent className="pt-0 text-xs">
                {vendorCategories.length === 0 ? (
                  <div className="py-6 text-center text-stone-400">No categories defined.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto py-1">
                    {vendorCategories.map((vc) => (
                      <div
                        key={vc.id}
                        className={`px-2.5 py-1 rounded-md border flex items-center gap-1.5 ${
                          vc.is_active !== false
                            ? 'bg-amber-50/60 border-amber-200/80 text-stone-800'
                            : 'bg-stone-100/50 border-stone-200/50 text-stone-400 line-through'
                        }`}
                      >
                        <span className="font-medium">{vc.name}</span>
                        {vc.code && <span className="text-[10px] text-stone-400 font-mono">[{vc.code}]</span>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Payment Methods */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-amber-600" />
                    Payment Methods &amp; Commissions
                  </CardTitle>
                  <CardDescription>Gateway and card merchant discount rates (MDR)</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {loading ? (
                  <div className="py-8 text-center text-stone-400 text-xs">Loading payment methods...</div>
                ) : (
                  <div className="divide-y divide-stone-100 text-xs max-h-56 overflow-y-auto">
                    {paymentMethods.map((pm) => (
                      <div key={pm.id} className="py-2 flex items-center justify-between">
                        <span className="font-semibold text-stone-900">{pm.name}</span>
                        <span className="text-stone-600 font-mono">MDR: {pm.commission_percent}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Master Modals */}
          <OrgHierarchyModal
            isOpen={orgModalOpen}
            onClose={() => setOrgModalOpen(false)}
            defaultTab={orgModalTab}
            onUpdated={loadData}
          />

          <UnitModal
            isOpen={unitModalOpen}
            onClose={() => setUnitModalOpen(false)}
            onUpdated={loadData}
          />

          <VendorCategoryModal
            isOpen={vendorCategoryModalOpen}
            onClose={() => setVendorCategoryModalOpen(false)}
            onUpdated={loadData}
          />
        </div>
      )}

      {/* TAB 2: COST RULES */}
      {activeTab === 'cost_rules' && (
        <Card>
          <CardHeader>
            <CardTitle>Financial Cost Rule Master</CardTitle>
            <CardDescription>Configurable calculation methods (Fixed, % Revenue, Variable, Metered)</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading cost rules...
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Cost Name</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3 text-right">Amount / Rate</th>
                      <th className="py-2.5 px-3 text-center">Class</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {costRules.map((cr) => (
                      <tr key={cr.id} className="hover:bg-stone-50/80">
                        <td className="py-3 px-3 font-semibold text-stone-900">{cr.cost_name}</td>
                        <td className="py-3 px-3 text-stone-600">{cr.category}</td>
                        <td className="py-3 px-3 text-stone-700 font-mono">{cr.calculation_method}</td>
                        <td className="py-3 px-3 text-right font-bold text-stone-900">
                          {cr.calculation_method === 'percentage_of_revenue'
                            ? `${(Number(cr.amount_or_rate || 0) * 100).toFixed(1)}%`
                            : formatINR(Number(cr.amount_or_rate || 0))}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <Badge variant={cr.cost_classification === 'Fixed' ? 'info' : 'warning'}>
                            {cr.cost_classification}
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
      )}

      {/* TAB 3: TARGETS */}
      {activeTab === 'targets' && (
        <Card>
          <CardHeader>
            <CardTitle>Operational Daily &amp; Planning Targets</CardTitle>
            <CardDescription>Configured by day of the week to align highway rush expectations</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading targets...
              </div>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3">Target Scope</th>
                      <th className="py-2.5 px-3">Day / Type</th>
                      <th className="py-2.5 px-3 text-right">Configured Target Value</th>
                      <th className="py-2.5 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {targets.map((tg) => (
                      <tr key={tg.id} className="hover:bg-stone-50/80">
                        <td className="py-3 px-3 font-semibold text-stone-900 font-mono">{tg.target_type}</td>
                        <td className="py-3 px-3 text-stone-700 font-medium">
                          {tg.weekday !== null ? weekdayNames[tg.weekday] : 'Facility Level'}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-amber-700 text-sm">
                          {tg.target_type === 'visitor_spend'
                            ? `${formatINR(Number(tg.target_value))} / visitor`
                            : formatINR(Number(tg.target_value))}
                        </td>
                        <td className="py-3 px-3 text-stone-500">{tg.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 4: USERS & RBAC ROLES */}
      {activeTab === 'users' && (
        <div className="space-y-6">
          {/* User Accounts Card */}
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-amber-600" />
                  System User Accounts ({profiles.length})
                </CardTitle>
                <CardDescription>
                  Operational staff and administrative accounts permitted to authenticate and perform actions
                </CardDescription>
              </div>
              <Button
                variant="amber"
                size="sm"
                onClick={() => {
                  setEditingUser(null);
                  setUserModalOpen(true);
                }}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" /> Add System User
              </Button>
            </CardHeader>

            <CardContent className="pt-0">
              {loading ? (
                <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading user accounts...
                </div>
              ) : profiles.length === 0 ? (
                <div className="py-8 text-center text-stone-400 text-xs">No user accounts found.</div>
              ) : (
                <div className="overflow-x-auto text-xs">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                        <th className="py-2.5 px-3">User</th>
                        <th className="py-2.5 px-3">Contact</th>
                        <th className="py-2.5 px-3">Assigned Role</th>
                        <th className="py-2.5 px-3 text-center">Status</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {profiles.map((p) => {
                        const isActive = p.is_active !== false;
                        return (
                          <tr
                            key={p.id}
                            className={`hover:bg-stone-50/80 transition-colors ${
                              !isActive ? 'opacity-60 bg-stone-50/40' : ''
                            }`}
                          >
                            <td className="py-3 px-3">
                              <div className="font-bold text-stone-900">{p.full_name}</div>
                              <div className="text-[11px] text-stone-500 font-mono">{p.email}</div>
                            </td>
                            <td className="py-3 px-3 text-stone-600 font-mono">
                              {p.phone || '—'}
                            </td>
                            <td className="py-3 px-3">
                              <Badge variant="outline" className="font-semibold text-stone-800">
                                {p.role?.name || 'Unassigned'}
                              </Badge>
                            </td>
                            <td className="py-3 px-3 text-center">
                              {isActive ? (
                                <Badge variant="success">Active</Badge>
                              ) : (
                                <Badge variant="outline">Inactive</Badge>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditingUser(p);
                                    setUserModalOpen(true);
                                  }}
                                  className="h-7 px-2 text-stone-600 hover:text-stone-900"
                                  title="Edit user details"
                                >
                                  <Edit2 className="h-3.5 w-3.5 mr-1" />
                                  <span>Edit</span>
                                </Button>
                                <Button
                                  variant={isActive ? 'secondary' : 'amber'}
                                  size="sm"
                                  onClick={async () => {
                                    const nextStatus = !isActive;
                                    try {
                                      const res = await fetch('/api/admin/users', {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ userId: p.id, isActive: nextStatus }),
                                      });
                                      const result = await res.json();
                                      if (!res.ok) {
                                        alert(result.error || 'Failed to update user status');
                                        return;
                                      }
                                      loadData();
                                    } catch (err: any) {
                                      alert('Failed to update status: ' + err.message);
                                    }
                                  }}
                                  className="h-7 px-2 text-[11px]"
                                >
                                  {isActive ? 'Deactivate' : 'Activate'}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setUserToDelete(p);
                                    setDeleteModalOpen(true);
                                  }}
                                  className="h-7 px-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 hover:text-red-700 transition-colors"
                                  title="Delete user account"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                                  <span>Delete</span>
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

          {/* Dynamic RBAC Role & Permission Management Matrix */}
          <RolePermissionMatrix
            roles={roles}
            onPermissionsUpdated={loadData}
          />
        </div>
      )}

      {/* TAB 5: CENTRAL AUDIT TRAIL */}
      {activeTab === 'audit' && <AuditLogsViewer />}

      {/* MODALS */}
      <OrgHierarchyModal
        isOpen={orgModalOpen}
        onClose={() => setOrgModalOpen(false)}
        defaultTab={orgModalTab}
        onUpdated={loadData}
      />
      <UnitModal
        isOpen={unitModalOpen}
        onClose={() => setUnitModalOpen(false)}
        onUpdated={loadData}
      />
      <VendorCategoryModal
        isOpen={vendorCategoryModalOpen}
        onClose={() => setVendorCategoryModalOpen(false)}
        onUpdated={loadData}
      />
      <InventoryCategoryModal
        isOpen={inventoryCategoryModalOpen}
        onClose={() => setInventoryCategoryModalOpen(false)}
        onUpdated={loadData}
      />
      <ActivityMasterModal
        isOpen={activityModalOpen}
        onClose={() => setActivityModalOpen(false)}
        onUpdated={loadData}
      />
      <UserManagementModal
        isOpen={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        user={editingUser}
        roles={roles}
        onSaved={loadData}
      />
      <DeleteUserModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setUserToDelete(null);
        }}
        user={userToDelete}
        onDeleted={loadData}
      />
    </div>
  );
}

