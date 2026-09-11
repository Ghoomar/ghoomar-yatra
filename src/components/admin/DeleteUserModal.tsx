'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import {
  X,
  Trash2,
  AlertTriangle,
  ShieldAlert,
  CheckCircle,
  RefreshCw,
  UserX,
  FileText,
} from 'lucide-react';

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role_id?: string | null;
  is_active: boolean;
  role?: { id: string; name: string };
}

interface DependencyItem {
  table: string;
  label: string;
  count: number;
}

interface DependencyCheckResult {
  canDelete: boolean;
  isSelf: boolean;
  isLastAdmin: boolean;
  dependencies: DependencyItem[];
  totalRecords: number;
  targetUser?: UserProfile;
  error?: string;
}

interface DeleteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile | null;
  onDeleted: () => void;
}

export function DeleteUserModal({
  isOpen,
  onClose,
  user,
  onDeleted,
}: DeleteUserModalProps) {
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [checkResult, setCheckResult] = useState<DependencyCheckResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && user?.id) {
      setLoading(true);
      setErrorMessage(null);
      setCheckResult(null);

      fetch(`/api/admin/users?checkDependencies=${encodeURIComponent(user.id)}`)
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Failed to check user dependencies.');
          }
          setCheckResult(data);
        })
        .catch((err) => {
          setErrorMessage(err.message || 'Error checking user dependencies.');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, user]);

  if (!isOpen || !user) return null;

  const handleDelete = async () => {
    setDeleting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete user.');
      }
      onDeleted();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while deleting the user.');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeactivate = async () => {
    setDeactivating(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, isActive: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to deactivate user.');
      }
      onDeleted();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while deactivating the user.');
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-red-100 bg-red-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-red-100 text-red-700 rounded-lg">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">Delete User Account</h2>
              <p className="text-[11px] text-stone-500">
                Permanently remove user credentials and account identity
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Target User Information Card */}
          <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-stone-900 text-sm">{user.full_name}</span>
                <span className="text-stone-500 font-mono text-[11px] block">{user.email}</span>
              </div>
              <span className="px-2 py-0.5 text-[11px] font-semibold bg-stone-200 text-stone-700 rounded-md">
                {user.role?.name || 'Unassigned'}
              </span>
            </div>
            {user.phone && (
              <div className="text-[11px] text-stone-500 font-mono">
                Phone: {user.phone}
              </div>
            )}
          </div>

          {/* Loading State */}
          {loading && (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-stone-500">
              <RefreshCw className="h-5 w-5 animate-spin text-amber-600" />
              <span>Checking account dependencies and business records...</span>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {!loading && checkResult && (
            <>
              {/* Scenario 1: Attempting to delete own account */}
              {checkResult.isSelf && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-amber-800">
                  <div className="flex items-center gap-2 font-bold text-amber-900">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    Self-Deletion Prevented
                  </div>
                  <p className="leading-relaxed">
                    You cannot delete your own account. Another System Administrator must manage this account.
                  </p>
                </div>
              )}

              {/* Scenario 2: Attempting to delete last active Admin */}
              {!checkResult.isSelf && checkResult.isLastAdmin && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-amber-800">
                  <div className="flex items-center gap-2 font-bold text-amber-900">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    Final Administrator Safeguard
                  </div>
                  <p className="leading-relaxed">
                    The final active Administrator cannot be deleted. Create or activate another Administrator first.
                  </p>
                </div>
              )}

              {/* Scenario 3: Has historical business records */}
              {!checkResult.isSelf && !checkResult.isLastAdmin && checkResult.dependencies.length > 0 && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl text-amber-900 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                      Cannot Delete: Historical Business Records Exist
                    </div>
                    <p className="leading-relaxed text-amber-800 text-[11px]">
                      This user cannot be permanently deleted because they have historical records associated with their account. Deactivate the user instead to revoke access while preserving financial, operational, and audit integrity.
                    </p>
                  </div>

                  <div className="border border-stone-200 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-stone-500" />
                        Associated Records ({checkResult.totalRecords})
                      </span>
                      <span className="text-stone-400">Strict Foreign Key Protection</span>
                    </div>
                    <div className="max-h-40 overflow-y-auto divide-y divide-stone-100">
                      {checkResult.dependencies.map((dep) => (
                        <div key={dep.table} className="px-3 py-2 flex items-center justify-between text-[11px]">
                          <span className="text-stone-700">{dep.label}</span>
                          <span className="font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            {dep.count} {dep.count === 1 ? 'record' : 'records'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Scenario 4: Eligible for permanent deletion */}
              {checkResult.canDelete && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-red-900">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                      Warning: Irreversible Action
                    </div>
                    <p className="leading-relaxed text-[11px]">
                      Permanent deletion will immediately remove this user's authentication credentials from Supabase Auth and delete their system profile.
                    </p>
                    <p className="font-semibold text-red-900 text-[11px]">
                      This action CANNOT be undone.
                    </p>
                  </div>

                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-[11px] flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span>0 historical business records found. This account is safe to permanently delete.</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-stone-200 bg-stone-50/50">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={deleting || deactivating}
          >
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            {!loading && checkResult && (
              <>
                {/* Deactivate User Instead button when dependencies exist */}
                {!checkResult.isSelf && !checkResult.isLastAdmin && checkResult.dependencies.length > 0 && (
                  <Button
                    type="button"
                    variant="amber"
                    onClick={handleDeactivate}
                    disabled={deactivating}
                    className="gap-1.5"
                  >
                    {deactivating ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserX className="h-4 w-4" />
                    )}
                    Deactivate User Instead
                  </Button>
                )}

                {/* Permanent Delete button when eligible */}
                {checkResult.canDelete && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {deleting ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Permanently Delete User
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
