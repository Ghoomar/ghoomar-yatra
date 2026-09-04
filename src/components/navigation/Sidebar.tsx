'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Car, 
  CalendarClock, 
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
  X
} from 'lucide-react';
import { RoleName } from '@/lib/types/database';

interface SidebarProps {
  currentRole: RoleName;
  onRoleChange: (role: RoleName) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ currentRole, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  const navSections = [
    {
      title: 'Command Center',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['Admin', 'Owner', 'General Manager', 'Accountant', 'Cashier', 'Storekeeper', 'Viewer'] },
      ]
    },
    {
      title: 'Operations',
      items: [
        { href: '/operations/gate', label: 'Gate Counter', icon: Car, roles: ['Admin', 'Owner', 'General Manager', 'Gate Staff'] },
        { href: '/operations/activities', label: 'Activities', icon: Sparkles, roles: ['Admin', 'Owner', 'General Manager', 'Cashier'] },
        { href: '/operations/stage', label: 'Stage Schedule', icon: CalendarClock, roles: ['Admin', 'Owner', 'General Manager', 'Viewer'] },
        { href: '/operations/closing', label: 'Daily Closing', icon: Lock, roles: ['Admin', 'Owner', 'General Manager', 'Accountant', 'Cashier'] },
      ]
    },
    {
      title: 'Finance',
      items: [
        { href: '/finance/sales', label: 'Daily Sales', icon: Receipt, roles: ['Admin', 'Owner', 'Accountant', 'Cashier'] },
        { href: '/finance/purchases', label: 'Purchases & Bills', icon: ShoppingBag, roles: ['Admin', 'Owner', 'Accountant', 'Storekeeper'] },
        { href: '/finance/expenses', label: 'Expenses', icon: IndianRupee, roles: ['Admin', 'Owner', 'Accountant', 'General Manager'] },
        { href: '/finance/utilities', label: 'Utilities & Fuel', icon: Zap, roles: ['Admin', 'Owner', 'Accountant', 'General Manager'] },
        { href: '/finance/profitability', label: 'Profitability P&L', icon: TrendingUp, roles: ['Admin', 'Owner', 'General Manager', 'Accountant'] },
      ]
    },
    {
      title: 'Inventory & Store',
      items: [
        { href: '/inventory', label: 'Stock & Items', icon: Package, roles: ['Admin', 'Owner', 'General Manager', 'Storekeeper', 'Accountant'] },
        { href: '/inventory/issues', label: 'Store Issues / Chef', icon: ArrowRightLeft, roles: ['Admin', 'Storekeeper', 'Department Head'] },
        { href: '/inventory/assets', label: 'Physical Assets', icon: Layers, roles: ['Admin', 'Storekeeper', 'General Manager'] },
        { href: '/inventory/count', label: 'Physical Count', icon: ClipboardCheck, roles: ['Admin', 'Storekeeper', 'Accountant'] },
      ]
    },
    {
      title: 'People & Attendance',
      items: [
        { href: '/people/employees', label: 'Staff Directory', icon: Users, roles: ['Admin', 'Owner', 'General Manager', 'Accountant'] },
        { href: '/people/attendance', label: 'Attendance', icon: ClipboardCheck, roles: ['Admin', 'Owner', 'General Manager', 'Department Head', 'Accountant'] },
        { href: '/people/financials', label: 'Staff Financials', icon: Wallet, roles: ['Admin', 'Accountant', 'Owner'] },
        { href: '/people/tips', label: 'Tips Tracker', icon: Sparkles, roles: ['Admin', 'Accountant', 'Cashier'] },
      ]
    },
    {
      title: 'Uniforms',
      items: [
        { href: '/uniforms', label: 'Uniform Ledger', icon: Shirt, roles: ['Admin', 'Storekeeper', 'General Manager'] },
      ]
    },
    {
      title: 'Intelligence & Reports',
      items: [
        { href: '/reports', label: 'Management Reports', icon: BarChart3, roles: ['Admin', 'Owner', 'General Manager', 'Accountant', 'Viewer'] },
      ]
    },
    {
      title: 'System',
      items: [
        { href: '/admin', label: 'Master Settings', icon: Settings, roles: ['Admin'] },
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

      <aside className={`fixed top-0 bottom-0 left-0 z-50 w-64 border-r border-stone-200 bg-stone-900 text-stone-200 flex flex-col transition-transform duration-200 lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-stone-800 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center text-stone-950 font-black tracking-wider text-base shadow-md shadow-amber-500/20">
              GY
            </div>
            <div>
              <div className="font-bold text-white text-base tracking-tight leading-none">GHOOMAR YATRA</div>
              <div className="text-[10px] text-amber-400 font-medium tracking-wide uppercase mt-0.5">Highway Command Center</div>
            </div>
          </Link>
          <button onClick={onClose} className="lg:hidden text-stone-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 text-xs">
          {navSections.map((section, idx) => {
            const visibleItems = section.items.filter(item => 
              currentRole === 'Admin' || item.roles.includes(currentRole)
            );

            if (visibleItems.length === 0) return null;

            return (
              <div key={idx} className="space-y-1">
                <div className="px-3 pb-1 text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
                  {section.title}
                </div>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-amber-500 text-stone-950 font-semibold shadow-xs'
                          : 'text-stone-300 hover:bg-stone-800 hover:text-white'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isActive ? 'text-stone-950' : 'text-stone-400'}`} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-stone-800 bg-stone-950/60">
          <div className="text-[11px] text-stone-400 mb-1">Active Role Perspective</div>
          <div className="font-medium text-white flex items-center justify-between text-xs bg-stone-800/80 px-2.5 py-1.5 rounded-md border border-stone-700">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
              {currentRole}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
