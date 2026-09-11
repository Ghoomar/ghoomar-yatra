'use client';

import React from 'react';
import Link from 'next/link';
import { Menu, Calendar, ShieldCheck, Car, LogOut } from 'lucide-react';
import { RoleName } from '@/lib/types/database';
import { getTodayBusinessDate } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

interface HeaderProps {
  currentRole: RoleName;
  onRoleChange: (role: RoleName) => void;
  onOpenSidebar: () => void;
  businessDate?: string;
  isDayClosed?: boolean;
}

export function Header({
  currentRole,
  onRoleChange,
  onOpenSidebar,
  businessDate = getTodayBusinessDate(),
  isDayClosed = false,
}: HeaderProps) {
  const roles: RoleName[] = [
    'Admin',
    'Owner',
    'General Manager',
    'Accountant',
    'Cashier',
    'Storekeeper',
    'Department Head',
    'Gate Staff',
    'Viewer'
  ];

  const handleSignOut = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {}
    localStorage.removeItem('ghoomar_active_role');
    window.location.href = '/login';
  };

  // Format YYYY-MM-DD -> DD-MM-YY for display while preserving businessDate internally
  const formattedDate = React.useMemo(() => {
    if (!businessDate) return '';
    const parts = businessDate.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}-${month}-${year.slice(-2)}`;
    }
    return businessDate;
  }, [businessDate]);

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full max-w-full items-center justify-between border-b border-stone-200 bg-white/95 px-2.5 sm:px-4 md:px-6 backdrop-blur-xs">
      {/* Left section: Hamburger & Date */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink">
        <button
          onClick={onOpenSidebar}
          className="lg:hidden rounded-lg p-2 text-stone-600 hover:bg-stone-100 focus:outline-none min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation active:bg-stone-200 shrink-0"
          aria-label="Open navigation sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-1.5 rounded-lg bg-stone-100 px-2 sm:px-2.5 py-1.5 border border-stone-200/80 text-xs sm:text-sm font-medium text-stone-700 min-w-0">
          <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-600 shrink-0" />
          <span className="truncate whitespace-nowrap text-[11px] sm:text-xs md:text-sm">
            Date: <strong className="text-stone-900 font-semibold">{formattedDate}</strong>
          </span>
          {isDayClosed && (
            <span className="inline-flex items-center rounded-full px-1.5 py-0.2 text-[9px] font-semibold bg-stone-200 text-stone-800 shrink-0">
              CLOSED
            </span>
          )}
        </div>
      </div>

      {/* Right section: Gate Counter, Role Selector & Sign Out */}
      <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 shrink-0">
        <Link
          href="/operations/gate"
          title="Gate Counter"
          className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 sm:px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors shadow-2xs min-h-[40px] min-w-[40px] touch-manipulation"
        >
          <Car className="h-4 w-4 text-amber-700 shrink-0" />
          <span className="hidden md:inline">Gate Counter</span>
        </Link>

        <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2 sm:px-2.5 py-1 text-xs min-h-[40px] max-w-[95px] sm:max-w-none">
          <ShieldCheck className="h-4 w-4 text-stone-500 hidden sm:inline shrink-0" />
          <span className="text-stone-500 text-[11px] hidden sm:inline shrink-0">Role:</span>
          {currentRole === 'Gate Staff' ? (
            <span className="font-bold text-stone-800 text-xs py-1 px-1">
              Gate Staff
            </span>
          ) : (
            <select
              value={currentRole}
              onChange={(e) => onRoleChange(e.target.value as RoleName)}
              className="bg-transparent font-semibold text-stone-800 focus:outline-none cursor-pointer text-xs py-1 max-w-[75px] sm:max-w-none truncate"
              aria-label="Current Role Perspective"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          onClick={handleSignOut}
          title="Sign Out"
          className="flex items-center justify-center rounded-lg border border-stone-200 bg-stone-50 p-2 text-stone-500 hover:text-rose-600 hover:bg-rose-50 transition-colors min-h-[40px] min-w-[40px]"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
