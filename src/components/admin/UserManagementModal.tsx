'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { logAuditAction } from '@/lib/audit-logger';
import { X, UserPlus, Edit2, Shield, AlertCircle } from 'lucide-react';

interface Role {
  id: string;
  name: string;
  description: string;
}

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role_id?: string | null;
  is_active: boolean;
  role?: { id: string; name: string };
}

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: UserProfile | null;
  roles: Role[];
  onSaved?: () => void;
}

export function UserManagementModal({
  isOpen,
  onClose,
  user,
  roles,
  onSaved,
}: UserManagementModalProps) {
  const supabase = createClient();
  const isEdit = Boolean(user?.id);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roleId, setRoleId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      if (user) {
        setFullName(user.full_name || '');
        setEmail(user.email || '');
        setPhone(user.phone || '');
        setRoleId(user.role_id || '');
        setIsActive(user.is_active !== false);
      } else {
        setFullName('');
        setEmail('');
        setPhone('');
        setRoleId(roles[0]?.id || '');
        setIsActive(true);
      }
    }
  }, [isOpen, user, roles]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setErrorMessage('Full name is required.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('A valid email address is required.');
      return;
    }
    if (!roleId) {
      setErrorMessage('Please assign a role to this user.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || null,
        role_id: roleId,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      };

      if (isEdit && user) {
        const { error } = await supabase
          .from('profiles')
          .update(payload)
          .eq('id', user.id);
        if (error) throw error;

        await logAuditAction({
          action: 'UPDATE',
          entityType: 'profiles',
          entityId: user.id,
          oldValues: user,
          newValues: payload,
        });
      } else {
        const newId = crypto.randomUUID();
        const { data, error } = await supabase
          .from('profiles')
          .insert({
            id: newId,
            ...payload,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (error) throw error;

        await logAuditAction({
          action: 'CREATE',
          entityType: 'profiles',
          entityId: data?.id,
          newValues: payload,
        });
      }

      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save user account.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-stone-50/50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-lg">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">
                {isEdit ? 'Edit System User' : 'Add New System User'}
              </h2>
              <p className="text-[11px] text-stone-500">
                Configure account identity, operational role, and system access
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

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div>
            <label className="block text-stone-700 font-medium mb-1">Full Name *</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Ramesh Kumar"
              required
              className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-stone-700 font-medium mb-1">Email Address *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@ghoomaryatra.com"
              required
              className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-stone-700 font-medium mb-1">Mobile Phone (Optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98XXXXXXXX"
              className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-stone-700 font-medium mb-1">Assigned Role *</label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              required
              className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 bg-white focus:outline-none focus:border-amber-500"
            >
              <option value="">Select Role...</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.description}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-stone-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded text-amber-600 focus:ring-amber-500 border-stone-300"
              />
              <span className="font-medium">Active Account (Permit sign-in and authorization)</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-stone-200">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="amber" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Update User' : 'Create User'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
