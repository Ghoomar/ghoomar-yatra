'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { X, UserPlus, Edit2, Shield, AlertCircle, Eye, EyeOff, KeyRound, Sparkles } from 'lucide-react';

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
  const isEdit = Boolean(user?.id);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roleId, setRoleId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setShowPassword(false);
      if (user) {
        setFullName(user.full_name || '');
        setEmail(user.email || '');
        setPhone(user.phone || '');
        setRoleId(user.role_id || '');
        setIsActive(user.is_active !== false);
        setPassword('');
      } else {
        setFullName('');
        setEmail('');
        setPhone('');
        setRoleId(roles[0]?.id || '');
        setIsActive(true);
        setPassword('');
      }
    }
  }, [isOpen, user, roles]);

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
    let result = '';
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(result);
    setShowPassword(true);
  };

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
      setErrorMessage('Please assign an operational role to this user.');
      return;
    }
    if (!isEdit && (!password || password.length < 6)) {
      setErrorMessage('An initial password of at least 6 characters is required.');
      return;
    }
    if (isEdit && password && password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      if (isEdit && user) {
        const res = await fetch('/api/admin/users', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            fullName: fullName.trim(),
            phone: phone.trim() || null,
            roleId,
            isActive,
            newPassword: password.trim() || undefined,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to update user account.');
        }
      } else {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: fullName.trim(),
            email: email.trim().toLowerCase(),
            phone: phone.trim() || null,
            roleId,
            isActive,
            password: password.trim(),
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to provision user account.');
        }
      }

      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while saving.');
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
                {isEdit ? 'Edit System User' : 'Provision New System User'}
              </h2>
              <p className="text-[11px] text-stone-500">
                Configure account identity, operational role, and Supabase Auth credentials
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
              <span className="leading-relaxed">{errorMessage}</span>
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
              className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 bg-white"
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
              disabled={isEdit}
              className={`w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 ${
                isEdit ? 'bg-stone-100 text-stone-500 cursor-not-allowed' : 'bg-white'
              }`}
            />
            {isEdit && (
              <span className="text-[10px] text-stone-400 mt-0.5 block">Email address cannot be modified after creation.</span>
            )}
          </div>

          <div>
            <label className="block text-stone-700 font-medium mb-1">Mobile Phone (Optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98XXXXXXXX"
              className="w-full rounded-lg border border-stone-300 p-2 text-stone-900 focus:outline-none focus:border-amber-500 bg-white"
            />
          </div>

          <div>
            <label className="block text-stone-700 font-medium mb-1">Assigned Operational Role *</label>
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

          {/* Password Field */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-stone-700 font-medium">
                {isEdit ? 'Reset Password (Optional)' : 'Initial Password *'}
              </label>
              {!isEdit && (
                <button
                  type="button"
                  onClick={generateRandomPassword}
                  className="text-[11px] text-amber-600 hover:text-amber-700 font-semibold flex items-center gap-1"
                >
                  <Sparkles className="h-3 w-3" /> Generate Secure
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEdit ? 'Leave blank to keep existing password' : '••••••••'}
                required={!isEdit}
                minLength={6}
                className="w-full rounded-lg border border-stone-300 p-2 pr-9 text-stone-900 focus:outline-none focus:border-amber-500 bg-white font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <span className="text-[10px] text-stone-400 mt-0.5 block">
              {isEdit
                ? 'Only enter a password if you want to reset the user credentials.'
                : 'Initial password provisioned directly into Supabase Auth.'}
            </span>
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
              {saving ? 'Processing...' : isEdit ? 'Update Account' : 'Provision User'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
