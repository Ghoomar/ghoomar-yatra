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

interface SidebarProps {
  currentRole: RoleName;
  onRoleChange: (role: RoleName) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ currentRole, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { hasPermission, signOut, actualRole } = useAppRole();

  const navSections = [
    {
      title: 'Command Center',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
      ]
    },
    {
      title: 'Operations',
      items: [
        { href: '/operations/gate', label: 'Gate Counter', icon: Car, permission: 'operations.gate' },
        { href: '/operations/activities', label: 'Activities', icon: Sparkles, permission: 'operations.activities' },
        { href: '/operations/closing', label: 'Daily Closing', icon: Lock, permission: 'operations.closing' },
      ]
    },
    {
      title: 'Finance',
      items: [
        { href: '/finance/sales', label: 'Daily Sales', icon: Receipt, permission: 'finance.sales' },
        { href: '/finance/purchases', label: 'Purchases & Bills', icon: ShoppingBag, permission: 'finance.purchases' },
        { href: '/finance/vendors', label: 'Vendors Master', icon: Building2, permission: 'finance.vendors' },
        { href: '/finance/expenses', label: 'Expenses', icon: IndianRupee, permission: 'finance.expenses' },
        { href: '/finance/utilities', label: 'Utilities & Fuel', icon: Zap, permission: 'finance.utilities' },
        { href: '/finance/profitability', label: 'Profitability P&L', icon: TrendingUp, permission: 'finance.profitability' },
      ]
    },
    {
      title: 'Inventory & Store',
      items: [
        { href: '/inventory', label: 'Stock & Items', icon: Package, permission: 'inventory.stock' },
        { href: '/inventory/issues', label: 'Store Issues / Chef', icon: ArrowRightLeft, permission: 'inventory.issues' },
        { href: '/inventory/assets', label: 'Physical Assets', icon: Layers, permission: 'inventory.assets' },
        { href: '/inventory/count', label: 'Physical Count', icon: ClipboardCheck, permission: 'inventory.count' },
      ]
    },
    {
      title: 'People & Attendance',
      items: [
        { href: '/people/employees', label: 'Staff Directory', icon: Users, permission: 'people.employees' },
        { href: '/people/attendance', label: 'Attendance', icon: ClipboardCheck, permission: 'people.attendance' },
        { href: '/people/financials', label: 'Staff Financials', icon: Wallet, permission: 'people.financials' },
        { href: '/people/tips', label: 'Tips Tracker', icon: Sparkles, permission: 'people.tips' },
      ]
    },
    {
      title: 'Uniforms',
      items: [
        { href: '/uniforms', label: 'Uniform Ledger', icon: Shirt, permission: 'uniforms.ledger' },
      ]
    },
    {
      title: 'Intelligence & Reports',
      items: [
        { href: '/reports', label: 'Management Reports', icon: BarChart3, permission: 'reports.view' },
      ]
    },
    {
      title: 'System',
      items: [
        { href: '/admin', label: 'Master Settings', icon: Settings, permission: 'admin.manage' },
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
        fixed top-0 bottom-0 left-0 z-50 w-64 bg-stone-900 text-stone-300 transition-transform duration-300 ease-in-out flex flex-col
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Brand */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-stone-800 bg-stone-950/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center font-bold text-stone-950 text-base shadow-sm">
              GY
            </div>
            <div>
              <div className="font-bold text-white text-sm tracking-tight leading-none">Ghoomar Yatra</div>
              <div className="text-[10px] text-amber-500 font-medium tracking-wider uppercase mt-1">Village &amp; Resort</div>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dynamic Navigation */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {navSections.map((section) => {
            // Dynamically filter items by database RBAC permissions
            const visibleItems = section.items.filter((item) => hasPermission(item.permission));
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.title}>
                <div className="text-[10px] font-bold text-stone-300 uppercase tracking-wider px-3 mb-2">
                  {section.title}
                </div>
                <div className="space-y-1">
                  {visibleItems.map((item) => {
                    const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
                    const Icon = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onClose}
                        className={`
                          flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors
                          ${isActive 
                            ? 'bg-amber-500 text-stone-950 font-bold shadow-xs' 
                            : 'text-stone-300 hover:text-white hover:bg-stone-800/60'
                          }
                        `}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-stone-950' : 'text-stone-300'}`} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* User Identity & Logout */}
        <div className="p-3 border-t border-stone-800 bg-stone-950/30">
          <div className="text-[10px] text-stone-300 uppercase font-semibold mb-1 px-1 flex items-center justify-between">
            <span>Active Role</span>
            {actualRole === 'Admin' && currentRole !== 'Admin' && (
              <span className="text-amber-400 text-[9px] lowercase font-normal">(preview mode)</span>
            )}
          </div>
          <div className="font-medium text-white flex items-center justify-between text-xs bg-stone-800/80 px-2.5 py-1.5 rounded-md border border-stone-700">
            <span className="flex items-center gap-1.5 truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shrink-0"></span>
              <span className="truncate">{currentRole}</span>
            </span>
            <button
              onClick={signOut}
              title="Sign Out"
              className="p-1 rounded text-stone-300 hover:text-rose-400 hover:bg-stone-700/60 transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
