'use client';

import React, { useState, createContext, useContext, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/navigation/Sidebar';
import { Header } from '@/components/navigation/Header';
import { RoleName } from '@/lib/types/database';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { getDeviceEnrollment } from '@/lib/gate/offline-store';
import { createClient } from '@/lib/supabase/client';
import { hasPermission as evaluatePermission, getRequiredPermissionForPath } from '@/lib/rbac';
import { ShieldAlert, RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface RoleContextType {
  role: RoleName;
  actualRole: RoleName;
  user: any | null;
  profile: any | null;
  permissions: string[];
  hasPermission: (code: string) => boolean;
  loading: boolean;
  setRole: (role: RoleName) => void;
  signOut: () => Promise<void>;
}

const RoleContext = createContext<RoleContextType>({
  role: 'Viewer',
  actualRole: 'Viewer',
  user: null,
  profile: null,
  permissions: [],
  hasPermission: () => false,
  loading: true,
  setRole: () => {},
  signOut: async () => {},
});

export const useAppRole = () => useContext(RoleContext);

export function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const pathname = usePathname();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [actualRole, setActualRole] = useState<RoleName>('Viewer');
  const [activeRole, setActiveRole] = useState<RoleName>('Viewer');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [offlineGateMode, setOfflineGateMode] = useState(false);

  // Gesture state refs
  const touchStartX = React.useRef<number | null>(null);
  const touchStartY = React.useRef<number | null>(null);
  const isEdgeSwipe = React.useRef<boolean>(false);
  const isCloseSwipe = React.useRef<boolean>(false);

  const fetchRolePermissions = useCallback(async (roleId: string): Promise<string[]> => {
    try {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permissions(code)')
        .eq('role_id', roleId);

      if (error || !data) return [];
      return data
        .map((row: any) => row.permissions?.code)
        .filter(Boolean);
    } catch {
      return [];
    }
  }, [supabase]);

  const handleSignOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {}
    try {
      localStorage.removeItem('ghoomar_active_role');
      sessionStorage.clear();
    } catch {}
    window.location.replace('/login');
  }, [supabase]);

  // Global Auth Session & Profile Bootstrap
  useEffect(() => {
    let isMounted = true;

    async function checkAuthSession() {
      // 1. If on login page, skip blocking checks
      if (pathname === '/login') {
        if (isMounted) setLoading(false);
        return;
      }

      // 2. Offline Gate Counter check
      if (pathname === '/operations/gate') {
        try {
          const enrollment = await getDeviceEnrollment();
          if (enrollment && enrollment.status === 'active') {
            if (isMounted) {
              setOfflineGateMode(true);
              setActualRole('Gate Staff');
              setActiveRole('Gate Staff');
              setPermissions(['operations.gate']);
              setLoading(false);
            }
            return;
          }
        } catch {}
      }

      // 3. Normal Online Session Validation
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session?.user) {
          if (isMounted) {
            setLoading(true);
            router.replace('/login');
          }
          return;
        }

        const currentUser = session.user;

        // Fetch User Profile with Assigned Role
        const { data: userProfile, error: profErr } = await supabase
          .from('profiles')
          .select('*, role:roles(id, name, is_system)')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (profErr || !userProfile) {
          console.error('Failed to load profile:', profErr);
          if (isMounted) {
            await handleSignOut();
          }
          return;
        }

        // Deactivated user check: Immediately terminate and redirect
        if (userProfile.is_active === false) {
          if (isMounted) {
            await handleSignOut();
          }
          return;
        }

        const roleName = (userProfile.role?.name as RoleName) || 'Viewer';
        const rolePerms = await fetchRolePermissions(userProfile.role_id);

        if (isMounted) {
          setUser(currentUser);
          setProfile(userProfile);
          setActualRole(roleName);

          // Admin can switch perspectives for preview; normal staff stay strictly with assigned role
          const savedRole = localStorage.getItem('ghoomar_active_role') as RoleName;
          if (roleName === 'Admin' && savedRole) {
            setActiveRole(savedRole);
          } else {
            setActiveRole(roleName);
          }

          setPermissions(rolePerms);
          setLoading(false);
        }
      } catch (err) {
        console.error('Session validation error:', err);
        if (isMounted) {
          router.replace('/login');
        }
      }
    }

    checkAuthSession();

    // Listen to Supabase Auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        if (isMounted && pathname !== '/login' && !offlineGateMode) {
          window.location.replace('/login');
        }
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [pathname, router, supabase, fetchRolePermissions, handleSignOut, offlineGateMode]);

  // Strict Route Protection for Gate Staff: Access restricted solely to /operations/gate
  useEffect(() => {
    if (activeRole === 'Gate Staff') {
      if (pathname !== '/operations/gate' && pathname !== '/login') {
        router.replace('/operations/gate');
      }
    }
  }, [activeRole, pathname, router]);

  // Global Edge Swipe Navigation Handler
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (window.innerWidth >= 1024) return;
      const touch = e.touches[0];
      if (!touch) return;

      const x = touch.clientX;
      const y = touch.clientY;
      touchStartX.current = x;
      touchStartY.current = y;

      if (!sidebarOpen && x <= 44) {
        isEdgeSwipe.current = true;
        isCloseSwipe.current = false;
      } else if (sidebarOpen) {
        isEdgeSwipe.current = false;
        isCloseSwipe.current = true;
      } else {
        isEdgeSwipe.current = false;
        isCloseSwipe.current = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isEdgeSwipe.current && !isCloseSwipe.current) return;
      const touch = e.touches[0];
      if (!touch || touchStartX.current === null || touchStartY.current === null) return;

      const deltaX = touch.clientX - touchStartX.current;
      const deltaY = touch.clientY - touchStartY.current;

      if (isEdgeSwipe.current && deltaX >= 65 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        setSidebarOpen(true);
        isEdgeSwipe.current = false;
      }

      if (isCloseSwipe.current && deltaX <= -50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        setSidebarOpen(false);
        isCloseSwipe.current = false;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if ((isEdgeSwipe.current || isCloseSwipe.current) && touchStartX.current !== null && touchStartY.current !== null) {
        const touch = e.changedTouches[0];
        if (touch) {
          const deltaX = touch.clientX - touchStartX.current;
          const deltaY = touch.clientY - touchStartY.current;

          if (isEdgeSwipe.current && deltaX >= 65 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
            setSidebarOpen(true);
          } else if (isCloseSwipe.current && deltaX <= -50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
            setSidebarOpen(false);
          }
        }
      }
      touchStartX.current = null;
      touchStartY.current = null;
      isEdgeSwipe.current = false;
      isCloseSwipe.current = false;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [sidebarOpen]);

  const handleRoleChange = (newRole: RoleName) => {
    // Only Admin is allowed to switch perspectives for testing
    if (actualRole !== 'Admin') return;
    setActiveRole(newRole);
    localStorage.setItem('ghoomar_active_role', newRole);
  };

  const checkPermission = useCallback(
    (code: string) => {
      return evaluatePermission(activeRole, permissions, code);
    },
    [activeRole, permissions]
  );

  // If on login route, render standalone clean layout without sidebar & header
  if (pathname === '/login') {
    return (
      <RoleContext.Provider
        value={{
          role: activeRole,
          actualRole,
          user,
          profile,
          permissions,
          hasPermission: checkPermission,
          loading,
          setRole: handleRoleChange,
          signOut: handleSignOut,
        }}
      >
        <ServiceWorkerRegister />
        <main className="min-h-screen bg-stone-100/70 text-stone-900 flex flex-col justify-center">
          {children}
        </main>
      </RoleContext.Provider>
    );
  }

  // Loading state: strictly do NOT render AppShell or dashboard content
  if (loading) {
    return (
      <div className="min-h-screen bg-stone-900 flex flex-col items-center justify-center p-4 text-center">
        <div className="p-4 bg-stone-800 border border-stone-700 rounded-2xl shadow-2xl max-w-sm w-full flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-500">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
          <div>
            <div className="text-sm font-bold text-white tracking-wide">Ghoomar Yatra Security</div>
            <div className="text-xs text-stone-400 mt-0.5">Verifying authenticated session &amp; RBAC authorizations...</div>
          </div>
        </div>
      </div>
    );
  }

  // Direct URL route permission check
  const requiredPermission = getRequiredPermissionForPath(pathname);
  const isAuthorized = !requiredPermission || checkPermission(requiredPermission);

  return (
    <RoleContext.Provider
      value={{
        role: activeRole,
        actualRole,
        user,
        profile,
        permissions,
        hasPermission: checkPermission,
        loading,
        setRole: handleRoleChange,
        signOut: handleSignOut,
      }}
    >
      <ServiceWorkerRegister />
      <div className="min-h-screen bg-stone-100/70 text-stone-900">
        <Sidebar
          currentRole={activeRole}
          onRoleChange={handleRoleChange}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="lg:pl-64 flex flex-col min-h-screen">
          <Header
            currentRole={activeRole}
            actualRole={actualRole}
            onRoleChange={handleRoleChange}
            onOpenSidebar={() => setSidebarOpen(true)}
            onSignOut={handleSignOut}
          />
          <main className="flex-1 p-3 sm:p-4 md:p-6 max-w-7xl w-full mx-auto min-w-0">
            {!isAuthorized ? (
              <div className="min-h-[60vh] flex items-center justify-center">
                <div className="bg-white rounded-2xl border border-stone-200 shadow-xl p-8 max-w-md w-full text-center space-y-4">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                    <ShieldAlert className="h-8 w-8" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-stone-900">Access Restricted</h2>
                    <p className="text-xs text-stone-500 mt-1">
                      Your assigned role (<span className="font-semibold text-stone-700">{activeRole}</span>) does not have permission to access <span className="font-mono text-stone-700">{pathname}</span>.
                    </p>
                    <p className="text-[11px] text-stone-400 mt-2">
                      Required permission: <code className="bg-stone-100 px-1.5 py-0.5 rounded text-stone-600 font-mono">{requiredPermission}</code>
                    </p>
                  </div>
                  <div className="pt-2">
                    <Button
                      variant="amber"
                      size="sm"
                      onClick={() => router.push('/dashboard')}
                      className="gap-2 mx-auto"
                    >
                      <ArrowLeft className="h-4 w-4" /> Return to Command Center
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </RoleContext.Provider>
  );
}
