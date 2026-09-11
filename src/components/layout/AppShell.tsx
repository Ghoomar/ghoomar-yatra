'use client';

import React, { useState, createContext, useContext, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/navigation/Sidebar';
import { Header } from '@/components/navigation/Header';
import { RoleName } from '@/lib/types/database';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { getDeviceEnrollment } from '@/lib/gate/offline-store';

interface RoleContextType {
  role: RoleName;
  setRole: (role: RoleName) => void;
}

const RoleContext = createContext<RoleContextType>({
  role: 'Admin',
  setRole: () => {},
});

export const useAppRole = () => useContext(RoleContext);

export function AppShell({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<RoleName>('Admin');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Gesture state refs
  const touchStartX = React.useRef<number | null>(null);
  const touchStartY = React.useRef<number | null>(null);
  const touchStartTime = React.useRef<number>(0);
  const isEdgeSwipe = React.useRef<boolean>(false);
  const isCloseSwipe = React.useRef<boolean>(false);

  useEffect(() => {
    const saved = localStorage.getItem('ghoomar_active_role') as RoleName;
    if (saved) {
      setRole(saved);
    } else {
      getDeviceEnrollment()
        .then((enrollment) => {
          if (enrollment && enrollment.status === 'active') {
            setRole('Gate Staff');
            localStorage.setItem('ghoomar_active_role', 'Gate Staff');
          }
        })
        .catch(() => {});
    }
  }, []);

  // Strict Route Protection for Gate Staff: Access restricted solely to /operations/gate
  useEffect(() => {
    if (role === 'Gate Staff') {
      if (pathname !== '/operations/gate' && pathname !== '/login') {
        router.replace('/operations/gate');
      }
    }
  }, [role, pathname, router]);

  // Global Edge Swipe Navigation Handler
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (window.innerWidth >= 1024) return; // Desktop uses persistent sidebar
      const touch = e.touches[0];
      if (!touch) return;

      const x = touch.clientX;
      const y = touch.clientY;
      touchStartX.current = x;
      touchStartY.current = y;
      touchStartTime.current = Date.now();

      // Modestly increased activation zone (first 44px from left edge) to avoid Android system back gesture collision
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

      // Quick-trigger open if horizontal movement >= 65px and predominantly horizontal (avoids vertical scroll conflict)
      if (isEdgeSwipe.current && deltaX >= 65 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        setSidebarOpen(true);
        isEdgeSwipe.current = false;
      }

      // Quick-trigger close if horizontal swipe <= -50px while open
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

    const handleTouchCancel = () => {
      touchStartX.current = null;
      touchStartY.current = null;
      isEdgeSwipe.current = false;
      isCloseSwipe.current = false;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [sidebarOpen]);

  const handleRoleChange = (newRole: RoleName) => {
    // Gate Staff cannot elevate perspective without re-authenticating
    if (role === 'Gate Staff' && newRole !== 'Gate Staff') {
      return;
    }
    setRole(newRole);
    localStorage.setItem('ghoomar_active_role', newRole);
  };

  // If on login route, render standalone clean layout without sidebar & header
  if (pathname === '/login') {
    return (
      <RoleContext.Provider value={{ role, setRole: handleRoleChange }}>
        <ServiceWorkerRegister />
        <main className="min-h-screen bg-stone-100/70 text-stone-900 flex flex-col justify-center">
          {children}
        </main>
      </RoleContext.Provider>
    );
  }

  return (
    <RoleContext.Provider value={{ role, setRole: handleRoleChange }}>
      <ServiceWorkerRegister />
      <div className="min-h-screen bg-stone-100/70 text-stone-900">
        <Sidebar
          currentRole={role}
          onRoleChange={handleRoleChange}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className="lg:pl-64 flex flex-col min-h-screen">
          <Header
            currentRole={role}
            onRoleChange={handleRoleChange}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
          <main className="flex-1 p-3 sm:p-4 md:p-6 max-w-7xl w-full mx-auto min-w-0">
            {children}
          </main>
        </div>
      </div>
    </RoleContext.Provider>
  );
}
