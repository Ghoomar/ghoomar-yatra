'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { MODULE_CATEGORIES } from '@/lib/rbac';
import { 
  Shield, 
  Check, 
  AlertCircle, 
  RefreshCw, 
  Save, 
  Lock, 
  CheckSquare, 
  Square,
  Sparkles,
  Info
} from 'lucide-react';

interface Role {
  id: string;
  name: string;
  description: string;
  is_system?: boolean;
}

interface Permission {
  id: string;
  module: string;
  action: string;
  code: string;
  description: string;
}

interface RolePermissionMatrixProps {
  roles: Role[];
  onPermissionsUpdated?: () => void;
}

export function RolePermissionMatrix({ roles, onPermissionsUpdated }: RolePermissionMatrixProps) {
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePermissionsMap, setRolePermissionsMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchMatrix = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/roles/permissions');
      if (!res.ok) throw new Error('Failed to load role permissions matrix');
      const data = await res.json();

      setPermissions(data.permissions || []);

      // Build map: role_id -> array of permission_ids
      const map: Record<string, string[]> = {};
      (data.roles || []).forEach((r: Role) => {
        map[r.id] = [];
      });
      (data.role_permissions || []).forEach((rp: { role_id: string; permission_id: string }) => {
        if (!map[rp.role_id]) map[rp.role_id] = [];
        map[rp.role_id].push(rp.permission_id);
      });
      setRolePermissionsMap(map);

      if (!selectedRoleId && data.roles && data.roles.length > 0) {
        // Default to Cashier or Admin for clear demonstration
        const cashier = data.roles.find((r: Role) => r.name === 'Cashier');
        setSelectedRoleId(cashier ? cashier.id : data.roles[0].id);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Error loading permissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatrix();
  }, []);

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const currentAssignedPermIds = rolePermissionsMap[selectedRoleId] || [];

  const handleTogglePermission = (permId: string) => {
    if (!selectedRoleId) return;
    const perm = permissions.find((p) => p.id === permId);

    // Safeguard: Do not allow unchecking admin.manage for Admin role
    if (selectedRole?.name === 'Admin' && perm?.code === 'admin.manage') {
      return;
    }

    setRolePermissionsMap((prev) => {
      const current = prev[selectedRoleId] || [];
      const updated = current.includes(permId)
        ? current.filter((id) => id !== permId)
        : [...current, permId];
      return { ...prev, [selectedRoleId]: updated };
    });
    setSaveSuccess(false);
  };

  const handleSelectAll = () => {
    if (!selectedRoleId) return;
    setRolePermissionsMap((prev) => ({
      ...prev,
      [selectedRoleId]: permissions.map((p) => p.id),
    }));
    setSaveSuccess(false);
  };

  const handleDeselectAll = () => {
    if (!selectedRoleId) return;
    let newPerms: string[] = [];
    // If Admin role, preserve admin.manage
    if (selectedRole?.name === 'Admin') {
      const adminManage = permissions.find((p) => p.code === 'admin.manage');
      if (adminManage) newPerms = [adminManage.id];
    }
    setRolePermissionsMap((prev) => ({
      ...prev,
      [selectedRoleId]: newPerms,
    }));
    setSaveSuccess(false);
  };

  const handleSavePermissions = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    setErrorMessage(null);
    setSaveSuccess(false);

    try {
      const res = await fetch('/api/admin/roles/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleId: selectedRoleId,
          permissionIds: currentAssignedPermIds,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update permissions');
      }

      setSaveSuccess(true);
      if (onPermissionsUpdated) onPermissionsUpdated();
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  // Group permissions by module
  const groupedPermissions: Record<string, Permission[]> = {};
  permissions.forEach((perm) => {
    if (!groupedPermissions[perm.module]) {
      groupedPermissions[perm.module] = [];
    }
    groupedPermissions[perm.module].push(perm);
  });

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading Role-Based Access Control matrix...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-xs border-stone-200">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-stone-900">
              <Shield className="h-5 w-5 text-amber-600" />
              Dynamic Role &amp; Permission Management
            </CardTitle>
            <CardDescription className="text-xs text-stone-500 mt-0.5">
              Authoritative database RBAC matrix. Configure operational capabilities, navigation visibility, and page access for each role.
            </CardDescription>
          </div>
          <Button
            variant="amber"
            size="sm"
            onClick={handleSavePermissions}
            disabled={saving}
            className="gap-2 shrink-0 font-bold"
          >
            {saving ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" /> Saving Matrix...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save Permissions
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-0">
        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {saveSuccess && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 animate-fadeIn">
            <Check className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="font-semibold">
              Permissions successfully saved for {selectedRole?.name}! Updates take effect immediately across all sessions.
            </span>
          </div>
        )}

        {/* Role Selector Tabs */}
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-2">
            Select Role to Configure:
          </label>
          <div className="flex flex-wrap gap-1.5 p-1.5 bg-stone-100 rounded-xl border border-stone-200">
            {roles.map((r) => {
              const isSelected = r.id === selectedRoleId;
              const count = rolePermissionsMap[r.id]?.length || 0;
              return (
                <button
                  key={r.id}
                  onClick={() => {
                    setSelectedRoleId(r.id);
                    setSaveSuccess(false);
                    setErrorMessage(null);
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2 ${
                    isSelected
                      ? 'bg-white text-stone-950 font-bold shadow-xs border border-stone-200/80'
                      : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                  }`}
                >
                  <span>{r.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      isSelected
                        ? 'bg-amber-100 text-amber-800 font-semibold'
                        : 'bg-stone-200 text-stone-600'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Role Overview Bar */}
        {selectedRole && (
          <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-stone-900 text-sm">{selectedRole.name}</span>
                {selectedRole.is_system && (
                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-800 bg-amber-50">
                    System Core Role
                  </Badge>
                )}
              </div>
              <p className="text-stone-500 text-[11px] mt-0.5">{selectedRole.description}</p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-stone-600 font-medium text-xs">
                Active: <strong className="text-stone-900">{currentAssignedPermIds.length}</strong> / {permissions.length}
              </span>
              <div className="h-4 w-px bg-stone-300 mx-1 hidden sm:block" />
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-[11px] text-amber-700 hover:text-amber-800 font-semibold flex items-center gap-1 hover:underline"
              >
                <CheckSquare className="h-3.5 w-3.5" /> All
              </button>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="text-[11px] text-stone-500 hover:text-stone-700 font-semibold flex items-center gap-1 hover:underline ml-2"
              >
                <Square className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
          </div>
        )}

        {/* Permissions Grid Grouped by Category */}
        <div className="space-y-4">
          {Object.entries(groupedPermissions).map(([moduleKey, perms]) => {
            const meta = MODULE_CATEGORIES[moduleKey] || { label: moduleKey, icon: 'Shield' };
            const enabledCount = perms.filter((p) => currentAssignedPermIds.includes(p.id)).length;

            return (
              <div
                key={moduleKey}
                className="border border-stone-200 rounded-xl overflow-hidden bg-white shadow-2xs"
              >
                {/* Module Header */}
                <div className="bg-stone-50/80 px-4 py-2.5 border-b border-stone-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-stone-900 tracking-wide uppercase">
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-stone-500 font-mono">({moduleKey})</span>
                  </div>
                  <span className="text-[11px] font-semibold text-stone-500">
                    {enabledCount} of {perms.length} active
                  </span>
                </div>

                {/* Module Permissions List */}
                <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {perms.map((perm) => {
                    const isChecked = currentAssignedPermIds.includes(perm.id);
                    const isProtectedAdminManage =
                      selectedRole?.name === 'Admin' && perm.code === 'admin.manage';

                    return (
                      <label
                        key={perm.id}
                        className={`
                          p-2.5 rounded-lg border text-xs flex items-start gap-2.5 transition-colors cursor-pointer select-none
                          ${
                            isChecked
                              ? 'bg-amber-50/60 border-amber-300 text-stone-900'
                              : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                          }
                          ${isProtectedAdminManage ? 'cursor-not-allowed opacity-90' : ''}
                        `}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isProtectedAdminManage}
                          onChange={() => handleTogglePermission(perm.id)}
                          className="h-4 w-4 mt-0.5 rounded text-amber-600 focus:ring-amber-500 border-stone-300"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-stone-900 leading-tight">
                              {perm.description}
                            </span>
                            {isProtectedAdminManage && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-800 bg-amber-100/80 px-1.5 py-0.2 rounded">
                                <Lock className="h-2.5 w-2.5" /> Core Lockout Protection
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-stone-400 font-mono mt-0.5">
                            code: {perm.code}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Save Bar */}
        <div className="pt-4 border-t border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
            <Info className="h-3.5 w-3.5 text-stone-400" />
            <span>Changes save directly to database table <code>role_permissions</code> and update user sessions in real-time.</span>
          </div>
          <Button
            variant="amber"
            size="sm"
            onClick={handleSavePermissions}
            disabled={saving}
            className="gap-2 font-bold shrink-0"
          >
            {saving ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save Permissions
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
