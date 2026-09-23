'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Car, 
  Receipt, 
  ShoppingBag, 
  IndianRupee, 
  Zap, 
  TrendingUp, 
  Package, 
  ArrowRightLeft, 
  Layers, 
  Users, 
  ClipboardCheck, 
  ClipboardList,
  Wallet, 
  Sparkles, 
  Shirt, 
  BarChart3, 
  Settings,
  Lock,
  Building2,
  X,
  LogOut
} from 'lucide-react';
import { RoleName } from '@/lib/types/database';
import { useAppRole } from '@/components/layout/AppShell';
import { useI18n } from '@/lib/i18n/context';

interface SidebarProps {
  currentRole: RoleName;
  onRoleChange: (role: RoleName) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ currentRole, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { hasPermission, signOut, actualRole } = useAppRole();
  const { t } = useI18n();

  const navSections = [
    {
      titleKey: 'navigation.sections.commandCenter',
      items: [
        { href: '/dashboard', labelKey: 'navigation.items.dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
      ]
    },
    {
      titleKey: 'navigation.sections.operations',
      items: [
        { href: '/operations/daily', labelKey: 'navigation.items.dailyOperations', icon: ClipboardList, permission: 'operations.closing' },
        { href: '/operations/gate', labelKey: 'navigation.items.gateCounter', icon: Car, permission: 'operations.gate' },
        { href: '/operations/closing', labelKey: 'navigation.items.dailyClosing', icon: Lock, permission: 'operations.closing' },
      ]
    },
    {
      titleKey: 'navigation.sections.finance',
      items: [
        { href: '/finance/sales', labelKey: 'navigation.items.dailySales', icon: Receipt, permission: 'finance.sales' },
        { href: '/finance/purchases', labelKey: 'navigation.items.purchases', icon: ShoppingBag, permission: 'finance.purchases' },
        { href: '/finance/vendors', labelKey: 'navigation.items.vendors', icon: Building2, permission: 'finance.vendors' },
        { href: '/finance/expenses', labelKey: 'navigation.items.expenses', icon: IndianRupee, permission: 'finance.expenses' },
        { href: '/finance/utilities', labelKey: 'navigation.items.utilities', icon: Zap, permission: 'finance.utilities' },
        { href: '/finance/profitability', labelKey: 'navigation.items.profitability', icon: TrendingUp, permission: 'finance.profitability' },
      ]
    },
    {
      titleKey: 'navigation.sections.inventory',
      items: [
        { href: '/inventory', labelKey: 'navigation.items.inventory', icon: Package, permission: 'inventory.stock' },
        { href: '/inventory/issues', labelKey: 'navigation.items.storeIssues', icon: ArrowRightLeft, permission: 'inventory.issues' },
        { href: '/inventory/assets', labelKey: 'navigation.items.physicalAssets', icon: Layers, permission: 'inventory.assets' },
        { href: '/inventory/count', labelKey: 'navigation.items.physicalCount', icon: ClipboardCheck, permission: 'inventory.count' },
      ]
    },
    {
      titleKey: 'navigation.sections.people',
      items: [
        { href: '/people/employees', labelKey: 'navigation.items.staffDirectory', icon: Users, permission: 'people.employees' },
        { href: '/people/attendance', labelKey: 'navigation.items.attendance', icon: ClipboardCheck, permission: 'people.attendance' },
        { href: '/people/financials', labelKey: 'navigation.items.staffFinancials', icon: Wallet, permission: 'people.financials' },
        { href: '/people/tips', labelKey: 'navigation.items.tips', icon: Sparkles, permission: 'people.tips' },
      ]
    },
    {
      titleKey: 'navigation.sections.uniforms',
      items: [
        { href: '/uniforms', labelKey: 'navigation.items.uniforms', icon: Shirt, permission: 'uniforms.ledger' },
      ]
    },
    {
      titleKey: 'navigation.sections.reports',
      items: [
        { href: '/reports', labelKey: 'navigation.items.reports', icon: BarChart3, permission: 'reports.view' },
      ]
    },
    {
      titleKey: 'navigation.sections.system',
      items: [
        { href: '/admin', labelKey: 'navigation.items.settings', icon: Settings, permission: 'admin.manage' },
      ]
    }
  ];

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`
        fixed top-0 bottom-0 left-0 z-50 w-64 bg-[#190F24] text-[#C4B7D7] border-r border-[#2C1842] transition-transform duration-300 ease-in-out flex flex-col
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Brand */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-[#2C1842] bg-[#130A1D]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center font-black text-[#190F24] text-base shadow-xs">
              GY
            </div>
            <div>
              <div className="font-bold text-white text-sm tracking-tight leading-none">{t('common.app.brandName')}</div>
              <div className="text-[10px] text-amber-400 font-semibold tracking-wider uppercase mt-1">{t('common.app.brandSubtitle')}</div>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-[#A393B7] hover:text-white hover:bg-[#2C1842]"
            aria-label={t('common.actions.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dynamic Navigation */}
        <div className="flex-1 overflow-y-auto px-3.5 py-4 space-y-5">
          {navSections.map((section) => {
            // Dynamically filter items by database RBAC permissions
            const visibleItems = section.items.filter((item) => hasPermission(item.permission));
            if (visibleItems.length === 0) return null;

            // Collect all navigation hrefs to resolve hierarchical route collisions
            const allNavHrefs = navSections.flatMap((s) => s.items.map((i) => i.href));

            return (
              <div key={section.titleKey}>
                <div className="text-[10px] font-bold text-[#A393B7]/75 uppercase tracking-wider px-3 mb-1.5">
                  {t(section.titleKey)}
                </div>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const isExactMatch = pathname === item.href;
                    const isPrefixMatch = pathname.startsWith(item.href + '/');
                    // If this is a prefix match, ensure no other nav item is a more specific match
                    const hasCloserMatch = isPrefixMatch && allNavHrefs.some(
                      (other) => other !== item.href && (pathname === other || (other.length > item.href.length && pathname.startsWith(other)))
                    );
                    const isActive = isExactMatch || (isPrefixMatch && !hasCloserMatch);
                    const Icon = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onClose}
                        className={`
                          flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors
                          ${isActive 
                            ? 'bg-amber-400 text-[#190F24] font-bold shadow-xs' 
                            : 'text-[#D4C9E2] hover:text-white hover:bg-[#28173B]'
                          }
                        `}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#190F24]' : 'text-[#A393B7]'}`} />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* User Identity & Logout */}
        <div className="p-3 border-t border-[#2C1842] bg-[#130A1D]">
          <div className="text-[10px] text-[#A393B7] uppercase font-semibold mb-1 px-1 flex items-center justify-between">
            <span>{t('navigation.header.activeRole')}</span>
            {actualRole === 'Admin' && currentRole !== 'Admin' && (
              <span className="text-amber-400 text-[9px] lowercase font-normal">{t('navigation.header.previewMode')}</span>
            )}
          </div>
          <div className="font-medium text-white flex items-center justify-between text-xs bg-[#241436] px-2.5 py-1.5 rounded-md border border-[#3A1F54]">
            <span className="flex items-center gap-1.5 truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shrink-0"></span>
              <span className="truncate">{t(`navigation.roles.${currentRole}`)}</span>
            </span>
            <button
              onClick={signOut}
              title={t('navigation.header.signOut')}
              className="p-1 rounded text-[#A393B7] hover:text-rose-400 hover:bg-[#2C1842] transition-colors shrink-0"
              aria-label={t('navigation.header.signOut')}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
