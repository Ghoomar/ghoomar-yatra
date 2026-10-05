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
  Building2
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export interface PurchaseInvoiceRecord {
  id: string;
  purchase_number: string;
  invoice_number?: string | null;
  purchase_date: string;
  business_date?: string | null;
  net_amount: number;
  total_amount: number;
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
    batch_number?: string | null;
    expiry_date?: string | null;
  }[];
}

interface PurchaseInvoicesViewProps {
  invoices: PurchaseInvoiceRecord[];
  loading: boolean;
  onRefresh: () => void;
  onNewInvoice: () => void;
  onRecordPayment: (vendorId?: string) => void;
}

export function PurchaseInvoicesView({
  invoices,
  loading,
  onRefresh,
  onNewInvoice,
  onRecordPayment,
}: PurchaseInvoicesViewProps) {
  const { t, locale } = useI18n();
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
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
              <input
                type="text"
                placeholder={t('purchases.invoices.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white text-stone-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Filter Dropdowns */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                aria-label={t('purchases.invoices.allStatuses')}
                className="text-xs rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="all">{t('purchases.invoices.status.all')}</option>
                <option value="unpaid">{t('purchases.invoices.status.unpaid')}</option>
                <option value="partial">{t('purchases.invoices.status.partial')}</option>
                <option value="settled">{t('purchases.invoices.status.settled')}</option>
              </select>

              {/* Vendor Filter */}
              <select
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
                aria-label={t('purchases.invoices.allVendors')}
                className="text-xs rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500 max-w-[170px] truncate"
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
                  className="text-stone-500 hover:text-stone-800 text-xs px-2 h-8"
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
        <CardHeader className="py-3 px-4 border-b border-stone-100 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-stone-900 flex items-center gap-2">
            <FileText className="h-4 w-4 text-amber-600" />
            <span>{t('purchases.tabs.invoices')}</span>
            <span className="text-xs font-normal text-stone-500">
              ({filteredInvoices.length} {filteredInvoices.length === 1 ? 'bill' : 'bills'})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
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
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-stone-400">
                      {loading ? t('purchases.vendors.loading') : t('purchases.invoices.noInvoices')}
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => {
                    const balanceDue = inv.net_amount - inv.allocated_amount;
                    const isExpanded = expandedInvoiceId === inv.id;
                    const isSettled = balanceDue <= 0.01;
                    const isPartial = inv.allocated_amount > 0.01 && !isSettled;

                    return (
                      <React.Fragment key={inv.id}>
                        <tr
                          className="hover:bg-stone-50/80 transition-colors cursor-pointer"
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
                            {inv.purchase_number}
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
                            {inv.purchase_date}
                          </td>

                          {/* Line items count */}
                          <td className="py-3 px-3 text-stone-600 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 bg-stone-100 text-stone-700 px-2 py-0.5 rounded text-[11px] font-medium">
                              <Package className="h-3 w-3 text-stone-400" />
                              {inv.lines.length} {inv.lines.length === 1 ? 'item' : 'items'}
                            </span>
                          </td>

                          {/* Net Total */}
                          <td className="py-3 px-3 text-right font-medium text-stone-900 whitespace-nowrap">
                            {formatINR(inv.net_amount)}
                          </td>

                          {/* Paid */}
                          <td className="py-3 px-3 text-right font-medium text-emerald-700 whitespace-nowrap">
                            {formatINR(inv.allocated_amount)}
                          </td>

                          {/* Balance Due */}
                          <td className="py-3 px-3 text-right font-bold text-rose-600 whitespace-nowrap">
                            {formatINR(Math.max(0, balanceDue))}
                          </td>

                          {/* Status Badge */}
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            {isSettled ? (
                              <Badge variant="success">{t('purchases.bills.settled')}</Badge>
                            ) : isPartial ? (
                              <Badge variant="warning">{t('purchases.bills.partial')}</Badge>
                            ) : (
                              <Badge variant="danger">{t('purchases.bills.unpaid')}</Badge>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {!isSettled && (
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
                          </td>
                        </tr>

                        {/* Expanded Line Items Detail Drawer */}
                        {isExpanded && (
                          <tr className="bg-amber-50/20 border-b border-stone-200">
                            <td colSpan={11} className="p-3 sm:p-4">
                              <div className="bg-white rounded-lg border border-amber-200/80 p-3 shadow-xs space-y-2">
                                <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                                  <div className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                                    <Package className="h-3.5 w-3.5 text-amber-600" />
                                    <span>
                                      {t('purchases.bills.items')} — {inv.purchase_number}
                                      {inv.invoice_number ? ` (Bill #${inv.invoice_number})` : ''}
                                    </span>
                                  </div>
                                  <span className="text-[11px] font-mono text-stone-500">
                                    {t('purchases.invoices.table.date')}: {inv.purchase_date}
                                  </span>
                                </div>

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
                                            {l.item_name}
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
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
