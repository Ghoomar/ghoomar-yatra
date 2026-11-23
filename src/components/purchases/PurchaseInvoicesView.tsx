'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatINR } from '@/lib/utils';
import {
  FileText,
  Search,
  Filter,
  Plus,
  CreditCard,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Package,
  Calendar,
  Building2,
  Trash2,
  Edit3,
  Ban,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { useAppRole } from '@/components/layout/AppShell';

export interface PurchaseInvoiceRecord {
  id: string;
  purchase_number: string;
  invoice_number?: string | null;
  purchase_date: string;
  business_date?: string | null;
  net_amount: number;
  total_amount: number;
  status?: string;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
  vendor_id: string;
  vendor_name: string;
  vendor_code?: string | null;
  allocated_amount: number;
  lines: {
    id: string;
    item_id: string;
    item_name: string;
    item_code: string;
    quantity: number;
    rate: number;
    total_amount: number;
    unit_symbol?: string;
    packaging_unit_id?: string | null;
    brand_name_snapshot?: string | null;
    pack_unit_snapshot?: string | null;
    pack_quantity?: number | null;
    pack_rate?: number | null;
    conversion_factor_snapshot?: number | null;
  }[];
}

interface PurchaseInvoicesViewProps {
  invoices: PurchaseInvoiceRecord[];
  loading: boolean;
  onRefresh: () => void;
  onNewInvoice: () => void;
  onRecordPayment: (vendorId?: string) => void;
  onCancelInvoice?: (invoice: PurchaseInvoiceRecord) => void;
  onEditInvoice?: (invoice: PurchaseInvoiceRecord) => void;
  onDeleteInvoice?: (invoice: PurchaseInvoiceRecord) => void;
}

const formatDisplayDate = (dateStr: string, locale: string) => {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-');
    if (!y || !m || !d) return dateStr;
    const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthsHi = ['जन', 'फ़र', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अग', 'सितं', 'अक्टू', 'नव', 'दिसं'];
    const mIdx = parseInt(m, 10) - 1;
    const month = locale === 'hi' ? monthsHi[mIdx] : monthsEn[mIdx];
    return `${parseInt(d, 10)} ${month} ${y}`;
  } catch {
    return dateStr;
  }
};

export function PurchaseInvoicesView({
  invoices,
  loading,
  onRefresh,
  onNewInvoice,
  onRecordPayment,
  onCancelInvoice,
  onEditInvoice,
  onDeleteInvoice,
}: PurchaseInvoicesViewProps) {
  const { t, locale } = useI18n();
  const { role, hasPermission } = useAppRole();
  const isAdmin = role === 'Admin';
  const canEditInvoices = isAdmin || hasPermission('finance.purchases.edit');

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'partial' | 'settled'>('all');
  const [vendorFilter, setVendorFilter] = useState<string>('all');
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  // Distinct vendors from invoices
  const distinctVendors = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach((inv) => {
      if (inv.vendor_id && inv.vendor_name) {
        map.set(inv.vendor_id, inv.vendor_name);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices]);

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchPo = inv.purchase_number?.toLowerCase().includes(q);
        const matchInv = inv.invoice_number?.toLowerCase().includes(q);
        const matchVendor = inv.vendor_name?.toLowerCase().includes(q);
        const matchItem = inv.lines.some((l) => l.item_name?.toLowerCase().includes(q) || l.item_code?.toLowerCase().includes(q));
        if (!matchPo && !matchInv && !matchVendor && !matchItem) {
          return false;
        }
      }

      // Vendor Filter
      if (vendorFilter !== 'all' && inv.vendor_id !== vendorFilter) {
        return false;
      }

      // Status Filter
      const balance = inv.net_amount - inv.allocated_amount;
      if (statusFilter === 'settled' && balance > 0.01) return false;
      if (statusFilter === 'unpaid' && inv.allocated_amount > 0.01) return false;
      if (statusFilter === 'partial' && (inv.allocated_amount <= 0.01 || balance <= 0.01)) return false;

      return true;
    });
  }, [invoices, searchQuery, vendorFilter, statusFilter]);

  const isFiltered = searchQuery.trim() !== '' || statusFilter !== 'all' || vendorFilter !== 'all';

  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <Card>
        <CardContent className="p-2.5 sm:p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-2 sm:gap-3">
            {/* Search Input */}
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
              <input
                type="text"
                placeholder={t('purchases.invoices.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Filter Dropdowns - full width 2-column grid on mobile */}
            <div className="grid grid-cols-2 md:flex md:items-center gap-2 w-full md:w-auto">
              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                aria-label={t('purchases.invoices.allStatuses')}
                className="w-full md:w-auto text-xs rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="all">{t('purchases.invoices.allStatuses')}</option>
                <option value="unpaid">{t('purchases.invoices.status.unpaid')}</option>
                <option value="partial">{t('purchases.invoices.status.partial')}</option>
                <option value="settled">{t('purchases.invoices.status.settled')}</option>
              </select>

              {/* Vendor Filter */}
              <select
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
                aria-label={t('purchases.invoices.allVendors')}
                className="w-full md:w-auto text-xs rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500 truncate"
              >
                <option value="all">{t('purchases.invoices.allVendors')}</option>
                {distinctVendors.map(([vId, vName]) => (
                  <option key={vId} value={vId}>
                    {vName}
                  </option>
                ))}
              </select>

              {/* Reset button */}
              {isFiltered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                    setVendorFilter('all');
                  }}
                  className="col-span-2 md:col-span-1 text-stone-500 hover:text-stone-800 text-xs px-2 h-7 md:h-8 justify-center"
                >
                  {t('purchases.vendors.filter.reset')}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invoices Table */}
      <Card>
        <CardHeader className="hidden md:flex py-3 px-4 border-b border-stone-100 flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-stone-900 flex items-center gap-2">
            <FileText className="h-4 w-4 text-amber-600" />
            <span>{t('purchases.tabs.invoices')}</span>
            <span className="text-xs font-normal text-stone-500">
              ({filteredInvoices.length} {filteredInvoices.length === 1 ? 'bill' : 'bills'})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredInvoices.length === 0 ? (
            <div className="py-12 text-center text-stone-400 text-xs">
              {loading ? t('purchases.vendors.loading') : t('purchases.invoices.noInvoices')}
            </div>
          ) : (
            <>
              {/* 1. Mobile Cards View (< md) */}
              <div className="block md:hidden divide-y divide-stone-200">
                {filteredInvoices.map((inv) => {
                  const balanceDue = inv.net_amount - inv.allocated_amount;
                  const isExpanded = expandedInvoiceId === inv.id;
                  const isCancelled = inv.status === 'cancelled';
                  const isSettled = balanceDue <= 0.01;
                  const isPartial = inv.allocated_amount > 0.01 && !isSettled;

                  return (
                    <div
                      key={inv.id}
                      className={`p-3 space-y-2 bg-white transition-colors ${
                        isCancelled ? 'opacity-60 bg-stone-50/40' : ''
                      }`}
                    >
                      {/* Tappable Card Header Area */}
                      <div
                        onClick={() => setExpandedInvoiceId(isExpanded ? null : inv.id)}
                        className="cursor-pointer space-y-1.5"
                      >
                        {/* Top Row: Vendor (bold) on left, Net Total on right */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-bold text-stone-900 text-sm truncate flex-1">
                            {inv.vendor_name}
                          </div>
                          <div className="text-right shrink-0">
                            <span
                              className={`text-sm font-extrabold text-stone-900 ${
                                isCancelled ? 'line-through text-stone-400' : ''
                              }`}
                            >
                              {formatINR(inv.net_amount)}
                            </span>
                          </div>
                        </div>

                        {/* Second Row: Date, Items count, Bill # (if present), Status pill */}
                        <div className="flex items-center justify-between text-xs text-stone-500 gap-1 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <span>{formatDisplayDate(inv.purchase_date, locale)}</span>
                            <span>•</span>
                            <span>
                              {inv.lines.length}{' '}
                              {inv.lines.length === 1
                                ? t('purchases.bills.singleItem')
                                : t('purchases.bills.multipleItems')}
                            </span>
                            {inv.invoice_number && (
                              <>
                                <span>•</span>
                                <span className="font-mono text-stone-700 bg-stone-100 px-1 rounded text-[11px]">
                                  #{inv.invoice_number}
                                </span>
                              </>
                            )}
                          </div>

                          <div>
                            {isCancelled ? (
                              <Badge variant="danger" className="text-[10px] py-0 px-1.5">
                                {t('purchases.bills.cancelledBadge')}
                              </Badge>
                            ) : isSettled ? (
                              <Badge variant="success" className="text-[10px] py-0 px-1.5">
                                {t('purchases.bills.settled')}
                              </Badge>
                            ) : isPartial ? (
                              <Badge variant="warning" className="text-[10px] py-0 px-1.5">
                                {t('purchases.bills.partial')}
                              </Badge>
                            ) : (
                              <Badge variant="danger" className="text-[10px] py-0 px-1.5">
                                {t('purchases.bills.unpaid')}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Balance Due row only on partially paid cards */}
                        {!isCancelled && isPartial && (
                          <div className="flex items-center justify-between text-xs pt-0.5">
                            <span className="text-stone-500">
                              {t('purchases.bills.table.paid')}: <span className="font-semibold text-emerald-700">{formatINR(inv.allocated_amount)}</span>
                            </span>
                            <span className="text-stone-500">
                              {t('purchases.bills.balanceDue')}: <span className="font-bold text-rose-600">{formatINR(Math.max(0, balanceDue))}</span>
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Expanded Line Items & Action Drawer */}
                      {isExpanded && (
                        <div className="pt-2 border-t border-stone-100 space-y-2.5">
                          {/* Actions */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {!isCancelled && canEditInvoices && onEditInvoice && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onEditInvoice(inv)}
                                className="text-xs h-7 px-2.5 gap-1 text-amber-800 border-amber-300 hover:bg-amber-50"
                              >
                                <Edit3 className="h-3 w-3" />
                                <span>{t('purchases.bills.editPurchase')}</span>
                              </Button>
                            )}
                            {!isSettled && !isCancelled && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onRecordPayment(inv.vendor_id)}
                                className="text-xs h-7 px-2.5 gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                              >
                                <CreditCard className="h-3 w-3" />
                                <span>{t('purchases.bills.recordPayment')}</span>
                              </Button>
                            )}
                            {!isCancelled && canEditInvoices && onCancelInvoice && inv.allocated_amount <= 0.01 && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onCancelInvoice(inv)}
                                className="text-xs h-7 px-2.5 gap-1 text-rose-600 border-rose-200 hover:bg-rose-50"
                              >
                                <Ban className="h-3 w-3" />
                                <span>{t('purchases.bills.cancelInvoice')}</span>
                              </Button>
                            )}
                            {isAdmin && onDeleteInvoice && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onDeleteInvoice(inv)}
                                className="text-xs h-7 px-2.5 gap-1 text-rose-700 border-rose-300 hover:bg-rose-100"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>{t('purchases.bills.deleteInvoice')}</span>
                              </Button>
                            )}
                            <Link
                              href={`/finance/vendors/${inv.vendor_id}`}
                              className="text-xs text-amber-700 hover:underline flex items-center gap-1 px-2 py-1 ml-auto"
                            >
                              <span>Ledger</span>
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          </div>

                          {/* Line Items List */}
                          <div className="bg-stone-50 rounded-lg p-2.5 space-y-1.5 border border-stone-200">
                            <div className="text-[11px] font-bold text-stone-700 flex items-center justify-between">
                              <span>{t('purchases.bills.billItems', { number: inv.purchase_number })}</span>
                              <span className="font-mono text-stone-400 font-normal">
                                PO: {inv.purchase_number}
                              </span>
                            </div>

                            {isCancelled && (
                              <div className="p-2 bg-rose-50 border border-rose-200 rounded text-rose-800 text-[11px]">
                                <span className="font-bold">{t('purchases.bills.cancelledBadge')}: </span>
                                <span>{inv.cancelled_reason || 'Cancelled'}</span>
                              </div>
                            )}

                            <div className="divide-y divide-stone-200 text-xs">
                              {inv.lines.map((l) => (
                                <div key={l.id} className="py-1.5 flex items-start justify-between gap-2">
                                  <div>
                                    <div className="font-semibold text-stone-900">{l.item_name}</div>
                                    <div className="text-[10px] text-stone-500 font-mono">
                                      {l.pack_unit_snapshot ? (
                                        <span>
                                          {l.brand_name_snapshot ? `${l.brand_name_snapshot} • ` : ''}
                                          {l.pack_quantity} {l.pack_unit_snapshot} @ {formatINR(l.pack_rate || 0)}
                                        </span>
                                      ) : (
                                        <span>
                                          {l.quantity} {l.unit_symbol} @ {formatINR(l.rate)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="font-bold text-stone-900 shrink-0">
                                    {formatINR(l.total_amount)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 2. Desktop Table View (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                      <th className="py-2.5 px-3 w-8"></th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.invoices.table.invoice')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.invoices.table.billNo')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.invoices.table.vendor')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.invoices.table.date')}</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.invoices.table.items')}</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.invoices.table.netTotal')}</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.invoices.table.paid')}</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.invoices.table.balance')}</th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">{t('purchases.invoices.table.status')}</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.invoices.table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredInvoices.map((inv) => {
                      const balanceDue = inv.net_amount - inv.allocated_amount;
                      const isExpanded = expandedInvoiceId === inv.id;
                      const isCancelled = inv.status === 'cancelled';
                      const isSettled = balanceDue <= 0.01;
                      const isPartial = inv.allocated_amount > 0.01 && !isSettled;

                      return (
                        <React.Fragment key={inv.id}>
                          <tr
                            className={`hover:bg-stone-50/80 transition-colors cursor-pointer ${
                              isCancelled ? 'opacity-60 bg-stone-50/40' : ''
                            }`}
                            onClick={() => setExpandedInvoiceId(isExpanded ? null : inv.id)}
                          >
                            {/* Toggle Expand Icon */}
                            <td className="py-3 px-3 text-stone-400">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-amber-600" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </td>

                            {/* Purchase Number / PO */}
                            <td className="py-3 px-3 font-mono font-medium text-stone-900 whitespace-nowrap">
                              <span className={isCancelled ? 'line-through text-stone-400' : ''}>
                                {inv.purchase_number}
                              </span>
                            </td>

                            {/* Invoice / Bill # */}
                            <td className="py-3 px-3 font-mono text-stone-600 whitespace-nowrap">
                              {inv.invoice_number || '—'}
                            </td>

                            {/* Vendor Name + Link */}
                            <td className="py-3 px-3 font-semibold text-stone-900" onClick={(e) => e.stopPropagation()}>
                              <Link
                                href={`/finance/vendors/${inv.vendor_id}`}
                                className="hover:text-amber-600 hover:underline flex items-center gap-1 group"
                              >
                                <span>{inv.vendor_name}</span>
                                <ExternalLink className="h-3 w-3 text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </Link>
                            </td>

                            {/* Purchase Date */}
                            <td className="py-3 px-3 text-stone-600 whitespace-nowrap">
                              {formatDisplayDate(inv.purchase_date, locale)}
                            </td>

                            {/* Line items count */}
                            <td className="py-3 px-3 text-stone-600 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 bg-stone-100 text-stone-700 px-2 py-0.5 rounded text-[11px] font-medium">
                                <Package className="h-3 w-3 text-stone-400" />
                                {inv.lines.length}{' '}
                                {inv.lines.length === 1
                                  ? t('purchases.bills.singleItem')
                                  : t('purchases.bills.multipleItems')}
                              </span>
                            </td>

                            {/* Net Total */}
                            <td className="py-3 px-3 text-right font-medium text-stone-900 whitespace-nowrap">
                              <span className={isCancelled ? 'line-through text-stone-400' : ''}>
                                {formatINR(inv.net_amount)}
                              </span>
                            </td>

                            {/* Paid */}
                            <td className="py-3 px-3 text-right font-medium text-emerald-700 whitespace-nowrap">
                              {formatINR(inv.allocated_amount)}
                            </td>

                            {/* Balance Due */}
                            <td className="py-3 px-3 text-right font-bold text-rose-600 whitespace-nowrap">
                              {isCancelled ? '—' : formatINR(Math.max(0, balanceDue))}
                            </td>

                            {/* Status Badge */}
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              {isCancelled ? (
                                <Badge variant="danger" className="bg-rose-100 text-rose-800 border-rose-300 font-bold">
                                  {t('purchases.bills.cancelledBadge')}
                                </Badge>
                              ) : isSettled ? (
                                <Badge variant="success">{t('purchases.bills.settled')}</Badge>
                              ) : isPartial ? (
                                <Badge variant="warning">{t('purchases.bills.partial')}</Badge>
                              ) : (
                                <Badge variant="danger">{t('purchases.bills.unpaid')}</Badge>
                              )}
                            </td>

                            {/* Actions */}
                            <td className="py-3 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                {!isCancelled && canEditInvoices && onEditInvoice && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onEditInvoice(inv)}
                                    className="text-[11px] h-7 px-2 gap-1 text-amber-800 border-amber-300 hover:bg-amber-50"
                                    title={t('purchases.bills.editPurchase')}
                                  >
                                    <Edit3 className="h-3 w-3" />
                                    <span>{t('purchases.bills.editPurchase')}</span>
                                  </Button>
                                )}
                                {!isSettled && !isCancelled && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onRecordPayment(inv.vendor_id)}
                                    className="text-[11px] h-7 px-2 gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                    title={t('purchases.bills.recordPayment')}
                                  >
                                    <CreditCard className="h-3 w-3" />
                                    <span>{t('purchases.bills.recordPayment')}</span>
                                  </Button>
                                )}
                                {!isCancelled && canEditInvoices && onCancelInvoice && inv.allocated_amount <= 0.01 && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onCancelInvoice(inv)}
                                    className="text-[11px] h-7 px-2 gap-1 text-rose-600 border-rose-200 hover:bg-rose-50"
                                    title={t('purchases.bills.cancelInvoice')}
                                  >
                                    <Ban className="h-3 w-3" />
                                    <span>{t('purchases.bills.cancelInvoice')}</span>
                                  </Button>
                                )}
                                {isAdmin && onDeleteInvoice && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onDeleteInvoice(inv)}
                                    className="text-[11px] h-7 px-2 gap-1 text-rose-700 border-rose-300 hover:bg-rose-100"
                                    title={t('purchases.bills.deleteInvoice')}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    <span>{t('purchases.bills.deleteInvoice')}</span>
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Line Items Detail Drawer */}
                          {isExpanded && (
                            <tr className="bg-amber-50/20 border-b border-stone-200">
                              <td colSpan={11} className="p-3 sm:p-4">
                                <div className="bg-white rounded-lg border border-amber-200/80 p-3 shadow-xs space-y-3">
                                  <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                                    <div className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                                      <Package className="h-3.5 w-3.5 text-amber-600" />
                                      <span>
                                        {t('purchases.bills.billItems', { number: inv.purchase_number })}
                                        {inv.invoice_number ? ` (Bill #${inv.invoice_number})` : ''}
                                      </span>
                                    </div>
                                    <span className="text-[11px] font-mono text-stone-500">
                                      {t('purchases.invoices.table.date')}: {formatDisplayDate(inv.purchase_date, locale)}
                                    </span>
                                  </div>

                                  {isCancelled && (
                                    <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center justify-between">
                                      <div>
                                        <span className="font-bold">{t('purchases.bills.cancelledBadge')}: </span>
                                        <span>{inv.cancelled_reason || 'Cancelled'}</span>
                                      </div>
                                      {inv.cancelled_at && (
                                        <span className="text-[10px] font-mono text-stone-500">
                                          {new Date(inv.cancelled_at).toLocaleString()}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left text-[11px]">
                                      <thead>
                                        <tr className="border-b border-stone-100 text-stone-500 font-semibold">
                                          <th className="py-1.5 px-2">Item</th>
                                          <th className="py-1.5 px-2">SKU</th>
                                          <th className="py-1.5 px-2 text-right">{t('purchases.invoices.qty')}</th>
                                          <th className="py-1.5 px-2 text-right">{t('purchases.invoices.rate')}</th>
                                          <th className="py-1.5 px-2 text-right">{t('purchases.invoices.lineTotal')}</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-stone-50">
                                        {inv.lines.map((l) => (
                                          <tr key={l.id}>
                                            <td className="py-1.5 px-2 font-medium text-stone-800">
                                              <div>{l.item_name}</div>
                                              {l.pack_unit_snapshot && (
                                                <div className="text-[10px] text-amber-800 font-mono mt-0.5">
                                                  {l.brand_name_snapshot ? `${l.brand_name_snapshot} ` : ''}
                                                  {l.pack_quantity} {l.pack_unit_snapshot} @ {formatINR(l.pack_rate || 0)}/{l.pack_unit_snapshot}
                                                  {l.conversion_factor_snapshot && Number(l.conversion_factor_snapshot) > 1 && (
                                                    <span> (×{l.conversion_factor_snapshot} = {l.quantity} {l.unit_symbol})</span>
                                                  )}
                                                </div>
                                              )}
                                            </td>
                                            <td className="py-1.5 px-2 font-mono text-stone-500">
                                              {l.item_code}
                                            </td>
                                            <td className="py-1.5 px-2 text-right font-mono text-stone-700">
                                              {l.quantity} {l.unit_symbol || ''}
                                            </td>
                                            <td className="py-1.5 px-2 text-right font-mono text-stone-700">
                                              {formatINR(l.rate)}
                                            </td>
                                            <td className="py-1.5 px-2 text-right font-semibold text-stone-900">
                                              {formatINR(l.total_amount)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
