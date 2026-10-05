'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatINR } from '@/lib/utils';
import { VendorOutstandingSummary } from '@/lib/types/database';
import {
  Building2,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  Edit2,
  Trash2,
  Power,
  Phone,
  Tag
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

interface VendorsViewProps {
  vendors: VendorOutstandingSummary[];
  vendorItems: any[];
  catalogItems: any[];
  vendorCategories: { name: string; name_hi?: string | null }[];
  loading: boolean;
  onRefresh: () => void;
  onOpenAddVendor: () => void;
  onOpenCategories: () => void;
  onEditVendor: (vendor: VendorOutstandingSummary) => void;
  onToggleStatus: (vendor: VendorOutstandingSummary) => void;
  onInitiateDelete: (vendor: VendorOutstandingSummary) => void;
}

export function VendorsView({
  vendors,
  vendorItems,
  catalogItems,
  vendorCategories,
  loading,
  onRefresh,
  onOpenAddVendor,
  onOpenCategories,
  onEditVendor,
  onToggleStatus,
  onInitiateDelete,
}: VendorsViewProps) {
  const { t, locale } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [itemFilter, setItemFilter] = useState<string>('all');

  // Compute distinct categories from vendors
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    vendors.forEach((v) => {
      if (Array.isArray(v.supplier_categories)) {
        v.supplier_categories.forEach((c) => set.add(c));
      }
    });
    return Array.from(set).sort();
  }, [vendors]);

  const vendorCatMap = useMemo(() => {
    const map = new Map<string, string>();
    vendorCategories.forEach((vc) => {
      if (vc.name && vc.name_hi) {
        map.set(vc.name.toLowerCase(), vc.name_hi);
      }
    });
    return map;
  }, [vendorCategories]);

  const getCategoryDisplay = (catName: string) => {
    if (locale === 'hi') {
      return vendorCatMap.get(catName.toLowerCase()) || catName;
    }
    return catName;
  };

  const formatPaymentTerms = (term?: string | null) => {
    if (!term) return locale === 'hi' ? '7 दिन की अवधि' : 'Net 7 Days';
    if (locale !== 'hi') return term;
    if (term.includes('Immediate') || term.includes('Cash')) return 'तत्काल / नकद';
    if (term.includes('7 Days')) return '7 दिन की अवधि';
    if (term.includes('15 Days')) return '15 दिन की अवधि';
    if (term.includes('30 Days')) return '30 दिन की अवधि';
    if (term.includes('Advance')) return 'एडवांस पेमेंट';
    return term;
  };

  // Filtered vendors
  const filteredVendors = useMemo(() => {
    return vendors.filter((v) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = v.vendor_name?.toLowerCase().includes(q);
        const matchCode = v.vendor_code?.toLowerCase().includes(q);
        const matchContact = v.contact_person?.toLowerCase().includes(q);
        const matchPhone = v.phone?.toLowerCase().includes(q);
        const matchCat = v.supplier_categories?.some((c) => c.toLowerCase().includes(q));
        if (!matchName && !matchCode && !matchContact && !matchPhone && !matchCat) {
          return false;
        }
      }

      // Status
      if (statusFilter === 'active' && v.is_active === false) return false;
      if (statusFilter === 'inactive' && v.is_active !== false) return false;

      // Category
      if (categoryFilter !== 'all') {
        if (!v.supplier_categories || !v.supplier_categories.includes(categoryFilter)) {
          return false;
        }
      }

      // Item Supplied
      if (itemFilter !== 'all') {
        const suppliesItem = vendorItems.some(
          (vi) => vi.vendor_id === v.vendor_id && vi.inventory_item_id === itemFilter
        );
        if (!suppliesItem) return false;
      }

      return true;
    });
  }, [vendors, searchQuery, statusFilter, categoryFilter, itemFilter, vendorItems]);

  const isFiltered = searchQuery.trim() !== '' || statusFilter !== 'all' || categoryFilter !== 'all' || itemFilter !== 'all';

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
                placeholder={t('purchases.vendors.searchPlaceholder')}
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
                aria-label={t('purchases.vendors.filter.status')}
                className="text-xs rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="all">{t('purchases.vendors.filter.all')}</option>
                <option value="active">{t('purchases.vendors.filter.active')}</option>
                <option value="inactive">{t('purchases.vendors.filter.inactive')}</option>
              </select>

              {/* Category Filter */}
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label={t('purchases.vendors.filter.category')}
                className="text-xs rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500 max-w-[150px] truncate"
              >
                <option value="all">{t('purchases.vendors.allCategories')}</option>
                {allCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {getCategoryDisplay(cat)}
                  </option>
                ))}
              </select>

              {/* Item Supplied Filter */}
              {catalogItems.length > 0 && (
                <select
                  value={itemFilter}
                  onChange={(e) => setItemFilter(e.target.value)}
                  aria-label={t('purchases.vendors.filter.item')}
                  className="text-xs rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-500 max-w-[170px] truncate"
                >
                  <option value="all">{locale === 'hi' ? 'सभी सप्लाइड सामान' : 'All Supplied Items'}</option>
                  {catalogItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name_hi && locale === 'hi' ? item.name_hi : item.name} ({item.item_code})
                    </option>
                  ))}
                </select>
              )}

              {/* Reset button */}
              {isFiltered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                    setCategoryFilter('all');
                    setItemFilter('all');
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

      {/* Vendors Table */}
      <Card>
        <CardHeader className="py-3 px-4 border-b border-stone-100 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-stone-900 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-amber-600" />
            <span>{t('purchases.tabs.vendors')}</span>
            <span className="text-xs font-normal text-stone-500">
              ({filteredVendors.length} {filteredVendors.length === 1 ? 'vendor' : 'vendors'})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                  <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.vendors.table.code')}</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.vendors.table.name')}</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.vendors.table.categories')}</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.vendors.table.contact')}</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">{t('purchases.vendors.table.paymentTerms')}</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.vendors.table.purchased')}</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.vendors.table.paid')}</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.vendors.table.balance')}</th>
                  <th className="py-2.5 px-3 text-center whitespace-nowrap">{t('purchases.bills.table.status')}</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('purchases.vendors.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredVendors.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-stone-400">
                      {loading ? t('purchases.vendors.loading') : t('purchases.vendors.noVendors')}
                    </td>
                  </tr>
                ) : (
                  filteredVendors.map((v) => {
                    const balance = Number(v.outstanding_balance) || 0;
                    const isSettled = balance <= 0;
                    return (
                      <tr key={v.vendor_id} className="hover:bg-stone-50/80 transition-colors">
                        {/* Code */}
                        <td className="py-3 px-3 font-mono text-stone-500 whitespace-nowrap">
                          {v.vendor_code || 'VEND'}
                        </td>

                        {/* Name + Link to Vendor Detail */}
                        <td className="py-3 px-3 font-semibold text-stone-900">
                          <Link
                            href={`/finance/vendors/${v.vendor_id}`}
                            className="hover:text-amber-600 hover:underline flex items-center gap-1.5 group"
                          >
                            <span>{v.vendor_name}</span>
                            <ExternalLink className="h-3 w-3 text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </Link>
                        </td>

                        {/* Categories */}
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {v.supplier_categories && v.supplier_categories.length > 0 ? (
                              v.supplier_categories.slice(0, 2).map((cat) => (
                                <span
                                  key={cat}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-stone-100 text-stone-700 border border-stone-200 truncate"
                                  title={cat}
                                >
                                  {getCategoryDisplay(cat)}
                                </span>
                              ))
                            ) : (
                              <span className="text-stone-400 italic text-[11px]">{t('purchases.vendors.general')}</span>
                            )}
                            {v.supplier_categories && v.supplier_categories.length > 2 && (
                              <span className="text-[10px] text-stone-400 self-center">
                                +{v.supplier_categories.length - 2}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Contact */}
                        <td className="py-3 px-3 text-stone-600 whitespace-nowrap">
                          {v.contact_person || '—'}
                          {v.phone && (
                            <a
                              href={`tel:${v.phone}`}
                              className="text-[11px] text-stone-500 hover:text-amber-600 block flex items-center gap-1 font-mono"
                            >
                              <Phone className="h-2.5 w-2.5 text-stone-400" />
                              {v.phone}
                            </a>
                          )}
                        </td>

                        {/* Payment Terms */}
                        <td className="py-3 px-3 text-stone-600 whitespace-nowrap">
                          {formatPaymentTerms(v.payment_terms)}
                        </td>

                        {/* Total Purchased */}
                        <td className="py-3 px-3 text-right font-medium text-stone-800 whitespace-nowrap">
                          {formatINR(Number(v.total_purchased) || 0)}
                        </td>

                        {/* Total Paid */}
                        <td className="py-3 px-3 text-right font-medium text-emerald-700 whitespace-nowrap">
                          {formatINR(Number(v.total_paid) || 0)}
                        </td>

                        {/* Balance Due */}
                        <td className="py-3 px-3 text-right font-bold text-rose-600 whitespace-nowrap">
                          {formatINR(balance)}
                        </td>

                        {/* Status (Active/Inactive + Payment Status Badge) */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <div className="flex flex-col items-center gap-1">
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                v.is_active !== false
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-stone-100 text-stone-500 border border-stone-200'
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${v.is_active !== false ? 'bg-emerald-500' : 'bg-stone-400'}`} />
                              {v.is_active !== false ? t('purchases.vendors.status.active') : t('purchases.vendors.status.inactive')}
                            </span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onEditVendor(v)}
                              className="p-1 h-7 w-7 text-stone-500 hover:text-amber-600"
                              title={t('purchases.vendors.actions.editVendor')}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onToggleStatus(v)}
                              className={`p-1 h-7 w-7 ${
                                v.is_active !== false
                                  ? 'text-stone-500 hover:text-rose-600'
                                  : 'text-stone-500 hover:text-emerald-600'
                              }`}
                              title={
                                v.is_active !== false
                                  ? t('purchases.vendors.actions.deactivateVendor')
                                  : t('purchases.vendors.actions.activateVendor')
                              }
                            >
                              <Power className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onInitiateDelete(v)}
                              className="p-1 h-7 w-7 text-stone-400 hover:text-rose-600"
                              title={t('purchases.vendors.actions.deleteVendor')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
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
