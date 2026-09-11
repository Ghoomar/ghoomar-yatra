'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAppRole } from '@/components/layout/AppShell';
import { saveDeviceEnrollment } from '@/lib/gate/offline-store';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { ShieldCheck, Lock, User, AlertCircle, RefreshCw, Car } from 'lucide-react';
import { RoleName } from '@/lib/types/database';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { setRole } = useAppRole();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('error') === 'deactivated') {
      setError('This account has been deactivated. Please contact your system administrator.');
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) {
      setError('Please enter your email/phone and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Resolve email if user entered 10-digit phone number
      let emailToAuth = identifier.trim();
      if (!emailToAuth.includes('@') && /^\d{10}$/.test(emailToAuth)) {
        if (emailToAuth === '9760372337') {
          emailToAuth = 'jayveer9760372337@gmail.com';
        } else {
          // Look up email in profiles table by phone
          const { data: profByPhone } = await supabase
            .from('profiles')
            .select('email')
            .eq('phone', emailToAuth)
            .maybeSingle();
          if (profByPhone?.email) {
            emailToAuth = profByPhone.email;
          }
        }
      }

      // 2. Authenticate against Supabase Auth
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: emailToAuth,
        password: password.trim(),
      });

      if (authErr) {
        if (authErr.message?.toLowerCase().includes('banned') || authErr.message?.toLowerCase().includes('disabled')) {
          throw new Error('This account has been deactivated. Please contact your system administrator.');
        }
        throw new Error(authErr.message || 'Invalid credentials.');
      }

      const user = authData.user;
      if (!user) {
        throw new Error('Authentication failed.');
      }

      // 3. Fetch profile and role
      const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('*, role:roles!profiles_role_id_fkey(name)')
        .eq('id', user.id)
        .maybeSingle();

      if (profErr || !profile) {
        await supabase.auth.signOut();
        throw new Error('User profile record not found. Please contact an administrator.');
      }

      // Enforce active account status
      if (profile.is_active === false) {
        await supabase.auth.signOut();
        throw new Error('This account has been deactivated. Please contact your system administrator.');
      }

      const userRole: RoleName = profile?.role?.name || 'Gate Staff';

      // 4. If Gate Staff, perform Device Enrollment for offline authorization
      if (userRole === 'Gate Staff') {
        const deviceId = crypto.randomUUID();
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';
        const deviceName = userAgent.includes('Android') ? 'Android Gate Device' : 'Gate Mobile Device';

        // Register in gate_device_authorizations on server
        await supabase.from('gate_device_authorizations').upsert(
          {
            device_id: deviceId,
            device_name: deviceName,
            user_id: user.id,
            role: 'Gate Staff',
            is_active: true,
            enrolled_at: new Date().toISOString(),
          },
          { onConflict: 'device_id' }
        );

        // Save enrollment token into IndexedDB for offline operation
        await saveDeviceEnrollment({
          deviceId,
          role: 'Gate Staff',
          userEmail: user.email || emailToAuth,
          userId: user.id,
          status: 'active',
          enrolledAt: new Date().toISOString(),
        });

        // Precache the gate counter shell in Service Worker Cache
        if (typeof window !== 'undefined' && 'caches' in window) {
          caches.open('ghoomar-gate-v1').then((cache) => {
            fetch('/operations/gate').then((res) => {
              if (res.status === 200) cache.put('/operations/gate', res);
            }).catch(() => {});
          });
        }

        setRole('Gate Staff');
        router.push('/operations/gate');
        return;
      }

      // 5. If Admin or other roles, set role and route to dashboard
      setRole(userRole);
      router.push('/dashboard');
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl border-stone-200">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 mb-3 shadow-xs">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl font-black text-stone-900 tracking-tight">
            Ghoomar Yatra Internal Login
          </CardTitle>
          <CardDescription className="text-xs text-stone-500 mt-1">
            Sign in to access Command Center or provision Gate Counter device for offline operations.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Email or Phone Number
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g. 9760372337 or user@ghoomarthali.in"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-stone-300 focus:outline-none focus:border-amber-500 bg-white"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-stone-300 focus:outline-none focus:border-amber-500 bg-white"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="amber"
              className="w-full justify-center py-2.5 text-xs font-bold gap-2 mt-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" /> Verifying Credentials...
                </>
              ) : (
                'Sign In & Enroll Device'
              )}
            </Button>
          </form>

          <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-[11px] text-stone-400">
            <span>Yatra Gate Security Protocol</span>
            <span className="flex items-center gap-1 text-emerald-600 font-medium">
              <Car className="h-3 w-3" /> Offline PWA Compatible
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="p-4 bg-white border border-stone-200 rounded-2xl shadow-lg flex items-center gap-2 text-xs text-stone-600">
          <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading authentication portal...
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
