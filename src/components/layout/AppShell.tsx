'use client';

import React, { useState, createContext, useContext, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/Sidebar';
import { Header } from '@/components/navigation/Header';
import { RoleName } from '@/lib/types/database';

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

  useEffect(() => {
    const saved = localStorage.getItem('ghoomar_active_role') as RoleName;
    if (saved) {
      setRole(saved);
    }
  }, []);

  const handleRoleChange = (newRole: RoleName) => {
    setRole(newRole);
    localStorage.setItem('ghoomar_active_role', newRole);
  };

  return (
    <RoleContext.Provider value={{ role, setRole: handleRoleChange }}>
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
          <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto">
            {children}
          </main>
        </div>
      </div>
    </RoleContext.Provider>
  );
}
