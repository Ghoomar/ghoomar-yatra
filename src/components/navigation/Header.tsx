'use client';

import React from 'react';
import Link from 'next/link';
import { Menu, Calendar, ShieldCheck, Car, LogOut, Globe } from 'lucide-react';
import { RoleName } from '@/lib/types/database';
import { getTodayBusinessDate } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/context';

interface HeaderProps {
  currentRole: RoleName;
  actualRole?: RoleName;
  onRoleChange: (role: RoleName) => void;
  onOpenSidebar: () => void;
  onSignOut?: () => void;
  businessDate?: string;
  isDayClosed?: boolean;
}

export function Header({
  currentRole,
  actualRole = 'Viewer',
  onRoleChange,
  onOpenSidebar,
  onSignOut,
  businessDate = getTodayBusinessDate(),
  isDayClosed = false,
}: HeaderProps) {
  const { locale, setLocale, t, formatDate } = useI18n();

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
    if (onSignOut) {
      await onSignOut();
      return;
    }
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {}
    try {
      localStorage.removeItem('ghoomar_active_role');
      sessionStorage.clear();
    } catch {}
    window.location.replace('/login');
  };

  // Format business date with active locale (e.g. 20 Sep 2026 or 20 सित॰ 2026)
  const formattedDate = React.useMemo(() => {
    return formatDate(businessDate, 'short');
  }, [businessDate, formatDate]);

  const isAdminUser = actualRole === 'Admin';

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full max-w-full items-center justify-between border-b border-[#E7E2D8] bg-white/95 px-2.5 sm:px-4 md:px-6 backdrop-blur-xs">
      {/* Left section: Hamburger & Date */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink">
        <button
          onClick={onOpenSidebar}
          className="lg:hidden rounded-lg p-2 text-stone-600 hover:bg-stone-100 focus:outline-none min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation active:bg-stone-200 shrink-0"
          aria-label={t('navigation.header.openSidebar')}
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-1.5 rounded-lg bg-[#F8F5F0] px-2 sm:px-2.5 py-1.5 border border-[#E7E2D8] text-xs sm:text-sm font-medium text-stone-700 min-w-0">
          <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-600 shrink-0" />
          <span className="truncate whitespace-nowrap text-[11px] sm:text-xs md:text-sm">
            {t('navigation.header.dateLabel')} <strong className="text-stone-900 font-semibold">{formattedDate}</strong>
          </span>
          {isDayClosed && (
            <span className="inline-flex items-center rounded-full px-1.5 py-0.2 text-[9px] font-semibold bg-stone-200 text-stone-800 shrink-0">
              {t('navigation.header.closedBadge')}
            </span>
          )}
        </div>
      </div>

      {/* Right section: Language Switcher, Gate Counter, Role Display & Sign Out */}
      <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 shrink-0">
        {/* Global English / हिंदी Language Switcher */}
        <div 
          className="flex items-center rounded-lg border border-stone-200 bg-stone-100 p-0.5 shadow-2xs"
          role="group"
          aria-label={t('common.language.switchLabel')}
        >
          <button
            type="button"
            data-testid="lang-switch-en"
            onClick={() => setLocale('en')}
            className={`px-2 py-1 rounded-md text-xs font-bold transition-all min-h-[34px] min-w-[34px] flex items-center justify-center cursor-pointer ${
              locale === 'en'
                ? 'bg-amber-500 text-stone-950 shadow-xs'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
            }`}
            aria-pressed={locale === 'en'}
          >
            EN
          </button>
          <button
            type="button"
            data-testid="lang-switch-hi"
            onClick={() => setLocale('hi')}
            className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all min-h-[34px] min-w-[38px] flex items-center justify-center cursor-pointer ${
              locale === 'hi'
                ? 'bg-amber-500 text-stone-950 shadow-xs'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
            }`}
            aria-pressed={locale === 'hi'}
          >
            हिंदी
          </button>
        </div>

        {/* Gate Counter Shortcut Button */}
        <Link
          href="/operations/gate"
          title={t('navigation.header.gateCounterButton')}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 sm:px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors shadow-2xs min-h-[40px] min-w-[40px] touch-manipulation"
        >
          <Car className="h-4 w-4 text-amber-700 shrink-0" />
          <span className="hidden md:inline">{t('navigation.header.gateCounterButton')}</span>
        </Link>

        {/* Role Display / Admin Preview Switcher */}
        <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2 sm:px-2.5 py-1 text-xs min-h-[40px] max-w-[120px] sm:max-w-none">
          <ShieldCheck className="h-4 w-4 text-stone-500 hidden sm:inline shrink-0" />
          <span className="text-stone-500 text-[11px] hidden sm:inline shrink-0">{t('navigation.header.roleLabel')}</span>
          {isAdminUser ? (
            <select
              value={currentRole}
              onChange={(e) => onRoleChange(e.target.value as RoleName)}
              className="bg-transparent font-semibold text-stone-800 focus:outline-none cursor-pointer text-xs py-1 max-w-[85px] sm:max-w-none truncate"
              aria-label="Current Role Perspective"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`navigation.roles.${r}`)} {r !== 'Admin' ? t('navigation.header.preview') : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-bold text-stone-800 text-xs py-1 px-1 truncate">
              {t(`navigation.roles.${currentRole}`)}
            </span>
          )}
        </div>

        <button
          onClick={handleSignOut}
          title={t('navigation.header.signOut')}
          className="flex items-center justify-center rounded-lg border border-stone-200 bg-stone-50 p-2 text-stone-500 hover:text-rose-600 hover:bg-rose-50 transition-colors min-h-[40px] min-w-[40px] cursor-pointer"
          aria-label={t('navigation.header.signOut')}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
