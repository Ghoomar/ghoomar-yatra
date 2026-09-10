'use client';

import React from 'react';
import Link from 'next/link';
import { Menu, Calendar, ShieldCheck, Car } from 'lucide-react';
import { RoleName } from '@/lib/types/database';
import { getTodayBusinessDate } from '@/lib/utils';

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

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-stone-200 bg-white/95 px-4 md:px-6 backdrop-blur-xs">
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={onOpenSidebar}
          className="lg:hidden rounded-lg p-2.5 text-stone-600 hover:bg-stone-100 focus:outline-none min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation active:bg-stone-200"
          aria-label="Open navigation sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 rounded-lg bg-stone-100 px-2.5 sm:px-3 py-1.5 border border-stone-200/80 text-xs md:text-sm font-medium text-stone-700">
          <Calendar className="h-4 w-4 text-amber-600 shrink-0" />
          <span>Business Day: <strong className="text-stone-900">{businessDate}</strong></span>
          <span className="hidden sm:inline text-stone-400">|</span>
          <span className="hidden sm:inline text-stone-500 text-xs">Midnight - Midnight</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.2 text-[10px] font-semibold ${
            isDayClosed ? 'bg-stone-200 text-stone-800' : 'bg-emerald-100 text-emerald-800'
          }`}>
            {isDayClosed ? 'CLOSED' : 'OPEN 24×7'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <Link
          href="/operations/gate"
          className="flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors shadow-2xs min-h-[40px] touch-manipulation"
        >
          <Car className="h-3.5 w-3.5 text-amber-700" />
          <span className="hidden md:inline">Gate Counter</span>
        </Link>

        <div className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs min-h-[40px]">
          <ShieldCheck className="h-4 w-4 text-stone-500 hidden sm:inline" />
          <span className="text-stone-500 text-[11px] hidden sm:inline">Role:</span>
          <select
            value={currentRole}
            onChange={(e) => onRoleChange(e.target.value as RoleName)}
            className="bg-transparent font-semibold text-stone-800 focus:outline-none cursor-pointer text-xs py-1"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
